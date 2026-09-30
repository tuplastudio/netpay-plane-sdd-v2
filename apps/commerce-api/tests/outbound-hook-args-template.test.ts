import { describe, expect, it } from "vitest";
import { buildToolArguments, readPath, renderArgsTemplate } from "../src/hooks/args-template.js";
import type { DomainEvent } from "../src/hooks/domain-event-bus.js";

/**
 * Plantilla de argumentos MCP: `{{ruta}}` resuelto contra `{ event, data }`.
 */

const EVENT: DomainEvent = {
  id: "evt-1",
  event: "order.paid",
  occurredAt: "2026-01-15T17:05:00.000Z",
  tenantId: "t-1",
  data: {
    orderId: "o-1",
    total: "1160.00",
    lines: [{ sku: "A" }, { sku: "B" }],
    meta: { count: 2, nothing: null },
  },
  version: 1,
};

describe("plantilla de argumentos MCP", () => {
  it("lee rutas con puntos e índices", () => {
    expect(readPath({ event: EVENT }, "event.data.lines[1].sku")).toBe("B");
    expect(readPath({ event: EVENT }, "event.data.lines.0.sku")).toBe("A");
    expect(readPath({ event: EVENT }, "event.data.nope.deeper")).toBeUndefined();
  });

  it("un placeholder exacto conserva el tipo del valor", () => {
    const out = renderArgsTemplate(
      {
        id: "{{event.data.orderId}}",
        count: "{{ data.meta.count }}",
        lines: "{{event.data.lines}}",
        missing: "{{data.nope}}",
        nothing: "{{data.meta.nothing}}",
      },
      EVENT,
    ) as Record<string, unknown>;
    expect(out.id).toBe("o-1");
    expect(out.count).toBe(2);
    expect(out.lines).toEqual([{ sku: "A" }, { sku: "B" }]);
    expect(out.missing).toBeNull();
    expect(out.nothing).toBeNull();
  });

  it("interpola dentro de texto y serializa objetos", () => {
    const out = renderArgsTemplate(
      {
        note: "Pedido {{event.data.orderId}} por ${{data.total}} ({{event.event}})",
        raw: "meta={{data.meta}} missing=[{{data.nope}}]",
        list: ["{{data.orderId}}", 3, true, null],
        nested: { when: "{{event.occurredAt}}" },
      },
      EVENT,
    ) as Record<string, unknown>;
    expect(out.note).toBe("Pedido o-1 por $1160.00 (order.paid)");
    expect(out.raw).toBe('meta={"count":2,"nothing":null} missing=[]');
    expect(out.list).toEqual(["o-1", 3, true, null]);
    expect(out.nested).toEqual({ when: "2026-01-15T17:05:00.000Z" });
  });

  it("sin plantilla manda el sobre completo; con plantilla no-objeto lo envuelve", () => {
    expect(buildToolArguments(null, EVENT)).toEqual({ event: EVENT });
    expect(buildToolArguments(undefined, EVENT)).toEqual({ event: EVENT });
    expect(buildToolArguments("{{data.orderId}}", EVENT)).toEqual({ value: "o-1", event: EVENT });
    expect(buildToolArguments({ a: "{{data.orderId}}" }, EVENT)).toEqual({ a: "o-1" });
  });
});
