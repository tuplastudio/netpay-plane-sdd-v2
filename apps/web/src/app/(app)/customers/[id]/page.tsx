"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Archive,
  ArchiveRestore,
  AlertCircle,
  Mail,
  MessageCircle,
  MessagesSquare,
  Pencil,
  Phone,
  ShieldCheck,
  Tag,
  UserX,
} from "lucide-react";
import { api } from "@/lib/api";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { SkeletonRegion, SkeletonTable, SkeletonText } from "@/components/ui/skeleton";
import { CHANNEL_LABELS, CONSENT_SCOPE_LABELS, StatusBadge } from "@/components/ui/status-badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DateTime } from "@/components/app/date-time";
import { DescriptionList, FieldRow } from "@/components/app/field-row";
import { EntityId } from "@/components/app/entity-id";
import { PageHeader } from "@/components/app/page-header";
import { Section } from "@/components/app/section";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { usePermissions } from "@/components/app/use-permissions";
import { CustomerAddresses } from "./_components/customer-addresses";
import { CustomerEditSheet } from "./_components/customer-edit-sheet";
import { CustomerFiscal } from "./_components/customer-fiscal";
import { CustomerNotes } from "./_components/customer-notes";
import { CustomerSummaryTiles, useCustomerSummary } from "./_components/customer-summary-tiles";
import { CustomerTimeline } from "./_components/customer-timeline";
import { httpStatus, whatsappDigits, type CustomerDetail } from "./_components/customer-types";

/** Orden fijo del enum `ConsentScope`: los tres alcances se muestran siempre. */
const CONSENT_SCOPES = ["WHATSAPP", "MARKETING", "DATA_PROCESSING"] as const;

const BREADCRUMB_ROOT = { label: "Clientes", href: "/customers" };

const TABS = [
  { value: "resumen", label: "Resumen" },
  { value: "cotizaciones", label: "Cotizaciones" },
  { value: "pedidos", label: "Pedidos" },
  { value: "pagos", label: "Pagos" },
  { value: "conversaciones", label: "Conversaciones" },
  { value: "fiscal", label: "Datos fiscales" },
  { value: "notas", label: "Notas" },
] as const;
type TabValue = (typeof TABS)[number]["value"];

function isTab(v: string | null): v is TabValue {
  return TABS.some((t) => t.value === v);
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

export default function CustomerDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const canWrite = usePermissions().can("customers.write");

  // Pestaña en la URL (`?tab=`) para que "atrás" y los links compartidos
  // abran la misma vista. La paginación de cada pestaña ya vive en la URL.
  const rawTab = searchParams.get("tab");
  const tab: TabValue = isTab(rawTab) ? rawTab : "resumen";
  const setTab = useCallback(
    (next: string) => {
      const sp = new URLSearchParams(searchParams.toString());
      if (next === "resumen") sp.delete("tab");
      else sp.set("tab", next);
      const qs = sp.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

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
  const summaryQ = useCustomerSummary(params.id);

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
        <PageHeader title="Cliente" backHref="/customers" breadcrumbs={[BREADCRUMB_ROOT, { label: "Detalle" }]} />
        <SkeletonRegion label="Cargando el cliente…">
          <div className="space-y-6">
            <Section title="Ficha">
              <SkeletonText lines={4} />
            </Section>
            <Section title="Línea de tiempo" padded={false}>
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
                El identificador{" "}
                <EntityId value={params.id} copyLabel="Copiar el identificador buscado" toastLabel="Identificador" /> no
                corresponde a ningún cliente de este comercio. Puede que se haya eliminado o que el enlace esté
                incompleto.
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
        <PageHeader title="Cliente" backHref="/customers" breadcrumbs={[BREADCRUMB_ROOT, { label: "Detalle" }]} />
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
  const wa = whatsappDigits(c.phone);
  const lastConversationId = summaryQ.data?.lastConversationId ?? null;
  const conversationHref = lastConversationId
    ? `/conversations?id=${lastConversationId}`
    : c.phone
      ? `/conversations?q=${encodeURIComponent(c.phone)}`
      : null;
  const conversationsCount = summaryQ.data?.conversationsCount;
  const notesCount = summaryQ.data?.notesCount;

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
              Cliente desde <DateTime value={summaryQ.data?.firstContactAt ?? c.createdAt} withTime={false} />
            </span>
            <span aria-hidden>·</span>
            <EntityId value={c.id} toastLabel="ID del cliente" />
            {c.tags.length > 0 ? (
              <>
                <span aria-hidden>·</span>
                <span className="inline-flex flex-wrap items-center gap-1" aria-label="Etiquetas">
                  <Tag aria-hidden className="h-3.5 w-3.5 text-muted-foreground" />
                  {c.tags.map((t) => (
                    <Badge key={t} variant="info" size="sm">
                      {t}
                    </Badge>
                  ))}
                </span>
              </>
            ) : null}
          </>
        }
        actions={
          <>
            {wa ? (
              <Button variant="outline" asChild>
                <a href={`https://wa.me/${wa}`} target="_blank" rel="noreferrer">
                  <MessageCircle className="h-4 w-4" aria-hidden />
                  Abrir WhatsApp
                </a>
              </Button>
            ) : null}
            {conversationHref ? (
              <Button variant="outline" asChild>
                <Link href={conversationHref}>
                  <MessagesSquare className="h-4 w-4" aria-hidden />
                  {lastConversationId ? "Ver conversación" : "Buscar en bandeja"}
                </Link>
              </Button>
            ) : null}
            {canWrite && !isArchived ? (
              <Button onClick={() => setEditOpen(true)}>
                <Pencil className="h-4 w-4" aria-hidden />
                Editar
              </Button>
            ) : null}
            {canWrite ? (
              isArchived ? (
                <Button variant="outline" onClick={() => setRestoreOpen(true)}>
                  <ArchiveRestore className="h-4 w-4" aria-hidden />
                  Restaurar
                </Button>
              ) : (
                <Button variant="destructive" onClick={() => setArchiveOpen(true)}>
                  <Archive className="h-4 w-4" aria-hidden />
                  Archivar
                </Button>
              )
            ) : null}
          </>
        }
      />

      <div className="space-y-6">
        {isArchived && (
          <Alert variant="warning">
            <Archive />
            <AlertTitle>Cliente archivado</AlertTitle>
            <AlertDescription>
              No aparece en el listado de clientes activos ni se le puede cotizar. Su historial se conserva
              completo; restáuralo para volver a operarlo.
            </AlertDescription>
          </Alert>
        )}

        {/* Contacto directo: teléfono y correo como enlaces reales. */}
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
          <span className="inline-flex items-center gap-1.5">
            <Phone aria-hidden className="h-4 w-4 text-muted-foreground" />
            {c.phone ? (
              <a href={`tel:${c.phone}`} className="font-mono text-code-sm text-primary hover:underline">
                {c.phone}
              </a>
            ) : (
              <span className="text-muted-foreground">Sin teléfono</span>
            )}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Mail aria-hidden className="h-4 w-4 text-muted-foreground" />
            {c.email ? (
              <a href={`mailto:${c.email}`} className="text-primary hover:underline">
                {c.email}
              </a>
            ) : (
              <span className="text-muted-foreground">Sin correo</span>
            )}
          </span>
          {c.taxId ? (
            <span className="inline-flex items-center gap-1.5 text-muted-foreground">
              RFC <span className="font-mono text-code-sm text-foreground">{c.taxId}</span>
            </span>
          ) : null}
        </div>

        <CustomerSummaryTiles customerId={c.id} />

        <Tabs value={tab} onValueChange={setTab} defaultValue="resumen">
          <TabsList aria-label="Secciones de la ficha" className="overflow-x-auto">
            {TABS.map((t) => (
              <TabsTrigger key={t.value} value={t.value}>
                {t.label}
                {t.value === "conversaciones" && conversationsCount ? (
                  <span className="ml-1.5 text-xs text-muted-foreground tabular-nums">{conversationsCount}</span>
                ) : null}
                {t.value === "notas" && notesCount ? (
                  <span className="ml-1.5 text-xs text-muted-foreground tabular-nums">{notesCount}</span>
                ) : null}
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="resumen">
            <div className="grid gap-6 pt-6 xl:grid-cols-3">
              <div className="space-y-6 xl:col-span-2">
                <Section
                  title="Línea de tiempo"
                  description="Cotizaciones, pedidos, pagos, conversaciones y notas, de lo más reciente a lo más antiguo."
                  padded={false}
                >
                  <CustomerTimeline customerId={c.id} kind="all" />
                </Section>
              </div>
              <div className="space-y-6">
                <CustomerAddresses customerId={c.id} addresses={c.addresses} canWrite={canWrite && !isArchived} />

                <Section
                  title="Identidades"
                  description="Cuentas de mensajería vinculadas a este cliente."
                  headerIcon={<MessageCircle className="h-4 w-4" />}
                  density="compact"
                >
                  {c.identities.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      Sin identidades vinculadas. El cliente aún no ha escrito desde un canal reconocido.
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
                              <DateTime value={consent.grantedAt} withTime={false} className="text-xs text-muted-foreground" />
                            </span>
                          ) : (
                            <span className="inline-flex flex-wrap items-center gap-2">
                              <Badge variant="neutral" size="sm">
                                Revocado
                              </Badge>
                              <DateTime value={consent.revokedAt} withTime={false} className="text-xs text-muted-foreground" />
                            </span>
                          )}
                        </FieldRow>
                      );
                    })}
                  </DescriptionList>
                </Section>

                <Section title="Ficha" density="compact">
                  <DescriptionList divided>
                    <FieldRow label="Alta">
                      <DateTime value={c.createdAt} />
                    </FieldRow>
                    <FieldRow label="Última actualización">
                      <DateTime value={c.updatedAt} />
                    </FieldRow>
                    <FieldRow label="Último contacto">
                      {summaryQ.data?.lastContactAt ? <DateTime value={summaryQ.data.lastContactAt} /> : null}
                    </FieldRow>
                    <FieldRow label="Notas de la ficha">{c.notes}</FieldRow>
                  </DescriptionList>
                </Section>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="cotizaciones">
            <Section
              className="mt-6"
              title="Cotizaciones"
              description="Todas las cotizaciones de este cliente. Abre una para verla o compartirla."
              padded={false}
              actions={
                canWrite && !isArchived ? (
                  <Button size="sm" variant="outline" asChild>
                    <Link href="/quotes">Nueva cotización</Link>
                  </Button>
                ) : undefined
              }
            >
              <CustomerTimeline customerId={c.id} kind="quote" />
            </Section>
          </TabsContent>

          <TabsContent value="pedidos">
            <Section className="mt-6" title="Pedidos" description="Pedidos de este cliente, con origen y factura." padded={false}>
              <CustomerTimeline customerId={c.id} kind="order" />
            </Section>
          </TabsContent>

          <TabsContent value="pagos">
            <Section
              className="mt-6"
              title="Pagos"
              description="Sesiones de cobro de sus pedidos: cobradas, pendientes y reembolsos."
              padded={false}
            >
              <CustomerTimeline customerId={c.id} kind="payment" />
            </Section>
          </TabsContent>

          <TabsContent value="conversaciones">
            <Section
              className="mt-6"
              title="Conversaciones"
              description="Hilos de WhatsApp vinculados a esta ficha. Abre uno para verlo en la bandeja."
              padded={false}
              actions={
                conversationHref ? (
                  <Button size="sm" variant="outline" asChild>
                    <Link href={conversationHref}>Ir a la bandeja</Link>
                  </Button>
                ) : undefined
              }
            >
              <CustomerTimeline customerId={c.id} kind="conversation" />
            </Section>
          </TabsContent>

          <TabsContent value="fiscal">
            <div className="pt-6">
              <CustomerFiscal customer={c} canWrite={canWrite && !isArchived} />
            </div>
          </TabsContent>

          <TabsContent value="notas">
            <div className="pt-6">
              <CustomerNotes customerId={c.id} canWrite={canWrite} fixedNotes={c.notes} />
            </div>
          </TabsContent>
        </Tabs>
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

      <CustomerEditSheet customer={customer} open={editOpen} onOpenChange={setEditOpen} />
    </div>
  );
}
