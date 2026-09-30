/**
 * Firma de las entregas salientes.
 *
 * Header: `X-EasySell-Signature: t=<unix seconds>,v1=<hex>`
 * donde `v1 = HMAC-SHA256(secret, "<t>.<body>")`.
 *
 * Incluir `t` en lo firmado evita reproducir una entrega vieja con otra
 * marca de tiempo: el receptor compara `t` con su reloj (tolerancia
 * recomendada: 5 minutos) y recalcula el HMAC con el cuerpo crudo.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

export const SIGNATURE_HEADER = "x-easysell-signature";
export const SIGNATURE_VERSION = "v1";

/** Cadena firmada: `<timestamp>.<body>`. */
export function signedPayload(timestamp: number, body: string): string {
  return `${timestamp}.${body}`;
}

/** HMAC-SHA256 en hex de `<timestamp>.<body>`. */
export function computeSignature(secret: string, timestamp: number, body: string): string {
  return createHmac("sha256", secret).update(signedPayload(timestamp, body)).digest("hex");
}

/** Valor completo del header `X-EasySell-Signature`. */
export function buildSignatureHeader(secret: string, timestamp: number, body: string): string {
  return `t=${timestamp},${SIGNATURE_VERSION}=${computeSignature(secret, timestamp, body)}`;
}

/** Parsea `t=...,v1=...`. `null` si el formato no es el esperado. */
export function parseSignatureHeader(header: string): { timestamp: number; signature: string } | null {
  const parts = new Map<string, string>();
  for (const chunk of header.split(",")) {
    const idx = chunk.indexOf("=");
    if (idx <= 0) continue;
    parts.set(chunk.slice(0, idx).trim(), chunk.slice(idx + 1).trim());
  }
  const t = Number(parts.get("t"));
  const signature = parts.get(SIGNATURE_VERSION);
  if (!Number.isInteger(t) || t <= 0 || !signature || !/^[0-9a-f]{64}$/i.test(signature)) return null;
  return { timestamp: t, signature: signature.toLowerCase() };
}

/**
 * Verificación de referencia (la misma que documentamos para los receptores):
 * recalcula la firma y compara en tiempo constante; rechaza si `t` se sale de
 * la tolerancia.
 */
export function verifySignature(input: {
  secret: string;
  header: string;
  body: string;
  now?: number;
  toleranceSeconds?: number;
}): boolean {
  const parsed = parseSignatureHeader(input.header);
  if (!parsed) return false;
  const nowSeconds = input.now ?? Math.floor(Date.now() / 1000);
  const tolerance = input.toleranceSeconds ?? 300;
  if (Math.abs(nowSeconds - parsed.timestamp) > tolerance) return false;
  const expected = Buffer.from(computeSignature(input.secret, parsed.timestamp, input.body), "hex");
  const given = Buffer.from(parsed.signature, "hex");
  return expected.length === given.length && timingSafeEqual(expected, given);
}
