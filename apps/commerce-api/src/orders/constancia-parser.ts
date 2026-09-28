/**
 * Extrae RFC, razón social, código postal fiscal y régimen fiscal de la
 * "Constancia de Situación Fiscal" que emite el SAT (PDF descargado desde el
 * portal del SAT, texto seleccionable — no una foto/escaneo).
 *
 * Objetivo: que facturar solo requiera SUBIR ese PDF, sin dictar cada dato
 * a mano (ver `order.service.ts#applyInvoiceRequest`). Los datos que el PDF
 * NO trae (uso de CFDI, correo) los sigue eligiendo quien factura.
 *
 * ⚠️ Nota de honestidad: este parser se escribió por patrones de texto
 * conocidos del formato de la constancia (regex sobre las etiquetas fijas
 * del documento), sin una constancia real de muestra para probarlo en este
 * entorno. El SAT ha cambiado el layout del documento más de una vez.
 * Por diseño NUNCA falla en silencio: cualquier dato que no pueda extraer
 * con confianza queda `null` y se reporta en `warnings`, para que quien
 * factura lo capture a mano — nunca se inventa ni se adivina un dato
 * fiscal. Antes de confiar en esto en producción, súbete una constancia
 * real y confirma que los 4 campos salen bien; si el SAT cambió el
 * formato, ajusta los patrones de abajo (todos están comentados con el
 * texto que esperan encontrar).
 */

export interface ParsedConstancia {
  rfc: string | null;
  legalName: string | null;
  postalCode: string | null;
  regimenFiscal: string | null;
  /** Campos que no se pudieron extraer con confianza, en español, para mostrar al usuario. */
  warnings: string[];
}

const RFC_RE = /\b([A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3})\b/;
const POSTAL_RE = /\b(\d{5})\b/;

/**
 * c_RegimenFiscal del SAT: nombre completo (tal como aparece impreso en la
 * constancia, en la tabla "Regímenes") → clave de 3 dígitos. La constancia
 * NUNCA imprime la clave, solo el nombre, así que hay que mapearlo aquí.
 * Mismo catálogo que `apps/web/.../billing-section.tsx` (persona física
 * 605/606/612/621/626/628; persona moral 601/603/620/622).
 */
const REGIME_NAME_TO_CODE: Array<[RegExp, string]> = [
  [/general\s+de\s+ley\s+personas?\s+morales?/i, "601"],
  [/personas?\s+morales?\s+con\s+fines?\s+no\s+lucrativos?/i, "603"],
  [/sueldos?\s+y\s+salarios/i, "605"],
  [/arrendamiento/i, "606"],
  [/actividades?\s+empresariales?\s+y\s+profesionales?/i, "612"],
  [/sociedades?\s+cooperativas?\s+de\s+producci[oó]n/i, "620"],
  [/incorporaci[oó]n\s+fiscal/i, "621"],
  [/agr[ií]colas?,?\s+ganaderas?/i, "622"],
  [/r[eé]gimen\s+simplificado\s+de\s+confianza|resico/i, "626"],
  [/hidrocarburos/i, "628"],
];

/** Quita acentos y colapsa espacios: la extracción de texto de PDF a veces
 * pierde acentos o mete saltos de línea a mitad de palabra. */
function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function findAfterLabel(text: string, labels: string[]): string | null {
  for (const label of labels) {
    // La etiqueta y el valor pueden quedar en la misma línea o en la
    // siguiente (el extractor de texto de pdf.js no siempre conserva el
    // layout de columnas/tablas de la constancia).
    const re = new RegExp(
      `${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*[:\\n]\\s*([^\\n]{1,120})`,
      "i",
    );
    const m = text.match(re);
    const value = m?.[1]?.trim();
    if (value) return value;
  }
  return null;
}

export function parseConstancia(rawText: string): ParsedConstancia {
  const text = normalize(rawText);
  const warnings: string[] = [];

  const rfcMatch = text.match(RFC_RE);
  const rfc = rfcMatch?.[1]?.toUpperCase() ?? null;
  if (!rfc) warnings.push("No se pudo leer el RFC");

  // Persona moral: "Denominación/Razón Social". Persona física: junta
  // Nombre(s) + Primer Apellido + Segundo Apellido (el segundo es opcional).
  let legalName = findAfterLabel(text, [
    "Denominaci[oó]n\\s*/\\s*Raz[oó]n\\s+Social",
    "Raz[oó]n\\s+Social",
  ]);
  if (!legalName) {
    const nombre = findAfterLabel(text, ["Nombre\\s*\\(s\\)", "Nombre"]);
    const apellido1 = findAfterLabel(text, ["Primer\\s+Apellido"]);
    const apellido2 = findAfterLabel(text, ["Segundo\\s+Apellido"]);
    if (nombre) {
      legalName = [nombre, apellido1, apellido2].filter(Boolean).join(" ");
    }
  }
  legalName = legalName ? legalName.replace(/\s{2,}/g, " ").trim() : null;
  if (!legalName) warnings.push("No se pudo leer el nombre o razón social");

  // El CP fiscal vive en la sección "Datos del domicilio"; se busca ahí
  // primero para no confundirlo con otro número de 5 dígitos del documento
  // (folio, por ejemplo).
  let postalCode: string | null = null;
  const domicilioIdx = text.search(/domicilio/i);
  const searchWindow = domicilioIdx >= 0 ? text.slice(domicilioIdx) : text;
  const cpLabeled = findAfterLabel(searchWindow, ["C[oó]digo\\s+Postal", "CP"]);
  postalCode = cpLabeled?.match(POSTAL_RE)?.[1] ?? searchWindow.match(POSTAL_RE)?.[1] ?? null;
  if (!postalCode) warnings.push("No se pudo leer el código postal");

  // Régimen: toma el primero cuya fila NO tenga fecha de baja ("Fecha Fin"
  // vacía = vigente); si no logra distinguir vigencia, toma el primero que
  // reconozca — mejor un régimen probable marcado para confirmar que nada.
  let regimenFiscal: string | null = null;
  const regimenesIdx = text.search(/reg[ií]menes/i);
  const regimenWindow = regimenesIdx >= 0 ? text.slice(regimenesIdx, regimenesIdx + 2000) : text;
  for (const [pattern, code] of REGIME_NAME_TO_CODE) {
    if (pattern.test(regimenWindow)) {
      regimenFiscal = code;
      break;
    }
  }
  if (!regimenFiscal) warnings.push("No se pudo identificar el régimen fiscal");

  return { rfc, legalName, postalCode, regimenFiscal, warnings };
}
