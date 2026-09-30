/**
 * Cliente mínimo de MCP sobre Streamable HTTP para hooks salientes.
 *
 * Secuencia por entrega (todo POST a la misma URL):
 *   1. `initialize`                 → toma `Mcp-Session-Id` si el servidor lo emite.
 *   2. `notifications/initialized`  → sin respuesta (202 esperado; se ignora).
 *   3. `tools/call { name, arguments }` → resultado o error JSON-RPC.
 *
 * El servidor puede contestar JSON plano o `text/event-stream`; en SSE se
 * toma el primer mensaje cuyo `id` coincide con la petición. Cada petición
 * lleva su propio timeout y `redirect: "manual"` (un 30x podría apuntar a la
 * red interna). Los headers de firma/autenticación los pone el llamador.
 */

export interface McpToolCallInput {
  url: URL;
  toolName: string;
  args: Record<string, unknown>;
  /** Headers extra (auth, firma, custom). */
  headers: Record<string, string>;
  /** Id JSON-RPC de la llamada `tools/call` (el id de la entrega sirve). */
  requestId: string;
  timeoutMs: number;
  fetchImpl: typeof fetch;
  /** Firma el cuerpo de cada petición (Streamable HTTP manda tres). */
  sign?: (body: string) => Record<string, string>;
}

export interface McpToolCallResult {
  ok: boolean;
  /** HTTP status de la petición `tools/call` (0 si no llegó a salir). */
  status: number;
  /** Cuerpo/resultado truncado para el historial. */
  body: string;
  error?: string;
}

export const MCP_PROTOCOL_VERSION = "2025-03-26";
const CLIENT_INFO = { name: "easysell-outbound-hooks", version: "1.0.0" };

interface JsonRpcMessage {
  jsonrpc?: string;
  id?: string | number | null;
  result?: unknown;
  error?: { code?: number; message?: string; data?: unknown };
}

/** Extrae mensajes JSON-RPC de una respuesta JSON o SSE. */
export function parseJsonRpcBody(contentType: string | null, text: string): JsonRpcMessage[] {
  const messages: JsonRpcMessage[] = [];
  const push = (raw: string) => {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        for (const item of parsed) if (item && typeof item === "object") messages.push(item as JsonRpcMessage);
      } else if (parsed && typeof parsed === "object") {
        messages.push(parsed as JsonRpcMessage);
      }
    } catch {
      // Línea no JSON: se ignora (comentarios SSE, keep-alive).
    }
  };
  if ((contentType ?? "").includes("text/event-stream")) {
    // Cada evento SSE es un bloque separado por línea en blanco; los `data:`
    // de un mismo bloque se concatenan con "\n".
    for (const block of text.split(/\r?\n\r?\n/)) {
      const data = block
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      if (data) push(data);
    }
    return messages;
  }
  if (text.trim()) push(text);
  return messages;
}

/** Texto de un `result` de `tools/call` para el historial. */
function summarizeResult(result: unknown): string {
  const obj = result as { content?: Array<{ type?: string; text?: string }>; structuredContent?: unknown };
  if (obj && Array.isArray(obj.content)) {
    const text = obj.content
      .filter((c) => c && c.type === "text" && typeof c.text === "string")
      .map((c) => c.text)
      .join("\n");
    if (text) return text;
  }
  return JSON.stringify(result ?? null);
}

export async function callMcpTool(input: McpToolCallInput): Promise<McpToolCallResult> {
  const sessionHeaders: Record<string, string> = {};

  const post = async (payload: Record<string, unknown>) => {
    const body = JSON.stringify(payload);
    const response = await input.fetchImpl(input.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": MCP_PROTOCOL_VERSION,
        ...input.headers,
        ...sessionHeaders,
        ...(input.sign ? input.sign(body) : {}),
      },
      body,
      redirect: "manual",
      signal: AbortSignal.timeout(input.timeoutMs),
    });
    const sessionId = response.headers.get("mcp-session-id");
    if (sessionId) sessionHeaders["mcp-session-id"] = sessionId;
    const text = await response.text();
    return { response, text, messages: parseJsonRpcBody(response.headers.get("content-type"), text) };
  };

  // 1. initialize
  const initId = `${input.requestId}:init`;
  const init = await post({
    jsonrpc: "2.0",
    id: initId,
    method: "initialize",
    params: { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: {}, clientInfo: CLIENT_INFO },
  });
  if (!init.response.ok) {
    return {
      ok: false,
      status: init.response.status,
      body: init.text,
      error: `initialize respondió HTTP ${init.response.status}`,
    };
  }
  const initReply = init.messages.find((m) => m.id === initId) ?? init.messages[0];
  if (initReply?.error) {
    return {
      ok: false,
      status: init.response.status,
      body: init.text,
      error: `initialize: ${initReply.error.message ?? "error JSON-RPC"}`,
    };
  }

  // 2. notifications/initialized (sin id, sin respuesta).
  await post({ jsonrpc: "2.0", method: "notifications/initialized" });

  // 3. tools/call
  const call = await post({
    jsonrpc: "2.0",
    id: input.requestId,
    method: "tools/call",
    params: { name: input.toolName, arguments: input.args },
  });
  if (!call.response.ok) {
    return {
      ok: false,
      status: call.response.status,
      body: call.text,
      error: `tools/call respondió HTTP ${call.response.status}`,
    };
  }
  const reply = call.messages.find((m) => m.id === input.requestId) ?? call.messages.find((m) => m.result || m.error);
  if (!reply) {
    return { ok: false, status: call.response.status, body: call.text, error: "Respuesta sin mensaje JSON-RPC" };
  }
  if (reply.error) {
    return {
      ok: false,
      status: call.response.status,
      body: JSON.stringify(reply.error),
      error: `JSON-RPC ${reply.error.code ?? ""}: ${reply.error.message ?? "error"}`.trim(),
    };
  }
  const result = reply.result as { isError?: boolean } | undefined;
  const summary = summarizeResult(reply.result);
  if (result && result.isError === true) {
    return { ok: false, status: call.response.status, body: summary, error: "La herramienta devolvió isError" };
  }
  return { ok: true, status: call.response.status, body: summary };
}
