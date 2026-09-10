/**
 * Aritmética exacta para los importes del dashboard.
 *
 * El backend guarda dinero como `Decimal(12,2)` y lo serializa como string
 * ("1234.50"). Sumar esos strings con `Number(a) + Number(b)` acumula error de
 * punto flotante (0.1 + 0.2 = 0.30000000000000004) y en una pantalla de
 * resumen eso se ve como un centavo que aparece y desaparece.
 *
 * Aquí se convierte cada importe a **centavos enteros** y se suma en enteros.
 * Un `Decimal(12,2)` cabe en 999_999_999_999 centavos, muy por debajo de
 * `Number.MAX_SAFE_INTEGER` (9e15), así que la suma es exacta.
 *
 * Si un solo importe no se puede leer, `sumCents` devuelve `null`: preferimos
 * no enseñar cifra a enseñar una equivocada.
 */

const DECIMAL_RE = /^-?\d{1,12}(\.\d{1,2})?$/;

/** "1234.50" → 123450. Devuelve `null` si el string no es un decimal válido. */
export function toCents(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const raw = typeof value === "number" ? String(value) : value.trim();
  if (!DECIMAL_RE.test(raw)) return null;
  const negative = raw.startsWith("-");
  const [intPart = "0", fracPart = ""] = raw.replace("-", "").split(".");
  const cents = Number(intPart) * 100 + Number((fracPart + "00").slice(0, 2));
  return negative ? -cents : cents;
}

/**
 * Suma exacta. `null` en cuanto un elemento no se pueda parsear, para que quien
 * consuma el resultado pueda decidir enseñar un conteo en vez de un importe.
 */
export function sumCents(values: Array<string | number | null | undefined>): number | null {
  let total = 0;
  for (const v of values) {
    const cents = toCents(v);
    if (cents === null) return null;
    total += cents;
  }
  return total;
}

/**
 * 123450 → "1234.50". Se arma con enteros (sin dividir entre 100 en flotante)
 * para que `Money` reciba exactamente lo mismo que mandaría el API.
 */
export function centsToDecimalString(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const integer = Math.floor(abs / 100);
  const fraction = abs % 100;
  return `${negative ? "-" : ""}${integer}.${String(fraction).padStart(2, "0")}`;
}

/** Suma una lista de importes y la devuelve lista para `<Money value=…>`. */
export function sumMoney(values: Array<string | number | null | undefined>): string | null {
  const cents = sumCents(values);
  return cents === null ? null : centsToDecimalString(cents);
}
