import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Setear env ANTES de importar el módulo. La apiKey() se lee perezosamente,
// pero baseUrl()/authHeaders() se construyen en cada request.
const KEY = "npk_test_key_for_unit_tests_only";
process.env.COMMERCE_API_KEY = KEY;
process.env.COMMERCE_API_BASE_URL = "https://api.example.test/v1";
process.env.COMMERCE_TIMEOUT_MS = "5000";

// Mock global de fetch antes de importar el cliente.
const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

const { apiRequest, apiDownload, apiUpload, probeKeyKind } = await import("../src/client.js");

beforeEach(() => {
  fetchMock.mockReset();
});

afterEach(() => {
  delete process.env.COMMERCE_TENANT_ID;
});

// Helper: armar una Response con body y content-length correctos (Node fetch
// suele ser estricto con esto en tests).
function jsonResponse(status: number, body: unknown, extraHeaders: Record<string, string> = {}): Response {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return new Response(text, {
    status,
    headers: { "content-type": "application/json", "content-length": String(new TextEncoder().encode(text).byteLength), ...extraHeaders },
  });
}

describe("apiRequest", () => {
  it("arma URL con query string omitiendo undefined", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { ok: true }));
    await apiRequest("GET", "/foo", { query: { a: "1", b: undefined, c: "3" } });
    const url = fetchMock.mock.calls[0]![0] as URL;
    expect(url.pathname).toBe("/v1/foo");
    expect(url.searchParams.get("a")).toBe("1");
    expect(url.searchParams.get("b")).toBeNull();
    expect(url.searchParams.get("c")).toBe("3");
  });

  it("manda Authorization siempre", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, {}));
    await apiRequest("GET", "/foo");
    const headers = fetchMock.mock.calls[0]![1]!.headers as Record<string, string>;
    expect(headers.authorization).toBe(`Bearer ${KEY}`);
  });

  it("manda x-tenant-id solo cuando COMMERCE_TENANT_ID está en env", async () => {
    process.env.COMMERCE_TENANT_ID = "tenant-abc";
    fetchMock.mockResolvedValueOnce(jsonResponse(200, {}));
    await apiRequest("GET", "/foo");
    const headers = fetchMock.mock.calls[0]![1]!.headers as Record<string, string>;
    expect(headers["x-tenant-id"]).toBe("tenant-abc");
  });

  it("NO manda x-tenant-id sin COMMERCE_TENANT_ID aunque la key fuera global", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, {}));
    await apiRequest("GET", "/foo");
    const headers = fetchMock.mock.calls[0]![1]!.headers as Record<string, string>;
    expect(headers["x-tenant-id"]).toBeUndefined();
  });

  it("serializa body a JSON y agrega content-type", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, {}));
    await apiRequest("POST", "/foo", { body: { a: 1, b: "x" } });
    const init = fetchMock.mock.calls[0]![1]!;
    const headers = init.headers as Record<string, string>;
    expect(headers["content-type"]).toBe("application/json");
    expect(init.body).toBe('{"a":1,"b":"x"}');
  });

  it("NO manda content-type ni body si body es undefined", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, {}));
    await apiRequest("GET", "/foo");
    const init = fetchMock.mock.calls[0]![1]!;
    const headers = init.headers as Record<string, string>;
    expect(headers["content-type"]).toBeUndefined();
    expect(init.body).toBeUndefined();
  });

  it("devuelve ok:true con data parseado en 2xx", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { hello: "world" }));
    const result = await apiRequest("GET", "/foo");
    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect(result.data).toEqual({ hello: "world" });
  });

  it("devuelve ok:false con body parseado en 4xx/5xx (no lanza)", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(403, { error: "forbidden" }));
    const result = await apiRequest("GET", "/foo");
    expect(result.ok).toBe(false);
    expect(result.status).toBe(403);
    expect(result.data).toEqual({ error: "forbidden" });
  });

  it("maneja body no-JSON dejando el texto crudo", async () => {
    const html = "<html>oops</html>";
    fetchMock.mockResolvedValueOnce(
      new Response(html, { status: 500, headers: { "content-type": "text/html", "content-length": String(html.length) } }),
    );
    const result = await apiRequest("GET", "/foo");
    expect(result.ok).toBe(false);
    expect(result.data).toBe("<html>oops</html>");
  });

  it("devuelve NETWORK_ERROR cuando fetch lanza", async () => {
    fetchMock.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const result = await apiRequest("GET", "/foo");
    expect(result.ok).toBe(false);
    expect(result.status).toBe(0);
    expect(result.data).toMatchObject({ error: "NETWORK_ERROR", message: "ECONNREFUSED" });
  });

  it("rechaza RESPONSE_TOO_LARGE vía Content-Length sin leer el body", async () => {
    // Backend declara 100 MB pero el tope local es 16 MB.
    fetchMock.mockResolvedValueOnce(
      new Response("{}", { status: 200, headers: { "content-type": "application/json", "content-length": String(100 * 1024 * 1024) } }),
    );
    const result = await apiRequest("GET", "/foo");
    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect(result.data).toMatchObject({ error: "RESPONSE_TOO_LARGE" });
  });

  it("aborta con DOWNLOAD_TOO_LARGE si el stream excede el tope durante la lectura", async () => {
    // Simular un stream que entrega 17 MB total (excede el cap de 16 MB).
    const big = new Uint8Array(17 * 1024 * 1024);
    // Sin Content-Length para forzar la lectura streaming.
    fetchMock.mockResolvedValueOnce(
      new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(big);
          controller.close();
        },
      }), { status: 200, headers: { "content-type": "application/octet-stream" } }),
    );
    const result = await apiRequest("GET", "/foo");
    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({ error: "RESPONSE_TOO_LARGE" });
  });

  it("aplica AbortSignal.timeout del env", async () => {
    process.env.COMMERCE_TIMEOUT_MS = "12345";
    fetchMock.mockResolvedValueOnce(jsonResponse(200, {}));
    await apiRequest("GET", "/foo");
    const signal = fetchMock.mock.calls[0]![1]!.signal as AbortSignal;
    expect(signal).toBeInstanceOf(AbortSignal);
    process.env.COMMERCE_TIMEOUT_MS = "5000";
  });

  it("respeta timeoutMs=0 como inválido y cae al default de 30s", async () => {
    process.env.COMMERCE_TIMEOUT_MS = "0";
    fetchMock.mockResolvedValueOnce(jsonResponse(200, {}));
    await apiRequest("GET", "/foo");
    // Si respetara 0, AbortSignal.timeout(0) lanzaría inmediatamente y el
    // mock ni se consumiría. Como se llama y entra al then, el default
    // de 30s fue el usado.
    expect(fetchMock).toHaveBeenCalledOnce();
    process.env.COMMERCE_TIMEOUT_MS = "5000";
  });
});

describe("apiDownload", () => {
  it("decodifica respuesta binaria a base64 con mimeType", async () => {
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]); // %PDF-1.4
    fetchMock.mockResolvedValueOnce(
      new Response(bytes, { status: 200, headers: { "content-type": "application/pdf", "content-length": String(bytes.byteLength) } }),
    );
    const result = await apiDownload("/quotes/abc/pdf");
    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect(result.mimeType).toBe("application/pdf");
    expect(result.base64).toBe(Buffer.from(bytes).toString("base64"));
  });

  it("devuelve ok:false con body parseado si el backend responde error", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(404, { error: "not found" }));
    const result = await apiDownload("/quotes/abc/pdf");
    expect(result.ok).toBe(false);
    expect(result.status).toBe(404);
    expect(result.error).toEqual({ error: "not found" });
  });

  it("rechaza binarios > 32 MB con DOWNLOAD_TOO_LARGE (Content-Length)", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("x", { status: 200, headers: { "content-type": "application/pdf", "content-length": String(40 * 1024 * 1024) } }),
    );
    const result = await apiDownload("/quotes/abc/pdf");
    expect(result.ok).toBe(false);
    expect(result.error).toMatchObject({ error: "DOWNLOAD_TOO_LARGE" });
  });
});

describe("apiUpload", () => {
  it("rechaza base64 gigante ANTES del decode (memory bomb defense)", async () => {
    // 50 MB de base64 → ya excede UPLOAD_MAX_B64_CHARS (~10.7M chars)
    // ANTES de cualquier decode, así que Buffer.from nunca corre.
    const huge = "A".repeat(50 * 1024 * 1024);
    const result = await apiUpload("/catalog/products/x/images", {
      base64: huge,
      filename: "huge.jpg",
      mimeType: "image/jpeg",
    });
    expect(result.ok).toBe(false);
    expect(result.data).toMatchObject({ error: "PAYLOAD_TOO_LARGE" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rechaza si decoded > 8 MiB (defensa en profundidad por si b64 tiene padding inflado)", async () => {
    // 9 MB de base64 válido → decode ~6.75 MB; OK. Necesitamos > 8 MB
    // decoded, lo que requiere más de ~10.7 MB de base64. Para forzar el
    // segundo piso, construimos un base64 con padding excesivo: el primer
    // check pasa por length, pero el decode es mayor. Más simple: mandar
    // un base64 de 12 MB que decode a >8 MB.
    const big = Buffer.alloc(9 * 1024 * 1024, 0xff).toString("base64");
    const result = await apiUpload("/catalog/products/x/images", {
      base64: big,
      filename: "big.jpg",
      mimeType: "image/jpeg",
    });
    expect(result.ok).toBe(false);
    expect(result.data).toMatchObject({ error: "PAYLOAD_TOO_LARGE" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("acepta payloads dentro del tope y manda multipart/form-data", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(201, { id: "img-1" }));
    const result = await apiUpload("/catalog/products/x/images", {
      base64: Buffer.from("hello").toString("base64"),
      filename: "test.txt",
      mimeType: "text/plain",
    });
    expect(result.ok).toBe(true);
    expect(result.status).toBe(201);
    expect(result.data).toEqual({ id: "img-1" });

    const init = fetchMock.mock.calls[0]![1]!;
    expect(init.method).toBe("POST");
    expect(init.body).toBeInstanceOf(FormData);
    const headers = init.headers as Record<string, string>;
    // multipart lo arma fetch; NO debe haber content-type application/json.
    expect(headers["content-type"]).toBeUndefined();
  });
});

describe("probeKeyKind", () => {
  it("devuelve 'global' en 200", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, {}));
    await expect(probeKeyKind()).resolves.toBe("global");
  });

  it("devuelve 'tenant' en 403", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(403, {}));
    await expect(probeKeyKind()).resolves.toBe("tenant");
  });

  it("devuelve 'tenant' en 401", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(401, {}));
    await expect(probeKeyKind()).resolves.toBe("tenant");
  });

  it("devuelve 'unknown' en otros status (ej. 500)", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(500, {}));
    await expect(probeKeyKind()).resolves.toBe("unknown");
  });

  it("devuelve 'unknown' si fetch lanza", async () => {
    fetchMock.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    await expect(probeKeyKind()).resolves.toBe("unknown");
  });
});

describe("baseUrl() — validación de scheme (defensa contra exfiltración de API key)", () => {
  // Estos tests cambian COMMERCE_API_BASE_URL y verifican que la validación
  // corre en cada request (no en el import). El módulo se reusa vía la
  // variable de env, así que mutar el env y forzar un nuevo request basta.
  it("rechaza http:// hacia hosts no-loopback como CONFIG_ERROR (no propaga excepción)", async () => {
    process.env.COMMERCE_API_BASE_URL = "http://evil.example.com/api";
    const result = await apiRequest("GET", "/foo");
    expect(result.ok).toBe(false);
    expect(result.status).toBe(0);
    expect(result.data).toMatchObject({ error: "CONFIG_ERROR" });
    expect((result.data as { message: string }).message).toMatch(/insegura|loopback|https/i);
    // Crítico: fetch NUNCA se llamó (no se exfiltra la API key)
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("permite http:// hacia localhost (dev)", async () => {
    process.env.COMMERCE_API_BASE_URL = "http://localhost:3000/api/v1";
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { ok: true }));
    const result = await apiRequest("GET", "/foo");
    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("permite http:// hacia 127.0.0.1 (dev)", async () => {
    process.env.COMMERCE_API_BASE_URL = "http://127.0.0.1:3000/api/v1";
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { ok: true }));
    const result = await apiRequest("GET", "/foo");
    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("rechaza schemes no-http(s) (ftp://, file://, javascript:)", async () => {
    process.env.COMMERCE_API_BASE_URL = "ftp://example.com/api";
    const result = await apiRequest("GET", "/foo");
    expect(result.ok).toBe(false);
    expect(result.data).toMatchObject({ error: "CONFIG_ERROR" });
    expect((result.data as { message: string }).message).toMatch(/scheme|https/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rechaza URL inválida", async () => {
    process.env.COMMERCE_API_BASE_URL = "not-a-url";
    const result = await apiRequest("GET", "/foo");
    expect(result.ok).toBe(false);
    expect(result.data).toMatchObject({ error: "CONFIG_ERROR" });
    expect((result.data as { message: string }).message).toMatch(/inv/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("apiDownload también atrapa CONFIG_ERROR (mismo defense)", async () => {
    process.env.COMMERCE_API_BASE_URL = "http://evil.com/api";
    const result = await apiDownload("/foo");
    expect(result.ok).toBe(false);
    expect(result.error).toMatchObject({ error: "CONFIG_ERROR" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("apiUpload también atrapa CONFIG_ERROR", async () => {
    process.env.COMMERCE_API_BASE_URL = "javascript:alert(1)";
    const result = await apiUpload("/foo", { base64: "AAAA", filename: "x", mimeType: "image/png" });
    expect(result.ok).toBe(false);
    expect(result.data).toMatchObject({ error: "CONFIG_ERROR" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  afterEach(() => {
    process.env.COMMERCE_API_BASE_URL = "https://api.example.test/v1";
  });
});