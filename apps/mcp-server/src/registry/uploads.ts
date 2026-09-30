/**
 * Uploads multipart que no son fotos de catálogo: logo del tenant. No
 * encajan en el DSL declarativo de `types.ts` (pensado para JSON), así que
 * se registran a mano aquí con `apiUpload`.
 *
 * Lo que NO está aquí a propósito:
 * - Constancia fiscal de cliente (PDF con campos extra en el mismo
 *   multipart): el backend espera `multipart/form-data` con `file` +
 *   campos de texto opcionales, y `apiUpload` solo soporta el archivo.
 *   Agregarlo requiere extender el cliente; mientras tanto, sube la
 *   constancia desde el panel del tenant y usa `customers_update` para
 *   fijar RFC/legalName/etc. sin PDF.
 * - Fotos de catálogo (producto/variante): viven en `catalog-images.ts`
 *   porque tienen reglas de validación distintas y es lo que justifica
 *   separar este archivo por dominio.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { apiUpload } from "../client.js";

const logoInputShape = {
  fileBase64: z.string().describe("Contenido del logo codificado en base64."),
  filename: z.string().describe("Nombre del archivo, p. ej. \"logo.png\"."),
  mimeType: z.string().describe("image/png, image/jpeg, image/webp o image/svg+xml."),
};

export function registerTenantUploads(server: McpServer): void {
  server.registerTool(
    "tenants_me_upload_logo",
    {
      description:
        "Sube el logo del propio tenant. PNG/JPG/WebP/SVG, entre 128×128 y 4096×4096 px, máximo 2 MB. " +
        "Reemplaza el logo actual. Requiere scope: tenant.admin.",
      inputSchema: logoInputShape,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async ({ fileBase64, filename, mimeType }) => {
      const result = await apiUpload("/tenants/me/logo", {
        base64: fileBase64,
        filename,
        mimeType,
      });
      return {
        isError: !result.ok,
        content: [{ type: "text", text: JSON.stringify({ status: result.status, data: result.data }, null, 2) }],
      };
    },
  );

  // La constancia fiscal NO está implementada como tool: el backend espera
  // multipart con archivo + campos de texto opcionales, y `apiUpload` solo
  // soporta el archivo. Mejor devolver un error claro y accionable que
  // pretender que funciona — un cliente MCP que llame esto recibe
  // instrucciones precisas en vez de un fallo opaco del backend.
  server.registerTool(
    "customers_upload_constancia",
    {
      description:
        "PLACEHOLDER: la subida de constancia fiscal de cliente NO está soportada por el MCP. " +
        "El backend (`POST /customers/:id/fiscal/constancia`) espera multipart/form-data con " +
        "el PDF + campos de texto opcionales (rfc/legalName/postalCode/regimenFiscal/cfdiUse), " +
        "y el cliente HTTP del MCP solo soporta uploads de archivo único. " +
        "Para subir la constancia, usa el panel del tenant. Para fijar datos fiscales " +
        "manualmente sin PDF, usa `customers_update` con expectedVersion + legalName + " +
        "fiscalPostalCode + fiscalCfdiUse + fiscalRegimenFiscal.",
      inputSchema: {
        id: z.string().describe("id del cliente (UUID)"),
        fileBase64: z.string().describe("IGNORADO — usar el panel del tenant."),
        filename: z.string().describe("IGNORADO."),
        rfc: z.string().optional(),
        legalName: z.string().optional(),
        postalCode: z.string().optional(),
        regimenFiscal: z.string().optional(),
        cfdiUse: z.string().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async () => {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                status: 0,
                data: {
                  error: "NOT_SUPPORTED",
                  message:
                    "La subida de constancia fiscal con campos opcionales no está expuesta por el MCP. " +
                    "El backend exige multipart/form-data con archivo + campos de texto, lo que requiere " +
                    "extender el cliente HTTP. Mientras tanto, sube la constancia desde el panel del tenant " +
                    "y usa `customers_update` para fijar RFC/legalName/etc. sin PDF.",
                },
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );
}