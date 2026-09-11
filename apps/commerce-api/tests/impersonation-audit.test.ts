import { beforeEach, describe, expect, it } from "vitest";
import "reflect-metadata";
import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { SuperAdminController } from "../src/super-admin/super-admin.controller.js";
import { auditImpersonationMiddleware } from "../src/prisma/prisma.service.js";
import { IMPERSONATE_COOKIE } from "../src/auth/guards/principal.guard.js";
import { RequestContext, type Principal } from "../src/common/context/request-context.js";

/**
 * Impersonación auditada (hallazgo M2).
 *
 * El super-admin podía entrar a cualquier empresa con la cookie `impersonate`
 * y NADA lo registraba: ni el "entré", ni el "salí", ni las acciones de dentro,
 * que quedaban firmadas como si las hubiera hecho el propio dueño (el
 * PrincipalGuard sustituye tenantId y rol del principal).
 *
 * Se cierra por dos lados: filas explícitas de inicio/fin en el controlador, y
 * un sello automático en el metadata de TODA fila de AuditLog escrita durante
 * una petición impersonada (middleware de Prisma, un solo punto para los 26
 * `auditLog.create` repartidos por los servicios).
 */

const TENANT = "11111111-1111-1111-1111-111111111111";
const SUPER: Principal = { type: "USER", userId: "u-super", isSuperAdmin: true };

interface AuditRow {
  tenantId: string;
  actorId: string | null;
  action: string;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
}

function makeController(status = "ACTIVE") {
  const audit: AuditRow[] = [];
  const cookies: Array<{ name: string; value: string }> = [];
  const cleared: string[] = [];

  const prisma = {
    tenant: {
      findUnique: async ({ where }: { where: { id?: string; slug?: string } }) =>
        where.id === TENANT || where.slug === "acme"
          ? { id: TENANT, slug: "acme", name: "Acme", status }
          : null,
      findFirst: async () => ({ id: TENANT, slug: "acme", name: "Acme" }),
    },
    auditLog: {
      create: async ({ data }: { data: AuditRow }) => {
        audit.push(data);
        return data;
      },
    },
  };
  const superAdmin = { overview: async () => ({}), listUsers: async () => [] };

  const controller = new SuperAdminController(superAdmin as never, prisma as never);
  const res = {
    cookie: (name: string, value: string) => cookies.push({ name, value }),
    clearCookie: (name: string) => cleared.push(name),
  } as never;

  return { controller, audit, cookies, cleared, res };
}

function asSuperAdmin<T>(fn: () => Promise<T>): Promise<T> {
  return RequestContext.run(fn, { principal: SUPER });
}

let ctx: ReturnType<typeof makeController>;
beforeEach(() => {
  ctx = makeController();
});

describe("inicio y fin de impersonación quedan en la auditoría del tenant", () => {
  it("entrar escribe superadmin.impersonation_started con el super-admin como actor", async () => {
    await asSuperAdmin(() => ctx.controller.impersonate(TENANT, ctx.res));

    expect(ctx.audit).toHaveLength(1);
    expect(ctx.audit[0]).toMatchObject({
      tenantId: TENANT,
      actorId: "u-super",
      action: "superadmin.impersonation_started",
      targetType: "Tenant",
      targetId: TENANT,
    });
    expect(ctx.audit[0]!.metadata).toMatchObject({
      userId: "u-super",
      impersonatorUserId: "u-super",
      tenantSlug: "acme",
    });
  });

  it("la fila va al tenant impersonado, que es donde su dueño puede verla", async () => {
    await asSuperAdmin(() => ctx.controller.impersonate(TENANT, ctx.res));
    expect(ctx.audit[0]!.tenantId).toBe(TENANT);
  });

  it("salir escribe superadmin.impersonation_stopped y borra la cookie", async () => {
    const req = { cookies: { [IMPERSONATE_COOKIE]: "acme" } } as never;
    await asSuperAdmin(() => ctx.controller.stopImpersonating(req, ctx.res));

    expect(ctx.cleared).toEqual([IMPERSONATE_COOKIE]);
    expect(ctx.audit).toHaveLength(1);
    expect(ctx.audit[0]).toMatchObject({
      tenantId: TENANT,
      actorId: "u-super",
      action: "superadmin.impersonation_stopped",
      targetType: "Tenant",
    });
  });

  it("salir sin cookie no inventa una fila (no había impersonación que cerrar)", async () => {
    const req = { cookies: {} } as never;
    await asSuperAdmin(() => ctx.controller.stopImpersonating(req, ctx.res));
    expect(ctx.audit).toEqual([]);
    expect(ctx.cleared).toEqual([IMPERSONATE_COOKIE]);
  });

  it("una empresa suspendida no se impersona y no deja rastro de inicio", async () => {
    const suspendida = makeController("DISABLED");
    await expect(
      asSuperAdmin(() => suspendida.controller.impersonate(TENANT, suspendida.res)),
    ).rejects.toThrow(ForbiddenException);
    expect(suspendida.audit).toEqual([]);
    expect(suspendida.cookies).toEqual([]);
  });

  it("una empresa inexistente da 404 sin escribir auditoría", async () => {
    await expect(
      asSuperAdmin(() => ctx.controller.impersonate("99999999-9999-9999-9999-999999999999", ctx.res)),
    ).rejects.toThrow(NotFoundException);
    expect(ctx.audit).toEqual([]);
  });
});

describe("las acciones hechas mientras se impersona son atribuibles", () => {
  const impersonando: Principal = {
    type: "USER",
    userId: "u-super",
    tenantId: TENANT,
    role: "OWNER",
    isSuperAdmin: true,
    impersonated: true,
    impersonatorUserId: "u-super",
  };

  function runMiddleware(principal: Principal, data: unknown, model = "AuditLog") {
    return RequestContext.run(
      () =>
        auditImpersonationMiddleware(
          { model, action: "create", args: { data } } as never,
          async (p) => p.args?.data,
        ),
      { principal },
    );
  }

  it("el metadata de cualquier AuditLog lleva el sello de impersonación", async () => {
    const out = (await runMiddleware(impersonando, {
      tenantId: TENANT,
      action: "user.role_changed",
      metadata: { toRole: "ADMIN" },
    })) as { metadata: Record<string, unknown> };

    expect(out.metadata).toEqual({
      impersonated: true,
      impersonatorUserId: "u-super",
      toRole: "ADMIN",
    });
  });

  it("una fila sin metadata igual queda sellada", async () => {
    const out = (await runMiddleware(impersonando, {
      tenantId: TENANT,
      action: "quote.issued",
    })) as { metadata: Record<string, unknown> };

    expect(out.metadata).toEqual({ impersonated: true, impersonatorUserId: "u-super" });
  });

  it("una petición normal del dueño no se ensucia", async () => {
    const owner: Principal = { type: "USER", userId: "u-owner", tenantId: TENANT, role: "OWNER" };
    const out = (await runMiddleware(owner, {
      tenantId: TENANT,
      action: "user.removed",
      metadata: { email: "x@acme.mx" },
    })) as { metadata: Record<string, unknown> };

    expect(out.metadata).toEqual({ email: "x@acme.mx" });
  });

  it("el middleware no toca otros modelos", async () => {
    const out = (await runMiddleware(
      impersonando,
      { tenantId: TENANT, fullName: "Cliente" },
      "Customer",
    )) as Record<string, unknown>;
    expect(out.metadata).toBeUndefined();
  });

  it("createMany sella todas las filas", async () => {
    const out = (await runMiddleware(impersonando, [
      { tenantId: TENANT, action: "a" },
      { tenantId: TENANT, action: "b", metadata: { k: 1 } },
    ])) as Array<{ metadata: Record<string, unknown> }>;

    expect(out[0]!.metadata).toEqual({ impersonated: true, impersonatorUserId: "u-super" });
    expect(out[1]!.metadata).toMatchObject({ impersonated: true, k: 1 });
  });

  it("RequestContext expone la impersonación para quien la necesite explícita", () => {
    RequestContext.run(() => {
      expect(RequestContext.impersonated).toBe(true);
      expect(RequestContext.impersonatorUserId).toBe("u-super");
    }, { principal: impersonando });

    RequestContext.run(() => {
      expect(RequestContext.impersonated).toBe(false);
      expect(RequestContext.auditImpersonationStamp).toEqual({});
    }, { principal: { type: "USER", userId: "u-owner" } });
  });
});
