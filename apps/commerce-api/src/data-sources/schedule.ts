/**
 * Programación de fuentes: intervalo en minutos o cron de 5 campos
 * (`min hora díaMes mes díaSemana`, con `*`, listas, rangos y `* /n`).
 * Se evalúa en UTC. Sin dependencia nueva: el subconjunto que usa el panel
 * ("cada 15 min", "a las 3:00", "lunes a viernes a las 6") cabe aquí.
 */

const FIELD_RANGES: ReadonlyArray<[number, number]> = [
  [0, 59], // minuto
  [0, 23], // hora
  [1, 31], // día del mes
  [1, 12], // mes
  [0, 7], // día de la semana (0 y 7 = domingo)
];

export type CronFields = [Set<number>, Set<number>, Set<number>, Set<number>, Set<number>];

function parseField(spec: string, min: number, max: number, isWeekday: boolean): Set<number> {
  const out = new Set<number>();
  for (const part of spec.split(",")) {
    const m = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/.exec(part.trim());
    if (!m) throw new Error(`cron: campo "${part}" inválido`);
    const base = m[1]!;
    const step = m[2] ? Number(m[2]) : 1;
    if (step < 1) throw new Error(`cron: paso inválido en "${part}"`);
    let lo = min;
    let hi = max;
    if (base !== "*") {
      const [a, b] = base.split("-").map(Number);
      lo = a!;
      hi = b === undefined ? (m[2] ? max : a!) : b;
    }
    if (lo < min || hi > max || lo > hi) {
      throw new Error(`cron: "${part}" fuera de rango ${min}-${max}`);
    }
    for (let v = lo; v <= hi; v += step) out.add(isWeekday && v === 7 ? 0 : v);
  }
  return out;
}

/** Parsea la expresión; lanza `Error` legible si no es válida. */
export function parseCron(expr: string): CronFields {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error("cron: se esperan 5 campos (min hora día mes díaSemana)");
  }
  return parts.map((p, i) => {
    const [min, max] = FIELD_RANGES[i]!;
    return parseField(p, min, max, i === 4);
  }) as CronFields;
}

export function isValidCron(expr: string): boolean {
  try {
    parseCron(expr);
    return true;
  } catch {
    return false;
  }
}

/**
 * Siguiente instante (UTC, segundos en 0) estrictamente posterior a `from`
 * que cumple la expresión. Busca hasta ~1 año; null si no hay coincidencia.
 */
export function nextCronRun(expr: string, from: Date): Date | null {
  const [minutes, hours, days, months, weekdays] = parseCron(expr);
  const t = new Date(from.getTime());
  t.setUTCSeconds(0, 0);
  t.setUTCMinutes(t.getUTCMinutes() + 1);
  const limit = from.getTime() + 366 * 24 * 60 * 60 * 1000;
  while (t.getTime() <= limit) {
    if (!months.has(t.getUTCMonth() + 1)) {
      t.setUTCMonth(t.getUTCMonth() + 1, 1);
      t.setUTCHours(0, 0, 0, 0);
      continue;
    }
    if (!days.has(t.getUTCDate()) || !weekdays.has(t.getUTCDay())) {
      t.setUTCDate(t.getUTCDate() + 1);
      t.setUTCHours(0, 0, 0, 0);
      continue;
    }
    if (!hours.has(t.getUTCHours())) {
      t.setUTCHours(t.getUTCHours() + 1, 0, 0, 0);
      continue;
    }
    if (!minutes.has(t.getUTCMinutes())) {
      t.setUTCMinutes(t.getUTCMinutes() + 1, 0, 0);
      continue;
    }
    return t;
  }
  return null;
}

export interface ScheduleSpec {
  scheduleEveryMinutes: number | null;
  scheduleCron: string | null;
}

/**
 * Próxima ejecución a partir de `from`. El cron manda si está definido;
 * sin programación devuelve null (solo manual).
 */
export function computeNextRun(spec: ScheduleSpec, from: Date): Date | null {
  if (spec.scheduleCron) return nextCronRun(spec.scheduleCron, from);
  if (spec.scheduleEveryMinutes && spec.scheduleEveryMinutes > 0) {
    return new Date(from.getTime() + spec.scheduleEveryMinutes * 60_000);
  }
  return null;
}

/** Tiempo máximo que un lock puede vivir antes de considerarse huérfano. */
export const LOCK_TTL_MS = 30 * 60_000;

export interface DueCandidate {
  status: string;
  nextRunAt: Date | null;
  lockedAt: Date | null;
}

/**
 * ¿Toca ejecutar esta fuente ahora? Regla pura para el scheduler y sus tests.
 * ERROR sigue programada (la fuente puede recuperarse sola); PAUSED no.
 */
export function isDue(source: DueCandidate, now: Date): boolean {
  if (source.status !== "ACTIVE" && source.status !== "ERROR") return false;
  if (!source.nextRunAt || source.nextRunAt.getTime() > now.getTime()) return false;
  if (source.lockedAt && now.getTime() - source.lockedAt.getTime() < LOCK_TTL_MS) return false;
  return true;
}
