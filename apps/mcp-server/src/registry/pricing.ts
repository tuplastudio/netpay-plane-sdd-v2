import type { RouteDef } from "./types.js";
import { quoteLineFields } from "./quotes.js";

export const pricingRoutes: RouteDef[] = [
  {
    name: "pricing_preview",
    method: "POST",
    path: "/pricing/preview",
    description:
      "Calcula precios y totales de un carrito sin crear nada (fuente oficial de totales, la misma que usa el " +
      "agente antes de cotizar). Para LOCAL_DELIVERY, con postalCode/city/state resuelve la zona de envío del " +
      "tenant y ajusta el envío; sin esos datos usa la tarifa plana del tenant.",
    scopes: ["quotes.read"],
    body: {
      lines: { type: "array", required: true, items: { type: "object", fields: quoteLineFields } },
      deliveryMode: { type: "string", enum: ["PICKUP", "LOCAL_DELIVERY"], description: "Default PICKUP." },
      postalCode: { type: "string" },
      city: { type: "string" },
      state: { type: "string" },
    },
  },
];
