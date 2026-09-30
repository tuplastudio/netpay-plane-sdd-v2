import type { RouteDef } from "./types.js";

/**
 * IAM del tenant: gestión de API keys, invitaciones y membresías
 * (`/iam/*`). Cubre todo lo que un admin necesita para dar/quitar acceso
 * a personas y a integraciones.
 *
 * `Assignable roles` se mantiene en sync con `apps/commerce-api/src/auth/membership.service.ts`
 * (el backend lo lee del mismo lugar).
 *
 * IMPORTANTE: muchos de estos endpoints son SESSION-ONLY (el backend
 * rechaza API keys con `!userId`). Las marqué igual en el scope para que
 * el cliente MCP sepa que existen, pero la descripción lo aclara — si la
 * key intenta llamarlos, va a recibir un 403 con un mensaje útil, no un
 * stack trace. Las tres tools que sí funcionan con API key son
 * `iam_list_api_keys`, `iam_revoke_api_key` (apikeys.manage, funcionan
 * con API key) y el resto son session-only.
 */
const ASSIGNABLE_ROLES = ["OWNER", "ADMIN", "VENDOR", "FINANCE", "CATALOG", "SUPPORT", "VIEWER"] as const;

export const iamRoutes: RouteDef[] = [
  // --- API keys del propio tenant ---
  {
    name: "iam_list_api_keys",
    method: "GET",
    path: "/iam/api-keys",
    description:
      "Lista las API keys del propio tenant (id, name, scopes, expira, última vez usada). " +
      "La key completa (npk_...) solo se devuelve una vez al crearla. Funciona con API key " +
      "(scope apikeys.manage).",
    scopes: ["apikeys.manage"],
  },
  {
    name: "iam_create_api_key",
    method: "POST",
    path: "/iam/api-keys",
    description:
      "Crea una API key para el propio tenant con los scopes indicados. **SESSION-ONLY**: " +
      "el backend exige `RequestContext.userId`; una API key sola no puede crear otra key " +
      "(sería un canal de escalada de privilegios). Hazlo desde el panel del tenant. La key " +
      "completa (npk_...) solo se devuelve en esta respuesta — guárdala.",
    scopes: ["apikeys.manage"],
    destructiveHint: true,
    body: {
      name: { type: "string", required: true },
      scopes: { type: "array", required: true, items: { type: "string" }, description: "Lista de scopes del catálogo de policies." },
      expiresInDays: { type: "number", description: "1 a 730. Sin esto, no vence." },
    },
  },
  {
    name: "iam_revoke_api_key",
    method: "DELETE",
    path: "/iam/api-keys/:id",
    description: "Revoca una API key del propio tenant. Funciona con API key (apikeys.manage).",
    scopes: ["apikeys.manage"],
    destructiveHint: true,
    pathParams: { id: { type: "string" } },
  },
  // --- Invitaciones ---
  {
    name: "iam_invite_user",
    method: "POST",
    path: "/iam/invitations",
    description:
      "Invita a alguien al tenant con un rol. **SESSION-ONLY**: el backend exige usuario en " +
      "sesión. Además, `assertCanGrantRole` rechaza授予 OWNER desde una API key. " +
      "Desde el panel del tenant o con sesión humana.",
    scopes: ["users.invite"],
    body: {
      email: { type: "string", required: true, description: "Correo del invitado." },
      fullName: { type: "string", required: true },
      role: { type: "string", required: true, enum: [...ASSIGNABLE_ROLES] },
    },
  },
  {
    name: "iam_revoke_invitation",
    method: "DELETE",
    path: "/iam/invitations/:id",
    description: "Cancela una invitación pendiente. **SESSION-ONLY**.",
    scopes: ["users.manage"],
    pathParams: { id: { type: "string" } },
  },
  // --- Membresías ---
  {
    name: "iam_list_memberships",
    method: "GET",
    path: "/iam/memberships",
    description: "Lista los miembros del tenant con su rol y status. **SESSION-ONLY**.",
    scopes: ["users.manage"],
  },
  {
    name: "iam_change_role",
    method: "PATCH",
    path: "/iam/memberships/:id",
    description:
      "Cambia el rol de un miembro. **SESSION-ONLY**. El backend valida que el actor pueda " +
      "otorgar el rol objetivo (no puedes ascender a alguien por encima de ti).",
    scopes: ["users.manage"],
    pathParams: { id: { type: "string" } },
    body: { role: { type: "string", required: true, enum: [...ASSIGNABLE_ROLES] } },
  },
  {
    name: "iam_set_agent_flag",
    method: "PATCH",
    path: "/iam/memberships/:id/agent",
    description:
      "Marca/desmarca al miembro como agente humano de WhatsApp (lo incluye en `conversations_list_agents` " +
      "y le permite tomar hilos con `conversations_claim`). **SESSION-ONLY**.",
    scopes: ["users.manage"],
    pathParams: { id: { type: "string" } },
    body: { isAgent: { type: "boolean", required: true } },
  },
  {
    name: "iam_remove_membership",
    method: "DELETE",
    path: "/iam/memberships/:id",
    description:
      "Pasa al miembro a DISABLED (no borra la fila; preserva el historial de auditoría). " +
      "**SESSION-ONLY**.",
    scopes: ["users.manage"],
    destructiveHint: true,
    pathParams: { id: { type: "string" } },
  },
];