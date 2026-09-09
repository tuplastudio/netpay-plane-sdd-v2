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
import { originGuard } from "./common/http/origin-guard.js";
import { publicRateLimit } from "./common/http/public-rate-limit.js";

async function bootstrap() {
  validateStartupConfig();

  const config = new ConfigService();
  const app = await NestFactory.create(AppModule, {
    logger: ["error", "warn", "log"],
  });

  app.use(helmet());
  app.use(cookieParser());

  const publicBaseUrl = config.get<string>("PUBLIC_BASE_URL") ?? "http://localhost:3000";
  const extraOrigins = (config.get<string>("CORS_EXTRA_ORIGINS") ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  const allowedOrigins = [publicBaseUrl, ...extraOrigins];

  app.enableCors({ origin: allowedOrigins, credentials: true });

  // CSRF: mutaciones con cookie de sesión solo desde el frontend permitido.
  app.use(originGuard(allowedOrigins));

  // Rate limit por IP en superficies públicas (sin sesión ni API key).
  const minute = 60_000;
  app.use(
    publicRateLimit([
      { prefix: "/api/v1/auth/login", limit: 20, windowMs: 15 * minute },
      { prefix: "/api/v1/auth/mfa", limit: 30, windowMs: 15 * minute },
      { prefix: "/api/v1/auth/forgot-password", limit: 5, windowMs: 15 * minute },
      { prefix: "/api/v1/auth/reset-password", limit: 10, windowMs: 15 * minute },
      { prefix: "/api/v1/auth/accept-invite", limit: 10, windowMs: 15 * minute },
      { prefix: "/api/v1/whatsapp/webhook", limit: 600, windowMs: minute },
      { prefix: "/api/v1/payments/webhook", limit: 300, windowMs: minute },
      { prefix: "/api/v1/integrations/webhook", limit: 300, windowMs: minute },
      { prefix: "/api/v1/quotes/public", limit: 120, windowMs: minute },
      { prefix: "/api/v1/orders/public", limit: 120, windowMs: minute },
    ]),
  );

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