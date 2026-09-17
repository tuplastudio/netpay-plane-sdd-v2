/**
 * Evolution API onboarding. Crea instancias, gestiona QR, registra webhooks,
 * consulta estado de conexión. Ver `docs/10-wha.md` T-WHA-03.
 *
 * Hasta ahora `commerce-api` solo guardaba credenciales; los tenants tenían
 * que entrar a `evolution.tu-dominio.com/manager` para crear una instancia y
 * copiar el webhook a mano. Este servicio cierra ese hueco: desde el portal
 * Web se llama `provision`, se le muestra el QR al usuario, al escanearlo la
 * instancia queda `open` y el webhook ya está apuntando a `commerce-api`.
 *
 * Por diseño las credenciales por-conexión siguen siendo lo que el tenant
 * guarda (no asumimos un Evolution multi-tenant compartido). Para la
 * operación desde el portal, `platformEvolution()` lee primero lo que tenga
 * la conexión de ese tenant y, si está vacío, cae a `EVOLUTION_BASE_URL` /
 * `EVOLUTION_API_KEY_REF` del `.env` del API. Eso permite operar con un
 * Evolution por-tenant (cada uno con su key) sin pedirle al operador que
 * escriba esa URL cada vez.
 */

import { Injectable, Logger } from "@nestjs/common";
import { Tenant } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service.js";

const EVOLUTION_TIMEOUT_MS = 8000;

export interface PlatformEvolution {
  baseUrl: string;
  apiKey: string;
  /** De dónde salió la configuración: la conexión del tenant o las env vars. */
  source: "tenant-connection" | "env";
}

export interface EvolutionInstanceSummary {
  instanceName: string;
  instanceId: string;
  /** `open` / `close` / `connecting`. */
  state: string;
  /** Si `open`, el número al que está enlazada (E.164, sin `+`). */
  number: string | null;
  profileName: string | null;
}

export interface ProvisionResult {
  instanceName: string;
  /** Token de la instancia que devuelve Evolution al crearla. */
  hash: string;
  /** PNG del QR en base64 (`data:image/png;base64,...`). `null` si ya está `open`. */
  qrCodeBase64: string | null;
  state: string;
}

export class EvolutionApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = "EvolutionApiError";
  }
}

function normalizeBaseUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//.test(trimmed)) {
    throw new Error(`EVOLUTION_BASE_URL inválida: ${raw}`);
  }
  return trimmed;
}

function safeReadEnv(name: string): string {
  const raw = process.env[name];
  if (!raw) return "";
  return raw.trim();
}

@Injectable()
export class EvolutionOnboardingService {
  private readonly logger = new Logger(EvolutionOnboardingService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Credenciales de Evolution para operar. Prioriza lo que ya tenga guardado
   * el tenant en su conexión (porque cada tienda puede traer su propio
   * Evolution: en `MULTI_TENANT` eso es lo correcto). Si todavía no conectó
   * ninguna, cae al `.env` para poder arrancar el alta inicial desde el portal.
   */
  async platformEvolution(tenantId: string): Promise<PlatformEvolution | null> {
    const conn = await this.prisma.whatsAppConnection.findFirst({
      where: { tenantId, provider: "EVOLUTION" },
      select: { credentials: true },
    });
    const creds = (conn?.credentials ?? {}) as { baseUrl?: string; apiKey?: string };
    if (creds.baseUrl && creds.apiKey) {
      return { baseUrl: normalizeBaseUrl(creds.baseUrl), apiKey: creds.apiKey, source: "tenant-connection" };
    }
    const envBase = safeReadEnv("EVOLUTION_BASE_URL");
    const envKey = safeReadEnv("EVOLUTION_API_KEY_REF");
    if (envBase && envKey) {
      return { baseUrl: normalizeBaseUrl(envBase), apiKey: envKey, source: "env" };
    }
    return null;
  }

  /**
   * Crea una instancia nueva en Evolution (con QR listo para escanear) y
   * registra el webhook entrante de commerce-api para esa instancia.
   *
   * El nombre se deriva del tenant para evitar colisiones entre tiendas
   * (`easysell_XXXX`) y para que sea recuperable después. Si la instancia
   * ya existe (Evolution es idempotente y devuelve igual el QR mientras esté
   * `connecting`) refrescamos el QR rotativo y reescribimos el webhook.
   */
  async provision(tenant: Tenant, _opts?: { phoneHint?: string }): Promise<ProvisionResult> {
    const platform = await this.platformEvolution(tenant.id);
    if (!platform) {
      throw new EvolutionApiError(
        "Evolution no está configurado: define EVOLUTION_BASE_URL y EVOLUTION_API_KEY_REF en el API, o conecta primero una instancia existente.",
        412,
      );
    }

    const tenantSlug = tenant.slug.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 16) || "tenant";
    const instanceName = `easysell_${tenantSlug}_${Date.now().toString(36).slice(-6)}`.toLowerCase();
    const webhookUrl = this.buildInboundWebhookUrl(tenant.slug);

    // 1) crea la instancia (Evolution regenera QR cada vez que la instancia
    // está `connecting` aunque ya exista; el `instanceName` nuevo evita
    // choques con altas previas del mismo tenant).
    const createRes = await this.evolutionPost<EvolutionCreateResponse>(
      platform,
      "/instance/create",
      {
        instanceName,
        qrcode: true,
        integration: "WHATSAPP-BAILEYS",
      },
    );

    // 2) webhook: lo configuramos aunque la instancia ya viniera con uno
    // distinto, porque evolution guarda el último y nunca limpia.
    const webhookRes = await this.evolutionPost<unknown>(platform, `/webhook/set/${instanceName}`, {
      webhook: {
        url: webhookUrl,
        events: ["MESSAGES_UPSERT", "CONNECTION_UPDATE"],
        enabled: true,
        webhook_by_events: false,
        webhook_base64: false,
      },
    });
    if (!webhookRes || (webhookRes as { enabled?: boolean }).enabled !== true) {
      this.logger.warn(
        `webhook de Evolution respondió inesperado para ${instanceName}: ${JSON.stringify(webhookRes).slice(0, 200)}`,
      );
    }

    const qrCodeBase64 =
      typeof (createRes as { qrcode?: { base64?: string } }).qrcode?.base64 === "string"
        ? (createRes as { qrcode: { base64: string } }).qrcode.base64
        : null;

    return {
      instanceName,
      hash: (createRes as { hash?: string }).hash ?? "",
      qrCodeBase64,
      state: "connecting",
    };
  }

  /**
   * Trae el QR fresco de una instancia `connecting`. Evolution rota el QR
   * cada ~60 segundos; el front lo refresca en polling mientras sigue
   * mostrando "Escanea el código".
   */
  async fetchQrCode(tenantId: string, instanceName: string): Promise<string | null> {
    const platform = await this.platformEvolution(tenantId);
    if (!platform) return null;
    const res = await this.evolutionGet<{ base64?: string; code?: string }>(
      platform,
      `/instance/connect/${encodeURIComponent(instanceName)}`,
    );
    return res?.base64 ?? null;
  }

  async connectionState(tenantId: string, instanceName: string): Promise<EvolutionInstanceSummary> {
    const platform = await this.platformEvolution(tenantId);
    if (!platform) throw new EvolutionApiError("Evolution no configurado", 412);
    const res = await this.evolutionGet<EvolutionStateResponse>(
      platform,
      `/instance/connectionState/${encodeURIComponent(instanceName)}`,
    );
    const inst = res?.instance;
    const inner = (inst as { instance?: { state?: string; ownerJid?: string; profileName?: string; number?: string } } | undefined)
      ?.instance;
    const state = inst?.state ?? inner?.state ?? "unknown";
    const number = inst?.ownerJid ?? inner?.ownerJid ?? null;
    return {
      instanceName,
      instanceId: (inst as { id?: string })?.id ?? (inst as { instanceId?: string })?.instanceId ?? instanceName,
      state,
      number: number ? String(number).split("@")[0]?.replace(/^\+/, "") ?? null : null,
      profileName: (inst as { profileName?: string | null })?.profileName ?? inner?.profileName ?? null,
    };
  }

  /**
   * Desconecta y borra la instancia en Evolution cuando el tenant la da de
   * baja desde el portal. Evolution exige `logout` antes de `delete` para
   * no dejar sesiones colgadas en el teléfono.
   */
  async disconnectAndDelete(tenantId: string, instanceName: string): Promise<void> {
    const platform = await this.platformEvolution(tenantId);
    if (!platform) return;
    try {
      await this.evolutionDelete(platform, `/instance/logout/${encodeURIComponent(instanceName)}`);
    } catch (err) {
      this.logger.warn(`logout(${instanceName}) falló, intentando delete de todos modos: ${(err as Error).message}`);
    }
    try {
      await this.evolutionDelete(platform, `/instance/delete/${encodeURIComponent(instanceName)}`);
    } catch (err) {
      this.logger.warn(`delete(${instanceName}) falló: ${(err as Error).message}`);
    }
  }

  /**
   * El webhook que Evolution debe llamar cuando llega un mensaje. Inyecta el
   * `?secret=` que el `connect` grabó en `webhookSecretHash` para que el
   * controller pueda autenticar el webhook sin una API key fija.
   *
   * Por simplicidad y para no añadir un round-trip extra, usamos el origen
   * del request. En prod real esto debería ser `PUBLIC_BASE_URL` del
   * `.env` del API; en local caemos al `localhost:3000/api/v1` que es donde
   * el dev reescribe al commerce-api:4000.
   */
  buildInboundWebhookUrl(tenantSlug: string): string {
    // Las pruebas en localhost no pueden recibir el webhook de un Evolution
    // público: exigimos PUBLIC_BASE_URL cuando esté corriendo contra Evolution.
    const publicBase = safeReadEnv("PUBLIC_BASE_URL");
    const base = publicBase || `http://localhost:${safeReadEnv("WEB_PORT") || "3000"}`;
    return `${base.replace(/\/+$/, "")}/api/v1/whatsapp/webhook/inbound/${tenantSlug}`;
  }

  private async evolutionPost<T>(
    platform: PlatformEvolution,
    path: string,
    body: unknown,
  ): Promise<T> {
    const url = `${platform.baseUrl}${path}`;
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          apikey: platform.apiKey,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(EVOLUTION_TIMEOUT_MS),
      });
    } catch (err) {
      throw new EvolutionApiError(`No se pudo conectar con Evolution (${url}): ${(err as Error).message}`, 502);
    }
    return this.parseResponse<T>(res);
  }

  private async evolutionGet<T>(platform: PlatformEvolution, path: string): Promise<T> {
    const url = `${platform.baseUrl}${path}`;
    let res: Response;
    try {
      res = await fetch(url, {
        method: "GET",
        headers: { apikey: platform.apiKey },
        signal: AbortSignal.timeout(EVOLUTION_TIMEOUT_MS),
      });
    } catch (err) {
      throw new EvolutionApiError(`No se pudo conectar con Evolution (${url}): ${(err as Error).message}`, 502);
    }
    return this.parseResponse<T>(res);
  }

  private async evolutionDelete(platform: PlatformEvolution, path: string): Promise<void> {
    const url = `${platform.baseUrl}${path}`;
    try {
      await fetch(url, {
        method: "DELETE",
        headers: { apikey: platform.apiKey },
        signal: AbortSignal.timeout(EVOLUTION_TIMEOUT_MS),
      });
    } catch (err) {
      this.logger.warn(`Evolution DELETE ${path} falló: ${(err as Error).message}`);
    }
  }

  private async parseResponse<T>(res: Response): Promise<T> {
    const text = await res.text();
    let parsed: unknown = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }
    if (!res.ok) {
      const message = (parsed as { response?: { message?: unknown }; message?: unknown })?.response?.message
        ?? (parsed as { message?: unknown })?.message
        ?? `Evolution HTTP ${res.status}`;
      throw new EvolutionApiError(
        typeof message === "string" ? message : JSON.stringify(message),
        res.status,
        parsed,
      );
    }
    return parsed as T;
  }
}

/** Forma de la respuesta de `POST /instance/create`. Parcial: solo lo que usamos. */
interface EvolutionCreateResponse {
  instance?: { instanceName?: string; status?: string };
  hash?: string;
  qrcode?: { pairingCode?: string | null; code?: string; base64?: string };
  webhook?: unknown;
}

/** Forma de la respuesta de `GET /instance/connectionState/{instance}`. */
interface EvolutionStateResponse {
  instance?: {
    instanceName?: string;
    instanceId?: string;
    state?: string;
    ownerJid?: string | null;
    profileName?: string | null;
    number?: string | null;
    id?: string;
  };
}
