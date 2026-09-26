import type { HelpCategory } from "./types";

export const whatsapp: HelpCategory = {
  slug: "whatsapp",
  title: "WhatsApp y conversaciones",
  articles: [
    {
      slug: "conectar-whatsapp",
      title: "Conectar WhatsApp",
      summary: "Dos formas: Meta (WhatsApp Business API oficial) o Evolution (por QR, más rápido de arrancar).",
      audience: "owner",
      keywords: ["qr", "vincular whatsapp", "canal"],
      body: [
        {
          type: "p",
          text:
            "Canales → Conectar. Con Evolution, el panel genera una instancia y un código QR: lo escaneas " +
            "desde WhatsApp en tu teléfono (Ajustes → Dispositivos vinculados) y queda activo en minutos. " +
            "Meta requiere una cuenta de WhatsApp Business API ya aprobada por Meta.",
        },
        {
          type: "callout",
          tone: "info",
          text:
            "El QR de Evolution rota cada ~60 segundos si no lo escaneas a tiempo — el panel lo refresca solo, " +
            "no hace falta recargar la página.",
        },
      ],
      related: ["bandeja-de-conversaciones"],
    },
    {
      slug: "bandeja-de-conversaciones",
      title: "Bandeja de conversaciones",
      summary: "Filtrar, tomar un hilo, transferir a una persona y devolverlo al agente.",
      audience: "owner",
      body: [
        {
          type: "p",
          text:
            "Conversaciones lista todos los hilos con filtros (estado, quién lo atiende, etiqueta, fecha). Cada " +
            "hilo puede estar en manos del agente automático o de una persona.",
        },
        {
          type: "h3", text: "Tomar un hilo" },
        {
          type: "p",
          text:
            "\"Tomar\" saca el hilo de la cola sin asignar y te lo pone a ti. \"Transferir\" se lo pasa a otra " +
            "persona del equipo (el agente deja de responder ahí). \"Devolver al agente\" hace lo contrario: " +
            "el bot retoma la conversación.",
        },
        {
          type: "h3", text: "Notas internas" },
        {
          type: "p",
          text:
            "Puedes dejar notas en un hilo completo o sobre un mensaje puntual — el cliente nunca las ve, son " +
            "para coordinarte con tu equipo.",
        },
      ],
      related: ["el-agente-automatico", "conectar-whatsapp"],
    },
    {
      slug: "el-agente-automatico",
      title: "Qué hace el agente automático",
      summary: "Cotiza con el catálogo real, nunca inventa precios, y sabe cuándo pasarte el hilo.",
      audience: "owner",
      body: [
        {
          type: "p",
          text:
            "El agente contesta con lo que de verdad hay en tu catálogo (precio y existencia), arma " +
            "cotizaciones, genera links de pago, y responde preguntas del negocio con lo que hayas cargado en " +
            "Consola del agente → Conocimiento.",
        },
        {
          type: "callout",
          tone: "warning",
          title: "Cuándo escala a una persona",
          text:
            "El agente pasa el hilo a un humano cuando el cliente pide expresamente hablar con alguien, se " +
            "queja, o pide precio especial / crédito — no lo hace solo porque algo falló técnicamente una vez; " +
            "para eso reintenta antes de rendirse.",
        },
        {
          type: "p",
          text:
            "Puedes probar cómo respondería sin arriesgar una conversación real desde \"Chat con el agente\" — " +
            "es el mismo bot, en un hilo de prueba tuyo.",
        },
      ],
      related: ["bandeja-de-conversaciones"],
    },
  ],
};
