"use client";

import Link from "next/link";
import { ExternalLink } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { DateTime } from "@/components/app/date-time";
import { EntityId } from "@/components/app/entity-id";
import { DescriptionList, FieldRow } from "@/components/app/field-row";

/**
 * `GET /audit/events` y `GET /audit/events/:id`
 * (apps/commerce-api/src/ops/audit.controller.ts). El actor viene incluido
 * con lo mínimo para nombrarlo; es null cuando lo hizo el sistema o el usuario
 * ya no existe.
 */
export interface AuditEvent {
  id: string;
  actorId: string | null;
  actor: { id: string; email: string; fullName: string } | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  metadata: unknown;
  createdAt: string;
}

/**
 * Tipos de objetivo que tienen pantalla propia en el portal. Cualquier otro
 * (Invitation, Membership, ApiKey, Tenant…) se muestra como texto plano.
 */
const TARGET_ROUTES: Record<string, (id: string) => string> = {
  Quote: (id) => `/quotes/${id}`,
  Order: (id) => `/orders/${id}`,
  Customer: (id) => `/customers/${id}`,
  Product: (id) => `/catalog?q=${encodeURIComponent(id)}`,
  CheckoutSession: (id) => `/payments/${id}`,
};

export function auditTargetHref(event: Pick<AuditEvent, "targetType" | "targetId">): string | null {
  if (!event.targetType || !event.targetId) return null;
  const build = TARGET_ROUTES[event.targetType];
  return build ? build(event.targetId) : null;
}

/** Nombre visible del actor: nombre, si no correo, si no "Sistema". */
export function auditActorLabel(actor: AuditEvent["actor"]): string {
  return actor?.fullName || actor?.email || "Sistema";
}

type Primitive = string | number | boolean | null;

function isPrimitive(value: unknown): value is Primitive {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

/** Claves de primer nivel con valor primitivo, para la lista plana. */
function primitiveEntries(metadata: unknown): Array<[string, Primitive]> {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return [];
  return Object.entries(metadata as Record<string, unknown>).filter(
    (entry): entry is [string, Primitive] => isPrimitive(entry[1]),
  );
}

function formatPrimitive(value: Primitive): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

export interface AuditEventSheetProps {
  event: AuditEvent | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Detalle de un evento de auditoría en panel lateral. La tabla muestra el JSON
 * recortado a una línea; aquí va completo, más una lista plana de los campos
 * simples para no tener que leer JSON cuando la pregunta es "qué cambió".
 */
export function AuditEventSheet({ event, open, onOpenChange }: AuditEventSheetProps) {
  const href = event ? auditTargetHref(event) : null;
  const entries = event ? primitiveEntries(event.metadata) : [];
  const hasMetadata =
    event?.metadata !== null &&
    event?.metadata !== undefined &&
    !(typeof event.metadata === "object" && Object.keys(event.metadata as object).length === 0);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        title="Evento de auditoría"
        className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-lg"
      >
        <SheetHeader className="border-b px-6 py-4">
          <SheetTitle className="font-mono text-base">{event?.action ?? "Evento"}</SheetTitle>
          <SheetDescription>
            {event ? (
              <>
                Registrado el <DateTime value={event.createdAt} />
              </>
            ) : (
              "Sin evento seleccionado"
            )}
          </SheetDescription>
        </SheetHeader>

        {event ? (
          <div className="flex-1 space-y-6 px-6 py-4">
            <DescriptionList divided>
              <FieldRow label="Acción" mono>
                {event.action}
              </FieldRow>
              <FieldRow label="Fecha">
                <DateTime value={event.createdAt} />
              </FieldRow>
              <FieldRow label="Actor">
                {event.actor ? (
                  <span className="flex flex-col">
                    <span>{event.actor.fullName || event.actor.email}</span>
                    {event.actor.fullName ? (
                      <span className="text-xs text-muted-foreground">{event.actor.email}</span>
                    ) : null}
                  </span>
                ) : (
                  <span className="text-muted-foreground">Sistema</span>
                )}
              </FieldRow>
              <FieldRow label="Tipo de objetivo">
                {event.targetType ? (
                  <Badge variant="neutral" size="sm" className="font-mono font-medium">
                    {event.targetType}
                  </Badge>
                ) : null}
              </FieldRow>
              <FieldRow label="ID de objetivo">
                {event.targetId ? (
                  <span className="inline-flex flex-wrap items-center gap-2">
                    <EntityId value={event.targetId} length={12} toastLabel="ID de objetivo" />
                    {href ? (
                      <Link
                        href={href}
                        className="inline-flex items-center gap-1 text-xs font-medium text-foreground underline underline-offset-2 hover:text-muted-foreground"
                      >
                        Abrir
                        <ExternalLink aria-hidden className="h-3 w-3" />
                      </Link>
                    ) : null}
                  </span>
                ) : null}
              </FieldRow>
              <FieldRow label="ID del evento">
                <EntityId value={event.id} length={12} toastLabel="ID del evento" />
              </FieldRow>
            </DescriptionList>

            <section aria-labelledby="audit-metadata-title" className="space-y-3">
              <h3 id="audit-metadata-title" className="text-sm font-semibold">
                Detalle
              </h3>
              {hasMetadata ? (
                <>
                  {entries.length > 0 ? (
                    <DescriptionList className="rounded-card bg-muted px-3 py-1">
                      {entries.map(([key, value]) => (
                        <FieldRow key={key} label={<span className="font-mono">{key}</span>} mono>
                          {formatPrimitive(value)}
                        </FieldRow>
                      ))}
                    </DescriptionList>
                  ) : null}
                  <pre className="max-h-96 overflow-auto rounded-card bg-muted p-3 font-mono text-xs leading-relaxed text-foreground">
                    {JSON.stringify(event.metadata, null, 2)}
                  </pre>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">Este evento no tiene detalle adicional.</p>
              )}
            </section>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
