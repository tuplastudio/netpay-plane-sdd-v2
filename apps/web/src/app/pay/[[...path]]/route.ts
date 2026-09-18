/**
 * Checkout hosted del gateway de pagos bajo `/pay/*`.
 *
 * El gateway no está expuesto a Internet (escucha solo en la red interna del
 * droplet). El navegador del cliente abre
 * `https://<web>/pay/checkout/<id>/hosted`; este handler reenvía a
 * `commerce-api` (`/api/v1/payments/dummy-proxy/<resto>`), que a su vez habla
 * con el gateway por la red interna.
 *
 * Va como route handler y no en `middleware.ts`: Vercel no invocaba el
 * middleware para `/pay/*` (respondía el 404 pre-generado de Next antes de
 * llegar a él) por más que el `matcher` lo incluyera. Un route handler es
 * una ruta real del App Router, así que no depende de ese matching.
 *
 * La página hosted arma sus llamadas relativas al prefijo desde el que se
 * sirve (`/pay`), así que aquí no hay que reescribir HTML.
 */
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const BODYLESS_METHODS = new Set(["GET", "HEAD"]);

async function proxy(req: NextRequest, pathParts: string[]): Promise<NextResponse> {
  const apiBase = (process.env.API_INTERNAL_URL ?? "").replace(/\/$/, "");
  if (!apiBase) {
    return NextResponse.json({ error: "MISSING_API_INTERNAL_URL" }, { status: 500 });
  }
  const rest = pathParts.map(encodeURIComponent).join("/");
  const target = `${apiBase}/api/v1/payments/dummy-proxy/${rest}${req.nextUrl.search}`;

  const headers = new Headers();
  const contentType = req.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);
  headers.set("accept-encoding", "identity");

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: req.method,
      headers,
      body: BODYLESS_METHODS.has(req.method) ? undefined : await req.arrayBuffer(),
      cache: "no-store",
      redirect: "manual",
    });
  } catch (err) {
    return NextResponse.json(
      { error: "PAYMENT_GATEWAY_UNREACHABLE", message: (err as Error).message },
      { status: 502 },
    );
  }

  const resHeaders = new Headers();
  const passthrough = ["content-type", "content-security-policy", "location"];
  for (const name of passthrough) {
    const value = upstream.headers.get(name);
    if (value) resHeaders.set(name, value);
  }
  resHeaders.set("cache-control", "no-store");
  return new NextResponse(upstream.body, { status: upstream.status, headers: resHeaders });
}

type RouteContext = { params: Promise<{ path?: string[] }> };

export async function GET(req: NextRequest, ctx: RouteContext) {
  return proxy(req, (await ctx.params).path ?? []);
}

export async function HEAD(req: NextRequest, ctx: RouteContext) {
  return proxy(req, (await ctx.params).path ?? []);
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  return proxy(req, (await ctx.params).path ?? []);
}
