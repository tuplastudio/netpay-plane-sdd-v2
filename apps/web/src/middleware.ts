import { NextResponse, type NextRequest } from "next/server";

// Cookie del refresh token opaco (ver `REFRESH_COOKIE` en
// `apps/commerce-api/src/auth/guards/principal.guard.ts`). El access JWT no
// viaja en cookie, así que esto solo indica "hay refresh vivo", no que el
// access en memoria del cliente siga vigente — el propio front revalida con
// `/auth/refresh` si hace falta.
const SESSION_COOKIE_PROD = "__Host-refresh";
const SESSION_COOKIE_DEV = "refresh";

const PROTECTED_PREFIXES = [
  "/admin",
  "/catalog",
  "/channels",
  "/chat",
  "/conversations",
  "/customers",
  "/orders",
  "/payments",
  "/quick-charge",
  "/quotes",
  "/soporte",
  "/super-admin",
];

// Sub-rutas públicas dentro de un prefijo protegido: el cliente final las
// abre sin sesión (link de cotización, seguimiento de pedido). Sin esto,
// `/quotes` y `/orders` como prefijos protegidos bloqueaban también estas
// rutas y redirigían a /login a un cliente que nunca tuvo cuenta.
const PUBLIC_SUBPATHS = ["/quotes/public/", "/orders/public/"];

function isProtectedPath(pathname: string): boolean {
  if (PUBLIC_SUBPATHS.some((p) => pathname.startsWith(p))) return false;
  if (pathname === "/agent") return true;
  return PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

function hasSessionCookie(req: NextRequest): boolean {
  return (
    req.cookies.has(SESSION_COOKIE_PROD) ||
    req.cookies.has(SESSION_COOKIE_DEV)
  );
}

/**
 * IP del cliente tal como la fija la plataforma: `request.ip` (Vercel/Next
 * ≤14), `x-real-ip` (Vercel y nginx) o el primer salto de `x-forwarded-for`
 * (Vercel sobrescribe ese header; no es el valor que mandó el navegador).
 */
function clientIpOf(req: NextRequest): string | null {
  const fromPlatform = (req as NextRequest & { ip?: string }).ip;
  if (fromPlatform) return fromPlatform;
  const realIp = req.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;
  const firstHop = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return firstHop || null;
}

export async function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  if (pathname.startsWith("/api/v1/") || pathname === "/api/v1") {
    const apiBase = (process.env.API_INTERNAL_URL ?? "").replace(/\/$/, "");
    if (!apiBase) {
      return NextResponse.json(
        { error: "MISSING_API_INTERNAL_URL" },
        { status: 500 },
      );
    }
    const target = `${apiBase}${pathname}${search}`;
    const headers = new Headers();
    const reqContentType = req.headers.get("content-type");
    if (reqContentType) headers.set("content-type", reqContentType);
    const cookie = req.headers.get("cookie");
    if (cookie) headers.set("cookie", cookie);
    // Access JWT: viaja en Authorization, no en cookie. Sin reenviarlo
    // PrincipalGuard no ve el Bearer y cae siempre al caso sin sesión.
    const authorization = req.headers.get("authorization");
    if (authorization) headers.set("authorization", authorization);
    // commerce-api valida `Origin`/`Referer` contra su allowlist (CSRF) en
    // las mutaciones con cookie: sin reenviarlos ese chequeo no corre.
    const origin = req.headers.get("origin");
    if (origin) headers.set("origin", origin);
    const referer = req.headers.get("referer");
    if (referer) headers.set("referer", referer);
    // IP real del cliente para que el rate limit sea por cliente y no por IP
    // de salida de Vercel. Solo la reenviamos nosotros (no se concatena lo
    // que mande el navegador más allá del primer salto que fija el edge).
    const clientIp = clientIpOf(req);
    if (clientIp) {
      headers.set("x-forwarded-for", clientIp);
      headers.set("x-real-ip", clientIp);
    }

    let upstream: Response;
    try {
      upstream = await fetch(target, {
        method: req.method,
        headers,
        body:
          req.method === "GET" || req.method === "HEAD"
            ? undefined
            : await req.arrayBuffer(),
        cache: "no-store",
      });
    } catch (err) {
      // El detalle (URL interna, mensaje de red) solo al log del servidor.
      console.error("[middleware] commerce-api unreachable:", (err as Error).message);
      return NextResponse.json(
        {
          error: "BACKEND_UNREACHABLE",
          message: "El servicio no está disponible. Intenta de nuevo en unos segundos.",
        },
        { status: 502 },
      );
    }

    const resHeaders = new Headers(upstream.headers);
    resHeaders.delete("content-encoding");
    resHeaders.delete("transfer-encoding");
    resHeaders.delete("content-length");
    // Un 2xx con `Location` (p. ej. el 201 de POST /orders/public/:token/
    // checkout) llega al navegador sin cuerpo en Vercel: el edge lo trata
    // como redirección y descarta el JSON. Solo tiene sentido en 3xx.
    if (upstream.status < 300 || upstream.status >= 400) {
      resHeaders.delete("location");
    }
    return new NextResponse(upstream.body, {
      status: upstream.status,
      headers: resHeaders,
    });
  }

  // El checkout hosted (`/pay/*`) NO pasa por aquí: vive en
  // `app/pay/[[...path]]/route.ts`. Vercel no invocaba el middleware para ese
  // prefijo aunque estuviera en el matcher (ver docs/30-pendientes-2026-09.md).

  if (pathname === "/") {
    const dest = hasSessionCookie(req) ? "/dashboard" : "/login";
    return NextResponse.redirect(new URL(dest, req.url));
  }

  if (isProtectedPath(pathname) && !hasSessionCookie(req)) {
    const loginUrl = new URL("/login", req.url);
    const next = `${pathname}${search}`;
    loginUrl.searchParams.set("next", next);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Todo menos estáticos: el middleware también redirige `/` y protege las
    // rutas con sesión, así que tiene que ver las páginas, no solo el API.
    "/((?!_next/|favicon\\.ico|.*\\.(?:png|jpg|jpeg|svg|webp|ico|css|js)$).*)",
  ],
};
