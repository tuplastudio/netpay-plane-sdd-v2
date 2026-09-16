/**
 * Proxy servidor → agent-service.
 *
 * El navegador nunca ve `AGENT_INTERNAL_KEY`: el secreto se inyecta acá,
 * del lado del servidor Next, y de ahí sale hacia el agente. Reemplaza el
 * rewrite plano de `next.config.mjs` (que no puede agregar headers) para
 * que el agente pueda exigir autenticación de servicio a servicio.
 */
import { NextRequest, NextResponse } from "next/server";

// Por defecto apunta a agent-v2 (puerto 8010) en dev. En producción (Vercel),
// si AGENT_INTERNAL_URL no está seteada, infiere desde API_INTERNAL_URL
// (commerce-api ya tiene el proxy a /api/v1/agent/*). Para depurar contra
// agent-service v1 (puerto 8000), exportar AGENT_INTERNAL_URL=http://localhost:8000.
const API_INTERNAL_URL_RESOLVED = (process.env.API_INTERNAL_URL ?? "http://localhost:4000").replace(
  /\/$/,
  "",
);
const AGENT_INTERNAL_URL = (
  process.env.AGENT_INTERNAL_URL ??
  `${API_INTERNAL_URL_RESOLVED}/api/v1/agent`
).replace(/\/$/, "");
const AGENT_INTERNAL_KEY = process.env.AGENT_INTERNAL_KEY ?? "";

const BODYLESS_METHODS = new Set(["GET", "HEAD"]);

interface AuthMe {
  tenantId: string | null;
  isSuperAdmin: boolean;
}

async function authenticatedTenant(req: NextRequest, requested: string | null): Promise<string | null> {
  const response = await fetch(`${API_INTERNAL_URL_RESOLVED}/api/v1/auth/me`, {
    headers: { cookie: req.headers.get("cookie") ?? "" },
    cache: "no-store",
  });
  if (!response.ok) return null;
  const body = (await response.json()) as { data?: AuthMe };
  const me = body.data;
  if (!me) return null;
  // Un usuario normal nunca elige el tenant en query/body. El override solo
  // existe para la consola de super-admin y se autoriza con la sesión real.
  if (me.isSuperAdmin && requested) return requested;
  return me.tenantId;
}

async function proxy(req: NextRequest, pathParts: string[]): Promise<NextResponse> {
  const target = new URL(`${AGENT_INTERNAL_URL}/${pathParts.join("/")}`);
  target.search = req.nextUrl.search;

  let jsonBody: Record<string, unknown> | null = null;
  let rawBody: ArrayBuffer | undefined;
  const hasBody = !BODYLESS_METHODS.has(req.method);
  const contentType = req.headers.get("content-type") ?? "";
  if (hasBody) {
    rawBody = await req.arrayBuffer();
    if (contentType.includes("application/json") && rawBody.byteLength) {
      try {
        jsonBody = JSON.parse(new TextDecoder().decode(rawBody)) as Record<string, unknown>;
      } catch {
        return NextResponse.json({ error: "INVALID_JSON" }, { status: 400 });
      }
    }
  }

  const requested = target.searchParams.get("tenantId") ??
    (typeof jsonBody?.tenantId === "string" ? jsonBody.tenantId : null);
  let tenantId: string | null;
  try {
    tenantId = await authenticatedTenant(req, requested);
  } catch {
    return NextResponse.json({ error: "AUTH_UNAVAILABLE" }, { status: 502 });
  }
  if (!tenantId) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  target.searchParams.set("tenantId", tenantId);
  if (jsonBody) jsonBody.tenantId = tenantId;

  const headers = new Headers();
  if (contentType) headers.set("content-type", contentType);
  // Reenviar la cookie de sesión del navegador: commerce-api exige pasar
  // su PrincipalGuard global antes de llegar al AgentProxyController. Sin
  // cookie el guard responde 401 "Autenticación requerida" y el agente
  // nunca se consulta. AgentProxyController reenvía esta misma cookie a
  // agent-v2, así que el navegador solo autentica una vez.
  const cookie = req.headers.get("cookie");
  if (cookie) headers.set("cookie", cookie);
  if (AGENT_INTERNAL_KEY) headers.set("x-internal-key", AGENT_INTERNAL_KEY);

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: req.method,
      headers,
      body: hasBody
        ? jsonBody
          ? JSON.stringify(jsonBody)
          : rawBody
        : undefined,
      cache: "no-store",
    });
  } catch (error) {
    return NextResponse.json(
      { error: "AGENT_UNREACHABLE", message: (error as Error).message },
      { status: 502 },
    );
  }

  const resHeaders = new Headers(upstream.headers);
  resHeaders.delete("content-encoding");
  resHeaders.delete("transfer-encoding");
  resHeaders.delete("content-length");
  return new NextResponse(upstream.body, { status: upstream.status, headers: resHeaders });
}

type RouteContext = { params: Promise<{ path: string[] }> };

export async function GET(req: NextRequest, ctx: RouteContext) {
  return proxy(req, (await ctx.params).path);
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  return proxy(req, (await ctx.params).path);
}

export async function DELETE(req: NextRequest, ctx: RouteContext) {
  return proxy(req, (await ctx.params).path);
}

// El formulario de /agent guarda con PUT (`/settings`), que antes no estaba
// exportado y Next respondía 405 sin llegar al agente.
export async function PUT(req: NextRequest, ctx: RouteContext) {
  return proxy(req, (await ctx.params).path);
}

export async function PATCH(req: NextRequest, ctx: RouteContext) {
  return proxy(req, (await ctx.params).path);
}
