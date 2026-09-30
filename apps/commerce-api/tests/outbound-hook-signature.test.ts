import { describe, expect, it } from "vitest";
import {
  buildSignatureHeader,
  computeSignature,
  parseSignatureHeader,
  verifySignature,
} from "../src/hooks/hook-signature.js";

/**
 * Firma `X-EasySell-Signature: t=<ts>,v1=<hex>` con
 * `v1 = HMAC-SHA256(secret, "<ts>.<body>")`.
 *
 * El vector fijo es el que documentamos en docs/integrations/outbound-hooks.md:
 * si cambia la forma de firmar, cambia aquí y en la guía del receptor.
 */

const SECRET = "whsec_test_secret";
const TIMESTAMP = 1700000000;
const BODY =
  '{"id":"evt-1","event":"ping","occurredAt":"2026-01-15T17:05:00.000Z","tenantId":"t-1","data":{"message":"pong"},"version":1}';
const EXPECTED = "dab1055a077a7520b8691f229b830e7e93aa3fc21ba7379fc1f1408feb932146";

describe("firma HMAC de hooks salientes", () => {
  it("produce el vector fijo documentado", () => {
    expect(computeSignature(SECRET, TIMESTAMP, BODY)).toBe(EXPECTED);
    expect(buildSignatureHeader(SECRET, TIMESTAMP, BODY)).toBe(`t=${TIMESTAMP},v1=${EXPECTED}`);
  });

  it("parsea el header y tolera espacios", () => {
    expect(parseSignatureHeader(`t=${TIMESTAMP}, v1=${EXPECTED}`)).toEqual({
      timestamp: TIMESTAMP,
      signature: EXPECTED,
    });
    expect(parseSignatureHeader("v1=abc")).toBeNull();
    expect(parseSignatureHeader(`t=${TIMESTAMP},v1=zz`)).toBeNull();
  });

  it("verifica con el secreto correcto dentro de la tolerancia", () => {
    const header = buildSignatureHeader(SECRET, TIMESTAMP, BODY);
    expect(verifySignature({ secret: SECRET, header, body: BODY, now: TIMESTAMP + 60 })).toBe(true);
  });

  it("rechaza cuerpo alterado, secreto distinto y marca de tiempo vieja", () => {
    const header = buildSignatureHeader(SECRET, TIMESTAMP, BODY);
    expect(verifySignature({ secret: SECRET, header, body: BODY.replace("pong", "ping"), now: TIMESTAMP })).toBe(
      false,
    );
    expect(verifySignature({ secret: "otro", header, body: BODY, now: TIMESTAMP })).toBe(false);
    expect(verifySignature({ secret: SECRET, header, body: BODY, now: TIMESTAMP + 3600 })).toBe(false);
    expect(
      verifySignature({ secret: SECRET, header, body: BODY, now: TIMESTAMP + 3600, toleranceSeconds: 7200 }),
    ).toBe(true);
  });
});
