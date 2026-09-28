"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { Lock } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import {
  accessForPath,
  canAccess,
  hasAny,
  hasScope,
  makePermissions,
  type Access,
  type Permissions,
  type Scope,
} from "@/lib/permissions";
import { useSession } from "./user-menu";

export interface UsePermissions extends Permissions {
  /** ¿Tiene el scope? `false` mientras la sesión no se hidrata. */
  can: (scope: Scope) => boolean;
  canAny: (scopes: readonly Scope[]) => boolean;
  canAccess: (access: Access) => boolean;
}

export function usePermissions(): UsePermissions {
  const session = useSession();
  return React.useMemo(() => {
    const p = makePermissions({ scopes: session?.scopes, isSuperAdmin: session?.isSuperAdmin });
    return {
      ...p,
      can: (scope) => hasScope(p, scope),
      canAny: (scopes) => hasAny(p, scopes),
      canAccess: (access) => canAccess(p, access),
    };
  }, [session?.scopes, session?.isSuperAdmin]);
}

/** Estado limpio de "sin permiso" para una sección completa. */
export function NoPermission({ className }: { className?: string }) {
  return (
    <EmptyState
      className={className}
      icon={<Lock className="h-5 w-5" />}
      title="No tienes permiso para ver esta sección"
      description="Tu rol en esta empresa no incluye este acceso. Si lo necesitas, pídele a la persona dueña o a un administrador que cambie tu rol."
      action={
        <Button asChild variant="secondary">
          <Link href="/dashboard">Ir al inicio</Link>
        </Button>
      }
    />
  );
}

/**
 * Guardia de páginas: si el rol no alcanza para la ruta actual, se pinta
 * `NoPermission` en lugar de la página, antes de que ésta dispare consultas
 * que volverían 403.
 */
export function RouteGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "/";
  const { canAccess: allowed } = usePermissions();
  if (!allowed(accessForPath(pathname))) return <NoPermission />;
  return <>{children}</>;
}
