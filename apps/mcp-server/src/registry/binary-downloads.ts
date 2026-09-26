/**
 * Endpoints que devuelven un binario (no JSON): el PDF de una cotización.
 * Se registran a mano igual que las subidas de imagen (`catalog-images.ts`):
 * no encajan en el DSL declarativo pensado para JSON.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { apiDownload } from "../client.js";

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
    async ({ id }) => {
      const result = await apiDownload(`/quotes/${encodeURIComponent(id)}/pdf`);
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
            text: JSON.stringify({ status: result.status, mimeType: result.mimeType, base64Length: result.base64!.length }),
          },
          { type: "resource", resource: { uri: `data:${result.mimeType};base64,${result.base64}`, mimeType: result.mimeType!, blob: result.base64! } },
        ],
      };
    },
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
    async () => {
      const result = await apiDownload("/notifications/export.csv");
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
            text: JSON.stringify({ status: result.status, mimeType: result.mimeType, base64Length: result.base64!.length }),
          },
          { type: "resource", resource: { uri: `data:${result.mimeType};base64,${result.base64}`, mimeType: result.mimeType!, blob: result.base64! } },
        ],
      };
    },
  );
}
