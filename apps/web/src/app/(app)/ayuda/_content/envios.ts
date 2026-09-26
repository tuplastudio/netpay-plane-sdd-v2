import type { HelpCategory } from "./types";

export const envios: HelpCategory = {
  slug: "envios",
  title: "Envío a domicilio",
  articles: [
    {
      slug: "zonas-de-envio",
      title: "Configurar zonas de envío",
      summary: "Cobra distinto según código postal, ciudad o estado del cliente.",
      audience: "owner",
      body: [
        {
          type: "p",
          text:
            "Una zona de envío se define por códigos postales, un patrón de ciudad, un estado, o ninguno de " +
            "los tres (esa es la zona \"catch-all\": solo puede haber una por empresa, y es la que aplica " +
            "cuando ninguna otra zona coincide).",
        },
        {
          type: "p",
          text:
            "Cuando un cliente da su dirección (por chat o en el checkout), el sistema resuelve automáticamente " +
            "qué zona le toca y ajusta el costo de envío en la cotización. Sin dirección, se usa la tarifa " +
            "plana de tu empresa (Admin → Empresa).",
        },
        {
          type: "callout",
          tone: "info",
          text: "Cada cambio de precio o zona queda en la bitácora de auditoría, por si un cliente reclama lo que se le cobró de envío.",
        },
      ],
    },
  ],
};
