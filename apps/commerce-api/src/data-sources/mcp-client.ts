/**
 * Cliente MCP mínimo sobre Streamable HTTP (JSON-RPC 2.0 por POST):
 * `initialize` → `notifications/initialized` → `tools/list` / `tools/call`.
 *
 * El servidor puede responder JSON directo o un flujo `text/event-stream`;
 * aquí se lee el flujo completo y se toma el mensaje con el `id` esperado
 * (suficiente para tools de listado; no se abre el canal GET de eventos).
 * Reusa httpRequest: timeout, reintentos y guardia anti-SSRF.
 */

import { ConnectionAuth, DataSourceHttpError, HttpOptions, buildAuthHeaders, httpRequest, parseJsonText } from "./http-client.js";

export const MCP_PROTOCOL_VERSION = "2025-03-26";

export interface McpTool {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

export interface McpToolResult {
  content?: Array<{ type: string; text?: string; [key: string]: unknown }>;
  structuredContent?: unknown;
  isError?: boolean;
}

interface JsonRpcResponse {
  jsonrpc?: string;
  id?: number | string | null;
  result?: unknown;
  error?: { code?: number; message?: string; data?: unknown };
}

/**
 * Extrae la respuesta JSON-RPC con `id` de un cuerpo JSON o SSE.
 * Exportado para probarlo sin red.
 */
export function parseJsonRpcBody(text: string, contentType: string | null, id: number): JsonRpcResponse {
  const isSse = (contentType ?? "").toLowerCase().includes("text/event-stream");
  const candidates: unknown[] = [];
  if (isSse) {
    for (const block of text.split(/\r?\n\r?\n/)) {
      const data = block
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .join("\n");
      if (!data) continue;
      try {
        candidates.push(JSON.parse(data));
      } catch {
        // Un evento no-JSON (ping, comentario) se ignora.
      }
    }
  } else {
    candidates.push(parseJsonText(text, "MCP"));
  }
  for (const candidate of candidates.flatMap((c) => (Array.isArray(c) ? c : [c]))) {
    if (candidate && typeof candidate === "object" && (candidate as JsonRpcResponse).id === id) {
      return candidate as JsonRpcResponse;
    }
  }
  throw new DataSourceHttpError(`MCP: sin respuesta JSON-RPC para id=${id}`);
}

/**
 * Convierte el resultado de una tool a datos: `structuredContent` si existe;
 * si no, el JSON de los bloques de texto (uno = ese valor; varios = arreglo).
 */
export function decodeToolResult(result: McpToolResult): unknown {
  if (result.isError) {
    const text = (result.content ?? [])
      .map((c) => (typeof c.text === "string" ? c.text : ""))
      .filter(Boolean)
      .join(" ")
      .slice(0, 300);
    throw new DataSourceHttpError(`MCP: la tool devolvió error${text ? `: ${text}` : ""}`);
  }
  if (result.structuredContent !== undefined && result.structuredContent !== null) {
    return result.structuredContent;
  }
  const texts = (result.content ?? []).filter((c) => c.type === "text" && typeof c.text === "string");
  if (texts.length === 0) throw new DataSourceHttpError("MCP: la tool no devolvió contenido de texto ni structuredContent");
  const decoded = texts.map((c) => parseJsonText(c.text as string, "MCP tool"));
  return decoded.length === 1 ? decoded[0] : decoded;
}

export class McpClient {
  private nextId = 1;
  private sessionId: string | null = null;
  private initialized = false;

  constructor(
    private readonly url: string,
    private readonly auth: ConnectionAuth,
    private readonly options: HttpOptions = {},
  ) {}

  private headers(): Record<string, string> {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": MCP_PROTOCOL_VERSION,
      ...buildAuthHeaders(this.auth),
    };
    if (this.sessionId) headers["mcp-session-id"] = this.sessionId;
    return headers;
  }

  private async rpc(method: string, params: Record<string, unknown>): Promise<unknown> {
    const id = this.nextId++;
    const res = await httpRequest(
      this.url,
      { method: "POST", headers: this.headers(), body: JSON.stringify({ jsonrpc: "2.0", id, method, params }) },
      this.options,
    );
    const session = res.headers.get("mcp-session-id");
    if (session) this.sessionId = session;
    const message = parseJsonRpcBody(res.text, res.headers.get("content-type"), id);
    if (message.error) {
      throw new DataSourceHttpError(`MCP ${method}: ${message.error.message ?? "error"} (${message.error.code ?? "?"})`);
    }
    return message.result;
  }

  private async notify(method: string): Promise<void> {
    // Las notificaciones no llevan id ni esperan cuerpo; un 202 vacío es lo normal.
    await httpRequest(
      this.url,
      { method: "POST", headers: this.headers(), body: JSON.stringify({ jsonrpc: "2.0", method }) },
      { ...this.options, retries: 0 },
    );
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    await this.rpc("initialize", {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "easysell-data-sources", version: "1.0.0" },
    });
    this.initialized = true;
    try {
      await this.notify("notifications/initialized");
    } catch {
      // Algunos servidores stateless rechazan la notificación; no es fatal.
    }
  }

  async listTools(): Promise<McpTool[]> {
    await this.initialize();
    const tools: McpTool[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 20; page += 1) {
      const result = (await this.rpc("tools/list", cursor ? { cursor } : {})) as {
        tools?: McpTool[];
        nextCursor?: string;
      } | null;
      for (const tool of result?.tools ?? []) {
        if (tool && typeof tool.name === "string") tools.push(tool);
      }
      if (!result?.nextCursor) break;
      cursor = result.nextCursor;
    }
    return tools;
  }

  async callTool(name: string, args: Record<string, unknown> = {}): Promise<McpToolResult> {
    await this.initialize();
    const result = await this.rpc("tools/call", { name, arguments: args });
    if (!result || typeof result !== "object") {
      throw new DataSourceHttpError("MCP: tools/call devolvió un resultado vacío");
    }
    return result as McpToolResult;
  }
}
