import { describe, expect, it } from "vitest";
import {
  addMoney,
  applyDiscount,
  isMoney,
  isQuantity,
  qtyTimesPrice,
  roundHalfUp,
  subMoney,
} from "../src/money.js";
import { calculateQuoteTotals, DEFAULT_TAX_RATE_PCT } from "../src/pricing.js";

describe("money decimal arithmetic", () => {
  // Ver docs/05-prc.md AC-PRC-01: 0.10 + 0.20 conserva 0.30 (no float).
  it("0.10 + 0.20 = 0.30 sin pérdida por float", () => {
    expect(addMoney("0.10", "0.20")).toBe("0.30");
  });

  it("acepta sumas sin redondeo erróneo", () => {
    expect(addMoney("1.99", "0.01")).toBe("2.00");
    expect(addMoney("1234.56", "789.44")).toBe("2024.00");
  });

  it("resta y rechaza underflow", () => {
    expect(subMoney("10.00", "3.50")).toBe("6.50");
    expect(() => subMoney("1.00", "2.00")).toThrow();
  });

  it("qty × price preserva escala MXN", () => {
    expect(qtyTimesPrice("1.500", "199.99")).toBe("299.99"); // aprox redondeado
    expect(qtyTimesPrice("2.000", "100.00")).toBe("200.00");
    expect(qtyTimesPrice("0.500", "10.00")).toBe("5.00");
  });

  it("descuento 10% sobre 199.99 = 179.99", () => {
    expect(applyDiscount("199.99", 10)).toBe("179.99");
  });

  it("descuento 100% = 0", () => {
    expect(applyDiscount("100.00", 100)).toBe("0.00");
  });

  it("descuento 0% = mismo monto", () => {
    expect(applyDiscount("42.50", 0)).toBe("42.50");
  });

  it("descuento fuera de rango falla", () => {
    expect(() => applyDiscount("10.00", -1)).toThrow();
    expect(() => applyDiscount("10.00", 101)).toThrow();
  });

  it("redondeo half-up conserva la escala pedida", () => {
    // Antes devolvía un string de ~100 dígitos: le pasaba un factor donde
    // `toScaled` espera una escala.
    expect(roundHalfUp("1.005", 2)).toBe("1.01");
    expect(roundHalfUp("1.004", 2)).toBe("1.00");
    expect(roundHalfUp("12.345", 2)).toBe("12.35");
    expect(roundHalfUp("0.5", 0)).toBe("1");
    expect(roundHalfUp("0.4", 0)).toBe("0");
    expect(roundHalfUp("199.99", 2)).toBe("199.99");
    expect(() => roundHalfUp("1.00", -1)).toThrow();
  });

  it("validadores de formato", () => {
    expect(isMoney("10.00")).toBe(true);
    expect(isMoney("10")).toBe(false);
    expect(isMoney("10.0")).toBe(false);
    expect(isMoney("10.000")).toBe(false);
    expect(isQuantity("1.500")).toBe(true);
    expect(isQuantity("1.50")).toBe(false);
  });
});

describe("quote totals", () => {
  it("calcula totales con IVA 16%", () => {
    const totals = calculateQuoteTotals(
      [
        { variantId: "v1", quantity: "2.000", unitPrice: "100.00", discountPct: 0 },
        { variantId: "v2", quantity: "1.000", unitPrice: "50.00", discountPct: 10 },
      ],
      { taxRatePct: DEFAULT_TAX_RATE_PCT, shippingFlat: "0.00" },
    );
    expect(totals.subtotal).toBe("250.00"); // 200 + 50
    expect(totals.discount).toBe("5.00"); // 10% de 50
    expect(totals.taxBase).toBe("245.00");
    expect(totals.tax).toBe("39.20"); // 16% de 245
    expect(totals.shipping).toBe("0.00");
    expect(totals.total).toBe("284.20");
  });

  it("aplica shipping flat", () => {
    const totals = calculateQuoteTotals(
      [{ variantId: "v1", quantity: "1.000", unitPrice: "100.00", discountPct: 0 }],
      { taxRatePct: 0, shippingFlat: "25.00" },
    );
    expect(totals.shipping).toBe("25.00");
    expect(totals.total).toBe("125.00");
  });

  it("rechaza cotización vacía", () => {
    expect(() =>
      calculateQuoteTotals([], { taxRatePct: 16, shippingFlat: "0.00" }),
    ).toThrow(/at least one line/);
  });

  it("rechaza >200 líneas (ADR-011)", () => {
    const lines = Array.from({ length: 201 }, (_, i) => ({
      variantId: `v${i}`,
      quantity: "1.000",
      unitPrice: "1.00",
      discountPct: 0,
    }));
    expect(() =>
      calculateQuoteTotals(lines, { taxRatePct: 16, shippingFlat: "0.00" }),
    ).toThrow(/200 lines/);
  });
});