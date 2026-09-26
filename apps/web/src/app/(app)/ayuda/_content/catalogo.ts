import type { HelpCategory } from "./types";

export const catalogo: HelpCategory = {
  slug: "catalogo",
  title: "Catálogo",
  articles: [
    {
      slug: "productos-y-variantes",
      title: "Crear y editar productos y variantes",
      summary: "Un producto puede tener varias variantes (talla, color, presentación), cada una con su propio precio y existencia.",
      audience: "owner",
      body: [
        {
          type: "p",
          text:
            "Un producto agrupa variantes que se venden juntas en tu mente pero por separado en el sistema: " +
            "\"Pintura vinílica\" es el producto; \"4 LT\" y \"19 LT\" son sus variantes, cada una con SKU, " +
            "precio y existencia propios.",
        },
        {
          type: "steps",
          items: [
            "Catálogo → Nuevo producto.",
            "SKU y título del producto, más al menos una variante (SKU, título, precio).",
            "Existencia (stock) es opcional: si la dejas vacía, la variante queda sin control de inventario — " +
              "el sistema nunca la marca sin existencia, sin importar cuánto se venda.",
            "Guarda. Puedes agregar más variantes después desde la ficha del producto.",
          ],
        },
        {
          type: "callout",
          tone: "info",
          text:
            "Editar un producto o variante usa control de versión: si dos personas editan al mismo tiempo, la " +
            "segunda ve un aviso de conflicto en vez de pisar el cambio de la primera sin darse cuenta.",
        },
        {
          type: "p",
          text: "Estado del producto: DRAFT (no se vende ni aparece al agente), ACTIVE (a la venta), ARCHIVED (dado de baja).",
        },
      ],
      related: ["fotos-de-producto", "importar-catalogo"],
    },
    {
      slug: "fotos-de-producto",
      title: "Fotos de producto y variante",
      summary: "Sube una foto general del producto y, si hace falta, una propia por variante.",
      audience: "owner",
      body: [
        {
          type: "p",
          text:
            "Desde la ficha del producto puedes subir fotos a la galería general (la portada que se ve en " +
            "listados) y, por cada variante, una foto propia si esa variante se ve distinta (p. ej. otro color).",
        },
        {
          type: "list",
          items: [
            "Formatos: PNG, JPG o WebP.",
            "Tamaño máximo: 5 MB.",
            "Dimensiones: entre 200×200 y 6000×6000 píxeles.",
            "No se aceptan imágenes animadas.",
          ],
        },
        {
          type: "p",
          text: "Puedes subir varias fotos por producto o variante — cada subida agrega una, no reemplaza las anteriores.",
        },
      ],
      related: ["productos-y-variantes"],
    },
    {
      slug: "importar-catalogo",
      title: "Importar catálogo desde un CSV",
      summary: "Sube muchos productos de golpe, con una vista previa antes de guardar nada.",
      audience: "owner",
      keywords: ["importación", "carga masiva", "excel"],
      body: [
        {
          type: "p",
          text:
            "Catálogo → Importar acepta un archivo con una fila por variante. Antes de guardar, el sistema " +
            "corre una validación en seco (dry-run): te dice qué se va a crear, qué se va a actualizar, y qué " +
            "filas tienen errores — sin tocar la base de datos todavía.",
        },
        {
          type: "callout",
          tone: "warning",
          text: "Tope de 10,000 filas por importación. Para catálogos más grandes, divide el archivo en partes.",
        },
      ],
      related: ["productos-y-variantes"],
    },
  ],
};
