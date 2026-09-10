/**
 * Alta de tenants nuevos desde /super-admin. Extrae el patrón de
 * prisma/seed.ts (tenant + owner + membership) a un servicio reusable, para
 * no duplicar esa lógica entre el script de seed y el endpoint real.
 *
 * No fija contraseña: el owner nuevo se invita (mismo flujo de
 * accept-invite que ya usan las invitaciones normales), así nunca hay una
 * contraseña de demo circulando para un tenant real.
 */
import { BadRequestException, ConflictException, Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import { InviteService } from "../auth/invite.service.js";

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,48}[a-z0-9])?$/;

@Injectable()
export class TenantProvisioningService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly invites: InviteService,
  ) {}

  async createTenant(input: {
    name: string;
    slug: string;
    ownerEmail: string;
    ownerFullName: string;
  }): Promise<{ tenantId: string; slug: string; inviteToken: string; inviteExpiresAt: Date }> {
    const slug = input.slug.trim().toLowerCase();
    if (!SLUG_RE.test(slug)) {
      throw new BadRequestException({
        code: "VALIDATION_FAILED",
        message: "slug solo admite minúsculas, números y guion, 2-50 caracteres",
      });
    }

    const existing = await this.prisma.tenant.findUnique({ where: { slug } });
    if (existing) {
      throw new ConflictException({ code: "CONFLICT", message: "Ese slug ya está en uso" });
    }

    const tenant = await this.prisma.tenant.create({
      data: { slug, name: input.name.trim() },
    });

    const invite = await this.invites.createInvite({
      tenantId: tenant.id,
      email: input.ownerEmail.toLowerCase().trim(),
      fullName: input.ownerFullName.trim(),
      role: "OWNER",
    });

    return {
      tenantId: tenant.id,
      slug: tenant.slug,
      inviteToken: invite.token,
      inviteExpiresAt: invite.expiresAt,
    };
  }
}
