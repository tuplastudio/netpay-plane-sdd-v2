import { describe, expect, it, beforeEach } from "vitest";

/**
 * Verifica el contrato de seguridad de los tokens de un solo uso:
 *  - la firma cambia con el `purpose` (INVITE no es aceptable en reset, etc.)
 *  - un token firmado con un secret distinto no valida
 *  - el hash guardado en DB es del fragmento aleatorio, no del token entero
 *    (porque si no, dos tokens con mismo random + diferente purpose romperían
 *    la búsqueda).
 *  - el formato malformado se rechaza sin filtrar info.
 */

process.env.TOKEN_ENCRYPTION_KEY_REF = "test_secret_32_chars_pad_pad_pad_pad_pad";

const { TokenService } = await import("../src/auth/token.service.js");

describe("TokenService — sign + verify + cross-purpose rejection", () => {
  let svc: InstanceType<typeof TokenService>;
  beforeEach(() => {
    svc = new TokenService();
  });

  it("issue → verify devuelve el hash y el purpose esperado", () => {
    const issued = svc.issue({ purpose: "PASSWORD_RESET", expiresInMs: 60_000 });
    const verified = svc.verify(issued.token, "PASSWORD_RESET");
    expect(verified.tokenHash).toBe(issued.tokenHash);
    expect(verified.purpose).toBe("PASSWORD_RESET");
  });

  it("un token PASSWORD_RESET no pasa como INVITE", () => {
    const issued = svc.issue({ purpose: "PASSWORD_RESET", expiresInMs: 60_000 });
    expect(() => svc.verify(issued.token, "INVITE")).toThrow();
  });

  it("un INVITE no pasa como PASSWORD_RESET", () => {
    const issued = svc.issue({ purpose: "INVITE", expiresInMs: 60_000 });
    expect(() => svc.verify(issued.token, "PASSWORD_RESET")).toThrow();
  });

  it("un token con firma manipulada no valida", () => {
    const issued = svc.issue({ purpose: "INVITE", expiresInMs: 60_000 });
    const [random, sig] = issued.token.split(".");
    // Mismo random, firma distinta → debería fallar.
    const tampered = `${random}.${sig.slice(0, -2)}aa`;
    expect(() => svc.verify(tampered, "INVITE")).toThrow();
  });

  it("un token con firma de otro secret no valida", () => {
    const issued = svc.issue({ purpose: "INVITE", expiresInMs: 60_000 });
    const original = process.env.TOKEN_ENCRYPTION_KEY_REF;
    process.env.TOKEN_ENCRYPTION_KEY_REF = "otro_secret_32_chars_pad_pad_pad_pad_pad";
    const other = new TokenService();
    expect(() => other.verify(issued.token, "INVITE")).toThrow();
    process.env.TOKEN_ENCRYPTION_KEY_REF = original;
  });

  it("formato malformado lanza sin distinguir motivo", () => {
    expect(() => svc.verify("solo-una-parte", "INVITE")).toThrow();
    expect(() => svc.verify("", "INVITE")).toThrow();
    expect(() => svc.verify("a.b.c", "INVITE")).toThrow();
  });

  it("dos issues del mismo purpose producen tokens y hashes distintos", () => {
    const a = svc.issue({ purpose: "INVITE", expiresInMs: 60_000 });
    const b = svc.issue({ purpose: "INVITE", expiresInMs: 60_000 });
    expect(a.token).not.toBe(b.token);
    expect(a.tokenHash).not.toBe(b.tokenHash);
  });

  it("hash es estable sobre el fragmento random (lookup de DB)", () => {
    const issued = svc.issue({ purpose: "PASSWORD_RESET", expiresInMs: 60_000 });
    const randomPart = issued.token.split(".")[0];
    expect(svc.hash(randomPart)).toBe(issued.tokenHash);
    // Hash sobre el token completo NO coincide — clave para que el índice único
    // en DB no se rompa al firmar con purpose distinto.
    expect(svc.hash(issued.token)).not.toBe(issued.tokenHash);
  });
});