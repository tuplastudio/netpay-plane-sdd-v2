import { afterEach, describe, expect, it, vi } from "vitest";
import argon2 from "argon2";
import { Tenant } from "@prisma/client";
import {
  EvolutionOnboardingService,
  publicApiBaseUrl,
} from "../src/whatsapp/evolution-onboarding.service.js";
import { WhatsAppService } from "../src/whatsapp/whatsapp.service.js";

/**
 * Alta de WhatsApp con Evolution desde el portal (T-WHA-03):
 *
 *  1. `provision` crea la instancia y registra el webhook con `?secret=`.
 *  2. La fila `WhatsAppConnection` queda PENDING con el hash del secreto,
 *     así que el primer `connection.update` ya se autentica.
 *  3. `open` activa la conexión sola; `close` con logout la marca ERROR.
 *
 * Evolution y Prisma son fakes; no hay red ni base de datos.
 */

const ENV_KEYS = ["API_PUBLIC_URL", "PUBLIC_BASE_URL", "WEB_PORT", "EVOLUTION_BASE_URL", "EVOLUTION_API_KEY_REF"];

afterEach(() => {
  vi.unstubAllGlobals();
  for (const k of ENV_KEYS) delete process.env[k];
});

const TENANT = { id: "t1", slug: "demo-store" } as Tenant;

interface EvoCall {
  method: string;
  url: string;
  body?: Record<string, unknown>;
}

/** Evolution v2 mínimo: create → QR, webhook/set → echo, connectionState → lo que se pida. */
function stubEvolution(state = "connecting") {
  const calls: EvoCall[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const method = init.method ?? "GET";
      const body = init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
      calls.push({ method, url, body });
      const json = (data: unknown, status = 200) =>
        new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
      if (url.endsWith("/instance/create")) {
        return json({ instance: { instanceName: (body as { instanceName: string }).instanceName }, hash: "H", qrcode: { base64: "data:image/png;base64,QR" } }, 201);
      }
      if (url.includes("/webhook/set/")) {
        return json({ webhook: { ...(body as { webhook: object }).webhook } }, 201);
      }
      if (url.includes("/instance/connectionState/")) {
        return json({ instance: { instanceName: "x", state, ownerJid: "5215512345678@s.whatsapp.net" } });
      }
      if (method === "DELETE") return json({ status: "SUCCESS" });
      return json({}, 404);
    }),
  );
  return calls;
}

function fakePrisma() {
  const rows = new Map<string, Record<string, unknown>>();
  const key = (tenantId: string, provider: string) => `${tenantId}:${provider}`;
  const prisma = {
    rows,
    tenant: {
      findUnique: async () => TENANT,
    },
    whatsAppConnection: {
      findFirst: async ({ where }: { where: { tenantId: string; provider: string } }) =>
        rows.get(key(where.tenantId, where.provider)) ?? null,
      findUnique: async ({ where }: { where: { tenantId_provider?: { tenantId: string; provider: string }; id?: string } }) => {
        if (where.tenantId_provider) return rows.get(key(where.tenantId_provider.tenantId, where.tenantId_provider.provider)) ?? null;
        return [...rows.values()].find((r) => r.id === where.id) ?? null;
      },
      upsert: async ({ where, create, update }: { where: { tenantId_provider: { tenantId: string; provider: string } }; create: Record<string, unknown>; update: Record<string, unknown> }) => {
        const k = key(where.tenantId_provider.tenantId, where.tenantId_provider.provider);
        const existing = rows.get(k);
        const { version: _v, ...rest } = update;
        const row = existing
          ? { ...existing, ...rest, version: Number(existing.version ?? 1) + 1 }
          : { id: `conn-${rows.size + 1}`, version: 1, ...create };
        rows.set(k, row);
        return row;
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = [...rows.values()].find((r) => r.id === where.id)!;
        const { version: _v, ...rest } = data;
        Object.assign(row, rest, { version: Number(row.version ?? 1) + 1 });
        return row;
      },
    },
  };
  return prisma;
}

function makeServices(prisma = fakePrisma()) {
  const onboarding = new EvolutionOnboardingService(prisma as never);
  const wa = new WhatsAppService(prisma as never, {} as never, onboarding, {} as never);
  return { prisma, onboarding, wa };
}

describe("publicApiBaseUrl / buildInboundWebhookUrl", () => {
  it("prefiere el dominio público del API sobre el del frontend", () => {
    process.env.PUBLIC_BASE_URL = "https://easysell.web.tupla.dev/";
    expect(publicApiBaseUrl()).toBe("https://easysell.web.tupla.dev");
    process.env.API_PUBLIC_URL = "https://api-easysell.tupla.dev/";
    expect(publicApiBaseUrl()).toBe("https://api-easysell.tupla.dev");
  });

  it("arma la ruta del controller y mete el secreto en la query", () => {
    process.env.API_PUBLIC_URL = "https://api-easysell.tupla.dev";
    const { onboarding } = makeServices();
    expect(onboarding.buildInboundWebhookUrl("demo-store")).toBe(
      "https://api-easysell.tupla.dev/api/v1/whatsapp/webhook/inbound/demo-store",
    );
    expect(onboarding.buildInboundWebhookUrl("demo-store", "s3c/r+t")).toBe(
      "https://api-easysell.tupla.dev/api/v1/whatsapp/webhook/inbound/demo-store?secret=s3c%2Fr%2Bt",
    );
  });
});

describe("provisionEvolution", () => {
  it("crea la instancia, registra el webhook con secreto y deja la conexión PENDING autenticable", async () => {
    process.env.API_PUBLIC_URL = "https://api-easysell.tupla.dev";
    process.env.EVOLUTION_BASE_URL = "https://evo.example/";
    process.env.EVOLUTION_API_KEY_REF = "evo-key";
    const calls = stubEvolution();
    const { prisma, wa } = makeServices();

    const result = await wa.provisionEvolution("t1", "+5215512345678");

    expect(result.instanceName).toMatch(/^easysell_demo-store_[a-z0-9]{6}$/);
    expect(result.qrCodeBase64).toBe("data:image/png;base64,QR");

    const create = calls.find((c) => c.url.endsWith("/instance/create"))!;
    expect(create.body).toMatchObject({ integration: "WHATSAPP-BAILEYS", qrcode: true });

    const webhook = calls.find((c) => c.url.includes("/webhook/set/"))!;
    expect(webhook.url).toBe(`https://evo.example/webhook/set/${result.instanceName}`);
    const registered = (webhook.body as { webhook: { url: string; events: string[]; enabled: boolean } }).webhook;
    expect(registered.enabled).toBe(true);
    expect(registered.events).toEqual(["MESSAGES_UPSERT", "CONNECTION_UPDATE"]);
    expect(registered.url).toMatch(
      /^https:\/\/api-easysell\.tupla\.dev\/api\/v1\/whatsapp\/webhook\/inbound\/demo-store\?secret=[A-Za-z0-9_-]{20,}$/,
    );

    const row = prisma.rows.get("t1:EVOLUTION")!;
    expect(row.status).toBe("PENDING");
    expect(row.webhookUrl).toBe(registered.url);
    expect(row.credentials).toEqual({ baseUrl: "https://evo.example", apiKey: "evo-key", instance: result.instanceName });
    const secret = new URL(registered.url).searchParams.get("secret")!;
    expect(await argon2.verify(String(row.webhookSecretHash), secret)).toBe(true);
    expect(result.webhookUrl).not.toMatch(/ngrok/);
  });

  it("borra la instancia si el webhook no se puede registrar", async () => {
    process.env.EVOLUTION_BASE_URL = "https://evo.example";
    process.env.EVOLUTION_API_KEY_REF = "evo-key";
    const calls = stubEvolution();
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    const original = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (String(url).includes("/webhook/set/")) return new Response("{\"message\":\"nope\"}", { status: 500 });
      return original(url, init);
    });
    const { prisma, wa } = makeServices();
    await expect(wa.provisionEvolution("t1")).rejects.toMatchObject({ status: 500 });
    expect(calls.some((c) => c.method === "DELETE" && c.url.includes("/instance/delete/"))).toBe(true);
    expect(prisma.rows.size).toBe(0);
  });
});

describe("applyEvolutionConnectionUpdate", () => {
  it("open activa la fila PENDING de esa instancia y toma el número del wuid", async () => {
    process.env.EVOLUTION_BASE_URL = "https://evo.example";
    process.env.EVOLUTION_API_KEY_REF = "evo-key";
    stubEvolution();
    const { prisma, wa } = makeServices();
    const { instanceName } = await wa.provisionEvolution("t1");

    const other = await wa.applyEvolutionConnectionUpdate("t1", { instance: "otra_instancia", state: "open" });
    expect(other).toBeNull();
    expect(prisma.rows.get("t1:EVOLUTION")!.status).toBe("PENDING");

    const result = await wa.applyEvolutionConnectionUpdate("t1", {
      instance: instanceName,
      state: "open",
      ownerJid: "5215512345678@s.whatsapp.net",
    });
    expect(result).toEqual({ status: "ACTIVE" });
    const row = prisma.rows.get("t1:EVOLUTION")!;
    expect(row.status).toBe("ACTIVE");
    expect(row.phoneNumber).toBe("+5215512345678");
    expect(row.connectedAt).toBeInstanceOf(Date);
  });

  it("logout (close + 401) deja la conexión en ERROR con motivo visible", async () => {
    process.env.EVOLUTION_BASE_URL = "https://evo.example";
    process.env.EVOLUTION_API_KEY_REF = "evo-key";
    stubEvolution();
    const { prisma, wa } = makeServices();
    const { instanceName } = await wa.provisionEvolution("t1");
    await wa.applyEvolutionConnectionUpdate("t1", { instance: instanceName, state: "open" });
    const result = await wa.applyEvolutionConnectionUpdate("t1", { instance: instanceName, state: "close", statusReason: 401 });
    expect(result).toEqual({ status: "ERROR" });
    expect(prisma.rows.get("t1:EVOLUTION")!.lastError).toMatch(/escanear/i);
  });
});

describe("finalizeEvolutionConnection", () => {
  it("es idempotente con la activación automática y conserva el secreto ya registrado", async () => {
    process.env.EVOLUTION_BASE_URL = "https://evo.example";
    process.env.EVOLUTION_API_KEY_REF = "evo-key";
    const calls = stubEvolution("open");
    const { prisma, wa } = makeServices();
    const { instanceName } = await wa.provisionEvolution("t1");
    const before = prisma.rows.get("t1:EVOLUTION")!;
    const hashBefore = before.webhookSecretHash;
    const webhookSetsBefore = calls.filter((c) => c.url.includes("/webhook/set/")).length;

    const result = await wa.finalizeEvolutionConnection("t1", instanceName);
    expect(result.status).toBe("ACTIVE");
    expect(result.phoneNumber).toBe("+5215512345678");
    expect(result).not.toHaveProperty("webhookSecretHash");
    expect(prisma.rows.get("t1:EVOLUTION")!.webhookSecretHash).toBe(hashBefore);
    // No se vuelve a tocar Evolution: el webhook ya quedó registrado en el alta.
    expect(calls.filter((c) => c.url.includes("/webhook/set/")).length).toBe(webhookSetsBefore);
  });

  it("sin fila previa (alta hecha fuera del portal) crea secreto y registra el webhook", async () => {
    process.env.EVOLUTION_BASE_URL = "https://evo.example";
    process.env.EVOLUTION_API_KEY_REF = "evo-key";
    const calls = stubEvolution("open");
    const { prisma, wa } = makeServices();
    const result = await wa.finalizeEvolutionConnection("t1", "easysell_manual");
    expect(result.status).toBe("ACTIVE");
    expect(result.webhookSecret).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    expect(calls.some((c) => c.url.endsWith("/webhook/set/easysell_manual"))).toBe(true);
    expect(prisma.rows.get("t1:EVOLUTION")!.webhookUrl).toContain(`?secret=${encodeURIComponent(result.webhookSecret!)}`);
  });

  it("rechaza finalizar mientras la instancia no está open", async () => {
    process.env.EVOLUTION_BASE_URL = "https://evo.example";
    process.env.EVOLUTION_API_KEY_REF = "evo-key";
    stubEvolution("connecting");
    const { wa } = makeServices();
    await expect(wa.finalizeEvolutionConnection("t1", "x")).rejects.toMatchObject({
      response: { code: "INSTANCE_NOT_CONNECTED" },
    });
  });
});

describe("connect (credenciales manuales)", () => {
  it("con baseUrl/apiKey/instance registra el webhook en Evolution con un secreto nuevo", async () => {
    process.env.API_PUBLIC_URL = "https://api-easysell.tupla.dev";
    const calls = stubEvolution();
    const { prisma, wa } = makeServices();
    const result = await wa.connect("t1", {
      provider: "EVOLUTION",
      phoneNumber: "+521",
      credentials: { baseUrl: "https://evo.example/", apiKey: "k", instance: "mi_instancia" },
    });
    expect(result.status).toBe("ACTIVE");
    expect(result.webhookSecret).toBeTruthy();
    const set = calls.find((c) => c.url.endsWith("/webhook/set/mi_instancia"))!;
    expect((set.body as { webhook: { url: string } }).webhook.url).toBe(
      `https://api-easysell.tupla.dev/api/v1/whatsapp/webhook/inbound/demo-store?secret=${encodeURIComponent(result.webhookSecret!)}`,
    );
    expect(prisma.rows.get("t1:EVOLUTION")!.lastError).toBeNull();
  });
});
