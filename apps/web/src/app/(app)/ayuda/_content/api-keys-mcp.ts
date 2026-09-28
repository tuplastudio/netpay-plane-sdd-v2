import type { HelpCategory } from "./types";

export const apiKeysMcp: HelpCategory = {
  slug: "api-keys-mcp",
  title: "API keys y MCP",
  articles: [
    {
      slug: "api-keys-de-empresa",
      title: "API keys de tu empresa",
      summary:
        "Credenciales para que un sistema externo, un script o un agente de inteligencia artificial hable con " +
        "tu cuenta sin usar tu usuario y contraseña.",
      audience: "owner",
      keywords: ["token", "secreto", "npk", "permiso", "scope", "integración"],
      body: [
        {
          type: "p",
          text:
            "Normalmente entras a Easy Sell con tu correo y tu contraseña. Eso crea una sesión: el sistema sabe " +
            "que eres tú, con tu usuario y tu rol. Pero a veces quieres que un programa, un script, o un agente " +
            "de inteligencia artificial (un programa que puede hacer acciones por su cuenta, como Claude) use " +
            "tu cuenta sin que haya una persona escribiendo su correo y contraseña cada vez. Para eso existen " +
            "las API keys.",
        },
        {
          type: "p",
          text:
            "Una API key (también le puedes decir \"llave de API\" o \"credencial de API\") es un código secreto " +
            "que funciona como una contraseña hecha específicamente para máquinas, no para personas. Cualquier " +
            "sistema que tenga esa key puede hablar directamente con tu cuenta — sin abrir el panel, sin " +
            "escribir tu contraseña — usando la API: la vía técnica por la que un programa externo le pide " +
            "cosas a Easy Sell (API son las siglas de \"interfaz de programación de aplicaciones\", pero lo " +
            "único que importa es que es la forma en que dos programas se comunican entre sí).",
        },
        {
          type: "p",
          text:
            "Ejemplo: imagina que tienes una tienda de pinturas y usas un programa aparte para llevar tu " +
            "inventario. Si le das una API key a ese programa, puede consultar tu catálogo de Easy Sell y " +
            "mantenerlo actualizado él solo, sin que nadie tenga que copiar productos a mano todos los días.",
        },
        {
          type: "p",
          text:
            "Cada API key se crea con permisos (en inglés se les llama scopes) que tú eliges al momento de " +
            "crearla. Un permiso es la autorización para hacer una sola cosa concreta — por ejemplo, \"ver el " +
            "catálogo\" es un permiso distinto de \"crear pedidos\", y ese es distinto de \"hacer reembolsos\". " +
            "La key solo puede hacer exactamente lo que esos permisos autorizan. Cualquier otra acción que " +
            "intente, el sistema la rechaza automáticamente, aunque la key en sí sea válida.",
        },
        {
          type: "list",
          items: [
            "Catálogo: ver o modificar tus productos y precios.",
            "Clientes: ver o modificar los datos de tus clientes.",
            "Cotizaciones: ver o crear cotizaciones.",
            "Pedidos: ver, crear pedidos, o cancelar pedidos (los propios, o cualquiera).",
            "Pagos: ver pagos, hacer reembolsos, o exportar reportes de pagos — son permisos distintos entre sí.",
            "Conversaciones (chat): leer o responder los mensajes de WhatsApp que llegan al agente.",
            "Notificaciones e integraciones: ver o configurar avisos y conexiones con otros sistemas.",
            "Auditoría: ver la bitácora de cambios de la cuenta.",
            "Administración: invitar usuarios, gestionar membresías, o crear y revocar otras API keys — estos " +
              "son los permisos más delicados, porque le dan a la key control sobre la cuenta misma, no solo " +
              "sobre el catálogo o las ventas.",
          ],
        },
        {
          type: "callout",
          tone: "info",
          text:
            "Si no sabes qué permisos darle a algo, dale los mínimos que necesita para funcionar y nada más. " +
            "Por ejemplo, si solo quieres que un sistema lea tu catálogo, no le des permiso de pagos ni de " +
            "administración aunque \"por si acaso\" suene más práctico. Así, si esa key algún día se filtra, el " +
            "daño posible ya queda limitado desde el principio.",
        },
        {
          type: "h3",
          text: "Cómo crear una API key",
        },
        {
          type: "steps",
          items: [
            "Ve a Admin → API keys, dentro de la administración de tu empresa.",
            "Haz clic en el botón \"Nueva API key\".",
            "Se abre un panel llamado \"Nueva API key\" con tres campos que llenar.",
            "En \"Nombre\" escribe algo que te ayude a identificarla después (por ejemplo \"Integración con mi " +
              "sistema de inventario\" o \"Bot de WhatsApp\"). Tiene un límite de 100 caracteres.",
            "En \"Permisos\" marca solamente las casillas de lo que esa key va a necesitar hacer, agrupadas por " +
              "área (catálogo, clientes, pedidos, pagos, etc.).",
            "En \"Expira en (días)\" decide su vigencia: déjalo vacío si quieres que nunca expire, o escribe un " +
              "número de días (por ejemplo 90) si quieres que deje de funcionar sola después de ese tiempo.",
            "Haz clic en \"Crear API key\".",
          ],
        },
        {
          type: "callout",
          tone: "warning",
          title: "El secreto se muestra una sola vez",
          text:
            "Justo después de crearla aparece un aviso que dice \"Copia esta key ahora: no se muestra de " +
            "nuevo\", con el secreto completo (empieza con npk_...) y un botón \"Copiar\". Ese es el único " +
            "momento en toda la vida de la key en que vas a poder ver el secreto completo. Cópialo de inmediato " +
            "y guárdalo en un lugar seguro — un gestor de contraseñas, no un chat de WhatsApp ni una nota sin " +
            "protección. Cuando termines, haz clic en \"Ya la guardé\" para cerrar el aviso.",
        },
        {
          type: "callout",
          tone: "warning",
          text:
            "Si pierdes el secreto, no hay forma de recuperarlo: por seguridad, Easy Sell nunca guarda el " +
            "secreto en texto legible, solo una huella cifrada que le sirve para comprobar que el secreto es " +
            "correcto, pero no para reconstruirlo. Si lo perdiste, la única opción es revocar esa key (dejarla " +
            "inválida para siempre) y crear una nueva desde cero.",
        },
        {
          type: "p",
          text:
            "Después de creada, la key ya no aparece en la lista con su secreto completo — solo con su prefijo " +
            "(la parte que empieza con npk_ seguida de unos caracteres, suficiente para reconocerla, pero " +
            "inútil sin el resto del secreto que ya no se muestra).",
        },
        {
          type: "table",
          headers: ["Columna", "Qué significa"],
          rows: [
            ["Nombre", "El nombre que le pusiste al crearla."],
            ["Prefijo", "La parte visible del secreto (npk_...); nunca el secreto completo."],
            ["Permisos", "Qué puede hacer esa key."],
            ["Creada", "Cuándo se generó."],
            ["Expira", "La fecha en que deja de funcionar, o \"Sin vencimiento\" si nunca expira."],
            ["Último uso", "La última vez que se usó para llamar a la API, o \"Nunca\" si no se ha usado."],
          ],
        },
        {
          type: "p",
          text:
            "Para revocar una key (dejarla inválida de inmediato, por ejemplo porque ya no la usas o crees que " +
            "se filtró), entra a esa misma lista, busca la key y revócala desde ahí. Cualquier sistema que siga " +
            "usando ese secreto empieza a recibir errores de inmediato — no hay periodo de gracia.",
        },
        {
          type: "callout",
          tone: "info",
          text:
            "Ejemplo de un permiso mal calculado: si le das a una key solo permiso de leer el catálogo, y el " +
            "programa que la usa intenta crear un pedido, el sistema rechaza esa acción con un error de " +
            "permisos. No importa que la key sea válida — cada acción se revisa por separado contra los " +
            "permisos que tiene.",
        },
      ],
      related: ["conectar-por-mcp"],
    },
    {
      slug: "conectar-por-mcp",
      title: "Conectar por MCP (Claude u otro agente)",
      summary:
        "Un botón crea la API key recomendada y te da el comando de instalación con el secreto ya puesto, para " +
        "que un agente de inteligencia artificial pueda operar tu cuenta.",
      audience: "owner",
      keywords: ["claude", "mcp", "agente", "conectar", "npx"],
      body: [
        {
          type: "p",
          text:
            "Un agente de inteligencia artificial es un programa que, además de responder texto, puede hacer " +
            "acciones concretas: consultar información, crear registros, ejecutar pasos — como si fuera una " +
            "persona operando el sistema, pero automatizado. Claude (el asistente de Anthropic) es un ejemplo, " +
            "pero hay otros compatibles con el mismo estándar.",
        },
        {
          type: "p",
          text:
            "Para que un agente pueda usar tu cuenta de Easy Sell necesita dos cosas: una forma de \"hablar\" " +
            "con tu sistema, y permiso para hacerlo. MCP (Model Context Protocol) resuelve la primera parte: es " +
            "un lenguaje común que le permite a un agente usar tu catálogo, tus clientes, tus cotizaciones, tus " +
            "pedidos y tus conversaciones de WhatsApp como herramientas — el agente \"aprende\" que existen esas " +
            "herramientas y las usa cuando tú se lo pides en lenguaje normal. La API key del artículo anterior " +
            "es la segunda parte: el permiso.",
        },
        {
          type: "p",
          text:
            "Ejemplo: en vez de entrar tú mismo al panel a revisar cuántos pedidos llevas esta semana, le puedes " +
            "pedir a Claude, ya conectado por MCP, \"dime cuántos pedidos tengo pendientes de esta semana\", y " +
            "el agente consulta tu cuenta directamente y te contesta.",
        },
        {
          type: "h3",
          text: "Conectar en un solo paso (recomendado)",
        },
        {
          type: "steps",
          items: [
            "Ve a Admin → API keys, y busca la sección \"Conectar por MCP\".",
            "Haz clic en el botón \"Generar API key y conectar\".",
            "El sistema crea automáticamente una API key nueva llamada \"MCP\", con un conjunto de permisos ya " +
              "pensado para este uso: leer el catálogo; leer y modificar clientes, cotizaciones y pedidos " +
              "(incluyendo cancelar los pedidos que el propio agente creó); solo leer pagos; leer y responder " +
              "conversaciones; y leer notificaciones. No incluye reembolsos, exportar pagos, ni nada de " +
              "administración (invitar gente, gestionar otras API keys, etc.) — eso es intencional, para que un " +
              "agente conectado así no pueda hacer nada delicado por error.",
            "Aparece un aviso igual de importante que el de las keys normales: \"Copia el secreto de aquí " +
              "abajo: no se vuelve a mostrar\". El secreto ya viene insertado en el comando que necesitas, así " +
              "que no tienes que copiarlo aparte.",
            "Elige la pestaña según qué agente vas a usar: \"Claude Code\" (una herramienta de línea de " +
              "comandos), \"Claude Desktop\" (la aplicación de escritorio de Claude), u \"Otro agente\" " +
              "(cualquier otro programa compatible con MCP).",
            "Copia el comando o bloque que aparece — ya trae tu secreto insertado, no tienes que editarlo.",
            "Pégalo donde corresponda: en Claude Code, en una terminal; en Claude Desktop, en su archivo de " +
              "configuración; en otro agente, donde ese programa te pida sus variables de entorno.",
            "Haz clic en \"Ya la instalé\" para cerrar el aviso.",
          ],
        },
        {
          type: "p",
          text:
            "Un ejemplo de cómo se ve el comando para Claude Code, solo para que sepas qué esperar (el tuyo " +
            "trae tu propio secreto, no este):",
        },
        {
          type: "code",
          text: "claude mcp add atiendeya --env COMMERCE_API_KEY=npk_tu_secreto_aqui -- npx atiendeya-mcp",
        },
        {
          type: "p",
          text:
            "No necesitas entender esa línea para usarla — solo copiarla y pegarla donde el asistente te lo " +
            "pida. \"atiendeya\" es simplemente el nombre técnico interno del conector; no cambia el nombre de " +
            "tu negocio ni de Easy Sell en ningún lado que vean tus clientes.",
        },
        {
          type: "callout",
          tone: "info",
          text:
            "¿Necesitas que tu agente también haga reembolsos, exporte pagos, o administre usuarios? Esos " +
            "permisos no vienen incluidos aquí a propósito. Crea la key a mano desde el artículo \"API keys de " +
            "tu empresa\", eligiendo tú mismo los permisos exactos que quieras, y úsala igual en el mismo tipo " +
            "de comando (cambiando el secreto por el de esa nueva key).",
        },
        {
          type: "callout",
          tone: "warning",
          text:
            "Si copias el comando pero se te olvida pegarlo antes de cerrar la ventana, no pasa nada grave: la " +
            "API key \"MCP\" ya quedó creada y aparece en tu lista de API keys con su prefijo. Solo que ya no " +
            "vas a poder ver el secreto completo de nuevo — en ese caso, revócala y repite el proceso desde el " +
            "botón \"Generar API key y conectar\" para que te dé un secreto nuevo.",
        },
      ],
      related: ["api-keys-de-empresa"],
    },
  ],
};
