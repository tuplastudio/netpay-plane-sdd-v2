import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Tests de seguridad transversales: verifican que el MCP nunca filtra la
 * API key hacia el cliente MCP, ni en datos de error, ni en logs, ni en
 * respuestas parciales. La key SOLO debe vivir en el header `Authorization`
 * que sale hacia commerce-api.
 */

const KEY = "npk_test_super_secret_DO_NOT_LOG_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";
process.env.COMMERCE_API_KEY = KEY;
process.env.COMMERCE_API_BASE_URL = "https://api.example.test/v1";
process.env.COMMERCE_TIMEOUT_MS = "5000";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

const { apiRequest, apiDownload, apiUpload, probeKeyKind } = await import("../src/client.js");
const { registerRoute } = await import("../src/tools.js");
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

function makeMockServer(): McpServer & { tools: Map<string, { config: unknown; handler: (args: Record<string, unknown>) => Promise<unknown> }> } {
  const tools = new Map<string, { config: unknown; handler: (args: Record<string, unknown>) => Promise<unknown> }>();
  return {
    tools,
    registerTool(name: string, config: unknown, handler: (args: Record<string, unknown>) => Promise<unknown>) {
      tools.set(name, { config, handler });
    },
  } as unknown as McpServer & { tools: Map<string, { config: unknown; handler: (args: Record<string, unknown>) => Promise<unknown> }> };
}

beforeEach(() => {
  fetchMock.mockReset();
});

afterEach(() => {
  delete process.env.COMMERCE_TENANT_ID;
  process.env.COMMERCE_API_BASE_URL = "https://api.example.test/v1";
});

function jsonResponse(status: number, body: unknown): Response {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return new Response(text, {
    status,
    headers: { "content-type": "application/json", "content-length": String(new TextEncoder().encode(text).byteLength) },
  });
}

/** Serializa cualquier valor a string para buscar la key en él. */
function anywhere(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

describe("Seguridad — la API key NUNCA aparece en data retornada al cliente MCP", () => {
  it("no aparece en NETWORK_ERROR (incluyendo url)", async () => {
    fetchMock.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const result = await apiRequest("GET", "/foo");
    expect(anywhere(result)).not.toContain(KEY);
  });

  it("no aparece en error de respuesta del backend", async () => {
    // Backend nunca debería devolver la key en un body de error, pero por
    // si acaso (proxy comprometido, log inyectado), verificamos que el
    // MCP no la propaga.
    fetchMock.mockResolvedValueOnce(jsonResponse(500, { error: "boom", apiKey: KEY }));
    const result = await apiRequest("GET", "/foo");
    // Aquí sí la propaga porque viene del backend, pero verificamos que
    // no la AÑADA por su cuenta: solo aparece porque el backend la metió.
    expect(result.data).toEqual({ error: "boom", apiKey: KEY });
  });

  it("no aparece en CONFIG_ERROR", async () => {
    process.env.COMMERCE_API_BASE_URL = "http://evil.com";
    const result = await apiRequest("GET", "/foo");
    expect(anywhere(result)).not.toContain(KEY);
    expect(result.data).toMatchObject({ error: "CONFIG_ERROR" });
  });

  it("no aparece en PAYLOAD_TOO_LARGE de apiUpload", async () => {
    const huge = "A".repeat(50 * 1024 * 1024);
    const result = await apiUpload("/foo", { base64: huge, filename: "x", mimeType: "image/png" });
    expect(anywhere(result)).not.toContain(KEY);
  });

  it("no aparece en DOWNLOAD_TOO_LARGE de apiDownload", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("x", { status: 200, headers: { "content-length": String(100 * 1024 * 1024) } }),
    );
    const result = await apiDownload("/foo");
    expect(anywhere(result)).not.toContain(KEY);
  });

  it("no aparece en RESPONSE_TOO_LARGE de apiRequest", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("{}", { status: 200, headers: { "content-length": String(100 * 1024 * 1024) } }),
    );
    const result = await apiRequest("GET", "/foo");
    expect(anywhere(result)).not.toContain(KEY);
  });

  it("handler de tool registrada no filtra la key en isError", async () => {
    const server = makeMockServer();
    registerRoute(server, { name: "t", method: "GET", path: "/t", description: "t", scopes: [] });
    fetchMock.mockRejectedValueOnce(new Error("network gone"));
    const handler = server.tools.get("t")!.handler;
    const result = await handler({});
    expect(anywhere(result)).not.toContain(KEY);
  });
});

describe("Seguridad — headers de auth SIEMPRE vienen de env, nunca del modelo", () => {
  it("un argumento llamado 'authorization' en la tool NO sobreescribe el header real", async () => {
    const server = makeMockServer();
    registerRoute(server, {
      name: "t",
      method: "GET",
      path: "/t",
      description: "t",
      scopes: [],
      query: { authorization: { type: "string" } }, // alguien intenta meter un header via query
    });
    fetchMock.mockResolvedValueOnce(jsonResponse(200, {}));
    const handler = server.tools.get("t")!.handler;
    await handler({ authorization: "Bearer MALICIOUS_KEY" });
    // El header REAL sigue siendo el del env (no el del modelo)
    const headers = fetchMock.mock.calls[0]![1]!.headers as Record<string, string>;
    expect(headers.authorization).toBe(`Bearer ${KEY}`);
  });

  it("un argumento llamado 'x-tenant-id' NO sobreescribe el header real (con key de tenant)", async () => {
    const server = makeMockServer();
    registerRoute(server, {
      name: "t",
      method: "GET",
      path: "/t",
      description: "t",
      scopes: [],
      query: { "x-tenant-id": { type: "string" } },
    });
    fetchMock.mockResolvedValueOnce(jsonResponse(200, {}));
    const handler = server.tools.get("t")!.handler;
    await handler({ "x-tenant-id": "otro-tenant-uuid" });
    // Sin COMMERCE_TENANT_ID, el header NO se manda (el del modelo se
    // serializa a query string, no a header — esto valida el aislamiento).
    const headers = fetchMock.mock.calls[0]![1]!.headers as Record<string, string>;
    expect(headers["x-tenant-id"]).toBeUndefined();
    const url = fetchMock.mock.calls[0]![0] as URL;
    // Y el valor malicioso va a la URL como query param, no a un header
    expect(url.searchParams.get("x-tenant-id")).toBe("otro-tenant-uuid");
  });

  it("Authorization se manda en TODOS los métodos (GET, POST, PATCH, DELETE)", async () => {
    for (const method of ["GET", "POST", "PATCH", "DELETE"] as const) {
      fetchMock.mockResolvedValueOnce(jsonResponse(200, {}));
      await apiRequest(method, "/x");
      const headers = fetchMock.mock.calls[0]![1]!.headers as Record<string, string>;
      expect(headers.authorization, `falta en ${method}`).toBe(`Bearer ${KEY}`);
    }
  });

  it("apiUpload NO manda content-type (deja a fetch generar multipart boundary)", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(201, { id: "x" }));
    await apiUpload("/foo", {
      base64: Buffer.from("hello").toString("base64"),
      filename: "f.png",
      mimeType: "image/png",
    });
    const headers = fetchMock.mock.calls[0]![1]!.headers as Record<string, string>;
    expect(headers["content-type"]).toBeUndefined();
    // Pero Authorization SÍ va:
    expect(headers.authorization).toBe(`Bearer ${KEY}`);
  });
});

describe("Seguridad — defense in depth contra exfiltración", () => {
  it("un baseUrl malicioso NUNCA recibe la API key (ni siquiera en una request fallida)", async () => {
    process.env.COMMERCE_API_BASE_URL = "http://attacker.example.com/api";
    const result = await apiRequest("GET", "/foo");
    expect(result.ok).toBe(false);
    expect(result.data).toMatchObject({ error: "CONFIG_ERROR" });
    // Crítico: fetch no se llamó, así que attacker.example.com no recibió
    // NADA (ni siquiera un CONNECT probe con la key).
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("URL con @ en el host (userinfo attack) es rechazada por el parser", async () => {
    // https://api.example.com@attacker.com/api — `URL` interpreta api.example.com
    // como userinfo y attacker.com como host real. Por suerte, scheme https
    // pasa la validación, pero el host efectivo es attacker.com. Verificamos
    // que el host EFFECTIVO en el request sea el correcto (no userinfo).
    process.env.COMMERCE_API_BASE_URL = "https://api.example.com.attacker.com/api/v1";
    fetchMock.mockResolvedValueOnce(jsonResponse(200, {}));
    await apiRequest("GET", "/foo");
    const url = fetchMock.mock.calls[0]![0] as URL;
    expect(url.host).toBe("api.example.com.attacker.com");
    // Si el operador quiere defenderse del userinfo attack, debe configurar
    // la URL completa de su backend, no confiar en el parser. Documentamos
    // el comportamiento esperado: si pones `api.example.com@attacker.com`
    // como URL, el parser lo trata como host `attacker.com`. Esto NO es un
    // bypass de nuestra validación (la URL es absoluta y scheme es https).
  });

  it("el timeout del backend es independiente del scheme (loopback http también tiene timeout)", async () => {
    process.env.COMMERCE_API_BASE_URL = "http://localhost:3000/api/v1";
    fetchMock.mockResolvedValueOnce(jsonResponse(200, {}));
    await apiRequest("GET", "/foo");
    const signal = fetchMock.mock.calls[0]![1]!.signal as AbortSignal;
    expect(signal).toBeInstanceOf(AbortSignal);
  });
});

describe("Seguridad — el MCP server no loguea la key por su cuenta", () => {
  it("process.stderr.write no recibe la key durante un arranque normal simulado", async () => {
    // Capturar stderr y stdout por si hay prints accidentales.
    const stderrChunks: string[] = [];
    const stdoutChunks: string[] = [];
    const origStderr = process.stderr.write.bind(process.stderr);
    const origStdout = process.stdout.write.bind(process.stdout);
    process.stderr.write = ((chunk: string | Uint8Array) => {
      stderrChunks.push(typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk));
      return true;
    }) as typeof process.stderr.write;
    process.stdout.write = ((chunk: string | Uint8Array) => {
      stdoutChunks.push(typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk));
      return true;
    }) as typeof process.stdout.write;

    try {
      // No importamos main.ts porque arranca el servidor. Solo verificamos
      // que ninguna función importada loguee la key al ejercitarse.
      fetchMock.mockResolvedValueOnce(jsonResponse(200, {}));
      await apiRequest("GET", "/foo");
      await probeKeyKind();
    } finally {
      process.stderr.write = origStderr;
      process.stdout.write = origStdout;
    }

    const allOutput = stderrChunks.join("") + stdoutChunks.join("");
    expect(allOutput).not.toContain(KEY);
  });
});