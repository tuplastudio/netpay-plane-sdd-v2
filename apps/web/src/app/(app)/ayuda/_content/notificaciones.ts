import type { HelpCategory } from "./types";

export const notificaciones: HelpCategory = {
  slug: "notificaciones",
  title: "Notificaciones",
  articles: [
    {
      slug: "recordatorios-de-cotizacion",
      title: "Recordatorios de cotización sin pagar",
      summary: "El sistema le recuerda solo al cliente que le falta pagar, sin que tengas que hacerlo tú.",
      audience: "owner",
      body: [
        {
          type: "p",
          text:
            "Si una cotización emitida no se paga, el sistema puede mandar recordatorios automáticos por " +
            "WhatsApp o correo. Configúralo en Admin → Empresa: si están activos, cada cuántas horas, y cuántos " +
            "como máximo.",
        },
      ],
    },
    {
      slug: "plantillas-de-whatsapp",
      title: "Plantillas de WhatsApp",
      summary: "Fuera de la ventana de 24 h de Meta, solo se puede mandar una plantilla ya aprobada.",
      audience: "owner",
      body: [
        {
          type: "p",
          text:
            "WhatsApp (Meta) solo permite texto libre dentro de las 24 horas siguientes al último mensaje del " +
            "cliente. Pasado ese plazo, hay que usar una plantilla previamente aprobada por Meta. Admin → " +
            "Notificaciones → Plantillas es donde mapeas cada tipo de aviso (link de cotización, recordatorio, " +
            "pedido recibido) a la plantilla aprobada correspondiente.",
        },
      ],
    },
  ],
};
