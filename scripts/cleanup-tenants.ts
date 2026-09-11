/**
 * Borrado de tenants que NO son `demo` — el cliente quiere que el agente
 * (WhatsApp bot) opere exclusivamente sobre "Demo Store".
 *
 *   1. Dry-run por defecto; pasa --apply para borrar de verdad.
 *   2. Si un tenant tiene conversaciones / mensajes / clientes / pedidos /
 *      cotizaciones / productos con datos, en lugar de borrarlo lo renombra
 *      a "_pending_review_<slug>" + status=DISABLED. Así el bot deja de
 *      entregarle webhooks (el handler de `ingestInbound` ya filtra por
 *      connection.tenant.status vía el guard) sin perder el historial.
 *   3. Lee `DATABASE_URL` del `.env` de la raíz si no está en process.env.
 *
 * Uso:
 *   pnpm cleanup:tenants                 # dry-run, muestra lo que haría
 *   pnpm cleanup:tenants:apply          # equivalente a --apply
 *   pnpm cleanup:tenants --apply        # explícito
 *   pnpm cleanup:tenants --keep=demo    # explícito: solo deja `demo`
 *   pnpm cleanup:tenants --keep=acme,demo  # conserva varios
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

/** Parsea `KEY=VALUE` (sin shell) para sacar `DATABASE_URL` del `.env`. */
function loadEnv(file: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!existsSync(file)) return out;
  for (const raw of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = raw.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[m[1]] = v;
  }
  return out;
}

interface TenantBlock {
  id: string;
  slug: string;
  name: string;
  counts: Record<string, number>;
}

async function countFor(prisma: any, tenantId: string): Promise<Record<string, number>> {
  const where = { tenantId };
  const conv = await prisma.whatsAppConversation.count({ where });
  const msgs = await prisma.whatsAppMessage.count({ where });
  const customers = await prisma.customer.count({ where });
  const quotes = await prisma.quote.count({ where });
  const orders = await prisma.order.count({ where });
  const products = await prisma.product.count({ where });
  return { conv, msgs, customers, quotes, orders, products };
}

async function blockFor(prisma: any, slug: string): Promise<TenantBlock | null> {
  const t = await prisma.tenant.findUnique({ where: { slug } });
  if (!t) return null;
  return {
    id: t.id,
    slug: t.slug,
    name: t.name,
    counts: await countFor(prisma, t.id),
  };
}

async function main() {
  const ROOT = resolve(__dirname, "..");
  const env = loadEnv(resolve(ROOT, ".env"));
  const DATABASE_URL = process.env.DATABASE_URL ?? env.DATABASE_URL;
  if (!DATABASE_URL) {
    console.error("DATABASE_URL no está en process.env ni en .env");
    process.exit(2);
  }

  const args = process.argv.slice(2);
  const APPLY = args.includes("--apply");
  const keepArg = args.find((a) => a.startsWith("--keep="));
  const KEEP = new Set(
    (keepArg ? keepArg.slice("--keep=".length) : "demo").split(",").filter(Boolean),
  );

  if (APPLY) {
    console.warn("⚠️  Ejecutando con --apply. Borrará tenants reales de la BD.");
  } else {
    console.log("🔎 Dry-run. Pasa --apply para borrar.");
  }

  /** Imports dinámicos: Prisma Client precompilado en commerce-api. */
  const commerceApiNode = resolve(ROOT, "apps/commerce-api");
  process.chdir(commerceApiNode);
  const prismaMod = await import(
    resolve(commerceApiNode, "node_modules/@prisma/client/index.js")
  );
  const prisma = new prismaMod.PrismaClient({ datasources: { db: { url: DATABASE_URL } } });

  try {
    const tenants = await prisma.tenant.findMany({ orderBy: { slug: "asc" } });

    console.log("\nTenants en la BD:");
    for (const t of tenants) console.log(`  - ${t.slug.padEnd(12)} ${t.id}  ${t.name}`);

    const targets = tenants.filter((t: any) => !KEEP.has(t.slug));
    const safe = tenants.filter((t: any) => KEEP.has(t.slug));

    if (targets.length === 0) {
      console.log("\nNada que borrar (todos los tenants están en --keep).");
      return;
    }

    console.log(`\nSe conservan: ${safe.map((t: any) => t.slug).join(", ") || "(ninguno)"}`);
    console.log(`Se borrarán:  ${targets.map((t: any) => t.slug).join(", ")}\n`);

    const blocks: TenantBlock[] = [];
    for (const t of targets) {
      const b = await blockFor(prisma, t.slug);
      if (b) blocks.push(b);
    }

    for (const b of blocks) {
      const hasReal =
        b.counts.conv > 0 ||
        b.counts.msgs > 0 ||
        b.counts.customers > 0 ||
        b.counts.quotes > 0 ||
        b.counts.orders > 0 ||
        b.counts.products > 0;
      if (hasReal) {
        console.error(`✖ ${b.slug} tiene datos reales:`);
        console.error(`    ${JSON.stringify(b.counts)}`);
        console.error(`  Renombrando a "_pending_review_<slug>" en lugar de borrar.`);
      } else {
        console.log(`✓ ${b.slug}: sin datos, se puede borrar.`);
      }
    }

    /** Borrado en orden de FK: hijos sin tenantId propio → hijos con
     *  tenantId → raíz. Los modelos que solo cuelgan del tenant a través
     *  de `customer` (CustomerAddress, CustomerIdentity, CustomerConsent)
     *  se borran por la relación padre-madre; el resto, directo por tenantId. */
    const TENANT_SCOPED: string[] = [
      "Notification",
      "NotificationTimeline",
      "AgentUsageEvent",
      "LedgerEntry",
      "OutboxEvent",
      "InboxEvent",
      "Job",
      "ConversationNote",
      "MessageNote",
      "AuditLog",
      "CheckoutSession",
      "Order",
      "QuoteShareToken",
      "Quote",
      "ProductVariant",
      "Product",
      "WhatsAppMessage",
      "WhatsAppConversation",
      "WhatsAppConnection",
      "StorageObject",
      "Integration",
      "IntegrationEvent",
      "Session",
      "Invitation",
      "ApiKey",
      "Membership",
    ];

    /** Modelos que NO tienen `tenantId` directo: llegan al tenant por
     *  una relación padre (Customer). Se borran vía el padre. */
    const CUSTOMER_CHILDREN: string[] = [
      "CustomerAddress",
      "CustomerIdentity",
      "CustomerConsent",
    ];

    async function purge(b: TenantBlock): Promise<void> {
      await prisma.$transaction(async (tx: any) => {
        for (const model of CUSTOMER_CHILDREN) {
          const delegate = tx[model];
          if (delegate?.deleteMany) {
            await delegate.deleteMany({ where: { customer: { tenantId: b.id } } });
          }
        }
        for (const model of TENANT_SCOPED) {
          const delegate = tx[model];
          if (delegate?.deleteMany) {
            await delegate.deleteMany({ where: { tenantId: b.id } });
          }
        }
        await tx.customer.deleteMany({ where: { tenantId: b.id } });
        await tx.tenant.delete({ where: { id: b.id } });
      }, { timeout: 60_000 });
    }

    let removed = 0;
    let preserved = 0;
    for (const b of blocks) {
      const hasReal =
        b.counts.conv > 0 ||
        b.counts.msgs > 0 ||
        b.counts.customers > 0 ||
        b.counts.quotes > 0 ||
        b.counts.orders > 0 ||
        b.counts.products > 0;

      if (hasReal) {
        preserved++;
        if (APPLY) {
          await prisma.tenant.update({
            where: { id: b.id },
            data: { slug: `_pending_review_${b.slug}`, status: "DISABLED" },
          });
          console.log(`  renombrado: ${b.slug} -> _pending_review_${b.slug} (DISABLED)`);
        } else {
          console.log(`  [dry-run] sería renombrado a _pending_review_<slug>`);
        }
        continue;
      }

      if (APPLY) {
        console.log(`  borrando ${b.slug}…`);
        await purge(b);
        removed++;
        console.log(`  ✓ ${b.slug} borrado`);
      } else {
        console.log(`  [dry-run] borraría ${b.slug} (sin datos).`);
        removed++;
      }
    }

    console.log(
      `\nListo: ${removed} borrados, ${preserved} con datos (renombrados a _pending_review_* en --apply).`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
