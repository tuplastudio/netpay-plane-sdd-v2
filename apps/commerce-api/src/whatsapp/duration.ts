/**
 * Duraciones compactas (`30s`, `15m`, `2h`, `1d`) — el formato que el panel
 * del agente guarda en `auto_close_after`.
 *
 * Espejo de `duration_to_seconds` / `normalize_duration` en
 * `apps/agent-v2/app/agent_settings.py`: mismo regex y mismos topes, para que
 * lo que el panel valida sea exactamente lo que este job interpreta.
 */

const DURATION_RE = /^(\d{1,7})(s|m|h|d)$/;

const UNIT_SECONDS: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };

/** Tope inferior/superior que aplica `normalize_duration()` del agente. */
export const AUTO_CLOSE_MIN_SECONDS = 30;
export const AUTO_CLOSE_MAX_SECONDS = 30 * 86400;

/**
 * Segundos que representa la cadena, o 0 si no tiene el formato compacto.
 * No recorta al rango: el recorte ya ocurrió al guardar en el agente, y aquí
 * interesa saber qué pidió realmente la configuración.
 */
export function parseCompactDuration(value: string | null | undefined): number {
  const match = DURATION_RE.exec((value ?? "").trim().toLowerCase());
  if (!match) return 0;
  return Number(match[1]) * UNIT_SECONDS[match[2]!]!;
}

/**
 * Segundos ya recortados al rango permitido, o 0 si la cadena no sirve.
 * Es lo que consume el job: un valor fuera de rango que se haya colado en el
 * JSON (editado a mano, escrito por una versión anterior) se comporta como el
 * extremo más cercano en vez de cerrar hilos vivos o no cerrar ninguno.
 */
export function autoCloseSeconds(value: string | null | undefined): number {
  const seconds = parseCompactDuration(value);
  if (seconds <= 0) return 0;
  return Math.max(AUTO_CLOSE_MIN_SECONDS, Math.min(AUTO_CLOSE_MAX_SECONDS, seconds));
}
