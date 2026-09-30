import { describe, it, expect, vi, beforeEach } from "vitest";

const KEY = "npk_test_key_for_unit_tests_only";
process.env.COMMERCE_API_KEY = KEY;
process.env.COMMERCE_API_BASE_URL = "https://api.example.test/v1";
process.env.COMMERCE_TIMEOUT_MS = "5000";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

const { registerRoute, registerRoutes } = await import("../src/tools.js");
const { registerCatalogImageTools } = await import("../src/registry/catalog-images.js");
const { registerBinaryDownloadTools } = await import("../src/registry/binary-downloads.js");
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RouteDef } from "../src/registry/types.js";

/**
 * Mock mínimo del McpServer: captura las tools registradas para poder
 * ejercitar sus handlers en tests. La SDK real hace más (validación de
 * schema, dispatch MCP, etc.), pero para validar buildPath/buildQuery/
 * buildBody/Annotations no necesitamos nada de eso.
 */
function makeMockServer(): McpServer & { tools: Map<string, { config: unknown; handler: (args: Record<string, unknown>) => Promise<unknown> }> } {
  const tools = new Map<string, { config: unknown; handler: (args: Record<string, unknown>) => Promise<unknown> }>();
  return {
    tools,
    registerTool(name: string, config: unknown, handler: (args: Record<string, unknown>) => Promise<unknown>) {
      tools.set(name, { config, handler });
    },
  } as unknown as McpServer & { tools: Map<string, { config: unknown; handler: (args: Record<string, unknown>) => Promise<unknown> }> };
}

/** Tipo mínimo de un CallToolResult para aserciones tipadas en tests. */
type ToolResult = { isError?: boolean; content: Array<{ type: string; text?: string; resource?: { uri: string; mimeType: string; blob: string } }> };

beforeEach(() => {
  fetchMock.mockReset();
});

function jsonResponse(status: number, body: unknown): Response {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return new Response(text, {
    status,
    headers: { "content-type": "application/json", "content-length": String(new TextEncoder().encode(text).byteLength) },
  });
}

describe("registerRoute", () => {
  it("registra el handler con la config correcta (description + scopeNote + annotations)", () => {
    const server = makeMockServer();
    const route: RouteDef = {
      name: "test_echo",
      method: "GET",
      path: "/foo",
      description: "Echo de prueba",
      scopes: ["foo.read", "foo.write"],
    };
    registerRoute(server, route);
    const tool = server.tools.get("test_echo")!;
    expect(tool).toBeDefined();
    const config = tool.config as { description: string; annotations: { readOnlyHint: boolean; destructiveHint: boolean; idempotentHint: boolean; openWorldHint: boolean } };
    expect(config.description).toBe("Echo de prueba Requiere scope(s): foo.read, foo.write.");
    expect(config.annotations.readOnlyHint).toBe(true);
    expect(config.annotations.destructiveHint).toBe(false);
    expect(config.annotations.idempotentHint).toBe(false);
    expect(config.annotations.openWorldHint).toBe(true);
  });

  it("description sin scopes NO agrega el sufijo 'Requiere scope(s)...'", () => {
    const server = makeMockServer();
    registerRoute(server, {
      name: "test_noscope",
      method: "GET",
      path: "/foo",
      description: "Sin scope",
      scopes: [],
    });
    const config = server.tools.get("test_noscope")!.config as { description: string };
    expect(config.description).toBe("Sin scope");
  });

  it("annotations: PATCH es idempotent pero NO readOnly, DELETE es destructive+idempotent", () => {
    const server = makeMockServer();
    registerRoute(server, { name: "p", method: "PATCH", path: "/p", description: "p", scopes: [] });
    registerRoute(server, { name: "d", method: "DELETE", path: "/d", description: "d", scopes: [] });
    const patchCfg = server.tools.get("p")!.config as { annotations: { readOnlyHint: boolean; destructiveHint: boolean; idempotentHint: boolean } };
    const delCfg = server.tools.get("d")!.config as { annotations: { readOnlyHint: boolean; destructiveHint: boolean; idempotentHint: boolean } };
    expect(patchCfg.annotations.readOnlyHint).toBe(false);
    expect(patchCfg.annotations.destructiveHint).toBe(false);
    expect(patchCfg.annotations.idempotentHint).toBe(true);
    expect(delCfg.annotations.readOnlyHint).toBe(false);
    expect(delCfg.annotations.destructiveHint).toBe(true);
    expect(delCfg.annotations.idempotentHint).toBe(true);
  });

  it("annotations: destructiveHint explícito sobrescribe el default", () => {
    const server = makeMockServer();
    registerRoute(server, {
      name: "refund",
      method: "POST",
      path: "/refund",
      description: "refund",
      scopes: [],
      destructiveHint: true,
    });
    const cfg = server.tools.get("refund")!.config as { annotations: { destructiveHint: boolean } };
    expect(cfg.annotations.destructiveHint).toBe(true);
  });

  it("handler arma path con encoding de path params y propaga al backend", async () => {
    const server = makeMockServer();
    registerRoute(server, {
      name: "test_get",
      method: "GET",
      path: "/items/:id",
      description: "Get item",
      scopes: [],
      pathParams: { id: { type: "string" } },
    });
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "x" }));
    const handler = server.tools.get("test_get")!.handler;
    await handler({ id: "abc/123 with space" });
    const url = fetchMock.mock.calls[0]![0] as URL;
    // encodeURIComponent escapa `/`, espacio y otros chars peligrosos
    expect(url.pathname).toBe("/v1/items/abc%2F123%20with%20space");
    expect(url.search).toBe("");
  });

  it("handler omite query params undefined y serializa el resto", async () => {
    const server = makeMockServer();
    registerRoute(server, {
      name: "test_list",
      method: "GET",
      path: "/list",
      description: "List",
      scopes: [],
      query: { q: { type: "string" }, limit: { type: "number" }, tag: { type: "string" } },
    });
    fetchMock.mockResolvedValueOnce(jsonResponse(200, []));
    const handler = server.tools.get("test_list")!.handler;
    await handler({ q: "hola", limit: 10, tag: undefined });
    const url = fetchMock.mock.calls[0]![0] as URL;
    expect(url.searchParams.get("q")).toBe("hola");
    expect(url.searchParams.get("limit")).toBe("10"); // number → string
    expect(url.searchParams.has("tag")).toBe(false); // undefined omitido
  });

  it("handler serializa body excluyendo campos undefined", async () => {
    const server = makeMockServer();
    registerRoute(server, {
      name: "test_post",
      method: "POST",
      path: "/post",
      description: "Post",
      scopes: [],
      body: {
        name: { type: "string", required: true },
        notes: { type: "string" },
      },
    });
    fetchMock.mockResolvedValueOnce(jsonResponse(201, { id: "1" }));
    const handler = server.tools.get("test_post")!.handler;
    await handler({ name: "Ana", notes: undefined });
    const init = fetchMock.mock.calls[0]![1]!;
    const headers = init.headers as Record<string, string>;
    expect(headers["content-type"]).toBe("application/json");
    expect(JSON.parse(init.body as string)).toEqual({ name: "Ana" });
  });

  it("handler devuelve isError:true y body íntegro en 4xx (no lanza)", async () => {
    const server = makeMockServer();
    registerRoute(server, { name: "test_404", method: "GET", path: "/x", description: "x", scopes: [] });
    fetchMock.mockResolvedValueOnce(jsonResponse(404, { error: "not_found", detail: "extra" }));
    const handler = server.tools.get("test_404")!.handler;
    const result = (await handler({})) as ToolResult;
    expect(result.isError).toBe(true);
    const content = result.content;
    const parsed = JSON.parse(content[0]!.text!);
    expect(parsed.status).toBe(404);
    expect(parsed.data).toEqual({ error: "not_found", detail: "extra" });
  });

  it("handler devuelve isError:false en 2xx", async () => {
    const server = makeMockServer();
    registerRoute(server, { name: "test_200", method: "GET", path: "/x", description: "x", scopes: [] });
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { ok: true }));
    const handler = server.tools.get("test_200")!.handler;
    const result = (await handler({})) as ToolResult;
    expect(result.isError).toBe(false);
  });

  it("handler devuelve isError:true con CONFIG_ERROR si la URL base es inválida", async () => {
    process.env.COMMERCE_API_BASE_URL = "http://evil.example.com/api";
    const server = makeMockServer();
    registerRoute(server, { name: "test_cfg", method: "GET", path: "/x", description: "x", scopes: [] });
    const handler = server.tools.get("test_cfg")!.handler;
    const result = (await handler({})) as ToolResult;
    expect(result.isError).toBe(true);
    const content = result.content;
    const parsed = JSON.parse(content[0]!.text!);
    expect(parsed.data.error).toBe("CONFIG_ERROR");
    expect(fetchMock).not.toHaveBeenCalled();
    process.env.COMMERCE_API_BASE_URL = "https://api.example.test/v1";
  });
});

describe("registerRoutes", () => {
  it("lanza si hay nombres duplicados (fail-fast en arranque)", () => {
    const server = makeMockServer();
    const routes: RouteDef[] = [
      { name: "dup", method: "GET", path: "/a", description: "a", scopes: [] },
      { name: "dup", method: "GET", path: "/b", description: "b", scopes: [] },
    ];
    expect(() => registerRoutes(server, routes)).toThrow(/duplicado/);
  });

  it("registra todas las routes en orden", () => {
    const server = makeMockServer();
    const routes: RouteDef[] = [
      { name: "a", method: "GET", path: "/a", description: "a", scopes: [] },
      { name: "b", method: "GET", path: "/b", description: "b", scopes: [] },
      { name: "c", method: "GET", path: "/c", description: "c", scopes: [] },
    ];
    registerRoutes(server, routes);
    expect([...server.tools.keys()]).toEqual(["a", "b", "c"]);
  });
});

describe("registerCatalogImageTools", () => {
  it("registra catalog_add_product_image y catalog_add_variant_image", () => {
    const server = makeMockServer();
    registerCatalogImageTools(server);
    expect(server.tools.has("catalog_add_product_image")).toBe(true);
    expect(server.tools.has("catalog_add_variant_image")).toBe(true);
  });

  it("catalog_add_product_image: arma URL correcta y pasa el base64 al upload", async () => {
    const server = makeMockServer();
    registerCatalogImageTools(server);
    fetchMock.mockResolvedValueOnce(jsonResponse(201, { id: "img-1" }));
    const handler = server.tools.get("catalog_add_product_image")!.handler;
    await handler({ id: "prod/123", imageBase64: Buffer.from("hello").toString("base64"), filename: "f.png", mimeType: "image/png" });
    const url = fetchMock.mock.calls[0]![0] as URL;
    expect(url.pathname).toBe("/v1/catalog/products/prod%2F123/images");
    const init = fetchMock.mock.calls[0]![1]!;
    expect(init.method).toBe("POST");
    expect(init.body).toBeInstanceOf(FormData);
  });

  it("catalog_add_variant_image: variante usa /catalog/variants/:id/images", async () => {
    const server = makeMockServer();
    registerCatalogImageTools(server);
    fetchMock.mockResolvedValueOnce(jsonResponse(201, { id: "img-2" }));
    const handler = server.tools.get("catalog_add_variant_image")!.handler;
    await handler({ id: "var-1", imageBase64: Buffer.from("hello").toString("base64"), filename: "f.png", mimeType: "image/png" });
    const url = fetchMock.mock.calls[0]![0] as URL;
    expect(url.pathname).toBe("/v1/catalog/variants/var-1/images");
  });
});

describe("registerBinaryDownloadTools", () => {
  it("registra quotes_download_pdf y notifications_export_csv", () => {
    const server = makeMockServer();
    registerBinaryDownloadTools(server);
    expect(server.tools.has("quotes_download_pdf")).toBe(true);
    expect(server.tools.has("notifications_export_csv")).toBe(true);
  });

  it("quotes_download_pdf: en éxito devuelve text + resource con base64", async () => {
    const server = makeMockServer();
    registerBinaryDownloadTools(server);
    const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);
    fetchMock.mockResolvedValueOnce(
      new Response(pdfBytes, { status: 200, headers: { "content-type": "application/pdf", "content-length": String(pdfBytes.byteLength) } }),
    );
    const handler = server.tools.get("quotes_download_pdf")!.handler;
    const result = (await handler({ id: "abc/123" })) as ToolResult;
    expect(result.isError).toBeFalsy();
    const content = result.content;
    expect(content).toHaveLength(2);
    expect(content[0]!.type).toBe("text");
    expect(content[1]!.type).toBe("resource");
    expect(content[1]!.resource!.uri).toMatch(/^data:application\/pdf;base64,/);
    expect(content[1]!.resource!.blob).toBe(Buffer.from(pdfBytes).toString("base64"));
    // URL con id encoded
    const url = fetchMock.mock.calls[0]![0] as URL;
    expect(url.pathname).toBe("/v1/quotes/abc%2F123/pdf");
  });

  it("quotes_download_pdf: en error devuelve isError:true con detalle", async () => {
    const server = makeMockServer();
    registerBinaryDownloadTools(server);
    fetchMock.mockResolvedValueOnce(jsonResponse(404, { error: "quote_not_found" }));
    const handler = server.tools.get("quotes_download_pdf")!.handler;
    const result = (await handler({ id: "missing" })) as ToolResult;
    expect(result.isError).toBe(true);
    const content = result.content;
    const parsed = JSON.parse(content[0]!.text!);
    expect(parsed.status).toBe(404);
    expect(parsed.error).toEqual({ error: "quote_not_found" });
  });

  it("notifications_export_csv: no requiere args", async () => {
    const server = makeMockServer();
    registerBinaryDownloadTools(server);
    const csv = new TextEncoder().encode("a,b,c\n1,2,3\n");
    fetchMock.mockResolvedValueOnce(
      new Response(csv, { status: 200, headers: { "content-type": "text/csv", "content-length": String(csv.byteLength) } }),
    );
    const handler = server.tools.get("notifications_export_csv")!.handler;
    const result = (await handler({})) as ToolResult;
    expect(result.isError).toBeFalsy();
    const url = fetchMock.mock.calls[0]![0] as URL;
    expect(url.pathname).toBe("/v1/notifications/export.csv");
  });

  it("customers_export_csv: pasa filtros como query string", async () => {
    const server = makeMockServer();
    registerBinaryDownloadTools(server);
    const csv = new TextEncoder().encode("name,email\nAna,a@b.com\n");
    fetchMock.mockResolvedValueOnce(
      new Response(csv, { status: 200, headers: { "content-type": "text/csv", "content-length": String(csv.byteLength) } }),
    );
    const handler = server.tools.get("customers_export_csv")!.handler;
    await handler({ q: "Ana", tag: "vip", hasPendingPayment: "true" });
    const url = fetchMock.mock.calls[0]![0] as URL;
    expect(url.pathname).toBe("/v1/customers/export.csv");
    expect(url.searchParams.get("q")).toBe("Ana");
    expect(url.searchParams.get("tag")).toBe("vip");
    expect(url.searchParams.get("hasPendingPayment")).toBe("true");
  });
});

describe("registerTenantUploads", () => {
  it("registra tenants_me_upload_logo y customers_upload_constancia", async () => {
    const { registerTenantUploads } = await import("../src/registry/uploads.js");
    const server = makeMockServer();
    registerTenantUploads(server);
    expect(server.tools.has("tenants_me_upload_logo")).toBe(true);
    expect(server.tools.has("customers_upload_constancia")).toBe(true);
  });

  it("tenants_me_upload_logo: sube el logo via apiUpload", async () => {
    const { registerTenantUploads } = await import("../src/registry/uploads.js");
    const server = makeMockServer();
    registerTenantUploads(server);
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { logoUrl: "https://x/logo.png" }));
    const handler = server.tools.get("tenants_me_upload_logo")!.handler;
    const result = (await handler({
      fileBase64: Buffer.from("hello").toString("base64"),
      filename: "logo.png",
      mimeType: "image/png",
    })) as ToolResult;
    expect(result.isError).toBeFalsy();
    const url = fetchMock.mock.calls[0]![0] as URL;
    expect(url.pathname).toBe("/v1/tenants/me/logo");
  });

  it("customers_upload_constancia: devuelve error honesto (no implementado)", async () => {
    const { registerTenantUploads } = await import("../src/registry/uploads.js");
    const server = makeMockServer();
    registerTenantUploads(server);
    const handler = server.tools.get("customers_upload_constancia")!.handler;
    const result = (await handler({ id: "cust-1", fileBase64: "AA==", filename: "c.pdf" })) as ToolResult;
    expect(result.isError).toBe(true);
    const content = result.content;
    const parsed = JSON.parse(content[0]!.text!);
    expect(parsed.data.error).toBe("NOT_SUPPORTED");
    // El handler NO debe llamar a fetch (no implementado)
    expect(fetchMock).not.toHaveBeenCalled();
  });
});