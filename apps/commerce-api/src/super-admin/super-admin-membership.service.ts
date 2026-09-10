/**
 * Administración cross-tenant de personas para /super-admin: invitar con
 * cualquier rol, cambiar rol/estado de una membresía, quitarla y revocar
 * invitaciones.
 *
 * Es un camino aparte de MembershipService a propósito: aquel relee la
 * membresía del actor y exige `users.manage` / `tenant.admin` dentro del
 * tenant, y un super-admin de plataforma normalmente NO es miembro de la
 * empresa. Aquí la autorización ya la dio SuperAdminGuard; lo que se conserva
 * intacto es la regla de negocio que no depende de quién llama:
 *
 *   Anti-lockout: la empresa debe conservar al menos un OWNER ACTIVE.
 *   Violarla responde 409 CONFLICT (el UI lo muestra como conflicto de estado).
 *
 * Misma serialización que MembershipService: `SELECT ... FOR UPDATE` sobre la
 * fila del Tenant al inicio de cada mutación.
 *
 * Auditoría: mismos nombres de acción que el flujo tenant-scoped
 * (user.role_changed, user.removed, user.invitation_revoked) más
 * `metadata.via = "super-admin"` para distinguir el origen; actorId es el
 * super-admin que hizo la petición.
 */
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { MembershipStatus, Prisma, Role } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service.js";
import { InviteService } from "../auth/invite.service.js";
import { InvitationMailer } from "../auth/invitation-mailer.service.js";
import type { AdminMembershipStatus } from "./super-admin.dto.js";

export const OWNER_INVARIANT_MESSAGE = "La empresa debe conservar al menos un propietario activo";

const MEMBERSHIP_ROW_SELECT = {
  id: true,
  tenantId: true,
  userId: true,
  role: true,
  status: true,
  joinedAt: true,
  createdAt: true,
  updatedAt: true,
  version: true,
  user: { select: { id: true, email: true, fullName: true, isSuperAdmin: true, createdAt: true } },
} satisfies Prisma.MembershipSelect;

export interface PlatformActor {
  /** Usuario super-admin que ejecuta la acción (RequestContext.userId). */
  userId?: string;
}

@Injectable()
export class SuperAdminMembershipService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly invites: InviteService,
    private readonly mailer: InvitationMailer,
  ) {}

  // -------------------------------------------------------------------------
  // Invitaciones
  // -------------------------------------------------------------------------

  async invite(input: {
    tenantId: string;
    actor: PlatformActor;
    email: string;
    fullName: string;
    role: Role;
  }): Promise<{ token: string; expiresAt: Date }> {
    const tenant = await this.requireTenant(input.tenantId);
    const email = input.email.toLowerCase().trim();

    const active = await this.prisma.membership.findFirst({
      where: { tenantId: tenant.id, status: "ACTIVE", user: { email } },
      select: { id: true },
    });
    if (active) {
      throw new ConflictException({
        code: "CONFLICT",
        message: "Ese correo ya es miembro activo de la empresa",
      });
    }

    const result = await this.invites.createInvite({
      tenantId: tenant.id,
      email,
      fullName: input.fullName,
      role: input.role,
    });

    await this.prisma.auditLog.create({
      data: {
        tenantId: tenant.id,
        actorId: input.actor.userId,
        action: "user.invitation_sent",
        targetType: "Invitation",
        metadata: { email, role: input.role, via: "super-admin" },
      },
    });

    await this.mailer.sendBestEffort({
      tenant,
      email,
      fullName: input.fullName,
      role: input.role,
      token: result.token,
      expiresAt: result.expiresAt,
    });

    return result;
  }

  async revokeInvitation(input: {
    tenantId: string;
    actor: PlatformActor;
    invitationId: string;
  }): Promise<{ id: string }> {
    await this.requireTenant(input.tenantId);
    return this.prisma.$transaction(async (tx) => {
      await this.lockTenant(tx, input.tenantId);
      const invitation = await tx.invitation.findFirst({
        where: { id: input.invitationId, tenantId: input.tenantId },
        select: { id: true, email: true, role: true, acceptedAt: true },
      });
      if (!invitation) {
        throw new NotFoundException({ code: "NOT_FOUND", message: "Invitación no encontrada" });
      }
      if (invitation.acceptedAt) {
        throw new BadRequestException({
          code: "RULE_VIOLATION",
          message:
            "La invitación ya fue aceptada. Quita a la persona desde la lista de miembros.",
        });
      }
      // Sin columna revokedAt: se caduca el enlace (acceptInvite rechaza expiresAt <= now).
      await tx.invitation.update({
        where: { id: invitation.id },
        data: { expiresAt: new Date(0) },
      });
      await tx.auditLog.create({
        data: {
          tenantId: input.tenantId,
          actorId: input.actor.userId,
          action: "user.invitation_revoked",
          targetType: "Invitation",
          targetId: invitation.id,
          metadata: { email: invitation.email, role: invitation.role, via: "super-admin" },
        },
      });
      return { id: invitation.id };
    });
  }

  // -------------------------------------------------------------------------
  // Membresías
  // -------------------------------------------------------------------------

  async updateMembership(input: {
    tenantId: string;
    actor: PlatformActor;
    membershipId: string;
    role?: Role;
    status?: AdminMembershipStatus;
  }) {
    if (input.role === undefined && input.status === undefined) {
      throw new BadRequestException({
        code: "VALIDATION_FAILED",
        message: "Indica role y/o status",
      });
    }
    await this.requireTenant(input.tenantId);

    return this.prisma.$transaction(async (tx) => {
      await this.lockTenant(tx, input.tenantId);
      const target = await this.requireMembership(tx, input.tenantId, input.membershipId);

      const nextRole: Role = input.role ?? target.role;
      const nextStatus: MembershipStatus = input.status ?? target.status;
      const roleChanged = nextRole !== target.role;
      const statusChanged = nextStatus !== target.status;
      if (!roleChanged && !statusChanged) return target;

      await this.assertOwnerInvariant(tx, target, nextRole, nextStatus);

      const updated = await tx.membership.update({
        where: { id: target.id },
        data: { role: nextRole, status: nextStatus, version: { increment: 1 } },
        select: MEMBERSHIP_ROW_SELECT,
      });

      if (statusChanged && nextStatus === "DISABLED") {
        await this.revokeSessions(tx, input.tenantId, target.userId);
      }

      const base = {
        tenantId: input.tenantId,
        actorId: input.actor.userId,
        targetType: "Membership",
        targetId: target.id,
      };
      if (roleChanged) {
        await tx.auditLog.create({
          data: {
            ...base,
            action: "user.role_changed",
            metadata: {
              userId: target.userId,
              email: target.user.email,
              fromRole: target.role,
              toRole: nextRole,
              via: "super-admin",
            },
          },
        });
      }
      if (statusChanged) {
        await tx.auditLog.create({
          data: {
            ...base,
            action: nextStatus === "DISABLED" ? "user.removed" : "user.reactivated",
            metadata: {
              userId: target.userId,
              email: target.user.email,
              role: nextRole,
              fromStatus: target.status,
              toStatus: nextStatus,
              via: "super-admin",
            },
          },
        });
      }

      return updated;
    });
  }

  /** Quitar = transición a DISABLED (mismo contrato que /iam/memberships DELETE). */
  async removeMembership(input: {
    tenantId: string;
    actor: PlatformActor;
    membershipId: string;
  }): Promise<{ id: string; status: "DISABLED" }> {
    await this.requireTenant(input.tenantId);
    return this.prisma.$transaction(async (tx) => {
      await this.lockTenant(tx, input.tenantId);
      const target = await this.requireMembership(tx, input.tenantId, input.membershipId);
      if (target.status === "DISABLED") {
        // Idempotente: DELETE sobre algo ya deshabilitado no es un error.
        return { id: target.id, status: "DISABLED" as const };
      }

      await this.assertOwnerInvariant(tx, target, target.role, "DISABLED");

      await tx.membership.update({
        where: { id: target.id },
        data: { status: "DISABLED", version: { increment: 1 } },
      });
      await this.revokeSessions(tx, input.tenantId, target.userId);
      await tx.auditLog.create({
        data: {
          tenantId: input.tenantId,
          actorId: input.actor.userId,
          action: "user.removed",
          targetType: "Membership",
          targetId: target.id,
          metadata: {
            userId: target.userId,
            email: target.user.email,
            role: target.role,
            via: "super-admin",
          },
        },
      });
      return { id: target.id, status: "DISABLED" as const };
    });
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private async requireTenant(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) {
      throw new NotFoundException({ code: "NOT_FOUND", message: "Tenant no encontrado" });
    }
    return tenant;
  }

  private async requireMembership(
    tx: Prisma.TransactionClient,
    tenantId: string,
    membershipId: string,
  ) {
    const target = await tx.membership.findFirst({
      where: { id: membershipId, tenantId },
      select: MEMBERSHIP_ROW_SELECT,
    });
    if (!target) {
      throw new NotFoundException({ code: "NOT_FOUND", message: "Membresía no encontrada" });
    }
    return target;
  }

  /**
   * Si el objetivo es hoy un OWNER ACTIVE y dejaría de serlo (cambio de rol o
   * de estado), tiene que quedar otro OWNER ACTIVE en la empresa.
   */
  private async assertOwnerInvariant(
    tx: Prisma.TransactionClient,
    target: { id: string; tenantId: string; role: Role; status: MembershipStatus },
    nextRole: Role,
    nextStatus: MembershipStatus,
  ): Promise<void> {
    const isActiveOwner = target.role === "OWNER" && target.status === "ACTIVE";
    const staysActiveOwner = nextRole === "OWNER" && nextStatus === "ACTIVE";
    if (!isActiveOwner || staysActiveOwner) return;

    const others = await tx.membership.count({
      where: { tenantId: target.tenantId, role: "OWNER", status: "ACTIVE", id: { not: target.id } },
    });
    if (others === 0) {
      throw new ConflictException({ code: "CONFLICT", message: OWNER_INVARIANT_MESSAGE });
    }
  }

  /** Bloquea la fila del tenant: serializa las mutaciones de membresía. */
  private async lockTenant(tx: Prisma.TransactionClient, tenantId: string): Promise<void> {
    await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id = ${tenantId}::uuid FOR UPDATE`;
  }

  /** Higiene al deshabilitar: las sesiones vivas del usuario en el tenant se cortan ya. */
  private async revokeSessions(
    tx: Prisma.TransactionClient,
    tenantId: string,
    userId: string,
  ): Promise<void> {
    await tx.session.updateMany({
      where: { tenantId, userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
