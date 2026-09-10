// Config para `apps/web` (Next.js 15 + React 19).
//
// `eslint-config-next@15.1.3` sigue publicándose en formato eslintrc, así que
// se traduce a flat config con FlatCompat. `baseDirectory` apunta a este
// paquete porque es aquí donde viven las dependencias del preset.
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FlatCompat } from "@eslint/eslintrc";
import tsParser from "@typescript-eslint/parser";
import globals from "globals";
import base, { ignores } from "./base.mjs";

const compat = new FlatCompat({
  baseDirectory: dirname(fileURLToPath(import.meta.url)),
});

const TS_FILES = ["**/*.{ts,tsx,mts,cts}"];

export default [
  ...base,

  ...compat.extends("next/core-web-vitals").map((config) => ({
    ...config,
    // FlatCompat no arrastra los `ignores` globales, y sin esto el preset
    // recorrería `.next/`.
    ignores,
  })),

  {
    // El preset de Next fija el parser de Babel para TODOS los archivos y su
    // `overrides` de TypeScript se pierde al aplanarlo: sin esto los `.tsx` se
    // parsean con Babel, cuyo AST de TypeScript no encaja con las reglas de
    // @typescript-eslint (revienta en `no-unused-vars`). Se reafirma el parser
    // de TypeScript después del preset.
    files: TS_FILES,
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 2023,
      sourceType: "module",
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
  },

  {
    files: ["**/*.{js,mjs,cjs,ts,tsx,mts,cts}"],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.es2023,
      },
    },
  },
];
