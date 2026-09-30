// ESLint flat config standalone para `easysell-mcp`.
//
// Originalmente importábamos `@netpay/config/eslint/node` (workspace:*), pero
// eso rompía la instalación del paquete fuera del monorepo: `workspace:*`
// no resuelve en npm. Esta config es la misma base que el monorepo usa,
// duplicada aquí para que `npm install easysell-mcp && npm run lint` funcione
// en cualquier clon.
import js from "@eslint/js";
import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import globals from "globals";

const ignores = [
  "**/node_modules/**",
  "**/dist/**",
  "**/coverage/**",
  "**/*.tsbuildinfo",
];

const commonRules = {
  eqeqeq: ["error", "always", { null: "ignore" }],
  "no-var": "error",
  "prefer-const": ["error", { destructuring: "all" }],
  "no-empty": ["error", { allowEmptyCatch: true }],
};

/** @type {import("eslint").Linter.Config[]} */
export default [
  { ignores },

  // JS
  {
    ...js.configs.recommended,
    files: ["**/*.{js,mjs,cjs}"],
  },
  {
    files: ["**/*.{js,mjs,cjs}"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: { ...globals.node },
    },
    rules: commonRules,
  },

  // TS — type-aware desactivado a propósito (tsc --noEmit ya cubre tipos)
  {
    files: ["**/*.{ts,tsx,mts,cts}"],
    rules: js.configs.recommended.rules,
  },
  {
    files: ["**/*.{ts,tsx,mts,cts}"],
    plugins: { "@typescript-eslint": tsPlugin },
    rules: tsPlugin.configs.recommended.rules,
  },
  {
    files: ["**/*.{ts,tsx,mts,cts}"],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 2023,
      sourceType: "module",
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.node },
    },
    rules: {
      ...commonRules,
      "no-undef": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-empty-object-type": [
        "error",
        { allowInterfaces: "with-single-extends" },
      ],
    },
  },

  // Tests — `any` es la herramienta correcta en mocks de SDK sin tipar.
  {
    files: ["**/*.test.ts", "**/*.spec.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
];