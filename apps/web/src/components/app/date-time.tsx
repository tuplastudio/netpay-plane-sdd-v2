import * as React from "react";
import { cn } from "@/lib/utils";

/** Las fechas llegan como ISO 8601 del API, o null cuando el hito no ocurrió. */
export type DateValue = string | number | Date | null | undefined;

/**
 * Zona fija. Dos razones: (1) el portal es operativo y todo el equipo debe leer
 * el mismo reloj que el backoffice, no el del laptop de cada quien; (2) sin
 * fijarla, el servidor (UTC) y el navegador formatean distinto y Next tira
 * error de hidratación en cualquier página que renderice fechas en SSR.
 */
const TZ = "America/Mexico_City";

const DATE_OPTS: Intl.DateTimeFormatOptions = {
  timeZone: TZ,
  day: "2-digit",
  month: "short",
  year: "numeric",
};

const DATE_TIME_OPTS: Intl.DateTimeFormatOptions = {
  ...DATE_OPTS,
  hour: "2-digit",
  minute: "2-digit",
};

const LONG_OPTS: Intl.DateTimeFormatOptions = {
  timeZone: TZ,
  dateStyle: "full",
  timeStyle: "long",
};

const cache = new Map<string, Intl.DateTimeFormat>();

function fmt(key: string, opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  let f = cache.get(key);
  if (!f) {
    try {
      f = new Intl.DateTimeFormat("es-MX", opts);
    } catch {
      // Un runtime con ICU recortado puede rechazar la zona horaria. Antes de
      // tumbar la pantalla, formateamos en la zona local.
      const { timeZone: _ignored, ...rest } = opts;
      f = new Intl.DateTimeFormat("es-MX", rest);
    }
    cache.set(key, f);
  }
  return f;
}

/**
 * Normaliza cualquier entrada a `Date` o `null`. Un string basura, un
 * `Invalid Date` o un `NaN` caen en `null` — de ahí sale el em dash, nunca el
 * literal "Invalid Date" en pantalla.
 */
function toDate(value: DateValue): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "08 sept 2026, 14:32" — o "—" si no hay fecha. */
export function formatDateTime(value: DateValue): string {
  const d = toDate(value);
  return d ? fmt("dt", DATE_TIME_OPTS).format(d) : "—";
}

/** "08 sept 2026" — o "—" si no hay fecha. */
export function formatDate(value: DateValue): string {
  const d = toDate(value);
  return d ? fmt("d", DATE_OPTS).format(d) : "—";
}

/** Timestamp completo con zona, para el `title`/tooltip. */
export function formatDateTimeLong(value: DateValue): string {
  const d = toDate(value);
  return d ? fmt("long", LONG_OPTS).format(d) : "—";
}

export interface DateTimeProps extends Omit<React.TimeHTMLAttributes<HTMLTimeElement>, "dateTime"> {
  value: DateValue;
  /** `false` muestra solo la fecha, sin hora. */
  withTime?: boolean;
}

/**
 * Fecha en `<time dateTime>` con el timestamp completo en `title`, para que el
 * dato exacto siga disponible sin ocupar ancho de columna. Reemplaza a
 * `new Date(x).toLocaleString()` en las páginas.
 *
 * Cuando `value` es null renderiza un em dash (`—`) marcado `aria-hidden`
 * junto a un texto accesible "Sin fecha", en lugar de un `<time>` vacío.
 *
 * @example
 * <DateTime value={order.createdAt} />
 * <DateTime value={order.paidAt} withTime={false} className="text-muted-foreground" />
 */
export const DateTime = React.forwardRef<HTMLTimeElement, DateTimeProps>(
  ({ className, value, withTime = true, ...props }, ref) => {
    const date = toDate(value);
    if (!date) {
      return (
        <span className={cn("text-muted-foreground", className)}>
          <span aria-hidden>—</span>
          <span className="sr-only">Sin fecha</span>
        </span>
      );
    }
    const iso = date.toISOString();
    return (
      <time
        ref={ref}
        dateTime={iso}
        title={formatDateTimeLong(date)}
        className={cn("whitespace-nowrap tabular-nums", className)}
        {...props}
      >
        {withTime ? formatDateTime(date) : formatDate(date)}
      </time>
    );
  },
);
DateTime.displayName = "DateTime";
