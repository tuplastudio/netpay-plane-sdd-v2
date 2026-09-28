import type { HelpCategory } from "./types";

export const cotizacionesPedidos: HelpCategory = {
  slug: "cotizaciones-pedidos",
  title: "Cotizaciones y pedidos",
  articles: [
    {
      slug: "crear-cotizacion",
      title: "Crear, emitir y compartir una cotización",
      summary:
        "El cotizador paso a paso: elegir cliente, agregar productos, descuentos, emitir, compartir el link, editar y qué significa cada estado.",
      audience: "owner",
      keywords: ["presupuesto", "estimado", "carrito", "cotizador", "nueva cotización", "emitir", "compartir", "recibo", "pdf", "editar cotización"],
      body: [
        {
          type: "p",
          text:
            "Una cotización es una propuesta de compra: productos, cantidades y precios, lista para mandar " +
            "al cliente antes de que pague. Ejemplo: en una tlapalería alguien pide por WhatsApp el precio de " +
            "10 botes de pintura y 3 brochas. En vez de contestar \"como $1,800\", armas una cotización y el " +
            "cliente ve el total exacto, con IVA y envío si aplica.",
        },
        {
          type: "callout",
          tone: "info",
          text:
            "El agente crea cotizaciones solo cuando atiende por WhatsApp. Esta guía es para cuando las creas " +
            "tú desde el panel.",
        },
        { type: "h3", text: "Paso 1: abrir el cotizador" },
        {
          type: "p",
          text:
            "Ve a Cotizaciones y da clic en \"Nueva cotización\", arriba a la derecha. Se abre el cotizador " +
            "con tres columnas: cliente, productos y la cotización que vas armando. En celular las columnas " +
            "aparecen una debajo de otra.",
        },
        { type: "h3", text: "Paso 2: elegir cliente y productos" },
        {
          type: "steps",
          items: [
            "En \"Cliente\", elige a la persona. Si es nueva, primero créala en Clientes → \"Nuevo cliente\" " +
              "(solo el nombre es obligatorio).",
            "En el buscador de productos, escribe parte del nombre o del SKU. Solo aparecen productos " +
              "activos.",
            "Da clic en un producto para ver sus variantes (por ejemplo \"19 L\" o \"4 L\").",
            "En la variante que quieres, da clic en \"Agregar\". Si ya estaba, el botón dice \"Sumar\" y " +
              "aumenta la cantidad.",
            "En la columna de la cotización, ajusta la cantidad con los botones + y −, o escribiéndola.",
            "Si quieres, escribe un descuento en porcentaje para esa línea (0 a 100).",
          ],
        },
        {
          type: "callout",
          tone: "info",
          title: "Tope de descuento",
          text:
            "Tu empresa define un \"Descuento máximo del vendedor\" en Admin → Empresa (por ejemplo 10%). Si " +
            "pones un descuento mayor, el sistema lo rechaza al guardar.",
        },
        { type: "h3", text: "Paso 3: revisar y crear" },
        {
          type: "steps",
          items: [
            "Abajo ves el total calculado al momento: subtotal, descuento, IVA, envío y total.",
            "La casilla \"Emitir\" viene marcada. Déjala así para que la cotización quede lista para " +
              "mandar. Desmárcala si quieres guardarla como borrador y terminarla después.",
            "Da clic en \"Crear cotización\". Se abre su página de detalle.",
          ],
        },
        {
          type: "callout",
          tone: "warning",
          text:
            "Si cierras el cotizador con líneas agregadas, el sistema pregunta \"¿Cerrar sin guardar?\". Si " +
            "aceptas, se pierden esas líneas.",
        },
        { type: "h3", text: "Qué significa \"Emitir\"" },
        {
          type: "list",
          items: [
            "Los precios quedan fijos. Si después cambias un precio en el catálogo, esta cotización no cambia.",
            "Empieza a correr su vigencia (\"Vigencia de cotización\" en Admin → Empresa, en horas; por " +
              "ejemplo 72). Al terminar, la cotización vence sola y ya no se puede pagar.",
          ],
        },
        { type: "h3", text: "Paso 4: compartir con el cliente" },
        {
          type: "steps",
          items: [
            "En el detalle de la cotización, da clic en \"Compartir\". Aparece el \"Link público de la " +
              "cotización\" con un botón para copiarlo.",
            "Manda ese link por WhatsApp, correo o donde hables con el cliente.",
            "El cliente lo abre sin cuenta ni contraseña, ve el detalle y puede pagar desde ahí.",
          ],
        },
        {
          type: "p",
          text:
            "El botón \"Recibo\" descarga la cotización en PDF, por si el cliente la quiere impresa. Ver " +
            "\"Lo que ve tu cliente\" para saber cómo se ve el link del lado del cliente.",
        },
        { type: "h3", text: "Botones del detalle" },
        {
          type: "table",
          headers: ["Botón", "Cuándo aparece", "Qué hace"],
          rows: [
            ["Editar", "Mientras la cotización se pueda cambiar", "Cambia cantidades, líneas o notas para el cliente."],
            ["Emitir", "En borrador", "Fija precios y empieza la vigencia."],
            ["Aprobar cotización", "Emitida", "Crea el pedido con las mismas líneas y abre el link de pago. Útil si el cliente confirmó por teléfono o en persona. No se puede deshacer."],
            ["Compartir", "En borrador o emitida", "Genera el link público."],
            ["Cancelar", "En borrador o emitida", "La cotización ya no se puede aceptar ni pagar. No se puede deshacer."],
            ["Recibo", "Siempre", "Descarga el PDF."],
          ],
        },
        { type: "h3", text: "Editar después de emitir" },
        {
          type: "p",
          text:
            "Mientras la cotización no esté cancelada, vencida o pagada, puedes usar \"Editar\": agregar " +
            "productos con \"Agregar presentación\", cambiar cantidades o escribir \"Notas para el cliente\" " +
            "(condiciones, tiempos de entrega). Al guardar, los precios se recalculan con el catálogo de ese " +
            "momento. Si ya la habías compartido, el cliente recibe el link actualizado. Si ya tenía un " +
            "pedido sin pagar, ese pedido regresa a borrador y su link de pago anterior deja de servir: " +
            "vuelve a iniciar el cobro.",
        },
        {
          type: "callout",
          tone: "warning",
          text:
            "Si el pedido de esa cotización ya se pagó, no se puede editar. Si algo salió mal, usa un " +
            "reembolso desde el pedido.",
        },
        { type: "h3", text: "Estados de una cotización" },
        {
          type: "table",
          headers: ["Estado", "Qué significa"],
          rows: [
            ["Borrador (DRAFT)", "Se puede seguir editando. Todavía no tiene precios fijos ni vencimiento."],
            ["Emitida (ISSUED)", "Precios fijos y vigencia corriendo. Lista para compartir."],
            ["Aceptada (ACCEPTED)", "El cliente la aceptó (pagó desde el link o abrió su pago), o tú la aprobaste."],
            ["Cancelada (CANCELLED)", "Ya no se puede aceptar ni pagar. No se revierte."],
            ["Expirada (EXPIRED)", "Pasó su vigencia sin aceptarse. Pasa sola a este estado."],
          ],
        },
        {
          type: "callout",
          tone: "info",
          text:
            "Una cotización cancelada o vencida no se reactiva. Si el cliente sigue interesado, crea una " +
            "nueva: tomará los precios de hoy.",
        },
      ],
      related: ["lo-que-ve-tu-cliente", "de-cotizacion-a-pedido", "preguntas-cotizaciones"],
    },
    {
      slug: "de-cotizacion-a-pedido",
      title: "De cotización a pedido y cobro",
      summary:
        "Cómo una cotización aceptada se convierte en pedido con link de pago, cuánto dura ese link y cómo cobrar algo que no está en tu catálogo con Cobro rápido.",
      audience: "owner",
      keywords: ["checkout token", "link de pago", "aprobar cotización", "idempotencia", "cobro rápido", "iniciar checkout", "pagar pedido"],
      body: [
        {
          type: "p",
          text:
            "La cotización es la propuesta. El pedido es la venta que ya se está cobrando. Un pedido nace " +
            "de dos formas: cuando se acepta una cotización, o directamente con Cobro rápido.",
        },
        { type: "h3", text: "De cotización a pedido" },
        {
          type: "steps",
          items: [
            "La cotización se acepta: el cliente da clic en \"Aceptar y pagar\" en su link, o tú das clic en " +
              "\"Aprobar cotización\" en el panel.",
            "Se crea un pedido con las mismas líneas, cantidades y descuentos.",
            "Se abre el checkout (la pantalla de pago) y se genera un link de pago. Las existencias de esos " +
              "productos quedan apartadas mientras el link esté vigente.",
          ],
        },
        {
          type: "p",
          text:
            "El link de pago dura lo que diga \"Vigencia del link de pago\" en Admin → Empresa, en minutos " +
            "(por ejemplo 30). Mientras dure, el pedido está en \"Checkout abierto\" o \"Por pagar\". " +
            "Si el cliente no paga a tiempo, el link deja de servir y el apartado de existencias se libera.",
        },
        {
          type: "p",
          text:
            "Para mandar otra vez el link, entra al pedido. Si sigue abierto, en \"Esperando pago\" da clic " +
            "en \"Pagar pedido\" para generar o reenviar el link. Si el pedido viene de una cotización y está " +
            "en borrador, da clic en \"Iniciar checkout\". Aparece \"Link de pago listo\" con un botón " +
            "\"Copiar\".",
        },
        {
          type: "callout",
          tone: "warning",
          title: "El link de pago es personal",
          text:
            "El link lleva un código secreto que abre esa pantalla de pago sin cuenta. Quien tenga el link " +
            "puede pagar. Mándalo solo al cliente que debe pagar.",
        },
        { type: "h3", text: "Cobro rápido" },
        {
          type: "p",
          text:
            "Para cobrar algo que no está en tu catálogo, como un servicio o un ajuste. Ejemplo: una " +
            "taquería cobra $250 por un servicio de banquete. En lugar de crear un producto solo para eso, " +
            "usa Cobro rápido.",
        },
        {
          type: "steps",
          items: [
            "Ve a Cobro rápido.",
            "Elige el cliente (opcional, pero así queda en su historial).",
            "Escribe el concepto, máximo 200 caracteres. Ejemplo: \"Servicio de banquete cumpleaños\".",
            "Escribe el importe con punto decimal, sin comas ni signo de pesos: 250.00.",
            "Confirma. Se genera el link de pago.",
          ],
        },
        {
          type: "callout",
          tone: "info",
          text:
            "Cobro rápido evita cobros duplicados: si se te va el internet y das clic otra vez, el sistema " +
            "reconoce que es el mismo intento y no genera un segundo cobro. Su link dura lo que diga " +
            "\"Vigencia de cobro rápido\" en Admin → Empresa, en horas.",
        },
      ],
      related: ["crear-cotizacion", "seguimiento-de-pedidos", "cancelaciones"],
    },
    {
      slug: "seguimiento-de-pedidos",
      title: "Pedidos: estados, entrega y seguimiento",
      summary:
        "Qué significa cada estado de un pedido, cómo marcarlo como entregado y el link de seguimiento que recibe tu cliente.",
      audience: "owner",
      keywords: ["pedido", "estado del pedido", "entregado", "marcar como entregado", "seguimiento", "rastreo", "línea de tiempo"],
      body: [
        {
          type: "p",
          text:
            "En Pedidos ves todas tus ventas. Da clic en una para ver su detalle: productos vendidos, " +
            "totales, cliente, pagos, facturación, referencias y una línea de tiempo con cada cambio.",
        },
        { type: "h3", text: "Estados de un pedido" },
        {
          type: "table",
          headers: ["Estado", "Qué significa", "Qué puedes hacer"],
          rows: [
            ["Borrador", "Se creó pero no se ha abierto el cobro.", "Iniciar checkout o cancelar."],
            ["Checkout abierto", "El link de pago existe y está vigente.", "Reenviar el link o cancelar."],
            ["Por pagar", "El cliente abrió la pasarela; el pago está en proceso.", "Esperar; la página del cliente se actualiza sola."],
            ["Pagado", "El dinero entró.", "Marcar como entregado o reembolsar."],
            ["Entregado", "Pagado y entregado al cliente.", "Reembolsar si hace falta."],
            ["Expirado", "El link de pago venció sin pago.", "Crear una cotización o cobro nuevo."],
            ["Cancelado", "Se canceló antes de pagarse.", "Nada; no se revierte."],
            ["Reembolsado", "Se devolvió el dinero.", "Nada."],
          ],
        },
        { type: "h3", text: "Marcar como entregado" },
        {
          type: "steps",
          items: [
            "Abre un pedido en estado Pagado.",
            "Da clic en \"Marcar como entregado\", arriba a la derecha.",
            "El pedido pasa a Entregado y el cliente recibe un aviso.",
          ],
        },
        { type: "h3", text: "Seguimiento del cliente" },
        {
          type: "p",
          text:
            "Cada pedido tiene un link público de seguimiento. El cliente lo recibe por WhatsApp o correo al " +
            "pagar y al marcarse como entregado. Ahí ve el estado actual (\"Pago confirmado, preparando tu " +
            "pedido\", entregado o cancelado) con tu logo y tus colores. En el detalle del pedido, la " +
            "sección \"Seguimiento del cliente\" tiene ese link por si quieres copiarlo.",
        },
        { type: "h3", text: "El origen del pedido" },
        {
          type: "p",
          text:
            "Arriba del detalle ves el origen: si vino de una cotización, de un cobro rápido o de otro canal. " +
            "Sirve para saber cómo se generó la venta.",
        },
      ],
      related: ["de-cotizacion-a-pedido", "cancelaciones", "reembolsos"],
    },
    {
      slug: "lo-que-ve-tu-cliente",
      title: "Lo que ve tu cliente: cotización, pago y confirmación",
      summary:
        "Cómo se ven, del lado del cliente, el link de la cotización, la pantalla de pago, la sección de factura y la confirmación.",
      audience: "owner",
      keywords: ["link público", "cliente", "checkout", "pagar", "página de pago", "tarjeta", "spei", "efectivo", "gracias"],
      body: [
        {
          type: "p",
          text:
            "Tu cliente nunca entra al panel. Todo lo hace desde links públicos que se abren en su celular sin " +
            "cuenta ni contraseña. Todas estas pantallas usan tu logo y tus colores de Admin → Marca.",
        },
        { type: "h3", text: "1. El link de la cotización" },
        {
          type: "list",
          items: [
            "Arriba: el nombre del cliente, el folio y el estado de la cotización.",
            "El desglose: cada producto con cantidad y precio, y abajo subtotal, descuento, IVA, envío y " +
              "total.",
            "La fecha de vencimiento. Si faltan 48 horas o menos, dice \"vence pronto\".",
            "Botones: \"Descargar PDF\", copiar el enlace y \"Aceptar y pagar\" (o \"Pagar ahora\" si ya " +
              "hay un link de pago abierto). En celular, el botón de pago queda fijo abajo.",
          ],
        },
        {
          type: "p",
          text:
            "Si la cotización ya se pagó, venció o se canceló, el cliente ve un aviso y ya no puede pagar. " +
            "Si venció, el aviso le pide que solicite una nueva.",
        },
        { type: "h3", text: "2. La pantalla de pago (checkout)" },
        {
          type: "list",
          items: [
            "El resumen del pedido con totales y la hora a la que vence el link.",
            "El botón para pagar, que lleva a una pasarela segura para pagar con tarjeta, transferencia SPEI o " +
              "efectivo.",
            "Si el pago se rechaza, un aviso \"Pago rechazado — intenta de nuevo\".",
            "Mientras el pago se confirma, la página se actualiza sola cada pocos segundos.",
            "La sección \"¿Necesitas factura?\" para subir la constancia de situación fiscal.",
          ],
        },
        { type: "h3", text: "3. La confirmación" },
        {
          type: "p",
          text:
            "Cuando el pago se aplica, el cliente ve \"¡Listo! Tu pago se aplicó\" con el número de pedido. " +
            "Esa pantalla aclara que el comprobante de pago no es un CFDI (factura). Después recibe el link " +
            "de seguimiento de su pedido.",
        },
        {
          type: "callout",
          tone: "info",
          text:
            "En modo de pruebas, estas pantallas muestran \"Modo de pruebas · sin dinero real\". Así puedes " +
            "hacer compras de práctica sin cobrar.",
        },
        {
          type: "faq",
          items: [
            {
              q: "El cliente dice \"Este enlace de pago ya no sirve\".",
              a:
                "El link venció o el pedido cambió (por ejemplo, editaste la cotización). Entra al pedido y " +
                "genera un link nuevo con \"Pagar pedido\" o \"Iniciar checkout\".",
            },
            {
              q: "El cliente dice \"Demasiados intentos seguidos\".",
              a: "Intentó abrir el pago muchas veces en poco tiempo. Que espere un momento y vuelva a intentar.",
            },
            {
              q: "El cliente pagó en efectivo en una tienda y el pedido sigue \"Por pagar\".",
              a:
                "Los pagos en efectivo y algunas transferencias tardan en confirmarse. El pedido cambia a " +
                "Pagado solo cuando la pasarela confirma el pago.",
            },
          ],
        },
      ],
      related: ["crear-cotizacion", "facturacion", "marca"],
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
          type: "steps",
          items: [
            "Abre la cotización y da clic en \"Cancelar\".",
            "Confirma en \"¿Cancelar cotización?\".",
            "La cotización queda Cancelada. Su link sigue abriendo, pero el cliente ve \"Cotización " +
              "cancelada\" y no puede pagar.",
          ],
        },
        {
          type: "callout",
          tone: "warning",
          text:
            "No se puede deshacer. Si te equivocaste, crea una cotización nueva (con los precios de hoy).",
        },
        { type: "h3", text: "Cancelar un pedido" },
        {
          type: "p",
          text:
            "Solo se cancelan pedidos que no se han pagado: en Borrador, Checkout abierto o Por " +
            "pagar. Abre el pedido, da clic en \"Cancelar pedido\" y confirma. Se liberan las existencias " +
            "apartadas y el link de pago deja de servir.",
        },
        {
          type: "p",
          text:
            "Quién puede: por defecto cada persona cancela solo los pedidos que ella creó. Propietario y " +
            "Administrador pueden cancelar cualquier pedido de la empresa. Ejemplo: en una boutique con " +
            "varios vendedores, un vendedor no puede cancelar el pedido de otro; tiene que pedírselo al " +
            "dueño o al administrador.",
        },
        {
          type: "callout",
          tone: "warning",
          text:
            "Un pedido pagado no se cancela: se reembolsa. Cancelar es solo para pedidos sin pagar.",
        },
      ],
      related: ["de-cotizacion-a-pedido", "reembolsos"],
    },
    {
      slug: "facturacion",
      title: "Factura: basta con subir la constancia de situación fiscal",
      summary:
        "El cliente sube el PDF de su constancia y el sistema lee RFC, razón social, código postal y régimen. Cómo funciona en el link de pago, por WhatsApp y en el panel.",
      audience: "owner",
      keywords: ["factura", "facturar", "cfdi", "rfc", "razón social", "uso de cfdi", "constancia de situación fiscal", "régimen fiscal", "csf", "sat"],
      body: [
        {
          type: "p",
          text:
            "Cuando un cliente necesita factura, antes tenía que dictar cuatro datos (RFC, razón social, " +
            "código postal y régimen) y era fácil equivocarse en una letra. Ahora basta con subir su " +
            "constancia de situación fiscal: un PDF que el SAT le da a cada contribuyente. El sistema lee los " +
            "datos de ahí.",
        },
        {
          type: "callout",
          tone: "info",
          title: "Qué hace y qué no hace",
          text:
            "Atiende ya guarda la solicitud de factura con los datos correctos en el pedido. No emite el CFDI " +
            "(la factura oficial): eso lo haces tú, tu contador o tu sistema de facturación con estos datos.",
        },
        { type: "h3", text: "Qué se lee de la constancia y qué no" },
        {
          type: "table",
          headers: ["Dato", "¿Viene en la constancia?"],
          rows: [
            ["RFC", "Sí."],
            ["Nombre o razón social", "Sí."],
            ["Código postal fiscal", "Sí."],
            ["Régimen fiscal (por ejemplo 626)", "Sí."],
            ["Uso del CFDI (por ejemplo G03)", "No. Siempre lo elige el cliente."],
          ],
        },
        { type: "h3", text: "Desde el link de pago (lo más común)" },
        {
          type: "steps",
          items: [
            "El cliente abre su link de pago y toca \"¿Necesitas factura?\".",
            "Toca \"Sube tu constancia (PDF)\" y elige el archivo. Máximo 8 MB.",
            "Elige el \"Uso del CFDI\". Viene seleccionado G03 — Gastos en general. Otras opciones: G01 " +
              "(adquisición de mercancías), G02 (devoluciones o descuentos), P01 (por definir) y S01 (sin " +
              "efectos fiscales).",
            "Toca \"Subir y facturar\".",
            "Ve \"Listo, tus datos fiscales quedaron guardados\" con su razón social, RFC, código postal y " +
              "régimen, para que confirme que son correctos.",
          ],
        },
        {
          type: "p",
          text:
            "Si el cliente no tiene la constancia a la mano, toca \"Prefiero capturarlo a mano\" y escribe " +
            "RFC, razón social, código postal y, si quiere, la clave de régimen. El formulario revisa que el " +
            "RFC y el código postal tengan el formato correcto.",
        },
        { type: "h3", text: "Por WhatsApp" },
        {
          type: "p",
          text:
            "Si el cliente le pide factura al agente, el agente le pide el uso de CFDI y le dice que suba su " +
            "constancia en el link de pago (el agente no lee archivos mandados por WhatsApp). Si el cliente " +
            "tiene un enlace público a su constancia, el agente puede usarlo directamente. Si no la tiene, " +
            "el agente le pide los datos, se los lee de vuelta y solo los guarda cuando el cliente confirma. " +
            "Si el cliente ya facturó antes, el agente le pregunta si son los mismos datos.",
        },
        { type: "h3", text: "Dónde lo ves en el panel" },
        {
          type: "p",
          text:
            "Abre el pedido. La sección \"Facturación (CFDI)\" muestra el estado, RFC, razón social, código " +
            "postal fiscal, uso de CFDI, la fecha en que se pidió y un enlace \"Ver documento\" a la " +
            "constancia. También en Conversaciones, en el panel del cliente, ves estos datos. El último RFC y " +
            "razón social se guardan en la ficha del cliente para la próxima compra.",
        },
        {
          type: "callout",
          tone: "warning",
          title: "Si la constancia no se leyó completa",
          text:
            "El sistema nunca inventa un dato fiscal. Si no pudo leer alguno, lo deja vacío y muestra \"La " +
            "constancia no trajo todo: …\" con lo que falta (por ejemplo \"No se pudo leer el código " +
            "postal\"). En ese caso, captura ese dato a mano.",
        },
        {
          type: "faq",
          items: [
            {
              q: "¿Sirve una foto o un escaneo de la constancia?",
              a:
                "No. Tiene que ser el PDF que se descarga del portal del SAT, porque su texto se puede leer. " +
                "Una foto o un escaneo es una imagen y no se puede leer. Si solo tiene foto, que capture los " +
                "datos a mano.",
            },
            {
              q: "¿Dónde consigue el cliente su constancia?",
              a:
                "En el portal del SAT (sat.gob.mx), en la opción para generar la constancia de situación " +
                "fiscal, con su RFC y contraseña o e.firma. También puede pedirla en la app SAT Móvil.",
            },
            {
              q: "Me aparece un aviso de que no se pudo leer el régimen.",
              a:
                "No impide la solicitud. Pide al cliente su clave de régimen (3 números, por ejemplo 626) o " +
                "consúltala tú en la constancia antes de facturar.",
            },
            {
              q: "El PDF pesa más de 8 MB.",
              a:
                "Una constancia normal pesa mucho menos. Pide al cliente que la descargue otra vez del SAT, " +
                "sin escanearla ni imprimirla.",
            },
            {
              q: "¿El pedido o la cotización sirven como factura?",
              a:
                "No. Son comprobantes de compra. La factura (CFDI) la emites tú con tu sistema de facturación " +
                "usando los datos guardados.",
            },
          ],
        },
      ],
      related: ["lo-que-ve-tu-cliente", "fotos-audio-y-video"],
    },
    {
      slug: "preguntas-cotizaciones",
      title: "Preguntas frecuentes: cotizaciones y pedidos",
      summary: "Dudas comunes al cotizar, cobrar y cancelar.",
      audience: "owner",
      keywords: ["faq", "cotización vencida", "precio cambió", "no puedo editar", "link no funciona"],
      body: [
        {
          type: "faq",
          items: [
            {
              q: "Cambié un precio y la cotización del cliente sigue con el anterior.",
              a:
                "Es a propósito: una cotización emitida conserva sus precios. Edítala (se recalcula con el " +
                "precio nuevo) o crea una nueva.",
            },
            {
              q: "No aparece un producto en el cotizador.",
              a: "Solo aparecen productos en estado Activo. Revisa en Catálogo que no esté en borrador o archivado.",
            },
            {
              q: "No me deja poner el descuento que quiero.",
              a:
                "Rebasa el \"Descuento máximo del vendedor\" de Admin → Empresa. Pide al Propietario que lo " +
                "suba o que haga la cotización.",
            },
            {
              q: "El botón \"Editar\" no aparece.",
              a:
                "La cotización está cancelada, vencida o su pedido ya se pagó. Crea una nueva o, si ya se " +
                "pagó, usa un reembolso.",
            },
            {
              q: "¿Puedo reactivar una cotización vencida?",
              a: "No. Crea una nueva; tomará los precios actuales del catálogo.",
            },
            {
              q: "El cliente no recibió el link de la cotización.",
              a:
                "En el detalle, da clic en \"Compartir\", copia el link y mándaselo tú por WhatsApp o correo.",
            },
            {
              q: "¿El cliente puede pagar en partes?",
              a:
                "No desde un mismo link. Si acordaste pagos parciales, usa Cobro rápido para cada parte.",
            },
          ],
        },
      ],
      related: ["crear-cotizacion", "de-cotizacion-a-pedido"],
    },
  ],
};
