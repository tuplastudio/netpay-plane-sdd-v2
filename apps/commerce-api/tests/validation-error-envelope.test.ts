import "reflect-metadata";
import { ArgumentsHost, ValidationPipe } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { HttpExceptionFilter } from "../src/common/filters/http-exception.filter.js";
import { validationExceptionFactory } from "../src/common/validation/validation-exception.factory.js";
import { CreateQuoteDto } from "../src/quotes/quote.dto.js";
import { QuickChargeDto } from "../src/orders/order.dto.js";

/**
 * Un rechazo de DTO tiene que llegar al cliente como el error de campo, no como
 * el genérico "Bad Request Exception".
 *
 * El `exceptionFactory` por defecto del ValidationPipe pone `message` como
 * array; `HttpExceptionFilter` solo propaga `message` cuando es string, así que
 * `HttpException.message` caía al nombre de la clase. La prueba recorre el
 * camino completo —pipe real con el mismo `ValidationPipe` de `main.ts`, error
 * real, filtro real— y mira lo que se escribe en la respuesta HTTP.
 */

const PIPE = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  exceptionFactory: validationExceptionFactory,
});

const DEFAULT_PIPE = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});

interface Captured {
  status: number;
  body: {
    error: { code: string; message: string; retryable: boolean; traceId: string };
    requestId: string;
  };
}

/** Pasa `body` por el pipe y, si rebota, por el filtro global. Devuelve el JSON. */
async function reject(
  pipe: ValidationPipe,
  metatype: new () => object,
  body: unknown,
): Promise<Captured> {
  let thrown: unknown;
  try {
    await pipe.transform(body, { type: "body", metatype });
  } catch (err) {
    thrown = err;
  }
  expect(thrown, "el pipe debía rechazar el cuerpo").toBeDefined();

  const captured = {} as Captured;
  const res = {
    status(code: number) {
      captured.status = code;
      return this;
    },
    json(payload: Captured["body"]) {
      captured.body = payload;
      return this;
    },
  };
  const host = {
    switchToHttp: () => ({
      getResponse: () => res,
      getRequest: () => ({ method: "POST", url: "/api/v1/test" }),
    }),
  } as unknown as ArgumentsHost;

  new HttpExceptionFilter().catch(thrown, host);
  return captured;
}

describe("errores de validación de DTO en el sobre de error", () => {
  it("propaga el mensaje del campo, no 'Bad Request Exception'", async () => {
    const out = await reject(PIPE, QuickChargeDto, {
      description: "",
      amountTotal: "10.00",
    });

    expect(out.status).toBe(400);
    expect(out.body.error.code).toBe("VALIDATION_FAILED");
    expect(out.body.error.message).not.toBe("Bad Request Exception");
    expect(out.body.error.message).toContain("description");
    expect(out.body.error.message).toContain("al menos 1 caracteres");
  });

  it("el pipe por defecto sí producía el mensaje genérico (regresión)", async () => {
    const out = await reject(DEFAULT_PIPE, QuickChargeDto, {
      description: "",
      amountTotal: "10.00",
    });

    expect(out.status).toBe(400);
    expect(out.body.error.message).toBe("Bad Request Exception");
  });

  it("conserva el mensaje en español escrito a mano en el DTO", async () => {
    const out = await reject(PIPE, QuickChargeDto, {
      description: "Cobro mostrador",
      amountTotal: "10.00",
      idempotencyKey: "corto",
    });

    expect(out.body.error.message).toContain(
      "idempotencyKey debe ser un identificador opaco de 8 a 128 caracteres",
    );
  });

  it("nombra la ruta completa dentro de objetos anidados", async () => {
    const out = await reject(PIPE, CreateQuoteDto, {
      customerId: "11111111-1111-1111-1111-111111111111",
      lines: [{ variantId: "no-es-uuid", quantity: "1.500" }],
    });

    expect(out.body.error.message).toContain("lines.0.variantId debe ser un UUID válido");
  });

  it("rechaza campos no declarados con un mensaje en español", async () => {
    const out = await reject(PIPE, QuickChargeDto, {
      description: "Cobro mostrador",
      amountTotal: "10.00",
      sobrante: 1,
    });

    expect(out.body.error.message).toContain("el campo sobrante no está permitido");
  });

  it("no deja escapar texto en inglés de class-validator", async () => {
    const out = await reject(PIPE, CreateQuoteDto, {
      customerId: 42,
      lines: [],
      notes: "x".repeat(1001),
      issue: "sí",
    });

    expect(out.body.error.message).not.toMatch(/\bmust\b|\bshould\b/);
    expect(out.body.error.message.startsWith("Datos inválidos: ")).toBe(true);
  });
});
