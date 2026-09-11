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

  // Hardening: no dejamos que un deploy de prod arranque con la
  // contraseña de demo por accidente. Si NODE_ENV=production y
  // BOOTSTRAP_OWNER_PASSWORD no está seteada (o quedó en el
  // default), fallamos ruidosamente en lugar de crear el owner
  // con "Demo1234!Demo1234!".
  if (process.env.NODE_ENV === "production" &&
      !process.env.BOOTSTRAP_OWNER_PASSWORD) {
    throw new Error(
      "BOOTSTRAP_OWNER_PASSWORD no está seteada en producción. " +
      "Define una contraseña explícita (>=12 chars) antes de correr bootstrap.",
    );
  }

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