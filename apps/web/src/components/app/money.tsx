import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Los importes viajan como `string` decimal ("1234.50") porque en el backend son
 * `Decimal(12,2)` y convertirlos a `number` en el borde perdería precisión en
 * los extremos. Aceptamos también `number` por comodidad y `null` para "sin dato".
 */
export type MoneyValue = string | number | null | undefined;

/** Moneda por defecto y red de seguridad. Hoy el sistema solo opera en MXN. */
export const DEFAULT_CURRENCY = "MXN";

/** ISO 4217 son exactamente tres letras. Filtro barato antes de tocar Intl. */
const CURRENCY_RE = /^[A-Za-z]{3}$/;

const formatterCache = new Map<string, Intl.NumberFormat>();
/** Códigos que ya sabemos que Intl rechaza; evita repetir el try/catch por fila. */
const rejectedCurrencies = new Set<string>();

function makeFormatter(code: string): Intl.NumberFormat | null {
  try {
    return new Intl.NumberFormat("es-MX", {
      style: "currency",
      currency: code,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  } catch {
    // `Intl.NumberFormat` lanza RangeError con cualquier código que no sea
    // ISO 4217 válido. Un solo registro con basura en `currency` no puede
    // tumbar la pantalla de pagos completa.
    return null;
  }
}

/**
 * Código de moneda efectivo: el que se pidió si Intl lo acepta, `MXN` si no.
 * Exportado para que la UI pueda etiquetar el importe con lo que realmente se
 * usó al formatear, y no con el valor corrupto que venía del API.
 */
export function resolveCurrency(currency: string | null | undefined): string {
  if (typeof currency !== "string" || !CURRENCY_RE.test(currency)) return DEFAULT_CURRENCY;
  const code = currency.toUpperCase();
  if (code === DEFAULT_CURRENCY) return DEFAULT_CURRENCY;
  if (rejectedCurrencies.has(code)) return DEFAULT_CURRENCY;
  if (formatterCache.has(code)) return code;
  const f = makeFormatter(code);
  if (!f) {
    rejectedCurrencies.add(code);
    return DEFAULT_CURRENCY;
  }
  formatterCache.set(code, f);
  return code;
}

function formatter(currency: string | null | undefined): Intl.NumberFormat {
  const code = resolveCurrency(currency);
  let f = formatterCache.get(code);
  if (!f) {
    // `code` ya está validado; si aun así falla (ICU recortado en el runtime)
    // caemos a un formato decimal simple antes que dejar de pintar el importe.
    f =
      makeFormatter(code) ??
      new Intl.NumberFormat("es-MX", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
    formatterCache.set(code, f);
  }
  return f;
}

/**
 * Formatea un importe en es-MX. Nunca lanza y nunca pinta "NaN", "$undefined"
 * ni "Invalid currency": si no hay dato devuelve em dash, y si el código de
 * moneda es inválido formatea en `MXN` (el importe siempre se ve).
 *
 * @example formatMoney("1234.5")          // "$1,234.50"
 * @example formatMoney("-80", "MXN")      // "-$80.00"
 * @example formatMoney("50", "XX!")       // "$50.00"  (cae a MXN, no revienta)
 * @example formatMoney(null)              // "—"
 */
export function formatMoney(value: MoneyValue, currency: string | null | undefined = DEFAULT_CURRENCY): string {
  if (value === null || value === undefined || value === "") return "—";
  const amount = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(amount)) return "—";
  return formatter(currency).format(amount as number);
}

export interface MoneyProps extends Omit<React.HTMLAttributes<HTMLSpanElement>, "children"> {
  value: MoneyValue;
  /**
   * ISO 4217. Por defecto MXN, la única moneda del sistema hoy.
   * Un código inválido no rompe: se formatea en MXN y se etiqueta como MXN.
   */
  currency?: string | null;
  /** Agrega el código de moneda después del importe ("$1,234.50 MXN"). */
  showCurrency?: boolean;
  /** Resalta el importe (totales, renglón final de una tabla). */
  emphasis?: boolean;
}

/**
 * Importe con cifras tabulares (alinean en columna) y negativos en rojo.
 * Úsalo en vez de `` `$${o.total}` ``.
 *
 * @example
 * <TableCell numeric><Money value={order.total} /></TableCell>
 * <Money value={order.total} emphasis showCurrency />
 */
export const Money = React.forwardRef<HTMLSpanElement, MoneyProps>(
  (
    { className, value, currency = DEFAULT_CURRENCY, showCurrency = false, emphasis = false, ...props },
    ref,
  ) => {
    const amount = typeof value === "string" ? Number(value) : value;
    const negative = typeof amount === "number" && Number.isFinite(amount) && amount < 0;
    const text = formatMoney(value, currency);
    // Etiquetamos con la moneda REAL del formateo, no con la que pidió el
    // llamador: si venía corrupta, decir "XX!" junto a un importe en pesos
    // sería mentir sobre el dato.
    const effectiveCurrency = resolveCurrency(currency);
    return (
      <span
        ref={ref}
        className={cn(
          "tabular-nums",
          emphasis && "font-semibold",
          negative && "text-destructive",
          className,
        )}
        {...props}
      >
        {text}
        {showCurrency && text !== "—" ? (
          <span className="ml-1 text-xs text-muted-foreground">{effectiveCurrency}</span>
        ) : null}
      </span>
    );
  },
);
Money.displayName = "Money";
