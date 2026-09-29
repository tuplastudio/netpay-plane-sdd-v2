import { describe, expect, it, vi } from "vitest";
import { BadRequestException } from "@nestjs/common";
import { ReportsController } from "../src/reports/reports.controller.js";
import { RequestContext } from "../src/common/context/request-context.js";

/**
 * `GET /reports/attention?agentId=&provider=`: los filtros se validan en el
 * controller (uuid / enum) y llegan al servicio tal cual; sin filtros el
 * servicio recibe `undefined` (compatibilidad con clientes anteriores).
 */

const TENANT = "11111111-1111-1111-1111-111111111111";
const AGENT = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

function setup() {
  const report = vi.fn().mockResolvedValue({ ok: true });
  const controller = new ReportsController({} as never, { report } as never);
  const call = (...args: Parameters<ReportsController["attentionReport"]>) =>
    RequestContext.run(() => controller.attentionReport(...args), {
      principal: { type: "USER", tenantId: TENANT, userId: AGENT, scopes: ["chat.read"] },
    });
  return { report, call };
}

describe("attention report filters", () => {
  it("sin filtros manda filtros vacíos", async () => {
    const { report, call } = setup();
    await call();
    expect(report).toHaveBeenCalledWith(TENANT, expect.anything(), {
      agentId: undefined,
      provider: undefined,
    });
  });

  it("pasa agentId y provider válidos al servicio", async () => {
    const { report, call } = setup();
    await call(undefined, undefined, AGENT, "META");
    expect(report).toHaveBeenCalledWith(TENANT, expect.anything(), {
      agentId: AGENT,
      provider: "META",
    });
  });

  it("rechaza agentId que no es UUID", async () => {
    const { report, call } = setup();
    await expect(call(undefined, undefined, "no-uuid")).rejects.toBeInstanceOf(BadRequestException);
    expect(report).not.toHaveBeenCalled();
  });

  it("rechaza provider fuera del enum", async () => {
    const { report, call } = setup();
    await expect(call(undefined, undefined, undefined, "TELEGRAM")).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(report).not.toHaveBeenCalled();
  });
});
