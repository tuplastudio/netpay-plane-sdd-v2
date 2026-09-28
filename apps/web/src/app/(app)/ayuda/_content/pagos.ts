import type { HelpCategory } from "./types";

export const pagos: HelpCategory = {
  slug: "pagos",
  title: "Pagos",
  articles: [
    {
      slug: "sesiones-y-libro-de-pagos",
      title: "Sesiones de pago y libro de movimientos",
      summary:
        "Dónde ver qué se cobró, cuándo, y el detalle de cada sesión: sus estados y cada movimiento (cargo o reembolso) que la compone.",
      audience: "owner",
      keywords: ["sesión de pago", "ledger", "libro de movimientos", "estado de pago"],
      body: [
        {
          type: "p",
          text:
            "Cada vez que se abre un checkout se crea una sesión de pago. Pagos → Sesiones lista todas; el " +
            "libro (ledger) muestra los movimientos — cargos y reembolsos — de una sesión en particular.",
        },
        {
          type: "p",
          text:
            "Una sesión de pago es, en resumen, un intento de cobro con un monto y una moneda definidos, " +
            "ligado siempre a un pedido. Por ejemplo, si en tu boutique un pedido de $850 se paga de una " +
            "sola vez, ese pedido tiene una sesión con un monto de $850. Si después reembolsas $200 porque " +
            "el cliente devolvió una prenda, esa misma sesión sigue existiendo, pero ahora tiene también un " +
            "movimiento de reembolso en su libro.",
        },
        { type: "h3", text: "Estados de una sesión de pago" },
        {
          type: "table",
          headers: ["Estado en el sistema", "Lo que ves en el panel", "Qué significa"],
          rows: [
            ["PENDING", "Pendiente", "El checkout está abierto pero el cliente todavía no ha completado el pago."],
            [
              "CAPTURED",
              "Cobrado",
              "El pago se completó y el dinero quedó cobrado. Desde aquí ya se puede reembolsar.",
            ],
            [
              "PARTIALLY_REFUNDED",
              "Reembolso parcial",
              "Se cobró y después se devolvió una parte, pero no el total. Todavía se puede reembolsar el resto.",
            ],
            [
              "REFUNDED",
              "Reembolsado",
              "Se devolvió el 100% de lo cobrado. Ya no admite más reembolsos porque no queda saldo.",
            ],
          ],
        },
        { type: "h3", text: "Qué es el libro (ledger) de una sesión" },
        {
          type: "p",
          text:
            "El libro de movimientos es la lista de todo lo que le pasó al dinero de esa sesión, en orden, " +
            "como una minicontabilidad de ese cobro. Cada movimiento (llamado \"entrada\" o \"entry\") tiene " +
            "un tipo, un monto, una descripción, y el saldo que queda después de ese movimiento.",
        },
        {
          type: "table",
          headers: ["Tipo de movimiento", "Qué representa"],
          rows: [
            ["Cargo", "Dinero que entró: el cobro original al cliente."],
            ["Reembolso", "Dinero que salió: una devolución total o parcial sobre ese cargo."],
          ],
        },
        {
          type: "callout",
          tone: "info",
          text:
            "El saldo que queda vivo en una sesión siempre es el monto cobrado menos la suma de todos los " +
            "reembolsos hechos sobre ella. Si por alguna razón el número no te cuadra al revisar el libro, " +
            "revisa que no haya dos reembolsos hechos casi al mismo tiempo por dos personas distintas — el " +
            "sistema no permite que la suma de reembolsos pase del monto cobrado, así que si ves un " +
            "reembolso rechazado, probablemente ya se había reembolsado esa parte segundos antes.",
        },
        {
          type: "p",
          text:
            "Puedes revisar el libro de movimientos tanto desde Pagos → Sesiones (buscando la sesión " +
            "correspondiente) como desde el detalle del pedido asociado, en la sección de Pagos de esa " +
            "pantalla.",
        },
      ],
      related: ["reembolsos"],
    },
    {
      slug: "reembolsos",
      title: "Reembolsar un pago",
      summary:
        "Total o parcial, sobre una sesión ya capturada: cómo hacerlo, qué permiso necesitas, y qué información tienes que dar.",
      audience: "owner",
      keywords: ["reembolso", "devolución", "devolver dinero", "motivo del reembolso", "payments.refund"],
      body: [
        {
          type: "p",
          text:
            "Un reembolso es devolverle al cliente parte o todo el dinero que ya pagó por un pedido. Por " +
            "ejemplo: en una tienda de ropa, un cliente pagó $600 por dos playeras y luego te avisa que una " +
            "le quedó chica y ya no la quiere. Le reembolsas $300 (el precio de esa playera) y se queda con " +
            "la otra. Eso es un reembolso parcial. Si en cambio decide devolver las dos, reembolsas los $600 " +
            "completos: un reembolso total.",
        },
        {
          type: "p",
          text:
            "Desde una sesión de pago capturada puedes reembolsar el total o una parte. El monto nunca puede " +
            "exceder lo que se capturó originalmente.",
        },
        { type: "h3", text: "Dónde se hace" },
        {
          type: "list",
          items: [
            "Desde Pagos → Sesiones: busca la sesión (aparece como \"Cobrado\" o \"Reembolso parcial\" en " +
              "la columna de estado) y usa el botón \"Reembolsar\".",
            "Desde el detalle del pedido: en la sección de pagos de ese pedido también hay un botón " +
              "\"Reembolsar\" — es útil cuando ya estás viendo el pedido completo y no quieres buscar la " +
              "sesión por separado.",
          ],
        },
        { type: "h3", text: "Qué te va a pedir" },
        {
          type: "steps",
          items: [
            "El monto a reembolsar. Puede ser el total capturado, o menos (reembolso parcial). No puedes " +
              "escribir un monto mayor a lo que queda disponible en esa sesión.",
            "El motivo: un campo de texto donde explicas por qué se reembolsa (por ejemplo \"cliente " +
              "devolvió producto\", \"error en el cobro\", \"cancelación acordada\"). Este motivo se guarda " +
              "junto con el movimiento, para que después, si alguien revisa el libro de movimientos, " +
              "entienda por qué salió ese dinero sin tener que preguntarte.",
            "Confirmas en el cuadro de diálogo que aparece antes de aplicar el reembolso — esto es a " +
              "propósito, para que no se reembolse nada por accidente con un clic de más.",
          ],
        },
        {
          type: "callout",
          tone: "warning",
          text:
            "Requiere el permiso \"reembolsar pagos\" — por defecto solo lo tienen OWNER y FINANCE, no VENDOR.",
        },
        {
          type: "callout",
          tone: "info",
          text:
            "¿Por qué VENDOR no puede reembolsar por defecto? Porque un reembolso mueve dinero de verdad " +
            "hacia afuera del negocio, y normalmente se quiere que solo el dueño (OWNER) o la persona " +
            "encargada de las finanzas (rol FINANCE) tenga esa capacidad, para evitar reembolsos hechos sin " +
            "autorización por cualquier vendedor del piso. Si tu negocio necesita que más personas puedan " +
            "reembolsar, eso se ajusta desde la administración de roles y permisos de la empresa.",
        },
        {
          type: "callout",
          tone: "warning",
          text:
            "Casos donde el reembolso se rechaza: si intentas reembolsar más de lo que queda disponible en " +
            "la sesión (por ejemplo, ya se había reembolsado una parte y ahora pides reembolsar más de lo " +
            "que sobra), si el monto no es un número positivo, o si la sesión ya está totalmente reembolsada " +
            "(estado \"Reembolsado\") y por lo tanto no tiene saldo para devolver. En cualquiera de estos " +
            "casos el sistema no aplica el movimiento y te avisa por qué.",
        },
        {
          type: "callout",
          tone: "info",
          text:
            "Un reembolso puede pasar dos cosas con el estado de la sesión: si devuelves menos de lo " +
            "cobrado, la sesión pasa (o se queda) en \"Reembolso parcial\"; si devuelves exactamente lo que " +
            "quedaba pendiente de reembolsar, la sesión pasa a \"Reembolsado\" por completo.",
        },
      ],
      related: ["sesiones-y-libro-de-pagos"],
    },
  ],
};
