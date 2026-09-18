import { describe, expect, it } from "vitest";
import { CustomerService } from "../src/customers/customer.service.js";

/**
 * `resolveChannelContact`: el agente lo llama al emitir una cotización desde
 * WhatsApp para dejar el cliente completo Y ligado a la conversación.
 *
 * Antes de esto el agente solo hacía `POST /customers`: quedaba un cliente
 * real, pero la conversación seguía "Cliente sin ficha" para siempre (nada
 * la vinculaba) y una ficha vieja con nombre placeholder nunca se corregía
 * aunque el cliente ya hubiera dado su nombre real después. Prisma es un
 * fake en memoria; no hay base de datos.
 */

const TENANT = "11111111-1111-1111-1111-111111111111";

interface FakeCustomer {
  id: string;
  tenantId: string;
  fullName: string;
  phone: string | null;
  email: string | null;
  version: number;
}

interface FakeIdentity {
  customerId: string;
  channel: "WHATSAPP_META" | "WHATSAPP_EVOLUTION";
  externalId: string;
}

function makeFakePrisma(opts: {
  customers?: FakeCustomer[];
  identities?: FakeIdentity[];
  conversation?: { id: string; tenantId: string; customerId: string | null; externalPhone: string; provider: "META" | "EVOLUTION" };
}) {
  const customers = opts.customers ?? [];
  const identities = opts.identities ?? [];
  let nextId = customers.length + 1;
  const conversationUpdates: Array<Record<string, unknown>> = [];

  const prisma = {
    customers,
    identities,
    conversationUpdates,
    customer: {
      findFirst: async ({ where }: { where: any }) => {
        if (where.identities?.some) {
          const { channel, externalId } = where.identities.some;
          const identity = identities.find((i) => i.channel === channel && i.externalId === externalId);
          return identity ? customers.find((c) => c.id === identity.customerId) ?? null : null;
        }
        if (where.OR) {
          for (const clause of where.OR as Array<{ phone?: string; email?: string }>) {
            const match = customers.find(
              (c) =>
                c.tenantId === where.tenantId &&
                ((clause.phone && c.phone === clause.phone) || (clause.email && c.email === clause.email)),
            );
            if (match) return match;
          }
          return null;
        }
        return null;
      },
      create: async ({ data }: { data: any }) => {
        const row: FakeCustomer = {
          id: `cust-${nextId++}`,
          tenantId: data.tenantId,
          fullName: data.fullName,
          phone: data.phone ?? null,
          email: data.email ?? null,
          version: 1,
        };
        customers.push(row);
        return row;
      },
      update: async ({ where, data }: { where: { id: string }; data: any }) => {
        const row = customers.find((c) => c.id === where.id)!;
        if (data.phone !== undefined) row.phone = data.phone;
        if (data.email !== undefined) row.email = data.email;
        if (data.fullName !== undefined) row.fullName = data.fullName;
        row.version += 1;
        return row;
      },
    },
    customerIdentity: {
      upsert: async ({ where, create }: { where: any; create: FakeIdentity }) => {
        const existing = identities.find(
          (i) => i.channel === where.channel_externalId.channel && i.externalId === where.channel_externalId.externalId,
        );
        if (existing) return existing;
        identities.push(create);
        return create;
      },
    },
    whatsAppConversation: {
      findFirst: async ({ where }: { where: { id: string; tenantId: string } }) => {
        const conv = opts.conversation;
        if (!conv || conv.id !== where.id || conv.tenantId !== where.tenantId) return null;
        return { ...conv, connection: { provider: conv.provider } };
      },
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        conversationUpdates.push({ where, data });
        if (opts.conversation && opts.conversation.id === where.id && opts.conversation.customerId === where.customerId) {
          opts.conversation.customerId = data.customerId as string;
          return { count: 1 };
        }
        return { count: 0 };
      },
    },
  };
  return prisma;
}

function makeService(prisma: ReturnType<typeof makeFakePrisma>) {
  return new CustomerService(prisma as never);
}

describe("resolveChannelContact", () => {
  it("crea el cliente, la identidad y liga la conversación cuando no existe nada", async () => {
    const conversation = {
      id: "conv-1",
      tenantId: TENANT,
      customerId: null,
      externalPhone: "+5216671234567",
      provider: "EVOLUTION" as const,
    };
    const prisma = makeFakePrisma({ conversation });
    const service = makeService(prisma);

    const customer = await service.resolveChannelContact(TENANT, {
      fullName: "Ana López",
      conversationId: "conv-1",
    });

    expect(customer.fullName).toBe("Ana López");
    expect(customer.phone).toBe("+5216671234567");
    expect(prisma.identities).toEqual([
      { customerId: customer.id, channel: "WHATSAPP_EVOLUTION", externalId: "+5216671234567", verifiedAt: expect.any(Date) },
    ]);
    expect(conversation.customerId).toBe(customer.id);
  });

  it("reutiliza al cliente ya identificado por el canal y no crea un duplicado", async () => {
    const conversation = {
      id: "conv-1",
      tenantId: TENANT,
      customerId: null,
      externalPhone: "+5216671234567",
      provider: "EVOLUTION" as const,
    };
    const prisma = makeFakePrisma({
      customers: [{ id: "cust-1", tenantId: TENANT, fullName: "Ana López", phone: "+5216671234567", email: null, version: 1 }],
      identities: [{ customerId: "cust-1", channel: "WHATSAPP_EVOLUTION", externalId: "+5216671234567" }],
      conversation,
    });
    const service = makeService(prisma);

    const customer = await service.resolveChannelContact(TENANT, {
      fullName: "Ana López",
      conversationId: "conv-1",
    });

    expect(customer.id).toBe("cust-1");
    expect(prisma.customers).toHaveLength(1);
    expect(conversation.customerId).toBe("cust-1");
  });

  it("corrige un nombre placeholder pero nunca pisa uno real ya cargado", async () => {
    const prisma = makeFakePrisma({
      customers: [
        { id: "cust-1", tenantId: TENANT, fullName: "Cliente de WhatsApp", phone: "+5216671234567", email: null, version: 1 },
        { id: "cust-2", tenantId: TENANT, fullName: "Roberto Díaz", phone: "+5216679999999", email: null, version: 3 },
      ],
    });
    const service = makeService(prisma);

    const renamed = await service.resolveChannelContact(TENANT, {
      fullName: "Ana López",
      phone: "+5216671234567",
    });
    expect(renamed.fullName).toBe("Ana López");
    expect(renamed.version).toBe(2);

    const untouched = await service.resolveChannelContact(TENANT, {
      fullName: "Otro Nombre Cualquiera",
      phone: "+5216679999999",
    });
    expect(untouched.fullName).toBe("Roberto Díaz");
    expect(untouched.version).toBe(3);
  });

  it("completa el correo que faltaba, sin tocar el teléfono ya registrado", async () => {
    const prisma = makeFakePrisma({
      customers: [{ id: "cust-1", tenantId: TENANT, fullName: "Ana López", phone: "+5216671234567", email: null, version: 1 }],
    });
    const service = makeService(prisma);

    const customer = await service.resolveChannelContact(TENANT, {
      fullName: "Ana López",
      phone: "+5216671234567",
      email: "ana@nueva.mx",
    });

    expect(customer.id).toBe("cust-1");
    expect(customer.phone).toBe("+5216671234567");
    expect(customer.email).toBe("ana@nueva.mx");
  });

  it("no reemplaza un correo que ya estaba guardado", async () => {
    const prisma = makeFakePrisma({
      customers: [{ id: "cust-1", tenantId: TENANT, fullName: "Ana López", phone: "+5216671234567", email: "ana@old.mx", version: 1 }],
    });
    const service = makeService(prisma);

    const customer = await service.resolveChannelContact(TENANT, {
      fullName: "Ana López",
      phone: "+5216671234567",
      email: "ana@new.mx",
    });

    expect(customer.email).toBe("ana@old.mx");
  });

  it("nunca pisa un vínculo manual ya hecho desde el panel", async () => {
    const conversation = {
      id: "conv-1",
      tenantId: TENANT,
      customerId: "cust-manual",
      externalPhone: "+5216671234567",
      provider: "EVOLUTION" as const,
    };
    const prisma = makeFakePrisma({
      customers: [
        { id: "cust-manual", tenantId: TENANT, fullName: "Cliente vinculado a mano", phone: null, email: null, version: 1 },
      ],
      conversation,
    });
    const service = makeService(prisma);

    await service.resolveChannelContact(TENANT, { fullName: "Ana López", conversationId: "conv-1" });

    // Se crea/ resuelve un cliente distinto para el contacto del chat, pero
    // la conversación se queda con el que el operador ya vinculó.
    expect(conversation.customerId).toBe("cust-manual");
  });

  it("sin conversationId ni identidad de canal, funciona por teléfono/correo exacto", async () => {
    const prisma = makeFakePrisma({});
    const service = makeService(prisma);
    const customer = await service.resolveChannelContact(TENANT, {
      fullName: "Cliente web",
      email: "cliente@web.mx",
    });
    expect(customer.fullName).toBe("Cliente web");
    expect(prisma.identities).toHaveLength(0);
  });
});
