import type { HelpCategory } from "./types";

export const clientes: HelpCategory = {
  slug: "clientes",
  title: "Clientes",
  articles: [
    {
      slug: "fichas-de-cliente",
      title: "Fichas de cliente",
      summary:
        "La ficha 360° de cada cliente: cifras de por vida, línea de tiempo, cotizaciones, pedidos, pagos, conversaciones, datos fiscales, direcciones, etiquetas y notas — y cómo archivar sin perder historial.",
      audience: "owner",
      keywords: [
        "rfc",
        "direcciones",
        "consentimiento",
        "whatsapp",
        "marketing",
        "archivar",
        "etiquetas",
        "notas",
        "constancia",
        "ticket promedio",
        "exportar",
        "csv",
      ],
      body: [
        {
          type: "p",
          text:
            "Una \"ficha de cliente\" es la carpeta digital de una persona: junta en un solo lugar sus " +
            "datos de contacto, lo que ha comprado, lo que se le ha cotizado, lo que ha pagado, sus " +
            "conversaciones de WhatsApp, sus datos para facturar, sus direcciones y las notas que el " +
            "equipo ha dejado sobre él. En Clientes ves el listado completo; al entrar a una fila se " +
            "abre su ficha.",
        },
        { type: "h3", text: "Lo primero que ves: la tira de cifras" },
        {
          type: "p",
          text:
            "Arriba de la ficha hay seis mosaicos con las cifras de por vida del cliente. Se calculan " +
            "en el momento a partir de sus pedidos y cotizaciones, así que siempre están al día.",
        },
        {
          type: "table",
          headers: ["Mosaico", "Qué mide"],
          rows: [
            ["Total pagado", "Suma de los pedidos que ya se pagaron o entregaron. Los reembolsados no cuentan."],
            ["Pedidos", "Cuántos pedidos tiene en total, en cualquier estado."],
            ["Ticket promedio", "Total pagado dividido entre los pedidos pagados: cuánto gasta por compra."],
            ["Última compra", "Fecha del último pedido pagado; abajo, la fecha de la primera."],
            ["Cotizaciones abiertas", "Cotizaciones en borrador o emitidas que todavía puede aceptar."],
            ["Cobros pendientes", "Pedidos con checkout abierto o esperando pago, y cuánto suman."],
          ],
        },
        { type: "h3", text: "Las pestañas" },
        {
          type: "p",
          text:
            "Debajo de las cifras, la ficha se organiza en pestañas. Cada una lista lo suyo con su " +
            "estado y un enlace para abrir el detalle (la cotización, el pedido, el pago o el hilo en " +
            "la bandeja de conversaciones).",
        },
        {
          type: "table",
          headers: ["Pestaña", "Contenido"],
          rows: [
            [
              "Resumen",
              "Línea de tiempo con todo mezclado por fecha (cotizaciones, pedidos, pagos, conversaciones y notas) más las direcciones, identidades de WhatsApp y consentimientos.",
            ],
            ["Cotizaciones", "Todas sus cotizaciones, con estado e importe."],
            ["Pedidos", "Sus pedidos, con origen (cotización, directo, chat, cobro rápido) y si pidió factura."],
            ["Pagos", "Cada sesión de cobro: cobrada, pendiente, fallida o reembolsada, con método de pago y pedido."],
            ["Conversaciones", "Los hilos de WhatsApp vinculados a la ficha; \"Ver conversación\" abre el más reciente en la bandeja."],
            ["Datos fiscales", "RFC, razón social, código postal fiscal, régimen y uso de CFDI, con la constancia si se subió."],
            ["Notas", "Bitácora interna con autor y fecha. El cliente nunca la ve."],
          ],
        },
        { type: "h3", text: "Contacto directo" },
        {
          type: "p",
          text:
            "En el encabezado, \"Abrir WhatsApp\" abre un chat con el teléfono del cliente en tu " +
            "WhatsApp (necesita el número con lada de país, por ejemplo +52…). \"Ver conversación\" te " +
            "lleva al hilo dentro de Easy Sell, donde puedes responder tú o dejar que el agente siga. " +
            "El teléfono y el correo también son enlaces: un toque marca o abre tu correo.",
        },
        { type: "h3", text: "Etiquetas" },
        {
          type: "p",
          text:
            "Las etiquetas son palabras libres para segmentar clientes: \"vip\", \"mayoreo\", " +
            "\"moroso\", \"zona norte\"… Se agregan con \"Editar\" (escribe la etiqueta y pulsa Enter), " +
            "se guardan en minúsculas y aparecen junto al nombre en la ficha y en el listado. En Clientes " +
            "puedes filtrar por etiqueta con el selector de arriba de la tabla.",
        },
        { type: "h3", text: "Datos fiscales y constancia" },
        {
          type: "p",
          text:
            "Para facturarle a un cliente hacen falta cuatro datos: RFC, razón social, código postal " +
            "fiscal y régimen fiscal; el quinto, el uso de CFDI, lo elige el cliente en cada factura. La " +
            "forma más rápida de llenarlos es subir su constancia de situación fiscal (el PDF del SAT) en " +
            "la pestaña Datos fiscales: el sistema la lee y completa los cuatro. Si algo no se pudo leer " +
            "(por ejemplo un escaneo borroso) te lo dice y lo capturas a mano con \"Editar\", que valida " +
            "el formato del RFC y del código postal.",
        },
        {
          type: "callout",
          tone: "info",
          text:
            "Cada pedido guarda su propia copia de los datos fiscales al momento de pedir la factura. Lo " +
            "que ves en la ficha es el \"último conocido\" del cliente y se usa para precargar la siguiente; " +
            "cambiarlo no altera facturas ya emitidas.",
        },
        { type: "h3", text: "Cómo se crea una ficha" },
        {
          type: "p",
          text:
            "La mayoría de las fichas se crean solas: cuando alguien te escribe por primera vez por WhatsApp, " +
            "el agente crea automáticamente su ficha y la deja ligada a esa conversación. Así, si esa misma " +
            "persona vuelve a escribir la semana siguiente desde el mismo número, el sistema reconoce que es " +
            "el mismo cliente y no crea una ficha duplicada — a esa conexión entre un número de WhatsApp y una " +
            "ficha se le llama internamente \"identidad\", y queda registrada dentro de la propia ficha.",
        },
        {
          type: "p",
          text:
            "También puedes crear una ficha manualmente con el botón \"Nuevo cliente\" desde el listado de " +
            "Clientes. Es útil para un negocio donde muchos clientes frecuentes compran en persona y nunca " +
            "han escrito por chat, pero quieres guardar sus datos para futuras promociones o para tener su " +
            "historial si algún día sí compran por WhatsApp.",
        },
        { type: "h3", text: "Direcciones" },
        {
          type: "p",
          text:
            "Un cliente puede guardar hasta 20 direcciones distintas — su casa, su negocio, la casa de un " +
            "familiar al que le manda pedidos. Desde la ficha se agregan, editan y eliminan, y una puede " +
            "quedar marcada como \"Predeterminada\" (la estrella): es la que se propone primero al " +
            "cotizar con envío. Eliminar una dirección no toca los pedidos ya creados.",
        },
        { type: "h3", text: "Notas internas" },
        {
          type: "p",
          text:
            "Hay dos tipos de nota. Las \"Notas de la ficha\" son un texto fijo que se edita con " +
            "\"Editar\" (preferencias, acuerdos de precio). La \"Bitácora\", en la pestaña Notas, guarda " +
            "entradas con quién la escribió y cuándo (\"llamó el martes, quiere factura\") y aparecen " +
            "también en la línea de tiempo. Ninguna de las dos se le muestra al cliente.",
        },
        { type: "h3", text: "Consentimientos" },
        {
          type: "p",
          text:
            "Un \"consentimiento\" es el permiso que un cliente te dio (o no) para hacer algo puntual con " +
            "sus datos o para contactarlo de cierta forma. Se registran tres tipos distintos, y cada uno " +
            "cubre una cosa distinta — que un cliente te haya dado uno no significa que te haya dado los " +
            "otros dos.",
        },
        {
          type: "table",
          headers: ["Tipo", "Se ve como", "Cubre"],
          rows: [
            ["WHATSAPP", "WhatsApp", "Que puedas escribirle por WhatsApp para temas relacionados con su compra o su cuenta."],
            ["MARKETING", "Marketing", "Que puedas mandarle promociones, ofertas o novedades, no solo mensajes sobre una compra puntual."],
            ["DATA_PROCESSING", "Tratamiento de datos", "Que puedas guardar y usar sus datos personales dentro del sistema en primer lugar."],
          ],
        },
        {
          type: "callout",
          tone: "warning",
          title: "Por qué importa no dar por hecho un consentimiento",
          text:
            "Que un cliente te haya escrito por WhatsApp no significa automáticamente que aceptó recibir " +
            "publicidad tuya (eso sería MARKETING) ni que autorizó cualquier uso de sus datos (eso sería " +
            "DATA_PROCESSING) — son permisos separados. Trátalos como lo que son: constancias puntuales de lo " +
            "que el cliente sí aceptó, ni más ni menos.",
        },
        { type: "h3", text: "El listado y la exportación" },
        {
          type: "p",
          text:
            "El listado de Clientes muestra, además del contacto y el RFC, la última compra y el total " +
            "pagado de cada cliente (con un aviso si tiene cobros pendientes) y sus etiquetas. Puedes " +
            "buscar por nombre, correo, teléfono o RFC, filtrar por etiqueta y quedarte solo con los que " +
            "tienen un cobro pendiente. \"Exportar CSV\" baja el listado con los filtros aplicados " +
            "(hasta 5,000 clientes) para abrirlo en Excel o Google Sheets.",
        },
        { type: "h3", text: "Archivar un cliente" },
        {
          type: "p",
          text:
            "Si un cliente ya no es relevante — se fue de la zona, dejó de comprar, o pidió que dejaras de " +
            "contactarlo — puedes archivarlo desde su ficha con el botón \"Archivar\". El sistema te va a " +
            "pedir que confirmes, precisamente para evitar que archives a alguien por error con un clic.",
        },
        {
          type: "callout",
          tone: "info",
          text:
            "Un cliente archivado no se borra: solo queda oculto de las listas por defecto y deja de poder " +
            "recibir nuevas cotizaciones mientras esté en ese estado. Su historial completo de compras y " +
            "cotizaciones sigue intacto, y puedes traerlo de vuelta cuando haga falta con el botón " +
            "\"Restaurar\" desde la misma ficha.",
        },
      ],
    },
    {
      slug: "preguntas-clientes",
      title: "Preguntas frecuentes: clientes",
      summary:
        "Dudas comunes sobre fichas duplicadas, datos del cliente, etiquetas, facturación, consentimientos y archivar.",
      audience: "owner",
      keywords: [
        "faq",
        "cliente duplicado",
        "editar cliente",
        "restaurar cliente",
        "baja",
        "no molestar",
        "etiqueta",
        "constancia",
        "exportar",
      ],
      body: [
        {
          type: "faq",
          items: [
            {
              q: "¿Cómo creo un cliente a mano?",
              a:
                "En Clientes, da clic en \"Nuevo cliente\". Solo el nombre es obligatorio; correo, teléfono, " +
                "RFC, etiquetas y notas se pueden completar después con \"Editar\" desde su ficha.",
            },
            {
              q: "Tengo al mismo cliente dos veces.",
              a:
                "Pasa cuando una persona escribe desde otro número o se creó una ficha a mano antes. Usa una " +
                "de las dos para sus compras nuevas y archiva la que sobra. El historial de cada ficha se " +
                "conserva.",
            },
            {
              q: "No puedo cotizarle a un cliente.",
              a: "Probablemente está archivado. Abre su ficha y da clic en \"Restaurar\".",
            },
            {
              q: "Un cliente pidió que ya no le escribamos.",
              a:
                "En su ficha, revoca los consentimientos de WhatsApp y Marketing. El sistema no le manda " +
                "recordatorios automáticos a clientes que pidieron la baja. Si quieres, agrégale una etiqueta " +
                "como \"no-contactar\" para verlo de un vistazo en el listado.",
            },
            {
              q: "¿El agente llena los datos del cliente solo?",
              a:
                "Sí: crea la ficha con el teléfono de WhatsApp y guarda el nombre (y el correo, si lo tienes " +
                "activado) cuando el cliente se los da. Si el cliente pide factura, también guarda su RFC y " +
                "razón social.",
            },
            {
              q: "¿Dónde veo todo lo que le he vendido a un cliente?",
              a:
                "En su ficha: los mosaicos de arriba dan el total pagado, el ticket promedio y la última " +
                "compra; la pestaña Pedidos lista cada pedido y la pestaña Pagos cada cobro. La pestaña " +
                "Resumen mezcla todo por fecha.",
            },
            {
              q: "¿Cómo lleno los datos fiscales de un cliente rápido?",
              a:
                "En la pestaña Datos fiscales, sube su constancia de situación fiscal (PDF del SAT). El " +
                "sistema lee RFC, razón social, código postal y régimen. Solo te queda elegir el uso de CFDI, " +
                "que no viene en el documento.",
            },
            {
              q: "¿Qué significa el aviso \"Faltan datos para facturar\"?",
              a:
                "Que a la ficha le falta alguno de los cuatro datos fiscales (RFC, razón social, código postal " +
                "o régimen). Puedes seguir vendiéndole; solo hará falta completarlos si pide factura.",
            },
            {
              q: "\"Abrir WhatsApp\" no aparece en la ficha.",
              a:
                "El teléfono guardado no tiene formato válido para WhatsApp. Edita el cliente y captura el " +
                "número con lada de país (por ejemplo +52 55 1234 5678).",
            },
            {
              q: "¿Puedo sacar la lista de clientes a Excel?",
              a:
                "Sí: en Clientes, \"Exportar CSV\" descarga el listado con los filtros que tengas puestos " +
                "(búsqueda, etiqueta, cobro pendiente), incluyendo última compra y total pagado.",
            },
          ],
        },
      ],
      related: ["fichas-de-cliente"],
    },
  ],
};
