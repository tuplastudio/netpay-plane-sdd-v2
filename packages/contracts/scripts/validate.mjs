// Validador de contratos: confirma que OpenAPI parsea y schemas se compilan.
// Usa swagger-parser para resolver $refs antes de compilar con ajv.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import SwaggerParser from "@apidevtools/swagger-parser";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import YAML from "yaml";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const yamlText = readFileSync(resolve(root, "openapi/openapi.yaml"), "utf8");
const openapi = YAML.parse(yamlText);

console.log("openapi parsed:", openapi.info.title, openapi.info.version);

// Dereferenciar para resolver $refs.
const api = await SwaggerParser.dereference(structuredClone(openapi));

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);

let validated = 0;
let failed = 0;

for (const [name, schema] of Object.entries(api.components.schemas)) {
  try {
    ajv.compile(schema);
    validated += 1;
    console.log("  ok schema:", name);
  } catch (err) {
    failed += 1;
    console.error("  FAIL schema:", name, "-", err.message);
  }
}

if (failed > 0) {
  console.error(`Validation failed: ${failed} schema(s) invalid`);
  process.exit(1);
}

console.log(`Validation passed: ${validated} schema(s) OK`);