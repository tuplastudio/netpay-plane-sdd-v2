import { beforeEach, describe, expect, it, vi } from "vitest";
import { encryptSecret } from "../src/common/crypto/secret-cipher.js";
import { verifySignature } from "../src/hooks/hook-signature.js";
import {
  buildAuthHeaders,
  buildCustomHeaders,
  OutboundDispatcherService,
} from "../src/hooks/outbound-dispatcher.service.js";
import type { PrismaService } from "../src/prisma/prisma.service.js";

/**
 * Despachador de hooks salientes con Prisma y `fetch` falsos.
 *
 * Lo que se fija:
 *  - REST: POST JSON firmado con `X-EasySell-Signature` verificable y headers
 *    de auth/custom; 2xx → SUCCESS con respuesta guardada.
 *  - Fallo (5xx, red, timeout) → FAILED con `nextAttemptAt` por backoff y
 *    `attempt` incrementado; agotados los intentos → DEAD.
 *  - El lock optimista: si otra instancia ya reservó la fila, no se envía.
 *  - MCP: `initialize` → `notifications/initialized` → `tools/call` con la
 *    plantilla de argumentos resuelta; `isError` cuenta como fallo.
 *  - La guardia anti-SSRF corta antes de salir a la red.
 */

process.env.TOKEN_ENCRYPTION_KEY_REF = "clave-de-pruebas";

const TENANT = "11111111-1111-1111-1111-111111111111";
const NOW = new Date("2026-01-15T17:00:00.000Z");
const SECRET = "whsec_pruebas";

interface Row {
  [key: string]: unknown;
  id: string;
  status: string;
  attempt: number;
  nextAttemptAt: Date;
  lockedAt: Date | null;
  hook: Record<string, unknown>;
}

function hookRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "h-1",
    tenantId: TENANT,
    name: "ERP",
    kind: "REST",
    targetUrl: "https://erp.example.com/webhooks/easysell",
    authType: "BEARER",
    credential: encryptSecret("token-123"),
    authHeaderName: null,
    signingSecret: encryptSecret(SECRET),
    events: ["order.created"],
    status: "ACTIVE",
    headers: { "X-Custom": "abc", Host: "evil" },
    toolName: null,
    argsTemplate: null,
    retryPolicy: { maxAttempts: 3, backoffSeconds: 30 },
    ...overrides,
  };
}

function deliveryRow(overrides: Record<string, unknown> = {}): Row {
  return {
    id: "d-1",
    tenantId: TENANT,
    hookId: "h-1",
    eventName: "order.created",
    eventId: "e-1",
    payload: {
      id: "e-1",
      event: "order.created",
      occurredAt: NOW.toISOString(),
      tenantId: TENANT,
      data: { orderId: "o-1", total: "100.00" },
      version: 1,
    },
    attempt: 0,
    status: "PENDING",
    nextAttemptAt: new Date(NOW.getTime() - 1000),
    lockedAt: null,
    createdAt: NOW,
    hook: hookRow(),
    ...overrides,
  };
}

/** Prisma en memoria con la semántica de `where` que usa el despachador. */
function makePrisma(rows: Row[]) {
  const matches = (row: Row, where: Record<string, unknown>): boolean => {
    if (where.id !== undefined && row.id !== where.id) return false;
    if (where.tenantId !== undefined && row.tenantId !== where.tenantId) return false;
    const status = where.status as { in?: string[] } | undefined;
    if (status?.in && !status.in.includes(row.status)) return false;
    const next = where.nextAttemptAt as { lte?: Date } | undefined;
    if (next?.lte && row.nextAttemptAt.getTime() > next.lte.getTime()) return false;
    const or = where.OR as Array<{ lockedAt?: null | { lt?: Date } }> | undefined;
    if (or) {
      const ok = or.some((clause) => {
        if (clause.lockedAt === null) return row.lockedAt === null;
        const lt = clause.lockedAt?.lt;
        return lt !== undefined && row.lockedAt !== null && row.lockedAt.getTime() < lt.getTime();
      });
      if (!ok) return false;
    }
    return true;
  };
  const applyData = (row: Row, data: Record<string, unknown>) => {
    for (const [key, value] of Object.entries(data)) {
      if (value && typeof value === "object" && "increment" in (value as object)) {
        row[key] = (row[key] as number) + (value as { increment: number }).increment;
      } else {
        row[key] = value;
      }
    }
  };
  return {
    rows,
    outboundHookDelivery: {
      findMany: async ({ where }: { where: Record<string, unknown> }) => rows.filter((r) => matches(r, where)),
      findFirst: async ({ where }: { where: Record<string, unknown> }) => rows.find((r) => matches(r, where)) ?? null,
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const hit = rows.filter((r) => matches(r, where));
        for (const row of hit) applyData(row, data);
        return { count: hit.length };
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = rows.find((r) => r.id === where.id)!;
        applyData(row, data);
        return row;
      },
    },
  };
}

function makeDispatcher(rows: Row[], fetchImpl: typeof fetch) {
  const prisma = makePrisma(rows);
  const dispatcher = new OutboundDispatcherService(prisma as unknown as PrismaService);
  dispatcher.fetchImpl = fetchImpl;
  dispatcher.assertUrl = async (url) => new URL(url);
  dispatcher.now = () => NOW;
  return { dispatcher, prisma };
}

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

describe("headers de auth y custom", () => {
  it("arma Bearer, API key y Basic según authType", () => {
    expect(buildAuthHeaders({ authType: "BEARER", authHeaderName: null }, "tok")).toEqual({ authorization: "Bearer tok" });
    expect(buildAuthHeaders({ authType: "API_KEY_HEADER", authHeaderName: "X-Api-Key" }, "k")).toEqual({
      "x-api-key": "k",
    });
    expect(buildAuthHeaders({ authType: "BASIC", authHeaderName: null }, "u:p")).toEqual({
      authorization: `Basic ${Buffer.from("u:p").toString("base64")}`,
    });
    expect(buildAuthHeaders({ authType: "NONE", authHeaderName: null }, "x")).toEqual({});
    expect(buildAuthHeaders({ authType: "BEARER", authHeaderName: null }, null)).toEqual({});
  });

  it("ignora headers reservados y valores no textuales", () => {
    expect(
      buildCustomHeaders({ "X-Custom": "abc", Host: "evil", "content-type": "x", "X-Num": 3, "X-Obj": { a: 1 } }),
    ).toEqual({ "x-custom": "abc", "x-num": "3" });
    expect(buildCustomHeaders(null)).toEqual({});
  });
});

describe("despachador REST", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
  });

  it("envía POST firmado y marca SUCCESS con la respuesta", async () => {
    fetchMock.mockResolvedValue(new Response('{"ok":true}', { status: 200 }));
    const rows = [deliveryRow()];
    const { dispatcher } = makeDispatcher(rows, fetchMock as unknown as typeof fetch);

    const attempted = await dispatcher.tick();

    expect(attempted).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe("https://erp.example.com/webhooks/easysell");
    expect(init.method).toBe("POST");
    expect(init.redirect).toBe("manual");
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer token-123");
    expect(headers["x-custom"]).toBe("abc");
    expect(headers.host).toBeUndefined();
    expect(headers["x-easysell-event"]).toBe("order.created");
    expect(headers["x-easysell-delivery"]).toBe("d-1");
    expect(headers["x-easysell-attempt"]).toBe("1");
    const body = init.body as string;
    expect(JSON.parse(body)).toMatchObject({ event: "order.created", data: { orderId: "o-1" }, version: 1 });
    expect(
      verifySignature({
        secret: SECRET,
        header: headers["x-easysell-signature"]!,
        body,
        now: Math.floor(NOW.getTime() / 1000),
      }),
    ).toBe(true);

    const row = rows[0]!;
    expect(row.status).toBe("SUCCESS");
    expect(row.attempt).toBe(1);
    expect(row.responseStatus).toBe(200);
    expect(row.responseBody).toBe('{"ok":true}');
    expect(row.error).toBeNull();
    expect(row.lockedAt).toBeNull();
    expect(row.deliveredAt).toEqual(NOW);
  });

  it("un 5xx deja FAILED con backoff y reintenta después", async () => {
    fetchMock.mockResolvedValue(new Response("boom", { status: 503 }));
    const rows = [deliveryRow()];
    const { dispatcher } = makeDispatcher(rows, fetchMock as unknown as typeof fetch);

    await dispatcher.tick();

    const row = rows[0]!;
    expect(row.status).toBe("FAILED");
    expect(row.attempt).toBe(1);
    expect(row.error).toBe("HTTP 503");
    expect(row.responseStatus).toBe(503);
    expect(row.responseBody).toBe("boom");
    // backoffSeconds=30, intento 1 → +30 s
    expect((row.nextAttemptAt as Date).toISOString()).toBe("2026-01-15T17:00:30.000Z");
    expect(row.lockedAt).toBeNull();

    // Todavía no toca: el barrido no la toma.
    expect(await dispatcher.tick()).toBe(0);

    // Pasa el tiempo: segundo intento, backoff 60 s.
    dispatcher.now = () => new Date("2026-01-15T17:00:31.000Z");
    expect(await dispatcher.tick()).toBe(1);
    expect(row.attempt).toBe(2);
    expect(row.status).toBe("FAILED");
    expect((row.nextAttemptAt as Date).toISOString()).toBe("2026-01-15T17:01:31.000Z");
  });

  it("agotados los intentos queda DEAD y ya no se barre", async () => {
    fetchMock.mockRejectedValue(Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }));
    const rows = [deliveryRow({ attempt: 2, status: "FAILED" })];
    const { dispatcher } = makeDispatcher(rows, fetchMock as unknown as typeof fetch);

    await dispatcher.tick();

    const row = rows[0]!;
    expect(row.attempt).toBe(3);
    expect(row.status).toBe("DEAD");
    expect(row.error).toContain("ECONNREFUSED");
    expect(row.responseStatus).toBeNull();

    dispatcher.now = () => new Date("2026-01-16T17:00:00.000Z");
    expect(await dispatcher.tick()).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("un timeout se describe y cuenta como fallo", async () => {
    fetchMock.mockRejectedValue(Object.assign(new Error("aborted"), { name: "TimeoutError" }));
    const rows = [deliveryRow()];
    const { dispatcher } = makeDispatcher(rows, fetchMock as unknown as typeof fetch);
    await dispatcher.tick();
    expect(rows[0]!.status).toBe("FAILED");
    expect(rows[0]!.error).toBe("Sin respuesta en 10 s");
  });

  it("no envía si otra instancia ya reservó la fila (lease vigente)", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 200 }));
    const rows = [deliveryRow({ lockedAt: new Date(NOW.getTime() - 5_000) })];
    const { dispatcher } = makeDispatcher(rows, fetchMock as unknown as typeof fetch);
    expect(await dispatcher.tick()).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();

    // Lease vencido (> 60 s): se considera huérfana y se retoma.
    rows[0]!.lockedAt = new Date(NOW.getTime() - 120_000);
    expect(await dispatcher.tick()).toBe(1);
    expect(rows[0]!.status).toBe("SUCCESS");
  });

  it("la guardia anti-SSRF corta antes de salir", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 200 }));
    const rows = [deliveryRow()];
    const { dispatcher } = makeDispatcher(rows, fetchMock as unknown as typeof fetch);
    dispatcher.assertUrl = async () => {
      throw Object.assign(new Error("bad"), { response: { message: "endpoint apunta a una dirección privada" } });
    };
    await dispatcher.tick();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(rows[0]!.status).toBe("FAILED");
    expect(rows[0]!.error).toBe("endpoint apunta a una dirección privada");
  });

  it("un hook deshabilitado no recibe entregas pendientes", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 200 }));
    const rows = [deliveryRow({ hook: hookRow({ status: "DISABLED" }) })];
    const { dispatcher } = makeDispatcher(rows, fetchMock as unknown as typeof fetch);
    await dispatcher.tick();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(rows[0]!.error).toBe("Hook deshabilitado");
    // Sin gastar reintentos: queda agotada hasta que se reactive y se reintente a mano.
    expect(rows[0]!.status).toBe("DEAD");
  });

  it("dispatchNow ignora la programación y devuelve la fila actualizada", async () => {
    fetchMock.mockResolvedValue(new Response("ok", { status: 201 }));
    const rows = [deliveryRow({ nextAttemptAt: new Date(NOW.getTime() + 60_000) })];
    const { dispatcher } = makeDispatcher(rows, fetchMock as unknown as typeof fetch);
    const result = await dispatcher.dispatchNow(TENANT, "d-1");
    expect(result?.status).toBe("SUCCESS");
    expect(result?.responseStatus).toBe(201);
    expect(await dispatcher.dispatchNow("otro-tenant", "d-1")).toBeNull();
  });
});

describe("despachador MCP", () => {
  it("hace initialize, initialized y tools/call con los argumentos de la plantilla", async () => {
    const calls: Array<{ body: Record<string, unknown>; headers: Record<string, string> }> = [];
    const fetchMock = vi.fn(async (_url: URL, init: RequestInit) => {
      const body = JSON.parse(init.body as string) as Record<string, unknown>;
      calls.push({ body, headers: init.headers as Record<string, string> });
      if (body.method === "initialize") {
        return jsonResponse(
          { jsonrpc: "2.0", id: body.id, result: { protocolVersion: "2025-03-26", capabilities: {} } },
          200,
          { "mcp-session-id": "sess-1" },
        );
      }
      if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
      // Respuesta SSE, como hacen varios servidores Streamable HTTP.
      const reply = { jsonrpc: "2.0", id: body.id, result: { content: [{ type: "text", text: "registrado" }] } };
      return new Response(`event: message\ndata: ${JSON.stringify(reply)}\n\n`, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    });
    const rows = [
      deliveryRow({
        hook: hookRow({
          kind: "MCP",
          authType: "API_KEY_HEADER",
          authHeaderName: "X-Api-Key",
          credential: encryptSecret("k-1"),
          targetUrl: "https://mcp.example.com/mcp",
          toolName: "registrar_pedido",
          argsTemplate: { orderId: "{{event.data.orderId}}", note: "Total {{data.total}}" },
        }),
      }),
    ];
    const { dispatcher } = makeDispatcher(rows, fetchMock as unknown as typeof fetch);

    await dispatcher.tick();

    expect(calls.map((c) => c.body.method)).toEqual(["initialize", "notifications/initialized", "tools/call"]);
    const call = calls[2]!;
    expect(call.body.params).toEqual({ name: "registrar_pedido", arguments: { orderId: "o-1", note: "Total 100.00" } });
    expect(call.headers["mcp-session-id"]).toBe("sess-1");
    expect(call.headers["x-api-key"]).toBe("k-1");
    expect(call.headers["x-easysell-signature"]).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
    expect(rows[0]!.status).toBe("SUCCESS");
    expect(rows[0]!.responseBody).toBe("registrado");
  });

  it("un resultado isError o un error JSON-RPC cuentan como fallo", async () => {
    const fetchMock = vi.fn(async (_url: URL, init: RequestInit) => {
      const body = JSON.parse(init.body as string) as Record<string, unknown>;
      if (body.method === "initialize") return jsonResponse({ jsonrpc: "2.0", id: body.id, result: {} });
      if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
      return jsonResponse({ jsonrpc: "2.0", id: body.id, error: { code: -32602, message: "Unknown tool" } });
    });
    const rows = [deliveryRow({ hook: hookRow({ kind: "MCP", toolName: "nope", authType: "NONE", credential: null }) })];
    const { dispatcher } = makeDispatcher(rows, fetchMock as unknown as typeof fetch);
    await dispatcher.tick();
    expect(rows[0]!.status).toBe("FAILED");
    expect(rows[0]!.error).toBe("JSON-RPC -32602: Unknown tool");
  });
});
