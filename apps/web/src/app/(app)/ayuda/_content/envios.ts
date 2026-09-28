import type { HelpCategory } from "./types";

export const envios: HelpCategory = {
  slug: "envios",
  title: "Envío a domicilio",
  articles: [
    {
      slug: "zonas-de-envio",
      title: "Configurar zonas de envío",
      summary:
        "Cobra distinto según código postal, ciudad o estado del cliente: cómo crear una zona, cómo se elige cuál aplica, y qué es la zona catch-all.",
      audience: "owner",
      keywords: [
        "zona de envío",
        "código postal",
        "envío fijo",
        "tarifa plana",
        "catch-all",
        "pedido mínimo",
        "orden de evaluación",
      ],
      body: [
        {
          type: "p",
          text:
            "Una zona de envío te deja cobrar distinto por la entrega a domicilio según en dónde viva el " +
            "cliente. Por ejemplo, en una taquería que sí reparte a domicilio, puedes cobrar $30 de envío " +
            "para las colonias del centro (cerca del local) y $80 para colonias más lejanas, en vez de " +
            "cobrar siempre lo mismo sin importar la distancia.",
        },
        { type: "h3", text: "Cómo se define una zona" },
        {
          type: "p",
          text:
            "Una zona cubre un área de una de estas dos formas, o de ninguna (la zona \"catch-all\"):",
        },
        {
          type: "list",
          items: [
            "Por códigos postales: una lista de códigos separados por coma o espacio, por ejemplo \"06000, " +
              "06010, 06020\". La zona aplica si el código postal del cliente es exactamente uno de esos.",
            "Por estado y ciudad, juntos: escribe el estado (por ejemplo \"JAL\", \"CDMX\" o \"NL\") y un " +
              "patrón de ciudad (por ejemplo \"Guadalajara\" o \"Zapopan\"). La zona aplica si el estado " +
              "coincide y la ciudad del cliente contiene ese patrón.",
            "Sin códigos postales, sin ciudad y sin estado: es la zona catch-all. Aplica a todas las " +
              "direcciones que no encajaron en otra zona. Solo puede haber una.",
          ],
        },
        {
          type: "callout",
          tone: "warning",
          title: "El estado solo no basta",
          text:
            "Una zona con estado pero sin patrón de ciudad no se aplica nunca: ni coincide por ciudad ni " +
            "cuenta como catch-all. Si quieres cubrir todo un estado, usa sus códigos postales, o llena " +
            "estado y ciudad para cada ciudad que te interese.",
        },
        {
          type: "p",
          text:
            "Además, cada zona tiene: nombre (\"Centro\", \"Zona metropolitana\", \"Foráneo\"), precio del " +
            "envío en pesos, pedido mínimo (opcional), orden de evaluación, notas internas y la casilla " +
            "\"Activa\".",
        },
        {
          type: "callout",
          tone: "info",
          title: "El pedido mínimo es una referencia",
          text:
            "Por ahora, el pedido mínimo se guarda como referencia para tu equipo, pero el sistema no lo " +
            "aplica solo al calcular el envío. Si tienes una regla como \"envío gratis arriba de $500\", " +
            "escríbela también en las Reglas adicionales del agente.",
        },
        {
          type: "callout",
          tone: "info",
          text:
            "El orden de evaluación importa cuando dos zonas podrían aplicar a la misma dirección: un número " +
            "menor se revisa primero. Si dos zonas tienen el mismo código postal, gana la de número menor.",
        },
        { type: "h3", text: "Cómo se elige la zona de un cliente" },
        {
          type: "steps",
          items: [
            "Primero se busca una zona activa que tenga el código postal del cliente.",
            "Si no hay, se busca una zona con el mismo estado y un patrón de ciudad que aparezca en la " +
              "ciudad del cliente.",
            "Si no hay, se usa la zona catch-all.",
            "Si tampoco hay catch-all (o no tienes ninguna zona activa), se cobra el \"Envío fijo\" de " +
              "Admin → Empresa.",
          ],
        },
        {
          type: "p",
          text:
            "El agente pide código postal, ciudad y estado antes de calcular el envío (si tienes activado " +
            "\"Pedir dirección antes de cotizar a domicilio\"). Con esos datos resuelve la zona y ajusta el " +
            "total de la cotización.",
        },
        { type: "h3", text: "Crear o editar una zona" },
        {
          type: "steps",
          items: [
            "Ve a Admin → Envío a domicilio.",
            "Pulsa \"Nueva zona\" (o el ícono de editar sobre una zona que ya existe).",
            "Escribe el nombre de la zona.",
            "Pon el precio del envío para esa zona, en pesos mexicanos.",
            "Define el área: llena códigos postales, o estado y patrón de ciudad juntos. Si dejas los tres " +
              "vacíos, esa zona se vuelve la catch-all (solo puede haber una).",
            "Opcional: pon un pedido mínimo para esa zona, un orden de evaluación, y notas internas.",
            "Deja marcada la casilla \"Activa\" si quieres que el sistema ya la use; desmárcala si la " +
              "quieres guardar pero todavía no aplicarla.",
            "Guarda con \"Crear zona\" (o \"Guardar cambios\" si estabas editando una existente).",
          ],
        },
        {
          type: "callout",
          tone: "warning",
          text:
            "Solo puede existir una zona catch-all por empresa. Si ya tienes una y tratas de crear o editar " +
            "otra zona dejando vacíos los tres campos de área (códigos postales, ciudad y estado), el " +
            "sistema rechaza el intento — tienes que elegir un área específica para la nueva zona, o borrar " +
            "primero la catch-all que ya existe si en verdad quieres reemplazarla.",
        },
        {
          type: "callout",
          tone: "warning",
          text:
            "Si eliminas una zona, las direcciones que antes caían en ella no se quedan sin precio de " +
            "envío: automáticamente empiezan a usar el envío fijo estándar de tu empresa (o la zona " +
            "catch-all, si tienes una). Antes de eliminar una zona que está en uso, piensa si en realidad " +
            "quieres desactivarla (dejarla pero sin que aplique) en vez de borrarla del todo — desactivar es " +
            "reversible con un clic, borrar no.",
        },
        {
          type: "p",
          text:
            "Sugerencia práctica: crea primero las zonas específicas por código postal para tus zonas más " +
            "comunes (por ejemplo \"Centro CDMX\" con los códigos postales del 06000 al 06099), y deja una " +
            "zona catch-all al final como precio por defecto para todo lo demás que no listaste una por " +
            "una.",
        },
        {
          type: "callout",
          tone: "info",
          text: "Cada cambio de precio o zona queda en la bitácora de auditoría, por si un cliente reclama lo que se le cobró de envío.",
        },
        {
          type: "callout",
          tone: "info",
          text:
            "¿Qué es la \"bitácora de auditoría\"? Es un registro interno de quién cambió qué y cuándo, " +
            "dentro del sistema — como una libreta que anota automáticamente cada modificación. No la edita " +
            "nadie a mano; sirve para que, si un cliente dice \"a mí me cobraron $50 de envío la semana " +
            "pasada y ahora me quieren cobrar $80\", puedas revisar exactamente cuándo cambió el precio de " +
            "esa zona y quién lo hizo, en vez de tener que confiar en la memoria de alguien.",
        },
      ],
    },
    {
      slug: "preguntas-envios",
      title: "Preguntas frecuentes: envío a domicilio",
      summary: "Por qué se cobró cierto envío, cómo ofrecer envío gratis y cómo trabaja el agente con las zonas.",
      audience: "owner",
      keywords: ["faq", "envío gratis", "costo de envío", "zona incorrecta", "recoger en tienda"],
      body: [
        {
          type: "faq",
          items: [
            {
              q: "¿Cómo ofrezco envío gratis?",
              a:
                "Crea una zona con precio 0.00 para el área donde el envío es gratis. Si quieres envío gratis " +
                "solo a partir de cierto monto, escríbelo en las Reglas adicionales del agente: el pedido " +
                "mínimo de una zona por ahora es solo una referencia y no se aplica solo.",
            },
            {
              q: "Al cliente se le cobró un envío que no esperaba.",
              a:
                "Revisa qué zona coincidió con su dirección: primero se busca por código postal, luego por " +
                "estado y ciudad juntos, luego la zona catch-all y al final el envío fijo. Revisa también " +
                "que la zona que esperabas esté activa.",
            },
            {
              q: "¿El agente pregunta la dirección?",
              a:
                "Sí, si tienes activado \"Pedir dirección antes de cotizar a domicilio\" en la configuración " +
                "del agente. Pregunta código postal, ciudad y estado y aplica tus zonas. Si está apagado, usa " +
                "el envío fijo.",
            },
            {
              q: "Mi negocio no hace envíos.",
              a:
                "En la configuración del agente, pon \"Entrega por defecto\" en recoger en tienda y escribe en " +
                "Reglas adicionales algo como \"No hacemos envíos a domicilio\".",
            },
            {
              q: "El cliente mandó su ubicación de WhatsApp.",
              a:
                "La ubicación no basta para elegir zona. El agente le pide código postal, ciudad y estado.",
            },
          ],
        },
      ],
      related: ["zonas-de-envio", "datos-de-la-empresa"],
    },
  ],
};
