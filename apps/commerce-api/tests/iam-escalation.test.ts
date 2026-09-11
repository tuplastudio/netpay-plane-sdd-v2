import { beforeEach, describe, expect, it } from "vitest";
import "reflect-metadata";
import { ForbiddenException } from "@nestjs/common";
import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";
import { ApiKeyController } from "../src/auth/api-key.controller.js";
import { CreateApiKeyDto, CreateInvitationDto } from "../src/auth/iam.dto.js";
import { ALL_SCOPES } from "../src/auth/policies.js";
import { RequestContext, type Principal } from "../src/common/context/request-context.js";

/**
 * Escalada de privilegios por `@Body()` sin validar (hallazgo M5).
 *
 * Dos agujeros en `/iam`, ambos porque el tipo literal del parámetro no llega
 * al ValidationPipe:
 *
 *  1. `POST /iam/invitations` aceptaba `role` libre: un ADMIN se invitaba a sí
 *     mismo como OWNER y se saltaba la regla que `MembershipService` sí aplica
 *     al cambiar el rol de una membresía existente.
 *  2. `POST /iam/api-keys` aceptaba `scopes: string[]` libre: un ADMIN acuñaba
 *     una key con `payments.refund` o `tenant.admin` —que su rol no tiene— y
 *     la usaba como Bearer.
 *
 * Prisma y los servicios son fakes en memoria; no hay base de datos.
 */

const TENANT = "11111111-1111-1111-1111-111111111111";

interface CreatedKey {
  tenantId: string;
  actorId: string;
  name: string;
  scopes: string[];
}

interface CreatedInvite {
  tenantId: string;
  email: string;
  role: string;
}

function makeController() {
  const keys: CreatedKey[] = [];
  const invites: CreatedInvite[] = [];

  const apiKeys = {
    list: async () => [],
    create: async (input: CreatedKey) => {
      keys.push(input);
      return { id: "k1", prefix: "npk_x", ...input, secret: "npk_x_y", expiresAt: null };
    },
    revoke: async () => ({ ok: true }),
  };
  const invite = {
    createInvite: async (input: CreatedInvite) => {
      invites.push(input);
      return { token: "tok", expiresAt: new Date(Date.now() + 3600_000) };
    },
  };
  const prisma = {
    tenant: { findUnique: async () => ({ id: TENANT, name: "Acme", slug: "acme" }) },
  };
  const mailer = { sendBestEffort: async () => undefined };

  const controller = new ApiKeyController(
    apiKeys as never,
    invite as never,
    prisma as never,
    mailer as never,
  );
  return { controller, keys, invites };
}

function asPrincipal<T>(principal: Principal, fn: () => Promise<T>): Promise<T> {
  return RequestContext.run(fn, { principal });
}

const OWNER: Principal = { type: "USER", userId: "u-owner", tenantId: TENANT, role: "OWNER" };
const ADMIN: Principal = { type: "USER", userId: "u-admin", tenantId: TENANT, role: "ADMIN" };

let ctx: ReturnType<typeof makeController>;
beforeEach(() => {
  ctx = makeController();
});

describe("POST /iam/api-keys: una key nunca excede a quien la emite", () => {
  it("un ADMIN no puede acuñar una key con payments.refund (su rol no lo tiene)", async () => {
    const body = plainToInstance(CreateApiKeyDto, {
      name: "bot",
      scopes: ["orders.read", "payments.refund"],
    });
    await expect(
      asPrincipal(ADMIN, () => ctx.controller.createKey(body)),
    ).rejects.toThrow(ForbiddenException);
    expect(ctx.keys).toHaveLength(0);
  });

  it("un ADMIN tampoco puede acuñar tenant.admin y así volverse propietario de facto", async () => {
    const body = plainToInstance(CreateApiKeyDto, { name: "bot", scopes: ["tenant.admin"] });
    await expect(
      asPrincipal(ADMIN, () => ctx.controller.createKey(body)),
    ).rejects.toThrow(/No puedes otorgar scopes que tú no tienes: tenant\.admin/);
  });

  it("el error nombra exactamente los scopes de más", async () => {
    const body = plainToInstance(CreateApiKeyDto, {
      name: "bot",
      scopes: ["catalog.read", "payments.refund", "payments.export"],
    });
    try {
      await asPrincipal(ADMIN, () => ctx.controller.createKey(body));
      expect.unreachable("debía lanzar");
    } catch (err) {
      const res = (err as ForbiddenException).getResponse() as { message: string };
      expect(res.message).toContain("payments.refund");
      expect(res.message).toContain("payments.export");
      expect(res.message).not.toContain("catalog.read");
    }
  });

  it("un ADMIN sí acuña una key dentro de sus propios scopes", async () => {
    const body = plainToInstance(CreateApiKeyDto, {
      name: "bot",
      scopes: ["orders.read", "catalog.write"],
    });
    const res = await asPrincipal(ADMIN, () => ctx.controller.createKey(body));
    expect(res.data.scopes).toEqual(["orders.read", "catalog.write"]);
    expect(ctx.keys).toHaveLength(1);
  });

  it("un OWNER puede otorgar cualquier scope del catálogo", async () => {
    const body = plainToInstance(CreateApiKeyDto, { name: "todo", scopes: [...ALL_SCOPES] });
    await expect(asPrincipal(OWNER, () => ctx.controller.createKey(body))).resolves.toBeTruthy();
  });

  it("una API key no puede emitir otra con más scopes que ella misma", async () => {
    const principal: Principal = {
      type: "API_KEY",
      tenantId: TENANT,
      userId: "u-owner",
      apiKeyId: "k0",
      scopes: ["apikeys.manage", "catalog.read"],
    };
    const body = plainToInstance(CreateApiKeyDto, { name: "hija", scopes: ["catalog.write"] });
    await expect(
      asPrincipal(principal, () => ctx.controller.createKey(body)),
    ).rejects.toThrow(/catalog\.write/);
  });
});

describe("CreateApiKeyDto: lista blanca de scopes", () => {
  it("rechaza un scope inventado", () => {
    const errors = validateSync(
      plainToInstance(CreateApiKeyDto, { name: "x", scopes: ["superadmin.everything"] }),
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]!.property).toBe("scopes");
  });

  it("acepta el catálogo completo de policies.ts", () => {
    const errors = validateSync(
      plainToInstance(CreateApiKeyDto, { name: "x", scopes: [...ALL_SCOPES] }),
    );
    expect(errors).toEqual([]);
  });

  it("exige al menos un scope y un nombre", () => {
    expect(validateSync(plainToInstance(CreateApiKeyDto, { name: "x", scopes: [] })).length)
      .toBeGreaterThan(0);
    expect(validateSync(plainToInstance(CreateApiKeyDto, { scopes: ["catalog.read"] })).length)
      .toBeGreaterThan(0);
  });
});

describe("POST /iam/invitations: solo un propietario nombra propietarios", () => {
  it("un ADMIN no puede invitar con role OWNER", async () => {
    const body = plainToInstance(CreateInvitationDto, {
      email: "yo@acme.mx",
      fullName: "Ada Admin",
      role: "OWNER",
    });
    await expect(
      asPrincipal(ADMIN, () => ctx.controller.inviteUser(body)),
    ).rejects.toThrow(/Solo un propietario puede invitar a otro propietario/);
    expect(ctx.invites).toHaveLength(0);
  });

  it("un OWNER sí puede", async () => {
    const body = plainToInstance(CreateInvitationDto, {
      email: "otro@acme.mx",
      fullName: "Otto Owner",
      role: "OWNER",
    });
    await asPrincipal(OWNER, () => ctx.controller.inviteUser(body));
    expect(ctx.invites).toEqual([
      { tenantId: TENANT, email: "otro@acme.mx", fullName: "Otto Owner", role: "OWNER" },
    ]);
  });

  it("un super-admin (impersonando o no) también puede", async () => {
    const superAdmin: Principal = { ...ADMIN, isSuperAdmin: true };
    const body = plainToInstance(CreateInvitationDto, {
      email: "otro@acme.mx",
      fullName: "Otto Owner",
      role: "OWNER",
    });
    await asPrincipal(superAdmin, () => ctx.controller.inviteUser(body));
    expect(ctx.invites).toHaveLength(1);
  });

  it("una API key nunca fabrica un OWNER, ni con el scope tenant.admin", async () => {
    const principal: Principal = {
      type: "API_KEY",
      tenantId: TENANT,
      apiKeyId: "k0",
      scopes: ["users.invite", "tenant.admin"],
    };
    const body = plainToInstance(CreateInvitationDto, {
      email: "bot@acme.mx",
      fullName: "Bot Owner",
      role: "OWNER",
    });
    await expect(
      asPrincipal(principal, () => ctx.controller.inviteUser(body)),
    ).rejects.toThrow(ForbiddenException);
  });

  it("los roles no-OWNER los invita cualquiera con users.invite", async () => {
    const body = plainToInstance(CreateInvitationDto, {
      email: "vera@acme.mx",
      fullName: "Vera Vendedora",
      role: "VENDOR",
    });
    await asPrincipal(ADMIN, () => ctx.controller.inviteUser(body));
    expect(ctx.invites[0]!.role).toBe("VENDOR");
  });
});

describe("CreateInvitationDto: el rol viene de la matriz", () => {
  it("rechaza un rol inventado", () => {
    const errors = validateSync(
      plainToInstance(CreateInvitationDto, {
        email: "x@acme.mx",
        fullName: "Equis",
        role: "SUPERUSER",
      }),
    );
    expect(errors.map((e) => e.property)).toEqual(["role"]);
  });

  it("rechaza un email que no es email", () => {
    const errors = validateSync(
      plainToInstance(CreateInvitationDto, { email: "no-es-email", fullName: "Equis", role: "VIEWER" }),
    );
    expect(errors.map((e) => e.property)).toEqual(["email"]);
  });
});
