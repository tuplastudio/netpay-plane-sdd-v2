import type { RouteDef } from "./types.js";

/**
 * Solo alcanzable con una key GLOBAL (T-IAM-09b): `SuperAdminGuard` rechaza
 * cualquier key de tenant normal. No manda X-Tenant-Id — estas rutas son
 * cross-tenant por diseño (administran empresas, no operan una).
 *
 * Fuera de este registro a propósito: impersonar (`POST/DELETE/GET
 * .../impersonate`) es un mecanismo de cookie de sesión de navegador, no
 * aplica a un cliente por API key — el mismo resultado se logra con una key
 * global + el header X-Tenant-Id en cualquier tool de negocio normal.
 */
const ASSIGNABLE_ROLES = ["OWNER", "ADMIN", "VENDOR", "FINANCE", "CATALOG", "SUPPORT", "VIEWER"];

export const superAdminRoutes: RouteDef[] = [
  {
    name: "super_admin_overview",
    method: "GET",
    path: "/super-admin/overview",
    description: "Agregados de toda la plataforma: conteos de empresas, usuarios distintos, invitaciones pendientes y uso del mes en curso.",
    scopes: [],
  },
  {
    name: "super_admin_list_users",
    method: "GET",
    path: "/super-admin/users",
    description: "Busca usuarios a través de todas las empresas.",
    scopes: [],
    query: { q: { type: "string" } },
  },
  {
    name: "super_admin_list_tenants",
    method: "GET",
    path: "/super-admin/tenants",
    description: "Lista todas las empresas (tenants) de la plataforma.",
    scopes: [],
  },
  {
    name: "super_admin_get_tenant",
    method: "GET",
    path: "/super-admin/tenants/:id",
    description: "Detalle de una empresa por id.",
    scopes: [],
    pathParams: { id: { type: "string" } },
  },
  {
    name: "super_admin_tenant_usage",
    method: "GET",
    path: "/super-admin/tenants/:id/usage",
    description: "Consumo/costo de una empresa en un rango de fechas.",
    scopes: [],
    pathParams: { id: { type: "string" } },
    query: { from: { type: "string", description: "Fecha ISO." }, to: { type: "string", description: "Fecha ISO." } },
  },
  {
    name: "super_admin_create_tenant",
    method: "POST",
    path: "/super-admin/tenants",
    description: "Da de alta una empresa nueva, con su primer OWNER (se le manda invitación por correo).",
    scopes: [],
    body: {
      name: { type: "string", required: true },
      slug: { type: "string", required: true, description: "Minúsculas, números y guion." },
      ownerEmail: { type: "string", required: true },
      ownerFullName: { type: "string", required: true },
    },
  },
  {
    name: "super_admin_update_tenant",
    method: "PATCH",
    path: "/super-admin/tenants/:id",
    description:
      "Renombra una empresa. Nota: el backend audita esto con el usuario en sesión; con una key global " +
      "(sin sesión humana) el actor de auditoría puede quedar vacío.",
    scopes: [],
    pathParams: { id: { type: "string" } },
    body: { name: { type: "string" } },
  },
  {
    name: "super_admin_update_tenant_status",
    method: "PATCH",
    path: "/super-admin/tenants/:id/status",
    description: "Activa o desactiva una empresa (DISABLED bloquea el acceso de todo su equipo).",
    scopes: [],
    destructiveHint: true,
    pathParams: { id: { type: "string" } },
    body: { status: { type: "string", required: true, enum: ["ACTIVE", "DISABLED"] } },
  },
  {
    name: "super_admin_invite_member",
    method: "POST",
    path: "/super-admin/tenants/:id/invitations",
    description: "Invita a alguien a una empresa con cualquier rol, incluido OWNER (el super-admin no tiene el límite de jerarquía de un admin normal).",
    scopes: [],
    pathParams: { id: { type: "string" } },
    body: {
      email: { type: "string", required: true },
      fullName: { type: "string", required: true },
      role: { type: "string", required: true, enum: ASSIGNABLE_ROLES },
    },
  },
  {
    name: "super_admin_revoke_invitation",
    method: "DELETE",
    path: "/super-admin/tenants/:id/invitations/:invitationId",
    description: "Cancela una invitación pendiente.",
    scopes: [],
    pathParams: { id: { type: "string" }, invitationId: { type: "string" } },
  },
  {
    name: "super_admin_update_membership",
    method: "PATCH",
    path: "/super-admin/tenants/:id/memberships/:membershipId",
    description: "Cambia el rol o el estado (ACTIVE/DISABLED) de un miembro de una empresa.",
    scopes: [],
    destructiveHint: true,
    pathParams: { id: { type: "string" }, membershipId: { type: "string" } },
    body: {
      role: { type: "string", enum: ASSIGNABLE_ROLES },
      status: { type: "string", enum: ["ACTIVE", "DISABLED"] },
    },
  },
  {
    name: "super_admin_remove_membership",
    method: "DELETE",
    path: "/super-admin/tenants/:id/memberships/:membershipId",
    description: "Quita a alguien de una empresa (lo pasa a DISABLED; no borra la fila).",
    scopes: [],
    pathParams: { id: { type: "string" }, membershipId: { type: "string" } },
  },
  {
    name: "super_admin_list_tenant_api_keys",
    method: "GET",
    path: "/super-admin/tenants/:id/api-keys",
    description: "Lista las API keys de una empresa concreta (mismo dato que vería el OWNER de esa empresa).",
    scopes: [],
    pathParams: { id: { type: "string" } },
  },
  {
    name: "super_admin_create_tenant_api_key",
    method: "POST",
    path: "/super-admin/tenants/:id/api-keys",
    description: "Emite una API key para una empresa concreta, con los scopes que se indiquen (soporte/onboarding en nombre del tenant).",
    scopes: [],
    pathParams: { id: { type: "string" } },
    body: {
      name: { type: "string", required: true },
      scopes: { type: "array", required: true, items: { type: "string" } },
      expiresInDays: { type: "number", description: "1 a 730." },
    },
  },
  {
    name: "super_admin_revoke_tenant_api_key",
    method: "DELETE",
    path: "/super-admin/tenants/:id/api-keys/:keyId",
    description: "Revoca una API key de una empresa concreta.",
    scopes: [],
    pathParams: { id: { type: "string" }, keyId: { type: "string" } },
  },
  {
    name: "super_admin_list_global_api_keys",
    method: "GET",
    path: "/super-admin/api-keys",
    description: "Lista las API keys globales (sin tenant, con todos los scopes) de la plataforma.",
    scopes: [],
  },
  {
    name: "super_admin_create_global_api_key",
    method: "POST",
    path: "/super-admin/api-keys",
    description:
      "Emite una nueva key global. Siempre lleva TODOS los scopes (no configurable) — es la master key de la " +
      "plataforma. El backend exige sesión de super-admin HUMANO para esto: una key global no puede emitir " +
      "más keys globales por sí sola, así que esta llamada falla con una key global y necesita sesión de panel.",
    scopes: [],
    body: {
      name: { type: "string", required: true },
      expiresInDays: { type: "number", description: "1 a 730. Sin esto, no vence." },
    },
  },
  {
    name: "super_admin_revoke_global_api_key",
    method: "DELETE",
    path: "/super-admin/api-keys/:id",
    description: "Revoca una key global. Mismo requisito de sesión humana que crearla.",
    scopes: [],
    pathParams: { id: { type: "string" } },
  },
];
