"use client";

import { use, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Ban, CheckCircle2, Package, Pencil, ShoppingCart, Users } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { SkeletonText } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { PageHeader } from "@/components/app/page-header";
import { Section } from "@/components/app/section";
import { StatTile } from "@/components/app/stat-tile";
import { DateTime } from "@/components/app/date-time";
import { RenameTenantSheet } from "./_components/rename-tenant-sheet";
import { TenantUsersTab } from "./_components/tenant-users-tab";
import { AgentTab } from "./_components/agent-tab";
import { TenantCostTab } from "./_components/tenant-cost-tab";
import { ApiKeysSection } from "@/app/(app)/admin/_components/api-keys-section";
import {
  SA_ROOT_KEY,
  type TenantDetail,
  type TenantStatus,
  apiErrorMessage,
  currentMonthLabel,
  formatInt,
  saTenantKey,
} from "../_shared";

export default function TenantDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const queryClient = useQueryClient();
  const [renameOpen, setRenameOpen] = useState(false);
  const [suspendOpen, setSuspendOpen] = useState(false);

  const tenant = useQuery({
    queryKey: saTenantKey(id),
    queryFn: async () => {
      const res = await api.get<{ data: TenantDetail }>(`/super-admin/tenants/${id}`);
      return res.data.data;
    },
  });

  const setStatus = useMutation({
    mutationFn: async (status: TenantStatus) => {
      await api.patch(`/super-admin/tenants/${id}/status`, { status });
    },
    onSuccess: async (_data, status) => {
      toast.success(status === "ACTIVE" ? "Empresa reactivada" : "Empresa suspendida");
      setSuspendOpen(false);
      await queryClient.invalidateQueries({ queryKey: SA_ROOT_KEY });
    },
    onError: (error) => {
      setSuspendOpen(false);
      toast.error(apiErrorMessage(error, "No se pudo actualizar el estado"));
    },
  });

  const t = tenant.data;
  const activeUsers = useMemo(
    () => t?.memberships.filter((m) => m.status === "ACTIVE").length ?? 0,
    [t],
  );

  const tile = {
    isLoading: tenant.isLoading,
    isError: tenant.isError,
    onRetry: () => void tenant.refetch(),
  };

  return (
    <div>
      <PageHeader
        title={t?.name ?? "Empresa"}
        backHref="/super-admin/tenants"
        breadcrumbs={[
          { label: "Plataforma", href: "/super-admin" },
          { label: "Empresas", href: "/super-admin/tenants" },
          { label: t?.name ?? "Detalle" },
        ]}
        meta={
          t ? (
            <>
              <StatusBadge status={t.status} domain="tenant" />
              <span className="font-mono text-xs">{t.slug}</span>
              <span aria-hidden>·</span>
              <span>
                Creada <DateTime value={t.createdAt} withTime={false} />
              </span>
            </>
          ) : undefined
        }
        actions={
          t ? (
            <>
              <Button variant="outline" size="sm" onClick={() => setRenameOpen(true)}>
                <Pencil className="h-3.5 w-3.5" />
                Renombrar
              </Button>
              {t.status === "ACTIVE" ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  onClick={() => setSuspendOpen(true)}
                >
                  <Ban className="h-3.5 w-3.5" />
                  Suspender
                </Button>
              ) : (
                <Button
                  size="sm"
                  loading={setStatus.isPending}
                  onClick={() => setStatus.mutate("ACTIVE")}
                >
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Reactivar
                </Button>
              )}
            </>
          ) : undefined
        }
      />

      {tenant.isError ? (
        <Alert variant="destructive">
          <AlertTitle>No se pudo cargar la empresa</AlertTitle>
          <AlertDescription>
            <p>{apiErrorMessage(tenant.error, "Revisa tu conexión e inténtalo de nuevo.")}</p>
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={() => void tenant.refetch()}
            >
              Reintentar
            </Button>
          </AlertDescription>
        </Alert>
      ) : (
        <Tabs defaultValue="summary">
          <TabsList className="mb-6">
            <TabsTrigger value="summary">Resumen</TabsTrigger>
            <TabsTrigger value="users">
              Usuarios
              {t ? (
                <span className="ml-1.5 tabular-nums text-muted-foreground">
                  {formatInt(t.memberships.length)}
                </span>
              ) : null}
            </TabsTrigger>
            <TabsTrigger value="costs">Costos</TabsTrigger>
            <TabsTrigger value="agent">Agente</TabsTrigger>
            <TabsTrigger value="api-keys">API keys</TabsTrigger>
          </TabsList>

          <TabsContent value="summary" className="space-y-6">
            <Section title="Resumen" description={`Mes en curso · ${currentMonthLabel()}`}>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <StatTile
                  {...tile}
                  label="Usuarios activos"
                  icon={<Users className="h-4 w-4" />}
                  value={formatInt(activeUsers)}
                  hint={
                    t === undefined
                      ? undefined
                      : t.memberships.length === activeUsers
                        ? "Todos con acceso"
                        : `${formatInt(t.memberships.length - activeUsers)} sin acceso o por aceptar`
                  }
                />
                <StatTile
                  {...tile}
                  label="Productos"
                  icon={<Package className="h-4 w-4" />}
                  value={formatInt(t?._count.products)}
                />
                <StatTile
                  {...tile}
                  label="Pedidos"
                  icon={<ShoppingCart className="h-4 w-4" />}
                  value={formatInt(t?._count.orders)}
                />
              </div>
            </Section>
          </TabsContent>

          <TabsContent value="users">
            {t ? (
              <TenantUsersTab tenant={t} />
            ) : (
              <Section title="Usuarios" padded>
                <SkeletonText lines={4} announce label="Cargando los usuarios…" />
              </Section>
            )}
          </TabsContent>

          <TabsContent value="costs">
            <TenantCostTab tenantId={id} />
          </TabsContent>

          <TabsContent value="agent">
            {t ? (
              <AgentTab tenantId={t.id} />
            ) : (
              <Section title="Agente" padded>
                <SkeletonText lines={4} announce label="Cargando la configuración del agente…" />
              </Section>
            )}
          </TabsContent>

          <TabsContent value="api-keys">
            <ApiKeysSection
              basePath={`/super-admin/tenants/${id}/api-keys`}
              description="Llaves de integración de esta empresa. El secreto solo se muestra al crearla."
            />
          </TabsContent>
        </Tabs>
      )}

      {t ? (
        <>
          <RenameTenantSheet
            tenantId={t.id}
            currentName={t.name}
            open={renameOpen}
            onOpenChange={setRenameOpen}
          />
          <ConfirmDialog
            open={suspendOpen}
            onOpenChange={setSuspendOpen}
            variant="destructive"
            title={`¿Suspender a ${t.name}?`}
            description={
              <>
                Sus usuarios dejan de poder entrar al portal y el agente deja de atender a sus
                clientes hasta que la reactives. Los datos se conservan.
              </>
            }
            confirmLabel="Suspender"
            pending={setStatus.isPending}
            // Type-to-confirm: hay que escribir el slug exacto para habilitar
            // el botón. Drena clics por error sobre empresas del mismo nombre.
            requireText={t.slug}
            requireTextPlaceholder={t.slug}
            onConfirm={() => setStatus.mutate("DISABLED")}
          />
        </>
      ) : null}
    </div>
  );
}
