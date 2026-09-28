import type { HelpCategory } from "./types";

export const reportesUso: HelpCategory = {
  slug: "reportes-uso",
  title: "Reportes y uso",
  articles: [
    {
      slug: "dashboard-y-resumen",
      title: "Inicio: tu resumen de ventas",
      summary:
        "La primera pantalla al entrar: cuánto cobraste, qué está por pagar, cotizaciones, conversaciones y la tendencia de ventas de los últimos 7 días.",
      audience: "owner",
      keywords: ["inicio", "dashboard", "panel principal", "kpi", "resumen", "gráfica", "ventas del día"],
      body: [
        {
          type: "p",
          text:
            "Inicio junta los números más importantes de tu negocio en una sola pantalla. En pocos segundos " +
            "sabes cómo vas sin entrar a varias secciones. Los números se actualizan solos.",
        },
        { type: "h3", text: "Panorama" },
        {
          type: "table",
          headers: ["Tarjeta", "Qué muestra"],
          rows: [
            ["Cobrado (neto)", "Lo cobrado menos lo reembolsado."],
            ["Por pagar", "El dinero de pedidos que ya tienen link de pago y el cliente todavía no paga."],
            ["Cotizaciones emitidas", "Cuántas cotizaciones emitidas esperan respuesta del cliente."],
            ["Productos activos", "Productos a la venta en tu catálogo."],
            ["Conversaciones abiertas", "Conversaciones de WhatsApp en curso, con el agente o con una persona."],
            ["Ventas cobradas hoy / del mes", "El dinero de pedidos pagados o entregados, hoy y en el mes."],
            ["Pedidos hoy", "Cuántos pedidos se crearon hoy, y abajo cuántos van en el mes."],
            ["Clientes totales", "Cuántas fichas de cliente tienes, y cuántas nuevas hoy."],
          ],
        },
        { type: "h3", text: "Debajo del panorama" },
        {
          type: "list",
          items: [
            "Ventas cobradas · últimos 7 días: una barra por día con el total de pedidos pagados o " +
              "entregados. Sirve para ver si vas subiendo o bajando.",
            "Acciones rápidas: atajos a lo que más se usa, como probar el agente o crear una cotización.",
            "Pedidos recientes: los últimos 5 pedidos. \"Ver todos\" abre Pedidos.",
            "Conversaciones recientes: los últimos chats con actividad. \"Ver bandeja\" abre Conversaciones.",
            "Actividad reciente: los últimos cambios registrados en tu empresa (quién hizo qué).",
          ],
        },
        {
          type: "p",
          text:
            "Ejemplo: si tienes una taquería y entras un lunes en la mañana, con ver la gráfica sabes si el " +
            "fin de semana vendiste más o menos, sin sumar nada a mano.",
        },
        {
          type: "callout",
          tone: "info",
          text:
            "Si apenas empezaste, es normal ver ceros. Los números se llenan conforme recibes pedidos y " +
            "conversaciones.",
        },
      ],
      related: ["uso-y-costos", "recorrido-del-panel"],
    },
    {
      slug: "uso-y-costos",
      title: "Uso y costos del agente",
      summary:
        "Cuánto está costando el agente de inteligencia artificial este mes, medido en tokens y en dólares, con el detalle por modelo.",
      audience: "owner",
      keywords: ["tokens", "costo", "modelo de ia", "consumo", "gasto", "openrouter"],
      body: [
        {
          type: "p",
          text:
            "El agente usa un modelo de inteligencia artificial. Cada vez que lee un mensaje y escribe una " +
            "respuesta, ese trabajo tiene un costo, igual que una llamada telefónica cuesta aunque no lo veas " +
            "en el momento.",
        },
        {
          type: "p",
          text:
            "El costo se mide en tokens: pedazos de palabras en los que el modelo divide el texto. Un mensaje " +
            "corto (\"¿tienen pintura blanca?\") usa pocos tokens. Una conversación de veinte mensajes, fotos " +
            "o videos usa muchos más. Más tokens = más costo.",
        },
        {
          type: "p",
          text:
            "El costo se muestra en dólares (USD), porque así cobran los proveedores de modelos de " +
            "inteligencia artificial, aunque tu negocio venda en pesos.",
        },
        { type: "h3", text: "Dónde verlo" },
        {
          type: "steps",
          items: [
            "Ve a Admin → Empresa.",
            "Busca la sección \"Uso y costo del agente\".",
            "Arriba ves el costo estimado del mes en curso y el total de tokens (entrada + salida).",
            "Abajo, la tabla \"Consumo del agente por modelo\" muestra, por cada modelo: turnos (respuestas), " +
              "tokens de entrada, tokens de salida y costo.",
          ],
        },
        {
          type: "callout",
          tone: "info",
          text:
            "El costo es una estimación del panel. El cobro real lo hace el proveedor del modelo " +
            "(OpenRouter). Si guardaste tu propia OpenRouter key en la configuración del agente, ese cobro " +
            "llega a tu cuenta de OpenRouter.",
        },
        {
          type: "faq",
          items: [
            {
              q: "Un día el costo subió mucho. ¿Algo está fallando?",
              a:
                "Normalmente no. Lo común es que hubo más conversaciones que de costumbre (por ejemplo, una " +
                "promoción) o conversaciones muy largas, con muchas fotos o videos. Revisa las conversaciones " +
                "de ese día.",
            },
            {
              q: "¿Cómo bajo el costo?",
              a:
                "En Consola del agente → General: elige un modelo más económico, baja \"Máx. tokens por " +
                "respuesta\", baja \"Máx. opciones por mensaje\" y deja apagada la revisión de respuestas del " +
                "equipo si no la necesitas. Prueba en Chat con el agente que las respuestas sigan siendo " +
                "buenas.",
            },
            {
              q: "¿Las conversaciones que atiende una persona cuestan?",
              a:
                "Lo que escribe una persona no usa el modelo, salvo que actives \"Revisar las respuestas del " +
                "equipo antes de enviarlas\": en ese caso, cada mensaje revisado cuesta una consulta pequeña.",
            },
            {
              q: "No veo la sección de uso.",
              a:
                "Está en Admin → Empresa y solo la ven personas con acceso a la administración de la " +
                "empresa. Si no la ves, pide acceso al Propietario.",
            },
          ],
        },
      ],
      related: ["dashboard-y-resumen", "configurar-el-agente"],
    },
  ],
};
