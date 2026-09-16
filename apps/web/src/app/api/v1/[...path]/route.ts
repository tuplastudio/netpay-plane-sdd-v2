/**
 * Proxy catch-all para todo /api/v1/* del navegador → commerce-api.
 *
 * Vercel (CDN/Edge) no aplica rewrites de vercel.json ni next.config.mjs
 * de forma confiable para rutas externas en proyectos Next.js App Router —
 * las requests /api/v1/* llegaban como 404 desde Next.js en vez de
 * proxearse al backend. Este route handler lo resuelve: intercepta todas
 * las llamadas desde el navegador y las reenvía al droplet.
 *
 * Auth: reenviamos la cookie de sesión del navegador para que
 * commerce-api valide la sesión vía PrincipalGuard. El agente en
 * /agent/[...path]/route.ts también reenvía cookies y se encarga
 * de resolver el tenantId, así que las llamadas al agente no requieren
 * cookies aquí — ya se validaron antes en ese handler.
 */
import { NextRequest, NextResponse } from "next/server";

const API_INTERNAL_URL = (
  process.env.API_INTERNAL_URL ?? "http://localhost:4000"
).replace(/\/$/, "");

const BODYLESS = new Set(["GET", "HEAD", "DELETE"]);

type RouteContext = { params: Promise<{ path: string[] }> };

async function proxy(req: NextRequest, pathParts: string[]): Promise<NextResponse> {
  const target = new URL(`${API_INTERNAL_URL}/api/v1/${pathParts.join("/")}`);
  target.search = req.nextUrl.search;

  const contentType = req.headers.get("content-type") ?? "";
  const headers = new Headers();
  if (contentType) headers.set("content-type", contentType);

  const cookie = req.headers.get("cookie");
  if (cookie) headers.set("cookie", cookie);

  const hasBody = !BODYLESS.has(req.method);
  let body: ArrayBuffer | undefined;
  if (hasBody) {
    body = await req.arrayBuffer();
  }

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: req.method,
      headers,
      body: hasBody ? (body ?? undefined) : undefined,
      // @ts-expect-error duplex required when streaming body in undici
      duplex: hasBody ? "half" : undefined,
      cache: "no-store",
      credentials: "include",
    });
  } catch (err) {
    return NextResponse.json(
      { error: "BACKEND_UNREACHABLE", message: (err as Error).message },
      { status: 502 }
    );
  }

  const resHeaders = new Headers(upstream.headers);
  resHeaders.delete("content-encoding");
  resHeaders.delete("transfer-encoding");
  resHeaders.delete("content-length");
  resHeaders.delete("x-request-id");

  return new NextResponse(upstream.body, {
    status: upstream.status,
    headers: resHeaders,
  });
}

export async function GET(req: NextRequest, ctx: RouteContext) {
  return proxy(req, (await ctx.params).path);
}
export async function POST(req: NextRequest, ctx: RouteContext) {
  return proxy(req, (await ctx.params).path);
}
export async function PUT(req: NextRequest, ctx: RouteContext) {
  return proxy(req, (await ctx.params).path);
}
export async function PATCH(req: NextRequest, ctx: RouteContext) {
  return proxy(req, (await ctx.params).path);
}
export async function DELETE(req: NextRequest, ctx: RouteContext) {
  return proxy(req, (await ctx.params).path);
}
export async function HEAD(req: NextRequest, ctx: RouteContext) {
  return proxy(req, (await ctx.params).path);
}
export async function OPTIONS(req: NextRequest, ctx: RouteContext) {
  return proxy(req, (await ctx.params).path);
}
