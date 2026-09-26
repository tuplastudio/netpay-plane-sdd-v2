import type { HelpCategory } from "./types";

export const apiKeysMcp: HelpCategory = {
  slug: "api-keys-mcp",
  title: "API keys y MCP",
  articles: [
    {
      slug: "api-keys-de-empresa",
      title: "API keys de tu empresa",
      summary: "Credenciales para que un sistema externo (o un agente) hable con tu cuenta sin usar tu sesión.",
      audience: "owner",
      body: [
        {
          type: "p",
          text:
            "Una API key da acceso a tu empresa sin necesidad de iniciar sesión. Se crea con los permisos " +
            "(scopes) que tú elijas — solo puede hacer lo que esos permisos autoricen, todo lo demás lo rechaza " +
            "el sistema.",
        },
        {
          type: "steps",
          items: [
            "Admin → API keys → Nueva API key.",
            "Nombre para identificarla, permisos, y vigencia opcional.",
            "El secreto (npk_...) se muestra una sola vez — cópialo antes de cerrar la ventana.",
          ],
        },
        {
          type: "callout",
          tone: "warning",
          text: "Si pierdes el secreto no se puede recuperar: revoca esa key y crea una nueva.",
        },
      ],
      related: ["conectar-por-mcp"],
    },
    {
      slug: "conectar-por-mcp",
      title: "Conectar por MCP (Claude u otro agente)",
      summary: "Un botón crea la key recomendada y te da el comando de instalación con el secreto ya puesto.",
      audience: "owner",
      body: [
        {
          type: "p",
          text:
            "MCP (Model Context Protocol) deja que Claude, o cualquier agente compatible, use tu catálogo, " +
            "clientes, cotizaciones, pedidos y conversaciones como herramientas — como si tú se lo estuvieras " +
            "dictando, pero automatizado.",
        },
        {
          type: "steps",
          items: [
            "Admin → API keys → sección \"Conectar por MCP\".",
            "Clic en \"Generar API key y conectar\": crea una key con permisos recomendados (lectura y " +
              "escritura del flujo comercial, sin reembolsos ni administración).",
            "Copia el comando que aparece (para Claude Code, Claude Desktop, u otro cliente) — ya trae tu " +
              "secreto insertado.",
            "Pégalo donde corresponda y listo: tu agente ya puede consultar y operar tu cuenta.",
          ],
        },
        {
          type: "callout",
          tone: "info",
          text:
            "¿Necesitas otros permisos (reembolsos, integraciones)? Crea la key a mano en la sección de abajo " +
            "con los scopes que quieras, y úsala igual en el mismo comando.",
        },
      ],
      related: ["api-keys-de-empresa"],
    },
  ],
};
