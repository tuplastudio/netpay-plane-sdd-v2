"use client";
import { useMemo, useState } from "react";
import {
  Bot,
  CheckCircle2,
  Clock,
  Hourglass,
  Inbox,
  MessagesSquare,
  Timer,
  TrendingUp,
  UserCog,
  Users,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import { DataTable, type DataTableColumn } from "@/components/app/data-table";
import { PageHeader } from "@/components/app/page-header";
import { Section } from "@/components/app/section";
import { StatTile } from "@/components/app/stat-tile";
import {
  formatDuration,
  useAttentionReport,
  type AttentionAgentRow,
  type AttentionDayRow,
} from "../_components/use-conversations";

type Preset = "today" | "7d" | "30d" | "90d";

const PRESETS: Array<{ value: Preset; label: string; days: number }> = [
  { value: "today", label: "Hoy", days: 0 },
  { value: "7d", label: "Últimos 7 días", days: 7 },
  { value: "30d", label: "Últimos 30 días", days: 30 },
  { value: "90d", label: "Últimos 90 días", days: 90 },
];

/** Rango ISO del preset, calculado al cambiar la selección (no en cada render). */
function rangeOf(preset: Preset): { from: string; to: string } {
  const now = new Date();
  const to = new Date(now.getTime() + 60_000);
  const days = PRESETS.find((p) => p.value === preset)!.days;
  const from = new Date(now);
  if (days === 0) from.setHours(0, 0, 0, 0);
  else from.setTime(now.getTime() - days * 24 * 60 * 60 * 1000);
  return { from: from.toISOString(), to: to.toISOString() };
}

const SHORT_DAYS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];

function dayLabel(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  const date = new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
  return `${SHORT_DAYS[date.getDay()] ?? ""} ${d}`;
}

/**
 * Reporte de atención: volumen, tiempos de respuesta y carga por agente.
 * Datos de `GET /reports/attention` (calculados en SQL sobre todo el rango).
 */
export default function AttentionReportPage() {
  const [preset, setPreset] = useState<Preset>("30d");
  const range = useMemo(() => rangeOf(preset), [preset]);
  const query = useAttentionReport(range);
  const report = query.data;
  const o = report?.overview;
  const now = report?.now;
  const tile = { isLoading: query.isLoading, isError: query.isError, onRetry: () => void query.refetch() };

  const agentColumns: Array<DataTableColumn<AttentionAgentRow>> = [
    {
      key: "agent",
      header: "Agente",
      cell: (a) => (
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground">{a.fullName}</p>
          <p className="truncate text-xs text-muted-foreground">{a.email}</p>
        </div>
      ),
    },
    {
      key: "status",
      header: "Estado",
      cell: (a) =>
        a.active ? (
          <Badge variant="success" size="sm">
            Agente activo
          </Badge>
        ) : (
          <Badge variant="neutral" size="sm">
            Ya no es agente
          </Badge>
        ),
    },
    { key: "assigned", header: "Llevando ahora", numeric: true, cell: (a) => a.assignedNow },
    { key: "handled", header: "Conversaciones atendidas", numeric: true, cell: (a) => a.handled },
    { key: "msgs", header: "Mensajes enviados", numeric: true, cell: (a) => a.messagesSent },
    {
      key: "reply",
      header: "1.ª respuesta (prom.)",
      numeric: true,
      cell: (a) => formatDuration(a.avgFirstReplySeconds),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reporte de atención"
        description="Volumen, tiempos de respuesta y carga de trabajo de tu equipo en WhatsApp."
        backHref="/conversations"
        breadcrumbs={[{ label: "Conversaciones", href: "/conversations" }, { label: "Reporte" }]}
        actions={
          <Select
            aria-label="Periodo del reporte"
            value={preset}
            onChange={(e) => setPreset(e.target.value as Preset)}
            className="h-9 w-44 text-sm"
          >
            {PRESETS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </Select>
        }
      />

      <Section
        title="Ahora mismo"
        description="Foto en vivo, no depende del periodo."
        headerIcon={<Clock className="h-4 w-4" />}
        density="compact"
      >
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile
            size="compact"
            label="En cola"
            value={now?.queue ?? 0}
            tone={(now?.queue ?? 0) > 0 ? "destructive" : "neutral"}
            icon={<Hourglass className="h-4 w-4" />}
            hint={
              now?.oldestQueueWaitSeconds != null
                ? `La más antigua espera ${formatDuration(now.oldestQueueWaitSeconds)}`
                : "Nadie esperando agente"
            }
            {...tile}
          />
          <StatTile
            size="compact"
            label="Con un agente"
            value={now?.assigned ?? 0}
            icon={<UserCog className="h-4 w-4" />}
            hint="Hilos asignados a una persona"
            {...tile}
          />
          <StatTile
            size="compact"
            label="Esperando respuesta"
            value={now?.awaitingReply ?? 0}
            tone={(now?.awaitingReply ?? 0) > 0 ? "warning" : "neutral"}
            icon={<Inbox className="h-4 w-4" />}
            hint="El último mensaje es del cliente"
            {...tile}
          />
          <StatTile
            size="compact"
            label="Agentes activos"
            value={report?.agents.filter((a) => a.active).length ?? 0}
            icon={<Users className="h-4 w-4" />}
            hint="Personas marcadas como agente"
            {...tile}
          />
        </div>
      </Section>

      <Section
        title="Periodo"
        description="Conversaciones y tiempos dentro del rango elegido."
        headerIcon={<TrendingUp className="h-4 w-4" />}
        density="compact"
      >
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <StatTile
            size="compact"
            label="Conversaciones nuevas"
            value={o?.newConversations ?? 0}
            tone="info"
            icon={<MessagesSquare className="h-4 w-4" />}
            hint={`${o?.inbound ?? 0} mensajes de clientes`}
            {...tile}
          />
          <StatTile
            size="compact"
            label="Escaladas a una persona"
            value={o?.escalated ?? 0}
            tone={(o?.escalated ?? 0) > 0 ? "warning" : "neutral"}
            icon={<UserCog className="h-4 w-4" />}
            hint={
              o?.escalationRate != null
                ? `${o.escalationRate}% de las nuevas · ${o.unattended} sin atender`
                : "Sin conversaciones nuevas"
            }
            {...tile}
          />
          <StatTile
            size="compact"
            label="Cerradas"
            value={o?.closed ?? 0}
            tone="success"
            icon={<CheckCircle2 className="h-4 w-4" />}
            hint={`Resolución promedio: ${formatDuration(o?.avgResolutionSeconds)}`}
            {...tile}
          />
          <StatTile
            size="compact"
            label="Primera respuesta (prom.)"
            value={formatDuration(o?.avgFirstReplySeconds)}
            icon={<Timer className="h-4 w-4" />}
            hint={`Mediana: ${formatDuration(o?.medianFirstReplySeconds)} · desde que pasa a una persona`}
            {...tile}
          />
          <StatTile
            size="compact"
            label="Respuestas de personas"
            value={o?.outboundHuman ?? 0}
            icon={<UserCog className="h-4 w-4" />}
            hint="Mensajes enviados desde el portal"
            {...tile}
          />
          <StatTile
            size="compact"
            label="Respuestas del bot"
            value={o?.outboundBot ?? 0}
            icon={<Bot className="h-4 w-4" />}
            hint="Mensajes automáticos"
            {...tile}
          />
        </div>
      </Section>

      <Section
        title="Actividad por día"
        description="Mensajes de clientes frente a respuestas de personas y del bot."
        headerIcon={<TrendingUp className="h-4 w-4" />}
        density="compact"
      >
        <ActivityChart data={report?.byDay ?? []} isLoading={query.isLoading} />
      </Section>

      <Section
        title="Atención por agente"
        description="Quién contestó qué en el periodo. La primera respuesta cuenta desde que el hilo pasa a una persona."
        headerIcon={<Users className="h-4 w-4" />}
        density="compact"
        padded={false}
      >
        <DataTable
          columns={agentColumns}
          rows={report?.agents}
          getRowId={(a) => a.userId}
          isLoading={query.isLoading}
          isError={query.isError}
          onRetry={() => void query.refetch()}
          caption="Atención por agente"
          empty={{
            icon: <Users className="h-6 w-6" />,
            title: "Sin agentes todavía",
            description:
              "Marca a las personas de tu equipo como agente en Admin › Miembros para que puedan tomar conversaciones.",
          }}
        />
      </Section>
    </div>
  );
}

const SERIES: Array<{ key: keyof AttentionDayRow; label: string; cls: string }> = [
  { key: "inbound", label: "Clientes", cls: "bg-info" },
  { key: "outboundHuman", label: "Personas", cls: "bg-primary" },
  { key: "outboundBot", label: "Bot", cls: "bg-muted-foreground/40" },
];

/** Barras apiladas por día, sin librería: el alto sale del máximo del rango. */
function ActivityChart({ data, isLoading }: { data: AttentionDayRow[]; isLoading: boolean }) {
  if (isLoading) {
    return <div className="h-40 w-full animate-pulse rounded-md bg-muted" aria-label="Cargando actividad…" />;
  }
  const totals = data.map((d) => d.inbound + d.outboundHuman + d.outboundBot);
  const max = Math.max(0, ...totals);
  if (max === 0) {
    return (
      <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
        Sin mensajes en este periodo.
      </div>
    );
  }
  // Con muchos días se rotula uno de cada N para que las etiquetas no se encimen.
  const step = Math.ceil(data.length / 10);
  return (
    <div className="space-y-3">
      <ul className="flex flex-wrap gap-3 text-xs text-muted-foreground" aria-label="Leyenda">
        {SERIES.map((s) => (
          <li key={s.key} className="flex items-center gap-1.5">
            <span aria-hidden className={`h-2.5 w-2.5 rounded-sm ${s.cls}`} />
            {s.label}
          </li>
        ))}
      </ul>
      <div
        role="img"
        aria-label={`Mensajes por día: ${data
          .map((d, i) => `${d.day} ${totals[i]}`)
          .join(", ")}`}
        className="flex h-40 items-end gap-px sm:gap-1"
      >
        {data.map((d, i) => {
          const total = totals[i]!;
          const height = Math.max(total > 0 ? 4 : 0, Math.round((total / max) * 100));
          return (
            <div
              key={d.day}
              className="flex h-full min-w-0 flex-1 flex-col justify-end"
              title={`${dayLabel(d.day)}: ${d.inbound} clientes · ${d.outboundHuman} personas · ${d.outboundBot} bot`}
            >
              <div className="flex w-full flex-col-reverse overflow-hidden rounded-t-sm" style={{ height: `${height}%` }}>
                {SERIES.map((s) => {
                  const v = d[s.key] as number;
                  return v > 0 ? (
                    <div key={s.key} className={s.cls} style={{ flexGrow: v, flexBasis: 0 }} />
                  ) : null;
                })}
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex gap-px text-[10px] text-muted-foreground sm:gap-1" aria-hidden>
        {data.map((d, i) => (
          <span key={d.day} className="min-w-0 flex-1 truncate text-center">
            {i % step === 0 ? dayLabel(d.day) : ""}
          </span>
        ))}
      </div>
    </div>
  );
}
