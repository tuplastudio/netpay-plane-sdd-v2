"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { fetchAuthMe } from "@/lib/api";

/**
 * Fallback de la raíz (`/`). El middleware ya manda aquí cuando hay sesión,
 * así que esta pantalla casi nunca se ve; existe por si alguien escribe
 * `/` en la URL con un cliente que no respete redirects, o como destino
 * seguro si la cookie caduca justo al cargar.
 *
 * El servidor no conoce el rol del usuario (no hay DB en edge), así que la
 * decisión super-admin vs tenant la toma el cliente con `GET /auth/me`.
 * Mostramos un spinner mientras resuelve para no parpadear `/super-admin`
 * en la pantalla del tenant.
 */
export default function RootRedirect() {
  const router = useRouter();
  const me = useQuery({ queryKey: ["auth-me"], queryFn: fetchAuthMe, retry: false });

  useEffect(() => {
    if (me.isLoading) return;
    if (me.data?.isSuperAdmin) {
      router.replace("/super-admin");
      return;
    }
    router.replace("/dashboard");
  }, [me.isLoading, me.data, router]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted">
      <p className="text-sm text-muted-foreground">Cargando tu panel…</p>
    </main>
  );
}
