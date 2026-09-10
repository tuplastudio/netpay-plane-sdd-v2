"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Building2,
  Check,
  ChevronsUpDown,
  Loader2,
  LogOut as StopImpersonating,
  Search,
  ShieldOff,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { statusLabel } from "@/components/ui/status-badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { api, fetchAuthMe, switchTenant } from "@/lib/api";
import { sessionFromMe, writeSession } from "@/lib/session";
import { cn } from "@/lib/utils";

interface TenantRow {
  id: string;
  slug: string;
  name: string;
  status: "ACTIVE" | "DISABLED";
}

interface ImpersonationTarget {
  id: string;
  slug: string;
  name: string;
}

const TENANTS_KEY = ["super-admin", "tenants"] as const;
const IMPERSONATION_KEY = ["super-admin", "impersonation"] as const;

/**
 * Selector de empresa del topbar.
 *
 * Dos modos que conviven en el mismo menú:
 *
 * 1. **Mis empresas** (cualquier usuario): las membresías activas que trae
 *    `GET /auth/me`. Elegir una llama a `POST /auth/switch-tenant`, que mueve
 *    la sesión a esa empresa; después se vacía la caché de consultas (todo lo
 *    cargado era de la empresa anterior), se vuelve a pedir `/auth/me` para
 *    refrescar la identidad cacheada y se navega al inicio. Con una sola
 *    empresa y sin super-admin no hay nada que elegir: se pinta un chip fijo
 *    con el nombre.
 *
 * 2. **Plataforma** (solo super-admin): entrar a operar cualquier empresa
 *    aunque no sea miembro. Fija la cookie `impersonate=<slug>` y el
 *    `PrincipalGuard` la aplica con precedencia sobre la membresía. Mientras
 *    hay una empresa impersonada el botón va en `warning`: es la única señal
 *    con el menú cerrado y debe leerse como "modo plataforma con foco en X".
 *    Elegir una empresa propia estando impersonando sale de la impersonación
 *    (el backend borra la cookie al cambiar de tenant).
 */
export function TenantSwitcher() {
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const [search, setSearch] = React.useState("");

  const me = useQuery({
    queryKey: ["auth-me"],
    queryFn: fetchAuthMe,
    retry: false,
  });
  const isSuperAdmin = !!me.data?.isSuperAdmin;
  const memberships = React.useMemo(() => me.data?.memberships ?? [], [me.data]);
  const activeTenantId = me.data?.tenantId ?? null;

  const tenants = useQuery({
    queryKey: TENANTS_KEY,
    queryFn: async () => {
      const res = await api.get<{ data: TenantRow[] }>("/super-admin/tenants");
      return res.data.data;
    },
    enabled: isSuperAdmin,
  });

  const current = useQuery({
    queryKey: IMPERSONATION_KEY,
    queryFn: async () => {
      const res = await api.get<{ data: ImpersonationTarget | null }>("/super-admin/impersonate");
      return res.data.data;
    },
    enabled: isSuperAdmin,
  });

  const switchMembership = useMutation({
    mutationFn: switchTenant,
    onSuccess: async (target) => {
      // Todo lo cacheado (catálogo, pedidos, impersonación…) era de la
      // empresa anterior: se tira entero antes de pintar nada nuevo.
      queryClient.clear();
      try {
        const fresh = await queryClient.fetchQuery({ queryKey: ["auth-me"], queryFn: fetchAuthMe });
        writeSession(sessionFromMe(fresh, target.role));
      } catch {
        // El shell vuelve a pedir /auth/me al navegar; la caché local se
        // actualizará entonces.
      }
      toast.success(`Ahora estás en ${target.name}`);
      router.push("/");
      router.refresh();
    },
    onError: (error: unknown) => {
      const msg = (error as { response?: { data?: { message?: string } } })?.response?.data
        ?.message;
      toast.error(msg ?? "No se pudo cambiar de empresa");
    },
  });

  const start = useMutation({
    mutationFn: async (tenantId: string) => {
      const res = await api.post<{ data: ImpersonationTarget }>(
        `/super-admin/tenants/${tenantId}/impersonate`,
      );
      return res.data.data;
    },
    onSuccess: async (target) => {
      toast.success(`Viendo como ${target.name}`);
      await queryClient.invalidateQueries({ queryKey: IMPERSONATION_KEY });
      await queryClient.invalidateQueries({ queryKey: ["auth-me"] });
      // Salimos de /super-admin/* si estamos ahí: la sidebar ya no aplica.
      if (pathname?.startsWith("/super-admin")) {
        router.push("/");
      } else {
        router.refresh();
      }
    },
    onError: (error: unknown) => {
      const msg = (error as { response?: { data?: { message?: string } } })?.response?.data
        ?.message;
      toast.error(msg ?? "No se pudo impersonar la empresa");
    },
  });

  const stop = useMutation({
    mutationFn: async () => {
      await api.delete("/super-admin/impersonate");
    },
    onSuccess: async () => {
      toast.success("Volviste a la consola de plataforma");
      await queryClient.invalidateQueries({ queryKey: IMPERSONATION_KEY });
      await queryClient.invalidateQueries({ queryKey: ["auth-me"] });
      router.push("/super-admin");
    },
    onError: () => toast.error("No se pudo salir del modo empresa"),
  });

  if (!me.data) return null;

  const activeMembership = memberships.find((m) => m.tenantId === activeTenantId);
  const activeName = activeMembership?.name ?? me.data.tenantName ?? null;

  // Una sola empresa y sin plataforma: no hay nada que elegir. El chip fijo
  // deja claro en qué empresa se está sin ofrecer un menú vacío.
  if (!isSuperAdmin && memberships.length <= 1) {
    if (!activeName) return null;
    return (
      <span
        title="Solo perteneces a esta empresa"
        className="hidden h-9 max-w-[14rem] items-center gap-1.5 rounded-md border border-border px-2.5 text-sm font-medium text-muted-foreground sm:inline-flex sm:max-w-[18rem]"
      >
        <Building2 aria-hidden className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">{activeName}</span>
      </span>
    );
  }

  const impersonating = isSuperAdmin ? current.data : null;
  const active = (tenants.data ?? []).filter((t) => t.status === "ACTIVE");
  const filtered = active.filter(
    (t) =>
      !search ||
      t.name.toLowerCase().includes(search.toLowerCase()) ||
      t.slug.toLowerCase().includes(search.toLowerCase()),
  );

  const busy = switchMembership.isPending || start.isPending || stop.isPending;
  const buttonLabel = impersonating ? impersonating.name : (activeName ?? "Elegir empresa");

  return (
    <DropdownMenu onOpenChange={(open) => !open && setSearch("")}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              variant={impersonating ? "warning" : "outline"}
              size="sm"
              className={cn(
                "h-9 max-w-[14rem] gap-1.5 px-2.5 sm:max-w-[18rem]",
                impersonating && "border-warning-strong/40",
              )}
              loading={(isSuperAdmin && current.isLoading) || switchMembership.isPending}
            >
              {impersonating ? (
                <ShieldOff aria-hidden className="h-3.5 w-3.5" />
              ) : (
                <Building2 aria-hidden className="h-3.5 w-3.5" />
              )}
              <span className="truncate font-medium">{buttonLabel}</span>
              <ChevronsUpDown aria-hidden className="hidden h-3.5 w-3.5 text-muted-foreground sm:inline-block" />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>
          {impersonating
            ? `Estás operando la empresa "${impersonating.name}". Pulsa para cambiar o salir.`
            : memberships.length > 1
              ? "Cambiar entre tus empresas."
              : "Entrar a operar el portal de una empresa (catálogo, pedidos, agente)."}
        </TooltipContent>
      </Tooltip>

      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel className="font-normal">
          <div className="flex flex-col gap-0.5">
            <span className="text-sm font-medium">Cambiar de empresa</span>
            <span className="text-xs text-muted-foreground">
              {impersonating
                ? `Ahora ves ${impersonating.name} como super-admin.`
                : activeName
                  ? `Ahora estás en ${activeName}.`
                  : "Elige la empresa con la que quieres trabajar."}
            </span>
          </div>
        </DropdownMenuLabel>

        {memberships.length > 0 ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup aria-label="Mis empresas" className="py-1">
              <div className="px-2 pb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                Mis empresas
              </div>
              {memberships.map((m) => {
                const isCurrent = !impersonating && m.tenantId === activeTenantId;
                return (
                  <DropdownMenuItem
                    key={m.tenantId}
                    aria-current={isCurrent ? "true" : undefined}
                    onSelect={() => {
                      if (!isCurrent) switchMembership.mutate(m.tenantId);
                    }}
                    disabled={busy}
                    className="flex flex-col items-start gap-0"
                  >
                    <span className="flex w-full items-center gap-2">
                      <span className="truncate font-medium">{m.name}</span>
                      <Badge variant="neutral" size="sm" className="shrink-0">
                        {statusLabel(m.role, "role")}
                      </Badge>
                      {isCurrent ? (
                        <Check aria-hidden className="ml-auto h-4 w-4 shrink-0 text-primary-strong" />
                      ) : null}
                    </span>
                    <span className="font-mono text-[10px] uppercase text-muted-foreground">
                      {m.slug}
                    </span>
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuGroup>
          </>
        ) : null}

        {isSuperAdmin ? (
          <>
            <DropdownMenuSeparator />
            <div className="px-2 pb-1 pt-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Plataforma · ver cualquier empresa
            </div>
            <div className="px-2 pb-1">
              <div className="relative">
                <Search aria-hidden className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar empresa…"
                  className="h-8 pl-7 text-sm"
                  autoComplete="off"
                />
              </div>
            </div>

            <div aria-label="Empresas de la plataforma" className="max-h-56 overflow-y-auto py-1">
              {tenants.isLoading ? (
                <div className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground">
                  <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" />
                  Cargando empresas…
                </div>
              ) : filtered.length === 0 ? (
                <div className="px-3 py-2 text-sm text-muted-foreground">
                  {search ? "Sin coincidencias." : "No hay empresas activas."}
                </div>
              ) : (
                filtered.map((t) => {
                  const isCurrent = impersonating?.id === t.id;
                  return (
                    <DropdownMenuItem
                      key={t.id}
                      aria-current={isCurrent ? "true" : undefined}
                      onSelect={() => {
                        if (!isCurrent) start.mutate(t.id);
                      }}
                      disabled={busy}
                      className="flex flex-col items-start gap-0"
                    >
                      <span className="flex w-full items-center gap-2">
                        <span className="truncate font-medium">{t.name}</span>
                        {isCurrent ? (
                          <span className="ml-auto text-xs font-medium text-warning-strong">Activa</span>
                        ) : null}
                      </span>
                      <span className="font-mono text-[10px] uppercase text-muted-foreground">
                        {t.slug}
                      </span>
                    </DropdownMenuItem>
                  );
                })
              )}
            </div>
          </>
        ) : null}

        {impersonating ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => stop.mutate()}
              disabled={busy}
              className="text-warning-strong focus:text-warning-strong"
            >
              <StopImpersonating aria-hidden className="h-3.5 w-3.5" />
              <span>Salir y volver a la consola</span>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href={`/super-admin/${impersonating.id}`}>
                <Building2 aria-hidden className="h-3.5 w-3.5" />
                <span>Administrar {impersonating.name}</span>
              </Link>
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
