import type { HelpCategory } from "./types";

export const clientes: HelpCategory = {
  slug: "clientes",
  title: "Clientes",
  articles: [
    {
      slug: "fichas-de-cliente",
      title: "Fichas de cliente",
      summary:
        "Datos de contacto, direcciones, consentimientos e historial de cotizaciones y pedidos — cómo se crean las fichas, qué campos tienen y cómo archivar a un cliente sin perder su historial.",
      audience: "owner",
      keywords: ["rfc", "direcciones", "consentimiento", "whatsapp", "marketing", "archivar"],
      body: [
        {
          type: "p",
          text:
            "Una \"ficha de cliente\" es, en pocas palabras, la carpeta digital de una persona: junta en un " +
            "solo lugar sus datos de contacto, sus direcciones y todo lo que se le ha cotizado o vendido. En " +
            "Clientes ves el listado completo, con columnas de nombre, correo, teléfono, RFC y estado; al " +
            "entrar a una fila específica se abre su ficha con el detalle completo.",
        },
        {
          type: "p",
          text:
            "Cada cliente tiene nombre, correo y teléfono opcionales, un RFC opcional (el Registro Federal de " +
            "Contribuyentes: el identificador fiscal que usan en México las personas y empresas para " +
            "facturar; solo lo necesitas capturar si vas a emitirle una factura a ese cliente), hasta 20 " +
            "direcciones guardadas, y un historial completo de todo lo que se le ha cotizado o vendido — desde " +
            "la primera cotización hasta el pedido más reciente.",
        },
        {
          type: "h3", text: "Cómo se crea una ficha" },
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
            "También puedes crear una ficha manualmente, sin esperar a que la persona escriba por WhatsApp, " +
            "con el botón \"Nuevo cliente\" desde el listado de Clientes. Esto es útil para un negocio como " +
            "una taquería, donde muchos clientes frecuentes compran en persona y nunca han escrito por chat, " +
            "pero de todas formas quieres guardar sus datos para futuras promociones o para tener su historial " +
            "si algún día sí compran por WhatsApp.",
        },
        { type: "h3", text: "Direcciones" },
        {
          type: "p",
          text:
            "Un cliente puede guardar hasta 20 direcciones distintas — por ejemplo, su casa, su negocio y la " +
            "casa de un familiar al que le manda pedidos seguido. De todas las que tenga guardadas, una puede " +
            "quedar marcada como \"Predeterminada\", y aparece con esa etiqueta dentro de su ficha para que la " +
            "identifiques rápido entre varias.",
        },
        {
          type: "h3", text: "Consentimientos" },
        {
          type: "p",
          text:
            "Un \"consentimiento\" es, en este contexto, el permiso que un cliente te dio (o no) para hacer " +
            "algo puntual con sus datos o para contactarlo de cierta forma. Se registran tres tipos distintos, " +
            "y cada uno cubre una cosa distinta — que un cliente te haya dado uno no significa que te haya " +
            "dado los otros dos.",
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
          type: "p",
          text:
            "Sirven para llevar constancia de qué autorizó cada cliente exactamente, y puedes otorgarlos o " +
            "revocarlos desde su ficha. En la ficha, cada uno de los tres se muestra con una etiqueta de " +
            "\"Otorgado\", \"Revocado\" o \"Sin registro\" (cuando nunca se ha definido uno u otro), para que " +
            "de un vistazo sepas en qué situación está cada cliente.",
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
        { type: "h3", text: "Archivar un cliente" },
        {
          type: "p",
          text:
            "Si un cliente ya no es relevante — se fue de la zona, dejó de comprar, o pidió que dejaras de " +
            "contactarlo — puedes archivarlo desde su ficha con el botón \"Archivar cliente\". El sistema te " +
            "va a pedir que confirmes con un mensaje del tipo \"¿Archivar a (nombre)?\", precisamente para " +
            "evitar que archives a alguien por error con un clic.",
        },
        {
          type: "callout",
          tone: "info",
          text:
            "Un cliente archivado no se borra: solo queda oculto de las listas por defecto y deja de poder " +
            "recibir nuevas cotizaciones mientras esté en ese estado. Su historial completo de compras y " +
            "cotizaciones sigue intacto, sin perder nada, y puedes traerlo de vuelta cuando haga falta con el " +
            "botón \"Restaurar cliente\" desde la misma ficha.",
        },
      ],
    },
  ],
};
