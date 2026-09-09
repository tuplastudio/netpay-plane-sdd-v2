/**
 * Tokens de un solo uso: invitación, recuperación, MFA, etc.
 * Ver docs/03-iam.md T-IAM-02.
 */

import { Injectable } from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";

export type TokenPurpose = "INVITE" | "PASSWORD_RESET" | "MFA_CHALLENGE";

export interface IssueTokenInput {
  tenantId: string;
  email: string;
  purpose: TokenPurpose;
  expiresInMs: number; // ej: 48h, 30min, 5min
  metadata?: Record<string, unknown>;
}

export interface IssueTokenResult {
  token: string;
  tokenHash: string;
  expiresAt: Date;
}

@Injectable()
export class TokenService {
  issue(input: IssueTokenInput): IssueTokenResult {
    const token = randomBytes(32).toString("base64url");
    const tokenHash = this.hash(token);
    const expiresAt = new Date(Date.now() + input.expiresInMs);
    void input;
    return { token, tokenHash, expiresAt };
  }

  hash(token: string): string {
    return createHash("sha256").update(token).digest("hex");
  }
}