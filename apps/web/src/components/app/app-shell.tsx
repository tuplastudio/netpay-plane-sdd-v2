"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { api, fetchAuthMe } from "@/lib/api";
import { Brand, EnvFooter, SidebarCollapseToggle, SidebarNav } from "./sidebar-nav";
import { Topbar } from "./topbar";
import { ImpersonationBanner } from "./impersonation-banner";
import { hexToHsl, hslShift } from "@/lib/hex-to-hsl";

/**
 * Alturas del chrome, para referencia:
 *
 * - Topbar: `h-14` = 3.5rem (la misma que el bloque `Brand` del sidebar).
 * - `<main>`: `py-6` = 1.5rem + 1.5rem = 3rem.
 * - Chrome vertical total: 6.5rem.
 *
 * Ese 6.5rem es el número que las pantallas escribían a mano como
 * `lg:h-[calc(100dvh-6.5rem)]`. Con `FullHeightMain` ya no hace falta: el alto
 * sale del layout, así que si estas medidas cambian nada se desalinea.
 */

type SetFullHeight = (enabled: boolean) => void;

const FullHeightContext = React.createContext<SetFullHeight | null>(null);

/**
 * Marcador que una pantalla renderiza para pedirle al shell un `<main>` de alto
 * fijo y sin scroll propio, desde `lg` hacia arriba. Debajo de `lg` no cambia
 * nada: la página sigue creciendo y desplazándose como siempre.
 *
 * No pinta nada; solo enciende el modo mientras la pantalla está montada y lo
 * apaga al desmontarse (incluso navegando hacia atrás).
 *
 * @example
 * // src/app/(app)/chat/page.tsx
 * <>
 *   <FullHeightMain />
 *   <div className="flex flex-col lg:min-h-0 lg:flex-1">…</div>
 * </>
 */
export function FullHeightMain() {
  const setFullHeight = React.useContext(FullHeightContext);
  React.useEffect(() => {
    setFullHeight?.(true);
    return () => setFullHeight?.(false);
  }, [setFullHeight]);
  return null;
}

/**
 * Guardia de sesión: todas las pantallas bajo `(app)` pasan por `AppShell`,
 * así que este es el único lugar que necesita mandar a `/login` cuando el
 * backend ya no reconoce la cookie. `GET /auth/me` es la autoridad (ver
 * `lib/api.ts`); un 401 aquí significa "no hay sesión", no un error de red.
 */
function useRedirectIfSignedOut() {
  const router = useRouter();
  const { data, isError, error } = useQuery({
    queryKey: ["auth-me"],
    queryFn: fetchAuthMe,
    retry: false,
  });

  React.useEffect(() => {
    if (!isError) return;
    const status = (error as { response?: { status?: number } })?.response?.status;
    if (status === 401) router.replace("/login");
  }, [isError, error, router]);

// Marca del tenant (colores de admin?tab=marca): convierte los hex que
// llegan del backend a tripletas HSL y las monta sobre las variables de
// diseño que ya consumen `bg-primary`, `bg-secondary`, etc. Sin esto, los
// hex de marca solo viven en `--tenant-*` y el chrome sigue mostrando el
// rojo por defecto de Rausch.
  React.useEffect(() => {
    const branding = data?.branding;
    const root = document.documentElement;
    if (!branding) return;
    const primary = hexToHsl(branding.primaryColor);
    const secondary = hexToHsl(branding.secondaryColor);
    const accent = hexToHsl(branding.accentColor);
    // Override de los tokens del sistema (ver globals.css). Los "strong"
    // son el mismo tono un poco más saturado/oscuro para textos sobre el
    // primario y estados hover/active.
    if (primary) {
      root.style.setProperty("--primary", primary);
      root.style.setProperty("--primary-strong", primary);
      const darker = hslShift(primary, -5);
      const darkest = hslShift(primary, -10);
      if (darker) root.style.setProperty("--primary-strong-hover", darker);
      if (darkest) root.style.setProperty("--primary-strong-active", darkest);
      // El botón "primary" usa el nivel fuerte como relleno de fondo.
      root.style.setProperty("--primary", primary);
    }
    if (secondary) {
      root.style.setProperty("--secondary", secondary);
    }
    if (accent) {
      root.style.setProperty("--accent", accent);
    }
    // También dejamos los originales en variables `--tenant-*` por si
    // algún componente quiere leerlos directo (p. ej. el PDF).
    root.style.setProperty("--tenant-primary", branding.primaryColor);
    root.style.setProperty("--tenant-secondary", branding.secondaryColor);
    root.style.setProperty("--tenant-accent", branding.accentColor);
  }, [data?.branding]);
}

// El backend cierra la sesión tras 30 min sin actividad (ver
// `SessionService.resolveSession`) y lo hace a propósito: si alguien deja el
// navegador desbloqueado y sin tocar, la sesión debe caducar sola. Por
// diseño, `POST /auth/refresh` (el interceptor de `lib/api.ts` lo llama solo
// cuando una petición real acaba de recibir un 401) reaplica esa MISMA regla
// de inactividad — así que nunca revive una sesión que ya pasó los 30 min.
// Eso es correcto para seguridad, pero sin nada más, cualquiera que deje de
// interactuar por 30 min (leyendo un hilo largo, pensando qué escribir, con
// la pestaña abierta) pierde la sesión aunque siga muy dentro de las 12h
// absolutas — quejarse de que "no se mantiene abierta" es justo este caso.
//
// La pieza que faltaba: mientras la persona sigue genuinamente interactuando
// (clics, teclas, scroll) con la pestaña VISIBLE, se manda un refresh cada
// pocos minutos para que `lastActivityAt` nunca llegue a esos 30 min. Si deja
// de interactuar (se aleja, cambia de pestaña, se bloquea la pantalla), el
// heartbeat se detiene solo y la sesión expira exactamente igual que antes —
// no se toca la regla de seguridad del backend, solo se evita perderla en
// pleno uso activo.
const HEARTBEAT_CHECK_MS = 5 * 60 * 1000;
// Margen bajo el límite real del backend (30 min): si la última interacción
// real quedó más vieja que esto, no vale la pena mandar el refresh — ya
// pasaría el chequeo de inactividad del lado del servidor de todos modos.
const HEARTBEAT_FRESHNESS_MS = 25 * 60 * 1000;
const INTERACTION_EVENTS = ["mousedown", "mousemove", "keydown", "touchstart", "wheel", "scroll"] as const;

/**
 * Mantiene la sesión viva durante el uso real: ver comentario arriba. No
 * mete ningún estado en React (todo por refs) para no causar renders extra
 * en cada movimiento de mouse; el único efecto observable es la llamada de
 * red cada `HEARTBEAT_CHECK_MS`, y esa se descarta en silencio si falla —
 * el flujo normal de 401 → refresh → /login del interceptor sigue siendo la
 * red de seguridad si esto no alcanzó a correr (pestaña recién reabierta,
 * red caída, etc.).
 */
function useSessionHeartbeat(): void {
  const lastInteractionRef = React.useRef(Date.now());

  React.useEffect(() => {
    const markActive = () => {
      lastInteractionRef.current = Date.now();
    };
    for (const evt of INTERACTION_EVENTS) {
      window.addEventListener(evt, markActive, { passive: true });
    }

    const id = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - lastInteractionRef.current > HEARTBEAT_FRESHNESS_MS) return;
      void api.post("/auth/refresh").catch(() => {
        // Sin red o sesión ya vencida de verdad: no hay nada que hacer aquí,
        // la próxima petición real sigue su propio camino de 401 → /login.
      });
    }, HEARTBEAT_CHECK_MS);

    return () => {
      for (const evt of INTERACTION_EVENTS) {
        window.removeEventListener(evt, markActive);
      }
      window.clearInterval(id);
    };
  }, []);
}

const SIDEBAR_COLLAPSED_KEY = "netpay:sidebar-collapsed";

/**
 * Preferencia de riel contraído, recordada entre visitas.
 *
 * Arranca SIEMPRE expandida y se corrige en un efecto, no durante el render:
 * `localStorage` no existe en el servidor, así que leerlo al inicializar el
 * estado desincroniza la hidratación. El precio es un parpadeo en la primera
 * pintura para quien la dejó contraída; a cambio no hay error de hidratación.
 *
 * Todo acceso va en try/catch: en una ventana privada (o con las cookies de
 * sitio bloqueadas) `localStorage` lanza al tocarlo, y la app entera no puede
 * caerse por una preferencia cosmética.
 */
function useSidebarCollapsed(): [boolean, () => void] {
  const [collapsed, setCollapsed] = React.useState(false);

  React.useEffect(() => {
    try {
      if (window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1") setCollapsed(true);
    } catch {
      // Sin persistencia: se queda expandida, que es el default.
    }
  }, []);

  const toggle = React.useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? "1" : "0");
      } catch {
        // Ídem: la sesión actual sí cambia, solo no se recuerda.
      }
      return next;
    });
  }, []);

  return [collapsed, toggle];
}

export function AppShell({ children }: { children: React.ReactNode }) {
  useRedirectIfSignedOut();
  useSessionHeartbeat();
  const [fullHeight, setFullHeight] = React.useState(false);
  const [collapsed, toggleCollapsed] = useSidebarCollapsed();
  // Identidad estable: si cambiara en cada render, el efecto de
  // `FullHeightMain` se volvería a disparar en bucle.
  const setter = React.useCallback<SetFullHeight>((enabled) => setFullHeight(enabled), []);

  return (
    <FullHeightContext.Provider value={setter}>
      <TooltipProvider delayDuration={200}>
        <div
          className={cn(
            "min-h-screen bg-background",
            // Modo alto completo: el viewport manda y el scroll lo pone la
            // pantalla en el panel que corresponda. `min-h-0` en la cadena
            // entera para que un hijo con overflow pueda encogerse.
            fullHeight && "lg:flex lg:h-dvh lg:flex-col lg:overflow-hidden",
          )}
        >
          <a
            href="#main"
            className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-lg focus:border focus:bg-background focus:px-3 focus:py-1.5 focus:text-sm focus:font-medium focus:text-foreground focus:shadow-airbnb focus:outline-none focus:ring-2 focus:ring-foreground focus:ring-offset-2 focus:ring-offset-background"
          >
            Saltar al contenido
          </a>

          {/* El landmark navegable es el <nav> de SidebarNav; esta caja solo
              posiciona, así que es un <div> y no un <aside>: un <aside> es un
              landmark `complementary`, y uno sin nombre accesible envolviendo a
              la navegación principal solo añade una entrada muda a la lista de
              regiones del lector de pantalla. Bajo lg se oculta con
              display:none y la navegación vive en el drawer de la Topbar. */}
          <div
            className={cn(
              "fixed inset-y-0 left-0 z-20 hidden border-r bg-background transition-[width] duration-200 lg:flex lg:flex-col",
              collapsed ? "w-16" : "w-64",
            )}
          >
            <Brand className="border-b" collapsed={collapsed} />
            <div className="flex-1 overflow-y-auto">
              <SidebarNav collapsed={collapsed} />
            </div>
            <div className="mt-auto border-t p-2">
              <SidebarCollapseToggle collapsed={collapsed} onToggle={toggleCollapsed} />
            </div>
            <EnvFooter className="border-t" collapsed={collapsed} />
          </div>

          <div
            className={cn(
              collapsed ? "lg:pl-16" : "lg:pl-64",
              fullHeight && "lg:flex lg:min-h-0 lg:flex-1 lg:flex-col",
            )}
          >
            <Topbar />
            <ImpersonationBanner />
            <main
              id="main"
              tabIndex={-1}
              data-full-height={fullHeight ? "" : undefined}
              className={cn(
                "mx-auto w-full px-4 py-6 focus-visible:outline-none sm:px-6",
                // Contraer la barra lateral tiene que devolver ancho de verdad:
                // expandido el contenido se centra en 80rem (líneas legibles en
                // pantallas anchas), contraído se suelta el tope y se recorta el
                // padding lateral, que si no dejaba un carril muerto a cada lado.
                collapsed ? "max-w-none lg:px-4" : "max-w-7xl lg:px-8",
                fullHeight && "lg:flex lg:min-h-0 lg:flex-1 lg:flex-col",
              )}
            >
              {children}
            </main>
          </div>
        </div>
      </TooltipProvider>
    </FullHeightContext.Provider>
  );
}
