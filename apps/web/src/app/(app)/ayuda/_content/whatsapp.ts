import type { HelpCategory } from "./types";

export const whatsapp: HelpCategory = {
  slug: "whatsapp",
  title: "WhatsApp y conversaciones",
  articles: [
    {
      slug: "conectar-whatsapp",
      title: "Conectar WhatsApp",
      summary:
        "Vincula un número real de WhatsApp a tu negocio: por Evolution (con un código QR, en minutos) o por Meta (API oficial). También cómo desconectarlo.",
      audience: "owner",
      keywords: ["qr", "vincular whatsapp", "canal", "meta", "evolution", "número de whatsapp", "instancia", "desconectar"],
      body: [
        {
          type: "p",
          text:
            "\"Conectar WhatsApp\" es vincular un número real de WhatsApp a tu negocio. Un número vinculado " +
            "se llama \"canal\". Sin canal, ningún mensaje de WhatsApp entra al panel: tus clientes seguirían " +
            "escribiendo a un número normal y ni el agente ni tu equipo lo verían.",
        },
        {
          type: "table",
          headers: ["", "Evolution (QR)", "Meta (API oficial)"],
          rows: [
            ["Qué necesitas", "El celular con WhatsApp del número que vas a conectar.", "Una cuenta de WhatsApp Business API ya aprobada por Meta, con su token y el ID del número."],
            ["Cuánto tarda", "Unos minutos.", "Lo que tarde Meta en aprobarte (el panel no hace ese trámite)."],
            ["Notas de voz, fotos y videos", "Sí, el agente los recibe.", "Por ahora el agente recibe solo texto."],
            ["Ideal para", "Empezar ya con tu número de siempre.", "Negocios que ya trabajan con la API oficial de Meta."],
          ],
        },
        { type: "h3", text: "Conectar con Evolution (código QR)" },
        {
          type: "p",
          text:
            "El sistema crea solo la \"instancia\" (el nombre técnico de la conexión entre tu número y el " +
            "panel) y configura solo el aviso por el que llegan los mensajes. No copias ninguna clave a mano.",
        },
        {
          type: "steps",
          items: [
            "Ve a Canales y da clic en \"Conectar canal\", arriba a la derecha.",
            "En \"¿Cómo quieres conectar tu WhatsApp?\", elige \"WhatsApp (Evolution) — Alta con QR\".",
            "Si quieres, escribe el número que vas a usar, con código de país. Es opcional: se completa solo " +
              "al escanear.",
            "Da clic en \"Generar QR\". Aparece un código QR.",
            "En el celular de ese número, abre WhatsApp → Ajustes → Dispositivos vinculados → Vincular un " +
              "dispositivo.",
            "Apunta la cámara al QR de la pantalla.",
            "Espera unos segundos. La pantalla muestra \"Canal listo y conectado\" y el número queda como " +
              "\"Conectado\" en la tabla.",
          ],
        },
        {
          type: "callout",
          tone: "info",
          text:
            "El QR cambia más o menos cada 60 segundos si no lo escaneas. La página lo actualiza sola; no " +
            "hace falta recargar.",
        },
        {
          type: "callout",
          tone: "warning",
          title: "Mantén el celular con internet",
          text:
            "Con Evolution, tu número funciona como WhatsApp Web: el celular debe tener batería e internet " +
            "de vez en cuando. Si cierras sesión de ese dispositivo desde el celular, el canal se desconecta y " +
            "tienes que volver a escanear.",
        },
        { type: "h3", text: "Conectar con Meta (API oficial)" },
        {
          type: "steps",
          items: [
            "Ve a Canales → \"Conectar canal\" y elige \"WhatsApp (Meta) — API oficial\".",
            "Escribe el número en formato internacional, por ejemplo +5215500000000.",
            "Pega el \"Token de acceso\" y el \"ID del número (Phone number ID)\" que te dio Meta.",
            "Da clic en \"Conectar\".",
          ],
        },
        {
          type: "callout",
          tone: "warning",
          title: "El token no se vuelve a mostrar",
          text:
            "Las credenciales se guardan cifradas y nadie las vuelve a ver en pantalla. Para cambiarlas, " +
            "genera un token nuevo en Meta y vuelve a conectar el canal.",
        },
        { type: "h3", text: "Estados de un canal" },
        {
          type: "table",
          headers: ["Estado", "Qué significa"],
          rows: [
            ["Conectado", "Funciona: recibe y manda mensajes."],
            ["Esperando confirmación", "Se creó, pero falta escanear el QR o todavía no llega el primer aviso de WhatsApp."],
            ["Con error", "Algo falló (por ejemplo, se cerró la sesión en el celular). Pasa el cursor para ver el motivo y vuelve a conectarlo."],
            ["Desconectado", "Está apagado. No recibe ni manda mensajes."],
          ],
        },
        { type: "h3", text: "Desconectar un canal" },
        {
          type: "p",
          text:
            "En la tabla de Canales, abre el menú de acciones del número y elige \"Desconectar\". El canal " +
            "deja de mandar y recibir mensajes hasta que lo vuelvas a conectar. Las conversaciones anteriores " +
            "se conservan.",
        },
      ],
      related: ["bandeja-de-conversaciones", "el-agente-automatico", "preguntas-whatsapp"],
    },
    {
      slug: "bandeja-de-conversaciones",
      title: "Bandeja de conversaciones",
      summary:
        "Filtrar y buscar conversaciones, tomar una para atenderla tú, contestar con texto, audio o archivos, cotizar sin salir del chat, transferir y devolver al agente.",
      audience: "owner",
      keywords: ["conversaciones", "handoff", "escalar", "asignar", "nota interna", "etiqueta", "tomar", "transferir", "adjuntar", "atajos"],
      body: [
        {
          type: "p",
          text:
            "Conversaciones es la bandeja de entrada de WhatsApp. Cada conversación (también la llamamos " +
            "\"hilo\") es el chat completo con un cliente, con todos sus mensajes en orden. En todo momento " +
            "una conversación la lleva el agente o una persona de tu equipo, nunca los dos a la vez.",
        },
        { type: "h3", text: "Lo que ves en pantalla" },
        {
          type: "list",
          items: [
            "Arriba, un resumen: conversaciones abiertas, sin responder (el último mensaje es del cliente y " +
              "nadie contestó), con una persona, de hoy, y cuánto lleva esperando la más antigua.",
            "A la izquierda, la lista de conversaciones. Las que esperan respuesta se marcan.",
            "Al centro, los mensajes de la conversación que elegiste.",
            "A la derecha, el contexto del cliente: su ficha, cotizaciones y pedidos en curso, pagos, datos " +
              "de facturación y actividad.",
          ],
        },
        { type: "h3", text: "Buscar y filtrar" },
        {
          type: "p",
          text:
            "Usa el buscador de la lista (o la tecla /). Con el selector de estado y \"Más filtros\" puedes " +
            "filtrar por quién atiende (Con el agente / Con una persona), canal, periodo (hoy, 7 días, 30 días, " +
            "todo) y etiqueta. El número junto a \"Más filtros\" dice cuántos filtros extra tienes activos.",
        },
        {
          type: "table",
          headers: ["Estado", "Qué significa"],
          rows: [
            ["Abierta", "Conversación en curso, con el agente o con una persona."],
            ["Escalada", "Pasó a una persona. Puede estar asignada a alguien o esperando en la cola."],
            ["Cerrada", "Terminó. Si el cliente vuelve a escribir, se reabre sola."],
          ],
        },
        { type: "h3", text: "Tomar una conversación" },
        {
          type: "p",
          text:
            "Da clic en \"Tomar la conversación\". Desde ese momento el agente deja de contestar ahí y tú " +
            "escribes. Úsalo, por ejemplo, cuando un cliente pide hablar contigo por una queja o un pedido " +
            "especial.",
        },
        { type: "h3", text: "Contestar" },
        {
          type: "list",
          items: [
            "Texto: escribe abajo y presiona Enter. Shift + Enter hace un salto de línea.",
            "Emojis: con el botón de emoji.",
            "Nota de voz: con el botón del micrófono. Vuelve a dar clic para detener y enviar.",
            "Archivos: con el botón de adjuntar (clip), arrastrándolos a la conversación o pegando una " +
              "imagen (Ctrl + V). " +
              "Acepta fotos, audios, videos, PDF, Word y Excel, de hasta 25 MB cada uno.",
          ],
        },
        {
          type: "callout",
          tone: "info",
          text:
            "Si tu empresa activó la revisión de respuestas del equipo, un mensaje ofensivo o con una promesa " +
            "que no puedes cumplir se puede bloquear antes de salir. Verás el motivo para que lo reescribas.",
        },
        { type: "h3", text: "Cotizar sin salir del chat" },
        {
          type: "steps",
          items: [
            "En el panel del cliente (derecha), da clic en \"Cotizar rápido\".",
            "Busca productos y agrega las variantes con su cantidad.",
            "Confirma. La cotización se crea y el link se manda al cliente en el mismo chat.",
          ],
        },
        {
          type: "callout",
          tone: "warning",
          text:
            "Para cotizar, la conversación necesita una ficha de cliente vinculada. Si ves \"Vincula una ficha " +
            "de cliente para poder cotizarle\", primero vincula o crea la ficha desde el panel del cliente.",
        },
        { type: "h3", text: "Transferir, devolver al agente y cerrar" },
        {
          type: "list",
          items: [
            "Transferir a una persona: le pasas la conversación a otro miembro del equipo marcado como " +
              "\"Agente WhatsApp activo\" en Admin → Usuarios. El agente sigue sin contestar.",
            "Devolver al bot: sueltas la conversación y el bot vuelve a contestar. Útil cuando ya " +
              "resolviste lo que necesitaba una persona.",
            "Resolver conversación: la saca de pendientes y libera la asignación. Si el cliente vuelve a " +
              "escribir, se reabre sola. Para escribirle tú a una resuelta, primero dale \"Reabrir\".",
          ],
        },
        { type: "h3", text: "Etiquetas y notas internas" },
        {
          type: "p",
          text:
            "Las etiquetas (por ejemplo \"mayoreo\" o \"urgente\") se agregan en el encabezado de la " +
            "conversación y sirven para filtrar después. Las notas internas se dejan sobre toda la " +
            "conversación o sobre un mensaje. El cliente nunca ve etiquetas ni notas. Ejemplo de nota: \"Ya " +
            "le prometí el descuento de temporada, no se lo cobren completo\".",
        },
        { type: "h3", text: "Atajos de teclado" },
        {
          type: "table",
          headers: ["Tecla", "Qué hace"],
          rows: [
            ["↑ / ↓", "Moverse entre conversaciones de la lista."],
            ["Enter", "Abrir la conversación seleccionada, o enviar un mensaje."],
            ["Inicio / Fin", "Ir a la primera o última conversación."],
            ["x", "Marcar o desmarcar la conversación enfocada (para acciones en lote)."],
            ["/ o Ctrl/Cmd + K", "Buscar (en la bandeja). En el redactor, / abre las respuestas rápidas."],
            ["Ctrl/Cmd + Enter", "Enviar."],
            ["Ctrl/Cmd + Shift + R", "Resolver la conversación abierta (o reabrirla si estaba resuelta)."],
            ["Ctrl/Cmd + Shift + P", "Marcar o quitar \"pendiente\"."],
            ["Ctrl/Cmd + Shift + T", "Tomar la conversación abierta."],
            ["Esc", "Volver a la bandeja, o quitar la selección en lote."],
          ],
        },
      ],
      related: ["mesa-de-ayuda", "el-agente-automatico", "conectar-whatsapp", "fotos-audio-y-video"],
    },
    {
      slug: "mesa-de-ayuda",
      title: "Mesa de ayuda: tickets, prioridades y respuestas rápidas",
      summary:
        "Cómo usar la bandeja como mesa de ayuda: estados de ticket, prioridad, vistas guardadas, acciones en lote, indicadores de tiempo de respuesta y respuestas rápidas con /atajo.",
      audience: "owner",
      keywords: [
        "ticket",
        "prioridad",
        "urgente",
        "pendiente",
        "resuelta",
        "sla",
        "tiempo de respuesta",
        "respuestas rápidas",
        "canned",
        "acciones en lote",
        "vistas guardadas",
        "mis conversaciones",
        "sin asignar",
      ],
      body: [
        {
          type: "p",
          text:
            "Cada conversación de WhatsApp funciona como un ticket de soporte: tiene un estado, una " +
            "prioridad, una persona (o el bot) que la atiende, etiquetas y tiempos medidos. Nada de esto lo ve " +
            "el cliente; es para organizar el trabajo del equipo.",
        },
        { type: "h3", text: "Estados del ticket" },
        {
          type: "table",
          headers: ["Estado", "Qué significa", "Cómo cambia"],
          rows: [
            [
              "Abierta",
              "Hay trabajo por hacer. La atiende el bot o una persona.",
              "Es el estado inicial y al que vuelve cuando el cliente escribe.",
            ],
            [
              "Pendiente",
              "Ustedes ya contestaron y esperan algo del cliente (un dato, un pago, una confirmación). Sale de \"Sin responder\".",
              "Botón del reloj de arena en el encabezado, o Ctrl/Cmd + Shift + P. Se quita sola cuando el cliente escribe.",
            ],
            [
              "Resuelta",
              "Terminó. Se libera la asignación y el bot vuelve a estar a cargo si el cliente regresa.",
              "Botón de palomita (\"Resolver\"), Ctrl/Cmd + Shift + R, o el autocierre por inactividad. Se reabre sola si el cliente escribe.",
            ],
          ],
        },
        {
          type: "callout",
          tone: "info",
          text:
            "\"Escalada\" no es un estado de ticket sino de atención: indica que la conversación pasó del bot a " +
            "una persona. Una conversación abierta puede estar con el bot, con una persona, o sin asignar.",
        },
        { type: "h3", text: "Prioridad" },
        {
          type: "p",
          text:
            "Baja, Normal, Alta o Urgente. Se cambia desde la insignia de prioridad en el encabezado de la " +
            "conversación o desde la tarjeta \"Ticket\" del panel derecho. Las urgentes llevan una franja roja " +
            "en la lista, y el orden \"Prioridad (urgente primero)\" las sube arriba de todo. Cada cambio queda " +
            "en la bitácora (Admin → Auditoría).",
        },
        { type: "h3", text: "Vistas guardadas" },
        {
          type: "table",
          headers: ["Vista", "Qué muestra"],
          rows: [
            ["Bandeja", "Todas las conversaciones."],
            ["Mías", "Las asignadas a ti."],
            ["Sin asignar", "Escaladas a una persona pero sin dueño: alguien tiene que tomarlas."],
            ["Esperando", "El último mensaje es del cliente y nadie ha contestado."],
            ["Pendientes", "Marcadas como pendientes del cliente."],
            ["Resueltas", "Cerradas, a mano o por inactividad."],
            ["Por agente", "Reparto por persona, con cuántos hilos lleva cada quien."],
          ],
        },
        {
          type: "p",
          text:
            "Encima de cada vista aplican los filtros: estado, prioridad, quién atiende, canal, periodo, " +
            "etiqueta y \"solo sin responder\". Los filtros activos se ven como fichas con una × para quitarlos, " +
            "y todo viaja en la dirección de la página: puedes copiar el link y compartirlo.",
        },
        { type: "h3", text: "Indicadores de tiempo (SLA)" },
        {
          type: "list",
          items: [
            "Esperando X: cuánto lleva el cliente sin respuesta. Ámbar antes de 1 hora, rojo después.",
            "1.ª resp. X: cuánto tardó la primera respuesta de una persona desde que la conversación pasó a la cola humana. Verde si fue en menos de 15 minutos, ámbar antes de 1 hora, rojo después.",
            "Pasa el mouse sobre cualquiera para ver la explicación. Los promedios y medianas por agente están en el Reporte de atención.",
          ],
        },
        { type: "h3", text: "Acciones en lote" },
        {
          type: "steps",
          items: [
            "Marca las casillas de las conversaciones (o presiona x con una fila enfocada; la casilla del encabezado marca toda la página).",
            "Arriba aparece la barra de acciones: Asignar a alguien, Prioridad, Etiquetar, Pendiente, Resolver, Reabrir o Devolver al bot.",
            "Si alguna no se pudo (por ejemplo, ya estaba resuelta), te lo dice y las demás sí se aplican.",
          ],
        },
        { type: "h3", text: "Respuestas rápidas" },
        {
          type: "p",
          text:
            "Son textos listos que todo el equipo comparte, como \"/horario\" con el horario de atención o " +
            "\"/gracias\" para cerrar. En el redactor escribe / al inicio del mensaje: aparece la lista, filtra " +
            "por atajo o título, elige con las flechas y presiona Enter para insertar el texto. Puedes editarlo " +
            "antes de enviar.",
        },
        {
          type: "steps",
          items: [
            "En el redactor da clic en \"Rápidas\" (o escribe / y elige \"Administrar\").",
            "Crea una nueva: atajo (sin espacios ni /), título y el texto que se enviará.",
            "Edita o elimina las existentes desde la misma hoja. Se necesita permiso para contestar conversaciones.",
          ],
        },
        { type: "h3", text: "Bot y persona: quién contesta" },
        {
          type: "list",
          items: [
            "Tomar conversación: se asigna a ti y el bot deja de contestar en ese hilo.",
            "Devolver al bot: el bot vuelve a contestar y se suelta la asignación.",
            "Soltar a la cola: sigue con personas pero sin dueño, para que otro la tome.",
            "Asignar a…: se la pasas a un compañero marcado como agente.",
          ],
        },
      ],
      related: ["bandeja-de-conversaciones", "el-agente-automatico", "preguntas-whatsapp"],
    },
    {
      slug: "fotos-audio-y-video",
      title: "Notas de voz, fotos y videos en WhatsApp",
      summary:
        "Qué pasa cuando un cliente manda audio, foto, video, ubicación o un documento, cuáles son los límites y qué hacer si el agente no contesta.",
      audience: "owner",
      keywords: ["audio", "nota de voz", "foto", "imagen", "video", "ubicación", "documento", "pdf", "transcripción", "multimedia"],
      body: [
        {
          type: "p",
          text:
            "Muchos clientes prefieren mandar un audio o una foto en lugar de escribir. El agente entiende " +
            "casi todo, con algunos límites. Esto aplica a números conectados por Evolution (QR).",
        },
        {
          type: "table",
          headers: ["El cliente manda", "Qué pasa", "Límite"],
          rows: [
            ["Nota de voz", "Se convierte en texto. En la bandeja ves el texto del audio, y el agente contesta como si fuera un mensaje escrito.", "Hasta 8 MB (varios minutos de audio)."],
            ["Foto", "El agente la mira. Si trae texto al pie, también lo lee.", "Hasta 5 MB."],
            ["Video", "El agente lo mira, si el modelo configurado puede ver video. Si no puede, le pide al cliente que lo describa o mande una foto.", "Hasta 50 MB."],
            ["Ubicación", "El agente la usa como referencia, pero pide código postal, ciudad y estado para calcular el envío.", "—"],
            ["Documento (PDF, Word…) o sticker", "Por ahora no se procesa: el agente no lo lee ni contesta a ese mensaje.", "—"],
          ],
        },
        {
          type: "callout",
          tone: "info",
          title: "Ejemplos reales",
          text:
            "Un cliente de una ferretería manda foto de una pieza rota: \"¿tienen esta?\". El agente mira la " +
            "foto y busca algo parecido en tu catálogo. Un cliente de una papelería manda foto de la lista " +
            "de útiles escrita a mano: el agente la lee y cotiza lo que tienes.",
        },
        { type: "h3", text: "Videos y el modelo del agente" },
        {
          type: "p",
          text:
            "Ver un video depende del modelo elegido en Consola del agente → General → Modelo. Los modelos " +
            "que entienden video pueden revisar lo que muestra el cliente (por ejemplo, un aparato que hace un " +
            "ruido raro). Si el modelo no entiende video, el agente no se queda callado: le pide al cliente " +
            "que lo describa con palabras o que mande una foto. Revisar un video tarda más que un mensaje de " +
            "texto; es normal que la respuesta tarde unos segundos extra.",
        },
        { type: "h3", text: "Facturas por WhatsApp" },
        {
          type: "p",
          text:
            "Como el agente no lee documentos enviados por WhatsApp, la constancia de situación fiscal no se " +
            "manda como archivo en el chat. El agente le pide al cliente que la suba en su link de pago " +
            "(sección \"¿Necesitas factura?\"), o que comparta un enlace público a su PDF. Si el cliente no la " +
            "tiene, el agente le pide los datos uno por uno.",
        },
        {
          type: "faq",
          items: [
            {
              q: "Un cliente mandó un audio y el agente no contestó.",
              a:
                "Si el audio no se pudo convertir en texto (por ejemplo, solo había ruido o pesaba más de 8 " +
                "MB), el mensaje se descarta y el agente no contesta. Pide al cliente que lo repita o que " +
                "escriba.",
            },
            {
              q: "El cliente mandó una foto muy pesada y no hubo respuesta.",
              a:
                "Las fotos de más de 5 MB y los videos de más de 50 MB no se procesan. Pide al cliente que la " +
                "mande otra vez desde WhatsApp normal (WhatsApp suele comprimir las fotos) o un video más " +
                "corto.",
            },
            {
              q: "¿Mi equipo puede mandar fotos, audios o PDF al cliente?",
              a:
                "Sí. Desde la bandeja, una persona puede adjuntar archivos de hasta 25 MB y grabar notas de " +
                "voz. Ver \"Bandeja de conversaciones\".",
            },
            {
              q: "Uso Meta. ¿Por qué el agente no ve las fotos?",
              a:
                "Por ahora, en números conectados por Meta el agente recibe solo texto. Si necesitas fotos, " +
                "audios y videos, conecta el número por Evolution.",
            },
          ],
        },
      ],
      related: ["el-agente-automatico", "configurar-el-agente", "facturacion"],
    },
    {
      slug: "preguntas-whatsapp",
      title: "Preguntas frecuentes: WhatsApp",
      summary: "Problemas comunes con la conexión de WhatsApp y la bandeja de conversaciones.",
      audience: "owner",
      keywords: ["faq", "qr no funciona", "no llegan mensajes", "desconectado", "whatsapp caído"],
      body: [
        {
          type: "faq",
          items: [
            {
              q: "Escaneé el QR pero el canal sigue en \"Esperando confirmación\".",
              a:
                "Espera unos segundos: la página se actualiza sola. Si pasa más de un minuto, cierra la " +
                "ventana y repite \"Conectar canal\". Revisa que escaneaste desde el celular del número " +
                "correcto y que tenga internet.",
            },
            {
              q: "Mis clientes escriben pero no aparece nada en Conversaciones.",
              a:
                "Revisa en Canales que el número esté \"Conectado\". Si dice \"Con error\" o \"Desconectado\", " +
                "vuelve a conectarlo. Con Evolution, revisa que el dispositivo siga vinculado en el celular " +
                "(WhatsApp → Dispositivos vinculados).",
            },
            {
              q: "¿El cliente se da cuenta de que habla con un bot?",
              a:
                "El agente se presenta con el nombre que le diste en su configuración. Cuando una persona toma " +
                "la conversación, el cliente sigue en el mismo chat y con el mismo número.",
            },
            {
              q: "Tomé una conversación y ahora el agente no contesta nada.",
              a:
                "Es lo esperado: mientras una persona la atiende, el agente no contesta. Cuando termines, dale " +
                "\"Devolver al bot\" o resuelve la conversación.",
            },
            {
              q: "No puedo transferir una conversación a un compañero.",
              a:
                "Solo aparecen las personas marcadas como \"Agente WhatsApp activo\" en Admin → Usuarios. " +
                "Pide que marquen esa casilla para tu compañero.",
            },
            {
              q: "WhatsApp no aceptó mi mensaje.",
              a:
                "Primero revisa que el canal siga \"Conectado\". En números de Meta hay además una regla de " +
                "WhatsApp: si el cliente no ha escrito en las últimas 24 horas, solo se le puede mandar una " +
                "plantilla aprobada. Espera a que el cliente escriba o usa una plantilla.",
            },
            {
              q: "¿Puedo conectar varios números?",
              a:
                "Sí. Cada número es un canal distinto y todos llegan a la misma bandeja. Usa el filtro de " +
                "canal para separarlos.",
            },
          ],
        },
      ],
      related: ["conectar-whatsapp", "bandeja-de-conversaciones", "plantillas-de-whatsapp"],
    },
  ],
};
