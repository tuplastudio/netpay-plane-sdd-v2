import type { HelpCategory } from "./types";

export const empresaSeguridad: HelpCategory = {
  slug: "empresa-seguridad",
  title: "Empresa y seguridad",
  articles: [
    {
      slug: "marca",
      title: "Marca: logo y colores",
      summary:
        "Tu logo y tus colores: lo que ve tu cliente en el link público de cotización, el checkout y el seguimiento de pedido, sin que tenga que iniciar sesión.",
      audience: "owner",
      keywords: ["logo", "colores", "branding", "identidad visual"],
      body: [
        {
          type: "p",
          text:
            "En Admin → Marca subes tu logo y defines tus colores. Esto no es solo decoración interna: es lo " +
            "que ve tu cliente cuando abre el link de una cotización, cuando llega al checkout para pagar, o " +
            "cuando revisa el seguimiento de su pedido — pantallas públicas a las que el cliente entra sin " +
            "necesitar una cuenta ni una contraseña.",
        },
        {
          type: "h3",
          text: "Subir el logo",
        },
        {
          type: "steps",
          items: [
            "Ve a Admin → Marca.",
            "En el bloque \"Logo\", arrastra tu archivo al recuadro punteado, o da clic en \"Elegir archivo\".",
            "El sistema revisa el archivo al instante y te muestra una vista previa sobre fondo claro y sobre fondo oscuro.",
            "Si todo está en orden, da clic en \"Subir logo\".",
          ],
        },
        {
          type: "list",
          items: [
            "Formatos permitidos: PNG, JPG, WebP o SVG.",
            "Peso máximo: 2 MB.",
            "Medidas: entre 128×128 y 4096×4096 píxeles.",
            "Proporción: entre 1:3 y 3:1 (nada extremadamente alargado ni vertical ni horizontal).",
            "Los GIF no están permitidos, porque suelen ser animados.",
          ],
        },
        {
          type: "callout",
          tone: "warning",
          title: "Por qué se puede rechazar tu archivo",
          text:
            "Si tu imagen mide menos de 128×128 px, el sistema te va a decir exactamente cuánto medía y cuál " +
            "es el mínimo. Lo mismo si pesa más de 2 MB, o si la proporción es demasiado alargada (por " +
            "ejemplo, una imagen panorámica muy angosta): el mensaje de error te dice el motivo puntual, no " +
            "solo \"archivo inválido\", para que sepas qué corregir antes de volver a intentar.",
        },
        {
          type: "p",
          text:
            "Si ya tienes un logo subido y quieres quitarlo, usa el botón \"Quitar logo\": el sistema te pide " +
            "confirmar, porque las cotizaciones y el portal van a dejar de mostrarlo de inmediato. Puedes " +
            "subir otro cuando quieras — quitarlo no borra nada más de tu cuenta.",
        },
        {
          type: "h3",
          text: "Colores",
        },
        {
          type: "p",
          text:
            "Defines tres colores: \"Color primario\" (para botones y los acentos principales), \"Color " +
            "secundario\" (para texto de apoyo y fondos suaves) y \"Color de acento\" (para enlaces y " +
            "detalles). Cada uno se escribe como color hexadecimal — el formato #RRGGBB o #RGB que usan casi " +
            "todos los editores de imagen y sitios web, por ejemplo #DB0025 para un rojo. Puedes escribirlo a " +
            "mano o usar el selector de color junto al campo.",
        },
        {
          type: "p",
          text:
            "Debajo de los tres campos hay una franja de vista previa con los tres colores lado a lado, para " +
            "que veas cómo se ven juntos antes de guardar. Da clic en \"Guardar colores\" para aplicarlos; " +
            "\"Descartar cambios\" regresa todo a los últimos colores guardados si cambias de opinión antes de " +
            "guardar.",
        },
        {
          type: "callout",
          tone: "info",
          text:
            "Si escribes un valor que no es un color hexadecimal válido, el campo te lo marca de inmediato con " +
            "un mensaje de error, y el botón de guardar no se habilita hasta que lo corrijas.",
        },
      ],
    },
    {
      slug: "invitar-usuarios",
      title: "Invitar usuarios a tu empresa",
      summary:
        "Correo, nombre y rol — la persona recibe un correo con un link de invitación, lo abre, crea su propia contraseña y ya puede entrar.",
      audience: "owner",
      keywords: ["agregar usuario", "nuevo usuario", "invitación", "rol", "permiso", "miembro", "equipo"],
      body: [
        {
          type: "p",
          text:
            "Un \"usuario\" es cualquier persona con su propia cuenta para entrar al portal — tú, alguien que " +
            "te ayuda a vender, quien lleva las cuentas, etc. Invitar a alguien no le da acceso a todo por " +
            "igual: cada persona tiene un \"rol\", que es el conjunto de cosas que puede ver y hacer dentro del " +
            "sistema.",
        },
        {
          type: "h3",
          text: "Cómo invitar",
        },
        {
          type: "steps",
          items: [
            "Ve a Admin → Usuarios.",
            "Da clic en \"Invitar usuario\".",
            "Escribe el nombre completo de la persona.",
            "Escribe su correo.",
            "Elige su rol entre las opciones disponibles al invitar (más abajo se explica cada una).",
            "Se manda un correo con un link de invitación a esa dirección.",
            "La persona abre el link, crea su propia contraseña, y ya puede entrar con su correo y esa contraseña.",
          ],
        },
        {
          type: "callout",
          tone: "warning",
          title: "El link de invitación caduca en 48 horas",
          text:
            "Si la persona no acepta la invitación dentro de las 48 horas siguientes, el link deja de " +
            "funcionar. Mientras la invitación siga pendiente, la ves en la tabla de Admin → Usuarios marcada " +
            "como \"Invitado\", y puedes revocarla desde ahí (menú de acciones → \"Revocar invitación\") si te " +
            "equivocaste de correo o ya no quieres darle acceso a esa persona.",
        },
        {
          type: "h3",
          text: "Qué roles puedes asignar al invitar",
        },
        {
          type: "p",
          text:
            "Al invitar a alguien, solo puedes elegir entre roles operativos: Vendedor, Finanzas, Catálogo, " +
            "Soporte o Lectura. Los roles de Administrador y Propietario no aparecen en el formulario de " +
            "invitación a propósito — se otorgan después, cambiando el rol de esa persona ya dentro de la " +
            "tabla de Admin → Usuarios, una vez que ya aceptó la invitación y tiene su cuenta activa.",
        },
        {
          type: "table",
          headers: ["Rol", "Qué puede hacer"],
          rows: [
            ["Propietario", "Todo: catálogo, clientes, cotizaciones, pedidos, pagos (incluye reembolsos), notificaciones, además de administrar la empresa, invitar y gestionar usuarios, y emitir API keys."],
            ["Administrador", "Casi todo lo mismo que Propietario, pero no puede reembolsar ni exportar pagos, y no puede otorgar el rol de Propietario a nadie."],
            ["Vendedor", "Ve el catálogo, gestiona clientes, hace cotizaciones y pedidos, cancela sus propios pedidos, y contesta el chat de WhatsApp."],
            ["Finanzas", "Solo lectura de catálogo, clientes, cotizaciones y pedidos; además ve, reembolsa y exporta pagos."],
            ["Catálogo", "Solo puede ver y editar el catálogo (productos, precios, existencias). No ve clientes, cotizaciones ni pedidos."],
            ["Soporte", "Ve catálogo, clientes, cotizaciones y pedidos, y puede contestar el chat de WhatsApp. No puede tocar pagos."],
            ["Lectura", "Solo puede ver catálogo, clientes, cotizaciones, pedidos y notificaciones — no puede cambiar nada."],
          ],
        },
        {
          type: "callout",
          tone: "info",
          text:
            "Solo un Propietario puede otorgar el rol de Propietario a otra persona, o quitárselo a quien ya lo " +
            "tiene. Un Administrador puede cambiar el rol de cualquier otra persona (Vendedor, Finanzas, " +
            "Catálogo, Soporte, Lectura, e incluso hacer a alguien Administrador), pero nunca puede fabricar " +
            "otro Propietario. Además, el sistema nunca deja que la empresa se quede sin ningún Propietario " +
            "activo: al último Propietario activo no se le puede quitar el rol ni desactivarlo hasta que haya " +
            "otro.",
        },
        {
          type: "h3",
          text: "Después de invitar",
        },
        {
          type: "p",
          text:
            "En la tabla de Admin → Usuarios ves a cada persona con su estado: \"Activo\" (ya entró y tiene " +
            "acceso), \"Invitado\" (todavía no acepta la invitación) o \"Deshabilitado\" (le quitaste el " +
            "acceso, pero su historial queda). Desde esa misma tabla puedes cambiar el rol de alguien en " +
            "cualquier momento, o quitarlo del portal (menú de acciones → \"Quitar del portal\").",
        },
        {
          type: "callout",
          tone: "success",
          text:
            "En esa misma tabla hay una columna \"Agente WhatsApp\" con una casilla \"Activo\": marca a qué " +
            "personas de tu equipo se les pueden asignar conversaciones de WhatsApp que se hayan escalado a " +
            "una persona. No aplica a invitaciones pendientes ni a usuarios deshabilitados.",
        },
      ],
      related: ["roles-de-usuario"],
    },
    {
      slug: "seguridad-de-la-cuenta",
      title: "Contraseña y verificación en dos pasos (MFA)",
      summary:
        "Cambia tu contraseña y activa la verificación en dos pasos (MFA) con una app como Google Authenticator; guarda tus códigos de recuperación en un lugar seguro.",
      audience: "owner",
      keywords: ["2fa", "doble factor", "cambiar contraseña", "totp", "mfa", "código de recuperación", "autenticador"],
      body: [
        {
          type: "p",
          text:
            "Admin → Seguridad reúne todo lo relacionado con proteger tu propia cuenta: cambiar tu contraseña " +
            "y activar la verificación en dos pasos. Tiene tres pestañas — \"Contraseña\", \"Verificación en " +
            "dos pasos\" y \"Actividad\" (un historial de solo lectura de los cambios importantes de tu cuenta " +
            "y de tu empresa). Este artículo cubre las primeras dos.",
        },
        {
          type: "h3",
          text: "Cambiar tu contraseña",
        },
        {
          type: "p",
          text:
            "En la pestaña \"Contraseña\" escribes tu contraseña actual y la nueva dos veces (para confirmarla). " +
            "La contraseña nueva tiene que cumplir estas reglas al mismo tiempo:",
        },
        {
          type: "list",
          items: [
            "Al menos 12 caracteres.",
            "Al menos una letra minúscula.",
            "Al menos una letra mayúscula.",
            "Al menos un dígito.",
            "Al menos un símbolo (algo que no sea letra ni número, como # o !).",
          ],
        },
        {
          type: "p",
          text:
            "El formulario te va marcando en tiempo real cuáles de esas reglas ya cumples mientras escribes, " +
            "para que no tengas que adivinar por qué falla al guardar.",
        },
        {
          type: "callout",
          tone: "warning",
          title: "Cambiar tu contraseña cierra tus otras sesiones",
          text:
            "En cuanto cambias tu contraseña, el sistema cierra la sesión en cualquier otro dispositivo donde " +
            "hayas iniciado sesión antes. Tendrás que volver a entrar ahí con la contraseña nueva. Es " +
            "justamente lo que quieres si, por ejemplo, cambiaste la contraseña porque sospechas que alguien " +
            "más la sabía.",
        },
        {
          type: "h3",
          text: "Activar la verificación en dos pasos (MFA)",
        },
        {
          type: "p",
          text:
            "La verificación en dos pasos — también llamada MFA (multi-factor authentication) o 2FA — agrega " +
            "un segundo candado a tu cuenta: además de tu contraseña, necesitas un código de 6 dígitos que " +
            "genera una app en tu teléfono y que cambia cada pocos segundos. Aunque alguien llegara a saber tu " +
            "contraseña, no podría entrar sin ese código. La app que se usa es una \"app autenticadora\" " +
            "(Google Authenticator, Authy, 1Password u otra parecida) y el método técnico se llama TOTP.",
        },
        {
          type: "steps",
          items: [
            "En la pestaña \"Verificación en dos pasos\", da clic en \"Activar MFA\".",
            "El sistema te muestra un código QR. Ábrelo con tu app autenticadora (\"Agregar cuenta\" o el ícono de escanear) y apunta la cámara al código. Si tu app no puede escanear, hay un enlace para ingresar la clave a mano en su lugar.",
            "El sistema también te muestra 10 códigos de recuperación de un solo uso — se muestran una sola vez, así que cópialos o descárgalos ahora. Sirven para entrar si alguna vez pierdes el teléfono con tu app autenticadora.",
            "Marca la casilla \"Ya guardé mis códigos de recuperación en un lugar seguro\" (el botón de confirmar no se habilita hasta que la marques).",
            "Escribe el código de 6 dígitos que en ese momento te muestra tu app y da clic en \"Confirmar\".",
          ],
        },
        {
          type: "callout",
          tone: "warning",
          title: "Guarda los códigos de recuperación en un lugar seguro, no en este portal",
          text:
            "Cada código de recuperación sirve una sola vez. Sin ellos, si pierdes tu teléfono o desinstalas " +
            "tu app autenticadora, te quedas sin forma de entrar a tu cuenta con el segundo factor activado. " +
            "Descárgalos con el botón \"Descargar .txt\" y guárdalos donde guardes tus contraseñas — nunca " +
            "dentro del propio portal, porque si perdieras el acceso al portal, tampoco podrías leerlos ahí.",
        },
        {
          type: "h3",
          text: "Regenerar códigos o desactivar MFA",
        },
        {
          type: "p",
          text:
            "Si ya usaste varios códigos de recuperación o simplemente quieres un lote nuevo, usa " +
            "\"Regenerar códigos de recuperación\": te va a pedir un código de tu app para confirmar, y en " +
            "cuanto lo hagas, los códigos anteriores dejan de servir — solo van a funcionar los nuevos, así " +
            "que guárdalos de inmediato.",
        },
        {
          type: "p",
          text:
            "Para \"Desactivar MFA\" también necesitas confirmar con un código de tu app o con uno de " +
            "recuperación. Después de desactivarlo, tu cuenta queda protegida solo con tu contraseña — puedes " +
            "volver a activarlo cuando quieras repitiendo el proceso desde cero.",
        },
      ],
    },
  ],
};
