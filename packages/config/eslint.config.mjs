// Este paquete se lintea con su propia config (import relativo: no se
// autorreferencia por nombre de paquete).
import node from "./eslint/node.mjs";

/** @type {import("eslint").Linter.Config[]} */
const config = [...node];

export default config;
