import { describe, expect, it } from "vitest";
import { ROLE_SCOPES, roleHas, scopesFor } from "../src/auth/policies.js";

/**
 * La matriz de permisos es normativa (docs/03-iam.md): estas pruebas fijan las
 * fronteras que no deben moverse por accidente al agregar features.
 */

describe("matriz de roles", () => {
  it("solo OWNER administra el tenant", () => {
    expect(roleHas("OWNER", "tenant.admin")).toBe(true);
    for (const role of Object.keys(ROLE_SCOPES).filter((r) => r !== "OWNER")) {
      expect(roleHas(role, "tenant.admin")).toBe(false);
    }
  });

  it("VENDOR cotiza pero no reembolsa ni edita catálogo", () => {
    expect(roleHas("VENDOR", "quotes.write")).toBe(true);
    expect(roleHas("VENDOR", "payments.refund")).toBe(false);
    expect(roleHas("VENDOR", "catalog.write")).toBe(false);
  });

  it("VIEWER es de solo lectura", () => {
    for (const scope of scopesFor("VIEWER")) {
      expect(scope.endsWith(".read")).toBe(true);
    }
  });

  it("FINANCE reembolsa y exporta, pero no vende", () => {
    expect(roleHas("FINANCE", "payments.refund")).toBe(true);
    expect(roleHas("FINANCE", "payments.export")).toBe(true);
    expect(roleHas("FINANCE", "quotes.write")).toBe(false);
  });

  it("un rol desconocido no obtiene ningún scope", () => {
    expect(scopesFor("ROOT")).toEqual([]);
    expect(roleHas("ROOT", "catalog.read")).toBe(false);
  });

  it("ningún rol salvo OWNER cancela pedidos ajenos y administra usuarios a la vez", () => {
    const both = Object.entries(ROLE_SCOPES)
      .filter(([, scopes]) => scopes.includes("orders.cancel_any") && scopes.includes("users.manage"))
      .map(([role]) => role);
    expect(both.sort()).toEqual(["ADMIN", "OWNER"]);
  });
});
