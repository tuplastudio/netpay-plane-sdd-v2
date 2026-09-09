import { Injectable, Logger } from "@nestjs/common";
import argon2 from "argon2";

/**
 * Argon2id con parámetros calibrados. Ver docs/03-iam.md T-IAM-01.
 */
@Injectable()
export class PasswordService {
  private readonly logger = new Logger(PasswordService.name);

  private readonly opts = {
    type: argon2.argon2id,
    memoryCost: 19456, // 19 MiB
    timeCost: 2,
    parallelism: 1,
  } as const;

  async hash(password: string): Promise<string> {
    this.assertComplexity(password);
    return argon2.hash(password, this.opts);
  }

  async verify(hash: string, password: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, password);
    } catch (err) {
      this.logger.warn(`Argon2 verify failed: ${String(err)}`);
      return false;
    }
  }

  /** Mínimo 12 chars, al menos una mayúscula, minúscula, dígito, símbolo. */
  private assertComplexity(password: string): void {
    if (password.length < 12 || password.length > 256) {
      throw new Error("Password length must be 12-256");
    }
    if (!/[a-z]/.test(password)) throw new Error("Password needs lowercase");
    if (!/[A-Z]/.test(password)) throw new Error("Password needs uppercase");
    if (!/[0-9]/.test(password)) throw new Error("Password needs digit");
    if (!/[^A-Za-z0-9]/.test(password)) throw new Error("Password needs symbol");
  }
}