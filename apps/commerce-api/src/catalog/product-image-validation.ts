import { BadRequestException } from "@nestjs/common";
import { sniffFormat, parsePng, parseJpeg, parseWebp } from "../tenants/logo-validation.js";

/**
 * Validación de fotos de catálogo (producto y variante).
 *
 * Reusa la detección por bytes reales del logo del tenant (`logo-validation.ts`:
 * magic bytes, dimensiones de encabezado, rechazo de animados) pero sin su
 * regla de proporción 1:3–3:1 — una foto de producto puede ser cuadrada,
 * vertical u horizontal — y sin SVG (no tiene sentido para una foto).
 */

export const MAX_PRODUCT_IMAGE_BYTES = 5 * 1024 * 1024;
export const MIN_PRODUCT_IMAGE_SIDE = 200;
export const MAX_PRODUCT_IMAGE_SIDE = 6000;

export type ProductImageFormat = "png" | "jpeg" | "webp";

export interface ProductImageMeta {
  format: ProductImageFormat;
  mime: string;
  ext: "png" | "jpg" | "webp";
  width: number;
  height: number;
}

const MIME_BY_FORMAT: Record<ProductImageFormat, string> = {
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

const EXT_BY_FORMAT: Record<ProductImageFormat, ProductImageMeta["ext"]> = {
  png: "png",
  jpeg: "jpg",
  webp: "webp",
};

export const ALLOWED_PRODUCT_IMAGE_MIMES = Object.values(MIME_BY_FORMAT);

function reject(message: string): never {
  throw new BadRequestException({ code: "VALIDATION_FAILED", message });
}

function mb(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(2).replace(/\.?0+$/, "");
}

export function validateProductImage(buf: Buffer, declaredMime?: string): ProductImageMeta {
  if (!buf || buf.length === 0) reject("El archivo está vacío.");
  if (buf.length > MAX_PRODUCT_IMAGE_BYTES) {
    reject(`La imagen pesa ${mb(buf.length)} MB; el máximo es ${mb(MAX_PRODUCT_IMAGE_BYTES)} MB.`);
  }

  const sniffed = sniffFormat(buf);
  if (sniffed === "gif") reject("Los GIF no están permitidos (suelen ser animados): usa PNG, JPG o WebP.");
  if (sniffed === "svg") reject("SVG no está permitido para fotos de producto: usa PNG, JPG o WebP.");
  if (!sniffed) {
    const declared = declaredMime?.toLowerCase().split(";")[0]?.trim();
    if (declared && ALLOWED_PRODUCT_IMAGE_MIMES.includes(declared)) {
      reject(`El archivo dice ser ${declared} pero su contenido no corresponde a una imagen válida.`);
    }
    reject("Formato no permitido. Sube un PNG, JPG o WebP.");
  }

  const format = sniffed;
  const mime = MIME_BY_FORMAT[format];
  const ext = EXT_BY_FORMAT[format];

  const dims = format === "png" ? parsePng(buf) : format === "jpeg" ? parseJpeg(buf) : parseWebp(buf);
  if (!dims) reject("No se pudieron leer las dimensiones de la imagen; el archivo puede estar dañado.");
  if (dims.animated) reject("No se admiten imágenes animadas; sube una foto estática.");
  if (dims.width < MIN_PRODUCT_IMAGE_SIDE || dims.height < MIN_PRODUCT_IMAGE_SIDE) {
    reject(
      `La imagen mide ${dims.width}×${dims.height} px; el mínimo es ${MIN_PRODUCT_IMAGE_SIDE}×${MIN_PRODUCT_IMAGE_SIDE} px.`,
    );
  }
  if (dims.width > MAX_PRODUCT_IMAGE_SIDE || dims.height > MAX_PRODUCT_IMAGE_SIDE) {
    reject(
      `La imagen mide ${dims.width}×${dims.height} px; el máximo es ${MAX_PRODUCT_IMAGE_SIDE}×${MAX_PRODUCT_IMAGE_SIDE} px.`,
    );
  }
  return { format, mime, ext, width: dims.width, height: dims.height };
}
