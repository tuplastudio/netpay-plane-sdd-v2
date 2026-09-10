"use client";

import * as React from "react";
import { LogOut, User as UserIcon, ChevronsUpDown, KeyRound, CircleHelp } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { statusLabel } from "@/components/ui/status-badge";
import { api, fetchAuthMe } from "@/lib/api";
import {
  type SessionUser,
  clearSession,
  readSession,
  sessionFromMe,
  subscribeSession,
  writeSession,
} from "@/lib/session";

export type { SessionUser };
/** Reexport por compatibilidad: la caché vive en `@/lib/session`. */
export { writeSession };

/**
 * Menú de cuenta del topbar.
 *
 * Quién está dentro —y con qué rol— lo decide `GET /auth/me`, no el navegador:
 * el `localStorage` es solo caché para no parpadear mientras la consulta va en
 * vuelo. Si `/auth/me` contesta 401 la caché se borra (interceptor de
 * `lib/api.ts`) y el menú vuelve a "Entrar", así que no puede quedarse pintado
 * un usuario que el servidor ya no reconoce.
 */
export function UserMenu() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [cached, setCached] = React.useState<SessionUser | null>(null);
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);
    setCached(readSession());
    // El login navega con el topbar ya montado: sin esta suscripción el menú
    // no se enteraría de la sesión recién escrita hasta una recarga.
    return subscribeSession(() => setCached(readSession()));
  }, []);

  const me = useQuery({
    queryKey: ["auth-me"],
    queryFn: fetchAuthMe,
    // Un 401 es la respuesta, no un fallo de red: reintentarlo no cambia nada.
    retry: false,
  });

  // La respuesta del servidor refresca la caché completa, rol incluido: desde
  // que `/auth/me` contesta `role`, la copia guardada es solo el respaldo.
  React.useEffect(() => {
    if (!me.data) return;
    writeSession(sessionFromMe(me.data, readSession()?.role));
  }, [me.data]);

  const [logoutOpen, setLogoutOpen] = React.useState(false);
  const [loggingOut, setLoggingOut] = React.useState(false);
  const onLogout = React.useCallback(async () => {
    setLoggingOut(true);
    try {
      await api.post("/auth/logout");
    } catch {
      // ignore: invalidamos cliente de todos modos
    }
    clearSession();
    queryClient.removeQueries({ queryKey: ["auth-me"] });
    toast.success("Sesión cerrada");
    setLogoutOpen(false);
    setLoggingOut(false);
    router.push("/login");
  }, [queryClient, router]);

  // Precedencia: lo que dice el servidor > la caché, campo por campo (el rol
  // guardado solo entra si `/auth/me` no lo trajo). Un error (401 incluido)
  // deja el menú sin usuario aunque el `localStorage` conserve algo viejo.
  const user: SessionUser | null = me.data
    ? sessionFromMe(me.data, cached?.role)
    : me.isError
      ? null
      : cached;

  const initials = (user?.fullName || user?.email || "NP")
    .split(/\s+|@/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase())
    .join("");

  // Antes de montar, y mientras la primera consulta va en vuelo sin caché que
  // mostrar, se pinta el marcador neutro: enseñar "Entrar" a alguien con sesión
  // abierta y quitárselo medio segundo después es peor que esperar.
  if (!mounted || (me.isPending && !cached)) {
    return (
      <Button variant="ghost" size="icon" aria-label="Cuenta">
        <UserIcon className="h-4 w-4" />
      </Button>
    );
  }

  if (!user) {
    return (
      <Button asChild size="sm" className="h-9">
        <Link href="/login">Entrar</Link>
      </Button>
    );
  }

  // Nunca el enum crudo en pantalla: OWNER → "Propietario". Sin rol conocido no
  // se inventa uno: se muestra solo el tenant.
  const roleLabel = user.role ? statusLabel(user.role, "role") : null;
  // El super-admin gestiona la plataforma entera: se anuncia antes que el rol
  // de tenant, que para él es contexto secundario.
  const subtitle = [user.isSuperAdmin ? "Super-admin" : null, roleLabel, user.tenantSlug]
    .filter(Boolean)
    .join(" · ");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="h-9 gap-2 px-2 data-[state=open]:bg-muted">
          {/* Nombre accesible: el sr-only + el texto visible. Un aria-label
              aquí taparía el nombre que se ve en pantalla. */}
          <span className="sr-only">Menú de cuenta</span>
          <span
            aria-hidden
            // Iniciales: texto real sobre el acento, así que nivel TEXTO
            // (primary-strong, 5.20:1) y no el ornamento (primary, 3.52:1).
            className="flex h-7 w-7 items-center justify-center rounded-full bg-primary-strong text-xs font-semibold text-primary-foreground"
          >
            {initials || "NP"}
          </span>
          <span className="hidden max-w-[12rem] flex-col items-start leading-tight sm:flex">
            <span className="truncate text-xs font-medium">{user.fullName || user.email}</span>
            {subtitle ? (
              <span className="truncate text-xs text-muted-foreground">{subtitle}</span>
            ) : null}
          </span>
          <ChevronsUpDown aria-hidden className="hidden h-3.5 w-3.5 text-muted-foreground sm:inline-block" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="font-normal">
          <div className="flex flex-col">
            <span className="text-sm font-medium">{user.fullName || "Sin nombre"}</span>
            <span className="truncate text-xs text-muted-foreground">{user.email}</span>
            {user.isSuperAdmin ? (
              <span className="mt-1.5">
                <Badge variant="info" size="sm">
                  Super-admin
                </Badge>
              </span>
            ) : null}
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/admin?tab=seguridad">
            <KeyRound aria-hidden className="h-3.5 w-3.5" />
            <span>Cambiar contraseña</span>
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/soporte">
            <CircleHelp aria-hidden className="h-3.5 w-3.5" />
            <span>Soporte</span>
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => setLogoutOpen(true)}
          className="text-destructive focus:text-destructive"
        >
          <LogOut aria-hidden className="h-3.5 w-3.5" />
          <span>Cerrar sesión</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
      <ConfirmDialog
        open={logoutOpen}
        onOpenChange={setLogoutOpen}
        title="¿Cerrar sesión?"
        description="Tendrás que volver a iniciar sesión (y pasar la verificación en dos pasos si la tienes activa)."
        confirmLabel="Cerrar sesión"
        pending={loggingOut}
        onConfirm={() => void onLogout()}
      />
    </DropdownMenu>
  );
}

/** Identidad cacheada, al día con los cambios de sesión de esta pestaña. */
export function useSession() {
  const [user, setUser] = React.useState<SessionUser | null>(null);
  React.useEffect(() => {
    setUser(readSession());
    return subscribeSession(() => setUser(readSession()));
  }, []);
  return user;
}
