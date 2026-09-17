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

  // Reverse-proxy /api/v1/* al backend de commerce-api. Vercel no aplica
  // rewrites externos de next.config.mjs ni vercel.json de forma confiable
  // para App Router, y un route handler en /api/v1/[...path] tampoco se
  // invocaba (404 desde Next.js sin llegar al backend). El rewrite desde
  // middleware SÍ funciona porque corre en el Edge runtime antes que
  // cualquier ruta y `NextResponse.rewrite()` sí envía la request al destino
  // externo sin que el cliente lo note.
  if (pathname.startsWith("/api/v1/") || pathname === "/api/v1") {
    const apiBase = (process.env.API_INTERNAL_URL ?? "http://localhost:4000")
      .replace(/\/$/, "");
    const target = new URL(`${apiBase}${pathname}${search}`);
    return NextResponse.rewrite(target);
  }

  // Raíz: si hay sesión → /dashboard (la home del portal), si no → /login.
  if (pathname === "/") {
    const dest = hasSessionCookie(req) ? "/dashboard" : "/login";
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

export const config = {
  matcher: [
    "/((?!_next/|favicon\\.ico|.*\\.(?:png|jpg|jpeg|svg|webp|ico|css|js)$).*)",
  ],
};
