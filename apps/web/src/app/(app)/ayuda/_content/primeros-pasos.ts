import type { HelpCategory } from "./types";

export const primerosPasos: HelpCategory = {
  slug: "primeros-pasos",
  title: "Primeros pasos",
  articles: [
    {
      slug: "que-es-easy-sell",
      title: "Qué es Easy Sell",
      summary:
        "El portal operativo de tu tienda: el cliente escribe por WhatsApp, un agente automático responde con tu catálogo real y tú ves y cierras la venta desde el panel.",
      audience: "both",
      keywords: ["bot", "whatsapp", "cómo funciona", "agente automático", "inicio", "introducción"],
      body: [
        {
          type: "p",
          text:
            "Easy Sell junta en un solo lugar tres cosas que normalmente viven separadas: tu catálogo de " +
            "productos, tus clientes y tu WhatsApp de negocio. Ese lugar es el panel que estás usando ahora.",
        },
        {
          type: "p",
          text:
            "La idea es esta: un cliente te escribe por WhatsApp. Un programa automático, al que llamamos " +
            "\"el agente\", le contesta usando tu catálogo real: los mismos precios y existencias que tú ves " +
            "aquí, no una copia vieja. Si el cliente quiere comprar, el agente arma una cotización. Si el " +
            "cliente la acepta, el agente le manda un link de pago. Tú puedes ver todo eso desde el panel, y " +
            "puedes entrar a cualquier conversación cuando quieras para contestar tú.",
        },
        {
          type: "p",
          text:
            "Tres palabras que vas a ver en todas partes. Una \"cotización\" es una propuesta de compra: " +
            "productos, cantidades y total, todavía sin pagar. Un \"pedido\" es lo que nace cuando esa " +
            "cotización se acepta y se va a cobrar. Un \"link de pago\" es una dirección web que le mandas " +
            "al cliente para que pague con tarjeta, transferencia SPEI o efectivo desde su celular.",
        },
        { type: "h3", text: "Un ejemplo completo, de principio a fin" },
        {
          type: "steps",
          items: [
            "Un cliente de una taquería escribe por WhatsApp: \"¿tienen orden de bistec y cuánto cuesta?\".",
            "El agente busca en tu catálogo, ve el precio y la existencia de ese momento, y contesta con " +
              "esos datos. No usa un precio escrito a mano en un mensaje automático.",
            "El cliente dice que sí quiere. El agente le pide su nombre (siempre lo hace antes de cotizar) " +
              "y arma una cotización con la orden y lo que el cliente vaya agregando.",
            "El cliente confirma. El agente genera el link de pago y lo manda por el mismo chat.",
            "El cliente paga desde ese link en su celular.",
            "Tú ves el pago en Pagos y el pedido en Pedidos. No tuviste que hacer nada: el agente hizo la " +
              "venta completa.",
          ],
        },
        {
          type: "p",
          text:
            "Ese es el caso ideal. A veces el cliente pregunta algo que el agente no sabe, se queja o pide " +
            "un precio especial. En esos casos el agente pasa la conversación a una persona. Tú la tomas " +
            "desde Conversaciones y contestas desde el panel. El cliente sigue en el mismo chat, con el mismo " +
            "número, y no nota ningún cambio técnico.",
        },
        { type: "h3", text: "Qué encuentras en cada parte del panel" },
        {
          type: "list",
          items: [
            "Inicio: un resumen de ventas, pedidos, cotizaciones y conversaciones del día.",
            "Catálogo: tus productos y sus variantes (por ejemplo tallas, colores o tamaños), con precio, " +
              "existencia y fotos.",
            "Cotizaciones, Cobro rápido, Pedidos y Pagos: todo el camino desde que alguien pide precio " +
              "hasta que el dinero entra (y, si hace falta, se devuelve).",
            "Clientes: una ficha por persona, con su historial completo.",
            "Chat con el agente, Consola del agente, Canales y Conversaciones: todo lo del agente y de " +
              "WhatsApp.",
            "Admin: datos de tu empresa, marca, envíos, usuarios, llaves de integración, notificaciones y " +
              "seguridad.",
          ],
        },
        {
          type: "callout",
          tone: "info",
          title: "Modo de pruebas",
          text:
            "Si ves la etiqueta \"Pruebas\" (en el panel, en el link de pago o en la pantalla de \"pago " +
            "aplicado\"), los pagos son simulados. Todo se ve como una venta real, pero no se mueve dinero. " +
            "Sirve para practicar el recorrido completo antes de cobrar de verdad. Haz al menos una compra " +
            "de prueba completa mientras la etiqueta siga ahí.",
        },
        {
          type: "callout",
          tone: "warning",
          title: "El agente necesita WhatsApp conectado",
          text:
            "Para que un cliente le escriba al agente, primero conecta un número en Canales. Sin eso, el " +
            "catálogo y las cotizaciones funcionan en el panel, pero ningún mensaje de WhatsApp entra.",
        },
      ],
      related: ["lista-de-arranque", "recorrido-del-panel", "roles-de-usuario"],
    },
    {
      slug: "lista-de-arranque",
      title: "Lista de arranque: tu primer día",
      summary:
        "Los pasos, en orden, para dejar tu negocio listo para vender por WhatsApp: empresa, catálogo, envíos, agente, canal y una compra de prueba.",
      audience: "owner",
      keywords: ["configurar", "empezar", "checklist", "onboarding", "configuración inicial", "primer día"],
      body: [
        {
          type: "p",
          text:
            "Sigue esta lista de arriba hacia abajo. Cada paso depende del anterior: por ejemplo, el agente " +
            "no puede cotizar productos que todavía no existen en tu catálogo. Calcula de una a dos horas si " +
            "tu catálogo es pequeño.",
        },
        { type: "h3", text: "1. Revisa los datos de tu empresa" },
        {
          type: "steps",
          items: [
            "Ve a Admin → Empresa.",
            "Revisa el IVA (normalmente 16%), el envío fijo, el descuento máximo de tus vendedores y las " +
              "vigencias de cotización y de link de pago.",
            "Da clic en \"Guardar cambios\".",
          ],
        },
        { type: "h3", text: "2. Pon tu marca" },
        {
          type: "steps",
          items: [
            "Ve a Admin → Marca.",
            "Sube tu logo y elige tus colores. Tus clientes los ven en el link de cotización y en el de pago.",
          ],
        },
        { type: "h3", text: "3. Carga tu catálogo" },
        {
          type: "steps",
          items: [
            "Ve a Catálogo. Crea tus productos uno por uno con \"Nuevo producto\", o impórtalos todos con un " +
              "archivo CSV.",
            "Agrega fotos: ayudan al cliente y al agente.",
            "Activa cada producto (estado \"Activo\"). Un producto en borrador no se vende.",
          ],
        },
        { type: "h3", text: "4. Configura el envío a domicilio (si repartes)" },
        {
          type: "steps",
          items: [
            "Ve a Admin → Envío a domicilio.",
            "Crea tus zonas por código postal, ciudad o estado, con su precio.",
          ],
        },
        { type: "h3", text: "5. Enséñale tu negocio al agente" },
        {
          type: "steps",
          items: [
            "Ve a Consola del agente → pestaña General.",
            "Usa \"Crear bot con IA\": describe tu negocio en tus palabras y el sistema arma un borrador " +
              "con nombre, tono, horarios y reglas. Revísalo y da clic en \"Aplicar\".",
            "En la pestaña Conocimiento, agrega lo que el agente debe saber: horarios, dirección, formas de " +
              "pago, políticas de cambio.",
          ],
        },
        { type: "h3", text: "6. Prueba al agente sin clientes reales" },
        {
          type: "steps",
          items: [
            "Ve a Chat con el agente.",
            "Escríbele como si fueras un cliente: pregunta precios, pide envío, pide una cotización.",
            "Si algo no te gusta, corrige el catálogo, el conocimiento o la configuración y vuelve a probar.",
          ],
        },
        { type: "h3", text: "7. Conecta tu WhatsApp" },
        {
          type: "steps",
          items: [
            "Ve a Canales → \"Conectar canal\".",
            "Elige Evolution (con QR, lo más rápido) o Meta (si ya tienes la API oficial aprobada).",
            "Espera a ver el canal como \"Conectado\".",
          ],
        },
        { type: "h3", text: "8. Invita a tu equipo" },
        {
          type: "steps",
          items: [
            "Ve a Admin → Usuarios → \"Invitar usuario\".",
            "Dale a cada persona el rol que necesita, no más.",
            "Marca como \"Agente WhatsApp activo\" a quienes van a atender conversaciones.",
          ],
        },
        { type: "h3", text: "9. Haz una compra de prueba completa" },
        {
          type: "steps",
          items: [
            "Desde otro celular, escribe a tu número de WhatsApp como si fueras un cliente.",
            "Pide un producto, acepta la cotización y paga con el link.",
            "Revisa que el pedido aparezca en Pedidos como pagado y el cobro en Pagos.",
          ],
        },
        {
          type: "callout",
          tone: "success",
          title: "Protege tu cuenta",
          text:
            "Antes de terminar, activa la verificación en dos pasos en Admin → Seguridad. Tarda dos minutos y " +
            "evita que alguien entre aunque adivine tu contraseña.",
        },
      ],
      related: ["productos-y-variantes", "configurar-el-agente", "conectar-whatsapp", "chat-de-prueba"],
    },
    {
      slug: "recorrido-del-panel",
      title: "Recorrido del panel",
      summary:
        "Qué hace cada sección del menú lateral, cómo buscar rápido, y qué significan los términos que vas a encontrar en cada una.",
      audience: "both",
      keywords: ["menú", "navegación", "sidebar", "secciones", "buscar", "atajo", "ctrl k"],
      body: [
        {
          type: "p",
          text:
            "El menú lateral es la forma principal de moverte por el panel. Está agrupado por tema, para que " +
            "las secciones que usas juntas queden cerca. En celular, el menú se abre con el botón de menú " +
            "de la parte de arriba.",
        },
        { type: "h3", text: "Inicio" },
        {
          type: "p",
          text:
            "Es la primera pantalla al entrar. Muestra un panorama: ventas cobradas de hoy y del mes, pedidos " +
            "por pagar, cotizaciones emitidas, conversaciones abiertas, productos activos y clientes totales. " +
            "Abajo ves una gráfica de ventas de los últimos 7 días, los últimos pedidos, las últimas " +
            "conversaciones y la actividad reciente del equipo.",
        },
        { type: "h3", text: "Operación" },
        {
          type: "list",
          items: [
            "Catálogo: productos, variantes, precios, existencias y fotos. El agente cotiza con lo que hay " +
              "aquí. Si cambias un precio, el agente usa el precio nuevo de inmediato.",
            "Cotizaciones: todas tus cotizaciones, en borrador, emitidas, aceptadas, vencidas o canceladas.",
            "Cobro rápido: para cobrar un monto libre sin cotización. Por ejemplo, un servicio que no está " +
              "en tu catálogo.",
            "Pedidos: las ventas que ya se están cobrando o que ya se cobraron, con su estado.",
            "Pagos: cada intento de cobro, su libro de movimientos y los reembolsos.",
            "Clientes: la ficha de cada persona, con sus datos, direcciones, permisos e historial.",
          ],
        },
        { type: "h3", text: "Agente IA" },
        {
          type: "list",
          items: [
            "Chat con el agente: habla con tu agente como si fueras un cliente, para probarlo.",
            "Consola del agente: la configuración del agente, lo que sabe de tu negocio, lo que está " +
              "aprendiendo y las acciones que puede hacer.",
            "Canales: tus números de WhatsApp conectados.",
            "Conversaciones: la bandeja real de WhatsApp, donde tú y tu equipo atienden a los clientes.",
          ],
        },
        { type: "h3", text: "Sistema y ayuda" },
        {
          type: "list",
          items: [
            "Admin: empresa, marca, envío a domicilio, usuarios, API keys, notificaciones y seguridad.",
            "Ayuda: esta guía.",
            "Soporte (en el menú de tu usuario, arriba a la derecha): cómo escribirnos si tienes un " +
              "problema.",
          ],
        },
        { type: "h3", text: "Buscar cualquier cosa" },
        {
          type: "p",
          text:
            "Arriba del panel hay un buscador para encontrar un producto o un cliente sin navegar. Ábrelo " +
            "con Ctrl + K (en Windows) o Cmd + K (en Mac), o con la tecla / cuando no estés escribiendo en " +
            "otro campo. Escribe parte del nombre o del SKU y elige el resultado.",
        },
        {
          type: "callout",
          tone: "info",
          title: "No todos ven lo mismo",
          text:
            "Tu menú depende de tu rol. Por ejemplo, alguien con rol Catálogo no ve Pagos. Si te falta una " +
            "sección, pide a quien administra tu empresa que revise tu rol.",
        },
        {
          type: "callout",
          tone: "info",
          title: "Si eres super-admin de la plataforma",
          text:
            "Ves además un grupo \"Plataforma\" con Resumen, Empresas, Usuarios, Uso y costos, y API keys " +
            "globales. El dueño de un negocio normal solo ve su propia empresa.",
        },
      ],
      related: ["que-es-easy-sell", "roles-de-usuario", "entrar-a-tu-cuenta"],
    },
    {
      slug: "entrar-a-tu-cuenta",
      title: "Entrar, recuperar tu contraseña y cerrar sesión",
      summary:
        "Cómo iniciar sesión, qué hacer si olvidaste tu contraseña, cómo activar una invitación y por qué a veces el panel te pide entrar de nuevo.",
      audience: "both",
      keywords: ["login", "iniciar sesión", "olvidé mi contraseña", "recuperar", "sesión expirada", "invitación", "activar cuenta"],
      body: [
        { type: "h3", text: "Iniciar sesión" },
        {
          type: "steps",
          items: [
            "Abre la página del panel. Si no tienes sesión, ves la pantalla \"Iniciar sesión\".",
            "Escribe tu correo y tu contraseña.",
            "Da clic en \"Iniciar sesión\".",
            "Si tienes la verificación en dos pasos activa, el panel te pide un \"Código de verificación\". " +
              "Abre tu app autenticadora y escribe los 6 números que muestra en ese momento. Tienes 5 " +
              "minutos para hacerlo.",
          ],
        },
        {
          type: "callout",
          tone: "warning",
          title: "Demasiados intentos",
          text:
            "Si escribes mal la contraseña varias veces seguidas, el sistema bloquea los intentos por 15 " +
            "minutos y muestra \"Demasiados intentos\". Es una protección contra quien intenta adivinar " +
            "contraseñas. Espera y vuelve a intentar, o recupera tu contraseña.",
        },
        { type: "h3", text: "Olvidé mi contraseña" },
        {
          type: "steps",
          items: [
            "En la pantalla de inicio de sesión, da clic en \"¿Olvidaste tu contraseña?\".",
            "Escribe tu correo y da clic en \"Recuperar contraseña\".",
            "Siempre verás el mensaje \"Si el correo existe, enviamos instrucciones\". Así nadie puede " +
              "averiguar qué correos tienen cuenta.",
            "Abre el correo y da clic en el link. El link vale 30 minutos.",
            "Escribe tu nueva contraseña dos veces (mínimo 12 caracteres, con mayúscula, minúscula, número " +
              "y símbolo) y guárdala.",
          ],
        },
        {
          type: "callout",
          tone: "info",
          text:
            "Puedes pedir hasta 3 correos de recuperación por hora. Si no llega, revisa tu carpeta de spam y " +
            "confirma que escribiste el mismo correo con el que te invitaron.",
        },
        { type: "h3", text: "Activar una invitación" },
        {
          type: "steps",
          items: [
            "Abre el correo de invitación y da clic en el link. El link vale 48 horas.",
            "En la pantalla \"Activar cuenta\", elige tu contraseña y escríbela dos veces.",
            "Da clic en \"Activar cuenta\". Ya puedes entrar con tu correo y esa contraseña.",
          ],
        },
        { type: "h3", text: "Por qué el panel te pide entrar de nuevo" },
        {
          type: "list",
          items: [
            "Si pasas 30 minutos sin usar el panel, la sesión se cierra sola. Protege tu cuenta si dejas la " +
              "computadora abierta.",
            "Aunque lo uses sin parar, cada sesión dura como máximo 12 horas.",
            "Si cambias tu contraseña, se cierran tus sesiones en otros dispositivos.",
          ],
        },
        {
          type: "faq",
          items: [
            {
              q: "Me dice \"El link es inválido o ya expiró\". ¿Qué hago?",
              a:
                "El link de recuperación dura 30 minutos y el de invitación 48 horas, y cada uno sirve una " +
                "sola vez. Pide uno nuevo: en recuperación, desde \"Recuperar contraseña\"; en invitación, " +
                "pide al dueño de la empresa que te invite otra vez.",
            },
            {
              q: "Perdí el celular con mi app autenticadora. ¿Cómo entro?",
              a:
                "En el paso del código, usa uno de tus códigos de recuperación en lugar del código de la " +
                "app. Cada uno sirve una vez. Ya dentro, desactiva y vuelve a activar la verificación en " +
                "dos pasos con tu celular nuevo. Si tampoco tienes códigos de recuperación, escribe a " +
                "hola@tupla.dev desde el correo de tu cuenta.",
            },
            {
              q: "El código de 6 números me sale inválido aunque lo copio bien.",
              a:
                "Revisa que la hora de tu celular esté en automático. Los códigos dependen de la hora " +
                "exacta; si tu celular va adelantado o atrasado, los códigos no coinciden.",
            },
          ],
        },
      ],
      related: ["seguridad-de-la-cuenta", "invitar-usuarios"],
    },
    {
      slug: "roles-de-usuario",
      title: "Roles y qué puede hacer cada uno",
      summary:
        "OWNER, ADMIN, VENDOR, FINANCE, CATALOG, SUPPORT, VIEWER: qué ve y qué puede modificar cada rol, y cómo invitar a alguien con el rol correcto.",
      audience: "owner",
      keywords: ["permisos", "invitación", "usuarios", "invitar-usuarios", "accesos", "propietario", "vendedor"],
      body: [
        {
          type: "p",
          text:
            "Cada persona de tu empresa dentro del panel tiene un \"rol\". El rol decide dos cosas: qué " +
            "secciones del menú puede ver, y qué puede hacer dentro de ellas (solo mirar, o también cambiar). " +
            "Así cada persona tiene justo lo que necesita para su trabajo.",
        },
        {
          type: "p",
          text:
            "Por qué importa: si le das a un vendedor el mismo acceso que tú, podría cambiar un precio por " +
            "error o ver todos los pagos de la empresa. Con el rol correcto evitas ese riesgo desde el " +
            "principio.",
        },
        {
          type: "table",
          headers: ["Rol (en pantalla)", "Para quién es", "Puede"],
          rows: [
            ["Propietario (OWNER)", "Dueño del negocio", "Todo: ventas, cobros, reembolsos, conversaciones, canales de WhatsApp, agente, usuarios, API keys y los datos de la empresa (Empresa, Marca, Envío y plantillas)."],
            ["Administrador (ADMIN)", "Mano derecha del dueño", "Lo mismo que el Propietario, menos reembolsar o exportar pagos y menos las secciones Empresa, Marca, Envío y plantillas de WhatsApp. No puede nombrar a otro Propietario."],
            ["Vendedor (VENDOR)", "Ventas y atención", "Ve el catálogo y los pedidos, da de alta y edita clientes, crea, emite y comparte cotizaciones, cancela los pedidos que creó y contesta WhatsApp. No aprueba cotizaciones ni cobra: eso lo hace el Propietario o el Administrador."],
            ["Finanzas (FINANCE)", "Cuentas y cobranza", "Ve catálogo, clientes, cotizaciones y pedidos, y el Panorama con las cifras de dinero; ve pagos y hace reembolsos. No ve conversaciones."],
            ["Catálogo (CATALOG)", "Encargado de productos", "Solo el catálogo, para ver y editar."],
            ["Soporte (SUPPORT)", "Atención sin ventas", "Contesta WhatsApp, ve y corrige los datos de los clientes, y consulta catálogo, cotizaciones y pedidos. No cotiza ni toca pagos."],
            ["Lectura (VIEWER)", "Solo consulta", "Ve catálogo, clientes, cotizaciones, pedidos y notificaciones. No cambia nada."],
          ],
        },
        {
          type: "p",
          text:
            "Lo que tu rol no permite no aparece: esas secciones no salen en el menú de la izquierda y los " +
            "botones para cambiar cosas se ocultan. Si alguien abre directo el link de una sección que no le " +
            "toca, ve el aviso \"No tienes permiso para ver esta sección\" y un botón para volver al inicio. " +
            "Contraseña y verificación en dos pasos (Admin → Seguridad) las tiene todo el mundo.",
        },
        {
          type: "p",
          text:
            "Ejemplos para elegir bien: a quien solo toma fotos y actualiza precios, dale Catálogo. A tu " +
            "contador, dale Finanzas. A quien atiende WhatsApp y cierra ventas, dale Vendedor. A un socio que " +
            "solo quiere ver cómo va el negocio, dale Lectura.",
        },
        { type: "h3", text: "Cómo invitar a alguien" },
        {
          type: "steps",
          items: [
            "Ve a Admin → Usuarios y da clic en \"Invitar usuario\".",
            "Escribe su nombre completo y su correo, y elige su rol.",
            "Al guardar, la persona recibe un correo con un link de invitación.",
            "Cuando abre el link y crea su contraseña, ya puede entrar con ese rol.",
          ],
        },
        {
          type: "callout",
          tone: "info",
          title: "Propietario y Administrador no se asignan al invitar",
          text:
            "El formulario de invitación solo ofrece Vendedor, Finanzas, Catálogo, Soporte y Lectura. Para " +
            "hacer a alguien Administrador o Propietario, primero invítalo con otro rol y, cuando ya tenga su " +
            "cuenta activa, cámbiale el rol en la tabla de Usuarios.",
        },
        {
          type: "callout",
          tone: "warning",
          title: "Si te equivocas de rol",
          text:
            "No pasa nada grave: cambia el rol desde la tabla de Usuarios en Admin, sin volver a invitar. " +
            "Cambiar un rol no borra nada.",
        },
      ],
      related: ["recorrido-del-panel", "invitar-usuarios"],
    },
    {
      slug: "preguntas-primeros-pasos",
      title: "Preguntas frecuentes: empezar",
      summary: "Respuestas cortas a las dudas más comunes de los primeros días con el panel.",
      audience: "both",
      keywords: ["faq", "preguntas", "dudas", "problemas", "ayuda"],
      body: [
        {
          type: "faq",
          items: [
            {
              q: "¿Necesito saber programar para usar Easy Sell?",
              a:
                "No. Todo se hace desde el panel con botones y formularios. Solo las API keys y la conexión " +
                "por MCP son para conectar otros programas, y son opcionales.",
            },
            {
              q: "¿El agente puede vender algo que no tengo?",
              a:
                "No. El agente consulta tu catálogo en cada respuesta. Si un producto no existe, está en " +
                "borrador, está archivado o no tiene existencia, no lo ofrece como disponible.",
            },
            {
              q: "¿Puedo usar mi número de WhatsApp de siempre?",
              a:
                "Sí, con la conexión por Evolution (código QR). Tu número queda vinculado como un " +
                "dispositivo más, igual que WhatsApp Web.",
            },
            {
              q: "¿Cómo sé si ya estoy cobrando dinero real?",
              a:
                "Si ves la etiqueta \"Pruebas\" o \"Modo de pruebas\", los pagos son simulados. Cuando tu " +
                "empresa pasa a producción, esa etiqueta desaparece.",
            },
            {
              q: "Me falta una sección del menú que otra persona sí ve.",
              a:
                "Tu rol no incluye esa sección. Pide al Propietario o Administrador de tu empresa que revise " +
                "tu rol en Admin → Usuarios.",
            },
            {
              q: "¿Puedo usar el panel desde el celular?",
              a:
                "Sí. El panel se adapta a pantallas pequeñas. En el celular, el menú se abre con el botón de " +
                "la parte de arriba. Para cargar muchos productos, una computadora es más cómoda.",
            },
            {
              q: "¿A quién le escribo si algo no funciona?",
              a:
                "A hola@tupla.dev. En la página Soporte (menú de tu usuario) está la lista de datos que nos " +
                "ayudan a resolverlo más rápido. Nunca mandes contraseñas ni API keys por correo.",
            },
          ],
        },
      ],
      related: ["lista-de-arranque", "entrar-a-tu-cuenta"],
    },
  ],
};
