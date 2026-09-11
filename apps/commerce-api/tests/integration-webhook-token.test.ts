import { describe, expect, it } from "vitest";
import { BadRequestException } from "@nestjs/common";
import type { Request } from "express";
import { IntegrationController } from "../src/integrations/integration.controller.js";

/**
 * Regresión de aislamiento entre empresas en el webhook entrante público.
 *
 * `POST /integrations/webhook/:token` resolvía la integración con
 * `webhookUrl: { contains: token }`. Como la URL guardada es
 * `https://api.example.com/api/v1/integrations/webhook/<hex>`, un token como
 * "api" hacía match con las integraciones de TODAS las empresas y findFirst
 * devolvía una cualquiera: el evento entraba en el tenant de otro, y el
 * endpoint servía de oráculo para adivinar el token real por prefijos.
 *
 * Prisma es un fake en memoria; no hay base de datos.
 */

const TOKEN_ACME = "aaaaaaaaaaaaaaaaaaaaaaaa";
const TOKEN_GLOBEX = "bbbbbbbbbbbbbbbbbbbbbbbb";

interface Row {
  [key: string]: unknown;
}

function makeController() {
  const integrations: Row[] = [
    {
      id: "int-acme",
      tenantId: "t-acme",
      webhookUrl: `https://api.example.com/api/v1/integrations/webhook/${TOKEN_ACME}`,
    },
    {
      id: "int-globex",
      tenantId: "t-globex",
      webhookUrl: `https://api.example.com/api/v1/integrations/webhook/${TOKEN_GLOBEX}`,
    },
  ];

  const prisma = {
    integration: {
      findFirst: async ({ where }: { where: { webhookUrl?: { endsWith?: string } } }) => {
        const needle = where.webhookUrl?.endsWith;
        if (!needle) return null;
        return integrations.find((i) => String(i.webhookUrl).endsWith(needle)) ?? null;
      },
    },
  };

  const ingested: Row[] = [];
  const service = {
    ingestInbound: async (input: Row) => {
      ingested.push(input);
      return { id: "evt-1", status: "PROCESSED" };
    },
  };

  const controller = new IntegrationController(service as never, prisma as never);
  return { controller, ingested };
}

const req = { headers: {} } as unknown as Request;

describe("webhook entrante: el token identifica una sola integración", () => {
  it("un token que es subcadena de la URL ya no hace match con nadie", async () => {
    const { controller, ingested } = makeController();

    // "api" aparece en "api.example.com" y en "/api/v1/": con `contains`
    // esto devolvía la integración de una empresa cualquiera.
    await expect(controller.webhook("api", {}, req)).rejects.toBeInstanceOf(BadRequestException);
    expect(ingested).toHaveLength(0);
  });

  it("un prefijo del token real tampoco hace match (no hay oráculo)", async () => {
    const { controller, ingested } = makeController();

    await expect(controller.webhook(TOKEN_ACME.slice(0, 8), {}, req)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(ingested).toHaveLength(0);
  });

  it("el token exacto entrega el evento a SU empresa", async () => {
    const { controller, ingested } = makeController();

    await controller.webhook(TOKEN_GLOBEX, { eventName: "order.paid" }, req);

    expect(ingested).toHaveLength(1);
    expect(ingested[0].tenantId).toBe("t-globex");
    expect(ingested[0].integrationId).toBe("int-globex");
  });

  it("el token de una empresa no entrega eventos a la otra", async () => {
    const { controller, ingested } = makeController();

    await controller.webhook(TOKEN_ACME, { eventName: "order.paid" }, req);

    expect(ingested[0].tenantId).toBe("t-acme");
  });
});
