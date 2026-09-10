// Base ESLint (flat config) compartida por todo el monorepo.
//
// Objetivo: detectar errores reales (variables sin usar, promesas colgadas,
// `case` que se cae al siguiente, comparaciones imposibles) SIN reescribir el
// estilo del repo. El formato lo decide quien escribe, no el linter.
import js from "@eslint/js";
import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";

/** Artefactos de build y de terceros: nunca se lintean. */
export const ignores = [
  "**/node_modules/**",
  "**/dist/**",
  "**/.next/**",
  "**/build/**",
  "**/coverage/**",
  "**/.turbo/**",
  // Cliente Prisma generado (vive bajo node_modules, pero por si se mueve).
  "**/.prisma/**",
  "**/generated/**",
  "**/*.tsbuildinfo",
  "**/next-env.d.ts",
  // Entorno Python del agente.
  "**/.venv/**",
];

/** Reglas comunes a JS y TS. */
const commonRules = {
  eqeqeq: ["error", "always", { null: "ignore" }],
  "no-var": "error",
  "prefer-const": ["error", { destructuring: "all" }],
  "no-console": "off", // el API y los scripts loguean a stdout a propósito
  "no-empty": ["error", { allowEmptyCatch: true }],
};

export default [
  { ignores },

  // JS suelto (configs de build, scripts .mjs).
  {
    ...js.configs.recommended,
    files: ["**/*.{js,mjs,cjs}"],
  },
  {
    files: ["**/*.{js,mjs,cjs}"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
    },
    rules: commonRules,
  },

  // TypeScript. Sin reglas type-aware: el `tsc --noEmit` de cada workspace ya
  // hace ese trabajo y con tipos el lint tardaría minutos en cada paquete.
  //
  // `flat/recommended` de typescript-eslint NO incluye `eslint:recommended`
  // (solo apaga lo que TS ya cubre), así que hay que activarlo aparte o se
  // pierden `no-unreachable`, `no-dupe-keys`, `no-fallthrough`, etc. Va antes
  // del preset para que su capa `eslint-recommended` pueda desactivar las que
  // sobran en TypeScript.
  {
    files: ["**/*.{ts,tsx,mts,cts}"],
    rules: js.configs.recommended.rules,
  },
  ...tsPlugin.configs["flat/recommended"].map((config) => ({
    ...config,
    files: ["**/*.{ts,tsx,mts,cts}"],
  })),
  {
    files: ["**/*.{ts,tsx,mts,cts}"],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 2023,
      sourceType: "module",
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      ...commonRules,

      // TypeScript ya resuelve identificadores; `no-undef` en TS solo produce
      // falsos positivos con tipos globales y `declare`.
      "no-undef": "off",

      // Un argumento sin usar suele ser parte de una firma que no controlamos
      // (handlers de Express, callbacks de Prisma). El prefijo `_` es la señal
      // explícita de "lo sé y no lo uso".
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],

      // `any` acotado y deliberado existe en las fronteras sin tipar (payloads
      // de webhook, mocks de Prisma en tests). Se avisa, no se bloquea: subirlo
      // a error obligaría a tipar de golpe superficies que hoy no lo están.
      "@typescript-eslint/no-explicit-any": "warn",

      // `interface Props extends X {}` es el idioma de shadcn/ui: la interfaz
      // vacía es el punto de extensión donde luego se añaden props propias.
      // Se sigue prohibiendo el `{}` suelto, que sí es un tipo peligroso.
      "@typescript-eslint/no-empty-object-type": [
        "error",
        { allowInterfaces: "with-single-extends" },
      ],
    },
  },

  {
    // Configs de build (tailwind, postcss, next, vitest, nest). Las cargan
    // jiti/tsx/CommonJS, donde `require()` es la forma soportada de traer un
    // plugin; forzar `import` aquí cambiaría cómo se cargan, no el estilo.
    files: ["**/*.config.{js,mjs,cjs,ts,mts,cts}"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/no-var-requires": "off",
    },
  },
];
