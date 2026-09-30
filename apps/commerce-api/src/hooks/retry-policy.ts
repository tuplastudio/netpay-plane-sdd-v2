/**
 * Política de reintentos de un hook: `{ maxAttempts, backoffSeconds }`.
 *
 * Espera entre intentos = backoffSeconds · 2^(intento-1), con tope de 1 hora.
 * Con los valores por defecto (5 intentos, 30 s): 30 s, 60 s, 120 s, 240 s.
 * Tras `maxAttempts` fallos la entrega queda `DEAD` y sólo se reintenta a
 * mano desde el panel.
 */

export interface RetryPolicy {
  maxAttempts: number;
  backoffSeconds: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = { maxAttempts: 5, backoffSeconds: 30 };
export const MIN_ATTEMPTS = 1;
export const MAX_ATTEMPTS = 10;
export const MIN_BACKOFF_SECONDS = 5;
export const MAX_BACKOFF_SECONDS = 3600;
/** Tope de la espera calculada, independiente de la base. */
export const BACKOFF_CAP_SECONDS = 3600;

/** Normaliza lo guardado en `OutboundHook.retryPolicy` (JSON libre). */
export function parseRetryPolicy(raw: unknown): RetryPolicy {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_RETRY_POLICY };
  const obj = raw as Record<string, unknown>;
  const clamp = (value: unknown, min: number, max: number, fallback: number) => {
    const n = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, Math.round(n)));
  };
  return {
    maxAttempts: clamp(obj.maxAttempts, MIN_ATTEMPTS, MAX_ATTEMPTS, DEFAULT_RETRY_POLICY.maxAttempts),
    backoffSeconds: clamp(
      obj.backoffSeconds,
      MIN_BACKOFF_SECONDS,
      MAX_BACKOFF_SECONDS,
      DEFAULT_RETRY_POLICY.backoffSeconds,
    ),
  };
}

/**
 * Segundos a esperar después del intento número `attempt` (1-based) fallido.
 * Exponencial con tope; nunca menor que la base.
 */
export function computeBackoffSeconds(attempt: number, policy: RetryPolicy): number {
  const exponent = Math.max(0, Math.floor(attempt) - 1);
  const seconds = policy.backoffSeconds * 2 ** exponent;
  return Math.min(BACKOFF_CAP_SECONDS, seconds);
}

/** Fecha del siguiente intento a partir de `now`. */
export function nextAttemptAt(attempt: number, policy: RetryPolicy, now: Date): Date {
  return new Date(now.getTime() + computeBackoffSeconds(attempt, policy) * 1000);
}
