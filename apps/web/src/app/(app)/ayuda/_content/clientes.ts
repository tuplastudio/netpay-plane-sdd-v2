import type { HelpCategory } from "./types";

export const clientes: HelpCategory = {
  slug: "clientes",
  title: "Clientes",
  articles: [
    {
      slug: "fichas-de-cliente",
      title: "Fichas de cliente",
      summary: "Datos de contacto, direcciones, consentimientos e historial de cotizaciones y pedidos.",
      audience: "owner",
      body: [
        {
          type: "p",
          text:
            "Cada cliente tiene nombre, correo y teléfono opcionales, RFC opcional, hasta 20 direcciones, y un " +
            "historial de todo lo que se le ha cotizado o vendido. Cuando alguien te escribe por primera vez " +
            "por WhatsApp, el agente crea la ficha automáticamente ligada a esa conversación.",
        },
        {
          type: "h3", text: "Consentimientos",
        },
        {
          type: "p",
          text:
            "Se registran tres tipos: WHATSAPP, MARKETING y DATA_PROCESSING. Sirven para llevar constancia de " +
            "qué autorizó el cliente; puedes otorgarlos o revocarlos desde su ficha.",
        },
        {
          type: "callout",
          tone: "info",
          text:
            "Un cliente archivado no se borra, solo queda oculto de las listas por defecto — su historial sigue " +
            "intacto y se puede reactivar cuando haga falta.",
        },
      ],
    },
  ],
};
