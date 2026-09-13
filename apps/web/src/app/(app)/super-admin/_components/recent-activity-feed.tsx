"use client";

import Link from "next/link";
import {
  Activity,
  Archive,
  ArchiveRestore,
  Building2,
  KeyRound,
  MailOpen,
  Settings2,
  ShieldCheck,
  Trash2,
  UserCheck,
  UserPlus,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { DateTime } from "@/components/app/date-time";

export interface ActivityRow {
  id: string;
  /** Verbo del AuditLog (p.ej. `tenant.created`, `user.role_changed`). */
  action: string;
  targetType: string | null;
  createdAt: string;
  actor: { id: string; email: string; fullName: string | null } | null;
  tenant: { id: string; name: string; slug: string } | null;
}

/**
 * Auditoría reciente cross-tenant: un hilo de eventos con icono y color
 * según el verbo. La idea es que al entrar al panel un operador vea
 * "qué se movió en la última hora" sin tener que abrir cada empresa.
 */
export function RecentActivityFeed({
  rows,
  isLoading,
}: {
  rows: ActivityRow[];
  isLoading: boolean;
}) {
  if (isLoading) {
    return (
      <ul className="space-y-2" aria-label="Cargando actividad reciente…">
        {Array.from({ length: 5 }).map((_, i) => (
          <li key={i} className="flex items-start gap-2">
            <Skeleton className="h-6 w-6 shrink-0 rounded-full" />
            <div className="flex-1 space-y-1">
              <Skeleton className="h-3 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          </li>
        ))}
      </ul>
    );
  }
  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-6 text-center text-sm text-muted-foreground">
        <Activity aria-hidden className="h-6 w-6" />
        <p>Sin actividad reciente.</p>
      </div>
    );
  }
  return (
    <ol aria-label="Actividad reciente" className="space-y-0">
      {rows.map((row, i) => {
        const meta = describeAction(row.action);
        const Icon = meta.icon;
        return (
          <li
            key={row.id}
            className={cn(
              "flex items-start gap-2.5 py-2 text-xs",
              i < rows.length - 1 && "border-b border-border",
            )}
          >
            <span
              aria-hidden
              className={cn(
                "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full",
                meta.tone,
              )}
            >
              <Icon className="h-3 w-3" />
            </span>
            <div className="min-w-0 flex-1 space-y-0.5">
              <p className="leading-snug">
                <span className="font-medium text-foreground">{meta.label}</span>
                {row.tenant ? (
                  <>
                    {" en "}
                    <Link
                      href={`/super-admin/${row.tenant.id}`}
                      className="font-medium text-foreground underline-offset-2 hover:underline"
                    >
                      {row.tenant.name}
                    </Link>
                  </>
                ) : null}
              </p>
              <p className="text-muted-foreground">
                {row.actor ? (
                  <span>
                    {row.actor.fullName ?? row.actor.email} ·{" "}
                  </span>
                ) : (
                  <span>Sin actor · </span>
                )}
                <DateTime value={row.createdAt} className="text-muted-foreground" />
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

interface ActionMeta {
  label: string;
  icon: typeof Activity;
  /** Tokens del DS para pintar el círculo del evento. */
  tone: string;
}

/**
 * Traductor de los verbos del AuditLog a etiqueta legible en español.
 * El icono y el color salen del verbo: creado = success, archivado =
 * warning, invitación = info, etc. Sin esto la columna sería un JSON
 * ilegible para el operador.
 */
function describeAction(action: string): ActionMeta {
  if (action === "tenant.created")
    return { label: "Empresa creada", icon: Building2, tone: "bg-success/15 text-success-foreground" };
  if (action === "tenant.archived")
    return { label: "Empresa archivada", icon: Archive, tone: "bg-warning/15 text-warning-foreground" };
  if (action === "tenant.unarchived")
    return { label: "Empresa restaurada", icon: ArchiveRestore, tone: "bg-success/15 text-success-foreground" };
  if (action === "tenant.renamed")
    return { label: "Empresa renombrada", icon: Settings2, tone: "bg-info/15 text-info-foreground" };
  if (action === "user.invited" || action === "user_invitation_sent" || action === "user.invitation_sent")
    return { label: "Invitación enviada", icon: MailOpen, tone: "bg-info/15 text-info-foreground" };
  if (action === "user.role_changed" || action === "user_role_changed")
    return { label: "Rol de usuario cambiado", icon: UserCheck, tone: "bg-info/15 text-info-foreground" };
  if (action === "user.created" || action === "user_created")
    return { label: "Usuario creado", icon: UserPlus, tone: "bg-success/15 text-success-foreground" };
  if (action === "user.disabled" || action === "user_disabled")
    return { label: "Usuario desactivado", icon: Users, tone: "bg-warning/15 text-warning-foreground" };
  if (action === "user.totp_enabled" || action === "user_totp_enabled")
    return { label: "MFA activado", icon: ShieldCheck, tone: "bg-success/15 text-success-foreground" };
  if (action === "user.totp_disabled" || action === "user_totp_disabled")
    return { label: "MFA desactivado", icon: ShieldCheck, tone: "bg-warning/15 text-warning-foreground" };
  if (action === "password_reset_requested" || action === "auth.password_reset_requested")
    return { label: "Restablecimiento de contraseña solicitado", icon: MailOpen, tone: "bg-info/15 text-info-foreground" };
  if (action === "whatsapp_conversation_returned" || action === "conversation.returned" || action === "whatsapp.conversation_returned")
    return { label: "Conversación devuelta al agente", icon: Activity, tone: "bg-muted text-muted-foreground" };
  if (action === "whatsapp_conversation_handoff" || action === "whatsapp.conversation_handoff")
    return { label: "Conversación transferida a una persona", icon: UserCheck, tone: "bg-info/15 text-info-foreground" };
  if (action === "whatsapp_conversation_assigned" || action === "whatsapp.conversation_assigned")
    return { label: "Conversación tomada por un asesor", icon: UserCheck, tone: "bg-info/15 text-info-foreground" };
  if (action.startsWith("order."))
    return { label: humanize(action), icon: Activity, tone: "bg-success/15 text-success-foreground" };
  if (action.startsWith("payment."))
    return { label: humanize(action), icon: Activity, tone: "bg-success/15 text-success-foreground" };
  if (action.startsWith("whatsapp."))
    return { label: humanize(action), icon: Activity, tone: "bg-muted text-muted-foreground" };
  if (action === "superadmin.impersonation_started" || action === "impersonation_started")
    return { label: "Impersonación iniciada", icon: ShieldCheck, tone: "bg-warning/15 text-warning-foreground" };
  if (action === "superadmin.impersonation_ended" || action === "impersonation_ended")
    return { label: "Impersonación terminada", icon: ShieldCheck, tone: "bg-muted text-muted-foreground" };
  if (action.startsWith("apikey."))
    return { label: "API key actualizada", icon: KeyRound, tone: "bg-muted text-muted-foreground" };
  if (action.includes("deleted") || action.includes("removed"))
    return { label: humanize(action), icon: Trash2, tone: "bg-destructive/15 text-destructive-foreground" };
  return { label: humanize(action), icon: Activity, tone: "bg-muted text-muted-foreground" };
}

/** "tenant.created" → "Tenant created" (fallback bonito para verbos sin mapeo). */
function humanize(action: string): string {
  return action
    .replace(/[._]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
