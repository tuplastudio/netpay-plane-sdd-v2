import type { HelpCategory } from "./types";

export const agente: HelpCategory = {
  slug: "agente",
  title: "Agente IA",
  articles: [
    {
      slug: "el-agente-automatico",
      title: "Qué hace el agente automático",
      summary:
        "Cotiza con el catálogo real, nunca inventa precios ni existencias, entiende texto, notas de voz, fotos y videos, y sabe cuándo pasarte la conversación.",
      audience: "owner",
      keywords: ["bot", "chatbot", "agente", "handoff", "escalar", "conocimiento", "negocio.md", "inteligencia artificial"],
      body: [
        {
          type: "p",
          text:
            "El agente es el programa que contesta por WhatsApp cuando nadie de tu equipo ha tomado la " +
            "conversación. No es una persona: es un sistema de inteligencia artificial que lee tu catálogo " +
            "y la información de tu negocio, y responde a cualquier hora.",
        },
        { type: "h3", text: "Qué puede hacer" },
        {
          type: "list",
          items: [
            "Buscar productos en tu catálogo y decir precio y existencia reales.",
            "Armar un carrito, calcular el total con IVA y envío, y emitir una cotización.",
            "Revisar si la dirección del cliente cae en una de tus zonas de envío.",
            "Convertir la cotización en pedido y mandar el link de pago.",
            "Decirle al cliente en qué estado va su pedido.",
            "Reconocer a un cliente que ya te compró y ver sus compras anteriores (si lo tienes activado).",
            "Registrar una solicitud de factura con la constancia de situación fiscal o con los datos " +
              "dictados.",
            "Contestar preguntas del negocio (horarios, dirección, formas de pago, políticas) con lo que " +
              "cargaste en Consola del agente → Conocimiento.",
            "Pasar la conversación a una persona cuando hace falta.",
          ],
        },
        { type: "h3", text: "Qué tipo de mensajes entiende" },
        {
          type: "table",
          headers: ["El cliente manda…", "Qué hace el agente"],
          rows: [
            ["Texto", "Lo lee y contesta."],
            ["Nota de voz", "La convierte a texto (transcripción) y contesta como si fuera un mensaje escrito."],
            ["Foto", "La mira. Sirve para \"¿tienen algo como esto?\" o para leer una lista escrita a mano."],
            ["Video", "Lo mira, si el modelo elegido puede ver video. Si no puede, le pide al cliente que lo describa o mande una foto."],
            ["Ubicación", "La toma como referencia, pero pide código postal, ciudad y estado para calcular el envío."],
          ],
        },
        {
          type: "callout",
          tone: "info",
          title: "Por qué importa que no invente",
          text:
            "Si el agente contestara con precios que se le ocurren, un cliente podría comprar algo que ya no " +
            "tienes o a un precio que nunca autorizaste. Por eso consulta el catálogo en cada respuesta, en " +
            "vez de recordar un precio de una conversación anterior.",
        },
        { type: "h3", text: "Cuándo pasa la conversación a una persona" },
        {
          type: "list",
          items: [
            "El cliente pide hablar con alguien.",
            "El cliente se queja o está molesto.",
            "El cliente pide un precio especial, un descuento fuera de lo normal o crédito.",
            "El cliente escribe una de las \"Palabras que pasan a una persona\" que configuraste (por " +
              "ejemplo \"asesor\").",
            "El agente no puede resolver algo después de intentarlo.",
          ],
        },
        {
          type: "p",
          text:
            "Cuando eso pasa, la conversación cambia a \"Escalada\" en Conversaciones y el agente deja de " +
            "contestar ahí. Cualquier persona de tu equipo puede tomarla. Un tropiezo técnico aislado no " +
            "provoca que escale: primero reintenta.",
        },
        {
          type: "callout",
          tone: "success",
          title: "Pruébalo sin riesgo",
          text:
            "En \"Chat con el agente\" hablas con el mismo agente que atiende WhatsApp, pero en una " +
            "conversación de prueba. Ahí puedes equivocarte todo lo que quieras.",
        },
      ],
      related: ["configurar-el-agente", "conocimiento-del-agente", "chat-de-prueba", "fotos-audio-y-video"],
    },
    {
      slug: "configurar-el-agente",
      title: "Configurar el agente",
      summary:
        "Nombre, tono, estilo de venta, reglas, palabras que escalan, modelo, WhatsApp y atención humana: qué hace cada ajuste de Consola del agente → General.",
      audience: "owner",
      keywords: ["configuración", "personalidad", "tono", "saludo", "estilo de venta", "reglas", "modelo", "temperatura", "openrouter", "crear bot con ia", "restablecer", "cerrar conversación sola"],
      body: [
        {
          type: "p",
          text:
            "Todo lo que cambia la forma de ser del agente está en Consola del agente → pestaña General → " +
            "\"Configuración del agente\". Cada campo tiene un ícono de información: pasa el cursor (o toca " +
            "en el celular) para ver qué hace. Al terminar, da clic en \"Guardar cambios\". El siguiente " +
            "mensaje que conteste el agente ya usa la configuración nueva.",
        },
        { type: "h3", text: "Atajo: Crear bot con IA" },
        {
          type: "steps",
          items: [
            "En la parte de arriba de la configuración, da clic en \"Crear bot con IA\".",
            "En \"Cuéntame de tu negocio\" describe tu negocio en tus palabras: qué vendes, dónde, horarios, " +
              "si haces envíos y cómo quieres que suene el bot. Mínimo 20 caracteres; entre más detalle, " +
              "mejor. Hay ejemplos (Papelería, Pinturería, Servicio técnico) para inspirarte.",
            "Da clic en \"Generar borrador\". Espera unos segundos.",
            "Revisa \"Entendí esto de tu negocio\": identidad y tono, reglas extra, temas que no toca, " +
              "palabras que escalan a humano y el archivo de conocimiento. Puedes editar el texto del " +
              "conocimiento antes de aplicar.",
            "Da clic en \"Aplicar\". Nada se guarda hasta ese momento.",
          ],
        },
        { type: "h3", text: "Identidad" },
        {
          type: "table",
          headers: ["Campo", "Qué hace"],
          rows: [
            ["Nombre del agente", "Cómo se presenta y firma. Ejemplo: \"Sofi\"."],
            ["Nombre del negocio", "El nombre comercial que menciona al presentarse y al cotizar."],
            ["Tono", "Cómo suena. Ejemplo: \"cercano, breve, sin tecnicismos\". Define el estilo, no lo que puede hacer."],
            ["Saludo inicial", "Una sugerencia para el primer mensaje de cada conversación. Vacío: improvisa uno con su nombre."],
            ["Idioma y Moneda", "Por ahora, español y pesos mexicanos."],
            ["Usar emojis", "Apagado: no usa emojis. Encendido: máximo uno por mensaje."],
          ],
        },
        { type: "h3", text: "Comportamiento comercial" },
        {
          type: "table",
          headers: ["Campo", "Qué hace"],
          rows: [
            ["Estilo de venta", "Cerrador: cada mensaje propone el siguiente paso de compra. Consultivo: pregunta y entiende antes de recomendar. Informativo: responde completo y no presiona."],
            ["Pedir nombre antes de cotizar", "Siempre activo; no se puede apagar. Mantiene completa tu lista de clientes."],
            ["Pedir correo antes de cotizar", "Lo pide una vez para mandar el PDF de la cotización y lo guarda en la ficha."],
            ["Reconocer clientes recurrentes", "Busca compras anteriores por el teléfono del cliente para no volver a pedir nombre y correo."],
            ["Máx. opciones por mensaje", "Cuántos productos lista por respuesta antes de ofrecer ver más (1 a 10). Menos = mensajes más cortos."],
            ["Entrega por defecto", "Si el agente asume recoger en tienda o envío a domicilio cuando el cliente no lo dice."],
            ["Ir directo al pago tras confirmar", "Salta la cotización: después de un \"sí\" claro, manda el link de pago. Útil para comida para llevar o recargas."],
            ["Pedir dirección antes de cotizar a domicilio", "Pregunta código postal, ciudad y estado y usa tus zonas de envío. Apagado: usa el envío fijo sin preguntar."],
          ],
        },
        { type: "h3", text: "Reglas del negocio" },
        {
          type: "list",
          items: [
            "Reglas adicionales: instrucciones en lenguaje normal, una por renglón. Ejemplo: \"Nunca ofrezcas " +
              "envío gratis\" o \"No prometas fechas de entrega exactas\". Tienen prioridad sobre las reglas " +
              "base.",
            "Temas que no toca: temas de los que no debe hablar (por ejemplo \"precios de la competencia, " +
              "política\"). Si el cliente los menciona, dice que no puede ayudar y ofrece pasar a una persona.",
            "Palabras que pasan a una persona: si el cliente escribe alguna (por ejemplo \"humano, asesor\"), " +
              "el agente transfiere la conversación sin discutir. Separadas por coma, hasta 30 palabras.",
          ],
        },
        { type: "h3", text: "Modelo" },
        {
          type: "table",
          headers: ["Campo", "Qué hace"],
          rows: [
            ["Modelo conversacional", "El modelo de inteligencia artificial que escribe las respuestas y usa las herramientas. Cambiarlo cambia costo y calidad. Solo aparecen modelos que pueden usar herramientas."],
            ["Versión del prompt", "Las reglas base del agente vienen en versiones numeradas. \"latest\" usa siempre la más reciente; fijar una deja tu negocio en esa versión."],
            ["Temperatura", "Entre 0 y 1.5. Bajo = respuestas más parecidas entre sí; alto = más variadas."],
            ["Máx. tokens por respuesta", "Entre 64 y 4000. Limita el largo de cada respuesta. Más tokens = respuestas más largas y más costo."],
            ["OpenRouter API key propia", "Opcional. Con tu propia key, el consumo se cobra a tu cuenta de OpenRouter. No se vuelve a mostrar después de guardarla."],
          ],
        },
        {
          type: "callout",
          tone: "warning",
          title: "El modelo decide si el agente puede ver videos",
          text:
            "No todos los modelos entienden video. Si eliges uno que no puede, el agente le pide al cliente " +
            "que describa el video o mande una foto. Las fotos las entienden la mayoría de los modelos " +
            "recomendados.",
        },
        { type: "h3", text: "Canal y WhatsApp" },
        {
          type: "list",
          items: [
            "Formato plano para WhatsApp: quita títulos y viñetas que WhatsApp no muestra bien y convierte " +
              "negritas al formato de WhatsApp. Recomendado.",
            "Respuesta automática activa: si lo apagas, el agente guarda los mensajes pero no contesta; tu " +
              "equipo los atiende. Útil para pausar el bot sin perder historial.",
          ],
        },
        { type: "h3", text: "Atención humana" },
        {
          type: "list",
          items: [
            "Revisar las respuestas del equipo antes de enviarlas: un modelo pequeño revisa lo que escribe " +
              "una persona desde la bandeja y detecta insultos, amenazas, discriminación, contenido sexual, " +
              "fuga de información interna o promesas que no puedes cumplir. Viene apagado porque cuesta una " +
              "consulta al modelo por cada mensaje.",
            "Si el mensaje se marca: \"Bloquear el envío y pedir que se reescriba\" (no sale nada y se " +
              "muestra el motivo) o \"Enviar de todos modos y dejar la advertencia en el hilo\".",
            "Cerrar la conversación sola tras un rato sin mensajes: si lo activas, eliges el \"Tiempo sin " +
              "mensajes\" con un número y una unidad, sin espacios: 30m (minutos), 2h (horas) o 1d (días). " +
              "Mínimo 30s, máximo 30d. Apagado: las conversaciones solo se cierran a mano.",
          ],
        },
        {
          type: "callout",
          tone: "info",
          text:
            "Cerrar una conversación no borra nada. Si el cliente vuelve a escribir, la conversación se " +
            "reabre con todo su historial.",
        },
        { type: "h3", text: "Restablecer todo" },
        {
          type: "p",
          text:
            "El botón \"Restablecer todo\" borra todos los ajustes del panel (incluida tu OpenRouter key, si " +
            "la guardaste) y el agente vuelve a los valores predeterminados. Te pide confirmar. Úsalo solo " +
            "si quieres empezar de cero.",
        },
      ],
      related: ["conocimiento-del-agente", "chat-de-prueba", "preguntas-agente"],
    },
    {
      slug: "conocimiento-del-agente",
      title: "Conocimiento, aprendizaje y herramientas del agente",
      summary:
        "Cómo enseñarle al agente horarios, políticas y preguntas frecuentes (con archivos o con una página web), cómo aprobar lo que aprende y qué acciones puede hacer.",
      audience: "owner",
      keywords: ["conocimiento", "markdown", ".md", "negocio.md", "página web", "url", "aprendizaje", "sugerencias", "herramientas", "consola"],
      body: [
        {
          type: "p",
          text:
            "Consola del agente tiene cuatro pestañas: General (configuración y estado), Conocimiento (lo que " +
            "sabe de tu negocio), Aprendizaje (preguntas que no supo contestar) y Herramientas (las acciones " +
            "que puede hacer). Arriba ves si el agente y su conexión con tu catálogo están funcionando.",
        },
        { type: "h3", text: "Qué es el conocimiento" },
        {
          type: "p",
          text:
            "El catálogo le dice al agente qué vendes y a qué precio. El conocimiento le dice todo lo demás: " +
            "horarios, dirección, formas de pago, tiempos de entrega, políticas de cambio, garantías y " +
            "preguntas frecuentes. Cuando un cliente pregunta \"¿abren el domingo?\", el agente busca la " +
            "respuesta en el conocimiento.",
        },
        { type: "h3", text: "Agregar conocimiento con un archivo" },
        {
          type: "steps",
          items: [
            "Escribe la información en un archivo de texto con extensión .md (Markdown). Puedes usar el Bloc " +
              "de notas: escribe títulos empezando la línea con # y guarda el archivo como \"horarios.md\".",
            "En Consola del agente → Conocimiento, da clic en \"Subir Markdown\" y elige el archivo.",
            "El documento aparece en la lista \"Documentos\" y el agente empieza a usarlo.",
          ],
        },
        {
          type: "code",
          text:
            "# Horarios\nLunes a viernes de 9:00 a 18:00. Sábados de 9:00 a 14:00. Domingos cerrado.\n\n" +
            "# Formas de pago\nTarjeta, transferencia SPEI o efectivo en tiendas de conveniencia, desde el link de pago.\n\n" +
            "# Cambios y devoluciones\nAceptamos cambios dentro de 7 días con ticket y el producto sin usar.",
        },
        { type: "h3", text: "Agregar conocimiento desde una página web" },
        {
          type: "steps",
          items: [
            "En \"Leer una página web\", pega la dirección de una página pública, por ejemplo tu página de " +
              "preguntas frecuentes.",
            "Da clic en \"Previsualizar\". El sistema lee la página y la divide en secciones.",
            "Marca solo las secciones que te sirven. Abajo ves cuántos caracteres elegiste.",
            "Da clic en \"Guardar como conocimiento\".",
          ],
        },
        {
          type: "callout",
          tone: "info",
          text:
            "Solo se leen páginas públicas (que empiezan con http:// o https://). Páginas que piden usuario y " +
            "contraseña, o direcciones de tu red interna, no se pueden leer.",
        },
        { type: "h3", text: "Probar una pregunta" },
        {
          type: "p",
          text:
            "En \"Probar una pregunta del negocio\" escribe una pregunta como la haría un cliente (mínimo dos " +
            "caracteres) y da clic en \"Buscar\". Ves qué secciones del conocimiento encontraría el agente. " +
            "No gasta consultas al modelo. Si no encuentra nada, esa pregunta es buena candidata para " +
            "agregar al conocimiento.",
        },
        { type: "h3", text: "Borrar un documento" },
        {
          type: "p",
          text:
            "Da clic en el ícono de borrar junto al documento y confirma. Su contenido deja de usarse. No se " +
            "puede deshacer: si lo necesitas otra vez, vuelve a subirlo. Si cambias varios documentos, usa " +
            "\"Recargar conocimiento\" para que el agente los lea de nuevo.",
        },
        { type: "h3", text: "Aprendizaje" },
        {
          type: "p",
          text:
            "Cuando un cliente pregunta algo que no está en el conocimiento, o cuando el agente pasa una " +
            "conversación a una persona, aparece una sugerencia en la pestaña Aprendizaje. El número junto " +
            "a la pestaña dice cuántas hay pendientes.",
        },
        {
          type: "steps",
          items: [
            "Lee la pregunta del cliente.",
            "Si vale la pena, escribe la respuesta correcta en el campo de abajo.",
            "Da clic en \"Aprobar\". La respuesta se agrega al conocimiento.",
            "Si no sirve (por ejemplo, era una broma), descártala con el botón de descartar.",
          ],
        },
        {
          type: "callout",
          tone: "warning",
          text:
            "Nada se agrega solo al conocimiento. Cada sugerencia espera a que una persona escriba la " +
            "respuesta y la apruebe. Así el agente nunca aprende algo incorrecto por su cuenta.",
        },
        { type: "h3", text: "Herramientas" },
        {
          type: "p",
          text:
            "La pestaña Herramientas lista las acciones que el agente puede hacer en tu cuenta: buscar " +
            "productos, manejar el carrito, calcular totales, validar la zona de envío, emitir cotizaciones, " +
            "convertirlas en pedido, generar el link de pago, consultar el estado de un pedido, recordar y " +
            "consultar clientes, pedir factura y pasar la conversación a una persona. Cada una dice \"Lee\" " +
            "(solo consulta) o \"Escribe\" (cambia algo). Da clic en una para ver su detalle.",
        },
      ],
      related: ["configurar-el-agente", "chat-de-prueba"],
    },
    {
      slug: "chat-de-prueba",
      title: "Probar el agente en Chat con el agente",
      summary:
        "Habla con tu agente como si fueras un cliente, por texto o nota de voz, y mira el carrito, la cotización y el link de pago que va armando.",
      audience: "owner",
      keywords: ["probar", "prueba", "chat web", "nota de voz", "micrófono", "reiniciar conversación", "simular cliente"],
      body: [
        {
          type: "p",
          text:
            "Chat con el agente es un WhatsApp de práctica. Hablas con el mismo agente que atiende a tus " +
            "clientes, con el mismo catálogo y la misma configuración, pero en una conversación que solo tú " +
            "ves.",
        },
        { type: "h3", text: "Cómo usarlo" },
        {
          type: "steps",
          items: [
            "Ve a Chat con el agente.",
            "Escribe como si fueras un cliente, por ejemplo \"¿Hacen envíos a Monterrey?\" o \"Quiero 3 " +
              "cajas de galletas\". También puedes tocar una de las ideas que aparecen al inicio.",
            "Presiona Enter para enviar. Shift + Enter agrega un renglón sin enviar.",
            "Mientras el agente trabaja, ves \"El agente está escribiendo…\".",
            "A un lado ves lo que va armando: \"Pedidos abiertos\" (el carrito), la \"Cotización emitida\" y el " +
              "\"Enlace de pago\" cuando lo genera.",
          ],
        },
        { type: "h3", text: "Mandar una nota de voz" },
        {
          type: "steps",
          items: [
            "Da clic en el botón del micrófono (\"Grabar una nota de voz\").",
            "La primera vez, el navegador te pide permiso para usar el micrófono. Acéptalo.",
            "Habla y vuelve a dar clic para detener.",
            "El audio se convierte en texto y se manda al agente como tu mensaje.",
          ],
        },
        {
          type: "callout",
          tone: "info",
          text:
            "Si ves \"No pude usar el micrófono\", revisa los permisos del sitio en tu navegador (el candado " +
            "junto a la dirección). Si ves \"No se entendió el audio\", habla más cerca del micrófono o " +
            "escribe tu mensaje.",
        },
        { type: "h3", text: "Empezar de cero" },
        {
          type: "p",
          text:
            "El botón para reiniciar la conversación borra el historial, el carrito y la cotización de esa " +
            "prueba. Te pide confirmar. No toca ninguna conversación real ni nada guardado en Conversaciones, " +
            "Cotizaciones o Pedidos de clientes reales.",
        },
        {
          type: "callout",
          tone: "warning",
          text:
            "Las cotizaciones y pedidos que el agente crea en una prueba son reales dentro del panel: aparecen " +
            "en Cotizaciones y Pedidos. Si pagas en modo de pruebas no se mueve dinero, pero si tu empresa ya " +
            "está en producción, un pago sí sería real. Cancela lo que hayas creado solo para probar.",
        },
        {
          type: "faq",
          items: [
            {
              q: "Dice \"El agente no está disponible\". ¿Qué hago?",
              a:
                "El servicio del agente no respondió a la revisión de salud. Espera un minuto y recarga la " +
                "página. Si sigue igual, escribe a hola@tupla.dev.",
            },
            {
              q: "Dice \"Un asesor humano tomó la conversación\" y el agente ya no contesta.",
              a:
                "Tu mensaje hizo que el agente escalara (por ejemplo, pediste hablar con una persona). Así " +
                "funciona también con clientes reales. Reinicia la conversación para seguir probando.",
            },
            {
              q: "El agente contesta algo distinto a lo que quiero.",
              a:
                "Revisa tres cosas: el catálogo (precio, estado Activo, existencia), el conocimiento (que la " +
                "respuesta esté escrita) y la configuración (reglas adicionales y tono). Corrige y vuelve a " +
                "preguntar.",
            },
          ],
        },
      ],
      related: ["el-agente-automatico", "configurar-el-agente"],
    },
    {
      slug: "preguntas-agente",
      title: "Preguntas frecuentes: el agente",
      summary: "Problemas comunes con las respuestas del agente y cómo resolverlos.",
      audience: "owner",
      keywords: ["faq", "no contesta", "responde mal", "bot no responde", "agente callado"],
      body: [
        {
          type: "faq",
          items: [
            {
              q: "El agente no contesta en WhatsApp. ¿Por qué?",
              a:
                "Revisa en este orden: 1) En Canales, que el número esté \"Conectado\". 2) En Conversaciones, " +
                "que esa conversación no la tenga tomada una persona. 3) En Consola del agente → General, que " +
                "\"Respuesta automática activa\" esté encendido. 4) Arriba de Consola del agente, que el estado " +
                "del agente esté bien. Si todo está bien, escribe a hola@tupla.dev.",
            },
            {
              q: "El agente dice que no tiene un producto que sí tengo.",
              a:
                "Revisa que el producto y la variante estén en estado Activo y que la existencia no sea 0. " +
                "Si el cliente usa otro nombre (por ejemplo \"cubeta\" en lugar de \"pintura 19 L\"), agrégalo " +
                "como sinónimo del producto.",
            },
            {
              q: "El agente dio un precio viejo.",
              a:
                "El agente siempre usa el precio del catálogo al momento de cotizar. Pero una cotización ya " +
                "emitida conserva su precio. Si el cliente vio una cotización anterior, crea una nueva.",
            },
            {
              q: "El agente contestó mal una pregunta del negocio.",
              a:
                "Agrega la respuesta correcta al conocimiento, o apruébala en Aprendizaje si aparece como " +
                "sugerencia. Después prueba la pregunta en \"Probar una pregunta del negocio\".",
            },
            {
              q: "Quiero que el agente no hable de cierto tema.",
              a: "Escríbelo en \"Temas que no toca\" (Consola del agente → General → Reglas del negocio) y guarda.",
            },
            {
              q: "Quiero pausar el agente unas horas.",
              a:
                "Apaga \"Respuesta automática activa\" en Canal y WhatsApp. Los mensajes se siguen guardando y " +
                "tu equipo los atiende desde Conversaciones. Vuelve a encenderlo cuando quieras.",
            },
            {
              q: "¿Cuánto me cuesta el agente?",
              a:
                "Cada respuesta consume tokens del modelo. Revisa el consumo del mes en curso en Admin → " +
                "Empresa → \"Uso y costo del agente\". Los modelos más baratos cuestan menos, pero pueden " +
                "contestar con menos precisión.",
            },
          ],
        },
      ],
      related: ["configurar-el-agente", "conocimiento-del-agente", "uso-y-costos"],
    },
  ],
};
