import type { HelpCategory } from "./types";

export const plataforma: HelpCategory = {
  slug: "plataforma",
  title: "Plataforma (super-admin)",
  articles: [
    {
      slug: "dar-de-alta-una-empresa",
      title: "Dar de alta una nueva empresa",
      summary:
        "Nombre, slug y el correo de su primer OWNER — el resto lo hace la propia empresa, sin que tú tengas " +
        "que configurar nada más por ella.",
      audience: "super_admin",
      keywords: ["nueva empresa", "tenant", "alta", "onboarding"],
      body: [
        {
          type: "p",
          text:
            "Cada negocio que usa Easy Sell es lo que internamente se llama un tenant (\"empresa\", en el " +
            "panel): un espacio separado con su propio catálogo, sus propios clientes, pedidos y equipo. Dar de " +
            "alta una empresa es crear ese espacio por primera vez, para un negocio que todavía no tiene cuenta.",
        },
        {
          type: "h3",
          text: "Pasos",
        },
        {
          type: "steps",
          items: [
            "Ve a Plataforma → Empresas.",
            "Haz clic en \"Nueva empresa\".",
            "Llena \"Nombre de la empresa\" (el nombre del negocio, como se va a mostrar en el panel).",
            "Llena \"Slug\": es un identificador corto que se usa en direcciones y configuraciones internas — " +
              "solo acepta minúsculas, números y guion, sin espacios ni acentos (por ejemplo, para \"Pinturas " +
              "El Sol\" podrías usar pinturas-el-sol).",
            "Llena \"Nombre del propietario\" y \"Correo del propietario\": son los datos de la persona que va " +
              "a ser el primer OWNER de esa empresa, es decir, quien va a tener el control total sobre ella " +
              "desde el primer momento.",
            "Haz clic en \"Crear empresa\".",
          ],
        },
        {
          type: "p",
          text:
            "Se le manda una invitación por correo a ese OWNER; al aceptarla, entra a operar su propia empresa.",
        },
        {
          type: "callout",
          tone: "info",
          text:
            "Fíjate bien en el correo del propietario antes de crear la empresa: es la puerta de entrada a toda " +
            "la cuenta de ese negocio. Si te equivocas al escribirlo, la invitación le llega a la persona " +
            "equivocada, o a nadie.",
        },
        {
          type: "p",
          text:
            "Desde ahí, esa empresa ya se administra a sí misma: su OWNER puede invitar a su propio equipo, " +
            "configurar su catálogo, sus WhatsApp, sus API keys, etc. Tú, como super-admin, solo vuelves a " +
            "intervenir si necesita soporte — por ejemplo, si pierde acceso, o si necesitas revisar algo por " +
            "ellos.",
        },
      ],
      related: ["administrar-una-empresa"],
    },
    {
      slug: "administrar-una-empresa",
      title: "Administrar una empresa desde Plataforma",
      summary:
        "Cambiar su estado, ver su detalle, gestionar invitaciones y membresías, y sus API keys — todo lo que " +
        "normalmente haría su propio OWNER, pero desde tu vista de super-admin.",
      audience: "super_admin",
      keywords: ["tenant", "estado", "active", "disabled", "membresías"],
      body: [
        {
          type: "p",
          text:
            "Desde Plataforma → Empresas, al entrar a una empresa en particular, tienes control total sobre " +
            "ella — más control, de hecho, que un ADMIN normal de esa misma empresa, porque tú no tienes las " +
            "restricciones de jerarquía que sí aplican dentro de un equipo normal.",
        },
        {
          type: "list",
          items: [
            "Cambiar su estado entre ACTIVE (activa, funcionando normal) y DISABLED (desactivada).",
            "Ver el detalle completo de la empresa: su información, su equipo, su actividad.",
            "Invitar gente con cualquier rol, incluido OWNER — un ADMIN normal de esa empresa no podría invitar " +
              "a otro OWNER, pero tú sí.",
            "Cambiar o quitar membresías: mover a alguien de rol, o sacarlo del equipo de esa empresa.",
            "Emitir o revocar API keys en su nombre, igual que si fueras su OWNER (ver el artículo sobre API " +
              "keys para lo que significa cada permiso).",
          ],
        },
        {
          type: "callout",
          tone: "warning",
          text:
            "Desactivar una empresa (DISABLED) le corta el acceso a todo su equipo de inmediato: nadie de ese " +
            "negocio va a poder entrar al panel mientras esté en ese estado, sin excepción de rol. Úsalo solo " +
            "cuando realmente lo necesites (por ejemplo, un problema de pago o una solicitud del propio " +
            "negocio), y vuelve a poner la empresa en ACTIVE en cuanto se resuelva, para no dejarla bloqueada " +
            "más tiempo del necesario.",
        },
        {
          type: "callout",
          tone: "info",
          text:
            "Si necesitas ver el panel exactamente como lo vería el equipo de esa empresa — para reproducir un " +
            "problema que te reportan, o para configurar algo por ellos paso a paso — no lo hagas cambiando " +
            "membresías: usa impersonar, que está pensado justo para eso (ver el artículo siguiente).",
        },
      ],
      related: ["dar-de-alta-una-empresa", "impersonar-una-empresa"],
    },
    {
      slug: "impersonar-una-empresa",
      title: "Impersonar una empresa",
      summary:
        "Entra y opera el panel exactamente como su dueño (con su mismo rol de OWNER), para dar soporte de " +
        "primera mano, y todo lo que hagas queda registrado como impersonación.",
      audience: "super_admin",
      keywords: ["impersonación", "entrar como", "soporte a un tenant"],
      body: [
        {
          type: "p",
          text:
            "Impersonar significa entrar al panel de una empresa viéndolo y operándolo exactamente como lo " +
            "vería su OWNER — no una copia ni una vista de solo lectura, sino el panel real de esa empresa, con " +
            "ese rol. Mientras impersonas, el sistema te trata como si fueras el OWNER de esa empresa, sin " +
            "importar que tu cuenta real sea de super-admin.",
        },
        {
          type: "p",
          text:
            "Es útil sobre todo en dos casos: cuando alguien te reporta un problema y necesitas reproducirlo " +
            "exactamente como lo ve esa persona (por ejemplo, \"no puedo agregar un producto al catálogo\"), o " +
            "cuando necesitas configurar algo por ellos porque no saben cómo, o porque piden que lo hagas tú " +
            "directamente.",
        },
        {
          type: "callout",
          tone: "info",
          text:
            "Todo lo que hagas mientras impersonas queda auditado como tuyo, marcado explícitamente como " +
            "impersonación — nunca se ve como si lo hubiera hecho el dueño real. Tanto el momento en que entras " +
            "como el momento en que sales quedan registrados en la bitácora de auditoría de la plataforma. Esto " +
            "es intencional: si algo cambia mientras impersonas, cualquiera que revise el historial después " +
            "puede ver que fuiste tú, y no confundirlo con una acción del negocio.",
        },
        {
          type: "p",
          text:
            "Sales de la impersonación desde el mismo selector de empresa en la barra superior: mientras estás " +
            "impersonando aparece un aviso con un botón que dice \"Salir del modo empresa\" — haz clic ahí para " +
            "volver a tu vista normal de super-admin.",
        },
        {
          type: "callout",
          tone: "warning",
          text:
            "No dejes una sesión de impersonación abierta más tiempo del que necesitas. Mientras estés " +
            "impersonando, cualquier acción que hagas en el panel se ejecuta de verdad sobre los datos reales " +
            "de esa empresa (crear un pedido, cambiar un precio, borrar algo), no en un ambiente de prueba.",
        },
      ],
      related: ["administrar-una-empresa"],
    },
    {
      slug: "uso-y-costos-de-plataforma",
      title: "Uso y costos de toda la plataforma",
      summary:
        "Consumo del agente de inteligencia artificial por empresa, y el detalle día por día y modelo por " +
        "modelo de una empresa en particular.",
      audience: "super_admin",
      keywords: ["tokens", "costo", "todas las empresas", "modelo de ia"],
      body: [
        {
          type: "p",
          text:
            "Así como cada empresa puede ver su propio consumo del agente de IA (tokens y costo en dólares — " +
            "ver el artículo \"Uso y costos del agente\" para lo que significa cada término), tú como " +
            "super-admin puedes ver el consumo de todas las empresas juntas, y también entrar al detalle de una " +
            "sola.",
        },
        {
          type: "steps",
          items: [
            "Ve a Plataforma → Uso y costos para ver el consumo agregado de todas las empresas en el rango de " +
              "fechas que elijas.",
            "Entra al detalle de una empresa en particular para ver su desglose día por día, y modelo de IA por " +
              "modelo de IA (algunas empresas o conversaciones pueden usar modelos distintos, con costos " +
              "distintos entre sí).",
            "Dentro del detalle de una empresa, busca la pestaña \"Costos\" para ver ese desglose específico de " +
              "esa empresa.",
          ],
        },
        {
          type: "callout",
          tone: "info",
          text:
            "Esta vista es útil para detectar, por ejemplo, si una sola empresa está generando un consumo " +
            "desproporcionado frente al resto — puede ser simplemente que tiene muchas más conversaciones, o " +
            "puede valer la pena revisar si algo se está usando de forma inesperada.",
        },
      ],
    },
    {
      slug: "api-keys-globales",
      title: "API keys globales",
      summary: "Sin tenant fijo, con todos los permisos — cada llamada decide sobre qué empresa opera.",
      audience: "super_admin",
      keywords: ["key maestra", "master key", "cross-tenant", "x-tenant-id"],
      body: [
        {
          type: "p",
          text:
            "Todas las API keys normales (ver el artículo \"API keys de tu empresa\") pertenecen a una sola " +
            "empresa: solo pueden operar sobre los datos de esa empresa, nunca de otra. Una API key global es " +
            "distinta: no pertenece a ninguna empresa en particular. Siempre lleva todos los permisos del " +
            "sistema (no se le puede quitar ninguno; el sistema ni siquiera acepta un intento de crearla con " +
            "permisos limitados), y quien la usa decide, en cada llamada por separado, sobre cuál empresa " +
            "quiere actuar.",
        },
        {
          type: "p",
          text:
            "Esa decisión se indica con un dato técnico llamado header X-Tenant-Id: literalmente, el " +
            "identificador de la empresa sobre la que quiere operar esa llamada en particular. Sin ese dato, la " +
            "key global solo alcanza rutas de plataforma (como esta misma sección de Plataforma), no los datos " +
            "de ninguna empresa específica.",
        },
        {
          type: "callout",
          tone: "info",
          text:
            "Si alguien usa una key global con un X-Tenant-Id mal escrito (que no tiene el formato correcto de " +
            "identificador), o que corresponde a una empresa que no existe o está desactivada, el sistema " +
            "rechaza la llamada con un error explicando cuál de las dos cosas pasó. No se \"cae\" silenciosamente " +
            "sobre otra empresa por error.",
        },
        {
          type: "callout",
          tone: "warning",
          title: "Trátala como la llave maestra que es",
          text:
            "Cualquiera con esta key puede operar CUALQUIER empresa de la plataforma. Solo la creas o revocas " +
            "tú, con tu propia sesión — no se puede emitir otra key global usando una key global (para que una " +
            "sola fuga no se auto-replique). Úsala solo para soporte de plataforma o automatización " +
            "genuinamente cross-tenant (que necesita tocar varias empresas a la vez); para todo lo demás, una " +
            "key de empresa normal, con permisos acotados a esa sola empresa.",
        },
        {
          type: "p",
          text: "Se crea y revoca desde Plataforma → API keys globales.",
        },
      ],
      related: ["administrar-una-empresa", "conectar-por-mcp"],
    },
  ],
};
