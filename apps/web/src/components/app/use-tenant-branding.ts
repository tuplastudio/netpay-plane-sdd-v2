"use client";

import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { usePathname } from "next/navigation";
import { fetchAuthMe } from "@/lib/api";
import type { AuthMe } from "@/lib/session";
import { useSession } from "./user-menu";

/** Nombre del producto: aparece solo cuando no hay empresa activa y como
 * sufijo del título de la pestaña. */
export const PLATFORM_NAME = "Easy Sell";

export interface TenantBrandingView {
  /** Nombre comercial de la empresa activa; `null` sin sesión o sin tenant. */
  name: string | null;
  logoUrl: string | null;
  /** Lo que se pinta como marca: el nombre del negocio o, sin él, el producto. */
  displayName: string;
  isLoading: boolean;
}

/**
 * Marca de la empresa activa para el chrome del portal (sidebar, drawer,
 * título de la pestaña). Lee `GET /auth/me` —misma clave de caché
 * `["auth-me"]` que el menú de cuenta, así una sola petición alimenta a
 * ambos— porque a diferencia de `GET /tenants/me` no exige `tenant.admin`:
 * un vendedor también tiene que ver el nombre de su empresa.
 *
 * Sin sesión en caché no consulta nada y se cae al nombre del producto.
 */
export function useTenantBranding(): TenantBrandingView {
  const session = useSession();
  const enabled = !!session;
  const me = useQuery<AuthMe>({
    queryKey: ["auth-me"],
    queryFn: fetchAuthMe,
    enabled,
    staleTime: 60_000,
  });
  const name = enabled ? (me.data?.tenantName?.trim() || null) : null;
  const logoUrl = enabled ? (me.data?.branding?.logoUrl ?? null) : null;
  return {
    name,
    logoUrl,
    displayName: name ?? PLATFORM_NAME,
    isLoading: enabled && me.isLoading,
  };
}

/**
 * `<Nombre del negocio> · Easy Sell` en la pestaña. Se reaplica en cada
 * cambio de ruta porque el App Router vuelve a escribir `<title>` desde la
 * `metadata` del layout al navegar.
 */
export function useTenantDocumentTitle(name: string | null): void {
  const pathname = usePathname();
  useEffect(() => {
    document.title = name ? `${name} · ${PLATFORM_NAME}` : PLATFORM_NAME;
  }, [name, pathname]);
}
