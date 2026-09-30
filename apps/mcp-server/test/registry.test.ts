import { describe, it, expect } from "vitest";
import { allRoutes } from "../src/registry/index.js";

describe("allRoutes", () => {
  it("no tiene nombres duplicados", () => {
    const seen = new Set<string>();
    const dups: string[] = [];
    for (const r of allRoutes) {
      if (seen.has(r.name)) dups.push(r.name);
      seen.add(r.name);
    }
    expect(dups, `tools duplicadas: ${dups.join(", ")}`).toEqual([]);
  });

  it("toda tool tiene description no vacía", () => {
    const empties = allRoutes.filter((r) => !r.description || r.description.trim() === "");
    expect(empties.map((r) => r.name)).toEqual([]);
  });

  it("toda tool tiene name snake_case (heurística simple)", () => {
    const bad = allRoutes.filter((r) => !/^[a-z][a-z0-9_]*$/.test(r.name));
    expect(bad.map((r) => r.name)).toEqual([]);
  });

  it("path params declarados aparecen en :placeholders del path", () => {
    const mismatches: string[] = [];
    for (const r of allRoutes) {
      const placeholders = new Set<string>();
      for (const m of r.path.matchAll(/:([a-zA-Z_][a-zA-Z0-9_]*)/g)) placeholders.add(m[1]!);
      const declared = new Set(Object.keys(r.pathParams ?? {}));
      for (const p of placeholders) {
        if (!declared.has(p)) mismatches.push(`${r.name}: placeholder :${p} no declarado en pathParams`);
      }
      for (const p of declared) {
        if (!placeholders.has(p)) mismatches.push(`${r.name}: pathParam ${p} declarado pero no usado en path`);
      }
    }
    expect(mismatches).toEqual([]);
  });

  it("métodos válidos", () => {
    const allowed = new Set(["GET", "POST", "PATCH", "DELETE"]);
    const bad = allRoutes.filter((r) => !allowed.has(r.method));
    expect(bad.map((r) => `${r.name}: ${r.method}`)).toEqual([]);
  });

  it("rutas relativas arrancan con /", () => {
    const bad = allRoutes.filter((r) => !r.path.startsWith("/"));
    expect(bad.map((r) => `${r.name}: ${r.path}`)).toEqual([]);
  });

  it("destructiveHint solo aparece en métodos no-GET", () => {
    const bad = allRoutes.filter((r) => r.method === "GET" && r.destructiveHint === true);
    expect(bad.map((r) => r.name)).toEqual([]);
  });

  it("cubre los dominios clave: catalog/orders/quotes/customers/conversations/agente/sistema", () => {
    const names = new Set(allRoutes.map((r) => r.name));
    // Pedidos
    expect(names.has("orders_list")).toBe(true);
    expect(names.has("orders_create")).toBe(true);
    expect(names.has("orders_quick_charge")).toBe(true);
    expect(names.has("orders_request_invoice")).toBe(true);
    // Catálogo
    expect(names.has("catalog_list_products")).toBe(true);
    expect(names.has("catalog_create_product")).toBe(true);
    expect(names.has("catalog_commit_import")).toBe(true);
    // Cotizaciones
    expect(names.has("quotes_list")).toBe(true);
    expect(names.has("quotes_create")).toBe(true);
    expect(names.has("quotes_issue")).toBe(true);
    expect(names.has("quotes_cancel")).toBe(true);
    // Customers (gaps llenados)
    expect(names.has("customers_get_summary")).toBe(true);
    expect(names.has("customers_get_timeline")).toBe(true);
    expect(names.has("customers_list_notes")).toBe(true);
    expect(names.has("customers_add_note")).toBe(true);
    expect(names.has("customers_delete_note")).toBe(true);
    expect(names.has("customers_update_address")).toBe(true);
    expect(names.has("customers_delete_address")).toBe(true);
    expect(names.has("customers_list_tags")).toBe(true);
    // Conversaciones (gaps llenados)
    expect(names.has("conversations_set_priority")).toBe(true);
    expect(names.has("conversations_set_pending")).toBe(true);
    expect(names.has("conversations_bulk")).toBe(true);
    expect(names.has("conversations_release")).toBe(true);
    // Configuración del agente (canned responses)
    expect(names.has("canned_responses_list")).toBe(true);
    expect(names.has("canned_responses_create")).toBe(true);
    expect(names.has("canned_responses_update")).toBe(true);
    expect(names.has("canned_responses_delete")).toBe(true);
    // Configuración del sistema (tenants/me)
    expect(names.has("tenants_me_get")).toBe(true);
    expect(names.has("tenants_me_agent_context")).toBe(true);
    expect(names.has("tenants_me_update_branding")).toBe(true);
    expect(names.has("tenants_me_update_settings")).toBe(true);
    // IAM
    expect(names.has("iam_list_api_keys")).toBe(true);
    expect(names.has("iam_revoke_api_key")).toBe(true);
    expect(names.has("iam_invite_user")).toBe(true);
    // Usage super-admin
    expect(names.has("super_admin_usage_summary")).toBe(true);
    expect(names.has("super_admin_usage_detail")).toBe(true);
  });
});