/**
 * Endpoints que devuelven un binario (no JSON): PDF de cotización, CSV de
 * notificaciones, CSV de clientes. Se registran a mano igual que las
 * subidas de imagen (`catalog-images.ts` / `uploads.ts`): no encajan en
 * el DSL declarativo pensado para JSON.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { apiDownload, type DownloadResult } from "../client.js";

/**
 * Helper compartido: dado el resultado de apiDownload, devuelve el
 * CallToolResult con text + resource. Centraliza el shape para que las
 * tres tools se comporten igual y un cambio futuro (p. ej. logging de
 * tamaño, mime type extra) sea en un solo lugar.
 *
 * Tipado con los tipos literales del SDK (`type: "text"` / `"resource"`)
 * para satisfacer `CallToolResult` sin necesidad de castear.
 */
function downloadToResult(result: DownloadResult): CallToolResult {
  if (!result.ok) {
    return {
      isError: true,
      content: [{ type: "text", text: JSON.stringify({ status: result.status, error: result.error }, null, 2) }],
    };
  }
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          status: result.status,
          mimeType: result.mimeType,
          base64Length: result.base64!.length,
        }),
      },
      {
        type: "resource",
        resource: {
          uri: `data:${result.mimeType};base64,${result.base64}`,
          mimeType: result.mimeType!,
          blob: result.base64!,
        },
      },
    ],
  };
}

export function registerBinaryDownloadTools(server: McpServer): void {
  server.registerTool(
    "quotes_download_pdf",
    {
      description:
        "Descarga el PDF de una cotización. Devuelve el archivo en base64 (mimeType application/pdf) " +
        "para que quien llama lo guarde o lo reenvíe. Requiere scope: quotes.read.",
      inputSchema: { id: z.string().describe("id de la cotización") },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ id }) => downloadToResult(await apiDownload(`/quotes/${encodeURIComponent(id)}/pdf`)),
  );

  server.registerTool(
    "notifications_export_csv",
    {
      description:
        "Descarga el CSV de notificaciones del tenant. Devuelve el archivo en base64 (mimeType text/csv). " +
        "Requiere scope: notifications.read.",
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async () => downloadToResult(await apiDownload("/notifications/export.csv")),
  );

  server.registerTool(
    "customers_export_csv",
    {
      description:
        "Descarga el CSV de clientes del tenant con los mismos filtros que `customers_list` (sin paginación). " +
        "Devuelve el archivo en base64 (mimeType text/csv). Requiere scope: customers.read.",
      inputSchema: {
        q: z.string().optional().describe("Búsqueda por nombre/teléfono/correo."),
        tag: z.string().optional().describe("Etiqueta exacta."),
        hasPendingPayment: z.enum(["true", "false"]).optional(),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (args) => {
      const params = new URLSearchParams();
      if (args.q) params.set("q", args.q);
      if (args.tag) params.set("tag", args.tag);
      if (args.hasPendingPayment) params.set("hasPendingPayment", args.hasPendingPayment);
      const qs = params.toString();
      return downloadToResult(await apiDownload(`/customers/export.csv${qs ? `?${qs}` : ""}`));
    },
  );
}