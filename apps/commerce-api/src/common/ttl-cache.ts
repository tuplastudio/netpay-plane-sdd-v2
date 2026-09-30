/**
 * Caché en memoria con TTL para lookups calientes del proceso (sesión
 * resuelta, verificación de API key, etc.). Ver docs/perf/2026-09-29-performance.md.
 *
 * Reglas de diseño:
 *  - Expira por entrada (`ttlMs`), con lectura perezosa: una entrada vencida
 *    se descarta al leerla, no hace falta un timer.
 *  - Tope de tamaño (`maxEntries`): al rebasarlo se expulsa la entrada más
 *    antigua (orden de inserción del `Map`). Así una avalancha de claves
 *    únicas (tokens inválidos, p. ej.) no crece sin límite.
 *  - `getOrLoad` deduplica cargas concurrentes de la misma clave
 *    (single-flight): cinco peticiones paralelas del mismo navegador al
 *    abrir una pantalla resuelven la sesión UNA vez.
 *
 * Es por proceso: con varias réplicas del API cada una tiene la suya. Por eso
 * los TTL son cortos y las escrituras invalidan (ver `PrismaService.onWrite`).
 */
export interface TtlCacheOptions {
  /** Vida de cada entrada, en ms. */
  ttlMs: number;
  /** Máximo de entradas vivas; por defecto 10 000. */
  maxEntries?: number;
  /** Reloj inyectable (tests). */
  now?: () => number;
}

interface Entry<V> {
  value: V;
  expiresAt: number;
}

export class TtlCache<K, V> {
  private readonly entries = new Map<K, Entry<V>>();
  private readonly inflight = new Map<K, Promise<V | undefined>>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly now: () => number;

  constructor(opts: TtlCacheOptions) {
    if (!(opts.ttlMs > 0)) throw new Error("TtlCache: ttlMs debe ser > 0");
    this.ttlMs = opts.ttlMs;
    this.maxEntries = opts.maxEntries ?? 10_000;
    this.now = opts.now ?? Date.now;
  }

  get size(): number {
    return this.entries.size;
  }

  get(key: K): V | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  has(key: K): boolean {
    return this.get(key) !== undefined;
  }

  set(key: K, value: V, ttlMs = this.ttlMs): void {
    // Reinsertar mueve la clave al final del Map: la más reciente sobrevive.
    this.entries.delete(key);
    this.entries.set(key, { value, expiresAt: this.now() + ttlMs });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
    }
  }

  delete(key: K): boolean {
    return this.entries.delete(key);
  }

  /** Borra las entradas que cumplan el predicado. Devuelve cuántas quitó. */
  deleteWhere(predicate: (key: K, value: V) => boolean): number {
    let removed = 0;
    for (const [key, entry] of this.entries) {
      if (predicate(key, entry.value)) {
        this.entries.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  clear(): void {
    this.entries.clear();
  }

  /** Quita las entradas vencidas (higiene periódica; `get` ya lo hace por clave). */
  sweep(): number {
    const now = this.now();
    let removed = 0;
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) {
        this.entries.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  /**
   * Devuelve el valor cacheado o lo carga con `loader`, guardándolo si no es
   * `undefined` (un resultado negativo NO se cachea: no queremos que un token
   * recién emitido se vea como inválido durante el TTL). Cargas concurrentes
   * de la misma clave comparten la misma promesa.
   */
  async getOrLoad(
    key: K,
    loader: () => Promise<V | undefined>,
    ttlMs?: number,
  ): Promise<V | undefined> {
    const hit = this.get(key);
    if (hit !== undefined) return hit;
    const pending = this.inflight.get(key);
    if (pending) return pending;
    const promise = loader()
      .then((value) => {
        if (value !== undefined) this.set(key, value, ttlMs);
        return value;
      })
      .finally(() => {
        this.inflight.delete(key);
      });
    this.inflight.set(key, promise);
    return promise;
  }
}
