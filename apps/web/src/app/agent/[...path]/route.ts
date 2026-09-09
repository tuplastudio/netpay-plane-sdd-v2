/**
 * Proxy servidor → agent-service.
 *
 * El navegador nunca ve `AGENT_INTERNAL_KEY`: el secreto se inyecta acá,
 * del lado del servidor Next, y de ahí sale hacia el agente. Reemplaza el
 * rewrite plano de `next.config.mjs` (que no puede agregar headers) para
 * que el agente pueda exigir autenticación de servicio a servicio.
 */
import { NextRequest, NextResponse } from "next/server";

const AGENT_INTERNAL_URL = (process.env.AGENT_INTERNAL_URL ?? "http://localhost:8000").replace(
  /\/$/,
  "",
);
const AGENT_INTERNAL_KEY = process.env.AGENT_INTERNAL_KEY ?? "";

const BODYLESS_METHODS = new Set(["GET", "HEAD"]);

async function proxy(req: NextRequest, pathParts: string[]): Promise<NextResponse> {
  const target = new URL(`${AGENT_INTERNAL_URL}/${pathParts.join("/")}`);
  target.search = req.nextUrl.search;

  const headers = new Headers();
  const contentType = req.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);
  if (AGENT_INTERNAL_KEY) headers.set("x-internal-key", AGENT_INTERNAL_KEY);

  const hasBody = !BODYLESS_METHODS.has(req.method);

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: req.method,
      headers,
      body: hasBody ? req.body : undefined,
      // @ts-expect-error -- requerido por undici al reenviar un body en stream
      duplex: hasBody ? "half" : undefined,
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
