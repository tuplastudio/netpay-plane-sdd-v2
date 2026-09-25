/**
 * Notifications service. Ver docs/14-ntf.md T-NTF-01..06.
 *
 * - Persiste Notification con status PENDING/SENT/DELIVERED/FAILED.
 * - Registra timeline (NotificationTimeline) por aggregate.
 * - Aplica política 09:00–19:00 local, opt-out respetado (consent.WHATSAPP).
 * - Backoff exponencial en reintentos (T-NTF-03).
 * - Reportes por cohorte (T-NTF-05) y export CSV (T-NTF-06).
 */

import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import { WhatsAppService } from "../whatsapp/whatsapp.service.js";
import { EmailService } from "../email/email.service.js";
import { renderTemplate, type TemplateKey } from "./notification-templates.js";
import { resolveApprovedTemplate } from "./whatsapp-template-map.js";

/**
 * Escapa una celda CSV: previene inyección de fórmulas (Excel/Sheets
 * ejecutan =, +, -, @ al inicio de celda) y aplica quoting estándar si
 * el valor trae coma, comilla o salto de línea.
 */
function csvField(value: string): string {
  let v = value;
  if (/^[=+\-@]/.test(v)) v = `'${v}`;
  if (/[",\n]/.test(v)) v = `"${v.replace(/"/g, '""')}"`;
  return v;
}

/** Motivo con el que se cancela una notificación fuera de ventana. */
export const WINDOW_CLOSED_REASON =
  "Ventana de 24 h de Meta cerrada: se requiere una plantilla aprobada para este mensaje";

export interface ScheduleInput {
  tenantId: string;
  recipientType: "CUSTOMER" | "USER";
  recipientId: string;
  channel: "EMAIL" | "WHATSAPP" | "SMS" | "PUSH";
  templateKey: string;
  payload: Record<string, unknown>;
  scheduledAt?: Date;
}

@Injectable()
export class NotificationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationService.name);
  private dispatchTimer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly whatsapp: WhatsAppService,
    private readonly email: EmailService,
  ) {}

  onModuleInit(): void {
    // Sin @nestjs/schedule en el proyecto: barrido simple cada 30s,
    // igual de "en memoria" que RateLimitService. Suficiente para V2.
    this.dispatchTimer = setInterval(() => {
      this.dispatchPending().catch((err) =>
        this.logger.error(`dispatchPending failed: ${String(err)}`),
      );
    }, 30_000);
  }

  onModuleDestroy(): void {
    if (this.dispatchTimer) clearInterval(this.dispatchTimer);
  }

  /** Construye y encola una notificación ya renderizada desde una plantilla. */
  async scheduleFromTemplate(input: {
    tenantId: string;
    recipientType: "CUSTOMER" | "USER";
    recipientId: string;
    channel: "EMAIL" | "WHATSAPP" | "SMS" | "PUSH";
    templateKey: TemplateKey;
    vars: Record<string, string>;
    to: string;
    scheduledAt?: Date;
  }) {
    // `businessName` lo pone el servicio, no cada caller: Meta exige que el
    // mensaje diga de parte de quién va, y así ninguna plantilla se queda sin
    // él por olvido en un caller nuevo.
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: input.tenantId },
      select: { name: true },
    });
    const body = renderTemplate(input.templateKey, {
      businessName: tenant?.name ?? "",
      ...input.vars,
    });
    return this.schedule({
      tenantId: input.tenantId,
      recipientType: input.recipientType,
      recipientId: input.recipientId,
      channel: input.channel,
      templateKey: input.templateKey,
      payload: { to: input.to, body },
      scheduledAt: input.scheduledAt,
    });
  }

  /**
   * T-NTF-02/03: recorre PENDING vencidas y las envía. WHATSAPP usa el canal
   * real (Meta/Evolution); otros canales no tienen proveedor en este
   * proyecto (no hay SMTP/SMS) y se registran como simulados, igual que
   * PAYMENT_PROVIDER=DUMMY — no hay envío real, sí trazabilidad real.
   */
  async dispatchPending(limit = 25): Promise<void> {
    const due = await this.prisma.notification.findMany({
      where: { status: "PENDING", scheduledAt: { lte: new Date() } },
      orderBy: { scheduledAt: "asc" },
      take: limit,
      include: { tenant: true },
    });

    for (const n of due) {
      if (!this.isWithinSendWindow(n.tenant.timezone)) {
        // Fuera de 09-19 local: reintentar en la próxima pasada, no es un fallo.
        continue;
      }
      const payload = n.payload as { to?: string; body?: string };
      try {
        if (n.channel === "WHATSAPP") {
          if (!payload.to || !payload.body) {
            throw new Error("payload incompleto (to/body)");
          }
          // Política de Meta: el texto libre solo vale dentro de la ventana
          // de servicio de 24 h. Fuera de ella, el mensaje que inicia el
          // negocio tiene que ser una plantilla aprobada; si el tenant no
          // configuró una para esta clave, la notificación se cancela con el
          // motivo a la vista en vez de salir violando la política (y, con
          // Meta Cloud API, en vez de reintentar cinco veces un 131047).
          const insideWindow = await this.whatsapp.canSendFreeForm(n.tenantId, payload.to);
          const approved = insideWindow
            ? null
            : resolveApprovedTemplate(n.tenant.whatsappTemplates, n.templateKey);
          if (!insideWindow && !approved) {
            await this.cancel(n.id, WINDOW_CLOSED_REASON);
            await this.recordTimeline({
              tenantId: n.tenantId,
              subjectType: n.recipientType,
              subjectId: n.recipientId,
              eventType: `notification.${n.templateKey}.blocked_outside_window`,
            });
            continue;
          }
          const result = await this.whatsapp.send(n.tenantId, {
            tenantId: n.tenantId,
            to: payload.to,
            type: approved ? "template" : "text",
            body: payload.body,
            templateName: approved?.name,
            templateLanguage: approved?.language,
            templateVars: approved ? { body: payload.body } : undefined,
          });
          if (result.status === "FAILED") {
            throw new Error(result.error ?? "envío falló");
          }
        } else if (n.channel === "EMAIL") {
          if (!payload.to || !payload.body) {
            throw new Error("payload incompleto (to/body)");
          }
          await this.email.send({
            to: payload.to,
            subject: n.tenant.name,
            template: "notification",
            vars: {
              tenantName: n.tenant.name,
              primaryColor: n.tenant.primaryColor,
              body: payload.body,
            },
          });
        } else {
          // Simulado: SMS/PUSH no tienen proveedor configurado en V2.
          this.logger.log(`[simulado] ${n.channel} a ${payload.to ?? "?"}: ${payload.body ?? ""}`);
        }
        await this.markSent(n.id);
        await this.recordTimeline({
          tenantId: n.tenantId,
          subjectType: n.recipientType,
          subjectId: n.recipientId,
          eventType: `notification.${n.templateKey}.sent`,
        });
      } catch (err) {
        const attempts = n.attempts + 1;
        if (attempts >= n.maxAttempts) {
          await this.markFailed(n.id, String(err));
        } else {
          await this.reschedule(n.id, attempts);
        }
      }
    }
  }

  private isWithinSendWindow(timezone: string): boolean {
    try {
      const hour = Number(
        new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "numeric", hour12: false }).format(
          new Date(),
        ),
      );
      return hour >= 9 && hour < 19;
    } catch {
      return true;
    }
  }

  /** T-NTF-01: encolar notificación. Si opt-out activo (WHATSAPP), se cancela. */
  async schedule(input: ScheduleInput) {
    if (input.channel === "WHATSAPP" && input.recipientType === "CUSTOMER") {
      const consent = await this.prisma.customerConsent.findUnique({
        where: { customerId_scope: { customerId: input.recipientId, scope: "WHATSAPP" } },
      });
      if (consent && !consent.granted) {
        return this.prisma.notification.create({
          data: {
            tenantId: input.tenantId,
            recipientType: input.recipientType,
            recipientId: input.recipientId,
            channel: input.channel,
            templateKey: input.templateKey,
            payload: input.payload as never,
            status: "CANCELLED",
            scheduledAt: input.scheduledAt ?? new Date(),
            lastError: "consent.WHATSAPP denied",
          },
        });
      }
    }
    return this.prisma.notification.create({
      data: {
        tenantId: input.tenantId,
        recipientType: input.recipientType,
        recipientId: input.recipientId,
        channel: input.channel,
        templateKey: input.templateKey,
        payload: input.payload as never,
        scheduledAt: input.scheduledAt ?? new Date(),
        maxAttempts: 5,
      },
    });
  }

  /** T-NTF-02: marcar como enviado + intentos. */
  async markSent(id: string) {
    return this.prisma.notification.update({
      where: { id },
      data: { status: "SENT", sentAt: new Date(), attempts: { increment: 1 } },
    });
  }

  async markDelivered(id: string) {
    return this.prisma.notification.update({
      where: { id },
      data: { status: "DELIVERED", deliveredAt: new Date() },
    });
  }

  /** Cancelada por política (no es un fallo de envío: no se reintenta). */
  async cancel(id: string, reason: string) {
    return this.prisma.notification.update({
      where: { id },
      data: { status: "CANCELLED", lastError: reason.slice(0, 500) },
    });
  }

  async markFailed(id: string, error: string) {
    return this.prisma.notification.update({
      where: { id },
      data: { status: "FAILED", failedAt: new Date(), lastError: error.slice(0, 500) },
    });
  }

  /** T-NTF-03: programar recuperación con backoff. */
  async reschedule(id: string, attemptsSoFar: number) {
    const delayMs = Math.min(2 ** attemptsSoFar * 60_000, 24 * 60 * 60 * 1000); // max 24h
    return this.prisma.notification.update({
      where: { id },
      data: {
        status: "PENDING",
        attempts: attemptsSoFar,
        scheduledAt: new Date(Date.now() + delayMs),
        lastError: `Retry ${attemptsSoFar} en ${Math.round(delayMs / 1000)}s`,
      },
    });
  }

  /** T-NTF-04: timeline por subject. */
  async recordTimeline(input: {
    tenantId: string;
    subjectType: string;
    subjectId: string;
    eventType: string;
    actorId?: string;
    metadata?: Record<string, unknown>;
  }) {
    return this.prisma.notificationTimeline.create({
      data: {
        tenantId: input.tenantId,
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        eventType: input.eventType,
        actorId: input.actorId,
        metadata: input.metadata as never,
      },
    });
  }

  async getTimeline(
    tenantId: string,
    subjectType: string,
    subjectId: string,
    limit = 50,
  ) {
    return this.prisma.notificationTimeline.findMany({
      where: { tenantId, subjectType, subjectId },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
  }

  /** T-NTF-05: reporte por cohorte (estado × canal). */
  async cohortReport(tenantId: string, sinceDays = 7) {
    const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);
    const rows = await this.prisma.notification.groupBy({
      by: ["channel", "status"],
      where: { tenantId, createdAt: { gte: since } },
      _count: true,
    });
    return rows.map((r) => ({
      channel: r.channel,
      status: r.status,
      count: r._count,
    }));
  }

  /** T-NTF-06: export CSV. */
  async exportCsv(tenantId: string): Promise<string> {
    const rows = await this.prisma.notification.findMany({
      where: { tenantId },
      orderBy: { createdAt: "asc" },
      take: 10_000,
    });
    const header = [
      "id",
      "recipientType",
      "recipientId",
      "channel",
      "templateKey",
      "status",
      "attempts",
      "scheduledAt",
      "sentAt",
      "deliveredAt",
      "failedAt",
      "lastError",
    ];
    const lines = [header.join(",")];
    for (const r of rows) {
      lines.push(
        [
          r.id,
          r.recipientType,
          r.recipientId,
          r.channel,
          r.templateKey,
          r.status,
          String(r.attempts),
          r.scheduledAt.toISOString(),
          r.sentAt?.toISOString() ?? "",
          r.deliveredAt?.toISOString() ?? "",
          r.failedAt?.toISOString() ?? "",
          r.lastError ?? "",
        ]
          .map(csvField)
          .join(","),
      );
    }
    return lines.join("\n");
  }

  async list(tenantId: string, status?: string) {
    return this.prisma.notification.findMany({
      where: { tenantId, ...(status ? { status: status as never } : {}) },
      orderBy: { scheduledAt: "desc" },
      take: 50,
    });
  }
}