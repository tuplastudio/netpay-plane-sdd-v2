/**
 * MFA TOTP (RFC 6238) y recovery codes. Ver docs/03-iam.md T-IAM-02.
 *
 * Implementación mínima compatible con Google Authenticator / Authy:
 *   - HMAC-SHA1, 6 dígitos, step 30s.
 *   - Tolera ±1 step de drift.
 *
 * El `totpSecret` se guarda en BD **cifrado** a nivel aplicación. Aquí se
 * recibe el secreto plano y se delega cifrado a un wrapper fuera del scope
 * (T-OPS-01 rotación de TOKEN_ENCRYPTION_KEY).
 */

import { createHmac, randomBytes, createHash } from "node:crypto";
import { Injectable } from "@nestjs/common";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 0x1f];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 0x1f];
  return output;
}

function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/=+$/, "").replace(/\s+/g, "");
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const ch of clean) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx < 0) throw new Error("Invalid base32");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

function hotp(secret: Buffer, counter: bigint, digits = 6): string {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(counter);
  const hmac = createHmac("sha1", secret).update(buf).digest();
  const offset = (hmac[hmac.length - 1] ?? 0) & 0x0f;
  const binary =
    (((hmac[offset] ?? 0) & 0x7f) << 24) |
    (((hmac[offset + 1] ?? 0) & 0xff) << 16) |
    (((hmac[offset + 2] ?? 0) & 0xff) << 8) |
    ((hmac[offset + 3] ?? 0) & 0xff);
  const otp = binary % 10 ** digits;
  return otp.toString().padStart(digits, "0");
}

export interface MfaEnrollment {
  secretBase32: string;
  otpauthUrl: string;
  recoveryCodes: string[];
}

@Injectable()
export class MfaService {
  private readonly ISSUER = "Atiende ya";

  /** Genera un nuevo secreto TOTP + URL otpauth + N recovery codes. */
  enroll(userEmail: string): MfaEnrollment {
    const secret = randomBytes(20);
    const secretBase32 = base32Encode(secret);
    const otpauthUrl =
      `otpauth://totp/${encodeURIComponent(this.ISSUER)}:` +
      `${encodeURIComponent(userEmail)}?secret=${secretBase32}` +
      `&issuer=${encodeURIComponent(this.ISSUER)}&digits=6&period=30`;
    const recoveryCodes = Array.from({ length: 10 }, () =>
      randomBytes(8).toString("hex"),
    );
    return { secretBase32, otpauthUrl, recoveryCodes };
  }

  /** Verifica código TOTP con tolerancia de ±1 step. */
  verifyTotp(secretBase32: string, code: string): boolean {
    if (!/^\d{6}$/.test(code)) return false;
    const secret = base32Decode(secretBase32);
    const step = 30n;
    const now = BigInt(Math.floor(Date.now() / 1000));
    const counter = now / step;
    for (const offset of [-1n, 0n, 1n]) {
      const candidate = hotp(secret, counter + offset);
      if (candidate === code) return true;
    }
    return false;
  }

  /** Hashea recovery codes con SHA-256 antes de persistir. */
  hashRecoveryCodes(codes: string[]): string[] {
    return codes.map((c) => createHash("sha256").update(c).digest("hex"));
  }

  /** Verifica un recovery code contra los hasheados; marca usado. */
  consumeRecoveryCode(hashed: string[], code: string): string[] | null {
    const want = createHash("sha256").update(code).digest("hex");
    if (!hashed.includes(want)) return null;
    return hashed.filter((h) => h !== want);
  }
}