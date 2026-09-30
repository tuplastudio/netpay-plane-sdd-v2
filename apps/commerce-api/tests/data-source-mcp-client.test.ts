import { describe, expect, it } from "vitest";
import { McpClient, decodeToolResult, parseJsonRpcBody } from "../src/data-sources/mcp-client.js";

const noGuard = async () => undefined;
const auth = { authType: "API_KEY_HEADER" as const, credential: "k1", authHeaderName: "X-API-Key", headers: null };

interface Recorded {
  method: string;
  id?: number;
  headers: Record<string, string>;
}

/** Servidor MCP falso: responde JSON a cada método y opcionalmente por SSE. */
function fakeMcpServer(opts: { sse?: boolean; toolResult?: unknown } = {}) {
  const calls: Recorded[] = [];
  const fetchImpl = async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as { method: string; id?: number; params?: Record<string, unknown> };
    calls.push({ method: body.method, id: body.id, headers: init.headers as Record<string, string> });
    if (body.id === undefined) return new Response(null, { status: 202 });

    let result: unknown;
    switch (body.method) {
      case "initialize":
        result = { protocolVersion: "2025-03-26", capabilities: {}, serverInfo: { name: "fake" } };
        break;
      case "tools/list":
        result = body.params?.cursor
          ? { tools: [{ name: "get_stock" }] }
          : { tools: [{ name: "list_products", description: "Lista" }], nextCursor: "p2" };
        break;
      case "tools/call":
        result = opts.toolResult ?? {
          content: [{ type: "text", text: JSON.stringify({ products: [{ sku: "A", name: "Uno", price: 1 }] }) }],
        };
        break;
      default:
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, error: { code: -32601, message: "no existe" } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
    }
    const message = { jsonrpc: "2.0", id: body.id, result };
    if (opts.sse) {
      const text = `event: message\ndata: ${JSON.stringify(message)}\n\n: ping\n\n`;
      return new Response(text, { status: 200, headers: { "content-type": "text/event-stream", "mcp-session-id": "s-1" } });
    }
    return new Response(JSON.stringify(message), {
      status: 200,
      headers: { "content-type": "application/json", "mcp-session-id": "s-1" },
    });
  };
  return { calls, fetchImpl };
}

describe("cliente MCP (Streamable HTTP)", () => {
  it("inicializa una sola vez, propaga la sesión y lista tools con paginación", async () => {
    const server = fakeMcpServer();
    const client = new McpClient("https://mcp.example.com/mcp", auth, { fetchImpl: server.fetchImpl, guard: noGuard });
    const tools = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(["list_products", "get_stock"]);
    expect(server.calls.map((c) => c.method)).toEqual([
      "initialize",
      "notifications/initialized",
      "tools/list",
      "tools/list",
    ]);
    // La sesión devuelta en initialize viaja en las siguientes llamadas; la API key también.
    expect(server.calls[2]!.headers["mcp-session-id"]).toBe("s-1");
    expect(server.calls[2]!.headers["X-API-Key"]).toBe("k1");

    await client.callTool("list_products", { limit: 10 });
    expect(server.calls.filter((c) => c.method === "initialize")).toHaveLength(1);
  });

  it("llama tools y decodifica el JSON del contenido de texto", async () => {
    const server = fakeMcpServer();
    const client = new McpClient("https://mcp.example.com/mcp", auth, { fetchImpl: server.fetchImpl, guard: noGuard });
    const result = await client.callTool("list_products");
    expect(decodeToolResult(result)).toEqual({ products: [{ sku: "A", name: "Uno", price: 1 }] });
  });

  it("entiende respuestas SSE", async () => {
    const server = fakeMcpServer({ sse: true });
    const client = new McpClient("https://mcp.example.com/mcp", auth, { fetchImpl: server.fetchImpl, guard: noGuard });
    const tools = await client.listTools();
    expect(tools[0]!.name).toBe("list_products");
  });

  it("prefiere structuredContent y reporta isError", () => {
    expect(decodeToolResult({ structuredContent: { items: [1] }, content: [{ type: "text", text: "x" }] })).toEqual({ items: [1] });
    expect(() => decodeToolResult({ isError: true, content: [{ type: "text", text: "sin permiso" }] })).toThrow(/sin permiso/);
    expect(() => decodeToolResult({ content: [{ type: "image", data: "..." }] })).toThrow(/texto/);
  });

  it("propaga errores JSON-RPC", async () => {
    const server = fakeMcpServer();
    const client = new McpClient("https://mcp.example.com/mcp", auth, { fetchImpl: server.fetchImpl, guard: noGuard });
    await client.initialize();
    await expect((client as unknown as { rpc: (m: string, p: object) => Promise<unknown> }).rpc("nope", {})).rejects.toThrow(
      /no existe/,
    );
  });

  it("parseJsonRpcBody: toma el mensaje con el id esperado", () => {
    const sse = `data: {"jsonrpc":"2.0","id":1,"result":{"a":1}}\n\ndata: {"jsonrpc":"2.0","id":2,"result":{"b":2}}\n\n`;
    expect(parseJsonRpcBody(sse, "text/event-stream", 2).result).toEqual({ b: 2 });
    expect(() => parseJsonRpcBody(sse, "text/event-stream", 3)).toThrow(/id=3/);
    expect(parseJsonRpcBody('[{"id":5,"result":1}]', "application/json", 5).result).toBe(1);
  });
});
