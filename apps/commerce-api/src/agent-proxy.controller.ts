import {
  Controller,
  All,
  Req,
  Res,
  Logger,
} from "@nestjs/common";
import { Request, Response } from "express";
import { ConfigService } from "@nestjs/config";
import { Readable } from "node:stream";

/**
 * Proxy transparente al agente v2 (FastAPI en el droplet).
 *
 * El frontend en Vercel no puede alcanzar `agent-v2:8010` directamente porque
 * está en una red privada de Docker Swarm. Esta ruta pasa por commerce-api
 * (que SÍ está expuesto en `:14000` y al que Vercel llega), reenvía método/
 * headers/body al agente, y devuelve su respuesta tal cual.
 *
 * Auth: el navegador ya está autenticado con la cookie de sesión, que
 * commerce-api reenvía al agente vía `cookie:`. Adicionalmente inyectamos
 * `x-internal-key` para que el agente distinga llamadas server-to-server.
 *
 * El catch-all `@All("**")` matchea GET/POST/PUT/PATCH/DELETE/etc.
 *
 * Body forwarding — tres modos según content-type entrante:
 *   - `application/json` (u otros parseables por Express body-parser):
 *     Nest ya dejó `req.body` como objeto; lo pasamos a fetch que lo
 *     serializa y le pone content-type correcto.
 *   - `multipart/form-data` (subida de archivos `.md`): NestJS no parsea
 *     el body; lo dejamos pasar como stream crudo para que el boundary
 *     llegue intacto a FastAPI.
 *   - Cualquier otro (texto plano, octet-stream, etc.): pasamos el stream
 *     crudo del request tal cual.
 *
 * En los tres casos se reenvía `content-type` original — sin él, FastAPI
 * rechaza con 422 "Input should be a valid dictionary" porque interpreta
 * el body como texto plano.
 */
@Controller("agent")
export class AgentProxyController {
  private readonly logger = new Logger(AgentProxyController.name);

  constructor(private readonly config: ConfigService) {}

  @All("**")
  async proxy(@Req() req: Request, @Res() res: Response): Promise<void> {
    const upstream = `${this.agentBase()}${req.originalUrl.replace(/^\/api\/v1\/agent/, "")}`;

    const headers: Record<string, string> = {
      cookie: req.headers["cookie"] ?? "",
    };
    if (this.agentKey()) headers["x-internal-key"] = this.agentKey();
    // Pasar el content-length y content-type del cliente cuando vienen —
    // undici los respeta y los reenvía al upstream tal cual. Sin esto,
    // FastAPI devuelve 422 al no poder parsear el body.
    const incomingType = req.headers["content-type"];
    if (incomingType) headers["content-type"] = incomingType;

    const hasBody = !["GET", "DELETE", "HEAD"].includes(req.method);
    let body: BodyInit | undefined;
    let duplex: "half" | undefined;
    if (hasBody) {
      const ct = incomingType ?? "";
      if (ct.includes("application/json") || ct.includes("+json")) {
        // req.body ya viene parseado por el body-parser de Express: lo
        // re-serializa undici como JSON con el content-type correcto.
        body = req.body !== undefined && req.body !== null
          ? JSON.stringify(req.body)
          : undefined;
      } else {
        // Stream crudo (multipart, octet-stream, texto plano sin parsear).
        body = Readable.toWeb(req) as unknown as ReadableStream;
        duplex = "half";
      }
    }

    let upstreamRes: globalThis.Response;
    try {
      upstreamRes = await fetch(upstream, {
        method: req.method,
        headers,
        body,
        // @ts-expect-error duplex no está en el tipo público de RequestInit
        duplex,
      });
    } catch (err) {
      this.logger.error(
        `Agent proxy: ${req.method} ${upstream} → ${(err as Error).message}`,
      );
      res.status(502).json({
        code: "AGENT_UNREACHABLE",
        message: (err as Error).message,
      });
      return;
    }

    res.status(upstreamRes.status);
    const responseType = upstreamRes.headers.get("content-type");
    if (responseType) res.setHeader("content-type", responseType);
    const bodyBuf = Buffer.from(await upstreamRes.arrayBuffer());
    res.send(bodyBuf);
  }

  private agentBase(): string {
    return this.config.get<string>("AGENT_URL") ?? "http://agent-v2:8010";
  }

  private agentKey(): string {
    return this.config.get<string>("AGENT_INTERNAL_KEY") ?? "";
  }
}
