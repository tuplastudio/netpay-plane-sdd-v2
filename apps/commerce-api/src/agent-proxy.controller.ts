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
import { RequestContext } from "./common/context/request-context.js";
import { Scope, effectiveScopesOf } from "./auth/policies.js";
import { NoScopeRequired } from "./auth/guards/role.guard.js";

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
/** Rutas de agent-v2 que afectan a TODOS los tenants: solo super-admin. */
const GLOBAL_ONLY = [/^prompts\/reload\/?$/, /^evals(\/|$)/, /^metrics\/?$/];
/** Escrituras que un usuario sin `tenant.admin` sí puede hacer. */
export const AGENT_READERS: Scope[] = ["chat.read", "integrations.read", "tenant.admin"];
/**
 * `methods` acota la excepción a esos verbos; sin él aplica a cualquier
 * escritura sobre la ruta. `DELETE conversations/:id` es el "Nueva
 * conversación" del chat web: quien puede escribirle al agente (`chat.write`)
 * puede tirar su propio hilo. Antes exigía `tenant.admin`/`integrations.write`,
 * así que a VENDOR/SUPPORT el reinicio les fallaba en silencio (403) y el
 * agente seguía en la conversación anterior. Cerrar, compactar o liberar
 * (`/close`, `/compact`, `/release`) siguen siendo de administración.
 */
export const MEMBER_WRITES: Array<{ pattern: RegExp; scope: Scope; methods?: string[] }> = [
  { pattern: /^chat\/?$/, scope: "chat.write" },
  { pattern: /^audio\//, scope: "chat.write" },
  { pattern: /^conversations\/[^/]+\/?$/, scope: "chat.write", methods: ["DELETE"] },
];
/** Tope de espera por respuesta del agente: un turno con LLM y herramientas
 *  puede tardar decenas de segundos, pero sin tope una caída a medias dejaba
 *  la petición del navegador colgada para siempre. */
export const DEFAULT_AGENT_PROXY_TIMEOUT_MS = 120_000;

@Controller("agent")
@NoScopeRequired()
export class AgentProxyController {
  private readonly logger = new Logger(AgentProxyController.name);

  constructor(private readonly config: ConfigService) {}

  /**
   * agent-v2 confía en el `tenantId` (query/body) y en los `principalScopes`
   * que recibe junto a la `x-internal-key` compartida. Por eso ESTE proxy es
   * la frontera de autorización: el tenant sale del principal autenticado
   * (nunca del cliente, salvo super-admin sin impersonar), los scopes que
   * llegan al agente son la intersección con los reales, y las rutas que
   * afectan a todos los tenants quedan solo para super-admin. Antes se
   * reenviaba `req.originalUrl` tal cual: cualquier sesión o API key podía
   * leer y reescribir el agente de otro negocio con `?tenantId=<otro>`.
   */
  @All("**")
  async proxy(@Req() req: Request, @Res() res: Response): Promise<void> {
    const principal = RequestContext.principal;
    if (principal.type !== "USER") {
      res.status(403).json({ code: "FORBIDDEN", message: "Solo sesiones de usuario" });
      return;
    }
    const superAdmin = principal.isSuperAdmin === true && !principal.impersonated;

    // `new URL` ya resuelve `..`/`%2e%2e`: si tras normalizar la ruta se sale
    // del prefijo, alguien intentó escapar del proxy.
    const incoming = new URL(req.originalUrl, "http://proxy.local");
    if (!/^\/api\/v1\/agent(\/|$)/.test(incoming.pathname) || /%2f|%5c/i.test(incoming.pathname)) {
      res.status(400).json({ code: "BAD_PATH", message: "Ruta inválida" });
      return;
    }
    const path = incoming.pathname.replace(/^\/api\/v1\/agent\/?/, "");
    if (!superAdmin && GLOBAL_ONLY.some((re) => re.test(path))) {
      res.status(403).json({ code: "FORBIDDEN", message: "Solo super-admin" });
      return;
    }

    const effective = effectiveScopesOf(principal);
    const isRead = ["GET", "HEAD"].includes(req.method);
    // Las lecturas incluyen transcripts de clientes y la configuración del
    // bot: CATALOG, FINANCE y VIEWER no tienen nada que hacer aquí.
    if (isRead && !superAdmin && !AGENT_READERS.some((s) => effective.has(s))) {
      res.status(403).json({ code: "FORBIDDEN", message: `Falta el permiso ${AGENT_READERS.join(" o ")}` });
      return;
    }
    if (!isRead && !superAdmin) {
      const memberWrite = MEMBER_WRITES.find(
        (w) => w.pattern.test(path) && (!w.methods || w.methods.includes(req.method)),
      );
      // Configurar el bot (ajustes, conocimiento, memoria, aprendizajes):
      // OWNER (`tenant.admin`) o ADMIN (`integrations.write`).
      const accepted: Scope[] = memberWrite ? [memberWrite.scope] : ["tenant.admin", "integrations.write"];
      if (!accepted.some((s) => effective.has(s))) {
        res.status(403).json({ code: "FORBIDDEN", message: `Falta el permiso ${accepted.join(" o ")}` });
        return;
      }
    }

    const requested =
      incoming.searchParams.get("tenantId") ??
      (req.body && typeof req.body === "object" && typeof req.body.tenantId === "string"
        ? (req.body.tenantId as string)
        : null);
    const tenantId = superAdmin && requested ? requested : principal.tenantId;
    if (!tenantId) {
      res.status(403).json({ code: "FORBIDDEN", message: "Sin empresa asociada" });
      return;
    }
    incoming.searchParams.set("tenantId", tenantId);
    // El transcript sin redactar (teléfonos, correos) es solo para super-admin.
    if (!superAdmin) incoming.searchParams.delete("redact");

    const upstream = `${this.agentBase()}/${path}${incoming.search}`;

    const headers: Record<string, string> = {
      cookie: req.headers["cookie"] ?? "",
    };
    if (this.agentKey()) headers["x-internal-key"] = this.agentKey();
    // agent-v2 solo honra `redact=false` con este header (defensa en
    // profundidad): únicamente super-admin lo recibe.
    if (superAdmin) headers["x-agent-debug"] = "1";
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
        if (req.body && typeof req.body === "object" && !Array.isArray(req.body)) {
          const next: Record<string, unknown> = { ...req.body };
          if ("tenantId" in next || /^chat\/?$/.test(path)) next.tenantId = tenantId;
          if ("principalScopes" in next || /^chat\/?$/.test(path)) {
            // Nunca más permisos de los que el usuario tiene: se respeta el
            // recorte que pida el canal, no una ampliación.
            const asked = Array.isArray(next.principalScopes)
              ? (next.principalScopes as unknown[]).filter((s): s is string => typeof s === "string")
              : [...effective];
            next.principalScopes = superAdmin ? asked : asked.filter((s) => effective.has(s as Scope));
          }
          body = JSON.stringify(next);
        } else {
          body = req.body !== undefined && req.body !== null ? JSON.stringify(req.body) : undefined;
        }
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
        signal: AbortSignal.timeout(this.timeoutMs()),
        // @ts-expect-error duplex no está en el tipo público de RequestInit
        duplex,
      });
    } catch (err) {
      const error = err as Error;
      this.logger.error(`Agent proxy: ${req.method} ${upstream} → ${error.message}`);
      if (error.name === "TimeoutError" || error.name === "AbortError") {
        res.status(504).json({
          code: "AGENT_TIMEOUT",
          message: "El agente tardó demasiado en responder",
        });
        return;
      }
      res.status(502).json({
        code: "AGENT_UNREACHABLE",
        message: "El agente no respondió",
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

  private timeoutMs(): number {
    const raw = Number(this.config.get<string>("AGENT_PROXY_TIMEOUT_MS"));
    return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_AGENT_PROXY_TIMEOUT_MS;
  }
}
