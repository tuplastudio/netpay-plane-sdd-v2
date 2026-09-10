// Aritmética decimal segura usando BigInt (escala fija).
// Ver docs/05-prc.md: dinero decimal string con 2 decimales (MXN).
// Nada de float. Verifica AC-PRC-01.

const MONEY_SCALE = 2n;
const QUANTITY_SCALE = 3n;

function toScaled(value: string, scale: bigint): bigint {
  if (!/^\d+(\.\d+)?$/.test(value)) {
    throw new Error(`Invalid decimal string: ${value}`);
  }
  const parts = value.split(".");
  const int = parts[0] ?? "0";
  const frac = parts[1] ?? "";
  const factor = 10n ** scale;
  const padded = (frac + "0".repeat(Number(scale))).slice(0, Number(scale));
  return BigInt(int) * factor + BigInt(padded || "0");
}

function fromScaled(scaled: bigint, scale: bigint): string {
  const factor = 10n ** scale;
  const int = scaled / factor;
  const frac = scaled < 0n ? -scaled % factor : scaled % factor;
  const padded = frac.toString().padStart(Number(scale), "0");
  return `${int.toString()}.${padded}`;
}

/**
 * Redondeo comercial half-up: 0.005 → 0.01, 0.004 → 0.00.
 *
 * `toScaled` recibe una **escala** (número de decimales), no un factor. La
 * versión anterior le pasaba `10 ** decimals`, así que internamente calculaba
 * `10 ** 100` y devolvía un string de cien dígitos para `roundHalfUp("1.005", 2)`.
 */
export function roundHalfUp(value: string, decimals: number): string {
  if (!Number.isInteger(decimals) || decimals < 0) {
    throw new Error(`Invalid decimals: ${decimals}`);
  }
  const scale = BigInt(decimals);
  // Un decimal de más: ese dígito sobrante es el que decide el redondeo.
  const scaled = toScaled(value, scale + 1n);
  const rounded = (scaled + 5n) / 10n;
  if (decimals === 0) return rounded.toString();
  return fromScaled(rounded, scale);
}

/** Suma dos montos (2 decimales). */
export function addMoney(a: string, b: string): string {
  return fromScaled(toScaled(a, MONEY_SCALE) + toScaled(b, MONEY_SCALE), MONEY_SCALE);
}

/** Resta dos montos (2 decimales). Lanza si resultado < 0. */
export function subMoney(a: string, b: string): string {
  const result = toScaled(a, MONEY_SCALE) - toScaled(b, MONEY_SCALE);
  if (result < 0n) {
    throw new Error(`Money underflow: ${a} - ${b}`);
  }
  return fromScaled(result, MONEY_SCALE);
}

/** Multiplica cantidad × precio unitario. Redondeo half-up a escala MXN. */
export function qtyTimesPrice(qty: string, price: string): string {
  const productScaled =
    toScaled(qty, QUANTITY_SCALE) * toScaled(price, MONEY_SCALE);
  // productScaled está en escala (qtyScale + moneyScale) = 5 decimales.
  // Queremos redondear half-up a moneyScale (2 decimales):
  //   divisor = 10^qtyScale, half = divisor / 2.
  const divisor = 10n ** QUANTITY_SCALE;
  const half = divisor / 2n;
  const rounded = (productScaled + half) / divisor;
  return fromScaled(rounded, MONEY_SCALE);
}

/** Aplica un descuento porcentual (0..100) a un subtotal. Redondeo half-up. */
export function applyDiscount(subtotal: string, pct: number): string {
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
    throw new Error(`Discount pct out of range: ${pct}`);
  }
  const scaled = toScaled(subtotal, MONEY_SCALE);
  // factor = pct con 4 decimales extra de precisión (ej. 10.1234% → 101234)
  const factor = BigInt(Math.round(pct * 10000));
  // descuento = subtotal × pct / 100
  //          = scaled × (factor / 10^4) / 100
  //          = scaled × factor / 10^6
  // redondeamos half-up en el límite de los 10^4 decimales extra:
  const half = 1_000_000n / 2n; // media unidad en 10^4 decimales (10^6/2)
  const discountScaled = (scaled * factor + half) / 1_000_000n;
  return fromScaled(scaled - discountScaled, MONEY_SCALE);
}

/** Valida formato de money string (2 decimales). */
export function isMoney(value: string): boolean {
  return /^\d+\.\d{2}$/.test(value);
}

/** Valida formato de quantity string (3 decimales). */
export function isQuantity(value: string): boolean {
  return /^\d+\.\d{3}$/.test(value);
}