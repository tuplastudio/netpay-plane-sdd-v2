import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * Cifrado simétrico reversible para secretos que deben recuperarse en claro
 * (webhook shared secrets, TOTP seeds) — nunca usar hash de una vía aquí.
 * Clave derivada de TOKEN_ENCRYPTION_KEY_REF (validada en security.middleware).
 */
function encryptionKey(): Buffer {
  return createHash("sha256").update(process.env.TOKEN_ENCRYPTION_KEY_REF ?? "").digest();
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64"), enc.toString("base64"), tag.toString("base64")].join(".");
}

export function decryptSecret(stored: string): string | null {
  const [ivB64, encB64, tagB64] = stored.split(".");
  if (!ivB64 || !encB64 || !tagB64) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivB64, "base64"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(encB64, "base64")), decipher.final()]).toString(
      "utf8",
    );
  } catch {
    return null;
  }
}
