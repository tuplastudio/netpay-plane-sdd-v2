// Punto de entrada del API. Verifica PAYMENT_PROVIDER=DUMMY (T-OPS-01) y arranca.
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { ValidationPipe, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import * as bodyParser from "body-parser";
import { AppModule } from "./app.module.js";
import { validateStartupConfig } from "./ops/security.middleware.js";

async function bootstrap() {
  validateStartupConfig();

  const config = new ConfigService();
  const app = await NestFactory.create(AppModule, {
    logger: ["error", "warn", "log"],
  });

  app.use(helmet());
  app.use(cookieParser());

  app.enableCors({
    origin: config.get<string>("PUBLIC_BASE_URL") ?? "http://localhost:3000",
    credentials: true,
  });

  // Webhook primero (raw) para verificación HMAC; JSON en el resto.
  app.use(
    "/api/v1/payments/webhook",
    bodyParser.raw({ type: "*/*", limit: "1mb" }),
  );
  app.use(bodyParser.json({ limit: "1mb" }));

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.setGlobalPrefix("api/v1");

  const port = Number(config.get<string>("API_PORT") ?? 4000);
  await app.listen(port, "0.0.0.0");

  Logger.log(`Commerce API listening on http://0.0.0.0:${port}`, "Bootstrap");
}

bootstrap().catch((err) => {
  Logger.error(err, "Bootstrap");
  process.exit(1);
});