import { Injectable } from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";

/**
 * Rate limit básico en memoria por (email, ip).
 * 5 intentos / 15 min por cuenta e IP con bloqueo temporal.
 * Ver docs/03-iam.md AC-IAM-01.
 *
 * NOTA V2: para producción usar Redis. Mantiene buckets en memoria aquí
 * para arrancar sin dependencias adicionales.
 */

interface Bucket {
  attempts: number;
  windowStart: number;
  blockedUntil: number | null;
}

@Injectable()
export class RateLimitService {
  private readonly buckets = new Map<string, Bucket>();
  private readonly WINDOW_MS = 15 * 60 * 1000;
  private readonly MAX_ATTEMPTS = 5;
  private readonly BLOCK_MS = 15 * 60 * 1000;

  /** Devuelve true si está permitido, false si está bloqueado. */
  allow(key: string): boolean {
    this.gc();
    const b = this.buckets.get(key);
    if (!b) return true;
    if (b.blockedUntil && b.blockedUntil > Date.now()) return false;
    if (Date.now() - b.windowStart > this.WINDOW_MS) {
      this.buckets.delete(key);
      return true;
    }
    return b.attempts < this.MAX_ATTEMPTS;
  }

  /** Registra un fallo; si excede, bloquea. */
  recordFailure(key: string): void {
    const now = Date.now();
    const b = this.buckets.get(key);
    if (!b || now - b.windowStart > this.WINDOW_MS) {
      this.buckets.set(key, { attempts: 1, windowStart: now, blockedUntil: null });
      return;
    }
    b.attempts += 1;
    if (b.attempts >= this.MAX_ATTEMPTS) {
      b.blockedUntil = now + this.BLOCK_MS;
    }
  }

  reset(key: string): void {
    this.buckets.delete(key);
  }

  private gc(): void {
    const now = Date.now();
    for (const [k, b] of this.buckets.entries()) {
      const expired =
        now - b.windowStart > this.WINDOW_MS && (!b.blockedUntil || b.blockedUntil < now);
      if (expired) this.buckets.delete(k);
    }
  }

  static keyFor(email: string, ip: string | undefined): string {
    return `login:${createHash("sha256").update(`${email}|${ip ?? ""}`).digest("hex")}`;
  }
}

export function newSessionToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  const hash = createHash("sha256").update(token).digest("hex");
  return { token, hash };
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}