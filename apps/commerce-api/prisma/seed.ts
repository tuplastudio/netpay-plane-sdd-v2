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

  // Catálogo demo: Pinturas Aglos (mismo negocio que la base de
  // conocimiento del agente en apps/agent-v2/knowledge). El catálogo
  // completo (35 productos) se carga aparte con scripts/seed-catalog.mjs;
  // aquí van solo unos cuantos para que el tenant demo arranque con algo.
  // PRECIOS PLACEHOLDER: aglos.com.mx no publica precios, ver nota en
  // scripts/seed-catalog.mjs.
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
      sku: "AGL-AGLOSTONE-PINTURA-VINIL",
      title: "AGLOSTONE® , Pintura Viníl-acrílica",
      description:
        "Pintura calidad contratista, acabado mate, base agua. Ideal para interiores y exteriores. Buen poder cubriente y resistencia al lavado. 20 colores de línea.",
      satProductCode: "31201509",
      variants: [
        { sku: "AGL-AGLOSTONE-PINTURA-VINIL-4LT", title: "AGLOSTONE® , Pintura Viníl-acrílica 4 LT", price: 520.0, stock: 240, satUnitCode: "H87" },
        { sku: "AGL-AGLOSTONE-PINTURA-VINIL-19LT", title: "AGLOSTONE® , Pintura Viníl-acrílica 19 LT", price: 1850.0, stock: 40, satUnitCode: "H87" },
        { sku: "AGL-AGLOSTONE-PINTURA-VINIL-200LT", title: "AGLOSTONE® , Pintura Viníl-acrílica 200 LT", price: 17500.0, stock: 0, satUnitCode: "H87" },
      ],
    },
    {
      sku: "AGL-AGLOSIVO-DOBLE-FUNCION",
      title: "AGLOSIVO® , Doble función",
      description:
        "Recubrimiento Vinil-Acrílico para sellar y fondear cemento, yeso, mortero, ladrillo y block. Alta resistencia a la alcalinidad y fuerte adherencia a la pintura.",
      satProductCode: "31201640",
      variants: [
        { sku: "AGL-AGLOSIVO-DOBLE-FUNCION-4LT", title: "AGLOSIVO® , Doble función 4 LT", price: 520.0, stock: 60, satUnitCode: "H87" },
        { sku: "AGL-AGLOSIVO-DOBLE-FUNCION-19LT", title: "AGLOSIVO® , Doble función 19 LT", price: 1850.0, stock: 12, satUnitCode: "H87" },
      ],
    },
    {
      sku: "AGL-5VID-BUSINESS",
      title: "5VID® BUSINESS",
      description:
        "Desinfectante concentrado, antiséptico y esterilizante de amplio espectro. Combate 99.9% de virus, hongos y bacterias en superficies.",
      satProductCode: "47131811",
      variants: [
        { sku: "AGL-5VID-BUSINESS-STD", title: "5VID® BUSINESS (1 LT)", price: 450.0, stock: 25, satUnitCode: "H87" },
      ],
    },
    {
      sku: "AGL-GEL-70-ALCOHOL",
      title: "GEL 70% ALCOHOL",
      description: "Gel antibacterial 70% alcohol, de uso doméstico e industrial.",
      satProductCode: "47131811",
      variants: [
        { sku: "AGL-GEL-70-ALCOHOL-1LT", title: "GEL 70% ALCOHOL 1 LT", price: 150.0, stock: 18, satUnitCode: "H87" },
        { sku: "AGL-GEL-70-ALCOHOL-5LT", title: "GEL 70% ALCOHOL 5 LT", price: 630.0, stock: 0, satUnitCode: "H87" },
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
  console.log("  Catálogo:    Pinturas Aglos (9 variantes; catálogo completo con scripts/seed-catalog.mjs)");
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