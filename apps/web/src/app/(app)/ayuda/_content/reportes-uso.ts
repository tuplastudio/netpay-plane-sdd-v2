import type { HelpCategory } from "./types";

export const reportesUso: HelpCategory = {
  slug: "reportes-uso",
  title: "Reportes y uso",
  articles: [
    {
      slug: "dashboard-y-resumen",
      title: "Dashboard y resumen de ventas",
      summary:
        "La primera pantalla que ves al entrar: KPIs de tu negocio, actividad reciente y la tendencia de " +
        "ventas de los últimos 7 días, todo de un vistazo.",
      audience: "owner",
      keywords: ["inicio", "panel principal", "kpi", "resumen", "gráfica"],
      body: [
        {
          type: "p",
          text:
            "Cuando entras a Easy Sell, la primera pantalla que ves (el dashboard, o \"panel principal\") no te " +
            "obliga a buscar nada: te junta de una vez los números más importantes de tu negocio, para que en " +
            "unos segundos sepas cómo vas, sin tener que entrar a varias secciones distintas.",
        },
        {
          type: "list",
          items: [
            "Ventas: cuánto dinero has vendido, normalmente en el periodo reciente.",
            "Pedidos: cuántas ventas se han cerrado como pedidos formales, no solo cotizaciones o mensajes " +
              "sueltos.",
            "Conversaciones recientes: los últimos mensajes de WhatsApp que tu agente de inteligencia " +
              "artificial ha atendido, para que veas de un vistazo si hay algo que necesita tu atención.",
            "Bitácora de cambios importantes: un registro de eventos relevantes de tu cuenta (por ejemplo, " +
              "cambios de configuración), para que no se te pase nada.",
            "Gráfica de 7 días: una línea o barra que muestra cómo se han movido tus ventas día por día durante " +
              "la última semana, para notar de inmediato si vas subiendo, bajando, o estable.",
          ],
        },
        {
          type: "p",
          text:
            "Ejemplo: si tienes una taquería y entras un lunes en la mañana, con solo ver esta pantalla puedes " +
            "saber si el fin de semana vendiste más o menos que la semana anterior, sin tener que sumar nada a " +
            "mano ni entrar a un reporte aparte.",
        },
        {
          type: "callout",
          tone: "info",
          text:
            "Si apenas empezaste a usar Easy Sell, es normal que estos números aparezcan en cero o casi vacíos " +
            "los primeros días — no es un error, simplemente todavía no hay suficiente actividad registrada. " +
            "Se van a llenar solos a medida que recibas pedidos y conversaciones.",
        },
      ],
    },
    {
      slug: "uso-y-costos",
      title: "Uso y costos del agente",
      summary:
        "Cuánto está costando el agente de inteligencia artificial que atiende tus WhatsApp, medido en tokens " +
        "y en dólares, para el rango de fechas que elijas.",
      audience: "owner",
      keywords: ["tokens", "costo", "modelo de ia", "consumo", "gasto"],
      body: [
        {
          type: "p",
          text:
            "El agente de Easy Sell que contesta tus WhatsApp está construido sobre un modelo de inteligencia " +
            "artificial. Cada vez que ese modelo lee un mensaje de un cliente y escribe una respuesta, hace un " +
            "trabajo que tiene un costo real — igual que hacer una llamada telefónica tiene un costo, aunque no " +
            "lo veas directamente cuando hablas.",
        },
        {
          type: "p",
          text:
            "Ese costo se mide en tokens: son los fragmentos en los que el modelo divide el texto para " +
            "procesarlo (aproximadamente, pedazos de palabras). Mientras más largo sea un mensaje, o mientras " +
            "más mensajes se intercambien en una conversación, más tokens se usan. Más tokens significa más " +
            "costo. Por ejemplo, un cliente que manda un mensaje corto (\"¿tienen pintura blanca?\") consume " +
            "muchos menos tokens que uno que manda un párrafo largo describiendo lo que busca, o una " +
            "conversación de veinte mensajes de ida y vuelta.",
        },
        {
          type: "p",
          text:
            "Esta sección te muestra ese consumo traducido a dinero: el costo se reporta en dólares (USD), " +
            "porque así es como se facturan internacionalmente los modelos de inteligencia artificial que usa " +
            "el agente, sin importar que tu negocio venda y cobre en pesos.",
        },
        {
          type: "h3",
          text: "Dónde verlo",
        },
        {
          type: "steps",
          items: [
            "Ve a Admin → Empresa.",
            "Busca la sección \"Uso y costo del agente\".",
            "Elige el rango de fechas que quieras revisar (por ejemplo, el mes en curso, o la semana pasada).",
            "Revisa el total de tokens consumidos y el costo correspondiente en ese rango.",
          ],
        },
        {
          type: "callout",
          tone: "info",
          text:
            "Solo las personas con permisos de administración de tu empresa pueden ver esta sección — no " +
            "aparece para cualquier miembro del equipo, porque es información sobre el gasto del negocio.",
        },
        {
          type: "callout",
          tone: "info",
          text:
            "Si un día ves un salto grande en el costo, no significa que algo esté fallando. Las causas más " +
            "comunes son: hubo muchas más conversaciones que lo normal ese día (por ejemplo, una promoción " +
            "trajo muchos clientes nuevos), o algunas conversaciones fueron inusualmente largas. Revisa las " +
            "conversaciones recientes de ese día para entender de dónde vino el consumo.",
        },
      ],
    },
  ],
};
