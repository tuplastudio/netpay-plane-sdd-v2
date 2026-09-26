import type { HelpCategory } from "./types";

export const plataforma: HelpCategory = {
  slug: "plataforma",
  title: "Plataforma (super-admin)",
  articles: [
    {
      slug: "dar-de-alta-una-empresa",
      title: "Dar de alta una nueva empresa",
      summary: "Nombre, slug y el correo de su primer OWNER — el resto lo hace la propia empresa.",
      audience: "super_admin",
      body: [
        {
          type: "steps",
          items: [
            "Plataforma → Empresas → Nueva empresa.",
            "Nombre, slug (solo minúsculas, números y guion) y datos del primer OWNER.",
            "Se le manda una invitación por correo a ese OWNER; al aceptarla, entra a operar su propia empresa.",
          ],
        },
        {
          type: "p",
          text: "Desde ahí, esa empresa ya se administra a sí misma — tú solo intervienes de nuevo si necesita soporte.",
        },
      ],
      related: ["administrar-una-empresa"],
    },
    {
      slug: "administrar-una-empresa",
      title: "Administrar una empresa desde Plataforma",
      summary: "Cambiar su estado, ver su detalle, gestionar invitaciones y membresías, y sus API keys.",
      audience: "super_admin",
      body: [
        {
          type: "p",
          text:
            "Desde Plataforma → Empresas → [una empresa] puedes: cambiar su estado (ACTIVE/DISABLED — " +
            "desactivarla bloquea el acceso de todo su equipo), invitar gente con cualquier rol (incluido " +
            "OWNER, sin la restricción de jerarquía que tiene un ADMIN normal), cambiar o quitar membresías, y " +
            "emitir o revocar API keys en su nombre.",
        },
        {
          type: "callout",
          tone: "warning",
          text: "Desactivar una empresa (DISABLED) le corta el acceso a todo su equipo de inmediato. Úsalo con cuidado.",
        },
      ],
      related: ["dar-de-alta-una-empresa", "impersonar-una-empresa"],
    },
    {
      slug: "impersonar-una-empresa",
      title: "Impersonar una empresa",
      summary: "Entra y opera el panel exactamente como su dueño, para dar soporte de primera mano.",
      audience: "super_admin",
      keywords: ["impersonación", "entrar como", "soporte a un tenant"],
      body: [
        {
          type: "p",
          text:
            "Impersonar te deja ver y usar el panel de esa empresa igual que su OWNER — útil para reproducir " +
            "un problema que reportan o para configurar algo por ellos. Todo lo que hagas mientras impersonas " +
            "queda auditado como tuyo, marcado explícitamente como impersonación (nunca se ve como si lo " +
            "hubiera hecho el dueño real).",
        },
        {
          type: "p",
          text: "Sales de la impersonación desde el mismo selector de empresa en la barra superior.",
        },
      ],
      related: ["administrar-una-empresa"],
    },
    {
      slug: "uso-y-costos-de-plataforma",
      title: "Uso y costos de toda la plataforma",
      summary: "Consumo del agente por empresa, y el detalle día × modelo de una en particular.",
      audience: "super_admin",
      body: [
        {
          type: "p",
          text:
            "Plataforma → Uso y costos agrega el consumo de todas las empresas; entrando al detalle de una ves " +
            "su desglose por día y por modelo de IA usado, para el rango que elijas.",
        },
      ],
    },
    {
      slug: "api-keys-globales",
      title: "API keys globales",
      summary: "Sin tenant fijo, con todos los permisos — cada llamada decide sobre qué empresa opera.",
      audience: "super_admin",
      keywords: ["key maestra", "master key", "cross-tenant"],
      body: [
        {
          type: "p",
          text:
            "Una API key global no pertenece a ninguna empresa: siempre lleva todos los permisos del sistema, " +
            "y quien la usa decide en cada llamada sobre cuál empresa actuar (con el header X-Tenant-Id). Sin " +
            "eso, solo alcanza rutas de plataforma (como esta misma sección).",
        },
        {
          type: "callout",
          tone: "warning",
          title: "Trátala como la llave maestra que es",
          text:
            "Cualquiera con esta key puede operar CUALQUIER empresa de la plataforma. Solo la creas o revocas " +
            "tú, con tu propia sesión — no se puede emitir otra key global usando una key global (para que una " +
            "sola fuga no se auto-replique). Úsala solo para soporte de plataforma o automatización " +
            "genuinamente cross-tenant; para todo lo demás, una key de empresa normal.",
        },
        {
          type: "p",
          text: "Se crea y revoca desde Plataforma → API keys globales.",
        },
      ],
      related: ["administrar-una-empresa", "conectar-por-mcp"],
    },
  ],
};
