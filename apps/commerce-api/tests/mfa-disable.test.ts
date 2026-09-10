import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { AuthService } from "../src/auth/auth.service.js";
import type { PrismaService } from "../src/prisma/prisma.service.js";
import type { PasswordService } from "../src/auth/password.service.js";
import type { RateLimitService } from "../src/auth/rate-limit.service.js";
import type { SessionService } from "../src/auth/session.service.js";
import { MfaService } from "../src/auth/mfa.service.js";
import { encryptSecret } from "../src/common/crypto/secret-cipher.js";

/**
 * Apagar MFA y regenerar recovery codes (AuthService#disableMfa /
 * #regenerateRecoveryCodes).
 *
 * Contrato: ninguna de las dos operaciones se hace solo con la sesión del
 * navegador — piden un TOTP vigente (o, para apagar, un recovery code) y
 * dejan rastro en AuditLog cuando hay tenant activo.
 */

const USER_ID = "11111111-1111-1111-1111-111111111111";
const TENANT_ID = "22222222-2222-2222-2222-222222222222";

const mfa = new MfaService();
const enrollment = mfa.enroll("owner@demo.local");
const validCode = (() => {
  // Genera un código válido para el secreto de prueba sin esperar el reloj:
  // se prueban los tres steps que `verifyTotp` acepta y nos quedamos con uno.
  for (const offset of [0, -1, 1]) {
    const step = 30;
    const counter = Math.floor(Date.now() / 1000 / step) + offset;
    const candidate = totpAt(enrollment.secretBase32, counter);
    if (mfa.verifyTotp(enrollment.secretBase32, candidate)) return candidate;
  }
  throw new Error("no valid code generated");
})();

function totpAt(secretBase32: string, counter: number): string {
  // Reimplementa el HOTP interno de MfaService para armar un código de
  // prueba determinista (no está expuesto públicamente a propósito).
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = secretBase32.toUpperCase().replace(/=+$/, "");
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const ch of clean) {
    const idx = alphabet.indexOf(ch);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  const secret = Buffer.from(bytes);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac("sha1", secret).update(buf).digest();
  const offset = (hmac[hmac.length - 1] ?? 0) & 0x0f;
  const binary =
    (((hmac[offset] ?? 0) & 0x7f) << 24) |
    (((hmac[offset + 1] ?? 0) & 0xff) << 16) |
    (((hmac[offset + 2] ?? 0) & 0xff) << 8) |
    ((hmac[offset + 3] ?? 0) & 0xff);
  return (binary % 10 ** 6).toString().padStart(6, "0");
}

function makeService(user: {
  totpEnabled: boolean;
  totpSecret: string | null;
  recoveryCodesHash: string[] | null;
}) {
  const writes: Array<{ table: string; data: unknown }> = [];
  const state = { ...user };
  const prisma = {
    user: {
      findUnique: async () => ({ id: USER_ID, ...state }),
      update: async ({ data }: { data: Record<string, unknown> }) => {
        Object.assign(state, data);
        return { id: USER_ID, ...state };
      },
    },
    auditLog: {
      create: async ({ data }: { data: unknown }) => {
        writes.push({ table: "auditLog", data });
      },
    },
  };
  const service = new AuthService(
    prisma as unknown as PrismaService,
    {} as unknown as PasswordService,
    {} as unknown as RateLimitService,
    {} as unknown as SessionService,
    mfa,
  );
  return { service, writes, state };
}

describe("AuthService#disableMfa", () => {
  it("rechaza si MFA no está activado", async () => {
    const { service } = makeService({ totpEnabled: false, totpSecret: null, recoveryCodesHash: null });
    await expect(service.disableMfa(USER_ID, validCode, TENANT_ID)).rejects.toMatchObject({
      response: { code: "RULE_VIOLATION" },
    });
  });

  it("rechaza un código inválido", async () => {
    const { service } = makeService({
      totpEnabled: true,
      totpSecret: encryptSecret(enrollment.secretBase32),
      recoveryCodesHash: mfa.hashRecoveryCodes(enrollment.recoveryCodes),
    });
    await expect(service.disableMfa(USER_ID, "000000", TENANT_ID)).rejects.toMatchObject({
      response: { code: "UNAUTHORIZED" },
    });
  });

  it("apaga MFA con un TOTP vigente y audita con el tenant activo", async () => {
    const { service, writes, state } = makeService({
      totpEnabled: true,
      totpSecret: encryptSecret(enrollment.secretBase32),
      recoveryCodesHash: mfa.hashRecoveryCodes(enrollment.recoveryCodes),
    });
    await service.disableMfa(USER_ID, validCode, TENANT_ID);
    expect(state.totpEnabled).toBe(false);
    expect(state.totpSecret).toBeNull();
    expect(writes).toHaveLength(1);
    expect(writes[0]!.data).toMatchObject({ tenantId: TENANT_ID, action: "auth.mfa_disabled" });
  });

  it("apaga MFA con un recovery code y no audita sin tenant activo", async () => {
    const { service, writes, state } = makeService({
      totpEnabled: true,
      totpSecret: encryptSecret(enrollment.secretBase32),
      recoveryCodesHash: mfa.hashRecoveryCodes(enrollment.recoveryCodes),
    });
    await service.disableMfa(USER_ID, enrollment.recoveryCodes[0]!, null);
    expect(state.totpEnabled).toBe(false);
    expect(writes).toHaveLength(0);
  });
});

describe("AuthService#regenerateRecoveryCodes", () => {
  it("exige un TOTP vigente, no acepta recovery codes", async () => {
    const { service } = makeService({
      totpEnabled: true,
      totpSecret: encryptSecret(enrollment.secretBase32),
      recoveryCodesHash: mfa.hashRecoveryCodes(enrollment.recoveryCodes),
    });
    await expect(
      service.regenerateRecoveryCodes(USER_ID, enrollment.recoveryCodes[0]!, TENANT_ID),
    ).rejects.toMatchObject({ response: { code: "UNAUTHORIZED" } });
  });

  it("reemplaza los 10 códigos y audita", async () => {
    const { service, writes, state } = makeService({
      totpEnabled: true,
      totpSecret: encryptSecret(enrollment.secretBase32),
      recoveryCodesHash: mfa.hashRecoveryCodes(enrollment.recoveryCodes),
    });
    const before = state.recoveryCodesHash;
    const fresh = await service.regenerateRecoveryCodes(USER_ID, validCode, TENANT_ID);
    expect(fresh).toHaveLength(10);
    expect(state.recoveryCodesHash).not.toEqual(before);
    expect(writes[0]!.data).toMatchObject({ action: "auth.mfa_recovery_regenerated" });
  });
});
