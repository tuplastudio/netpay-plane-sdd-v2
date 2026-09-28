/**
 * Credenciales de `WhatsAppConnection`: cómo se guardan, cómo se leen y qué
 * se le muestra al portal.
 *
 * Reglas:
 *  - La API key de Evolution de la PLATAFORMA (`EVOLUTION_API_KEY_REF`) nunca
 *    se copia a la fila. Una conexión que opera con ella guarda solo
 *    `{ source: "platform", instance }` y la key (y la URL) se resuelven del
 *    entorno en cada llamada. Filas viejas que ya traen la key en claro siguen
 *    funcionando: si la key guardada coincide con la del entorno se tratan como
 *    `platform`.
 *  - Los secretos que aporta el tenant (`apiKey` de su Evolution, `token` de
 *    Meta) se guardan cifrados (`apiKeyEnc` / `tokenEnc`, AES-GCM con
 *    `TOKEN_ENCRYPTION_KEY_REF`). Filas viejas en claro se siguen leyendo.
 *  - Ninguna respuesta HTTP devuelve `credentials` tal cual: se usa
 *    `sanitizeConnection`, que solo expone datos no secretos.
 */

import { decryptSecret, encryptSecret } from "../common/crypto/secret-cipher.js";

export const PLATFORM_CREDENTIALS_SOURCE = "platform" as const;

/** Claves que el cliente nunca puede fijar a mano en `POST /whatsapp/connect`. */
const RESERVED_KEYS = ["source", "apiKeyEnc", "tokenEnc"] as const;

type Raw = Record<string, unknown>;

function asRecord(raw: unknown): Raw {
  return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Raw) : {};
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function stripSlash(url: string | undefined): string | undefined {
  return url ? url.replace(/\/+$/, "") : undefined;
}

/** Base URL y API key de Evolution de la plataforma (env), sin normalizar. */
export function platformEvolutionEnv(): { baseUrl?: string; apiKey?: string } {
  return {
    baseUrl: str(process.env.EVOLUTION_BASE_URL),
    apiKey: str(process.env.EVOLUTION_API_KEY_REF),
  };
}

/** Lee un secreto cifrado (`<name>Enc`) o, si es una fila vieja, el valor en claro. */
function readSecret(c: Raw, name: "apiKey" | "token"): string | undefined {
  const enc = str(c[`${name}Enc`]);
  if (enc) return decryptSecret(enc) ?? undefined;
  return str(c[name]);
}

export interface ResolvedEvolutionCredentials {
  baseUrl?: string;
  apiKey?: string;
  instance?: string;
  /** `platform`: opera con la key del entorno. `tenant`: key propia del tenant. */
  source: "platform" | "tenant";
}

/** Credenciales de Evolution listas para usar (key descifrada o tomada del env). */
export function resolveEvolutionCredentials(raw: unknown): ResolvedEvolutionCredentials {
  const c = asRecord(raw);
  const instance = str(c.instance);
  const env = platformEvolutionEnv();
  if (c.source === PLATFORM_CREDENTIALS_SOURCE) {
    return {
      baseUrl: stripSlash(env.baseUrl ?? str(c.baseUrl)),
      apiKey: env.apiKey,
      instance,
      source: "platform",
    };
  }
  const apiKey = readSecret(c, "apiKey");
  const baseUrl = stripSlash(str(c.baseUrl));
  // Fila vieja que guardó la key de la plataforma en claro.
  if (apiKey && env.apiKey && apiKey === env.apiKey) {
    return { baseUrl: baseUrl ?? stripSlash(env.baseUrl), apiKey, instance, source: "platform" };
  }
  return { baseUrl, apiKey, instance, source: "tenant" };
}

/** Credenciales de Meta listas para usar (token descifrado). */
export function resolveMetaCredentials(raw: unknown): { token?: string; phoneId?: string } {
  const c = asRecord(raw);
  return { token: readSecret(c, "token"), phoneId: str(c.phoneId) };
}

/** Lo que se guarda para una conexión que opera con la key de la plataforma. */
export function platformEvolutionCredentials(instance: string): Raw {
  return { source: PLATFORM_CREDENTIALS_SOURCE, instance };
}

/** Lo que se guarda para una conexión Evolution con key propia del tenant (cifrada). */
export function tenantEvolutionCredentials(baseUrl: string, apiKey: string, instance: string): Raw {
  return { baseUrl, apiKeyEnc: encryptSecret(apiKey), instance };
}

/**
 * Normaliza las credenciales que manda el portal antes de guardarlas: quita
 * claves reservadas, cifra los secretos y, si la key de Evolution es la de la
 * plataforma, la reemplaza por el marcador `source: "platform"`.
 */
export function credentialsForStorage(provider: "META" | "EVOLUTION", input: Raw): Raw {
  const out: Raw = { ...input };
  for (const k of RESERVED_KEYS) delete out[k];

  const apiKey = str(out.apiKey);
  delete out.apiKey;
  const token = str(out.token);
  delete out.token;

  if (provider === "EVOLUTION" && apiKey) {
    const env = platformEvolutionEnv();
    if (env.apiKey && apiKey === env.apiKey) {
      out.source = PLATFORM_CREDENTIALS_SOURCE;
    } else {
      out.apiKeyEnc = encryptSecret(apiKey);
    }
  } else if (apiKey) {
    out.apiKeyEnc = encryptSecret(apiKey);
  }
  if (token) out.tokenEnc = encryptSecret(token);
  return out;
}

/** Vista pública (sin secretos) de las credenciales de una conexión. */
export interface PublicConnectionCredentials {
  instance: string | null;
  /** Solo para Evolution propio del tenant; la URL de la plataforma no se expone. */
  baseUrl: string | null;
  phoneId: string | null;
  hasApiKey: boolean;
  hasToken: boolean;
  source: "platform" | "tenant";
}

export function publicCredentials(provider: string, raw: unknown): PublicConnectionCredentials {
  const c = asRecord(raw);
  if (provider === "EVOLUTION") {
    const evo = resolveEvolutionCredentials(c);
    return {
      instance: evo.instance ?? null,
      baseUrl: evo.source === "tenant" ? (evo.baseUrl ?? null) : null,
      phoneId: null,
      hasApiKey: Boolean(evo.apiKey),
      hasToken: false,
      source: evo.source,
    };
  }
  const meta = resolveMetaCredentials(c);
  return {
    instance: null,
    baseUrl: null,
    phoneId: meta.phoneId ?? null,
    hasApiKey: false,
    hasToken: Boolean(meta.token),
    source: "tenant",
  };
}

/**
 * Fila de `WhatsAppConnection` apta para responder al portal: sin
 * `webhookSecretHash` y con `credentials` reducido a datos no secretos.
 */
export function sanitizeConnection<T extends { provider: string; credentials?: unknown; webhookSecretHash?: unknown }>(
  conn: T,
): Omit<T, "credentials" | "webhookSecretHash"> & { credentials: PublicConnectionCredentials } {
  const { credentials, webhookSecretHash: _hash, ...rest } = conn;
  return { ...rest, credentials: publicCredentials(conn.provider, credentials) };
}
