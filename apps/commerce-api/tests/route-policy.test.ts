import { describe, expect, it } from "vitest";
import "reflect-metadata";
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from "@nestjs/common/constants.js";
import { NO_SCOPE_KEY, RoleGuard, SCOPES_KEY } from "../src/auth/guards/role.guard.js";
import { IS_PUBLIC_KEY } from "../src/auth/guards/principal.guard.js";

import { ApiKeyController } from "../src/auth/api-key.controller.js";
import { MembershipController } from "../src/auth/membership.controller.js";
import { CatalogController } from "../src/catalog/catalog.controller.js";
import { CustomerController } from "../src/customers/customer.controller.js";
import { IntegrationController } from "../src/integrations/integration.controller.js";
import { NotificationController } from "../src/notifications/notification.controller.js";
import { AuditController } from "../src/ops/audit.controller.js";
import { OrderController } from "../src/orders/order.controller.js";
import { PaymentController } from "../src/payments/payment.controller.js";
import { PricingController } from "../src/pricing/pricing.controller.js";
import { QuoteController } from "../src/quotes/quote.controller.js";
import { ReportsController } from "../src/reports/reports.controller.js";
import { TenantSelfController } from "../src/tenants/tenants.controller.js";
import { UsageController } from "../src/usage/usage.controller.js";
import { WhatsAppController } from "../src/whatsapp/whatsapp.controller.js";

/**
 * El `RoleGuard` es fail-closed (ver role.guard.ts): una ruta suya sin
 * `@RequireScopes`, `@NoScopeRequired` ni `@Public` responde 403 en vez de
 * dejar pasar a cualquier principal autenticado.
 *
 * Esta prueba es el barrido que acompaña a ese cambio: recorre por reflexión
 * TODOS los controladores que montan el guard y exige que cada handler declare
 * su política. Si alguien agrega una ruta y se le olvida el decorador, falla
 * aquí en vez de dar un 403 sorpresa en producción.
 */

type Ctor = new (...args: never[]) => object;

const CONTROLLERS: Ctor[] = [
  ApiKeyController,
  MembershipController,
  CatalogController,
  CustomerController,
  IntegrationController,
  NotificationController,
  AuditController,
  OrderController,
  PaymentController,
  PricingController,
  QuoteController,
  ReportsController,
  TenantSelfController,
  UsageController,
  WhatsAppController,
];

function usesRoleGuard(controller: Ctor): boolean {
  const guards = (Reflect.getMetadata(GUARDS_METADATA, controller) ?? []) as unknown[];
  return guards.includes(RoleGuard);
}

/** Handlers HTTP del controlador (los que llevan @Get/@Post/@Patch/@Delete). */
function routeHandlers(controller: Ctor): Array<{ name: string; fn: () => unknown }> {
  const proto = controller.prototype as Record<string, unknown>;
  return Object.getOwnPropertyNames(proto)
    .filter((name) => name !== "constructor")
    .map((name) => ({ name, fn: proto[name] as () => unknown }))
    .filter(
      ({ fn }) =>
        typeof fn === "function" &&
        Reflect.getMetadata(PATH_METADATA, fn) !== undefined &&
        Reflect.getMetadata(METHOD_METADATA, fn) !== undefined,
    );
}

function declaredPolicy(controller: Ctor, fn: () => unknown): string | null {
  const scopes = (Reflect.getMetadata(SCOPES_KEY, fn) ??
    Reflect.getMetadata(SCOPES_KEY, controller)) as string[] | undefined;
  if (scopes && scopes.length > 0) return `scopes:${scopes.join(",")}`;
  if (Reflect.getMetadata(IS_PUBLIC_KEY, fn) || Reflect.getMetadata(IS_PUBLIC_KEY, controller)) {
    return "public";
  }
  if (Reflect.getMetadata(NO_SCOPE_KEY, fn) || Reflect.getMetadata(NO_SCOPE_KEY, controller)) {
    return "no-scope";
  }
  return null;
}

describe("política de acceso declarada en cada ruta bajo RoleGuard", () => {
  it("los controladores auditados montan RoleGuard (si no, la prueba no vigila nada)", () => {
    const sinGuard = CONTROLLERS.filter((c) => !usesRoleGuard(c)).map((c) => c.name);
    expect(sinGuard).toEqual([]);
  });

  it("ninguna ruta se queda sin @RequireScopes, @NoScopeRequired o @Public", () => {
    const huerfanas: string[] = [];
    for (const controller of CONTROLLERS) {
      for (const { name, fn } of routeHandlers(controller)) {
        if (declaredPolicy(controller, fn) === null) {
          huerfanas.push(`${controller.name}.${name}`);
        }
      }
    }
    expect(huerfanas).toEqual([]);
  });

  it("la única ruta que pasa sin scope es el reporte de consumo del agente", () => {
    const sinScope: string[] = [];
    for (const controller of CONTROLLERS) {
      for (const { name, fn } of routeHandlers(controller)) {
        if (declaredPolicy(controller, fn) === "no-scope") {
          sinScope.push(`${controller.name}.${name}`);
        }
      }
    }
    // Si esta lista crece, es una decisión de seguridad: cada entrada es una
    // ruta que cualquier principal autenticado del tenant puede llamar.
    expect(sinScope).toEqual(["UsageController.recordEvent"]);
  });

  it("cada controlador expone al menos una ruta (la reflexión sigue funcionando)", () => {
    for (const controller of CONTROLLERS) {
      expect(routeHandlers(controller).length).toBeGreaterThan(0);
    }
  });
});
