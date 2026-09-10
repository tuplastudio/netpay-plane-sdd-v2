import { describe, expect, it } from "vitest";

/**
 * Los endpoints públicos /auth/forgot-password y /auth/reset-password deben
 * rechazar payloads fuera de contrato con el sobre de error en español, igual
 * que el resto del API (ver validation-error-envelope.test.ts).
 */

import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import { validationExceptionFactory } from "../src/common/validation/validation-exception.factory.js";
import { ForgotPasswordDto, ResetPasswordDto } from "../src/auth/auth.dto.js";

const PIPE = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  exceptionFactory: validationExceptionFactory,
});

async function reject<T extends object>(metatype: new () => T, body: unknown) {
  let thrown: unknown;
  try {
    await PIPE.transform(body, { type: "body", metatype });
  } catch (err) {
    thrown = err;
  }
  expect(thrown).toBeDefined();
  return thrown as Error & { message: string | string[] };
}

describe("ForgotPasswordDto", () => {
  it("acepta un email válido", async () => {
    const out = await PIPE.transform(
      { email: "hola@aliciagonzalez.cx" },
      { type: "body", metatype: ForgotPasswordDto },
    );
    expect(out).toBeInstanceOf(ForgotPasswordDto);
  });

  it("rechaza email inválido en español", async () => {
    const err = await reject(ForgotPasswordDto, { email: "no-es-correo" });
    const msg = Array.isArray(err.message) ? err.message.join(" ") : String(err.message);
    expect(msg).toMatch(/email/i);
  });

  it("rechaza email ausente", async () => {
    await reject(ForgotPasswordDto, {});
  });

  it("rechaza campos extra (whitelist)", async () => {
    const err = await reject(ForgotPasswordDto, { email: "a@b.co", extra: 1 });
    const msg = Array.isArray(err.message) ? err.message.join(" ") : String(err.message);
    expect(msg).toMatch(/extra/i);
  });
});

describe("ResetPasswordDto", () => {
  it("acepta token + password >= 12", async () => {
    const out = await PIPE.transform(
      {
        token: "x".repeat(20),
        newPassword: "Abcdef1!Segura",
      },
      { type: "body", metatype: ResetPasswordDto },
    );
    expect(out).toBeInstanceOf(ResetPasswordDto);
  });

  it("rechaza password corto", async () => {
    const err = await reject(ResetPasswordDto, { token: "x".repeat(20), newPassword: "corto1!" });
    const msg = Array.isArray(err.message) ? err.message.join(" ") : String(err.message);
    expect(msg).toMatch(/newPassword|12/i);
  });

  it("rechaza token ausente", async () => {
    await reject(ResetPasswordDto, { newPassword: "Abcdef1!Segura" });
  });

  it("rechaza campos extra", async () => {
    const err = await reject(ResetPasswordDto, {
      token: "x".repeat(20),
      newPassword: "Abcdef1!Segura",
      sobrante: true,
    });
    const msg = Array.isArray(err.message) ? err.message.join(" ") : String(err.message);
    expect(msg).toMatch(/sobrante/i);
  });
});