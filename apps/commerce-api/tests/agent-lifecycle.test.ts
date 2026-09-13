import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentLifecycleClient } from "../src/whatsapp/agent-lifecycle.client.js";

/**
 * `AgentLifecycleClient`: cómo commerce-api le avisa al agente que un hilo
 * volvió al bot (`release`) o terminó (`close`).
 *
 * Lo que se fija:
 *  - Las URLs y la cabecera `x-internal-key` son las del contrato de agent-v2.
 *  - Un 404 (el agente no tenía hilo) cuenta como éxito: no hay nada que
 *    liberar ni cerrar, y no debe llenar el log.
 *  - Nunca lanza: agente caído o 5xx devuelven `false`/`ok:false`.
 *  - `closeMany` cierra todos aunque alguno falle y cuenta los episodios.
 */

type FetchCall = { url: string; init: RequestInit };

function stubFetch(handler: (call: FetchCall) => Response | Promise<Response>) {
  const calls: FetchCall[] = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    const call = { url, init };
    calls.push(call);
    return handler(call);
  });
  return calls;
}

describe("AgentLifecycleClient", () => {
  beforeEach(() => {
    process.env.AGENT_URL = "http://agent.test:8010";
    process.env.AGENT_INTERNAL_KEY = "secreto";
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.AGENT_URL;
    delete process.env.AGENT_INTERNAL_KEY;
  });

  it("release pega al endpoint correcto con la llave interna", async () => {
    const calls = stubFetch(() => new Response("{}", { status: 200 }));
    const ok = await new AgentLifecycleClient().release("t-1", "conv-1");
    expect(ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("http://agent.test:8010/conversations/conv-1/release?tenantId=t-1");
    expect(calls[0]!.init.method).toBe("POST");
    expect((calls[0]!.init.headers as Record<string, string>)["x-internal-key"]).toBe("secreto");
  });

  it("404 cuenta como liberado; 5xx y red caída devuelven false sin lanzar", async () => {
    stubFetch(() => new Response("", { status: 404 }));
    expect(await new AgentLifecycleClient().release("t", "c")).toBe(true);

    stubFetch(() => new Response("", { status: 503 }));
    expect(await new AgentLifecycleClient().release("t", "c")).toBe(false);

    stubFetch(() => {
      throw new Error("ECONNREFUSED");
    });
    expect(await new AgentLifecycleClient().release("t", "c")).toBe(false);
  });

  it("close borra por defecto y reporta si hubo episodio", async () => {
    const calls = stubFetch(
      () => new Response(JSON.stringify({ episode: { outcome: "ESCALADO" } }), { status: 200 }),
    );
    const result = await new AgentLifecycleClient().close("t-1", "conv-9");
    expect(result).toEqual({ ok: true, episodeCaptured: true });
    const url = new URL(calls[0]!.url);
    expect(url.pathname).toBe("/conversations/conv-9/close");
    expect(url.searchParams.get("tenantId")).toBe("t-1");
    expect(url.searchParams.get("delete")).toBe("true");
    expect(url.searchParams.get("channel")).toBe("whatsapp");
  });

  it("close sin episodio y close con 404", async () => {
    stubFetch(() => new Response(JSON.stringify({ episode: null }), { status: 200 }));
    expect(await new AgentLifecycleClient().close("t", "c", { delete: false })).toEqual({
      ok: true,
      episodeCaptured: false,
    });
    stubFetch(() => new Response("", { status: 404 }));
    expect(await new AgentLifecycleClient().close("t", "c")).toEqual({ ok: true, episodeCaptured: false });
  });

  it("closeMany cierra todos en lotes y cuenta episodios aunque alguno falle", async () => {
    const calls = stubFetch(({ url }) => {
      if (url.includes("/conversations/c2/")) throw new Error("timeout");
      return new Response(JSON.stringify({ episode: url.includes("c1") ? {} : null }), { status: 200 });
    });
    const captured = await new AgentLifecycleClient().closeMany("t", ["c1", "c2", "c3"], 2);
    expect(captured).toBe(1);
    expect(calls.map((c) => new URL(c.url).pathname)).toEqual([
      "/conversations/c1/close",
      "/conversations/c2/close",
      "/conversations/c3/close",
    ]);
  });

  it("sin AGENT_INTERNAL_KEY no manda la cabecera", async () => {
    delete process.env.AGENT_INTERNAL_KEY;
    const calls = stubFetch(() => new Response("{}", { status: 200 }));
    await new AgentLifecycleClient().release("t", "c");
    expect(calls[0]!.init.headers).toEqual({});
  });
});
