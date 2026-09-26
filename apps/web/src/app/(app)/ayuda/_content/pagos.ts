import type { HelpCategory } from "./types";

export const pagos: HelpCategory = {
  slug: "pagos",
  title: "Pagos",
  articles: [
    {
      slug: "sesiones-y-libro-de-pagos",
      title: "Sesiones de pago y libro de movimientos",
      summary: "Dónde ver qué se cobró, cuándo, y el detalle de cada sesión.",
      audience: "owner",
      body: [
        {
          type: "p",
          text:
            "Cada vez que se abre un checkout se crea una sesión de pago. Pagos → Sesiones lista todas; el " +
            "libro (ledger) muestra los movimientos — cargos y reembolsos — de una sesión en particular.",
        },
      ],
      related: ["reembolsos"],
    },
    {
      slug: "reembolsos",
      title: "Reembolsar un pago",
      summary: "Total o parcial, sobre una sesión ya capturada.",
      audience: "owner",
      keywords: ["reembolso", "devolución", "devolver dinero"],
      body: [
        {
          type: "p",
          text:
            "Desde una sesión de pago capturada puedes reembolsar el total o una parte. El monto nunca puede " +
            "exceder lo que se capturó originalmente.",
        },
        {
          type: "callout",
          tone: "warning",
          text: "Requiere el permiso \"reembolsar pagos\" — por defecto solo lo tienen OWNER y FINANCE, no VENDOR.",
        },
      ],
      related: ["sesiones-y-libro-de-pagos"],
    },
  ],
};
