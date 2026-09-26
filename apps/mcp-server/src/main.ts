#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerRoutes } from "./tools.js";
import { registerCatalogImageTools } from "./registry/catalog-images.js";
import { registerBinaryDownloadTools } from "./registry/binary-downloads.js";
import { allRoutes } from "./registry/index.js";
import { probeKeyKind } from "./client.js";

// Falla rápido y claro en vez de que la primera tool llamada reviente con un
// error genérico de fetch — quien arranca esto por primera vez ve el motivo
// exacto antes de intentar conectarse desde un cliente MCP.
if (!process.env.COMMERCE_API_KEY) {
  console.error(
    "atiendeya MCP no arrancó: falta COMMERCE_API_KEY. Crea una API key en el panel " +
      "(Empresa → API keys, o Plataforma → API keys globales si eres super-admin) y pásala " +
      "como variable de entorno.",
  );
  process.exit(1);
}

const server = new McpServer({ name: "atiendeya", version: "0.1.0" });

registerRoutes(server, allRoutes);
registerCatalogImageTools(server);
registerBinaryDownloadTools(server);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`atiendeya MCP: ${allRoutes.length + 4} tools registradas, esperando por stdio.`);

  // Best-effort, no bloquea el arranque: solo avisa por stderr si la key
  // resultó ser GLOBAL (T-IAM-09b), para que quede claro que TODAS las tools
  // de negocio ahora pueden operar sobre CUALQUIER empresa (con X-Tenant-Id)
  // y que las ~18 tools `super_admin_*` ya están activas. Con una key normal
  // de tenant, o si la key es inválida, o si no hay red, no dice nada.
  probeKeyKind()
    .then((kind) => {
      if (kind === "global") {
        console.error(
          "⚠️  atiendeya MCP: esta API key es GLOBAL — opera sobre CUALQUIER empresa " +
            "(usa COMMERCE_TENANT_ID para acotarla a una) e incluye las tools super_admin_*. " +
            "Si no era la intención, revoca esta key y usa una de tenant (Empresa → API keys).",
        );
      }
    })
    .catch(() => {
      // El probe ya no lanza (ver client.ts); este catch es solo defensivo.
    });
}

main().catch((err) => {
  console.error("atiendeya MCP no pudo arrancar:", err);
  process.exit(1);
});
