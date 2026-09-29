/**
 * Reporte de atención de conversaciones (WhatsApp): volumen, tiempos y carga
 * por agente en un rango de fechas.
 *
 * Igual que `ReportsService`, todo se calcula en SQL sobre la tabla completa:
 * los listados del API están truncados y sumar filas en cliente describiría una
 * ventana, no el negocio. Los tiempos salen de los sellos que deja
 * `WhatsAppService` (`handoffAt`, `firstHumanReplyAt`, `closedAt`) y la
 * atribución por persona de `WhatsAppMessage.sentByUserId`.
 *
 * Los tiempos van en segundos (number | null): `null` = sin datos en el rango,
 * distinto de 0.
 */

import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service.js";

const DAY_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_ATTENTION_DAYS = 30;
export const MAX_ATTENTION_DAYS = 366;

export interface AttentionRange {
  from: Date;
  /** Exclusivo. */
  to: Date;
}

export interface AttentionAgentRow {
  userId: string;
  fullName: string;
  email: string;
  /** Sigue activo como agente (los que ya no lo son aparecen solo si tuvieron actividad). */
  active: boolean;
  /** Hilos que lleva asignados ahora mismo. */
  assignedNow: number;
  /** Hilos distintos en los que contestó dentro del rango. */
  handled: number;
  messagesSent: number;
  /** Promedio handoff → su primera respuesta, en los hilos donde fue el primero en contestar. */
  avgFirstReplySeconds: number | null;
  /** Hilos que cerró (como dueño al momento del cierre) dentro del rango. */
  closed: number;
  /** Promedio handoff → cierre, en los hilos que cerró dentro del rango. */
  avgResolutionSeconds: number | null;
}

export interface AttentionDayRow {
  day: string;
  newConversations: number;
  inbound: number;
  outboundHuman: number;
  outboundBot: number;
}

export interface AttentionReport {
  range: { from: Date; to: Date; timezone: string };
  overview: {
    newConversations: number;
    /** Hilos que pasaron a atención humana en el rango. */
    escalated: number;
    /** % de hilos nuevos que se escalaron (0–100), `null` sin hilos. */
    escalationRate: number | null;
    closed: number;
    /** Escalados en el rango que nadie ha contestado todavía. */
    unattended: number;
    avgFirstReplySeconds: number | null;
    medianFirstReplySeconds: number | null;
    avgResolutionSeconds: number | null;
    inbound: number;
    outboundHuman: number;
    outboundBot: number;
  };
  /** Foto de ahora mismo, no del rango. */
  now: {
    queue: number;
    /** Segundos que lleva esperando el más viejo de la cola. */
    oldestQueueWaitSeconds: number | null;
    /** Hilos abiertos cuyo último mensaje es del cliente. */
    awaitingReply: number;
    assigned: number;
  };
  agents: AttentionAgentRow[];
  byDay: AttentionDayRow[];
}

/** Rango por defecto y validación: `from < to`, tope de un año. */
export function resolveRange(
  from: Date | undefined,
  to: Date | undefined,
  now = new Date(),
): AttentionRange {
  const end = to ?? new Date(now.getTime() + 1);
  const start = from ?? new Date(end.getTime() - DEFAULT_ATTENTION_DAYS * DAY_MS);
  if (start >= end) throw new RangeError("`from` debe ser anterior a `to`");
  if (end.getTime() - start.getTime() > MAX_ATTENTION_DAYS * DAY_MS) {
    throw new RangeError(`El rango no puede pasar de ${MAX_ATTENTION_DAYS} días`);
  }
  return { from: start, to: end };
}

const num = (v: bigint | number | null | undefined): number => Number(v ?? 0);
const secs = (v: number | string | Prisma.Decimal | null | undefined): number | null =>
  v === null || v === undefined ? null : Math.round(Number(v));

interface OverviewRow {
  new_convs: bigint;
  escalated: bigint;
  closed: bigint;
  unattended: bigint;
  avg_first: number | null;
  median_first: number | null;
  avg_resolution: number | null;
}
interface MessagesRow {
  inbound: bigint;
  out_human: bigint;
  out_bot: bigint;
}
interface NowRow {
  queue: bigint;
  oldest_wait: number | null;
  awaiting: bigint;
  assigned: bigint;
}
interface AgentMsgRow {
  uid: string;
  msgs: bigint;
  convs: bigint;
}
interface AgentReplyRow {
  uid: string;
  avg_sec: number | null;
}
interface AgentClosedRow {
  uid: string;
  closed: bigint;
  avg_sec: number | null;
}
interface DayMsgRow {
  day: string;
  inbound: bigint;
  out_human: bigint;
  out_bot: bigint;
}
interface DayConvRow {
  day: string;
  n: bigint;
}

@Injectable()
export class AttentionReportService {
  constructor(private readonly prisma: PrismaService) {}

  async report(tenantId: string, range: AttentionRange): Promise<AttentionReport> {
    const { from, to } = range;
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { timezone: true },
    });
    const tz = tenant?.timezone || "America/Mexico_City";

    const [
      overview,
      messages,
      now,
      agentMsgs,
      agentReplies,
      agentClosed,
      dayMsgs,
      dayConvs,
      memberships,
      assignedNow,
    ] = await Promise.all([
        this.prisma.$queryRaw<OverviewRow[]>(Prisma.sql`
          SELECT
            COUNT(*) FILTER (WHERE c."createdAt" >= ${from} AND c."createdAt" < ${to}) AS new_convs,
            COUNT(*) FILTER (WHERE c."handoffAt" >= ${from} AND c."handoffAt" < ${to}) AS escalated,
            COUNT(*) FILTER (WHERE c."closedAt" >= ${from} AND c."closedAt" < ${to}) AS closed,
            COUNT(*) FILTER (
              WHERE c."handoffAt" >= ${from} AND c."handoffAt" < ${to}
                AND c."firstHumanReplyAt" IS NULL AND c."handoffToHuman" = true
            ) AS unattended,
            AVG(EXTRACT(EPOCH FROM (c."firstHumanReplyAt" - c."handoffAt")))
              FILTER (
                WHERE c."handoffAt" >= ${from} AND c."handoffAt" < ${to}
                  AND c."firstHumanReplyAt" >= c."handoffAt"
              ) AS avg_first,
            percentile_cont(0.5) WITHIN GROUP (
              ORDER BY EXTRACT(EPOCH FROM (c."firstHumanReplyAt" - c."handoffAt"))
            ) FILTER (
              WHERE c."handoffAt" >= ${from} AND c."handoffAt" < ${to}
                AND c."firstHumanReplyAt" >= c."handoffAt"
            ) AS median_first,
            AVG(EXTRACT(EPOCH FROM (c."closedAt" - c."createdAt")))
              FILTER (WHERE c."closedAt" >= ${from} AND c."closedAt" < ${to}) AS avg_resolution
          FROM "WhatsAppConversation" c
          WHERE c."tenantId" = ${tenantId}::uuid
        `),
        this.prisma.$queryRaw<MessagesRow[]>(Prisma.sql`
          SELECT
            COUNT(*) FILTER (WHERE m."direction" = 'INBOUND') AS inbound,
            COUNT(*) FILTER (WHERE m."direction" = 'OUTBOUND' AND m."sentByUserId" IS NOT NULL) AS out_human,
            COUNT(*) FILTER (WHERE m."direction" = 'OUTBOUND' AND m."sentByUserId" IS NULL) AS out_bot
          FROM "WhatsAppMessage" m
          WHERE m."tenantId" = ${tenantId}::uuid AND m."createdAt" >= ${from} AND m."createdAt" < ${to}
        `),
        this.prisma.$queryRaw<NowRow[]>(Prisma.sql`
          SELECT
            COUNT(*) FILTER (WHERE c."handoffToHuman" = true AND c."handoffUserId" IS NULL AND c."status" <> 'CLOSED') AS queue,
            EXTRACT(EPOCH FROM (now() - MIN(COALESCE(c."handoffAt", c."updatedAt"))
              FILTER (WHERE c."handoffToHuman" = true AND c."handoffUserId" IS NULL AND c."status" <> 'CLOSED'))) AS oldest_wait,
            COUNT(*) FILTER (
              WHERE c."status" <> 'CLOSED' AND (
                SELECT m."direction" FROM "WhatsAppMessage" m
                 WHERE m."conversationId" = c."id" ORDER BY m."createdAt" DESC LIMIT 1
              ) = 'INBOUND'
            ) AS awaiting,
            COUNT(*) FILTER (WHERE c."handoffToHuman" = true AND c."handoffUserId" IS NOT NULL AND c."status" <> 'CLOSED') AS assigned
          FROM "WhatsAppConversation" c
          WHERE c."tenantId" = ${tenantId}::uuid AND c."status" <> 'CLOSED'
        `),
        this.prisma.$queryRaw<AgentMsgRow[]>(Prisma.sql`
          SELECT m."sentByUserId"::text AS uid, COUNT(*) AS msgs, COUNT(DISTINCT m."conversationId") AS convs
          FROM "WhatsAppMessage" m
          WHERE m."tenantId" = ${tenantId}::uuid AND m."sentByUserId" IS NOT NULL
            AND m."createdAt" >= ${from} AND m."createdAt" < ${to}
          GROUP BY m."sentByUserId"
        `),
        this.prisma.$queryRaw<AgentReplyRow[]>(Prisma.sql`
          SELECT fm."sentByUserId"::text AS uid,
                 AVG(EXTRACT(EPOCH FROM (c."firstHumanReplyAt" - c."handoffAt"))) AS avg_sec
          FROM "WhatsAppConversation" c
          JOIN LATERAL (
            SELECT m."sentByUserId" FROM "WhatsAppMessage" m
             WHERE m."conversationId" = c."id" AND m."sentByUserId" IS NOT NULL
               AND m."createdAt" >= c."handoffAt"
             ORDER BY m."createdAt" ASC LIMIT 1
          ) fm ON true
          WHERE c."tenantId" = ${tenantId}::uuid
            AND c."handoffAt" >= ${from} AND c."handoffAt" < ${to}
            AND c."firstHumanReplyAt" >= c."handoffAt"
          GROUP BY fm."sentByUserId"
        `),
        // Resolución por agente: desde el handoff (cuando lo tomó) hasta el
        // cierre, solo hilos que él tenía asignados al momento de cerrarse.
        // Si se reasignó antes de cerrar, el cierre cuenta para quien lo
        // tenía al final — igual que `assignedNow` de arriba cuenta "carga
        // actual" por dueño actual, no por quien lo atendió en el camino.
        this.prisma.$queryRaw<AgentClosedRow[]>(Prisma.sql`
          SELECT c."handoffUserId"::text AS uid,
                 COUNT(*) AS closed,
                 AVG(EXTRACT(EPOCH FROM (c."closedAt" - c."handoffAt")))
                   FILTER (WHERE c."closedAt" >= c."handoffAt") AS avg_sec
          FROM "WhatsAppConversation" c
          WHERE c."tenantId" = ${tenantId}::uuid
            AND c."handoffUserId" IS NOT NULL
            AND c."closedAt" >= ${from} AND c."closedAt" < ${to}
          GROUP BY c."handoffUserId"
        `),
        this.prisma.$queryRaw<DayMsgRow[]>(Prisma.sql`
          SELECT to_char(m."createdAt" AT TIME ZONE ${tz}, 'YYYY-MM-DD') AS day,
                 COUNT(*) FILTER (WHERE m."direction" = 'INBOUND') AS inbound,
                 COUNT(*) FILTER (WHERE m."direction" = 'OUTBOUND' AND m."sentByUserId" IS NOT NULL) AS out_human,
                 COUNT(*) FILTER (WHERE m."direction" = 'OUTBOUND' AND m."sentByUserId" IS NULL) AS out_bot
          FROM "WhatsAppMessage" m
          WHERE m."tenantId" = ${tenantId}::uuid AND m."createdAt" >= ${from} AND m."createdAt" < ${to}
          GROUP BY 1
        `),
        this.prisma.$queryRaw<DayConvRow[]>(Prisma.sql`
          SELECT to_char(c."createdAt" AT TIME ZONE ${tz}, 'YYYY-MM-DD') AS day, COUNT(*) AS n
          FROM "WhatsAppConversation" c
          WHERE c."tenantId" = ${tenantId}::uuid AND c."createdAt" >= ${from} AND c."createdAt" < ${to}
          GROUP BY 1
        `),
        this.prisma.membership.findMany({
          where: { tenantId, status: "ACTIVE", isAgent: true },
          select: { userId: true },
        }),
        this.prisma.whatsAppConversation.groupBy({
          by: ["handoffUserId"],
          where: { tenantId, status: "HANDED_OFF", handoffUserId: { not: null } },
          _count: { _all: true },
        }),
      ]);

    const o = overview[0];
    const msg = messages[0];
    const nw = now[0];
    const newConvs = num(o?.new_convs);
    const escalated = num(o?.escalated);

    // Agentes: los activos hoy + quien tuvo actividad en el rango aunque ya no lo sea.
    const activeIds = new Set(memberships.map((m) => m.userId));
    const msgByUser = new Map(agentMsgs.map((r) => [r.uid, r]));
    const replyByUser = new Map(agentReplies.map((r) => [r.uid, r.avg_sec]));
    const closedByUser = new Map(agentClosed.map((r) => [r.uid, r]));
    const loadByUser = new Map(
      assignedNow.filter((g) => g.handoffUserId).map((g) => [g.handoffUserId!, g._count._all]),
    );
    const ids = Array.from(
      new Set([...activeIds, ...msgByUser.keys(), ...loadByUser.keys(), ...closedByUser.keys()]),
    );
    const users = ids.length
      ? await this.prisma.user.findMany({
          where: { id: { in: ids } },
          select: { id: true, fullName: true, email: true },
        })
      : [];
    const agents: AttentionAgentRow[] = users
      .map((u) => ({
        userId: u.id,
        fullName: u.fullName,
        email: u.email,
        active: activeIds.has(u.id),
        assignedNow: loadByUser.get(u.id) ?? 0,
        handled: num(msgByUser.get(u.id)?.convs),
        messagesSent: num(msgByUser.get(u.id)?.msgs),
        avgFirstReplySeconds: secs(replyByUser.get(u.id)),
        closed: num(closedByUser.get(u.id)?.closed),
        avgResolutionSeconds: secs(closedByUser.get(u.id)?.avg_sec),
      }))
      .sort((a, b) => b.messagesSent - a.messagesSent || a.fullName.localeCompare(b.fullName));

    const msgByDay = new Map(dayMsgs.map((r) => [r.day, r]));
    const convByDay = new Map(dayConvs.map((r) => [r.day, num(r.n)]));
    const byDay = dayKeys(from, to, tz).map((day) => ({
      day,
      newConversations: convByDay.get(day) ?? 0,
      inbound: num(msgByDay.get(day)?.inbound),
      outboundHuman: num(msgByDay.get(day)?.out_human),
      outboundBot: num(msgByDay.get(day)?.out_bot),
    }));

    return {
      range: { from, to, timezone: tz },
      overview: {
        newConversations: newConvs,
        escalated,
        escalationRate: newConvs > 0 ? Math.round((escalated / newConvs) * 1000) / 10 : null,
        closed: num(o?.closed),
        unattended: num(o?.unattended),
        avgFirstReplySeconds: secs(o?.avg_first),
        medianFirstReplySeconds: secs(o?.median_first),
        avgResolutionSeconds: secs(o?.avg_resolution),
        inbound: num(msg?.inbound),
        outboundHuman: num(msg?.out_human),
        outboundBot: num(msg?.out_bot),
      },
      now: {
        queue: num(nw?.queue),
        oldestQueueWaitSeconds: secs(nw?.oldest_wait),
        awaitingReply: num(nw?.awaiting),
        assigned: num(nw?.assigned),
      },
      agents,
      byDay,
    };
  }
}

/** Días `YYYY-MM-DD` (en la zona del tenant) que cubre [from, to), sin huecos. */
export function dayKeys(from: Date, to: Date, timeZone: string): string[] {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const keys: string[] = [];
  const last = fmt.format(new Date(to.getTime() - 1));
  for (let t = from.getTime(); ; t += DAY_MS) {
    const key = fmt.format(new Date(t));
    if (keys[keys.length - 1] !== key) keys.push(key);
    if (key === last || t > to.getTime() + DAY_MS) break;
  }
  if (keys[keys.length - 1] !== last) keys.push(last);
  return keys;
}
