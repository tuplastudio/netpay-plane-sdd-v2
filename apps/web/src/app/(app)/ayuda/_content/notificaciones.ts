import type { HelpCategory } from "./types";

export const notificaciones: HelpCategory = {
  slug: "notificaciones",
  title: "Notificaciones",
  articles: [
    {
      slug: "recordatorios-de-cotizacion",
      title: "Recordatorios de cotización sin pagar",
      summary:
        "El sistema le recuerda solo al cliente que le falta pagar una cotización, cada tantas horas y hasta un máximo de veces, sin que tengas que escribirle tú.",
      audience: "owner",
      keywords: ["recordatorio", "cotización vencida", "cotización sin pagar", "opt-out", "baja", "horario"],
      body: [
        {
          type: "p",
          text:
            "Cuando emites una cotización y el cliente no la paga, alguien tendría que estar recordándole. Esa " +
            "parte la puede hacer el sistema solo: manda recordatorios automáticos por WhatsApp o por correo, " +
            "sin que tú ni nadie de tu equipo tenga que escribir nada a mano. Lo configuras en Admin → Empresa, " +
            "dentro del bloque \"Recordatorios de pago\".",
        },
        {
          type: "h3",
          text: "Cómo activarlo y ajustarlo",
        },
        {
          type: "steps",
          items: [
            "Entra a Admin → Empresa.",
            "Busca el bloque \"Recordatorios de pago\".",
            "Marca la casilla \"Recordar al cliente una cotización sin pagar\" para activarlo (o desmárcala para apagarlo por completo).",
            "En el campo \"Cada\", escribe cuántas horas mínimo deben pasar entre un recordatorio y el siguiente. Acepta de 1 a 720 horas (720 horas son 30 días).",
            "En el campo \"Máximo por cotización\", escribe cuántos recordatorios como máximo se le pueden mandar a una misma cotización sin pagar. Acepta de 0 a 10.",
            "Guarda los cambios.",
          ],
        },
        {
          type: "callout",
          tone: "info",
          text:
            "Poner \"0\" en \"Máximo por cotización\" apaga los recordatorios desde ese momento en adelante, " +
            "sin necesidad de desmarcar la casilla principal: es una forma más fina de apagarlos si, por " +
            "ejemplo, quieres dejar de recordar cotizaciones nuevas pero no te importa que las que ya estaban " +
            "en curso terminen su tanda.",
        },
        {
          type: "h3",
          text: "Qué respeta el sistema antes de mandar cada recordatorio",
        },
        {
          type: "list",
          items: [
            "La \"baja\" del cliente (lo que en inglés se conoce como opt-out): si un cliente ya pidió dejar de recibir mensajes, nunca se le manda un recordatorio, aunque tenga cotizaciones sin pagar.",
            "El horario: los recordatorios solo salen entre las 9:00 y las 19:00, hora local del negocio. Nunca se manda uno de madrugada o entrada la noche.",
            "La ventana de 24 horas de WhatsApp (si el canal es WhatsApp): si ya pasaron más de 24 horas desde el último mensaje del cliente, el recordatorio necesita salir como plantilla aprobada por Meta — ver el artículo de plantillas de WhatsApp.",
          ],
        },
        {
          type: "p",
          text:
            "El recordatorio se manda por el mismo canal que el cliente ya usa contigo: si tiene teléfono " +
            "registrado, por WhatsApp; si no tiene teléfono pero sí correo, por correo. Si no hay ni teléfono " +
            "ni correo registrado, ese cliente simplemente no recibe recordatorio, porque no hay ningún canal " +
            "por el que mandárselo.",
        },
        {
          type: "h3",
          text: "Casos que vale la pena conocer",
        },
        {
          type: "callout",
          tone: "warning",
          title: "Una cotización vencida deja de recordarse",
          text:
            "Cada cotización tiene una fecha de vencimiento (la vigencia que configuraste en Admin → Empresa, " +
            "en \"Vigencia de cotización\"). En cuanto vence, el sistema la marca como vencida automáticamente " +
            "y su link público deja de funcionar — y, como ya no es una cotización vigente, deja de recibir " +
            "recordatorios. Si quieres que el cliente siga pudiendo pagar, tendrías que emitirle una " +
            "cotización nueva.",
        },
        {
          type: "callout",
          tone: "info",
          title: "Si el cliente ya empezó a pagar",
          text:
            "Si la cotización ya se convirtió en un pedido totalmente pagado, entregado, cancelado o " +
            "reembolsado, los recordatorios se detienen: ya no tiene sentido seguir insistiendo. Pero si el " +
            "cliente ya inició el pago y se quedó a medias (por ejemplo, abrió el checkout pero no terminó), " +
            "los recordatorios siguen — es justo el caso en el que más ayuda empujarlo a que termine.",
        },
        {
          type: "p",
          text:
            "El sistema revisa las cotizaciones pendientes cada pocos minutos, así que un recordatorio no sale " +
            "exactamente en el segundo en que se cumplen las horas configuradas, sino en la siguiente revisión " +
            "después de eso — la diferencia es de minutos, no de horas.",
        },
      ],
    },
    {
      slug: "plantillas-de-whatsapp",
      title: "Plantillas de WhatsApp",
      summary:
        "Fuera de la ventana de 24 h que da Meta después del último mensaje del cliente, solo se puede mandar una plantilla ya aprobada por Meta — aquí se le dice al sistema cuál usar para cada tipo de aviso.",
      audience: "owner",
      keywords: ["plantilla", "template", "ventana de 24 horas", "meta", "whatsapp business", "recordatorio_cotizacion"],
      body: [
        {
          type: "p",
          text:
            "WhatsApp (a través de Meta) solo permite mandar texto libre — el mensaje normal, escrito como tú " +
            "quieras — dentro de las 24 horas siguientes al último mensaje que te mandó el cliente. Esas 24 " +
            "horas se conocen como la \"ventana de servicio\". Pasado ese plazo, si el negocio quiere " +
            "escribirle primero al cliente (sin que el cliente haya escrito nada reciente), el mensaje tiene " +
            "que salir como una \"plantilla\": un formato de texto que Meta revisó y aprobó de antemano en tu " +
            "WhatsApp Manager.",
        },
        {
          type: "callout",
          tone: "warning",
          title: "Qué pasa si no hay una plantilla registrada",
          text:
            "Si le toca a un aviso salir fuera de la ventana de 24 horas y no hay ninguna plantilla registrada " +
            "para ese tipo de aviso, el sistema no lo manda de ninguna forma: cancela ese envío en concreto y " +
            "deja el motivo a la vista en la cola de notificaciones (Admin → Notificaciones), en vez de " +
            "arriesgar la cuenta de WhatsApp del negocio mandando texto libre fuera de ventana.",
        },
        {
          type: "h3",
          text: "Qué avisos necesitan plantilla",
        },
        {
          type: "p",
          text:
            "No todos los avisos necesitan plantilla — solo los que el negocio manda por su cuenta, sin que el " +
            "cliente acabe de escribir algo. Los avisos que responden a algo que el cliente hizo en ese mismo " +
            "momento (por ejemplo, confirmar que su pago se procesó justo después de que pagó) siempre caen " +
            "dentro de la ventana de 24 horas, así que nunca necesitan plantilla.",
        },
        {
          type: "table",
          headers: ["Aviso", "¿Necesita plantilla fuera de ventana?"],
          rows: [
            ["Link de cotización", "Sí"],
            ["Cotización actualizada", "Sí"],
            ["Recordatorio de cotización sin pagar", "Sí"],
            ["Pedido pendiente de pago", "Sí"],
            ["Pedido recibido, confirmaciones de pago y similares", "No — siempre responden a algo que el cliente acaba de hacer"],
          ],
        },
        {
          type: "h3",
          text: "Cómo registrar las plantillas",
        },
        {
          type: "p",
          text:
            "Ve a Admin → Notificaciones. Debajo de la cola de notificaciones vas a encontrar la sección " +
            "\"Plantillas aprobadas de WhatsApp\", que es donde mapeas cada tipo de aviso a la plantilla que ya " +
            "aprobaste en Meta.",
        },
        {
          type: "steps",
          items: [
            "En \"Plantillas aprobadas de WhatsApp\", da clic en \"Agregar\".",
            "En \"Mensaje\", elige a qué aviso corresponde esta plantilla (por ejemplo, \"Recordatorio de cotización sin pagar\").",
            "En \"Nombre en Meta\", escribe exactamente el nombre con el que quedó aprobada esa plantilla en tu WhatsApp Manager (por ejemplo recordatorio_cotizacion). Tiene que coincidir letra por letra con lo que registraste en Meta.",
            "En \"Idioma\", elige el idioma con el que aprobaste esa plantilla en Meta (es_MX, es, es_ES o en_US).",
            "Repite el proceso para cada tipo de aviso que quieras cubrir.",
            "Da clic en \"Guardar plantillas\".",
          ],
        },
        {
          type: "callout",
          tone: "info",
          text:
            "El texto que ya conoces (por ejemplo, \"Hola Juan, tu cotización por $450 está lista…\") no se " +
            "pierde: ese texto se manda como el primer parámetro de la plantilla que registraste. Lo que " +
            "cambia fuera de la ventana de 24 horas es el empaque —tiene que ir dentro de una plantilla— no el " +
            "contenido que redactas.",
        },
        {
          type: "callout",
          tone: "success",
          text:
            "Si te equivocas al registrar una plantilla o ya no la necesitas, puedes quitarla con el ícono de " +
            "bote de basura junto a esa fila y volver a guardar. Mientras estés editando sin guardar, el botón " +
            "\"Descartar\" regresa todo a como estaba la última vez que guardaste.",
        },
      ],
    },
  ],
};
