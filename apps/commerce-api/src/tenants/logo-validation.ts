import { BadRequestException } from "@nestjs/common";

/**
 * Validación estricta del logo de la empresa.
 *
 * El objetivo es que no entre nada "feo" ni peligroso: se decide el formato
 * por los bytes reales (no por el `Content-Type` que declara el cliente), se
 * leen las dimensiones del encabezado del archivo, se rechazan animaciones y
 * el SVG se revisa contra scripts, handlers, `<foreignObject>` y recursos
 * externos. Todo es puro (sin dependencias nativas) para que corra igual en
 * tests y en producción.
 */

export const MAX_LOGO_BYTES = 2 * 1024 * 1024;
export const MIN_LOGO_SIDE = 128;
export const MAX_LOGO_SIDE = 4096;
/** Proporción ancho/alto admitida: entre 1:3 y 3:1. */
export const MAX_LOGO_ASPECT = 3;

export type LogoFormat = "png" | "jpeg" | "webp" | "svg";

export interface LogoMeta {
  format: LogoFormat;
  mime: string;
  ext: "png" | "jpg" | "webp" | "svg";
  /** `null` solo para SVG sin `width`/`height`/`viewBox` numéricos. */
  width: number | null;
  height: number | null;
}

export interface Dimensions {
  width: number;
  height: number;
  animated: boolean;
}

const MIME_BY_FORMAT: Record<LogoFormat, string> = {
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
  svg: "image/svg+xml",
};

const EXT_BY_FORMAT: Record<LogoFormat, LogoMeta["ext"]> = {
  png: "png",
  jpeg: "jpg",
  webp: "webp",
  svg: "svg",
};

export const ALLOWED_LOGO_MIMES = Object.values(MIME_BY_FORMAT);

function reject(message: string): never {
  throw new BadRequestException({ code: "VALIDATION_FAILED", message });
}

function mb(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(2).replace(/\.?0+$/, "");
}

// ---------------------------------------------------------------------------
// Detección por magic bytes
// ---------------------------------------------------------------------------

export function sniffFormat(buf: Buffer): LogoFormat | "gif" | null {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "png";
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpeg";
  if (
    buf.length >= 12 &&
    buf.subarray(0, 4).toString("latin1") === "RIFF" &&
    buf.subarray(8, 12).toString("latin1") === "WEBP"
  ) {
    return "webp";
  }
  if (buf.length >= 6 && /^GIF8[79]a/.test(buf.subarray(0, 6).toString("latin1"))) return "gif";
  if (looksLikeSvg(buf)) return "svg";
  return null;
}

/** SVG: texto (con o sin BOM / declaración XML / comentarios) cuyo primer
 * elemento es `<svg`. Se mira solo el inicio para no escanear binarios. */
function looksLikeSvg(buf: Buffer): boolean {
  const head = buf.subarray(0, Math.min(buf.length, 4096)).toString("utf8").replace(/^\uFEFF/, "");
  // Bytes de control (fuera de \t \n \r): es un binario, no un SVG.
  for (let i = 0; i < head.length; i++) {
    const c = head.charCodeAt(i);
    if (c < 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d) return false;
  }
  const stripped = head
    .replace(/<\?xml[\s\S]*?\?>/i, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<!DOCTYPE[^>]*>/i, "")
    .trimStart();
  return /^<svg[\s>]/i.test(stripped);
}

// ---------------------------------------------------------------------------
// Dimensiones por formato (parsers mínimos de encabezado)
// ---------------------------------------------------------------------------

export function parsePng(buf: Buffer): Dimensions | null {
  if (buf.length < 24 || buf.subarray(12, 16).toString("latin1") !== "IHDR") return null;
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  // APNG declara animación con un chunk `acTL` antes del primer IDAT.
  let animated = false;
  let off = 8;
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.subarray(off + 4, off + 8).toString("latin1");
    if (type === "acTL") {
      animated = true;
      break;
    }
    if (type === "IDAT" || type === "IEND") break;
    off += 12 + len;
  }
  return { width, height, animated };
}

export function parseJpeg(buf: Buffer): Dimensions | null {
  let off = 2;
  while (off + 4 <= buf.length) {
    if (buf[off] !== 0xff) return null;
    const marker = buf[off + 1]!;
    // Relleno FF y marcadores sin payload (RSTn, SOI, TEM).
    if (marker === 0xff) {
      off += 1;
      continue;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      off += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return null; // EOI / SOS sin SOF: dañado
    const len = buf.readUInt16BE(off + 2);
    const isSof =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      if (off + 9 > buf.length) return null;
      const height = buf.readUInt16BE(off + 5);
      const width = buf.readUInt16BE(off + 7);
      return { width, height, animated: false };
    }
    off += 2 + len;
  }
  return null;
}

export function parseWebp(buf: Buffer): Dimensions | null {
  if (buf.length < 30) return null;
  const chunk = buf.subarray(12, 16).toString("latin1");
  if (chunk === "VP8X") {
    const flags = buf[20]!;
    const animated = (flags & 0x02) !== 0;
    const width = 1 + buf.readUIntLE(24, 3);
    const height = 1 + buf.readUIntLE(27, 3);
    return { width, height, animated };
  }
  if (chunk === "VP8 ") {
    // Frame header: 3 bytes de tag + start code 9d 01 2a + w/h en 14 bits.
    if (buf[23] !== 0x9d || buf[24] !== 0x01 || buf[25] !== 0x2a) return null;
    const width = buf.readUInt16LE(26) & 0x3fff;
    const height = buf.readUInt16LE(28) & 0x3fff;
    return { width, height, animated: false };
  }
  if (chunk === "VP8L") {
    if (buf[20] !== 0x2f) return null;
    const bits = buf.readUInt32LE(21);
    const width = (bits & 0x3fff) + 1;
    const height = ((bits >>> 14) & 0x3fff) + 1;
    return { width, height, animated: false };
  }
  return null;
}

// ---------------------------------------------------------------------------
// SVG: saneamiento
// ---------------------------------------------------------------------------

interface SvgCheck {
  width: number | null;
  height: number | null;
}

const SVG_FORBIDDEN: Array<{ re: RegExp; message: string }> = [
  { re: /<\s*script\b/i, message: "El SVG contiene <script>; no se admiten scripts en el logo." },
  { re: /\son[a-z]+\s*=/i, message: "El SVG contiene manejadores de eventos (on…=); no están permitidos." },
  { re: /<\s*foreignObject\b/i, message: "El SVG contiene <foreignObject>; no está permitido." },
  { re: /<\s*(iframe|embed|object|use)\b[^>]*\shref\s*=\s*["']?\s*https?:/i, message: "El SVG carga contenido externo; no está permitido." },
  { re: /<!ENTITY/i, message: "El SVG declara entidades XML; no está permitido." },
  { re: /javascript\s*:/i, message: "El SVG contiene URLs javascript:; no están permitidas." },
  { re: /(?:xlink:)?href\s*=\s*["']\s*(?:https?:|\/\/|file:|ftp:)/i, message: "El SVG hace referencia a recursos externos (href a otra URL); solo se admiten referencias internas (#id) o data:image." },
  { re: /@import\b/i, message: "El SVG importa hojas de estilo externas; no está permitido." },
  { re: /url\s*\(\s*["']?\s*(?:https?:|\/\/)/i, message: "El SVG carga recursos externos desde CSS (url(http…)); no está permitido." },
  { re: /(?:["'(=]\s*)data:\s*(?!image\/(?:png|jpeg|jpg|webp|gif)[;,])/i, message: "El SVG incrusta datos que no son imágenes (data:…); no está permitido." },
];

function svgLength(raw: string | undefined): number | null {
  if (!raw) return null;
  const m = /^\s*([0-9]*\.?[0-9]+)\s*(px)?\s*$/i.exec(raw);
  return m ? Number(m[1]) : null;
}

export function checkSvg(buf: Buffer): SvgCheck {
  const text = buf.toString("utf8").replace(/^\uFEFF/, "");
  if (!looksLikeSvg(buf)) reject("El archivo no es un SVG válido.");
  for (const rule of SVG_FORBIDDEN) {
    if (rule.re.test(text)) reject(rule.message);
  }
  const open = /<svg\b([^>]*)>/i.exec(text);
  const attrs = open?.[1] ?? "";
  const attr = (name: string): string | undefined =>
    new RegExp(`\\s${name}\\s*=\\s*["']([^"']*)["']`, "i").exec(attrs)?.[1];
  let width = svgLength(attr("width"));
  let height = svgLength(attr("height"));
  if (width === null || height === null) {
    const vb = attr("viewBox");
    const parts = vb?.trim().split(/[\s,]+/).map(Number);
    if (parts && parts.length === 4 && parts.every((n) => Number.isFinite(n)) && parts[2]! > 0 && parts[3]! > 0) {
      width = width ?? parts[2]!;
      height = height ?? parts[3]!;
    }
  }
  return { width, height };
}

// ---------------------------------------------------------------------------
// Reglas de tamaño / proporción
// ---------------------------------------------------------------------------

function assertGeometry(width: number, height: number, vector: boolean): void {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    reject("No se pudieron leer las dimensiones de la imagen; el archivo puede estar dañado.");
  }
  // Un SVG escala sin perder calidad: la regla de mínimo es solo para raster.
  if (!vector && (width < MIN_LOGO_SIDE || height < MIN_LOGO_SIDE)) {
    reject(`El logo mide ${width}×${height} px; el mínimo es ${MIN_LOGO_SIDE}×${MIN_LOGO_SIDE} px.`);
  }
  if (width > MAX_LOGO_SIDE || height > MAX_LOGO_SIDE) {
    reject(`El logo mide ${width}×${height} px; el máximo es ${MAX_LOGO_SIDE}×${MAX_LOGO_SIDE} px.`);
  }
  const ratio = width / height;
  if (ratio > MAX_LOGO_ASPECT || ratio < 1 / MAX_LOGO_ASPECT) {
    reject(
      `La proporción del logo (${width}×${height}) es demasiado alargada; debe estar entre 1:${MAX_LOGO_ASPECT} y ${MAX_LOGO_ASPECT}:1.`,
    );
  }
}

/**
 * Valida el archivo completo y devuelve sus metadatos. Lanza
 * `BadRequestException` (`VALIDATION_FAILED`) con un mensaje en español
 * listo para mostrar al usuario.
 */
export function validateLogo(buf: Buffer, declaredMime?: string): LogoMeta {
  if (!buf || buf.length === 0) reject("El archivo está vacío.");
  if (buf.length > MAX_LOGO_BYTES) {
    reject(`El logo pesa ${mb(buf.length)} MB; el máximo es ${mb(MAX_LOGO_BYTES)} MB.`);
  }

  const sniffed = sniffFormat(buf);
  if (sniffed === "gif") reject("Los GIF no están permitidos (suelen ser animados): usa PNG, JPG, WebP o SVG.");
  if (!sniffed) {
    const declared = declaredMime?.toLowerCase().split(";")[0]?.trim();
    if (declared && ALLOWED_LOGO_MIMES.includes(declared)) {
      reject(`El archivo dice ser ${declared} pero su contenido no corresponde a una imagen válida.`);
    }
    reject("Formato no permitido. Sube un PNG, JPG, WebP o SVG.");
  }

  const format = sniffed;
  const mime = MIME_BY_FORMAT[format];
  const ext = EXT_BY_FORMAT[format];

  if (format === "svg") {
    const { width, height } = checkSvg(buf);
    if (width !== null && height !== null) assertGeometry(width, height, true);
    return { format, mime, ext, width, height };
  }

  const dims =
    format === "png" ? parsePng(buf) : format === "jpeg" ? parseJpeg(buf) : parseWebp(buf);
  if (!dims) reject("No se pudieron leer las dimensiones de la imagen; el archivo puede estar dañado.");
  if (dims.animated) reject("No se admiten imágenes animadas; sube un logo estático.");
  assertGeometry(dims.width, dims.height, false);
  return { format, mime, ext, width: dims.width, height: dims.height };
}
