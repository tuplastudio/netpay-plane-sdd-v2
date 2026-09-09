/**
 * Script de bootstrap que crea el tenant demo si no existe.
 * Uso: pnpm bootstrap (desde raíz) o pnpm --filter @netpay/commerce-api bootstrap.
 */
import { NestFactory } from "@nestjs/core";
import { Logger } from "@nestjs/common";
import { AppModule } from "../src/app.module.js";
import { BootstrapService } from "../src/auth/bootstrap.service.js";

async function main() {
  const logger = new Logger("Bootstrap");
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ["error", "warn", "log"],
  });
  const service = app.get(BootstrapService);

  const result = await service.run({
    tenantName: process.env.BOOTSTRAP_TENANT_NAME ?? "Demo Store",
    ownerEmail: process.env.BOOTSTRAP_OWNER_EMAIL ?? "owner@demo.local",
    ownerFullName: process.env.BOOTSTRAP_OWNER_NAME ?? "Demo Owner",
    ownerPassword: process.env.BOOTSTRAP_OWNER_PASSWORD ?? "Demo1234!Demo1234!",
    timezone: process.env.BOOTSTRAP_TZ ?? "America/Mexico_City",
  });

  logger.log(
    `Bootstrap: tenant=${result.tenantId} owner=${result.ownerUserId} existed=${result.alreadyExisted}`,
  );

  await app.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});