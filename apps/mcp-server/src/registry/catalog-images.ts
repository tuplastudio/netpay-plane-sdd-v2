/**
 * Subida de fotos de catálogo (producto y variante): las únicas dos rutas
 * multipart del API. No encajan en el DSL declarativo de `types.ts`
 * (pensado para JSON), así que se registran a mano aquí con `apiUpload`.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { apiUpload } from "../client.js";

const imageInputShape = {
  id: z.string().describe("id del producto o de la variante"),
  imageBase64: z.string().describe("Contenido de la imagen codificado en base64 (sin el prefijo data:...;base64,)."),
  filename: z.string().describe("Nombre de archivo, p. ej. \"frente.jpg\"."),
  mimeType: z.string().describe("image/png, image/jpeg o image/webp."),
};

const IMAGE_RULES =
  "PNG, JPG o WebP, máximo 5 MB, entre 200×200 y 6000×6000 px, sin animación. " +
  "Se puede llamar varias veces: cada llamada agrega una foto más a la galería, no reemplaza las anteriores.";

export function registerCatalogImageTools(server: McpServer): void {
  server.registerTool(
    "catalog_add_product_image",
    {
      description: `Sube una foto general de un producto (portada de su galería). ${IMAGE_RULES} Requiere scope: catalog.write.`,
      inputSchema: imageInputShape,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ id, imageBase64, filename, mimeType }) => {
      const result = await apiUpload(`/catalog/products/${encodeURIComponent(id)}/images`, {
        base64: imageBase64,
        filename,
        mimeType,
      });
      return {
        isError: !result.ok,
        content: [{ type: "text", text: JSON.stringify({ status: result.status, data: result.data }, null, 2) }],
      };
    },
  );

  server.registerTool(
    "catalog_add_variant_image",
    {
      description: `Sube una foto propia de una variante (p. ej. un color distinto al del producto). ${IMAGE_RULES} Requiere scope: catalog.write.`,
      inputSchema: imageInputShape,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ id, imageBase64, filename, mimeType }) => {
      const result = await apiUpload(`/catalog/variants/${encodeURIComponent(id)}/images`, {
        base64: imageBase64,
        filename,
        mimeType,
      });
      return {
        isError: !result.ok,
        content: [{ type: "text", text: JSON.stringify({ status: result.status, data: result.data }, null, 2) }],
      };
    },
  );
}
