import { NextResponse, type NextRequest } from "next/server";

const SESSION_COOKIE_PROD = "__Host-session";
const SESSION_COOKIE_DEV = "session";

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

// `/agent` exacto es la consola (protegida); `/agent/[...path]` es proxy
// server-side al backend (deja pasar — la auth la hace el backend con la
// cookie httpOnly que el `route.ts` re-envía).
function isProtectedPath(pathname: string): boolean {
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

export function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  // Raíz: si hay sesión → /catalog, si no → /login.
  if (pathname === "/") {
    const dest = hasSessionCookie(req) ? "/catalog" : "/login";
    return NextResponse.redirect(new URL(dest, req.url));
  }

  // Paths protegidos sin cookie → /login preservando el destino.
  if (isProtectedPath(pathname) && !hasSessionCookie(req)) {
    const loginUrl = new URL("/login", req.url);
    const next = `${pathname}${search}`;
    loginUrl.searchParams.set("next", next);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

// Evita correr el matcher en assets y rutas que sabemos que no necesitan
// auth (login, recover, checkout público, etc.).
export const config = {
  matcher: [
    "/((?!_next/|api/|favicon\\.ico|.*\\.(?:png|jpg|jpeg|svg|webp|ico|css|js)$).*)",
  ],
};
