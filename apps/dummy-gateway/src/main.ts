// Dummy gateway: pasarela simulada independiente.
// Ver docs/09-pay.md. Tiene su propia BD y usuario SQL.
// NO modifica pedidos de la app comercial.
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { Logger, ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import helmet from "helmet";
import { DummyModule } from "./dummy.module.js";

async function bootstrap() {
  const config = new ConfigService();
  const app = await NestFactory.create(DummyModule, {
    logger: ["error", "warn", "log"],
  });

  app.use(helmet());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  const port = Number(config.get<string>("DUMMY_PORT") ?? 4100);
  await app.listen(port, "0.0.0.0");

  Logger.log(`Dummy gateway listening on http://0.0.0.0:${port}`, "DummyBootstrap");
  Logger.warn(
    "PAYMENT_PROVIDER=DUMMY activo. NO se mueve dinero real. Ver ADR-005.",
    "DummyBootstrap",
  );
}

bootstrap().catch((err) => {
  Logger.error(err, "DummyBootstrap");
  process.exit(1);
});