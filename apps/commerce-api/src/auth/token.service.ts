/**
 * Tokens de un solo uso: invitación, recuperación, MFA, etc.
 * Ver docs/03-iam.md T-IAM-02.
 *
 * Cada token se firma con HMAC-SHA256 sobre `<random>.<purpose>` usando
 * `TOKEN_ENCRYPTION_KEY_REF` como secreto (validado en security.middleware).
 * Formato: `<base64url-random>.<base64url-firma>`. Eso ata criptográficamente
 * el `purpose` al token: `resetPassword` rechaza un INVITE token aunque el
 * hash coincidiera por colisión y un atacante externo no puede forjar tokens
 * porque no conoce la clave de firma.
 */

import { Injectable } from "@nestjs/common";
import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

export type TokenPurpose = "INVITE" | "PASSWORD_RESET" | "MFA_CHALLENGE";

export interface IssueTokenInput {
  purpose: TokenPurpose;
  expiresInMs: number; // ej: 48h, 30min, 5min
}

export interface IssueTokenResult {
  token: string;
  tokenHash: string;
  purpose: TokenPurpose;
  expiresAt: Date;
}

export interface VerifiedToken {
  tokenHash: string;
  purpose: TokenPurpose;
}

function signingKey(): Buffer {
  // Misma clave derivada que secret-cipher; validada >=32 chars al arranque.
  return createHash("sha256")
    .update(process.env.TOKEN_ENCRYPTION_KEY_REF ?? "")
    .digest();
}

function sign(randomPart: string, purpose: TokenPurpose): string {
  return createHmac("sha256", signingKey())
    .update(`${randomPart}.${purpose}`)
    .digest("base64url");
}

@Injectable()
export class TokenService {
  issue(input: IssueTokenInput): IssueTokenResult {
    const random = randomBytes(32).toString("base64url");
    const signature = sign(random, input.purpose);
    const token = `${random}.${signature}`;
    const tokenHash = this.hash(random);
    const expiresAt = new Date(Date.now() + input.expiresInMs);
    return { token, tokenHash, purpose: input.purpose, expiresAt };
  }

  /**
   * Verifica firma + purpose. Devuelve el hash del fragmento aleatorio listo
   * para la búsqueda en DB. Lanza si el formato es inválido, la firma no
   * corresponde, o el purpose no coincide con el esperado.
   */
  verify(token: string, expectedPurpose: TokenPurpose): VerifiedToken {
    const parts = token.split(".");
    if (parts.length !== 2) {
      throw new Error("Token con formato inválido");
    }
    const random = parts[0]!;
    const signature = parts[1]!;
    const expectedSignature = sign(random, expectedPurpose);
    const sigBuf = Buffer.from(signature);
    const expBuf = Buffer.from(expectedSignature);
    if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
      throw new Error("Firma de token inválida o purpose no coincide");
    }
    return { tokenHash: this.hash(random), purpose: expectedPurpose };
  }

  /**
   * Hash estable del fragmento aleatorio, usado como índice único en la DB.
   * NO se hashea el token completo: el sufijo de firma cambia con el purpose
   * y rompería la búsqueda.
   */
  hash(random: string): string {
    return createHash("sha256").update(random).digest("hex");
  }
}