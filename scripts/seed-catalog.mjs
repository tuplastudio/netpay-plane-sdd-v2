/**
 * Carga el catálogo completo de Jaztea en la base y deja existencia alta
 * (STOCK_DEFAULT) en todas las variantes, para demos y pruebas de carga.
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

// c_ClaveProdServ (SAT): 50202306 bebidas no alcohólicas, 50201700 concentrados,
// 53102500 gorras/ropa, 52151600 vajilla, 53121600 bolsas.
const CATALOG = [
  {
    product: "Jaztea El Original",
    sku: "JAZ-ORIG",
    description:
      "Té helado de jazmín 100% natural, listo para tomar. Refrescante, digestivo, " +
      "con calcio, hierro y antioxidantes. Sin conservadores artificiales.",
    satProductCode: "50202306",
    variants: [
      { sku: "JAZ-ORIG-500", title: "El Original 500 ml", price: "100.00" },
      { sku: "JAZ-ORIG-1L", title: "El Original 1 L", price: "180.00" },
      { sku: "JAZ-ORIG-X6", title: "El Original paquete x6", price: "580.00" },
      { sku: "JAZ-ORIG-X12", title: "El Original paquete x12", price: "1150.00" },
      { sku: "JAZ-ORIG-X24", title: "El Original paquete x24", price: "2200.00" },
      { sku: "JAZ-ORIG-X48", title: "El Original caja mayoreo x48", price: "4200.00" },
    ],
  },
  {
    product: "Jaztea Light",
    sku: "JAZ-LIGHT",
    description:
      "El Original sin azúcar añadida, endulzado con stevia. 18 kcal por porción " +
      "de 200 ml. Mismo té de jazmín, cero culpa.",
    satProductCode: "50202306",
    variants: [
      { sku: "JAZ-LIGHT-500", title: "Light 500 ml", price: "110.00" },
      { sku: "JAZ-LIGHT-X12", title: "Light paquete x12", price: "1250.00" },
      { sku: "JAZ-LIGHT-X24", title: "Light paquete x24", price: "2400.00" },
    ],
  },
  {
    product: "Jaztea Sabores",
    sku: "JAZ-SAB",
    description:
      "Té de jazmín combinado con fruta natural. Tres sabores de temporada: " +
      "durazno, limón y frutos rojos.",
    satProductCode: "50202306",
    variants: [
      { sku: "JAZ-SAB-DUR-500", title: "Sabor Durazno 500 ml", price: "105.00" },
      { sku: "JAZ-SAB-LIM-500", title: "Sabor Limón 500 ml", price: "105.00" },
      { sku: "JAZ-SAB-FRU-500", title: "Sabor Frutos Rojos 500 ml", price: "110.00" },
      { sku: "JAZ-SAB-MIX-X12", title: "Sabores paquete mixto x12", price: "1230.00" },
    ],
  },
  {
    product: "Jazyfrut",
    sku: "JAZ-JF",
    description:
      "Concentrado de fruta 100% natural. Rinde 25 porciones: 1 parte de " +
      "concentrado por 5 de agua. Ideal para restaurantes y eventos.",
    satProductCode: "50201700",
    variants: [
      { sku: "JAZ-JF-JAM", title: "Jazyfrut Jamaica", price: "165.00" },
      { sku: "JAZ-JF-MAN", title: "Jazyfrut Mango", price: "165.00" },
      { sku: "JAZ-JF-GUA", title: "Jazyfrut Guayaba", price: "165.00" },
      { sku: "JAZ-JF-TAM", title: "Jazyfrut Tamarindo", price: "165.00" },
      { sku: "JAZ-JF-PIN", title: "Jazyfrut Piña", price: "165.00" },
      { sku: "JAZ-JF-FRE", title: "Jazyfrut Fresa", price: "165.00" },
      { sku: "JAZ-JF-NAR", title: "Jazyfrut Naranja", price: "165.00" },
      { sku: "JAZ-JF-X3", title: "Jazyfrut paquete mixto x3", price: "465.00" },
      { sku: "JAZ-JF-X6", title: "Jazyfrut paquete mixto x6", price: "890.00" },
    ],
  },
  {
    product: "JazteaLover",
    sku: "JAZ-LOVER",
    description:
      "Mercancía oficial de la marca: gorras, buffs, tazas, termos, playeras y " +
      "tote bags con bordado Jaztea.",
    satProductCode: "53102500",
    variants: [
      { sku: "JAZ-GOR-AM", title: "Gorra amarilla", price: "250.00" },
      { sku: "JAZ-GOR-NE", title: "Gorra negra", price: "250.00" },
      { sku: "JAZ-GOR-VE", title: "Gorra verde", price: "250.00" },
      { sku: "JAZ-BUF-NE", title: "Buff negro", price: "250.00" },
      { sku: "JAZ-BUF-VE", title: "Buff verde", price: "250.00" },
      { sku: "JAZ-TAZ-AM", title: "Taza amarilla", price: "180.00", satProductCode: "52151600" },
      { sku: "JAZ-TAZ-AZ", title: "Taza azul", price: "180.00", satProductCode: "52151600" },
      { sku: "JAZ-TAZ-BL", title: "Taza blanca", price: "180.00", satProductCode: "52151600" },
      { sku: "JAZ-TAZ-MU", title: "Taza multicolor", price: "195.00", satProductCode: "52151600" },
      { sku: "JAZ-TAZ-NA", title: "Taza naranja", price: "180.00", satProductCode: "52151600" },
      { sku: "JAZ-TAZ-RO", title: "Taza rosa", price: "180.00", satProductCode: "52151600" },
      { sku: "JAZ-TAZ-VE", title: "Taza verde", price: "180.00", satProductCode: "52151600" },
      { sku: "JAZ-TER-NE", title: "Termo 750 ml negro", price: "420.00", satProductCode: "52151600" },
      { sku: "JAZ-TER-BL", title: "Termo 750 ml blanco", price: "420.00", satProductCode: "52151600" },
      { sku: "JAZ-PLA-CH", title: "Playera chica", price: "320.00" },
      { sku: "JAZ-PLA-M", title: "Playera mediana", price: "320.00" },
      { sku: "JAZ-PLA-G", title: "Playera grande", price: "320.00" },
      { sku: "JAZ-TOT-NA", title: "Tote bag natural", price: "190.00", satProductCode: "53121600" },
    ],
  },
  {
    product: "Jaztea Mayoreo",
    sku: "JAZ-MAY",
    description:
      "Presentaciones para distribuidores y punto de venta. Precio por volumen, " +
      "sujeto a convenio de distribución.",
    satProductCode: "50202306",
    variants: [
      { sku: "JAZ-MAY-TAR", title: "Tarima El Original (60 cajas x24)", price: "118000.00" },
      { sku: "JAZ-MAY-EXH", title: "Exhibidor de piso surtido", price: "8900.00" },
      { sku: "JAZ-MAY-JF48", title: "Caja Jazyfrut surtida x48", price: "7200.00" },
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

  // Cualquier variante previa del tenant (p. ej. la de prueba "Café de altura")
  // también queda surtida y activa: nada en cero para la demo.
  const topped = await prisma.productVariant.updateMany({
    where: { tenantId: tenant.id },
    data: { stock: STOCK_DEFAULT, status: "ACTIVE" },
  });

  const total = await prisma.productVariant.count({ where: { tenantId: tenant.id } });
  console.log(
    `tenant=${TENANT_SLUG} productos=${productCount} variantes_upsert=${variantCount} ` +
      `surtidas=${topped.count} total_variantes=${total} stock=${STOCK_DEFAULT}`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
