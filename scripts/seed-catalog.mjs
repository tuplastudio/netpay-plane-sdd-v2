/**
 * Carga el catálogo completo de Pinturas Aglos en la base y deja existencia
 * alta (STOCK_DEFAULT) en todas las variantes, para demos y pruebas de carga.
 *
 * ATENCIÓN — PRECIOS Y CLAVES SAT SON PLACEHOLDER: aglos.com.mx no publica
 * precios (varios productos dicen "requiere cotización al momento"), así que
 * los precios de este archivo son estimados de referencia para que el demo
 * funcione, NO precios reales de Pinturas Aglos. Antes de usar este tenant con
 * clientes reales, reemplaza `price` por la lista de precios real del negocio y
 * confirma `satProductCode` (clave de c_ClaveProdServ) con el contador.
 *
 * Idempotente: hace upsert por (tenantId, sku), así que se puede correr
 * las veces que haga falta sin duplicar.
 *
 *   docker exec netpay_commerce_api node /repo/scripts/seed-catalog.mjs
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const STOCK_DEFAULT = 100000;
const TENANT_SLUG = process.env.SEED_TENANT_SLUG ?? "demo";

// c_ClaveProdServ (SAT), placeholder por categoría — ver nota arriba.
const CATALOG = [
  {
    product: "2000, Pintura Vinil-Acrílica, Mate",
    sku: "AGL-2000-PINTURA-VINIL-ACRIL",
    description:
      "Pintura vinílica acrílica mate. Calidad 5 años. Igualación de sistema tintométrico con magnífico poder cubriente y durabilidad.",
    satProductCode: "31201509",
    variants: [
      { sku: "AGL-2000-PINTURA-VINIL-ACRIL-4LT", title: "2000, Pintura Vinil-Acrílica, Mate 4 LT", price: "520.00" },
      { sku: "AGL-2000-PINTURA-VINIL-ACRIL-19LT", title: "2000, Pintura Vinil-Acrílica, Mate 19 LT", price: "1850.00" },
      { sku: "AGL-2000-PINTURA-VINIL-ACRIL-200LT", title: "2000, Pintura Vinil-Acrílica, Mate 200 LT", price: "17500.00" },
    ],
  },
  {
    product: "PLUS, Pintura Vinil-Acrílica, Semi Satinada",
    sku: "AGL-PLUS-PINTURA-VINIL-ACRIL",
    description:
      "Pintura vinílica semi satinada, calidad 7 años, igualación de sistema tintometrico Recubrimiento para usos arquitectónicos, posee gran resistencia a la intemperie, flexibilidad y excelente lavabilidad con magnífico poder cubriente.",
    satProductCode: "31201509",
    variants: [
      { sku: "AGL-PLUS-PINTURA-VINIL-ACRIL-1LT", title: "PLUS, Pintura Vinil-Acrílica, Semi Satinada 1 LT", price: "150.00" },
      { sku: "AGL-PLUS-PINTURA-VINIL-ACRIL-4LT", title: "PLUS, Pintura Vinil-Acrílica, Semi Satinada 4 LT", price: "520.00" },
      { sku: "AGL-PLUS-PINTURA-VINIL-ACRIL-19LT", title: "PLUS, Pintura Vinil-Acrílica, Semi Satinada 19 LT", price: "1850.00" },
      { sku: "AGL-PLUS-PINTURA-VINIL-ACRIL-200LT", title: "PLUS, Pintura Vinil-Acrílica, Semi Satinada 200 LT", price: "17500.00" },
    ],
  },
  {
    product: "AGLOSTONE® , Pintura Viníl-acrílica",
    sku: "AGL-AGLOSTONE-PINTURA-VINIL",
    description:
      "Pintura calidad contratista, acabado mate, base agua. Ideal para interiores y exteriores. Se caracteriza por su buen poder cubriente y resistencia al lavado. 20 colores de línea.",
    satProductCode: "31201509",
    variants: [
      { sku: "AGL-AGLOSTONE-PINTURA-VINIL-4LT", title: "AGLOSTONE® , Pintura Viníl-acrílica 4 LT", price: "520.00" },
      { sku: "AGL-AGLOSTONE-PINTURA-VINIL-19LT", title: "AGLOSTONE® , Pintura Viníl-acrílica 19 LT", price: "1850.00" },
      { sku: "AGL-AGLOSTONE-PINTURA-VINIL-200LT", title: "AGLOSTONE® , Pintura Viníl-acrílica 200 LT", price: "17500.00" },
    ],
  },
  {
    product: "MASTER, Pintura Vinílica",
    sku: "AGL-MASTER-PINTURA-VINILICA",
    description:
      "Pintura viníl-acrílica, acabado mate. Ideal para interiores y exteriores sobre acabados de yeso, ladrillo, cemento; posee una gran resistencia a la intemperie, flexibilidad y buena lavabilidad.",
    satProductCode: "31201509",
    variants: [
      { sku: "AGL-MASTER-PINTURA-VINILICA-4LT", title: "MASTER, Pintura Vinílica 4 LT", price: "520.00" },
      { sku: "AGL-MASTER-PINTURA-VINILICA-19LT", title: "MASTER, Pintura Vinílica 19 LT", price: "1850.00" },
      { sku: "AGL-MASTER-PINTURA-VINILICA-200LT", title: "MASTER, Pintura Vinílica 200 LT", price: "17500.00" },
    ],
  },
  {
    product: "AGLOSIVO® , Doble función",
    sku: "AGL-AGLOSIVO-DOBLE-FUNCION",
    description:
      "Recubrimiento Vinil-Acrílico, listo para usarse en interiores y exteriores. Diseñado especialmente para sellar y fondear superficies de cemento, yeso, mortero, ladrillo, block y similares, es ideal en construcciones nuevas donde se requiera alta resistencia a la alcalinidad; Además provee fuerte adherencia a la pintura.",
    satProductCode: "31201640",
    variants: [
      { sku: "AGL-AGLOSIVO-DOBLE-FUNCION-4LT", title: "AGLOSIVO® , Doble función 4 LT", price: "520.00" },
      { sku: "AGL-AGLOSIVO-DOBLE-FUNCION-19LT", title: "AGLOSIVO® , Doble función 19 LT", price: "1850.00" },
    ],
  },
  {
    product: "AGLOSIVO® , Sellador Acrílico",
    sku: "AGL-AGLOSIVO-SELLADOR-ACRILI",
    description:
      "Sellador vinílico para interiores con gran poder de sellado y promotor de adherencia. Recomendado para aplanados de cemento, muro de concreto, yeso nuevo y pintado. Aplicación de pintura, textura ó como aditivo para cemento, morteros y pisos de cemento.",
    satProductCode: "31201640",
    variants: [
      { sku: "AGL-AGLOSIVO-SELLADOR-ACRILI-1LT", title: "AGLOSIVO® , Sellador Acrílico 1 LT", price: "150.00" },
      { sku: "AGL-AGLOSIVO-SELLADOR-ACRILI-4LT", title: "AGLOSIVO® , Sellador Acrílico 4 LT", price: "520.00" },
      { sku: "AGL-AGLOSIVO-SELLADOR-ACRILI-5LT", title: "AGLOSIVO® , Sellador Acrílico 5 LT", price: "630.00" },
      { sku: "AGL-AGLOSIVO-SELLADOR-ACRILI-19LT", title: "AGLOSIVO® , Sellador Acrílico 19 LT", price: "1850.00" },
      { sku: "AGL-AGLOSIVO-SELLADOR-ACRILI-200LT", title: "AGLOSIVO® , Sellador Acrílico 200 LT", price: "17500.00" },
    ],
  },
  {
    product: "PREMIUM 5×1, Sellador acrílico",
    sku: "AGL-PREMIUM-51-SELLADOR-ACRI",
    description:
      "Sellador acrílico para exterior, resistente a la humedad, excelente sellado de superficies porosas, asegurando la adherencia tanto como del sustrato como la capa de impermeabilizante.",
    satProductCode: "31201640",
    variants: [
      { sku: "AGL-PREMIUM-51-SELLADOR-ACRI-1LT", title: "PREMIUM 5×1, Sellador acrílico 1LT", price: "150.00" },
      { sku: "AGL-PREMIUM-51-SELLADOR-ACRI-4LT", title: "PREMIUM 5×1, Sellador acrílico 4 LT", price: "520.00" },
      { sku: "AGL-PREMIUM-51-SELLADOR-ACRI-19LT", title: "PREMIUM 5×1, Sellador acrílico 19 LT", price: "1850.00" },
    ],
  },
  {
    product: "Sellador Acrílico Base Solvente",
    sku: "AGL-SELLADOR-ACRILICO-BASE-S",
    description:
      "Líquido transparente que embellece y protege las superficies de concreto para prolongar su vida y apariencia, aumentando la resistencia a la abrasión. Aparenta un aspecto húmedo. Disponible en 15, 25 y 30% sólidos.",
    satProductCode: "31201640",
    variants: [
      { sku: "AGL-SELLADOR-ACRILICO-BASE-S-4LT", title: "Sellador Acrílico Base Solvente 4 LT", price: "520.00" },
      { sku: "AGL-SELLADOR-ACRILICO-BASE-S-19LT", title: "Sellador Acrílico Base Solvente 19 LT", price: "1850.00" },
      { sku: "AGL-SELLADOR-ACRILICO-BASE-S-200LT", title: "Sellador Acrílico Base Solvente 200LT", price: "17500.00" },
    ],
  },
  {
    product: "Sellador Acrílico LPU para impermeabilizar",
    sku: "AGL-SELLADOR-ACRILICO-LPU-IM",
    description:
      "Elaborado a base de resinas acrílicas y aditivos especiales, que le imparten características de excelente sellado y adhesividad. Producto diseñado para superficies que requieren ser impermeabilizadas.",
    satProductCode: "31201640",
    variants: [
      { sku: "AGL-SELLADOR-ACRILICO-LPU-IM-1LT", title: "Sellador Acrílico LPU para impermeabilizar 1 LT", price: "150.00" },
      { sku: "AGL-SELLADOR-ACRILICO-LPU-IM-5LT", title: "Sellador Acrílico LPU para impermeabilizar 5 LT", price: "630.00" },
      { sku: "AGL-SELLADOR-ACRILICO-LPU-IM-19LT", title: "Sellador Acrílico LPU para impermeabilizar 19 LT", price: "1850.00" },
    ],
  },
  {
    product: "CAOLÍN SIAMIL KWFL",
    sku: "AGL-CAOLIN-SIAMIL-KWFL",
    description:
      "El SIAMIL® KW-FL es una carga mineral con alto contenido de caolinita. El SIAMIL® KW-FL es un caolín de alto poder cubriente que ayuda a sustituir volúmenes sustanciales de otros pigmentos más caros. Además, sus excelentes propiedades como carga ayudan bajar costos en diversas formulaciones dentro de la industria de recubrimientos.",
    satProductCode: "11101704",
    variants: [
      { sku: "AGL-CAOLIN-SIAMIL-KWFL-STD", title: "CAOLÍN SIAMIL KWFL (20 KG)", price: "450.00" },
    ],
  },
  {
    product: "CAOLÍN SIAMIL KPFL",
    sku: "AGL-CAOLIN-SIAMIL-KPFL",
    description:
      "El SIAMIL® KP-FL es un mineral del grupo del caolín compuesto casi exclusivamente de caolinita. SIAMIL® KP-FL posee un alto poder cubriente, excelente blancura y finas partículas que permiten dar un acabado más terso al mismo tiempo que sustituye volúmenes sustanciales de otros pigmentos más caros. Sus excelentes propiedades lo hacen muy útil como carga o pigmento en formulaciones dentro de la industria de procesos químicos y en aplicaciones tecnológicas diversas.",
    satProductCode: "11101704",
    variants: [
      { sku: "AGL-CAOLIN-SIAMIL-KPFL-STD", title: "CAOLÍN SIAMIL KPFL (20 KG)", price: "450.00" },
    ],
  },
  {
    product: "BARITA TX",
    sku: "AGL-BARITA-TX",
    description:
      "La BARITA TX es un mineral formado por una mezcla de barita y celestita (sulfato de bario y estroncio, respectivamente). Este producto es estrictamente seleccionado a mano, que tiene como característica principal su bajo contenido de óxidos de fierro por lo cual tiene una alta blancura.",
    satProductCode: "11101704",
    variants: [
      { sku: "AGL-BARITA-TX-STD", title: "BARITA TX (20 KG)", price: "450.00" },
    ],
  },
  {
    product: "CAOLÍN SIAMIL M1FL",
    sku: "AGL-CAOLIN-SIAMIL-M1FL",
    description:
      "El SIAMIL® M1-FL es un mineral del grupo del caolín compuesto esencialmente de caolinita. La cristalización adquirida durante su formación en la naturaleza le da un tamaño de partícula extremadamente fino y de alta pureza. Estas características hacen del SIAMIL® M1-FL un mineral muy plástico, de gran blancura excelente en pinturas económicas , fondos, texturas y/o estucos.",
    satProductCode: "11101704",
    variants: [
      { sku: "AGL-CAOLIN-SIAMIL-M1FL-STD", title: "CAOLÍN SIAMIL M1FL (20 KG)", price: "450.00" },
    ],
  },
  {
    product: "CARBONATO DE CALCIO OMYA-1",
    sku: "AGL-CARBONATO-CALCIO-OMYA-1",
    description:
      "Es un carbonato de calcio natural de alta pureza y fácil dispersión.",
    satProductCode: "11101704",
    variants: [
      { sku: "AGL-CARBONATO-CALCIO-OMYA-1-STD", title: "CARBONATO DE CALCIO OMYA-1 (_25 KG_)", price: "450.00" },
    ],
  },
  {
    product: "CAOLÍN SIAMIL RVL",
    sku: "AGL-CAOLIN-SIAMIL-RVL",
    description:
      "El SIAMIL® RL-V es un mineral que contiene una alta proporción de caolinita que, asociada con cuarzo y sus polimorfos, tiene un finísimo tamaño de partícula. Esta característica le confiere excelentes propiedades tecnológicas en diversos usos industriales sobre todo en la industria hulera.",
    satProductCode: "11101704",
    variants: [
      { sku: "AGL-CAOLIN-SIAMIL-RVL-STD", title: "CAOLÍN SIAMIL RVL (20 KG)", price: "450.00" },
    ],
  },
  {
    product: "COLOR INTEGRAL PARA CONCRETO",
    sku: "AGL-COLOR-INTEGRAL-CONCRETO",
    description:
      "PIGMENTO EN POLVO DE ALTO DESEMPEÑO, DESARROLLADO PARA BRINDAR COLOR AL CEMENTO. **COLORES:** PREGUNTAR DISPONIBILIDAD. [![](https://aglos.com.mx/wp-content/uploads/2022/07/Pinturas-Aglos-arrow.png)](https://www.aglos.com.mx/descargas/Ficha_Tecnica-Color_Integral.pdf) Ficha técnica [Pedir información de este artículo](https://web.whatsapp.com/send?phone=5216673200452&text=Me%20interesa%20el%20producto%3A%20_______&app_absent=0)",
    satProductCode: "31201643",
    variants: [
      { sku: "AGL-COLOR-INTEGRAL-CONCRETO-STD", title: "COLOR INTEGRAL PARA CONCRETO (presentación única)", price: "450.00" },
    ],
  },
  {
    product: "KORA KONTROL® 3 años, Fibratado",
    sku: "AGL-KORA-KONTROL-3-ANOS-FIBR",
    description:
      "Impermeabilizante acrílico desarrollado con la mejor resina estireno-acrílica y materias primas de la mejor calidad ofreciendo un producto con excelentes propiedades de adherencia, elasticidad y resistencia al intemperismo manteniendo interiores más frescos.",
    satProductCode: "31201642",
    variants: [
      { sku: "AGL-KORA-KONTROL-3-ANOS-FIBR-4LT", title: "KORA KONTROL® 3 años, Fibratado 4 LT", price: "520.00" },
      { sku: "AGL-KORA-KONTROL-3-ANOS-FIBR-19LT", title: "KORA KONTROL® 3 años, Fibratado 19 LT", price: "1850.00" },
      { sku: "AGL-KORA-KONTROL-3-ANOS-FIBR-200LT", title: "KORA KONTROL® 3 años, Fibratado 200 LT", price: "17500.00" },
    ],
  },
  {
    product: "KORA KONTROL® 5 años, Normal",
    sku: "AGL-KORA-KONTROL-5-ANOS-NORM",
    description:
      "Impermeabilizante acrílico desarrollado con la mejor resina estireno-acrílica y materias primas de la mejor calidad ofreciendo un producto con excelentes propiedades de adherencia, elasticidad y resistencia al intemperismo manteniendo interiores más frescos.",
    satProductCode: "31201642",
    variants: [
      { sku: "AGL-KORA-KONTROL-5-ANOS-NORM-19LT", title: "KORA KONTROL® 5 años, Normal 19 LT", price: "1850.00" },
      { sku: "AGL-KORA-KONTROL-5-ANOS-NORM-200LT", title: "KORA KONTROL® 5 años, Normal 200 LT", price: "17500.00" },
    ],
  },
  {
    product: "COLORÍSIMO®",
    sku: "AGL-COLORISIMO",
    description:
      "Sistema de igualación para pintura vinílicas con 6 tintas concentradas, de fácil uso, las cual al mezclarse generan una gran variedad de colores.",
    satProductCode: "31201644",
    variants: [
      { sku: "AGL-COLORISIMO-STD", title: "COLORÍSIMO® (**Colores:** Azul, Rojo, Verde, Amarillo, Lila, Negro)", price: "450.00" },
    ],
  },
  {
    product: "Convertidor de óxido",
    sku: "AGL-CONVERTIDOR-OXIDO",
    description:
      "Emulsión lista para aplicar sobre superficies ferrosas con alto grado de oxidación. Este producto reacciona directamente con el óxido presente en el sustrato por lo que no es necesario realizar ningún tratamiento de superficie antes de aplicar. Al entrar en contacto con el óxido, comenzará a formar una película negra, convirtiendo el óxido presente y deteniendo la corrosión.",
    satProductCode: "31201644",
    variants: [
      { sku: "AGL-CONVERTIDOR-OXIDO-1LT", title: "Convertidor de óxido 1 LT", price: "150.00" },
      { sku: "AGL-CONVERTIDOR-OXIDO-4LT", title: "Convertidor de óxido 4 LT", price: "520.00" },
    ],
  },
  {
    product: "HIDROREPELE®",
    sku: "AGL-HIDROREPELE",
    description:
      "Protector 100% silicón base agua, ideal para canteras, concreto, estuco. Evita la formación de salitre, impide la filtración de agua, sales contaminantes y hongos.",
    satProductCode: "31201644",
    variants: [
      { sku: "AGL-HIDROREPELE-STD", title: "HIDROREPELE® (**Colores:** Transparente)", price: "450.00" },
    ],
  },
  {
    product: "5VID® BUSINESS",
    sku: "AGL-5VID-BUSINESS",
    description:
      "Desinfectante 5 vid® Business es una **FÓRMULA CONCENTRADA** antiséptica, desinfectante y esterilizante industrializada de amplio espectro. Combate con eficacia el 99.9% de 22 tipo de virus, hongos y bacterias, limpia y desinfecta gran variedad de superficies y reduce el peligro de contaminación cruzada de superficies.",
    satProductCode: "47131811",
    variants: [
      { sku: "AGL-5VID-BUSINESS-STD", title: "5VID® BUSINESS (1 LT)", price: "450.00" },
    ],
  },
  {
    product: "Masilla plástica",
    sku: "AGL-MASILLA-PLASTICA",
    description:
      "Resanador acrílico elastomérico de consistencia pastosa altamente resistente al intemperismo, forma una película plástica impermeable manteniendo su característica. Utilizada para resanar grietas y juntas de techo, paredes de cemento y concreto que se vaya a impermeabilizar. **INFORMACIÓN ADICIONAL:**",
    satProductCode: "31201644",
    variants: [
      { sku: "AGL-MASILLA-PLASTICA-1LT", title: "Masilla plástica 1 LT", price: "150.00" },
      { sku: "AGL-MASILLA-PLASTICA-4LT", title: "Masilla plástica 4 LT", price: "520.00" },
      { sku: "AGL-MASILLA-PLASTICA-19LT", title: "Masilla plástica 19 LT", price: "1850.00" },
      { sku: "AGL-MASILLA-PLASTICA-200LT", title: "Masilla plástica 200 LT", price: "17500.00" },
    ],
  },
  {
    product: "GEL 70% ALCOHOL",
    sku: "AGL-GEL-70-ALCOHOL",
    description:
      "Gel antibacterial o alcohol en gel presenta la manera más práctica de mantener una higiene a cualquier hora del día y en cualquier lugar. Producto especialmente formulado para satisfacer las nuevas necesidades de limpieza de manos con el objeto único de cuidar la SALUD. Es un antiséptico natural, se usa en las áreas médicas porque elimina gérmenes y se evapora rápidamente. Mata gérmenes comunes sin agua o toalla, es un gel formulado para proporcionar una especial acción descontaminante y desinfe",
    satProductCode: "47131811",
    variants: [
      { sku: "AGL-GEL-70-ALCOHOL-1LT", title: "GEL 70% ALCOHOL 1 LT", price: "150.00" },
      { sku: "AGL-GEL-70-ALCOHOL-5LT", title: "GEL 70% ALCOHOL 5 LT", price: "630.00" },
    ],
  },
  {
    product: "5VID®, Desinfectante Premium",
    sku: "AGL-5VID-DESINFECTANTE-PREMI",
    description:
      "Solución inteligente y multifuncional que además de usarse en superficies y áreas de uso constante, como cocinas, baños, juguetes, ropa, transporte público, áreas de tráfico, calzado, mascotas, etc. Es ideal para toda la familia, gracias a su acción sinérgica de compuestos activos biodegradables, elimina virus, hongos, bacterias y parásitos efectivamente al contacto.",
    satProductCode: "47131811",
    variants: [
      { sku: "AGL-5VID-DESINFECTANTE-PREMI-STD", title: "5VID®, Desinfectante Premium (Litros: 120 ML, 1 LT, 5 LT, 20 LT)", price: "450.00" },
    ],
  },
  {
    product: "INTERIORES, Pintura Vinílica Mate",
    sku: "AGL-INTERIORES-PINTURA-VINIL",
    description:
      "Pintura vinílica mate, base agua. Calidad de 1-2 años. Ideal para interiores, se caracteriza por su buen poder cubriente.",
    satProductCode: "31201509",
    variants: [
      { sku: "AGL-INTERIORES-PINTURA-VINIL-4LT", title: "INTERIORES, Pintura Vinílica Mate 4 LT", price: "520.00" },
      { sku: "AGL-INTERIORES-PINTURA-VINIL-19LT", title: "INTERIORES, Pintura Vinílica Mate 19 LT", price: "1850.00" },
      { sku: "AGL-INTERIORES-PINTURA-VINIL-200LT", title: "INTERIORES, Pintura Vinílica Mate 200 LT", price: "17500.00" },
    ],
  },
  {
    product: "Esmalte Alquidálico Anticorrosivo, Secado Normal",
    sku: "AGL-ESMALTE-ALQUIDALICO-ANTI",
    description:
      "Recubrimiento de uso doméstico e industrial, libre de plomo con un muy buen poder cubriente.",
    satProductCode: "31201509",
    variants: [
      { sku: "AGL-ESMALTE-ALQUIDALICO-ANTI-250ML", title: "Esmalte Alquidálico Anticorrosivo, Secado Normal 250 ML", price: "65.00" },
      { sku: "AGL-ESMALTE-ALQUIDALICO-ANTI-500ML", title: "Esmalte Alquidálico Anticorrosivo, Secado Normal 500 ML", price: "95.00" },
      { sku: "AGL-ESMALTE-ALQUIDALICO-ANTI-1LT", title: "Esmalte Alquidálico Anticorrosivo, Secado Normal 1 LT", price: "150.00" },
      { sku: "AGL-ESMALTE-ALQUIDALICO-ANTI-4LT", title: "Esmalte Alquidálico Anticorrosivo, Secado Normal 4 LT", price: "520.00" },
      { sku: "AGL-ESMALTE-ALQUIDALICO-ANTI-19LT", title: "Esmalte Alquidálico Anticorrosivo, Secado Normal 19 LT", price: "1850.00" },
      { sku: "AGL-ESMALTE-ALQUIDALICO-ANTI-200LT", title: "Esmalte Alquidálico Anticorrosivo, Secado Normal 200 LT", price: "17500.00" },
    ],
  },
  {
    product: "Esmalte Alquidálico Secado Rápido",
    sku: "AGL-ESMALTE-ALQUIDALICO-SECA",
    description:
      "Recubrimiento de uso doméstico e industrial, libre de plomo con un muy buen poder cubriente y secado al tacto en 15 min.",
    satProductCode: "31201509",
    variants: [
      { sku: "AGL-ESMALTE-ALQUIDALICO-SECA-250ML", title: "Esmalte Alquidálico Secado Rápido 250 ML", price: "65.00" },
      { sku: "AGL-ESMALTE-ALQUIDALICO-SECA-500ML", title: "Esmalte Alquidálico Secado Rápido 500 ML", price: "95.00" },
      { sku: "AGL-ESMALTE-ALQUIDALICO-SECA-1LT", title: "Esmalte Alquidálico Secado Rápido 1 LT", price: "150.00" },
      { sku: "AGL-ESMALTE-ALQUIDALICO-SECA-4LT", title: "Esmalte Alquidálico Secado Rápido 4 LT", price: "520.00" },
      { sku: "AGL-ESMALTE-ALQUIDALICO-SECA-19LT", title: "Esmalte Alquidálico Secado Rápido 19 LT", price: "1850.00" },
      { sku: "AGL-ESMALTE-ALQUIDALICO-SECA-200LT", title: "Esmalte Alquidálico Secado Rápido 200 LT", price: "17500.00" },
    ],
  },
  {
    product: "Fondo Anticorrosivo, Secado Ultra Rápido",
    sku: "AGL-FONDO-ANTICORROSIVO-SECA",
    description:
      "Recubrimiento para evitar la corrosión y desgaste ideal para estructuras metálicas.",
    satProductCode: "31201509",
    variants: [
      { sku: "AGL-FONDO-ANTICORROSIVO-SECA-11LT", title: "Fondo Anticorrosivo, Secado Ultra Rápido 1** 1LT", price: "500.00" },
      { sku: "AGL-FONDO-ANTICORROSIVO-SECA-4LT", title: "Fondo Anticorrosivo, Secado Ultra Rápido 4LT", price: "520.00" },
      { sku: "AGL-FONDO-ANTICORROSIVO-SECA-19LT", title: "Fondo Anticorrosivo, Secado Ultra Rápido 19LT", price: "1850.00" },
      { sku: "AGL-FONDO-ANTICORROSIVO-SECA-200LT", title: "Fondo Anticorrosivo, Secado Ultra Rápido 200LT", price: "17500.00" },
    ],
  },
  {
    product: "Fondo Anticorrosivo, Secado Normal",
    sku: "AGL-FONDO-ANTICORROSIVO-SECA-2",
    description:
      "Recubrimiento para evitar la corrosión y desgaste ideal para estructuras metálicas.",
    satProductCode: "31201509",
    variants: [
      { sku: "AGL-FONDO-ANTICORROSIVO-SECA-2-1LT", title: "Fondo Anticorrosivo, Secado Normal 1 LT", price: "150.00" },
      { sku: "AGL-FONDO-ANTICORROSIVO-SECA-2-4LT", title: "Fondo Anticorrosivo, Secado Normal 4 LT", price: "520.00" },
      { sku: "AGL-FONDO-ANTICORROSIVO-SECA-2-19LT", title: "Fondo Anticorrosivo, Secado Normal 19 LT", price: "1850.00" },
      { sku: "AGL-FONDO-ANTICORROSIVO-SECA-2-200LT", title: "Fondo Anticorrosivo, Secado Normal 200 LT", price: "17500.00" },
    ],
  },
  {
    product: "Productos",
    sku: "AGL-PRODUCTOS",
    description:
      "",
    satProductCode: "31201509",
    variants: [
      { sku: "AGL-PRODUCTOS-STD", title: "Productos (presentación única)", price: "450.00" },
    ],
  },
  {
    product: "GASOLINA BLANCA",
    sku: "AGL-GASOLINA-BLANCA",
    description:
      "Disolvente en pintura artística, barnices y procesos textiles. Sirve para limpiar puertas, ventanas, paredes y pisos. Se utiliza para la limpieza de motores, repuestos automotrices y maquinarias en general.",
    satProductCode: "47131601",
    variants: [
      { sku: "AGL-GASOLINA-BLANCA-STD", title: "GASOLINA BLANCA (1 LT)", price: "450.00" },
    ],
  },
  {
    product: "ADELGAZADOR XILOL",
    sku: "AGL-ADELGAZADOR-XILOL",
    description:
      "Disuelve los productos sintéticos, puede mezclar con ciertas pinturas y lacas para diluirlos. Es especialmente bueno para limpiar productos a base de aceite, como pinturas , manchas y otros productos sintéticos, sin dañar las superficies en las que se encuentran.",
    satProductCode: "47131601",
    variants: [
      { sku: "AGL-ADELGAZADOR-XILOL-STD", title: "ADELGAZADOR XILOL (1LT)", price: "450.00" },
    ],
  },
  {
    product: "THINNER",
    sku: "AGL-THINNER",
    description:
      "Diluyente, disolvente o diluente, también conocido como adelgazador o rebajador de pinturas .Es una mezcla de disolventes de naturaleza orgánica derivados del petróleo que actúa como un agente de dilución de sustancias no solubles en agua.",
    satProductCode: "47131601",
    variants: [
      { sku: "AGL-THINNER-STD", title: "THINNER (1 LT)", price: "450.00" },
    ],
  },
  {
    product: "AGUARRÁS",
    sku: "AGL-AGUARRAS",
    description:
      "Líquido casi incoloro, de olor muy intenso y característico. Sirve para la dilución de anticorrosivos, óleos, esmaltes, barnices y aceites impregnantes, es de evaporación lenta. Se utiliza para la remoción de grasas y aceites. Sirve para remover cera en pisos de madera y cerámicos. Ideal para limpieza de máquinas y herramientas.",
    satProductCode: "47131601",
    variants: [
      { sku: "AGL-AGUARRAS-STD", title: "AGUARRÁS (1 LT)", price: "450.00" },
    ],
  },
];

async function main() {
  const tenant = await prisma.tenant.findUnique({ where: { slug: TENANT_SLUG } });
  if (!tenant) throw new Error(`No existe el tenant ${TENANT_SLUG}`);

  let productCount = 0;
  let variantCount = 0;

  for (const entry of CATALOG) {
    let product = await prisma.product.findFirst({
      where: { tenantId: tenant.id, OR: [{ sku: entry.sku }, { title: entry.product }] },
    });
    if (!product) {
      product = await prisma.product.create({
        data: {
          tenantId: tenant.id,
          sku: entry.sku,
          title: entry.product,
          description: entry.description,
          status: "ACTIVE",
        },
      });
    } else {
      product = await prisma.product.update({
        where: { id: product.id },
        data: { sku: entry.sku, description: entry.description, status: "ACTIVE" },
      });
    }
    productCount += 1;

    for (const v of entry.variants) {
      await prisma.productVariant.upsert({
        where: { tenantId_sku: { tenantId: tenant.id, sku: v.sku } },
        create: {
          tenantId: tenant.id,
          productId: product.id,
          sku: v.sku,
          title: v.title,
          price: v.price,
          currency: "MXN",
          stock: STOCK_DEFAULT,
          satProductCode: v.satProductCode ?? entry.satProductCode,
          satUnitCode: "H87",
          status: "ACTIVE",
        },
        update: {
          productId: product.id,
          title: v.title,
          price: v.price,
          stock: STOCK_DEFAULT,
          satProductCode: v.satProductCode ?? entry.satProductCode,
          status: "ACTIVE",
        },
      });
      variantCount += 1;
    }
  }

  // Cualquier producto/variante previo del tenant que ya no venga en este
  // catálogo (p. ej. Jaztea de una carga anterior) se archiva: no se borra
  // por si hay cotizaciones/pedidos históricos que lo referencian, pero deja
  // de aparecer en búsquedas activas ni en las del agente.
  const currentProductSkus = CATALOG.map((entry) => entry.sku);
  const currentVariantSkus = CATALOG.flatMap((entry) => entry.variants.map((v) => v.sku));
  const archivedVariants = await prisma.productVariant.updateMany({
    where: { tenantId: tenant.id, sku: { notIn: currentVariantSkus } },
    data: { status: "ARCHIVED" },
  });
  const archivedProducts = await prisma.product.updateMany({
    where: { tenantId: tenant.id, sku: { notIn: currentProductSkus } },
    data: { status: "ARCHIVED" },
  });

  const total = await prisma.productVariant.count({ where: { tenantId: tenant.id, status: "ACTIVE" } });
  console.log(
    `tenant=${TENANT_SLUG} productos=${productCount} variantes_upsert=${variantCount} ` +
      `productos_archivados=${archivedProducts.count} variantes_archivadas=${archivedVariants.count} ` +
      `total_variantes_activas=${total} stock=${STOCK_DEFAULT}`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
