import type { HelpCategory } from "./types";

export const catalogo: HelpCategory = {
  slug: "catalogo",
  title: "Catálogo",
  articles: [
    {
      slug: "productos-y-variantes",
      title: "Crear y editar productos y variantes",
      summary:
        "Un producto puede tener varias variantes (talla, color, presentación), cada una con su propio SKU, precio, existencia y estado — paso a paso, con los formatos exactos que acepta cada campo.",
      audience: "owner",
      keywords: ["sku", "estado", "draft", "active", "archived", "control de versión", "conflicto"],
      body: [
        {
          type: "p",
          text:
            "Un producto agrupa variantes que, en tu cabeza, se venden juntas — pero que en el sistema son " +
            "registros separados, cada uno con su propio precio y existencia. Ejemplo clásico de una tienda de " +
            "pinturas: \"Pintura vinílica\" es el producto; \"4 LT\" y \"19 LT\" son sus variantes. Puedes " +
            "vender solo la de 19 litros y no tener nada de la de 4 litros, y eso es perfectamente normal — son " +
            "independientes.",
        },
        {
          type: "p",
          text:
            "El \"SKU\" (viene de las siglas en inglés de \"unidad de mantenimiento de inventario\") es " +
            "simplemente un código corto que usas para identificar exactamente ese producto o esa variante — " +
            "es la versión moderna del número que traen los productos en el código de barras de una tienda. " +
            "Tanto el producto como cada variante tienen su propio SKU, y no se puede repetir el mismo texto " +
            "para cosas distintas: úsalo para que tú y el sistema sepan sin ambigüedad de qué artículo se está " +
            "hablando, incluso si dos productos tienen el título casi idéntico.",
        },
        { type: "h3", text: "Crear un producto nuevo" },
        {
          type: "steps",
          items: [
            "En el menú lateral entra a Catálogo y da clic en el botón \"Nuevo producto\".",
            "Se abre un panel con dos partes: los datos del producto y los de su primera variante. Empieza " +
              "con el producto: escribe su SKU y su título (por ejemplo, SKU \"PINT-MATE\" y título " +
              "\"Pintura vinílica mate\").",
            "Puedes añadir una descripción (lo que ve el agente y lo que se muestra en la ficha del producto), " +
              "y \"tags\" y \"sinónimos\" si quieres: los tags sirven para categorizar y filtrar en tu propio " +
              "catálogo; los sinónimos son palabras que el cliente podría usar en WhatsApp aunque no aparezcan " +
              "en el título — por ejemplo, si tu producto se llama \"Pintura vinílica mate\" pero tus clientes " +
              "le dicen \"cubeta grande\", agrega \"cubeta grande\" como sinónimo para que el agente entienda a " +
              "qué se refieren aunque no escriban el nombre exacto.",
            "Ahora completa la variante inicial: su propio SKU (por ejemplo \"PINT-MATE-19L\"), su título " +
              "(por ejemplo \"19 litros\") y su precio.",
            "El precio se escribe siempre con dos decimales, en el formato 99.00 — si escribes \"99\" sin los " +
              "decimales o \"99.5\" con uno solo, el sistema te va a pedir que lo corrijas antes de guardar.",
            "La existencia (cuánto tienes disponible para vender, también llamada \"stock\") es opcional: si " +
              "la dejas vacía, esa variante queda sin control de inventario. Esto quiere decir que el sistema " +
              "nunca la va a marcar como \"sin existencias\" sin importar cuánto se venda — útil para " +
              "productos que fabricas sobre pedido, por ejemplo, donde no tiene sentido llevar un conteo. Si " +
              "sí quieres llevar control, escribe un número como 25 o, si necesitas fracciones, 25.500 (hasta " +
              "tres decimales).",
            "Si facturas con CFDI (el comprobante fiscal digital que exige el SAT — Servicio de Administración " +
              "Tributaria, la autoridad de impuestos en México), puedes capturar la clave SAT de producto (son " +
              "8 dígitos, por ejemplo 01010101) y la clave SAT de unidad (2 o 3 letras o números en mayúscula, " +
              "por ejemplo H87 para \"pieza\"). Si no facturas o todavía no tienes esas claves a la mano, " +
              "puedes dejarlas vacías y agregarlas después.",
            "Da clic en \"Crear producto\" para guardar. El producto queda creado como borrador — más abajo se " +
              "explica qué significa eso y cómo pasarlo a la venta.",
          ],
        },
        {
          type: "callout",
          tone: "info",
          title: "Si cierras el formulario sin guardar",
          text:
            "Si escribiste algo y cierras el panel (con la tecla Escape, dando clic fuera, o en \"Cancelar\") " +
            "sin haber dado clic en \"Crear producto\", el sistema te pregunta \"¿Descartar el producto?\" " +
            "antes de cerrar de verdad, para que no pierdas por accidente lo que ya habías escrito. Si de " +
            "verdad quieres descartarlo, confirma con \"Descartar\"; si fue un cierre accidental, elige " +
            "\"Seguir editando\" y sigue donde te quedaste.",
        },
        { type: "h3", text: "Agregar más variantes después" },
        {
          type: "p",
          text:
            "No necesitas crear todas las variantes desde el principio. Desde la ficha del producto ya " +
            "creado, en la sección \"Variantes\", hay un botón \"Agregar\" que abre un formulario para una " +
            "\"Nueva variante\" con los mismos campos que la variante inicial (SKU, título, precio, claves SAT, " +
            "existencias). Al terminar, confirmas con \"Agregar variante\" y se suma a la lista sin afectar a " +
            "las que ya existían.",
        },
        {
          type: "p",
          text:
            "Para editar una variante que ya existe, busca el ícono de lápiz junto a ella en esa misma lista. " +
            "Ahí puedes cambiar su título, precio, existencias, claves SAT y también su propio estado (ver " +
            "más abajo). Al terminar, confirma con \"Guardar variante\".",
        },
        {
          type: "callout",
          tone: "info",
          title: "Qué es el control de versión y por qué te puede aparecer un aviso de conflicto",
          text:
            "Cada vez que guardas un cambio en un producto o variante, el sistema anota internamente un " +
            "número de versión y lo va subiendo uno por uno. Esto sirve para protegerte de un problema muy " +
            "concreto: si tú y un compañero editan el mismo producto casi al mismo tiempo (por ejemplo, tú " +
            "cambiando el precio desde tu celular y él subiendo una foto desde la computadora de la tienda), " +
            "el sistema no deja que el segundo guardado borre en silencio lo que el primero acababa de hacer. " +
            "En vez de eso, la segunda persona ve un aviso de conflicto y tiene que revisar y volver a guardar " +
            "con la información más reciente. Es más trabajo en ese momento puntual, pero evita que se pierdan " +
            "cambios sin que nadie se dé cuenta.",
        },
        { type: "h3", text: "Los tres estados de un producto (y de cada variante)" },
        {
          type: "p",
          text:
            "Tanto el producto como cada una de sus variantes tienen un estado, y pueden no coincidir entre " +
            "sí: puedes tener el producto en general activo, pero una variante puntual archivada porque ya no " +
            "la vendes — por ejemplo, sigues vendiendo la pintura de 4 litros pero ya no fabricas la de 19.",
        },
        {
          type: "table",
          headers: ["Estado", "Significa"],
          rows: [
            ["DRAFT (borrador)", "Todavía no se vende ni aparece al agente. Es el estado en el que se crea todo producto nuevo, para que puedas revisarlo antes de publicarlo."],
            ["ACTIVE (activo)", "Está a la venta: el agente lo puede cotizar y aparece en tus listados normales."],
            ["ARCHIVED (archivado)", "Se dio de baja. Deja de venderse y el agente ya no lo ofrece, pero no se borra: puedes reactivarlo cambiando su estado cuando quieras, sin perder su historial."],
          ],
        },
        {
          type: "p",
          text:
            "Para cambiar el estado de un producto completo, abre el menú de acciones en su tarjeta (el ícono " +
            "de tres puntos) y elige \"Activar\", \"Pasar a borrador\" o \"Archivar\", según lo que necesites. " +
            "Antes de archivar, el sistema te pide confirmar, precisamente porque deja de venderse de " +
            "inmediato: revisa bien que sea el producto correcto antes de confirmar.",
        },
        {
          type: "callout",
          tone: "warning",
          title: "Un producto en borrador es invisible para el cliente",
          text:
            "Si acabas de crear un producto y no entiendes por qué el agente no lo está ofreciendo o por qué " +
            "no aparece cuando buscas en tu propio catálogo con el filtro de estado \"Activo\", revisa primero " +
            "si sigue en DRAFT. Es el error más común al dar de alta productos nuevos: se les olvida activarlo " +
            "después de crearlo.",
        },
      ],
      related: ["fotos-de-producto", "importar-catalogo"],
    },
    {
      slug: "fotos-de-producto",
      title: "Fotos de producto y variante",
      summary:
        "Sube una foto general del producto y, si hace falta, una propia por variante — formatos, tamaño y dimensiones que acepta el sistema, y qué pasa si tu foto no cumple.",
      audience: "owner",
      keywords: ["imágenes", "galería", "portada", "subir foto"],
      body: [
        {
          type: "p",
          text:
            "Desde la ficha del producto puedes subir fotos a dos lugares distintos. El primero es la galería " +
            "general del producto: son las fotos que se ven en los listados y tarjetas del catálogo, y le " +
            "sirven a cualquier variante que no tenga una foto propia. El segundo es la galería de cada " +
            "variante en particular, que solo tiene sentido usar cuando esa variante se ve distinta a las " +
            "demás — por ejemplo, si vendes una playera en varios colores, cada color puede llevar su propia " +
            "foto para que el cliente vea exactamente el color que está comprando.",
        },
        {
          type: "steps",
          items: [
            "Ubica la sección de fotos, ya sea la general del producto o la de una variante específica.",
            "Da clic en \"Agregar foto\" (o en el recuadro punteado que dice \"Sin fotos\" si todavía no hay " +
              "ninguna).",
            "Elige el archivo desde tu computadora o celular. El selector de archivos solo te va a dejar " +
              "elegir imágenes PNG, JPG o WebP — otros formatos ni aparecen como opción para seleccionar.",
            "Espera a que termine de subir. Verás un mensaje de \"Foto agregada\" cuando se complete.",
          ],
        },
        {
          type: "list",
          items: [
            "Formatos aceptados: PNG, JPG o WebP.",
            "Tamaño máximo del archivo: 5 MB.",
            "Dimensiones permitidas: entre 200×200 y 6000×6000 píxeles (el ancho y el alto de la imagen, en " +
              "esa unidad de medida de pantalla).",
            "No se aceptan imágenes animadas, como los GIF — el sistema las rechaza aunque el archivo en sí " +
              "pese poco, porque el catálogo y el agente muestran fotos fijas, no animaciones.",
          ],
        },
        {
          type: "callout",
          tone: "warning",
          title: "El tamaño y las dimensiones se revisan hasta que subes la foto, no antes",
          text:
            "El selector de archivos solo filtra por formato (que sea PNG, JPG o WebP). No te avisa de " +
            "antemano si tu foto pesa más de 5 MB o si sus dimensiones se salen del rango permitido — eso lo " +
            "descubres después de intentar subirla, con un mensaje de error. Si te rechaza una foto por " +
            "tamaño, la solución más simple suele ser reducirla con cualquier editor de imágenes antes de " +
            "volver a intentarlo (por ejemplo, bajarle la resolución si es una foto tomada con un celular " +
            "moderno, que casi siempre supera los 6000×6000 píxeles).",
        },
        {
          type: "p",
          text:
            "Puedes subir varias fotos por producto o por variante: cada subida agrega una foto más a la " +
            "galería, nunca reemplaza a las anteriores. La primera foto que quede en la galería funciona como " +
            "portada — es la que se muestra en las tarjetas y listados del catálogo cuando hay más de una.",
        },
        {
          type: "p",
          text:
            "Para borrar una foto, pasa el cursor sobre su miniatura: va a aparecer un ícono de bote de " +
            "basura en la esquina. Al eliminarla verás el mensaje \"Foto eliminada\". Esto no se puede " +
            "deshacer, así que si tienes duda de cuál es la foto correcta, revisa bien antes de borrar.",
        },
      ],
      related: ["productos-y-variantes"],
    },
    {
      slug: "importar-catalogo",
      title: "Importar catálogo desde un CSV",
      summary:
        "Sube muchos productos de golpe con un archivo CSV, con una vista previa (dry-run) antes de guardar nada — qué es un CSV, cómo funciona la validación y el tope de filas.",
      audience: "owner",
      keywords: ["importación", "carga masiva", "excel", "csv", "dry-run"],
      body: [
        {
          type: "p",
          text:
            "Un \"CSV\" es un tipo de archivo de texto muy simple donde cada línea es una fila de datos y las " +
            "columnas van separadas por comas — casi cualquier programa de hojas de cálculo, como Excel o " +
            "Google Sheets, puede abrir y guardar archivos en este formato desde el menú \"Guardar como\" o " +
            "\"Exportar\". Se usa para importaciones masivas porque es un formato sencillo que cualquier " +
            "sistema puede leer, sin depender de un programa en particular.",
        },
        {
          type: "p",
          text:
            "Catálogo → Importar acepta un archivo así, con una fila por cada variante — no por cada " +
            "producto. Esto quiere decir que, si un producto tiene tres variantes, ese producto ocupa tres " +
            "filas en el archivo, una por cada variante, y no una sola fila \"resumen\".",
        },
        { type: "h3", text: "Cómo funciona la validación antes de guardar" },
        {
          type: "p",
          text:
            "Antes de tocar tu catálogo real, el sistema corre una validación en seco — en inglés se le llama " +
            "\"dry-run\", que literalmente significa \"corrida en seco\": es un ensayo completo del proceso " +
            "de importación, pero sin guardar nada de verdad todavía. Te muestra, fila por fila, qué se va a " +
            "crear como producto o variante nueva, qué se va a actualizar sobre algo que ya existía, y qué " +
            "filas tienen errores (por ejemplo, un precio mal escrito o un SKU repetido) — todo esto antes de " +
            "que la base de datos se modifique.",
        },
        {
          type: "p",
          text:
            "Esa vista previa te da la oportunidad de corregir tu archivo si algo salió mal, sin ningún riesgo: " +
            "como todavía no se guardó nada, puedes cerrar, arreglar el CSV en tu hoja de cálculo, y volver a " +
            "intentar la importación cuantas veces necesites hasta que la vista previa se vea correcta.",
        },
        {
          type: "callout",
          tone: "warning",
          title: "Tope de 10,000 filas por importación",
          text:
            "Cada importación acepta como máximo 10,000 filas. Si tu catálogo es más grande que eso — por " +
            "ejemplo, una tienda de materiales para construcción con 15,000 variantes distintas entre " +
            "distintas marcas y presentaciones —, tienes que dividir tu archivo en partes de máximo 10,000 " +
            "filas cada una, e importarlas por separado, una detrás de otra.",
        },
      ],
      related: ["productos-y-variantes"],
    },
    {
      slug: "preguntas-catalogo",
      title: "Preguntas frecuentes: catálogo",
      summary: "Dudas comunes al dar de alta productos, precios, existencias, fotos e importaciones.",
      audience: "owner",
      keywords: ["faq", "borrar producto", "eliminar producto", "precio no cambia", "sin existencias", "foto rechazada"],
      body: [
        {
          type: "faq",
          items: [
            {
              q: "¿Cómo borro un producto?",
              a:
                "Los productos no se borran: se archivan. Abre el menú de acciones del producto y elige " +
                "\"Archivar\". Deja de venderse y el agente ya no lo ofrece, pero su historial se conserva " +
                "(cotizaciones y pedidos viejos lo siguen mostrando). Puedes reactivarlo cuando quieras.",
            },
            {
              q: "Creé un producto y el agente no lo ofrece.",
              a:
                "Casi siempre sigue en Borrador. Cámbialo a Activo desde su menú de acciones. Revisa también " +
                "que la variante esté activa y que su existencia no sea 0.",
            },
            {
              q: "¿Qué pasa si dejo la existencia vacía?",
              a:
                "Esa variante no lleva control de inventario: nunca se marca como agotada. Útil para cosas " +
                "que haces sobre pedido o servicios.",
            },
            {
              q: "¿Cuándo baja la existencia?",
              a:
                "Cuando se abre el cobro de un pedido, las unidades quedan apartadas. Si el link de pago " +
                "vence o el pedido se cancela, se liberan.",
            },
            {
              q: "Me sale un aviso de conflicto al guardar.",
              a:
                "Otra persona guardó cambios en el mismo producto justo antes que tú. Recarga para ver la " +
                "versión nueva, vuelve a hacer tu cambio y guarda.",
            },
            {
              q: "El precio no se guarda.",
              a: "Escríbelo con dos decimales y punto, sin comas ni signo de pesos: 149.00.",
            },
            {
              q: "Los clientes le dicen al producto con otro nombre.",
              a:
                "Agrégalo como sinónimo del producto. Por ejemplo, si vendes \"Pintura vinílica 19 L\" y te " +
                "piden \"cubeta grande\", pon \"cubeta grande\" como sinónimo. El agente y el buscador lo " +
                "encuentran.",
            },
            {
              q: "¿Puedo editar el catálogo desde Claude u otro asistente?",
              a:
                "Sí, con una conexión por MCP y una API key con permiso de escribir catálogo. Ver \"Editar tu " +
                "catálogo con un asistente (MCP)\".",
            },
          ],
        },
      ],
      related: ["productos-y-variantes", "fotos-de-producto", "mcp-catalogo"],
    },
  ],
};
