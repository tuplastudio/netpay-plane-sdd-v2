import type { HelpCategory } from "./types";

export const whatsapp: HelpCategory = {
  slug: "whatsapp",
  title: "WhatsApp y conversaciones",
  articles: [
    {
      slug: "conectar-whatsapp",
      title: "Conectar WhatsApp",
      summary:
        "Vincula un número real de WhatsApp a tu negocio: por Meta (API oficial) o por Evolution (con un código QR, más rápido de arrancar).",
      audience: "owner",
      keywords: ["qr", "vincular whatsapp", "canal", "meta", "evolution", "número de whatsapp", "instancia"],
      body: [
        {
          type: "p",
          text:
            "\"Conectar WhatsApp\" quiere decir vincular un número real de WhatsApp a tu negocio dentro del " +
            "sistema. Un número vinculado se llama \"canal\". Mientras no conectes ningún canal, ningún mensaje " +
            "de WhatsApp entra al sistema: los clientes te seguirían escribiendo a un número normal, sin que " +
            "el agente automático ni tu equipo lo vean en Conversaciones.",
        },
        {
          type: "p",
          text:
            "Hay dos formas de conectar un número, y sirven para cosas distintas. Evolution te deja arrancar " +
            "en minutos escaneando un código QR, como cuando abres WhatsApp Web. Meta es la conexión oficial " +
            "de WhatsApp Business API, pero primero necesitas tener esa cuenta ya aprobada por Meta; el panel " +
            "no puede tramitar esa aprobación por ti, solo conectar el número una vez que Meta ya te la dio.",
        },
        {
          type: "h3",
          text: "Antes de empezar",
        },
        {
          type: "list",
          items: [
            "Para Evolution: el teléfono con la app de WhatsApp instalada del número que vas a conectar (por ejemplo, el número que ya usas para atender a tus clientes en tu taquería o tu tienda de pintura).",
            "Para Meta: una cuenta de WhatsApp Business API ya aprobada por Meta, con su token de acceso y el ID del número (Phone number ID) a la mano.",
          ],
        },
        {
          type: "h3",
          text: "Conectar con Evolution (código QR)",
        },
        {
          type: "p",
          text:
            "Al elegir esta opción, el sistema crea automáticamente una \"instancia\" — el nombre técnico de " +
            "esa conexión activa entre tu número de WhatsApp y el sistema — y configura sola el webhook (el " +
            "enlace por el que llegan los mensajes nuevos). No necesitas entrar al panel de Evolution ni copiar " +
            "ninguna credencial a mano.",
        },
        {
          type: "steps",
          items: [
            "Ve a \"Canales\" en el menú principal.",
            "Da clic en el botón \"Conectar canal\", arriba a la derecha de la página.",
            "Se abre un panel con la pregunta \"¿Cómo quieres conectar tu WhatsApp?\" y dos opciones.",
            "Elige \"WhatsApp (Evolution) — Alta con QR\".",
            "Si quieres, escribe el número que vas a usar (con su código de país). Es opcional: si lo dejas vacío, el sistema lo completa solo en cuanto escaneas.",
            "Da clic en \"Generar QR\".",
            "Aparece un código QR en pantalla.",
            "Abre WhatsApp en el teléfono del número que quieres conectar.",
            "Dentro de WhatsApp: Ajustes → Dispositivos vinculados → Vincular un dispositivo.",
            "Apunta la cámara del teléfono al código QR de la pantalla del panel.",
            "Espera unos segundos: el panel muestra \"Canal conectado\" y el número queda como \"Activa\" en la tabla de canales.",
          ],
        },
        {
          type: "callout",
          tone: "info",
          text:
            "El QR de Evolution rota cada ~60 segundos si no lo escaneas a tiempo — el panel lo refresca solo, " +
            "no hace falta recargar la página. Si te tardas en ir por el teléfono, no pasa nada: cuando " +
            "regreses va a haber un QR distinto pero igual de válido en la misma pantalla.",
        },
        {
          type: "callout",
          tone: "warning",
          title: "Si cierras el panel antes de terminar",
          text:
            "Si cierras la ventana antes de ver \"Canal conectado\", la instancia se queda a medias: no se " +
            "borra, pero tampoco recibe mensajes todavía. Vuelve a \"Canales\" → \"Conectar canal\" y repite " +
            "el proceso; no hay límite de intentos.",
        },
        {
          type: "h3",
          text: "Conectar con Meta (API oficial)",
        },
        {
          type: "p",
          text:
            "Esta opción no crea ni aprueba nada por ti: solo conecta al sistema una cuenta de WhatsApp " +
            "Business API que Meta ya te haya aprobado por fuera. Si todavía no tienes esa cuenta, tienes que " +
            "tramitarla directamente con Meta antes de este paso.",
        },
        {
          type: "steps",
          items: [
            "Ve a \"Canales\" → \"Conectar canal\".",
            "Elige \"WhatsApp (Meta) — API oficial\".",
            "Escribe el número de WhatsApp en formato internacional, con código de país (por ejemplo +5215500000000).",
            "Pega el \"Token de acceso\" que te dio Meta.",
            "Pega el \"ID del número\" (Phone number ID) que te dio Meta.",
            "Da clic en \"Conectar\".",
          ],
        },
        {
          type: "callout",
          tone: "warning",
          title: "El token no se vuelve a mostrar",
          text:
            "Las credenciales que pegas se guardan cifradas y el sistema no las vuelve a mostrar en pantalla, " +
            "ni a ti ni a nadie de tu equipo. Si necesitas cambiarlas más adelante, tendrás que generar un " +
            "token nuevo en Meta y volver a conectar el canal con ese token.",
        },
        {
          type: "h3",
          text: "Qué pasa después de conectar",
        },
        {
          type: "p",
          text:
            "El número aparece en la tabla de \"Canales\" con su estado. Desde ese momento, cualquier mensaje " +
            "que llegue a ese número aparece como una conversación nueva en \"Conversaciones\", y el agente " +
            "automático puede empezar a contestar ahí mismo — a menos que decidas atenderla tú (ver el " +
            "artículo de la bandeja de conversaciones).",
        },
      ],
      related: ["bandeja-de-conversaciones", "el-agente-automatico"],
    },
    {
      slug: "bandeja-de-conversaciones",
      title: "Bandeja de conversaciones",
      summary:
        "Filtrar los hilos, tomar uno para atenderlo tú, transferirlo a otra persona del equipo y devolverlo al agente cuando termines.",
      audience: "owner",
      keywords: ["conversaciones", "handoff", "escalar", "asignar", "nota interna", "etiqueta"],
      body: [
        {
          type: "p",
          text:
            "\"Conversaciones\" es la bandeja de entrada de todos los hilos de WhatsApp que llegan por los " +
            "números que conectaste en \"Canales\". Cada hilo es la conversación completa con un cliente, con " +
            "todos sus mensajes en orden, igual que en el WhatsApp normal. En cualquier momento, un hilo está " +
            "en manos del agente automático o en manos de una persona de tu equipo — nunca de los dos a la " +
            "vez.",
        },
        {
          type: "h3",
          text: "Filtrar los hilos",
        },
        {
          type: "p",
          text:
            "Arriba de la lista hay un selector de \"Estado\" y un botón \"Más filtros\" con cuatro filtros " +
            "adicionales: \"Atención\" (si lo lleva el agente o una persona), \"Canal\" (Meta o Evolution), " +
            "\"Periodo\" (hoy, últimos 7 días, últimos 30 días o todo el tiempo) y \"Etiqueta\". Puedes combinar " +
            "varios filtros a la vez; el número junto al botón te dice cuántos filtros extra tienes activos.",
        },
        {
          type: "table",
          headers: ["Estado", "Qué significa"],
          rows: [
            ["Abierta", "Hay actividad reciente y el hilo sigue en curso, ya sea con el agente o con una persona."],
            ["Escalada", "El hilo pasó a manos de una persona. Puede que ya esté asignada a alguien o que siga esperando en la cola sin asignar."],
            ["Cerrada", "El hilo ya no está activo."],
          ],
        },
        {
          type: "h3",
          text: "Tomar un hilo",
        },
        {
          type: "p",
          text:
            "El botón \"Tomar\" saca el hilo de la cola sin asignar y te lo pone a ti: a partir de ese momento, " +
            "el agente automático deja de contestar ahí y eres tú quien escribe. Úsalo, por ejemplo, cuando un " +
            "cliente de tu boutique pide hablar directamente contigo por una queja o un pedido especial.",
        },
        {
          type: "h3",
          text: "Transferir a otra persona",
        },
        {
          type: "p",
          text:
            "\"Transferir a una persona\" le pasa el hilo a otro miembro de tu equipo (el agente automático " +
            "sigue sin contestar ahí). Es útil cuando el tema no te toca a ti: por ejemplo, si atiendes ventas " +
            "y el cliente necesita hablar con quien lleva las cuentas, transfieres el hilo a esa persona y " +
            "ella sigue la conversación desde donde la dejaste.",
        },
        {
          type: "h3",
          text: "Devolver al agente",
        },
        {
          type: "p",
          text:
            "\"Devolver al agente\" hace lo contrario a tomar un hilo: sueltas la conversación y el agente " +
            "automático la retoma. Tiene sentido en cuanto ya resolviste lo que hacía falta una persona y el " +
            "resto (por ejemplo, mandar el link de pago o confirmar el pedido) lo puede seguir el bot solo.",
        },
        {
          type: "h3",
          text: "Notas internas",
        },
        {
          type: "p",
          text:
            "Puedes dejar una \"Nota interna\" sobre el hilo completo, o sobre un mensaje puntual dentro de " +
            "ese hilo. En ningún caso el cliente las ve — están ahí solo para que tu equipo se coordine. Por " +
            "ejemplo: \"Ya le prometí el descuento de temporada, no se lo vuelvan a cobrar completo\" en la " +
            "nota del hilo, o una nota sobre un mensaje puntual para aclarar \"este precio ya está vencido, no " +
            "es válido\".",
        },
        {
          type: "callout",
          tone: "info",
          text:
            "Un hilo solo puede estar asignado a una persona a la vez. Si lo transfieres, deja de estar " +
            "asignado a ti; si lo devuelves al agente, deja de estar asignado a cualquier persona.",
        },
      ],
      related: ["el-agente-automatico", "conectar-whatsapp"],
    },
    {
      slug: "el-agente-automatico",
      title: "Qué hace el agente automático",
      summary:
        "Cotiza con el catálogo real, nunca inventa precios ni existencias, y sabe cuándo pasarte el hilo a ti.",
      audience: "owner",
      keywords: ["bot", "chatbot", "agente", "handoff", "escalar", "conocimiento", "negocio.md"],
      body: [
        {
          type: "p",
          text:
            "El agente automático es el programa que contesta por WhatsApp cuando nadie de tu equipo ha tomado " +
            "el hilo. No es una persona: es un sistema que lee tu catálogo real y responde con eso, todo el " +
            "tiempo, sin descansos ni horarios.",
        },
        {
          type: "h3",
          text: "Qué contesta",
        },
        {
          type: "list",
          items: [
            "Precio y existencia reales: si tu paletería tiene 3 heladeras registradas en el catálogo y ya se vendieron todas, el agente no le va a decir al cliente que hay disponibles.",
            "Cotizaciones completas, con los productos, cantidades y el total que le corresponde a ese cliente.",
            "Links de pago, para que el cliente pague directamente desde WhatsApp sin que tengas que generarlos tú a mano.",
            "Preguntas del negocio (horarios, dirección, formas de pago, políticas) con base en lo que hayas cargado en Consola del agente → Conocimiento.",
          ],
        },
        {
          type: "callout",
          tone: "info",
          title: "Por qué importa que no invente",
          text:
            "Si el agente contestara con precios o existencias que se le ocurrieran en el momento, un cliente " +
            "podría comprar algo que ya no tienes, o a un precio que tú nunca autorizaste. Por eso siempre " +
            "consulta el catálogo real antes de responder, en vez de \"recordar\" un precio de una " +
            "conversación anterior.",
        },
        {
          type: "h3",
          text: "Cuándo escala a una persona",
        },
        {
          type: "callout",
          tone: "warning",
          title: "Cuándo escala a una persona",
          text:
            "El agente pasa el hilo a un humano cuando el cliente pide expresamente hablar con alguien, se " +
            "queja, o pide precio especial / crédito — no lo hace solo porque algo falló técnicamente una vez; " +
            "para eso reintenta antes de rendirse.",
        },
        {
          type: "p",
          text:
            "En términos prácticos: si el cliente de tu ferretería escribe \"quiero hablar con una persona\" o " +
            "\"esto está carísimo, ¿me pueden hacer un descuento especial?\", el hilo pasa a la cola sin " +
            "asignar y el estado de la conversación cambia a \"Escalada\" — cualquiera de tu equipo puede " +
            "\"Tomarlo\" desde ahí. En cambio, si el agente tiene un tropiezo técnico puntual (por ejemplo, una " +
            "consulta al catálogo que tarda más de lo normal), primero intenta de nuevo por su cuenta antes de " +
            "rendirse y pasarte el hilo.",
        },
        {
          type: "h3",
          text: "Probar el agente sin arriesgar nada",
        },
        {
          type: "p",
          text:
            "Puedes probar cómo respondería el agente antes de que hable con un cliente real, desde \"Chat con " +
            "el agente\" — es el mismo bot que contesta en WhatsApp, pero en un hilo de prueba tuyo. Escríbele " +
            "como si fueras un cliente (\"¿cuánto cuesta tal producto?\", \"¿tienen envío a domicilio?\") y " +
            "revisa si la respuesta es la que esperarías que le llegara a alguien de verdad.",
        },
        {
          type: "callout",
          tone: "success",
          text:
            "Reiniciar esa conversación de prueba solo borra el historial, el carrito y la cotización en curso " +
            "de esa prueba. No toca ninguna conversación real con clientes ni nada de lo que ya esté guardado " +
            "en Conversaciones.",
        },
      ],
      related: ["bandeja-de-conversaciones"],
    },
  ],
};
