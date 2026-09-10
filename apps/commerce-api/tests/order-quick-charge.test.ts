import { beforeEach, describe, expect, it } from "vitest";
import { OrderService, parseAmountTotal } from "../src/orders/order.service.js";
import type { PrismaService } from "../src/prisma/prisma.service.js";
import type { PricingService } from "../src/pricing/pricing.service.js";
import type { CustomerService } from "../src/customers/customer.service.js";
import type { QuoteService } from "../src/quotes/quote.service.js";
import type { NotificationService } from "../src/notifications/notification.service.js";

/**
 * Idempotencia del cobro rápido (T-QTE-07).
 *
 * El doble cobro no lo cierra ni el `ConfirmDialog` ni el botón deshabilitado:
 * lo cierra la clave de idempotencia más el índice único que la respalda. Estas
 * pruebas fijan las dos mitades del contrato — replay devuelve el original y no
 * crea un segundo pedido; clave distinta sí crea otro — y que un importe
 * malformado rebote como error de validación en vez de coercionarse a NaN.
 *
 * El Prisma real se sustituye por una base en memoria que sí aplica el índice
 * único de `Order.idempotencyKey` (levanta P2002 igual que Postgres), porque es
 * exactamente ese índice, y no la lectura previa, lo que da la garantía.
 */

const TENANT = "11111111-1111-1111-1111-111111111111";
const OTHER_TENANT = "22222222-2222-2222-2222-222222222222";

interface FakeOrder {
  id: string;
  tenantId: string;
  idempotencyKey: string | null;
  currentRevisionId: string | null;
  [key: string]: unknown;
}

interface FakeRevision {
  id: string;
  orderId: string;
  [key: string]: unknown;
}

class UniqueViolation extends Error {
  readonly code = "P2002";
  constructor(target: string) {
    super(`Unique constraint failed on the fields: (\`${target}\`)`);
  }
}

/** Prisma en memoria con el índice único de `Order.idempotencyKey` aplicado. */
class FakePrisma {
  orders: FakeOrder[] = [];
  revisions: FakeRevision[] = [];
  createdOrders = 0;
  walkInUpserts = 0;
  private seq = 0;

  private nextId(prefix: string): string {
    this.seq += 1;
    return `${prefix}-${this.seq}`;
  }

  private withRevisions(order: FakeOrder): FakeOrder {
    return { ...order, revisions: this.revisions.filter((r) => r.orderId === order.id) };
  }

  tenant = {
    findUnique: async ({ where }: { where: { id: string } }) => {
      if (where.id !== TENANT && where.id !== OTHER_TENANT) return null;
      return { id: where.id, configVersion: 3, taxRatePct: "16.00", checkoutReservationMinutes: 15 };
    },
  };

  customer = {
    upsert: async () => {
      this.walkInUpserts += 1;
      return { id: "customer-walkin" };
    },
    findUnique: async () => ({ id: "customer-walkin" }),
  };

  order = {
    findUnique: async ({ where }: { where: { id?: string; idempotencyKey?: string } }) => {
      const found = this.orders.find((o) =>
        where.idempotencyKey !== undefined
          ? o.idempotencyKey === where.idempotencyKey
          : o.id === where.id,
      );
      return found ? this.withRevisions(found) : null;
    },

    create: async ({ data }: { data: Record<string, unknown> }) => {
      const idempotencyKey = (data.idempotencyKey as string | undefined) ?? null;
      // El índice único es global (no compuesto con tenantId), igual que en el
      // schema: una clave repetida revienta aunque venga de otro tenant.
      if (idempotencyKey !== null && this.orders.some((o) => o.idempotencyKey === idempotencyKey)) {
        throw new UniqueViolation("idempotencyKey");
      }
      const { revisions, ...scalars } = data as Record<string, unknown> & {
        revisions?: { create: Record<string, unknown> };
      };
      const order: FakeOrder = {
        ...scalars,
        id: this.nextId("order"),
        tenantId: data.tenantId as string,
        idempotencyKey,
        currentRevisionId: null,
      };
      this.orders.push(order);
      this.createdOrders += 1;
      if (revisions?.create) {
        this.revisions.push({ ...revisions.create, id: this.nextId("rev"), orderId: order.id });
      }
      return this.withRevisions(order);
    },

    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const order = this.orders.find((o) => o.id === where.id);
      if (!order) throw new Error(`order ${where.id} not found`);
      Object.assign(order, data);
      return this.withRevisions(order);
    },
  };

  // Sin rollback real: en quickCharge el único escritor que puede fallar es el
  // create, y falla antes de insertar nada.
  $transaction = async <T>(fn: (tx: FakePrisma) => Promise<T>): Promise<T> => fn(this);
}

function makeService(prisma: FakePrisma): OrderService {
  const customers = { assertAccess: async () => undefined } as unknown as CustomerService;
  return new OrderService(
    prisma as unknown as PrismaService,
    {} as unknown as PricingService,
    customers,
    {} as unknown as QuoteService,
    {} as unknown as NotificationService,
  );
}

const charge = (extra: Partial<{ amountTotal: string; idempotencyKey: string }> = {}) => ({
  description: "Servicio de instalación",
  amountTotal: "116.00",
  ...extra,
});

describe("quickCharge — idempotencia", () => {
  let prisma: FakePrisma;
  let orders: OrderService;

  beforeEach(() => {
    prisma = new FakePrisma();
    orders = makeService(prisma);
  });

  it("la misma clave dos veces devuelve el mismo pedido y solo crea uno", async () => {
    const first = await orders.quickCharge(TENANT, charge({ idempotencyKey: "key-aaa-111" }));
    const second = await orders.quickCharge(TENANT, charge({ idempotencyKey: "key-aaa-111" }));

    expect(second.id).toBe(first.id);
    expect(prisma.createdOrders).toBe(1);
    expect(prisma.orders).toHaveLength(1);
    // El replay devuelve el pedido completo, no un esqueleto.
    expect(second.total).toBe("116.00");
    expect(second.currentRevisionId).toBe(first.currentRevisionId);
    expect(second.currentRevisionId).not.toBeNull();
  });

  it("una clave distinta crea un segundo pedido", async () => {
    const first = await orders.quickCharge(TENANT, charge({ idempotencyKey: "key-aaa-111" }));
    const second = await orders.quickCharge(TENANT, charge({ idempotencyKey: "key-bbb-222" }));

    expect(second.id).not.toBe(first.id);
    expect(prisma.createdOrders).toBe(2);
  });

  it("sin clave no hay deduplicación: dos cobros idénticos son dos cobros", async () => {
    const first = await orders.quickCharge(TENANT, charge());
    const second = await orders.quickCharge(TENANT, charge());

    expect(second.id).not.toBe(first.id);
    expect(prisma.createdOrders).toBe(2);
  });

  it("dos peticiones simultáneas con la misma clave crean un solo pedido", async () => {
    const [a, b] = await Promise.all([
      orders.quickCharge(TENANT, charge({ idempotencyKey: "key-race-1" })),
      orders.quickCharge(TENANT, charge({ idempotencyKey: "key-race-1" })),
    ]);

    // Las dos pasan la lectura previa en vacío; el índice único deja pasar un
    // solo insert y la perdedora relee al ganador en vez de reventar con P2002.
    expect(a.id).toBe(b.id);
    expect(prisma.createdOrders).toBe(1);
    expect(prisma.orders).toHaveLength(1);
  });

  it("una clave ya usada por otro tenant contesta 409, no un error crudo ni un pedido ajeno", async () => {
    await orders.quickCharge(OTHER_TENANT, charge({ idempotencyKey: "key-shared-1" }));
    expect(prisma.createdOrders).toBe(1);

    await expect(
      orders.quickCharge(TENANT, charge({ idempotencyKey: "key-shared-1" })),
    ).rejects.toMatchObject({ status: 409 });
    expect(prisma.createdOrders).toBe(1);
  });

  it("el reintento no reabre el cliente mostrador ni recalcula el importe", async () => {
    await orders.quickCharge(TENANT, charge({ idempotencyKey: "key-aaa-111" }));
    await orders.quickCharge(TENANT, charge({ idempotencyKey: "key-aaa-111" }));
    expect(prisma.walkInUpserts).toBe(1);
  });
});

describe("quickCharge — validación de amountTotal", () => {
  let prisma: FakePrisma;
  let orders: OrderService;

  beforeEach(() => {
    prisma = new FakePrisma();
    orders = makeService(prisma);
  });

  it("rechaza '1,234.50' con un error de validación en vez de convertirlo en NaN", async () => {
    await expect(
      orders.quickCharge(TENANT, charge({ amountTotal: "1,234.50", idempotencyKey: "key-bad-1" })),
    ).rejects.toMatchObject({
      status: 400,
      response: { code: "VALIDATION_FAILED" },
    });
    // Ni pedido ni cliente mostrador: el importe rebota antes de tocar nada.
    expect(prisma.createdOrders).toBe(0);
    expect(prisma.walkInUpserts).toBe(0);
  });

  it("el mensaje del rechazo llega en español y explica el formato", async () => {
    await expect(
      orders.quickCharge(TENANT, charge({ amountTotal: "1,234.50" })),
    ).rejects.toThrow(/decimal positivo con punto/);
  });

  for (const bad of ["1,234.50", "abc", "", " ", "1e3", "0x10", "-5", "0", "0.001", " 116 ", "116px", "NaN", "Infinity"]) {
    it(`rechaza ${JSON.stringify(bad)}`, () => {
      expect(() => parseAmountTotal(bad)).toThrowError();
    });
  }

  it("rechaza un importe por encima del tope de Decimal(12,2)", () => {
    expect(() => parseAmountTotal("99999999999")).toThrowError();
  });

  for (const good of ["116", "116.0", "116.00", "0.01", "1234.50", "9999999999.99"]) {
    it(`acepta ${JSON.stringify(good)}`, () => {
      expect(parseAmountTotal(good)).toBe(Number(good));
    });
  }

  it("un importe válido sigue calculando el IVA hacia atrás sin cambiar la precisión", async () => {
    const order = await orders.quickCharge(TENANT, charge({ amountTotal: "116.00" }));
    expect(order.total).toBe("116.00");
    expect(order.subtotal).toBe("100.00");
    expect(order.taxBase).toBe("100.00");
    expect(order.tax).toBe("16.00");
  });
});
