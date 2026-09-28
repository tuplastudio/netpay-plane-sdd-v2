import type { HelpCategory } from "./types";

export const cotizacionesPedidos: HelpCategory = {
  slug: "cotizaciones-pedidos",
  title: "Cotizaciones y pedidos",
  articles: [
    {
      slug: "crear-cotizacion",
      title: "Crear, emitir y compartir una cotización",
      summary:
        "El camino normal: armar el carrito, emitirla, y mandarle el link al cliente. Incluye qué significa cada estado y qué pasa si cambias precios o cantidades después.",
      audience: "owner",
      keywords: ["presupuesto", "estimado", "carrito", "cotizador"],
      body: [
        {
          type: "p",
          text:
            "Una cotización es una propuesta de compra: una lista de productos con sus cantidades y precios, " +
            "lista para mandarle a un cliente antes de que pague. Por ejemplo, en una tlapalería alguien " +
            "pregunta por WhatsApp cuánto le costarían 10 botes de pintura y 3 brochas: en vez de contestar " +
            "\"como $1,800\" a ojo, armas una cotización con las líneas exactas y el cliente ve el total real, " +
            "con impuestos y envío incluidos si aplica.",
        },
        { type: "h3", text: "Paso 1: crear la cotización" },
        {
          type: "steps",
          items: [
            "Ve a Cotizaciones → Nueva cotización. Se abre el cotizador.",
            "Elige el cliente. Si es alguien nuevo, primero tienes que darlo de alta como cliente " +
              "(nombre, teléfono, etc.) antes de poder cotizarle.",
            "Agrega una línea por cada producto: elige la variante exacta (por ejemplo \"Pintura vinílica " +
              "blanca, cubeta 19L\", no solo \"pintura\"), la cantidad, y si quieres, un descuento por línea.",
            "Repite el paso anterior por cada producto distinto que lleve el pedido. Puedes mezclar líneas " +
              "con y sin descuento en la misma cotización.",
            "Revisa el total antes de continuar: incluye subtotal, descuento, impuesto (IVA) y envío si el " +
              "cliente ya dio una dirección.",
          ],
        },
        {
          type: "callout",
          tone: "info",
          text:
            "El descuento por línea tiene un tope: cada vendedor tiene un \"descuento máximo\" configurado " +
            "en Admin → Empresa (por ejemplo 10%). Si intentas poner un descuento mayor a tu tope, el sistema " +
            "lo rechaza. Solo un OWNER o alguien con permiso especial puede autorizar descuentos más grandes.",
        },
        { type: "h3", text: "Paso 2: borrador o emitida" },
        {
          type: "p",
          text:
            "Cuando terminas de armar las líneas, decides entre dos caminos: guardarla como borrador " +
            "(estado DRAFT) para seguir editándola después sin compromiso, o emitirla de una vez " +
            "(estado ISSUED) con el botón \"Emitir\".",
        },
        {
          type: "p",
          text:
            "\"Emitir\" quiere decir dos cosas concretas: primero, los precios de esa cotización quedan " +
            "fijos con lo que valía cada producto en ese momento exacto — si más tarde subes el precio del " +
            "producto en tu catálogo, esta cotización ya emitida NO cambia, sigue mostrando el precio de " +
            "cuando la emitiste. Segundo, se le pone una fecha de vencimiento (la \"vigencia de cotización\", " +
            "configurable en Admin → Empresa en horas; por ejemplo 72 horas). Pasado ese plazo sin que el " +
            "cliente la acepte, la cotización pasa sola a estado EXPIRED y ya no se puede pagar desde su link.",
        },
        {
          type: "callout",
          tone: "info",
          text:
            "El precio y la existencia que ve el cliente siempre salen del catálogo vigente al momento de " +
              "cotizar, nunca de un dato guardado de antes — si cambias el precio de un producto, las " +
              "cotizaciones ya emitidas no cambian, pero una nueva sí toma el precio actual. Por eso, si un " +
              "cliente te pide \"la misma cotización de la semana pasada\" después de que subiste precios, " +
              "tienes que hacer una nueva: la de la semana pasada sigue mostrando el precio viejo mientras " +
              "esté vigente, pero una nueva cotización siempre usa el precio de hoy.",
        },
        { type: "h3", text: "Paso 3: compartir el link" },
        {
          type: "steps",
          items: [
            "Con el botón \"Compartir\" generas un link público único para esa cotización.",
            "Ese link lo puede abrir cualquier persona sin necesidad de crear una cuenta ni iniciar sesión " +
              "— nada más con el link, como si fuera una página web normal.",
            "Desde esa página el cliente ve el detalle completo (qué productos, cuántos, cuánto cuesta cada " +
              "uno y el total) y puede pagar directamente ahí, sin que tú tengas que hacer nada más.",
            "Manda el link por el canal que uses con ese cliente: WhatsApp, correo, lo que sea. El link no " +
              "cambia aunque el cliente lo abra varias veces.",
          ],
        },
        {
          type: "callout",
          tone: "info",
          text:
            "Recordatorio automático (opcional): si tu empresa tiene activado \"Recordar al cliente una " +
            "cotización sin pagar\" (Admin → Empresa), el sistema le vuelve a mandar un mensaje al cliente " +
            "por el mismo canal que usó, cada cierto número de horas que tú configures, hasta un máximo de " +
            "recordatorios por cotización (por ejemplo, cada 24 horas, hasta 3 veces). Respeta si el cliente " +
            "se dio de baja de notificaciones, solo manda mensajes entre 9 de la mañana y 7 de la noche hora " +
            "local, y respeta la ventana de 24 horas que WhatsApp exige para mensajes de este tipo. Poner el " +
            "máximo en 0 apaga los recordatorios de esa cotización en adelante.",
        },
        {
          type: "p",
          text:
            "También puedes descargar un recibo en PDF de la cotización desde el botón \"Recibo\", por si el " +
            "cliente lo necesita impreso o para sus propios archivos.",
        },
        { type: "h3", text: "¿Y si necesito cambiar algo después de emitirla?" },
        {
          type: "p",
          text:
            "Mientras la cotización no esté cancelada, vencida, o ya pagada, puedes seguir editándola con el " +
            "botón \"Editar\" — por ejemplo si el cliente pidió una cantidad distinta o quiere agregar un " +
            "producto más. Al guardar el cambio, los precios se vuelven a calcular con el catálogo vigente " +
            "en ese momento (no con lo que estaba fijo antes). Si la cotización ya se le había compartido al " +
            "cliente, se le reenvía el link con la información actualizada. Si esa cotización ya tenía un " +
            "pedido asociado que todavía no se pagaba, ese pedido regresa a borrador para que el cobro se " +
            "genere otra vez con las líneas correctas — así nunca se le cobra al cliente algo distinto a lo " +
            "que quedó en la versión final de la cotización.",
        },
        {
          type: "callout",
          tone: "warning",
          text:
            "Una vez que el pedido de esa cotización ya se pagó (aunque sea parcialmente, con un cobro " +
            "capturado), ya no puedes editar la cotización. En ese caso, si algo salió mal, la herramienta " +
            "correcta es un reembolso desde el pedido, no editar la cotización original.",
        },
        { type: "h3", text: "Estados de una cotización" },
        {
          type: "table",
          headers: ["Estado", "Qué significa"],
          rows: [
            ["DRAFT", "Borrador, se puede seguir editando. Todavía no tiene precios fijos ni vencimiento."],
            [
              "ISSUED",
              "Emitida: precios fijos y tiene vigencia (fecha de vencimiento). Ya se le puede compartir el link al cliente.",
            ],
            [
              "ACCEPTED",
              "El cliente la aceptó — porque pagó directo desde el link, o porque tú, como negocio, la marcaste como aprobada con el botón \"Aprobar cotización\".",
            ],
            ["CANCELLED", "Cancelada — ya no se puede aceptar ni pagar desde su link. No se puede revertir."],
            [
              "EXPIRED",
              "Venció sin que se aceptara: se pasó la fecha de vigencia. Pasa a este estado sola, sin que nadie lo tenga que hacer a mano.",
            ],
          ],
        },
        {
          type: "callout",
          tone: "warning",
          text:
            "Una cotización CANCELLED o EXPIRED ya no se puede editar ni reactivar. Si el cliente sigue " +
            "interesado después de que venció, la solución es crear una cotización nueva (que tomará los " +
            "precios actuales del catálogo, no los de la vencida).",
        },
      ],
      related: ["de-cotizacion-a-pedido"],
    },
    {
      slug: "de-cotizacion-a-pedido",
      title: "De cotización a pedido y cobro",
      summary:
        "Cómo se convierte una cotización aceptada en un pedido con checkout abierto, y cómo cobrar algo que no está en tu catálogo con Cobro rápido.",
      audience: "owner",
      keywords: ["checkout token", "link de pago", "aprobar cotización", "idempotencia"],
      body: [
        { type: "h3", text: "De cotización a pedido" },
        {
          type: "p",
          text:
            "Un pedido es distinto de una cotización: la cotización es la propuesta, el pedido es lo que ya " +
            "se está cobrando de verdad. Un pedido nace de dos formas: cuando el cliente acepta una " +
            "cotización, o de forma directa con Cobro rápido (ver más abajo).",
        },
        {
          type: "steps",
          items: [
            "El cliente acepta la cotización: esto pasa cuando paga directo desde el link público, o cuando " +
              "tú, desde el panel, pulsas \"Aprobar cotización\" (esto es útil si el cliente te confirmó por " +
              "teléfono o en persona, sin usar el link).",
            "Al aceptarse, se crea automáticamente un pedido con exactamente las mismas líneas (mismos " +
              "productos, mismas cantidades, mismos descuentos) que tenía la cotización.",
            "Desde ese pedido se abre el checkout — el proceso de cobro. Esto genera un link de pago con " +
              "vigencia limitada.",
          ],
        },
        {
          type: "p",
          text:
            "El link de pago no dura para siempre. Su vigencia (\"minutos de reserva de checkout\") se " +
            "configura en Admin → Empresa, en minutos — por ejemplo 30 minutos. Mientras ese link está " +
            "activo, el pedido queda en estado \"checkout abierto\" (CHECKOUT_OPEN) o \"esperando pago\" " +
            "(AWAITING_PAYMENT). Si el cliente no paga a tiempo, el link deja de servir y hay que volver a " +
            "abrir el checkout para generar uno nuevo.",
        },
        {
          type: "callout",
          tone: "info",
          text:
            "El \"checkout token\" es el código secreto que va dentro del link de pago — es lo que le da " +
            "acceso al cliente a esa pantalla de cobro sin necesidad de una cuenta. Es como la llave de una " +
            "puerta temporal: solo abre esa puerta, solo mientras no haya vencido, y no sirve para nada más " +
            "en el sistema. Nunca debes compartir ese link con alguien distinto al cliente que debe pagar, " +
            "porque quien lo tenga puede completar el pago con él.",
        },
        {
          type: "callout",
          tone: "warning",
          text:
            "Si mientras el checkout está abierto tú editas la cotización original (por ejemplo cambias una " +
            "cantidad), el pedido regresa a borrador y el link de pago que ya se había mandado deja de " +
            "servir. Tienes que volver a abrir el checkout para generar un link nuevo con los datos " +
            "correctos, y avisarle al cliente que use el link nuevo, no el viejo.",
        },
        { type: "h3", text: "Cobro rápido" },
        {
          type: "p",
          text:
            "Si no necesitas pasar por catálogo (un servicio, un ajuste, algo que no tienes dado de alta), usa " +
            "Cobro rápido: un concepto libre y un monto, y se abre el checkout directo. Trae una clave de " +
            "idempotencia para que reintentar la misma llamada no duplique el cobro.",
        },
        {
          type: "p",
          text:
            "Un ejemplo: en una taquería alguien pide que le cobres $250 por un servicio de banquete para una " +
            "fiesta de cumpleaños. Ese \"servicio de banquete\" no es un producto que tengas dado de alta en " +
            "tu catálogo, así que en vez de crear un producto solo para esa vez, usas Cobro rápido: escribes " +
            "\"Servicio de banquete cumpleaños\" como concepto, pones $250.00 como monto, eliges el cliente " +
            "(opcional) y listo — se abre el checkout con ese concepto y ese monto exactos.",
        },
        {
          type: "steps",
          items: [
            "Ve a Cobro rápido en el menú.",
            "Elige el cliente (opcional, pero recomendado para llevar el historial).",
            "Escribe el concepto: una descripción corta de qué es el cobro (máximo 200 caracteres).",
            "Escribe el importe: solo números y un punto decimal, sin comas ni signos de moneda (por " +
              "ejemplo escribe 250.00, no $250.00 ni 250,00).",
            "Confirma. Se genera el link de pago igual que con un pedido normal.",
          ],
        },
        {
          type: "callout",
          tone: "info",
          text:
            "¿Qué es una \"clave de idempotencia\"? Es un identificador único que se manda junto con el " +
            "cobro para evitar cobros duplicados. Imagina que tu conexión a internet se corta justo después " +
            "de dar clic en \"Cobrar\": no sabes si el cobro ya se procesó o no, y si le das clic otra vez " +
            "por accidente, podrías cobrarle dos veces al mismo cliente por el mismo concepto. La clave de " +
            "idempotencia evita eso: si el sistema recibe dos veces la misma clave, sabe que es el mismo " +
            "intento repetido y no genera un segundo cobro. En el panel esto se maneja solo, sin que tengas " +
            "que escribir nada — se genera automáticamente cada vez que abres el formulario de Cobro rápido.",
        },
        {
          type: "callout",
          tone: "info",
          text:
            "Cobro rápido también tiene su propia vigencia (\"vigencia de cobro rápido\", en horas, " +
            "configurable en Admin → Empresa) para el link de pago que genera, igual que las cotizaciones y " +
            "el checkout normal tienen la suya.",
        },
      ],
      related: ["crear-cotizacion", "cancelaciones"],
    },
    {
      slug: "cancelaciones",
      title: "Cancelar una cotización o un pedido",
      summary:
        "Qué pasa exactamente al cancelar cada uno, quién puede hacerlo según su rol, y por qué no se puede deshacer.",
      audience: "owner",
      keywords: ["cancelación", "cancelar pedido", "cancelar cotización", "cancelar propios", "cancelar cualquiera"],
      body: [
        { type: "h3", text: "Cancelar una cotización" },
        {
          type: "p",
          text: "Cancelar una cotización la deja fuera de juego: ya no se puede aceptar ni pagar desde su link.",
        },
        {
          type: "p",
          text:
            "Por ejemplo, si un cliente te pidió una cotización para 20 metros de tela y luego te avisa que " +
            "ya no le interesa, cancelas esa cotización desde el botón \"Cancelar\" en su detalle. El link " +
            "que ya le habías mandado sigue abriendo (la página se puede ver), pero si intenta pagar desde " +
            "ahí, el sistema lo rechaza porque la cotización ya está cancelada.",
        },
        {
          type: "callout",
          tone: "warning",
          text:
            "Cancelar una cotización no se puede deshacer. Si te equivocaste y en realidad sí seguía " +
            "vigente, tienes que crear una cotización nueva desde cero — con los precios actuales del " +
            "catálogo, que pueden ya no ser los mismos que tenía la cancelada.",
        },
        { type: "h3", text: "Cancelar un pedido" },
        {
          type: "p",
          text:
            "Cancelar un pedido depende de tu rol: por defecto solo puedes cancelar los pedidos que tú mismo " +
            "creaste (\"cancelar propios\"); OWNER y ADMIN pueden cancelar cualquiera de la empresa " +
            "(\"cancelar cualquiera\").",
        },
        {
          type: "p",
          text:
            "En la práctica, esto significa que si trabajas como VENDOR (vendedor) en una boutique con " +
            "varios empleados, solo puedes cancelar los pedidos que tú abriste con tus propios clientes — no " +
            "puedes cancelar un pedido que abrió otro vendedor, aunque estés viéndolo en el panel. Si " +
            "necesitas cancelar el pedido de otra persona (por ejemplo, porque esa persona ya no trabaja " +
            "ahí, o porque tú eres quien está resolviendo el reclamo del cliente), tiene que hacerlo alguien " +
            "con rol OWNER o ADMIN, que sí puede cancelar cualquier pedido de la empresa sin importar quién " +
            "lo haya creado.",
        },
        {
          type: "callout",
          tone: "info",
          text:
            "\"Cancelar propios\" y \"cancelar cualquiera\" son dos permisos distintos dentro del sistema " +
            "(orders.cancel_own y orders.cancel_any). Casi todos los roles con acceso a pedidos tienen al " +
            "menos \"cancelar propios\"; solo OWNER y ADMIN traen además \"cancelar cualquiera\" de forma " +
            "predeterminada.",
        },
        {
          type: "callout",
          tone: "warning",
          text:
            "Igual que con las cotizaciones, cancelar un pedido no se puede deshacer. Un pedido ya cobrado " +
            "(pagado) no se cancela: en ese caso la herramienta correcta es un reembolso, no una " +
            "cancelación — cancelar es para pedidos que todavía no se han pagado.",
        },
      ],
      related: ["de-cotizacion-a-pedido"],
    },
    {
      slug: "facturacion",
      title: "Pedir factura de un pedido",
      summary:
        "Qué datos fiscales se piden, cómo se guardan en el pedido, y qué es (y qué no es) esta solicitud de factura.",
      audience: "owner",
      keywords: ["factura", "facturar", "cfdi", "rfc", "razón social", "uso de cfdi", "constancia de situación fiscal"],
      body: [
        {
          type: "p",
          text:
            "Cuando un cliente necesita factura por su compra (por ejemplo, un cliente empresarial que va a " +
            "deducir el gasto), el pedido tiene una sección para registrar sus datos fiscales. Esto NO genera " +
            "la factura por sí solo: deja la solicitud lista, con todos los datos correctos, para que tú (o " +
            "tu contador, o tu sistema de facturación) generes el CFDI aparte.",
        },
        {
          type: "callout",
          tone: "info",
          text:
            "CFDI significa \"Comprobante Fiscal Digital por Internet\" — es el nombre oficial que usa el " +
            "SAT en México para las facturas electrónicas. Cuando este artículo dice \"factura\", se refiere " +
            "a ese comprobante.",
        },
        { type: "h3", text: "Datos que se piden" },
        {
          type: "list",
          items: [
            "RFC (Registro Federal de Contribuyentes) del cliente: 13 caracteres si es persona física, 12 " +
              "si es persona moral (una empresa).",
            "Razón social: el nombre legal completo a nombre de quien se factura (puede ser distinto al " +
              "nombre con el que el cliente aparece en tu lista de clientes).",
            "Código postal fiscal: el código postal de 5 dígitos registrado ante el SAT — puede no ser el " +
              "mismo que la dirección de envío del pedido.",
            "Uso de CFDI: un código corto que indica para qué va a usar el cliente esa factura (por " +
              "ejemplo G03 para \"gastos en general\", P01 para \"por definir\"). El cliente normalmente ya " +
              "sabe cuál necesita; si no, G03 es el más común para compras generales.",
            "Constancia de situación fiscal (opcional): un documento que el SAT le da al cliente con sus " +
              "datos fiscales exactos. Si el cliente te la manda, puedes guardar el link a ese archivo aquí " +
              "para no tener que copiar los datos a mano y evitar errores de dedo en el RFC.",
          ],
        },
        {
          type: "callout",
          tone: "warning",
          text:
            "Un error común: capturar el RFC con espacios o en minúsculas. El sistema lo guarda en " +
            "mayúsculas automáticamente, pero si el RFC tiene un dígito equivocado, la factura que generes " +
            "después con esos datos saldrá mal y el cliente no podrá deducirla. Si tienes duda, pide al " +
            "cliente su constancia de situación fiscal en vez de que te dicte el RFC de memoria.",
        },
        {
          type: "p",
          text:
            "La cotización o el pedido en sí no son un comprobante fiscal — esto solo deja la solicitud " +
            "lista para que factures por tu propio sistema. Es decir: guardar estos datos en el pedido no " +
            "sustituye la factura real, es el paso antes de generarla.",
        },
        {
          type: "callout",
          tone: "info",
          text:
            "El pedido guarda un estado de facturación (por ejemplo \"datos completos\") y la fecha en que " +
            "se pidió la factura, además de los datos fiscales. También se guarda el último RFC y razón " +
            "social usados en la ficha del cliente, para que la próxima vez que compre no tengas que " +
            "volver a preguntarle todo desde cero.",
        },
      ],
    },
  ],
};
