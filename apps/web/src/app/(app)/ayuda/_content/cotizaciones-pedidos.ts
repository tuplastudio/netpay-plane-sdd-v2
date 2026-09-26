import type { HelpCategory } from "./types";

export const cotizacionesPedidos: HelpCategory = {
  slug: "cotizaciones-pedidos",
  title: "Cotizaciones y pedidos",
  articles: [
    {
      slug: "crear-cotizacion",
      title: "Crear, emitir y compartir una cotización",
      summary: "El camino normal: armar el carrito, emitirla, y mandarle el link al cliente.",
      audience: "owner",
      body: [
        {
          type: "steps",
          items: [
            "Cotizaciones → Nueva. Elige el cliente y agrega líneas (variante, cantidad, descuento opcional).",
            "Guarda como borrador (DRAFT) o emítela de una vez (ISSUED) — al emitir se fijan los precios y se " +
              "pone fecha de vencimiento.",
            "Comparte: genera un link público que el cliente puede abrir sin cuenta, ver el detalle y pagar " +
              "directo desde ahí.",
          ],
        },
        {
          type: "callout",
          tone: "info",
          text:
            "El precio y la existencia que ve el cliente siempre salen del catálogo vigente al momento de " +
              "cotizar, nunca de un dato guardado de antes — si cambias el precio de un producto, las " +
              "cotizaciones ya emitidas no cambian, pero una nueva sí toma el precio actual.",
        },
        { type: "h3", text: "Estados de una cotización" },
        {
          type: "table",
          headers: ["Estado", "Qué significa"],
          rows: [
            ["DRAFT", "Borrador, se puede seguir editando."],
            ["ISSUED", "Emitida, precios fijos, tiene vigencia."],
            ["ACCEPTED", "El cliente la aceptó (o se pagó directo desde el link)."],
            ["CANCELLED", "Cancelada — ya no se puede aceptar ni pagar."],
            ["EXPIRED", "Venció sin que se aceptara."],
          ],
        },
      ],
      related: ["de-cotizacion-a-pedido"],
    },
    {
      slug: "de-cotizacion-a-pedido",
      title: "De cotización a pedido y cobro",
      summary: "Cómo se convierte una cotización aceptada en un pedido con checkout abierto.",
      audience: "owner",
      body: [
        {
          type: "p",
          text:
            "Cuando el cliente acepta una cotización (desde el link público o porque tú la marcas como " +
            "aceptada), se crea un pedido con esas mismas líneas. Desde el pedido abres el checkout — eso " +
            "genera un link de pago con vigencia (lo define tu configuración de \"minutos de reserva de " +
            "checkout\" en Admin → Empresa).",
        },
        {
          type: "h3", text: "Cobro rápido" },
        {
          type: "p",
          text:
            "Si no necesitas pasar por catálogo (un servicio, un ajuste, algo que no tienes dado de alta), usa " +
            "Cobro rápido: un concepto libre y un monto, y se abre el checkout directo. Trae una clave de " +
            "idempotencia para que reintentar la misma llamada no duplique el cobro.",
        },
      ],
      related: ["crear-cotizacion", "cancelaciones"],
    },
    {
      slug: "cancelaciones",
      title: "Cancelar una cotización o un pedido",
      summary: "Qué pasa al cancelar, y quién puede hacerlo.",
      audience: "owner",
      keywords: ["cancelación", "cancelar pedido", "cancelar cotización"],
      body: [
        {
          type: "p",
          text: "Cancelar una cotización la deja fuera de juego: ya no se puede aceptar ni pagar desde su link.",
        },
        {
          type: "p",
          text:
            "Cancelar un pedido depende de tu rol: por defecto solo puedes cancelar los pedidos que tú mismo " +
            "creaste (\"cancelar propios\"); OWNER y ADMIN pueden cancelar cualquiera de la empresa " +
            "(\"cancelar cualquiera\").",
        },
      ],
      related: ["de-cotizacion-a-pedido"],
    },
    {
      slug: "facturacion",
      title: "Pedir factura de un pedido",
      summary: "Datos fiscales que se piden y cómo se registran.",
      audience: "owner",
      keywords: ["factura", "facturar", "cfdi", "rfc"],
      body: [
        {
          type: "p",
          text:
            "Desde el pedido puedes registrar una solicitud de factura: RFC, razón social, código postal y " +
            "uso de CFDI. La cotización o el pedido en sí no son un comprobante fiscal — esto solo deja la " +
            "solicitud lista para que factures por tu propio sistema.",
        },
      ],
    },
  ],
};
