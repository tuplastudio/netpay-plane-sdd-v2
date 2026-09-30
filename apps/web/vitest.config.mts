import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Pruebas unitarias del portal: solo lógica pura (helpers, reducers,
 * parsers) en archivos `*.test.ts` junto a su módulo. No hay DOM ni React:
 * los componentes se verifican con `next build` + typecheck.
 */
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
