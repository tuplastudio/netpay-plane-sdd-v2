import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConfigService } from "@nestjs/config";
import type { Request, Response } from "express";
import { AgentProxyController } from "../src/agent-proxy.controller.js";
import { RequestContext, type Principal } from "../src/common/context/request-context.js";

/**
 * `AgentProxyController`: la frontera de autorización entre el navegador y
 * agent-v2. Lo que se fija aquí:
 *
 *  - `DELETE conversations/:id` (el "Nueva conversación" del chat web) lo
 *    puede hacer cualquier rol con `chat.write`, y el tenant que llega al
 *    agente es el del principal, nunca el que pida el cliente.
 *  - Cerrar/liberar/compactar y el resto de escrituras siguen exigiendo
 *    permisos de administración.
 *  - `POST chat` recorta `principalScopes` a los reales y fija `tenantId`.
 *  - El upstream tiene tope de espera: un agente colgado devuelve 504, uno
 *    caído 502, sin dejar la petición abierta para siempre.
 */

type Sent = { status: number; body: unknown };

function fakeConfig(env: Record<string, string> = {}): ConfigService {
  return { get: (key: string) => env[key] } as unknown as ConfigService;
}

function fakeReq(
  method: string,
  originalUrl: string,
  opts: { body?: unknown; contentType?: string } = {},
): Request {
  return {
    method,
    originalUrl,
    headers: {
      cookie: "sid=abc",
      ...(opts.contentType ? { "content-type": opts.contentType } : {}),
    },
    body: opts.body,
  } as unknown as Request;
}

function fakeRes(): { res: Response; sent: () => Sent } {
  let status = 200;
  let body: unknown;
  const res = {
    status(code: number) {
      status = code;
      return res;
    },
    json(payload: unknown) {
      body = payload;
      return res;
    },
    send(payload: unknown) {
      body = payload;
      return res;
    },
    setHeader() {
      return res;
    },
  };
  return { res: res as unknown as Response, sent: () => ({ status, body }) };
}

function asPrincipal(principal: Principal, fn: () => Promise<void>): Promise<void> {
  return RequestContext.run(fn, { principal });
}

const vendor: Principal = { type: "USER", userId: "u1", tenantId: "tenant-a", role: "VENDOR" };
const owner: Principal = { type: "USER", userId: "u2", tenantId: "tenant-a", role: "OWNER" };

type FetchCall = { url: string; init: RequestInit };

function stubFetch(handler: (call: FetchCall) => Response | Promise<Response>): FetchCall[] {
  const calls: FetchCall[] = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    const call = { url, init };
    calls.push(call);
    return handler(call);
  });
  return calls;
}

describe("AgentProxyController", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("VENDOR puede borrar su conversación y el tenant es el de la sesión", async () => {
    const calls = stubFetch(() => new Response('{"status":"deleted"}', { status: 200 }));
    const controller = new AgentProxyController(fakeConfig({ AGENT_URL: "http://agent.test:8010" }));
    const { res, sent } = fakeRes();
    await asPrincipal(vendor, () =>
      controller.proxy(fakeReq("DELETE", "/api/v1/agent/conversations/conv-1?tenantId=tenant-b"), res),
    );
    expect(sent().status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("http://agent.test:8010/conversations/conv-1?tenantId=tenant-a");
    expect(calls[0]!.init.method).toBe("DELETE");
  });

  it("VENDOR no puede cerrar, liberar ni compactar (siguen siendo de administración)", async () => {
    const calls = stubFetch(() => new Response("{}", { status: 200 }));
    const controller = new AgentProxyController(fakeConfig());
    for (const path of [
      "conversations/conv-1/close",
      "conversations/conv-1/release",
      "conversations/conv-1/compact",
    ]) {
      const { res, sent } = fakeRes();
      await asPrincipal(vendor, () => controller.proxy(fakeReq("POST", `/api/v1/agent/${path}`), res));
      expect(sent().status, path).toBe(403);
    }
    // Ni borrar solo el historial (`/messages`): distinto de tirar el hilo propio.
    const { res, sent } = fakeRes();
    await asPrincipal(vendor, () =>
      controller.proxy(fakeReq("DELETE", "/api/v1/agent/conversations/conv-1/messages"), res),
    );
    expect(sent().status).toBe(403);
    expect(calls).toHaveLength(0);
  });

  it("OWNER sí cierra conversaciones", async () => {
    const calls = stubFetch(() => new Response("{}", { status: 200 }));
    const controller = new AgentProxyController(fakeConfig());
    const { res, sent } = fakeRes();
    await asPrincipal(owner, () =>
      controller.proxy(
        fakeReq("POST", "/api/v1/agent/conversations/conv-1/close", {
          contentType: "application/json",
          body: {},
        }),
        res,
      ),
    );
    expect(sent().status).toBe(200);
    expect(calls).toHaveLength(1);
  });

  it("POST chat fija tenantId y recorta principalScopes a los del rol", async () => {
    const calls = stubFetch(
      () => new Response('{"conversationId":"c1","reply":"hola"}', { status: 200 }),
    );
    const controller = new AgentProxyController(fakeConfig());
    const { res, sent } = fakeRes();
    await asPrincipal(vendor, () =>
      controller.proxy(
        fakeReq("POST", "/api/v1/agent/chat", {
          contentType: "application/json",
          body: {
            tenantId: "tenant-b",
            conversationId: "c1",
            text: "hola",
            principalScopes: ["chat.write", "integrations.write", "orders.write"],
          },
        }),
        res,
      ),
    );
    expect(sent().status).toBe(200);
    const forwarded = JSON.parse(calls[0]!.init.body as string) as {
      tenantId: string;
      conversationId: string;
      principalScopes: string[];
    };
    expect(forwarded.tenantId).toBe("tenant-a");
    expect(forwarded.conversationId).toBe("c1");
    expect(forwarded.principalScopes).toEqual(["chat.write"]);
    expect((calls[0]!.init as { signal?: AbortSignal }).signal).toBeInstanceOf(AbortSignal);
  });

  it("un agente colgado devuelve 504 y uno caído 502", async () => {
    const controller = new AgentProxyController(fakeConfig());
    const chat = () =>
      fakeReq("POST", "/api/v1/agent/chat", { contentType: "application/json", body: { text: "x" } });

    stubFetch(() => {
      const err = new Error("The operation was aborted due to timeout");
      err.name = "TimeoutError";
      throw err;
    });
    const hung = fakeRes();
    await asPrincipal(vendor, () => controller.proxy(chat(), hung.res));
    expect(hung.sent().status).toBe(504);
    expect((hung.sent().body as { code: string }).code).toBe("AGENT_TIMEOUT");

    stubFetch(() => {
      throw new Error("ECONNREFUSED");
    });
    const down = fakeRes();
    await asPrincipal(vendor, () => controller.proxy(chat(), down.res));
    expect(down.sent().status).toBe(502);
    expect((down.sent().body as { code: string }).code).toBe("AGENT_UNREACHABLE");
  });
});
