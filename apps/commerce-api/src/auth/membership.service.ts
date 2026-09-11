/**
 * Membresías del tenant: listar, cambiar rol, remover y revocar invitaciones.
 * Ver docs/03-iam.md T-IAM-04.
 *
 * Reglas duras (se aplican SIEMPRE aquí, el UI solo las repite por cortesía):
 *
 *  1. Autorización: el llamador necesita el scope `users.manage` (OWNER, ADMIN)
 *     — igual que el resto de endpoints de /iam. Además el rol se relee de la
 *     membresía viva, no del principal de la sesión: alguien degradado a mitad
 *     de sesión pierde el permiso en la siguiente petición.
 *  2. Solo un rol con `tenant.admin` (es decir OWNER, según policies.ts) puede
 *     otorgar o retirar el rol OWNER. Un ADMIN no puede fabricar propietarios.
 *  3. Nadie cambia su propio rol ni se remueve a sí mismo.
 *  4. Anti-lockout: el tenant nunca puede quedarse sin OWNER ACTIVE.
 *
 * Concurrencia: cada mutación corre dentro de una transacción que primero toma
 * `SELECT ... FOR UPDATE` sobre la fila del Tenant. Eso serializa todas las
 * mutaciones de membresía de un mismo tenant, así que dos degradaciones
 * simultáneas de dos OWNERs distintos no pueden pasar ambas el conteo.
 */

import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { Prisma, Role } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service.js";
import { ROLE_SCOPES, roleHas } from "./policies.js";

/** Roles válidos, tomados de la matriz normativa (una sola fuente de verdad). */
export const ASSIGNABLE_ROLES = Object.keys(ROLE_SCOPES) as Role[];

export interface MembershipActor {
  userId: string;
  role: string;
}

/**
 * Fila de la lista de personas del tenant. Une membresías reales con las
 * invitaciones pendientes (que todavía no tienen Membership) para que el portal
 * muestre una sola tabla. `kind` dice sobre qué recurso actúan las acciones.
 */
export interface MemberRow {
  id: string;
  kind: "MEMBERSHIP" | "INVITATION";
  userId: string | null;
  fullName: string;
  email: string;
  role: Role;
  status: "ACTIVE" | "INVITED" | "DISABLED";
  isSelf: boolean;
  joinedAt: Date | null;
  createdAt: Date;
  /** Solo invitaciones: cuándo caduca el enlace. */
  expiresAt: Date | null;
  /** Activo como agente de WhatsApp: puede tomar/recibir hilos transferidos. Invitaciones: siempre false. */
  isAgent: boolean;
}

const STATUS_ORDER: Record<string, number> = { ACTIVE: 0, INVITED: 1, DISABLED: 2 };

@Injectable()
export class MembershipService {
  constructor(private readonly prisma: PrismaService) {}

  // -------------------------------------------------------------------------
  // Lectura
  // -------------------------------------------------------------------------

  async list(tenantId: string, selfUserId?: string): Promise<MemberRow[]> {
    const memberships = await this.prisma.membership.findMany({
      where: { tenantId },
      select: {
        id: true,
        userId: true,
        role: true,
        status: true,
        isAgent: true,
        joinedAt: true,
        createdAt: true,
        // Selección explícita: nunca passwordHash, totpSecret ni recoveryCodesHash.
        user: { select: { email: true, fullName: true } },
      },
      orderBy: { createdAt: "asc" },
    });

    const invitations = await this.prisma.invitation.findMany({
      where: { tenantId, acceptedAt: null, expiresAt: { gt: new Date() } },
      // Sin tokenHash: el token nunca sale del backend después de crearse.
      select: {
        id: true,
        email: true,
        fullName: true,
        role: true,
        createdAt: true,
        expiresAt: true,
      },
      orderBy: { createdAt: "asc" },
    });

    const memberEmails = new Set(memberships.map((m) => m.user.email.toLowerCase()));

    const rows: MemberRow[] = [
      ...memberships.map((m) => ({
        id: m.id,
        kind: "MEMBERSHIP" as const,
        userId: m.userId,
        fullName: m.user.fullName,
        email: m.user.email,
        role: m.role,
        status: m.status,
        isSelf: Boolean(selfUserId) && m.userId === selfUserId,
        joinedAt: m.joinedAt,
        createdAt: m.createdAt,
        expiresAt: null,
        isAgent: m.isAgent,
      })),
      // Una invitación cuyo correo ya es miembro es ruido (p.ej. la que emite el
      // bootstrap para el owner): no se lista.
      ...invitations
        .filter((i) => !memberEmails.has(i.email.toLowerCase()))
        .map((i) => ({
          id: i.id,
          kind: "INVITATION" as const,
          userId: null,
          fullName: i.fullName,
          email: i.email,
          role: i.role,
          status: "INVITED" as const,
          isSelf: false,
          joinedAt: null,
          createdAt: i.createdAt,
          expiresAt: i.expiresAt,
          isAgent: false,
        })),
    ];

    return rows.sort(
      (a, b) =>
        (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9) ||
        a.fullName.localeCompare(b.fullName, "es-MX"),
    );
  }

  // -------------------------------------------------------------------------
  // Cambio de rol
  // -------------------------------------------------------------------------

  async changeRole(input: {
    tenantId: string;
    actor: MembershipActor;
    membershipId: string;
    role: string;
  }): Promise<MemberRow> {
    const nextRole = this.parseRole(input.role);

    return this.prisma.$transaction(async (tx) => {
      await this.lockTenant(tx, input.tenantId);
      const actorRole = await this.assertCanManage(tx, input.tenantId, input.actor);

      const target = await tx.membership.findFirst({
        where: { id: input.membershipId, tenantId: input.tenantId },
        select: {
          id: true,
          userId: true,
          role: true,
          status: true,
          joinedAt: true,
          createdAt: true,
          user: { select: { email: true, fullName: true } },
        },
      });
      if (!target) {
        throw new NotFoundException({
          code: "NOT_FOUND",
          message: "Membresía no encontrada",
        });
      }

      // Anti-escalada: nadie toca su propio rol (ni para subir ni para bajar).
      if (target.userId === input.actor.userId) {
        throw new ForbiddenException({
          code: "FORBIDDEN",
          message: "No puedes cambiar tu propio rol. Pídeselo a otro propietario.",
        });
      }

      // Otorgar o retirar OWNER es administrar el tenant: exige `tenant.admin`.
      if (target.role === "OWNER" || nextRole === "OWNER") {
        this.assertTenantAdmin(actorRole);
      }

      if (target.role === nextRole) {
        return this.rowOf(target, input.actor.userId);
      }

      // Anti-lockout: no dejar el tenant sin propietarios activos.
      if (target.role === "OWNER" && target.status === "ACTIVE") {
        await this.assertAnotherActiveOwner(tx, input.tenantId, target.id);
      }

      const updated = await tx.membership.update({
        where: { id: target.id },
        data: { role: nextRole, version: { increment: 1 } },
        select: {
          id: true,
          userId: true,
          role: true,
          status: true,
          joinedAt: true,
          createdAt: true,
          user: { select: { email: true, fullName: true } },
        },
      });

      await tx.auditLog.create({
        data: {
          tenantId: input.tenantId,
          actorId: input.actor.userId,
          action: "user.role_changed",
          targetType: "Membership",
          targetId: target.id,
          metadata: {
            userId: target.userId,
            email: target.user.email,
            fromRole: target.role,
            toRole: nextRole,
          },
        },
      });

      return this.rowOf(updated, input.actor.userId);
    });
  }

  // -------------------------------------------------------------------------
  // Remoción (transición a DISABLED, no borrado)
  // -------------------------------------------------------------------------

  async remove(input: {
    tenantId: string;
    actor: MembershipActor;
    membershipId: string;
  }): Promise<{ id: string; status: "DISABLED" }> {
    return this.prisma.$transaction(async (tx) => {
      await this.lockTenant(tx, input.tenantId);
      const actorRole = await this.assertCanManage(tx, input.tenantId, input.actor);

      const target = await tx.membership.findFirst({
        where: { id: input.membershipId, tenantId: input.tenantId },
        select: {
          id: true,
          userId: true,
          role: true,
          status: true,
          user: { select: { email: true } },
        },
      });
      if (!target) {
        throw new NotFoundException({
          code: "NOT_FOUND",
          message: "Membresía no encontrada",
        });
      }

      if (target.userId === input.actor.userId) {
        throw new ForbiddenException({
          code: "FORBIDDEN",
          message:
            "No puedes quitarte a ti mismo del portal. Pídele a otro propietario que lo haga.",
        });
      }

      if (target.role === "OWNER") {
        this.assertTenantAdmin(actorRole);
      }

      if (target.status === "DISABLED") {
        // Idempotente: DELETE sobre algo ya deshabilitado no es un error.
        return { id: target.id, status: "DISABLED" as const };
      }

      if (target.role === "OWNER" && target.status === "ACTIVE") {
        await this.assertAnotherActiveOwner(tx, input.tenantId, target.id);
      }

      await tx.membership.update({
        where: { id: target.id },
        data: { status: "DISABLED", version: { increment: 1 } },
      });

      // Higiene: las sesiones vivas del usuario en este tenant se cortan ya.
      // (resolveSession ya exige status ACTIVE, esto solo limpia las filas.)
      await tx.session.updateMany({
        where: { tenantId: input.tenantId, userId: target.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });

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
          },
        },
      });

      return { id: target.id, status: "DISABLED" as const };
    });
  }

  // -------------------------------------------------------------------------
  // Revocar invitación pendiente
  // -------------------------------------------------------------------------

  async revokeInvitation(input: {
    tenantId: string;
    actor: MembershipActor;
    invitationId: string;
  }): Promise<{ id: string }> {
    return this.prisma.$transaction(async (tx) => {
      await this.lockTenant(tx, input.tenantId);
      const actorRole = await this.assertCanManage(tx, input.tenantId, input.actor);

      const invitation = await tx.invitation.findFirst({
        where: { id: input.invitationId, tenantId: input.tenantId },
        select: {
          id: true,
          email: true,
          role: true,
          acceptedAt: true,
          expiresAt: true,
        },
      });
      if (!invitation) {
        throw new NotFoundException({
          code: "NOT_FOUND",
          message: "Invitación no encontrada",
        });
      }
      if (invitation.acceptedAt) {
        throw new BadRequestException({
          code: "RULE_VIOLATION",
          message:
            "La invitación ya fue aceptada. Quita a la persona desde la lista de miembros.",
        });
      }
      if (invitation.role === "OWNER") {
        this.assertTenantAdmin(actorRole);
      }

      // No hay columna revokedAt en Invitation: se caduca el enlace. acceptInvite
      // rechaza cualquier token con expiresAt <= now, así que el token muere aquí.
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
          metadata: { email: invitation.email, role: invitation.role },
        },
      });

      return { id: invitation.id };
    });
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private parseRole(role: string): Role {
    if (!ASSIGNABLE_ROLES.includes(role as Role)) {
      throw new BadRequestException({
        code: "VALIDATION_FAILED",
        message: `Rol inválido: ${role}`,
      });
    }
    return role as Role;
  }

  /** Bloquea la fila del tenant: serializa las mutaciones de membresía. */
  private async lockTenant(tx: Prisma.TransactionClient, tenantId: string): Promise<void> {
    await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id = ${tenantId}::uuid FOR UPDATE`;
  }

  /**
   * Relee la membresía del llamador y verifica `users.manage`. El RoleGuard ya
   * filtró por scope, pero el guard mira el rol de la sesión: esto lo confirma
   * contra la fila viva y bloquea a un miembro deshabilitado.
   */
  private async assertCanManage(
    tx: Prisma.TransactionClient,
    tenantId: string,
    actor: MembershipActor,
  ): Promise<string> {
    const membership = await tx.membership.findUnique({
      where: { tenantId_userId: { tenantId, userId: actor.userId } },
      select: { role: true, status: true },
    });
    if (!membership || membership.status !== "ACTIVE") {
      throw new ForbiddenException({
        code: "FORBIDDEN",
        message: "Tu acceso a este tenant no está activo",
      });
    }
    if (!roleHas(membership.role, "users.manage")) {
      throw new ForbiddenException({
        code: "FORBIDDEN",
        message: "Faltan scopes: users.manage",
      });
    }
    return membership.role;
  }

  private assertTenantAdmin(actorRole: string): void {
    if (!roleHas(actorRole, "tenant.admin")) {
      throw new ForbiddenException({
        code: "FORBIDDEN",
        message: "Solo un propietario puede otorgar o retirar el rol Propietario.",
      });
    }
  }

  private async assertAnotherActiveOwner(
    tx: Prisma.TransactionClient,
    tenantId: string,
    exceptMembershipId: string,
  ): Promise<void> {
    const others = await tx.membership.count({
      where: {
        tenantId,
        role: "OWNER",
        status: "ACTIVE",
        id: { not: exceptMembershipId },
      },
    });
    if (others === 0) {
      throw new BadRequestException({
        code: "RULE_VIOLATION",
        message:
          "El tenant no puede quedarse sin propietarios activos. Nombra a otro propietario antes de continuar.",
      });
    }
  }

  private rowOf(
    m: {
      id: string;
      userId: string;
      role: Role;
      status: MemberRow["status"];
      joinedAt: Date;
      createdAt: Date;
      user: { email: string; fullName: string };
      isAgent?: boolean;
    },
    selfUserId: string,
  ): MemberRow {
    return {
      id: m.id,
      kind: "MEMBERSHIP",
      userId: m.userId,
      fullName: m.user.fullName,
      email: m.user.email,
      role: m.role,
      status: m.status,
      isSelf: m.userId === selfUserId,
      joinedAt: m.joinedAt,
      createdAt: m.createdAt,
      expiresAt: null,
      isAgent: m.isAgent ?? false,
    };
  }

  // -------------------------------------------------------------------------
  // Agente de WhatsApp (bandeja de conversaciones)
  // -------------------------------------------------------------------------

  /**
   * Activa/desactiva a una persona como agente de WhatsApp. No es una
   * escalada de privilegios (no toca `role`), así que no aplican las reglas
   * de anti-lockout ni "no te toques a ti mismo": cualquier membresía activa
   * se puede marcar, incluida la propia.
   */
  async setAgent(input: {
    tenantId: string;
    actor: MembershipActor;
    membershipId: string;
    isAgent: boolean;
  }): Promise<MemberRow> {
    return this.prisma.$transaction(async (tx) => {
      await this.assertCanManage(tx, input.tenantId, input.actor);

      const target = await tx.membership.findFirst({
        where: { id: input.membershipId, tenantId: input.tenantId },
        select: {
          id: true,
          userId: true,
          role: true,
          status: true,
          joinedAt: true,
          createdAt: true,
          user: { select: { email: true, fullName: true } },
        },
      });
      if (!target) {
        throw new NotFoundException({
          code: "NOT_FOUND",
          message: "Membresía no encontrada",
        });
      }

      const updated = await tx.membership.update({
        where: { id: target.id },
        data: { isAgent: input.isAgent, version: { increment: 1 } },
        select: {
          id: true,
          userId: true,
          role: true,
          status: true,
          isAgent: true,
          joinedAt: true,
          createdAt: true,
          user: { select: { email: true, fullName: true } },
        },
      });

      await tx.auditLog.create({
        data: {
          tenantId: input.tenantId,
          actorId: input.actor.userId,
          action: input.isAgent ? "user.agent_activated" : "user.agent_deactivated",
          targetType: "Membership",
          targetId: target.id,
          metadata: { userId: target.userId, email: target.user.email },
        },
      });

      return this.rowOf(updated, input.actor.userId);
    });
  }
}
