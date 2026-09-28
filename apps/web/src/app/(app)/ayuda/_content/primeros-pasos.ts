import type { HelpCategory } from "./types";

export const primerosPasos: HelpCategory = {
  slug: "primeros-pasos",
  title: "Primeros pasos",
  articles: [
    {
      slug: "que-es-atiende-ya",
      title: "Qué es Atiende ya",
      summary:
        "El portal operativo de tu tienda: el cliente escribe por WhatsApp, un agente automático responde con tu catálogo real y tú ves y cierras la venta desde el panel.",
      audience: "both",
      keywords: ["bot", "whatsapp", "cómo funciona", "agente automático"],
      body: [
        {
          type: "p",
          text:
            "Atiende ya conecta tres cosas que normalmente viven separadas: tu catálogo de productos, tus " +
            "clientes y tu WhatsApp de negocio. Todo queda en un solo lugar, que es el panel que estás usando " +
            "ahora. La idea es simple: un cliente te escribe por WhatsApp, un programa automático (el " +
            "\"agente\") le contesta usando tu catálogo real —los mismos precios y existencias que tú ves aquí, " +
            "no una copia vieja—, y si el cliente quiere comprar, el agente arma una cotización y, si la " +
            "acepta, genera un link de pago. Tú puedes ver todo ese proceso desde el panel en cualquier " +
            "momento, y puedes meterte a cualquier conversación tú mismo cuando haga falta, por ejemplo si el " +
            "cliente pregunta algo que el agente no sabe contestar.",
        },
        {
          type: "p",
          text:
            "Dos palabras que vas a ver seguido: una \"cotización\" es una propuesta de compra con productos, " +
            "cantidades y precio total, todavía sin pagar — es el equivalente a cuando alguien pide precio y tú " +
            "le apuntas en una libreta cuánto le va a costar. Un \"pedido\" es lo que resulta cuando esa " +
            "cotización se confirma y se paga (o se acuerda pagar). El \"link de pago\" es una dirección web " +
            "que le mandas al cliente para que pague con tarjeta u otro método, sin que tenga que ir a tu " +
            "tienda a pagar en efectivo.",
        },
        {
          type: "h3", text: "Un ejemplo completo, de principio a fin",
        },
        {
          type: "steps",
          items: [
            "Un cliente de una taquería le escribe por WhatsApp: \"¿tienen orden de bistec y cuánto cuesta?\".",
            "El agente busca en tu catálogo real, ve el precio y la existencia vigentes, y responde con esa " +
              "información — no con un precio fijo escrito a mano en un mensaje automático, sino con el precio " +
              "que tú tienes cargado en Catálogo en ese momento.",
            "El cliente dice que sí quiere. El agente arma una cotización con esa orden (y cualquier otra cosa " +
              "que el cliente vaya agregando, como refrescos o una orden extra).",
            "El cliente confirma que quiere pagar. El agente genera un link de pago y se lo manda por el mismo " +
              "chat.",
            "El cliente paga desde ese link, con su celular, sin salir de WhatsApp.",
            "Tú ves ese pago reflejado en el panel, en Pagos y en Pedidos, sin haber tenido que hacer nada — " +
              "el agente hizo la venta solo, de principio a fin.",
          ],
        },
        {
          type: "p",
          text:
            "Ese es el caso ideal. En la práctica, el agente no siempre puede resolverlo todo: si el cliente " +
            "pregunta algo raro, se queja, o pide algo que no está en el catálogo, tú puedes entrar a esa " +
            "misma conversación desde Conversaciones y contestar tú mismo, como si fueras un vendedor tomando " +
            "el chat. El cliente no nota ninguna diferencia técnica: sigue siendo el mismo número de WhatsApp, " +
            "la misma conversación.",
        },
        {
          type: "h3", text: "Qué encuentras en cada parte del panel",
        },
        {
          type: "list",
          items: [
            "Catálogo: tus productos y variantes (por ejemplo, un mismo producto en distintos tamaños o " +
              "colores), cada uno con su precio y su existencia (cuánto tienes disponible para vender).",
            "Clientes: una ficha por cada persona que te ha comprado o cotizado, con su historial completo.",
            "Cotizaciones y pedidos: todo el camino desde que se arma el carrito de compra hasta que se cobra.",
            "Conversaciones: la bandeja de WhatsApp, tanto lo que contesta el agente como lo que contestas tú.",
            "Administración: la marca de tu negocio, quién tiene acceso (usuarios), notificaciones, seguridad " +
              "y las llaves (API keys) que usan integraciones externas.",
          ],
        },
        {
          type: "callout",
          tone: "info",
          title: "Modo de pruebas",
          text:
            "Si en la barra superior del panel ves la etiqueta \"Pruebas\", significa que los pagos que se " +
            "generan son simulados: pasan por una \"pasarela de pago\" de prueba (dummy gateway), que es un " +
            "sistema que se comporta igual que el de pagos reales pero sin mover dinero de verdad. Nadie paga " +
            "nada real y a ti no te llega ni un peso, aunque en pantalla se vea como una venta completa. Sirve " +
            "para que pruebes todo el flujo — desde que el cliente escribe hasta que \"paga\" — antes de " +
            "activar los pagos reales. Cuando tu negocio pase a producción, esa etiqueta desaparece y los " +
            "cobros que se generen ya sí mueven dinero real; por eso conviene hacer al menos una compra de " +
            "prueba completa mientras la etiqueta \"Pruebas\" todavía está ahí, para confirmar que todo el " +
            "recorrido funciona como esperas.",
        },
        {
          type: "callout",
          tone: "warning",
          title: "El agente necesita WhatsApp conectado",
          text:
            "Para que un cliente pueda escribirle al agente, primero tiene que existir una conexión activa de " +
            "WhatsApp para tu negocio (eso se configura en Canales, dentro de la sección \"Agente IA\" del " +
            "menú). Sin esa conexión, el catálogo y las cotizaciones existen igual en el panel, pero no hay " +
            "ningún número de WhatsApp real recibiendo mensajes de clientes.",
        },
      ],
      related: ["recorrido-del-panel", "roles-de-usuario"],
    },
    {
      slug: "recorrido-del-panel",
      title: "Recorrido del panel",
      summary:
        "Qué hace cada sección del menú lateral, en qué orden conviene revisarlas la primera vez, y qué significan los términos que vas a encontrar en cada una.",
      audience: "both",
      keywords: ["menú", "navegación", "sidebar", "secciones"],
      body: [
        {
          type: "p",
          text:
            "El menú lateral es la forma principal de moverte por el panel. Está agrupado por tema, no por " +
            "orden alfabético, para que las secciones que usas juntas queden cerca. Además del menú, hay un " +
            "enlace \"Inicio\" que te regresa siempre a la pantalla principal, sin importar en qué sección " +
            "estés — úsalo si te pierdes.",
        },
        { type: "h3", text: "Operación" },
        {
          type: "p",
          text:
            "Esta es la parte que usas para el trabajo diario de vender: catálogo, cotizar, cobrar, dar " +
            "seguimiento a pedidos y llevar el registro de tus clientes.",
        },
        {
          type: "list",
          items: [
            "Catálogo — tus productos, sus variantes (talla, color, presentación), precios, existencias y " +
              "fotos. Es la fuente de verdad que usa el agente cuando cotiza: si cambias un precio aquí, el " +
              "agente cotiza con el precio nuevo de inmediato.",
            "Cotizaciones — todas las cotizaciones que existen, en cualquiera de sus estados: en borrador " +
              "(todavía se está armando), emitida (ya se le mandó al cliente), aceptada (el cliente dijo que " +
              "sí) o vencida (se pasó la fecha límite y ya no se puede aceptar tal cual).",
            "Cobro rápido — para cuando quieres cobrarle a alguien un monto libre, sin tener que pasar por " +
              "catálogo ni armar una cotización formal. Útil por ejemplo para un cobro de servicio o un ajuste " +
              "que no corresponde a ningún producto puntual.",
            "Pedidos — los pedidos que ya se generaron, sea porque una cotización se aceptó o porque se creó " +
              "un pedido directo. Aquí ves su \"checkout\" (el proceso en el que el cliente completa el pago) " +
              "y en qué estado va.",
            "Pagos — el detalle de cada intento de cobro (sesión de cobro), un \"libro de movimientos\" (un " +
              "listado ordenado de todo lo que entró y salió, parecido a un estado de cuenta bancario) y los " +
              "reembolsos que se hayan hecho.",
            "Clientes — la ficha de cada persona: sus datos de contacto, sus direcciones guardadas y sus " +
              "consentimientos (los permisos que te dio para contactarlo o usar sus datos).",
          ],
        },
        { type: "h3", text: "Agente IA" },
        {
          type: "p",
          text:
            "Aquí configuras y pones a prueba al agente automático que contesta por WhatsApp, y aquí también " +
            "está la bandeja real de conversaciones con tus clientes.",
        },
        {
          type: "list",
          items: [
            "Chat con el agente — te deja probar al agente tú mismo, escribiéndole como si fueras un cliente " +
              "cualquiera. Es la forma más rápida de detectar si algo del catálogo o del comportamiento del " +
              "agente no está como quieres, sin arriesgar una conversación real.",
            "Consola del agente — muestra qué sabe el agente de tu negocio (qué información tiene disponible) " +
              "y cómo está configurado su comportamiento.",
            "Canales — las conexiones de WhatsApp de tu negocio, sea a través de Meta (el proveedor oficial de " +
              "WhatsApp Business) o de Evolution (otro proveedor de conexión). Sin al menos un canal " +
              "conectado, el agente no puede recibir mensajes reales.",
            "Conversaciones — la bandeja real de WhatsApp: cada \"hilo\" (la conversación completa con un " +
              "cliente en particular), quién la está atendiendo en este momento (el agente o una persona), y " +
              "notas internas que puedes dejar para el equipo.",
          ],
        },
        { type: "h3", text: "Sistema" },
        {
          type: "list",
          items: [
            "Admin — la configuración de tu empresa: datos de la empresa, marca (logo y colores), envío a " +
              "domicilio, quién tiene acceso (usuarios), llaves de integración (API keys), notificaciones y " +
              "seguridad.",
            "Ayuda — esta guía que estás leyendo.",
          ],
        },
        {
          type: "callout",
          tone: "info",
          title: "Si eres super-admin de la plataforma",
          text:
            "Además de todo lo anterior, ves un grupo aparte llamado \"Plataforma\" en la parte de arriba del " +
            "menú, con: Resumen (una vista general de toda la plataforma, no solo de una empresa), Empresas " +
            "(el listado de todos los negocios que usan Atiende ya), Uso y costos, y API keys globales. Esto " +
            "es distinto de lo que ve el dueño de un negocio normal, que solo ve su propia empresa.",
        },
        {
          type: "callout",
          tone: "info",
          title: "No todos ven lo mismo",
          text:
            "Lo que aparece en tu menú depende de tu rol (VENDOR, FINANCE, CATALOG, etc.). Por ejemplo, alguien " +
            "con rol CATALOG probablemente no vea la sección Pagos, porque su trabajo es solo el catálogo. Si " +
            "a ti te falta una sección que esperabas ver, puede ser que tu rol no incluya acceso a ella — " +
            "revisa el artículo sobre roles para confirmarlo.",
        },
      ],
      related: ["que-es-atiende-ya", "roles-de-usuario"],
    },
    {
      slug: "roles-de-usuario",
      title: "Roles y qué puede hacer cada uno",
      summary:
        "OWNER, ADMIN, VENDOR, FINANCE, CATALOG, SUPPORT, VIEWER: qué ve y qué puede modificar cada rol, y cómo invitar a alguien con el rol correcto.",
      audience: "owner",
      keywords: ["permisos", "invitación", "usuarios", "invitar-usuarios", "accesos"],
      body: [
        {
          type: "p",
          text:
            "Cada persona que forma parte de tu empresa dentro del panel — tú, tus empleados, tu contador — " +
            "tiene un \"rol\" asignado. El rol es una etiqueta que decide dos cosas a la vez: qué secciones del " +
            "menú puede ver, y qué puede hacer dentro de esas secciones (solo mirar, o también cambiar cosas). " +
            "Esto existe para que cada persona tenga acceso a exactamente lo que necesita para su trabajo, ni " +
            "más ni menos.",
        },
        {
          type: "p",
          text:
            "Por qué esto importa en la práctica: si le das a un vendedor de mostrador el mismo acceso que a " +
            "ti como dueño, esa persona podría, sin mala intención, cambiar el precio de un producto por " +
            "error, o ver los reembolsos y pagos de toda la empresa. Dándole el rol correcto — por ejemplo " +
            "VENDOR — evitas ese riesgo desde el principio, sin tener que estar revisando después qué cambió " +
            "cada quien.",
        },
        {
          type: "table",
          headers: ["Rol", "Para quién es", "Puede"],
          rows: [
            ["OWNER", "Dueño del negocio", "Todo: incluida administración de la empresa, usuarios y API keys."],
            ["ADMIN", "Mano derecha del dueño", "Casi todo, salvo lo reservado a OWNER (dar de baja la empresa, ceder otro OWNER)."],
            ["VENDOR", "Vendedor / atención al cliente", "Catálogo (lectura), clientes, cotizaciones, pedidos propios, chat."],
            ["FINANCE", "Cuentas por cobrar", "Ver catálogo/clientes/cotizaciones/pedidos, pagos y reembolsos."],
            ["CATALOG", "Encargado de catálogo", "Solo catálogo, lectura y escritura."],
            ["SUPPORT", "Atención al cliente sin ventas", "Ver catálogo/clientes/cotizaciones/pedidos, y chat."],
            ["VIEWER", "Solo consulta", "Ver catálogo, clientes, cotizaciones, pedidos y notificaciones — nada de escritura."],
          ],
        },
        {
          type: "p",
          text:
            "Algunos ejemplos concretos para elegir bien: si contratas a alguien solo para tomar fotos de " +
            "producto, escribir descripciones y actualizar precios en una tienda de pinturas, dale el rol " +
            "CATALOG — así puede hacer su trabajo completo pero no puede ver los datos de tus clientes ni tus " +
            "pagos, aunque quisiera. Si tu contador solo necesita revisar qué se cobró y qué se reembolsó en " +
            "una boutique, FINANCE le basta — no necesita ni debería poder cambiar el catálogo. Si alguien va " +
            "a atender el chat de WhatsApp de una taquería y cerrar ventas, VENDOR es lo normal.",
        },
        {
          type: "h3", text: "Cómo invitar a alguien" },
        {
          type: "steps",
          items: [
            "Ve a Admin en el menú lateral y abre la pestaña \"Usuarios\".",
            "Ahí abres el formulario \"Invitar usuario\".",
            "Escribe su nombre completo y su correo, y elige su rol en el menú desplegable.",
            "Al guardar, la persona recibe un correo con un link de invitación.",
            "Cuando esa persona abre el link y crea su contraseña, ya puede entrar al panel con el rol que le " +
              "asignaste.",
          ],
        },
        {
          type: "callout",
          tone: "info",
          title: "OWNER y ADMIN no se asignan al invitar",
          text:
            "Cuando invitas a alguien nuevo, el formulario solo te deja elegir entre Vendedor, Finanzas, " +
            "Catálogo, Soporte o Lectura (los roles VENDOR, FINANCE, CATALOG, SUPPORT y VIEWER, mostrados en " +
            "español). Los roles OWNER y ADMIN no aparecen ahí a propósito: son roles de mucha confianza, y se " +
            "asignan después, cambiando el rol de alguien que ya forma parte del equipo desde esa misma tabla " +
            "de Usuarios — no desde el formulario de invitación inicial.",
        },
        {
          type: "callout",
          tone: "warning",
          title: "Si te equivocas de rol",
          text:
            "No es un problema grave ni definitivo: puedes cambiar el rol de una persona más adelante desde la " +
            "misma tabla de Usuarios en Admin, sin tener que volver a invitarla. Mientras tanto, si le diste un " +
            "rol demasiado limitado, simplemente no va a ver algunas secciones hasta que lo corrijas; no borra " +
            "ni pierde nada.",
        },
      ],
      related: ["recorrido-del-panel", "invitar-usuarios"],
    },
  ],
};
