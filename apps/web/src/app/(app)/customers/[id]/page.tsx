"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Archive,
  ArchiveRestore,
  AlertCircle,
  MapPin,
  MessageCircle,
  ShieldCheck,
  UserX,
} from "lucide-react";
import { api } from "@/lib/api";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { SkeletonRegion, SkeletonTable, SkeletonText } from "@/components/ui/skeleton";
import {
  CHANNEL_LABELS,
  CONSENT_SCOPE_LABELS,
  StatusBadge,
} from "@/components/ui/status-badge";
import { DateTime } from "@/components/app/date-time";
import { DescriptionList, FieldRow } from "@/components/app/field-row";
import { EntityId } from "@/components/app/entity-id";
import { PageHeader } from "@/components/app/page-header";
import { Section } from "@/components/app/section";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { CustomerHistorySection } from "./_components/customer-history";

/**
 * Forma real de `GET /customers/:id` (`customer.service.ts#get`): el registro
 * completo de Prisma más `addresses`, `identities` y `consents`.
 */
interface CustomerAddress {
  id: string;
  label: string;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  isDefault: boolean;
}

interface CustomerIdentity {
  id: string;
  /** `Channel` — WHATSAPP_META | WHATSAPP_EVOLUTION. */
  channel: string;
  externalId: string;
  verifiedAt: string | null;
}

interface CustomerConsent {
  id: string;
  /** `ConsentScope` — WHATSAPP | MARKETING | DATA_PROCESSING. */
  scope: string;
  granted: boolean;
  grantedAt: string | null;
  revokedAt: string | null;
}

interface CustomerDetail {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  taxId: string | null;
  notes: string | null;
  /** `CustomerStatus` — ACTIVE | ARCHIVED. */
  status: string;
  createdAt: string;
  updatedAt: string;
  addresses: CustomerAddress[];
  identities: CustomerIdentity[];
  consents: CustomerConsent[];
}

/** Orden fijo del enum `ConsentScope`: los tres alcances se muestran siempre. */
const CONSENT_SCOPES = ["WHATSAPP", "MARKETING", "DATA_PROCESSING"] as const;

const BREADCRUMB_ROOT = { label: "Clientes", href: "/customers" };

function httpStatus(error: unknown): number | undefined {
  return (error as { response?: { status?: number } })?.response?.status;
}

/**
 * El backend contesta 404 ("Cliente no accesible") tanto para un id inexistente
 * como para uno de otro tenant, y 403 desde `assertAccess`. Para el operador
 * los dos casos son el mismo: ese cliente no está aquí.
 */
function isMissing(error: unknown): boolean {
  const status = httpStatus(error);
  return status === 404 || status === 403;
}

function formatAddress(a: CustomerAddress): string {
  return [a.line1, a.line2, `${a.postalCode} ${a.city}`.trim(), a.state, a.country]
    .filter((part): part is string => !!part && part.trim().length > 0)
    .join(" · ");
}

export default function CustomerDetailPage() {
  const params = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [restoreOpen, setRestoreOpen] = useState(false);

  const customerQ = useQuery({
    queryKey: ["customer", params.id],
    queryFn: async () => {
      const res = await api.get<{ data: CustomerDetail }>(`/customers/${params.id}`);
      return res.data.data;
    },
    // Un id inexistente no mejora reintentándolo: se muestra el estado
    // "no encontrado" en el acto en vez de tres reintentos de spinner.
    retry: (failureCount, error) => !isMissing(error) && failureCount < 2,
  });

  const customer = customerQ.data;

  /**
   * Archivar y restaurar cambian `status`, que se ve tanto aquí como en el
   * listado (que por defecto solo pide los ACTIVE): hay que invalidar ambas
   * cachés o la fila archivada sigue apareciendo en /customers.
   */
  const invalidateCustomer = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["customer", params.id] }),
      queryClient.invalidateQueries({ queryKey: ["customers"] }),
    ]);
  };

  const archive = useMutation({
    mutationFn: async () => {
      await api.post(`/customers/${params.id}/archive`);
    },
    onSuccess: async () => {
      toast.success("Cliente archivado");
      setArchiveOpen(false);
      await invalidateCustomer();
    },
    onError: () => toast.error("No se pudo archivar el cliente"),
  });

  const unarchive = useMutation({
    mutationFn: async () => {
      await api.post(`/customers/${params.id}/unarchive`);
    },
    onSuccess: async () => {
      toast.success("Cliente restaurado");
      setRestoreOpen(false);
      await invalidateCustomer();
    },
    onError: () => toast.error("No se pudo restaurar el cliente"),
  });

  // --- Estado 1: cargando -------------------------------------------------
  if (customerQ.isLoading) {
    return (
      <div>
        <PageHeader
          title="Cliente"
          backHref="/customers"
          breadcrumbs={[BREADCRUMB_ROOT, { label: "Detalle" }]}
        />
        {/* Una sola región viva para los dos bloques: el lector anuncia
            "Cargando el cliente…" una vez, no una por skeleton. */}
        <SkeletonRegion label="Cargando el cliente…">
          <div className="space-y-6">
            <Section title="Ficha">
              <SkeletonText lines={5} />
            </Section>
            <Section title="Historial" padded={false}>
              <SkeletonTable rows={4} cols={6} />
            </Section>
          </div>
        </SkeletonRegion>
      </div>
    );
  }

  // --- Estado 2: no encontrado -------------------------------------------
  if (isMissing(customerQ.error) || (!customerQ.isError && !customer)) {
    return (
      <div>
        <PageHeader
          title="Cliente no encontrado"
          backHref="/customers"
          breadcrumbs={[BREADCRUMB_ROOT, { label: "No encontrado" }]}
        />
        <Section>
          <EmptyState
            icon={<UserX className="h-6 w-6" />}
            title="No encontramos este cliente"
            description={
              <>
                El identificador <EntityId value={params.id} copyLabel="Copiar el identificador buscado" toastLabel="Identificador" />{" "}
                no corresponde a ningún cliente de este comercio. Puede que se haya eliminado o que
                el enlace esté incompleto.
              </>
            }
            action={
              <Button asChild variant="outline">
                <Link href="/customers">Volver a clientes</Link>
              </Button>
            }
          />
        </Section>
      </div>
    );
  }

  // --- Estado 3: error ----------------------------------------------------
  if (customerQ.isError || !customer) {
    return (
      <div>
        <PageHeader
          title="Cliente"
          backHref="/customers"
          breadcrumbs={[BREADCRUMB_ROOT, { label: "Detalle" }]}
        />
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>No se pudo cargar el cliente</AlertTitle>
          <AlertDescription>
            <p>Hubo un problema al consultar la ficha. Inténtalo de nuevo.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => void customerQ.refetch()}>
                Reintentar
              </Button>
              <Button variant="ghost" size="sm" asChild>
                <Link href="/customers">Volver a clientes</Link>
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  // --- Estado 4: cargado --------------------------------------------------
  const c = customer;
  const isArchived = c.status === "ARCHIVED";
  const consentByScope = new Map(c.consents.map((x) => [x.scope, x]));

  return (
    <div>
      <PageHeader
        title={c.fullName}
        backHref="/customers"
        breadcrumbs={[BREADCRUMB_ROOT, { label: c.fullName }]}
        meta={
          <>
            <StatusBadge status={c.status} domain="customer" withDot />
            <span aria-hidden>·</span>
            <span>
              Alta <DateTime value={c.createdAt} withTime={false} />
            </span>
            <span aria-hidden>·</span>
            <EntityId value={c.id} toastLabel="ID del cliente" />
          </>
        }
        actions={
          isArchived ? (
            <Button variant="outline" onClick={() => setRestoreOpen(true)}>
              <ArchiveRestore className="h-4 w-4" aria-hidden />
              Restaurar cliente
            </Button>
          ) : (
            <Button variant="destructive" onClick={() => setArchiveOpen(true)}>
              <Archive className="h-4 w-4" aria-hidden />
              Archivar cliente
            </Button>
          )
        }
      />

      <div className="space-y-6">
        {isArchived && (
          <Alert variant="warning">
            <Archive />
            <AlertTitle>Cliente archivado</AlertTitle>
            <AlertDescription>
              No aparece en el listado de clientes activos ni se le puede cotizar. Su historial se
              conserva completo; restáuralo para volver a operarlo.
            </AlertDescription>
          </Alert>
        )}

        <div className="grid gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            <Section title="Ficha" description="Datos de contacto e identidad fiscal.">
              <DescriptionList divided>
                <FieldRow label="Nombre">{c.fullName}</FieldRow>
                <FieldRow label="Correo">{c.email}</FieldRow>
                <FieldRow label="Teléfono">{c.phone}</FieldRow>
                <FieldRow label="RFC" mono>
                  {c.taxId}
                </FieldRow>
                <FieldRow label="Notas">{c.notes}</FieldRow>
                <FieldRow label="Alta">
                  <DateTime value={c.createdAt} />
                </FieldRow>
                <FieldRow label="Última actualización">
                  <DateTime value={c.updatedAt} />
                </FieldRow>
                <FieldRow label="ID del cliente">
                  <EntityId value={c.id} length={36} toastLabel="ID del cliente" />
                </FieldRow>
              </DescriptionList>
            </Section>

            <CustomerHistorySection customerId={c.id} />
          </div>

          <div className="space-y-6">
            <Section
              title="Direcciones"
              headerIcon={<MapPin className="h-4 w-4" />}
              density="compact"
            >
              {c.addresses.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Este cliente no tiene direcciones registradas.
                </p>
              ) : (
                <DescriptionList divided>
                  {c.addresses.map((a) => (
                    <FieldRow
                      key={a.id}
                      label={
                        <span className="inline-flex flex-wrap items-center gap-1.5">
                          {a.label}
                          {a.isDefault ? (
                            <Badge variant="info" size="sm">
                              Predeterminada
                            </Badge>
                          ) : null}
                        </span>
                      }
                    >
                      {formatAddress(a)}
                    </FieldRow>
                  ))}
                </DescriptionList>
              )}
            </Section>

            <Section
              title="Identidades"
              description="Cuentas de mensajería vinculadas a este cliente."
              headerIcon={<MessageCircle className="h-4 w-4" />}
              density="compact"
            >
              {c.identities.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Sin identidades vinculadas. El cliente aún no ha escrito desde un canal
                  reconocido.
                </p>
              ) : (
                <DescriptionList divided>
                  {c.identities.map((i) => (
                    <FieldRow
                      key={i.id}
                      label={CHANNEL_LABELS[i.channel] ?? i.channel}
                      mono
                      hint={
                        i.verifiedAt ? (
                          <>
                            Verificada <DateTime value={i.verifiedAt} withTime={false} />
                          </>
                        ) : (
                          "Sin verificar"
                        )
                      }
                    >
                      {i.externalId}
                    </FieldRow>
                  ))}
                </DescriptionList>
              )}
            </Section>

            <Section
              title="Consentimientos"
              description="Permisos otorgados por el cliente para contactarlo y tratar sus datos."
              headerIcon={<ShieldCheck className="h-4 w-4" />}
              density="compact"
            >
              <DescriptionList divided>
                {CONSENT_SCOPES.map((scope) => {
                  const consent = consentByScope.get(scope);
                  return (
                    <FieldRow key={scope} label={CONSENT_SCOPE_LABELS[scope]}>
                      {!consent ? (
                        <Badge variant="neutral" size="sm">
                          Sin registro
                        </Badge>
                      ) : consent.granted ? (
                        <span className="inline-flex flex-wrap items-center gap-2">
                          <Badge variant="success" size="sm">
                            Otorgado
                          </Badge>
                          <DateTime
                            value={consent.grantedAt}
                            withTime={false}
                            className="text-xs text-muted-foreground"
                          />
                        </span>
                      ) : (
                        <span className="inline-flex flex-wrap items-center gap-2">
                          <Badge variant="neutral" size="sm">
                            Revocado
                          </Badge>
                          <DateTime
                            value={consent.revokedAt}
                            withTime={false}
                            className="text-xs text-muted-foreground"
                          />
                        </span>
                      )}
                    </FieldRow>
                  );
                })}
              </DescriptionList>
            </Section>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={archiveOpen}
        onOpenChange={setArchiveOpen}
        title={`¿Archivar a ${c.fullName}?`}
        description="Deja de aparecer en el listado de clientes activos y no se le puede cotizar. No se borra nada: su historial se conserva y puedes restaurarlo cuando quieras."
        confirmLabel="Archivar cliente"
        variant="destructive"
        pending={archive.isPending}
        onConfirm={() => archive.mutate()}
      />

      <ConfirmDialog
        open={restoreOpen}
        onOpenChange={setRestoreOpen}
        title={`¿Restaurar a ${c.fullName}?`}
        description="Vuelve al listado de clientes activos y se le puede volver a cotizar y cobrar."
        confirmLabel="Restaurar cliente"
        variant="default"
        pending={unarchive.isPending}
        onConfirm={() => unarchive.mutate()}
      />
    </div>
  );
}
