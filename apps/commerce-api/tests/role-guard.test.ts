import { describe, expect, it } from "vitest";
import "reflect-metadata";
import { ForbiddenException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import {
  NoScopeRequired,
  RequireScopes,
  RoleGuard,
} from "../src/auth/guards/role.guard.js";
import { Public } from "../src/auth/guards/principal.guard.js";
import { RequestContext, type Principal } from "../src/common/context/request-context.js";

/**
 * `RoleGuard` pasó a ser fail-closed: una ruta sin política declarada se
 * deniega. Antes devolvía `true`, así que olvidar `@RequireScopes` abría la
 * ruta a cualquier principal autenticado y el olvido no se notaba jamás.
 *
 * También lee metadata de clase (`getAllAndMerge`/`getAllAndOverride`): un
 * `@RequireScopes` o un `@Public` a nivel de controlador se ignoraban.
 */

/** ExecutionContext mínimo: al guard solo le importan handler y clase. */
function contextOf(handler: object, cls: object) {
  return {
    getHandler: () => handler,
    getClass: () => cls,
  } as never;
}

function guard() {
  return new RoleGuard(new Reflector());
}

function withPrincipal<T>(principal: Principal, fn: () => T): T {
  return RequestContext.run(fn, { principal });
}

const OWNER: Principal = { type: "USER", userId: "u1", tenantId: "t1", role: "OWNER" };
const VIEWER: Principal = { type: "USER", userId: "u2", tenantId: "t1", role: "VIEWER" };

describe("RoleGuard: por defecto deniega", () => {
  it("una ruta sin ningún decorador se rechaza aunque el principal sea OWNER", () => {
    class Ctrl {
      handler() {}
    }
    const ctx = contextOf(Ctrl.prototype.handler, Ctrl);
    expect(() => withPrincipal(OWNER, () => guard().canActivate(ctx))).toThrow(
      ForbiddenException,
    );
  });

  it("el mensaje dice que falta la política, no que falten scopes", () => {
    class Ctrl {
      handler() {}
    }
    const ctx = contextOf(Ctrl.prototype.handler, Ctrl);
    try {
      withPrincipal(OWNER, () => guard().canActivate(ctx));
      expect.unreachable("debía lanzar");
    } catch (err) {
      expect((err as ForbiddenException).getResponse()).toMatchObject({
        code: "FORBIDDEN",
        message: "Ruta sin política de acceso declarada",
      });
    }
  });

  it("@NoScopeRequired() la abre a cualquier principal autenticado", () => {
    class Ctrl {
      handler() {}
    }
    NoScopeRequired()(Ctrl.prototype, "handler", Object.getOwnPropertyDescriptor(Ctrl.prototype, "handler")!);
    const ctx = contextOf(Ctrl.prototype.handler, Ctrl);
    expect(withPrincipal(VIEWER, () => guard().canActivate(ctx))).toBe(true);
  });

  it("@Public() en el handler la abre sin principal", () => {
    class Ctrl {
      handler() {}
    }
    Public()(Ctrl.prototype, "handler", Object.getOwnPropertyDescriptor(Ctrl.prototype, "handler")!);
    const ctx = contextOf(Ctrl.prototype.handler, Ctrl);
    expect(withPrincipal({ type: "ANONYMOUS" }, () => guard().canActivate(ctx))).toBe(true);
  });

  it("@Public() a nivel de controlador también cuenta (antes se ignoraba)", () => {
    class Ctrl {
      handler() {}
    }
    Public()(Ctrl);
    const ctx = contextOf(Ctrl.prototype.handler, Ctrl);
    expect(withPrincipal({ type: "ANONYMOUS" }, () => guard().canActivate(ctx))).toBe(true);
  });
});

describe("RoleGuard: scopes", () => {
  it("deja pasar al rol que tiene el scope y rechaza al que no", () => {
    class Ctrl {
      handler() {}
    }
    RequireScopes("catalog.write")(
      Ctrl.prototype,
      "handler",
      Object.getOwnPropertyDescriptor(Ctrl.prototype, "handler")!,
    );
    const ctx = contextOf(Ctrl.prototype.handler, Ctrl);

    expect(withPrincipal(OWNER, () => guard().canActivate(ctx))).toBe(true);
    expect(() => withPrincipal(VIEWER, () => guard().canActivate(ctx))).toThrow(
      /Faltan scopes: catalog\.write/,
    );
  });

  it("un @RequireScopes a nivel de controlador se exige en la ruta", () => {
    class Ctrl {
      handler() {}
    }
    RequireScopes("tenant.admin")(Ctrl);
    const ctx = contextOf(Ctrl.prototype.handler, Ctrl);

    // Solo OWNER tiene tenant.admin en la matriz.
    expect(withPrincipal(OWNER, () => guard().canActivate(ctx))).toBe(true);
    expect(() =>
      withPrincipal({ ...VIEWER, role: "ADMIN" }, () => guard().canActivate(ctx)),
    ).toThrow(/Faltan scopes: tenant\.admin/);
  });

  it("controlador y handler se suman: hacen falta los dos scopes", () => {
    class Ctrl {
      handler() {}
    }
    RequireScopes("catalog.read")(Ctrl);
    RequireScopes("payments.refund")(
      Ctrl.prototype,
      "handler",
      Object.getOwnPropertyDescriptor(Ctrl.prototype, "handler")!,
    );
    const ctx = contextOf(Ctrl.prototype.handler, Ctrl);

    // CATALOG tiene catalog.read pero no payments.refund.
    expect(() =>
      withPrincipal({ ...VIEWER, role: "CATALOG" }, () => guard().canActivate(ctx)),
    ).toThrow(/Faltan scopes: payments\.refund/);
    expect(withPrincipal(OWNER, () => guard().canActivate(ctx))).toBe(true);
  });

  it("una API key vale por sus scopes, no por un rol", () => {
    class Ctrl {
      handler() {}
    }
    RequireScopes("orders.write")(
      Ctrl.prototype,
      "handler",
      Object.getOwnPropertyDescriptor(Ctrl.prototype, "handler")!,
    );
    const ctx = contextOf(Ctrl.prototype.handler, Ctrl);

    const conScope: Principal = {
      type: "API_KEY",
      tenantId: "t1",
      apiKeyId: "k1",
      scopes: ["orders.write"],
    };
    const sinScope: Principal = { ...conScope, scopes: ["orders.read"] };

    expect(withPrincipal(conScope, () => guard().canActivate(ctx))).toBe(true);
    expect(() => withPrincipal(sinScope, () => guard().canActivate(ctx))).toThrow(
      /Faltan scopes: orders\.write/,
    );
  });

  it("un principal anónimo nunca pasa una ruta con scopes", () => {
    class Ctrl {
      handler() {}
    }
    RequireScopes("catalog.read")(
      Ctrl.prototype,
      "handler",
      Object.getOwnPropertyDescriptor(Ctrl.prototype, "handler")!,
    );
    const ctx = contextOf(Ctrl.prototype.handler, Ctrl);
    expect(() => withPrincipal({ type: "ANONYMOUS" }, () => guard().canActivate(ctx))).toThrow(
      /Autenticación de usuario requerida/,
    );
  });
});
