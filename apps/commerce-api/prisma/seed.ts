import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import argon2 from "argon2";
import { randomBytes } from "node:crypto";

const prisma = new PrismaClient();

async function main() {
  console.log("Seeding tenants demo...");

  // Tenant A: demo
  const tenantA = await prisma.tenant.upsert({
    where: { slug: "demo" },
    create: {
      slug: "demo",
      name: "Demo Store",
      timezone: "America/Mexico_City",
    },
    update: {},
  });

  // Tenant B: acme
  const tenantB = await prisma.tenant.upsert({
    where: { slug: "acme" },
    create: {
      slug: "acme",
      name: "ACME Wholesale",
      timezone: "America/Mexico_City",
    },
    update: {},
  });

  // Owner demo
  const ownerHash = await argon2.hash("Demo1234!Demo1234!", {
    type: argon2.argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });

  const owner = await prisma.user.upsert({
    where: { email: "owner@demo.local" },
    create: {
      email: "owner@demo.local",
      fullName: "Demo Owner",
      passwordHash: ownerHash,
    },
    update: {},
  });

  await prisma.membership.upsert({
    where: { tenantId_userId: { tenantId: tenantA.id, userId: owner.id } },
    create: {
      tenantId: tenantA.id,
      userId: owner.id,
      role: "OWNER",
    },
    update: {},
  });

  // Owner acme
  const acmeHash = await argon2.hash("Acme1234!Acme1234!", {
    type: argon2.argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });

  const acmeOwner = await prisma.user.upsert({
    where: { email: "owner@acme.local" },
    create: {
      email: "owner@acme.local",
      fullName: "ACME Owner",
      passwordHash: acmeHash,
    },
    update: {},
  });

  await prisma.membership.upsert({
    where: { tenantId_userId: { tenantId: tenantB.id, userId: acmeOwner.id } },
    create: {
      tenantId: tenantB.id,
      userId: acmeOwner.id,
      role: "OWNER",
    },
    update: {},
  });

  // Catálogo demo: Jaztea El Original (mismo negocio que la base de
  // conocimiento del agente en apps/agent-service/knowledge).
  const catalog: Array<{
    sku: string;
    title: string;
    description: string;
    satProductCode: string;
    variants: Array<{
      sku: string;
      title: string;
      price: number;
      stock: number;
      satUnitCode: string;
    }>;
  }> = [
    {
      sku: "JAZ-ORIG",
      title: "Jaztea El Original",
      description:
        "Té helado de flor de jazmín 100% natural. Refrescante, con calcio, hierro y antioxidantes.",
      satProductCode: "50202306",
      variants: [
        { sku: "JAZ-ORIG-500", title: "El Original 500 ml", price: 100.0, stock: 240, satUnitCode: "H87" },
        { sku: "JAZ-ORIG-X12", title: "El Original paquete x12", price: 1150.0, stock: 40, satUnitCode: "XPK" },
        { sku: "JAZ-ORIG-X24", title: "El Original paquete x24", price: 2200.0, stock: 0, satUnitCode: "XPK" },
      ],
    },
    {
      sku: "JAZ-JF",
      title: "Jazyfrut",
      description:
        "Concentrado de fruta 100% natural. Rinde 25 porciones: 1 parte de concentrado por 5 de agua.",
      satProductCode: "50202306",
      variants: [
        { sku: "JAZ-JF-JAM", title: "Jazyfrut Jamaica", price: 165.0, stock: 60, satUnitCode: "H87" },
        { sku: "JAZ-JF-MAN", title: "Jazyfrut Mango", price: 165.0, stock: 55, satUnitCode: "H87" },
        { sku: "JAZ-JF-GUA", title: "Jazyfrut Guayaba", price: 165.0, stock: 12, satUnitCode: "H87" },
        { sku: "JAZ-JF-TAM", title: "Jazyfrut Tamarindo", price: 165.0, stock: 0, satUnitCode: "H87" },
      ],
    },
    {
      sku: "JAZ-LOVER",
      title: "JazteaLover",
      description: "Mercancía de la marca: poliéster 100% con bordado al frente.",
      satProductCode: "53102300",
      variants: [
        { sku: "JAZ-GOR-AM", title: "Gorra amarilla", price: 250.0, stock: 18, satUnitCode: "H87" },
        { sku: "JAZ-GOR-NE", title: "Gorra negra", price: 250.0, stock: 9, satUnitCode: "H87" },
        { sku: "JAZ-BUF-NE", title: "Buff negro", price: 250.0, stock: 25, satUnitCode: "H87" },
      ],
    },
  ];

  for (const item of catalog) {
    const product = await prisma.product.upsert({
      where: { tenantId_sku: { tenantId: tenantA.id, sku: item.sku } },
      create: {
        tenantId: tenantA.id,
        sku: item.sku,
        title: item.title,
        description: item.description,
        status: "ACTIVE",
      },
      update: { title: item.title, description: item.description },
    });

    for (const variant of item.variants) {
      await prisma.productVariant.upsert({
        where: { tenantId_sku: { tenantId: tenantA.id, sku: variant.sku } },
        create: {
          tenantId: tenantA.id,
          productId: product.id,
          sku: variant.sku,
          title: variant.title,
          price: variant.price,
          stock: variant.stock,
          satProductCode: item.satProductCode,
          satUnitCode: variant.satUnitCode,
          status: "ACTIVE",
        },
        update: { title: variant.title, price: variant.price, stock: variant.stock },
      });
    }
  }

  // API key del agente: scopes mínimos para conversar, cotizar y cobrar.
  // El secreto se imprime una sola vez; va a AGENT_API_KEY_REF en .env.
  const agentScopes = [
    "catalog.read",
    "customers.read",
    "customers.write",
    "quotes.read",
    "quotes.write",
    "orders.read",
    "orders.write",
    "chat.read",
    "chat.write",
  ];
  const existingAgentKey = await prisma.apiKey.findFirst({
    where: { tenantId: tenantA.id, name: "agent-service", revokedAt: null },
  });
  let agentKeySecret: string | null = null;
  if (!existingAgentKey) {
    const prefix = `npk_${randomBytes(6).toString("hex")}`;
    const secret = randomBytes(32).toString("base64url");
    agentKeySecret = `${prefix}_${secret}`;
    await prisma.apiKey.create({
      data: {
        tenantId: tenantA.id,
        prefix,
        name: "agent-service",
        secretHash: await argon2.hash(agentKeySecret, {
          type: argon2.argon2id,
          memoryCost: 19456,
          timeCost: 2,
          parallelism: 1,
        }),
        scopes: agentScopes,
        createdById: owner.id,
      },
    });
  }

  console.log("Seed done.");
  console.log("  Tenant demo:", tenantA.id, "slug=demo");
  console.log("  Tenant acme:", tenantB.id, "slug=acme");
  console.log("  Owner demo:  owner@demo.local / Demo1234!Demo1234!");
  console.log("  Owner acme:  owner@acme.local / Acme1234!Acme1234!");
  console.log("  Catálogo:    Jaztea El Original (10 variantes)");
  if (agentKeySecret) {
    console.log("");
    console.log("  API key del agente (cópiala a AGENT_API_KEY_REF, no se vuelve a mostrar):");
    console.log(`  ${agentKeySecret}`);
  } else {
    console.log("  API key del agente: ya existía (usa la que guardaste o revócala y re-siembra)");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });