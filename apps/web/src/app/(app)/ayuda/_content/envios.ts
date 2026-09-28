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
            "Una zona de envío se define por códigos postales, un patrón de ciudad, un estado, o ninguno de " +
            "los tres (esa es la zona \"catch-all\": solo puede haber una por empresa, y es la que aplica " +
            "cuando ninguna otra zona coincide).",
        },
        {
          type: "list",
          items: [
            "Códigos postales: escribes una lista de códigos postales (de 4 o 5 dígitos cada uno, separados " +
              "por coma o espacio, por ejemplo \"06000, 06010, 06020\"). La zona aplica solo si la dirección " +
              "del cliente cae exactamente en uno de esos códigos.",
            "Patrón de ciudad: el nombre de una ciudad (por ejemplo \"Guadalajara\" o \"Zapopan\"). Útil " +
              "cuando no quieres listar cada código postal uno por uno.",
            "Estado o departamento: por ejemplo \"JAL\", \"CDMX\" o \"NL\". Cubre toda esa entidad.",
            "Ninguno de los tres campos anteriores lleno: eso convierte la zona en \"catch-all\" (todas las " +
              "direcciones que no encajaron en ninguna otra zona).",
          ],
        },
        {
          type: "p",
          text:
            "Además del área que cubre, cada zona tiene: un nombre (para que la reconozcas en la lista, por " +
            "ejemplo \"Centro\", \"Zona metropolitana\" o \"Foráneo\"), el precio del envío en pesos " +
            "mexicanos, un pedido mínimo opcional para poder usar esa zona (por ejemplo, envío gratis solo " +
            "si el pedido es mayor a $500), un \"orden de evaluación\" (qué zona se revisa primero cuando " +
            "una dirección podría encajar en más de una), notas internas opcionales, y si la zona está " +
            "activa o no.",
        },
        {
          type: "callout",
          tone: "info",
          text:
            "El \"orden de evaluación\" importa cuando dos zonas podrían aplicar a la misma dirección. Un " +
            "número menor se revisa antes. Por ejemplo, si tienes una zona \"Centro CDMX\" (por código " +
            "postal) y otra zona más amplia \"CDMX\" (por estado), le pones a \"Centro CDMX\" un número de " +
            "orden más bajo para que se revise primero — así una dirección del centro toma el precio de " +
            "\"Centro CDMX\" y no el de la zona más general por estado.",
        },
        { type: "h3", text: "Cómo se elige la zona de un cliente" },
        {
          type: "p",
          text:
            "Cuando un cliente da su dirección (por chat o en el checkout), el sistema resuelve automáticamente " +
            "qué zona le toca y ajusta el costo de envío en la cotización. Sin dirección, se usa la tarifa " +
            "plana de tu empresa (Admin → Empresa).",
        },
        {
          type: "p",
          text:
            "El orden en el que se busca la zona correcta es: primero se busca una coincidencia exacta de " +
            "código postal, después una coincidencia de estado más ciudad, y al final, si nada de lo " +
            "anterior coincidió, se usa la zona catch-all (si existe). Si ni siquiera hay una zona catch-all " +
            "configurada, se cobra el envío estándar de tu empresa — el campo \"Envío fijo\" (en pesos " +
            "mexicanos) que se configura en Admin → Empresa, y que se cobra siempre que la dirección no cae " +
            "en ninguna zona específica.",
        },
        {
          type: "callout",
          tone: "info",
          text:
            "Piensa en el \"envío fijo\" de Admin → Empresa como el precio de respaldo cuando aún no has " +
            "configurado ninguna zona, o cuando la dirección del cliente cae fuera de todas las zonas que " +
            "sí tienes creadas y no configuraste una zona catch-all para cubrir el resto de los casos.",
        },
        { type: "h3", text: "Crear o editar una zona" },
        {
          type: "steps",
          items: [
            "Ve a Admin → Envío a domicilio.",
            "Pulsa \"Nueva zona\" (o el ícono de editar sobre una zona que ya existe).",
            "Escribe el nombre de la zona.",
            "Pon el precio del envío para esa zona, en pesos mexicanos.",
            "Llena códigos postales, patrón de ciudad o estado — según cómo quieras definir el área. Si los " +
              "dejas todos vacíos, esa zona se vuelve la zona catch-all (recuerda: solo puede haber una).",
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
  ],
};
