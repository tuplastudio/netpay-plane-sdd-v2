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
      return NextResponse.json(
        {
          error: "BACKEND_UNREACHABLE",
          message: (err as Error).message,
          target,
        },
        { status: 502 },
      );
    }

    const resHeaders = new Headers(upstream.headers);
    resHeaders.delete("content-encoding");
    resHeaders.delete("transfer-encoding");
    resHeaders.delete("content-length");
    return new NextResponse(upstream.body, {
      status: upstream.status,
      headers: resHeaders,
    });
  }

  // Proxy del checkout hosted del dummy-gateway bajo /pay/*. La pasarela no
  // está expuesta al público (escucha 0.0.0.0:4100 dentro del droplet) y
  // devuelve URLs tipo http://localhost:4100/checkout/sessions/<id> que el
  // navegador del cliente final no puede abrir. Se reescriben aquí a
  // https://easysell.web.tupla.dev/pay/<resto> y se mandan a commerce-api
  // que tiene un endpoint proxy hacia el dummy-gateway en la red interna
  // del droplet.
  if (pathname.startsWith("/pay/")) {
    const apiBase = (process.env.API_INTERNAL_URL ?? "").replace(/\/$/, "");
    if (!apiBase) {
      return NextResponse.json(
        { error: "MISSING_API_INTERNAL_URL" },
        { status: 500 },
      );
    }
    // /pay/checkout/sessions/<id> → <apiBase>/payments/dummy-proxy/checkout/sessions/<id>
    const target = `${apiBase}/payments/dummy-proxy/${pathname.slice("/pay/".length)}${search}`;
    const headers = new Headers();
    const reqContentType = req.headers.get("content-type");
    if (reqContentType) headers.set("content-type", reqContentType);

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
      return NextResponse.json(
        {
          error: "DUMMY_UNREACHABLE",
          message: (err as Error).message,
          target,
        },
        { status: 502 },
      );
    }

    const resHeaders = new Headers(upstream.headers);
    resHeaders.delete("content-encoding");
    resHeaders.delete("transfer-encoding");
    resHeaders.delete("content-length");
    return new NextResponse(upstream.body, {
      status: upstream.status,
      headers: resHeaders,
    });
  }

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
    "/((?!_next/|favicon\\.ico|.*\\.(?:png|jpg|jpeg|svg|webp|ico|css|js)$).*)",
  ],
};
