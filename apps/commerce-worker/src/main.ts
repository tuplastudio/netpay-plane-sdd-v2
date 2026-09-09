// Commerce Worker: outbox publisher + inbox consumer. Ver docs/02-fnd.md T-FND-04.
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { WorkerModule } from "./worker.module.js";
import { OutboxPublisher } from "./outbox.publisher.js";
import { InboxConsumer } from "./inbox.consumer.js";

async function bootstrap() {
  const config = new ConfigService();
  const app = await NestFactory.createApplicationContext(WorkerModule, {
    logger: ["error", "warn", "log"],
  });

  const publisher = app.get(OutboxPublisher);
  const consumer = app.get(InboxConsumer);

  await publisher.start();
  await consumer.start();

  const port = Number(config.get<string>("WORKER_PORT") ?? 4101);
  const { createServer } = await import("node:http");
  const server = createServer((req, res) => {
    // Único endpoint: healthcheck de solo lectura. Cabeceras mínimas de
    // hardening (T-OPS-01) consistentes con el resto de la flota.
    res.setHeader("x-content-type-options", "nosniff");
    res.setHeader("x-frame-options", "DENY");
    res.setHeader("referrer-policy", "no-referrer");
    if (req.method !== "GET") {
      res.writeHead(405, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "method not allowed" }));
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ status: "ok", service: "commerce-worker" }));
  });
  server.listen(port, "0.0.0.0");

  Logger.log(`Commerce worker listening on http://0.0.0.0:${port}`, "WorkerBootstrap");

  process.on("SIGTERM", async () => {
    Logger.warn("SIGTERM received, draining...", "WorkerBootstrap");
    await publisher.stop();
    await consumer.stop();
    server.close();
    await app.close();
    process.exit(0);
  });
}

bootstrap().catch((err) => {
  Logger.error(err, "WorkerBootstrap");
  process.exit(1);
});