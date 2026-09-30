/**
 * Espera entre sondeos del outbox: 1 s mientras hay trabajo y se relaja
 * (duplicando) hasta `POLL_IDLE_MAX_MS` cuando la cola viene vacía, para no
 * golpear la base cada segundo en horas muertas. En cuanto aparece una fila
 * vuelve al mínimo.
 */
export const POLL_MIN_MS = 1_000;
export const POLL_IDLE_MAX_MS = 5_000;

export function nextPollDelay(currentMs: number, hadWork: boolean): number {
  if (hadWork) return POLL_MIN_MS;
  return Math.min(Math.max(currentMs, POLL_MIN_MS) * 2, POLL_IDLE_MAX_MS);
}
