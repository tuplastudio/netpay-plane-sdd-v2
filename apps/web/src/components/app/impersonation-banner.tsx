"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LogOut, ShieldOff } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { api, fetchAuthMe } from "@/lib/api";

interface ImpersonationTarget {
  id: string;
  slug: string;
  name: string;
}

/**
 * Banner persistente mientras el super-admin está impersonando un tenant.
 *
 * Solo se monta si la sesión es de super-admin **y** hay cookie activa.
 * Mismo TTL que el `PrincipalGuard`: si el backend rechaza la cookie por
 * algún motivo (tenant deshabilitado, slug renombrado), el `GET /super-admin/
 * impersonate` lo refleja y el banner desaparece solo.
 *
 * Va entre la topbar y el `<main>` para que ocupe una franja visible incluso
 * al hacer scroll, y usa el chip de aviso (`warning-strong`) porque está
 * representando un modo distinto del normal — no es un error, pero tampoco
 * es lo de siempre.
 */
export function ImpersonationBanner() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const me = useQuery({
    queryKey: ["auth-me"],
    queryFn: fetchAuthMe,
    retry: false,
  });

  const current = useQuery({
    queryKey: ["super-admin", "impersonation"],
    queryFn: async () => {
      const res = await api.get<{ data: ImpersonationTarget | null }>(
        "/super-admin/impersonate",
      );
      return res.data.data;
    },
    enabled: !!me.data?.isSuperAdmin,
  });

  const stop = useMutation({
    mutationFn: async () => {
      await api.delete("/super-admin/impersonate");
    },
    onSuccess: async () => {
      toast.success("Volviste a la consola de plataforma");
      await queryClient.invalidateQueries({ queryKey: ["super-admin", "impersonation"] });
      await queryClient.invalidateQueries({ queryKey: ["auth-me"] });
      router.push("/super-admin");
    },
    onError: () => toast.error("No se pudo salir del modo empresa"),
  });

  if (!me.data?.isSuperAdmin) return null;
  if (!current.data) return null;

  const target = current.data;

  return (
    <div
      role="status"
      aria-live="polite"
      className="border-b border-warning/30 bg-warning-subtle text-warning-foreground"
    >
      <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center gap-3 px-4 py-2 sm:px-6 lg:px-8">
        <ShieldOff aria-hidden className="h-4 w-4 shrink-0" />
        <p className="min-w-0 flex-1 text-sm">
          Estás operando como <span className="font-semibold">{target.name}</span>
          <span className="ml-1 hidden font-mono text-xs uppercase opacity-80 sm:inline">
            ({target.slug})
          </span>
          . Todo lo que hagas aplica a esta empresa.
        </p>
        <Button
          variant="outline"
          size="sm"
          loading={stop.isPending}
          onClick={() => stop.mutate()}
          className="border-warning/40 hover:bg-warning/15"
        >
          <LogOut aria-hidden className="h-3.5 w-3.5" />
          Salir del modo empresa
        </Button>
      </div>
    </div>
  );
}