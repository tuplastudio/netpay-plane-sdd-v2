import { describe, expect, it, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";
import { PaymentService } from "../src/payments/payment.service.js";
import { decideRefund, parseMoney, remainingRefundable } from "../src/payments/refund-math.js";

/**
 * Reembolsos parciales (T-PAY-04).
 *
 * Dos capas de prueba, a propósito:
 *
 *  1. `refund-math.ts` — la regla como función pura. Es donde se fija la
 *     máquina de estados y la exactitud decimal.
 *  2. `PaymentService#refund` — la orquestación: qué se escribe en el ledger,
 *     cuándo cambia el pedido, qué error sale por cada rechazo. La sesión vive
 *     en un doble de Prisma que ejecuta el MISMO UPDATE condicional que hace
 *     Postgres (estado permitido + acumulado <= importe, atómico), así que si
 *     alguien quita la guarda del WHERE la prueba se cae.
 */

const D = (v: string) => new Prisma.Decimal(v);

// ---------------------------------------------------------------------------
// 1 · la regla, pura
// ---------------------------------------------------------------------------

describe("parseMoney", () => {
  it("acepta importes con la forma de Decimal(12,2)", () => {
    expect(parseMoney("100")?.toFixed(2)).toBe("100.00");
    expect(parseMoney("100.5")?.toFixed(2)).toBe("100.50");
    expect(parseMoney(" 0.01 ")?.toFixed(2)).toBe("0.01");
  });

  it("rechaza lo que Postgres redondearía o no entendería", () => {
    // Más de 2 decimales: se perdería el tercero en silencio al escribir.
    expect(parseMoney("1.005")).toBeNull();
    expect(parseMoney("-5.00")).toBeNull();
    expect(parseMoney("1e3")).toBeNull();
    expect(parseMoney("abc")).toBeNull();
    expect(parseMoney("")).toBeNull();
    expect(parseMoney(null)).toBeNull();
    expect(parseMoney(undefined)).toBeNull();
    expect(parseMoney(Number.NaN)).toBeNull();
  });
});

describe("decideRefund — máquina de estados", () => {
  const base = { status: "CAPTURED", amount: D("100.00"), refundedTotal: D("0.00") };

  it("un reembolso parcial deja la sesión en PARTIALLY_REFUNDED", () => {
    const r = decideRefund({ ...base, refund: D("30.00") });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.status).toBe("PARTIALLY_REFUNDED");
    expect(r.refundedTotal.toFixed(2)).toBe("30.00");
    expect(r.netTotal.toFixed(2)).toBe("70.00");
    expect(r.fullyRefunded).toBe(false);
  });

  it("el reembolso que completa el importe escribe REFUNDED", () => {
    const r = decideRefund({
      ...base,
      status: "PARTIALLY_REFUNDED",
      refundedTotal: D("30.00"),
      refund: D("70.00"),
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.status).toBe("REFUNDED");
    expect(r.refundedTotal.toFixed(2)).toBe("100.00");
    expect(r.netTotal.toFixed(2)).toBe("0.00");
  });

  it("un reembolso de una vez por el importe completo también es REFUNDED", () => {
    const r = decideRefund({ ...base, refund: D("100.00") });
    expect(r.ok && r.status).toBe("REFUNDED");
  });

  it("rechaza pasarse del importe, aunque sea por un centavo", () => {
    expect(decideRefund({ ...base, refund: D("100.01") })).toEqual({
      ok: false,
      reason: "EXCEEDS_AMOUNT",
    });
    expect(
      decideRefund({ ...base, refundedTotal: D("99.99"), refund: D("0.02") }),
    ).toEqual({ ok: false, reason: "EXCEEDS_AMOUNT" });
  });

  it("rechaza importes no positivos", () => {
    expect(decideRefund({ ...base, refund: D("0") })).toEqual({
      ok: false,
      reason: "NOT_POSITIVE",
    });
    expect(decideRefund({ ...base, refund: D("-10.00") })).toEqual({
      ok: false,
      reason: "NOT_POSITIVE",
    });
  });

  it("solo CAPTURED y PARTIALLY_REFUNDED admiten reembolso", () => {
    for (const status of ["PENDING", "AUTHORIZED", "FAILED", "REFUNDED", "CANCELLED"]) {
      expect(decideRefund({ ...base, status, refund: D("1.00") })).toEqual({
        ok: false,
        reason: "NOT_REFUNDABLE",
      });
    }
    expect(decideRefund({ ...base, status: "PARTIALLY_REFUNDED", refund: D("1.00") }).ok).toBe(
      true,
    );
  });

  it("suma exacta: 0.10 + 0.20 == 0.30, que en flotante no se cumple", () => {
    // Number(0.1) + Number(0.2) === 0.30000000000000004 > 0.3, así que la
    // versión en flotante rechazaría este segundo reembolso por "excederse".
    expect(0.1 + 0.2 > 0.3).toBe(true);

    const first = decideRefund({
      status: "CAPTURED",
      amount: D("0.30"),
      refundedTotal: D("0.00"),
      refund: D("0.10"),
    });
    expect(first.ok && first.status).toBe("PARTIALLY_REFUNDED");
    if (!first.ok) return;

    const second = decideRefund({
      status: "PARTIALLY_REFUNDED",
      amount: D("0.30"),
      refundedTotal: first.refundedTotal,
      refund: D("0.20"),
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.status).toBe("REFUNDED");
    expect(second.refundedTotal.toFixed(2)).toBe("0.30");
    expect(second.netTotal.toFixed(2)).toBe("0.00");
  });

  it("mismo caso a otra escala: 1234567.89 se reembolsa en dos tramos sin deriva", () => {
    const amount = D("1234567.89");
    const a = decideRefund({
      status: "CAPTURED",
      amount,
      refundedTotal: D("0.00"),
      refund: D("1111111.11"),
    });
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    const b = decideRefund({
      status: "PARTIALLY_REFUNDED",
      amount,
      refundedTotal: a.refundedTotal,
      refund: D("123456.78"),
    });
    expect(b.ok && b.status).toBe("REFUNDED");
    expect(b.ok && b.refundedTotal.toFixed(2)).toBe("1234567.89");
  });
});

describe("remainingRefundable", () => {
  it("es amount - refundedTotal y nunca baja de cero", () => {
    expect(remainingRefundable(D("100.00"), D("30.00")).toFixed(2)).toBe("70.00");
    expect(remainingRefundable(D("100.00"), D("100.00")).toFixed(2)).toBe("0.00");
    expect(remainingRefundable(D("100.00"), D("150.00")).toFixed(2)).toBe("0.00");
  });
});

// ---------------------------------------------------------------------------
// 2 · el servicio, contra un doble de Prisma
// ---------------------------------------------------------------------------

const TENANT = "11111111-1111-1111-1111-111111111111";
const SESSION = "22222222-2222-2222-2222-222222222222";
const ORDER = "33333333-3333-3333-3333-333333333333";

interface FakeSession {
  id: string;
  tenantId: string;
  orderId: string;
  amount: Prisma.Decimal;
  refundedTotal: Prisma.Decimal;
  status: string;
  version: number;
}

interface LedgerRow {
  entryType: string;
  amount: string;
  balanceAfter: string;
  description: string;
}

/**
 * Doble de Prisma para la ruta de reembolso.
 *
 * `$queryRaw` reproduce la semántica del UPDATE condicional real: aplica el
 * cambio SOLO si el estado admite reembolso y el acumulado no se pasa, y
 * devuelve 0 filas en caso contrario — exactamente lo que hace Postgres. La
 * aritmética se hace con `Decimal`, igual que `numeric` en la base.
 *
 * Además comprueba que el SQL que le llega sigue llevando la guarda en el
 * WHERE: si alguien la mueve a un `if` en JS (y reabre la condición de
 * carrera), estas pruebas fallan.
 */
function makeFakePrisma(session: FakeSession) {
  const ledger: LedgerRow[] = [];
  const orderUpdates: Array<{ where: unknown; data: unknown }> = [];
  let lastSql = "";

  const tx = {
    $queryRaw(sql: Prisma.Sql) {
      lastSql = sql.strings.join("?");
      // Orden de aparición de los parámetros en payment.service.ts#refund:
      //   [0] monto (SET), [1] monto (CASE), [2] sessionId, [3] tenantId,
      //   [4] monto (WHERE de la guarda).
      const [money, , sessionId, tenantId] = sql.values as string[];
      const refund = new Prisma.Decimal(money);

      if (session.id !== sessionId || session.tenantId !== tenantId) return Promise.resolve([]);
      const decision = decideRefund({
        status: session.status,
        amount: session.amount,
        refundedTotal: session.refundedTotal,
        refund,
      });
      if (!decision.ok) return Promise.resolve([]);

      session.refundedTotal = decision.refundedTotal;
      session.status = decision.status;
      session.version += 1;
      return Promise.resolve([
        {
          id: session.id,
          orderId: session.orderId,
          amount: session.amount,
          refundedTotal: session.refundedTotal,
          status: session.status,
        },
      ]);
    },
    checkoutSession: {
      findFirst: ({ where }: { where: { id: string; tenantId: string } }) =>
        Promise.resolve(
          where.id === session.id && where.tenantId === session.tenantId ? session : null,
        ),
    },
    ledgerEntry: {
      create: ({ data }: { data: LedgerRow }) => {
        ledger.push(data);
        return Promise.resolve(data);
      },
    },
    order: {
      updateMany: (args: { where: unknown; data: unknown }) => {
        orderUpdates.push(args);
        return Promise.resolve({ count: 1 });
      },
    },
  };

  const prisma = {
    $transaction: <T>(fn: (t: typeof tx) => Promise<T>) => fn(tx),
  };

  return {
    prisma,
    ledger,
    orderUpdates,
    session,
    sql: () => lastSql,
  };
}

function makeService(fake: ReturnType<typeof makeFakePrisma>) {
  // `NotificationService` no participa en la ruta de reembolso.
  return new PaymentService(
    fake.prisma as never,
    { scheduleFromTemplate: async () => undefined } as never,
  );
}

function newSession(amount: string, over: Partial<FakeSession> = {}): FakeSession {
  return {
    id: SESSION,
    tenantId: TENANT,
    orderId: ORDER,
    amount: D(amount),
    refundedTotal: D("0.00"),
    status: "CAPTURED",
    version: 1,
    ...over,
  };
}

describe("PaymentService#refund", () => {
  let fake: ReturnType<typeof makeFakePrisma>;
  let service: PaymentService;

  beforeEach(() => {
    fake = makeFakePrisma(newSession("100.00"));
    service = makeService(fake);
  });

  it("un reembolso parcial escribe PARTIALLY_REFUNDED y el acumulado correcto", async () => {
    const res = await service.refund(TENANT, SESSION, "30.00", "Cliente devolvió un artículo");

    expect(res).toMatchObject({
      ok: true,
      status: "PARTIALLY_REFUNDED",
      amount: "100.00",
      refundedTotal: "30.00",
      netTotal: "70.00",
    });
    expect(fake.session.status).toBe("PARTIALLY_REFUNDED");
    expect(fake.session.refundedTotal.toFixed(2)).toBe("30.00");
    // El bruto cobrado sigue siendo recuperable: `amount` no se toca.
    expect(fake.session.amount.toFixed(2)).toBe("100.00");
  });

  it("el asiento del ledger lleva el saldo vivo, no un 0.00 fijo", async () => {
    await service.refund(TENANT, SESSION, "30.00", "Devolución parcial");
    expect(fake.ledger).toEqual([
      {
        tenantId: TENANT,
        sessionId: SESSION,
        entryType: "REFUND",
        amount: "30.00",
        balanceAfter: "70.00",
        description: "Devolución parcial",
      },
    ]);
  });

  it("un reembolso parcial NO marca el pedido como REFUNDED", async () => {
    await service.refund(TENANT, SESSION, "30.00", "Parcial");
    expect(fake.orderUpdates).toHaveLength(0);
  });

  it("un segundo parcial que completa el importe pasa a REFUNDED y cierra el pedido", async () => {
    await service.refund(TENANT, SESSION, "30.00", "Primer tramo");
    const res = await service.refund(TENANT, SESSION, "70.00", "Segundo tramo");

    expect(res).toMatchObject({
      status: "REFUNDED",
      refundedTotal: "100.00",
      netTotal: "0.00",
    });
    expect(fake.session.status).toBe("REFUNDED");
    expect(fake.ledger.map((l) => l.amount)).toEqual(["30.00", "70.00"]);
    expect(fake.ledger.map((l) => l.balanceAfter)).toEqual(["70.00", "0.00"]);
    expect(fake.orderUpdates).toEqual([
      {
        where: { id: ORDER, tenantId: TENANT, status: "PAID" },
        data: { status: "REFUNDED", version: { increment: 1 } },
      },
    ]);
  });

  it("una sesión PARTIALLY_REFUNDED sí admite otro reembolso (antes se rechazaba)", async () => {
    fake = makeFakePrisma(
      newSession("100.00", { status: "PARTIALLY_REFUNDED", refundedTotal: D("40.00") }),
    );
    service = makeService(fake);

    const res = await service.refund(TENANT, SESSION, "10.00", "Otro tramo");
    expect(res).toMatchObject({ status: "PARTIALLY_REFUNDED", refundedTotal: "50.00" });
  });

  it("rechaza el reembolso que se pasaría del importe y no escribe nada", async () => {
    await service.refund(TENANT, SESSION, "60.00", "Primero");
    await expect(service.refund(TENANT, SESSION, "60.00", "Segundo")).rejects.toThrow(
      /excede lo cobrado/i,
    );
    expect(fake.session.refundedTotal.toFixed(2)).toBe("60.00");
    expect(fake.session.status).toBe("PARTIALLY_REFUNDED");
    expect(fake.ledger).toHaveLength(1);
  });

  it("rechaza importes no positivos antes de tocar la base", async () => {
    for (const bad of ["0", "0.00", "-1.00", "", "abc", "1.005"]) {
      await expect(service.refund(TENANT, SESSION, bad, "x")).rejects.toThrow(
        /importe positivo/i,
      );
    }
    expect(fake.ledger).toHaveLength(0);
    expect(fake.session.status).toBe("CAPTURED");
  });

  it("una sesión ya REFUNDED no admite más reembolsos", async () => {
    await service.refund(TENANT, SESSION, "100.00", "Total");
    await expect(service.refund(TENANT, SESSION, "1.00", "De nuevo")).rejects.toThrow(
      /no permite reembolso/i,
    );
  });

  it("una sesión PENDING no admite reembolso", async () => {
    fake = makeFakePrisma(newSession("100.00", { status: "PENDING" }));
    service = makeService(fake);
    await expect(service.refund(TENANT, SESSION, "1.00", "x")).rejects.toThrow(
      /no permite reembolso/i,
    );
  });

  it("una sesión de otro tenant es NOT_FOUND, no RULE_VIOLATION", async () => {
    await expect(
      service.refund("99999999-9999-9999-9999-999999999999", SESSION, "1.00", "x"),
    ).rejects.toThrow(/no accesible/i);
  });

  it("aritmética exacta: 0.10 + 0.20 salda una sesión de 0.30", async () => {
    fake = makeFakePrisma(newSession("0.30"));
    service = makeService(fake);

    const first = await service.refund(TENANT, SESSION, "0.10", "a");
    expect(first).toMatchObject({ status: "PARTIALLY_REFUNDED", refundedTotal: "0.10" });

    // En flotante 0.1 + 0.2 = 0.30000000000000004 y este segundo reembolso se
    // rechazaría por excederse. Con Decimal cierra exactamente en 0.30.
    const second = await service.refund(TENANT, SESSION, "0.20", "b");
    expect(second).toMatchObject({
      status: "REFUNDED",
      refundedTotal: "0.30",
      netTotal: "0.00",
    });
    expect(fake.ledger.map((l) => l.balanceAfter)).toEqual(["0.20", "0.00"]);
  });

  it("la guarda de concurrencia sigue en el WHERE del UPDATE", async () => {
    await service.refund(TENANT, SESSION, "10.00", "x");
    const sql = fake.sql().replace(/\s+/g, " ");
    // Un solo UPDATE: comprobación y escritura no se pueden intercalar.
    expect(sql).toMatch(/UPDATE "CheckoutSession"/i);
    // La condición "no me paso del importe" vive en el WHERE, no en JS.
    expect(sql).toMatch(/WHERE[\s\S]*"refundedTotal" \+ \?::decimal\(12,2\) <= "amount"/i);
    // Y el estado admisible también se filtra en la base.
    expect(sql).toMatch(/'CAPTURED'::"PaymentStatus", 'PARTIALLY_REFUNDED'::"PaymentStatus"/);
  });
});
