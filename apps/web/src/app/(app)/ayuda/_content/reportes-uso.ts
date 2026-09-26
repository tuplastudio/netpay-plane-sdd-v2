import type { HelpCategory } from "./types";

export const reportesUso: HelpCategory = {
  slug: "reportes-uso",
  title: "Reportes y uso",
  articles: [
    {
      slug: "dashboard-y-resumen",
      title: "Dashboard y resumen de ventas",
      summary: "KPIs, actividad reciente y la serie de ventas de los últimos 7 días.",
      audience: "owner",
      body: [
        {
          type: "p",
          text:
            "El inicio del panel trae un resumen unificado: ventas, pedidos, conversaciones recientes y la " +
            "bitácora de cambios importantes, más una gráfica de 7 días para ver la tendencia de un vistazo.",
        },
      ],
    },
    {
      slug: "uso-y-costos",
      title: "Uso y costos del agente",
      summary: "Cuánto está consumiendo el agente de IA, por rango de fechas.",
      audience: "owner",
      body: [
        {
          type: "p",
          text:
            "Admin → Empresa incluye tu consumo de tokens/costo del agente en un rango de fechas — útil para " +
            "entender qué tanto se está usando el bot.",
        },
      ],
    },
  ],
};
