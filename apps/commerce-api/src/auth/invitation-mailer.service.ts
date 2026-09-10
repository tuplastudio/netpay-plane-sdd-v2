/**
 * Correo de invitación al portal. Extraído de ApiKeyController.inviteUser para
 * que el flujo de /iam y el de /super-admin manden exactamente el mismo correo
 * (misma plantilla, mismo enlace de aceptación) sin duplicar la lógica.
 *
 * Best-effort a propósito: si Resend falla, la invitación ya quedó creada y el
 * admin igual puede copiar el enlace desde el panel (fallback en la UI).
 */
import { Injectable } from "@nestjs/common";
import type { Role } from "@prisma/client";
import { EmailService } from "../email/email.service.js";

export const INVITE_ROLE_LABELS: Record<string, string> = {
  OWNER: "Propietario",
  ADMIN: "Administrador",
  VENDOR: "Vendedor",
  FINANCE: "Finanzas",
  CATALOG: "Catálogo",
  SUPPORT: "Soporte",
  VIEWER: "Lector",
};

export interface InvitationMailInput {
  tenant: { name: string; primaryColor: string; accentColor: string };
  email: string;
  fullName: string;
  role: Role | string;
  token: string;
  expiresAt: Date;
}

@Injectable()
export class InvitationMailer {
  constructor(private readonly email: EmailService) {}

  acceptUrl(token: string): string {
    const base = (process.env.PUBLIC_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
    return `${base}/accept-invite?token=${encodeURIComponent(token)}`;
  }

  /** Nunca lanza: el envío es best-effort (ver cabecera del archivo). */
  async sendBestEffort(input: InvitationMailInput): Promise<void> {
    await this.email
      .send({
        to: input.email,
        subject: `Te invitaron a ${input.tenant.name}`,
        template: "invitation",
        vars: {
          tenantName: input.tenant.name,
          fullName: input.fullName,
          roleLabel: INVITE_ROLE_LABELS[input.role] ?? input.role,
          acceptUrl: this.acceptUrl(input.token),
          expiresAt: input.expiresAt.toLocaleDateString("es-MX", {
            day: "numeric",
            month: "long",
            year: "numeric",
          }),
          primaryColor: input.tenant.primaryColor,
          accentColor: input.tenant.accentColor,
        },
      })
      .catch(() => undefined);
  }
}
