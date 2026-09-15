import {
  Controller,
  All,
  Req,
  Res,
  Logger,
} from "@nestjs/common";
import { Request, Response } from "express";
import { ConfigService } from "@nestjs/config";

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
 */
@Controller("agent")
export class AgentProxyController {
  private readonly logger = new Logger(AgentProxyController.name);

  constructor(private readonly config: ConfigService) {}

  @All("**")
  async proxy(@Req() req: Request, @Res() res: Response): Promise<void> {
    const upstream = `${this.agentBase()}${req.originalUrl.replace(/^\/api\/v1\/agent/, "")}`;

    const headers: Record<string, string> = {
      // El agente ya autentica por cookie (que el navegador nos manda).
      // Reenviamos tal cual para que la sesión siga siendo válida.
      cookie: req.headers["cookie"] ?? "",
    };
    if (this.agentKey()) headers["x-internal-key"] = this.agentKey();

    let body: string | undefined;
    if (!["GET", "DELETE", "HEAD"].includes(req.method)) {
      body = JSON.stringify(req.body ?? {});
    }

    let upstreamRes: globalThis.Response;
    try {
      upstreamRes = await fetch(upstream, {
        method: req.method,
        headers,
        body,
      });
    } catch (err) {
      this.logger.error(
        `Agent proxy: ${req.method} ${upstream} → ${(err as Error).message}`,
      );
      res.status(502).json({
        code: "AGENT_UNREACHABLE",
        message: "fetch failed",
      });
      return;
    }

    res.status(upstreamRes.status);
    const ct = upstreamRes.headers.get("content-type");
    if (ct) res.setHeader("content-type", ct);
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
