// Config para los workspaces que corren en Node (NestJS, workers, paquetes
// compartidos y sus pruebas de vitest).
import globals from "globals";
import base from "./base.mjs";

export default [
  ...base,
  {
    files: ["**/*.{js,mjs,cjs,ts,mts,cts}"],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.es2023,
      },
    },
  },
  {
    // Los mocks de las pruebas imitan superficies de Prisma/Nest sin tipar del
    // todo; ahí `any` es la herramienta correcta y no un pendiente.
    files: ["**/tests/**", "**/*.test.ts", "**/*.spec.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
];
