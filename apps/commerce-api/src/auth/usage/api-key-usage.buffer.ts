/**
 * Buffer en memoria para la bitácora de uso de API keys.
 *
 * La petición nunca espera a la base: `push()` encola y regresa. El vaciado
 * ocurre por tamaño (`maxSize`), por tiempo (`flushIntervalMs`) o a mano
 * (`flush()`, que también usa el shutdown). Un fallo al escribir descarta el
 * lote y se reporta por `onError`: es telemetría, no puede tumbar ni
 * retrasar el tráfico.
 *
 * Sin dependencias de Nest ni Prisma para poder probarlo con relojes falsos.
 */

export interface ApiKeyUsageEntry {
  tenantId: string | null;
  apiKeyId: string;
  occurredAt: Date;
  method: string;
  path: string;
  statusCode: number;
  durationMs: number;
  ip: string | null;
  userAgent: string | null;
  scopeUsed: string | null;
  errorCode: string | null;
}

export interface ApiKeyUsageBufferOptions {
  /** Tamaño a partir del cual se vacía sin esperar al temporizador. */
  maxSize?: number;
  /** Cada cuánto se vacía aunque no se haya llenado. */
  flushIntervalMs?: number;
  /** Tope duro: si la base está caída, no se acumula memoria sin límite. */
  maxPending?: number;
  onError?: (error: unknown, dropped: number) => void;
}

export const DEFAULT_USAGE_BUFFER_OPTIONS = {
  maxSize: 100,
  flushIntervalMs: 5_000,
  maxPending: 10_000,
} as const;

export type ApiKeyUsageWriter = (entries: ApiKeyUsageEntry[]) => Promise<void>;

export class ApiKeyUsageBuffer {
  private pending: ApiKeyUsageEntry[] = [];
  private timer: NodeJS.Timeout | null = null;
  private inflight: Promise<void> | null = null;
  private stopped = false;
  private readonly maxSize: number;
  private readonly flushIntervalMs: number;
  private readonly maxPending: number;
  private readonly onError: (error: unknown, dropped: number) => void;

  constructor(
    private readonly writer: ApiKeyUsageWriter,
    options: ApiKeyUsageBufferOptions = {},
  ) {
    this.maxSize = options.maxSize ?? DEFAULT_USAGE_BUFFER_OPTIONS.maxSize;
    this.flushIntervalMs = options.flushIntervalMs ?? DEFAULT_USAGE_BUFFER_OPTIONS.flushIntervalMs;
    this.maxPending = options.maxPending ?? DEFAULT_USAGE_BUFFER_OPTIONS.maxPending;
    this.onError = options.onError ?? (() => undefined);
  }

  /** Registros esperando escritura (no incluye el lote en vuelo). */
  get size(): number {
    return this.pending.length;
  }

  push(entry: ApiKeyUsageEntry): void {
    if (this.stopped) return;
    if (this.pending.length >= this.maxPending) {
      // Se descarta el más viejo: ante una base caída, lo reciente vale más.
      this.pending.shift();
    }
    this.pending.push(entry);
    if (this.pending.length >= this.maxSize) {
      void this.flush();
      return;
    }
    this.arm();
  }

  /**
   * Escribe todo lo pendiente. Serializa los vaciados: si uno está en vuelo,
   * el siguiente espera a que termine para no reordenar ni duplicar lotes.
   */
  async flush(): Promise<void> {
    this.disarm();
    if (this.inflight) await this.inflight;
    if (this.pending.length === 0) return;
    const batch = this.pending;
    this.pending = [];
    this.inflight = this.writer(batch)
      .catch((error: unknown) => this.onError(error, batch.length))
      .finally(() => {
        this.inflight = null;
      });
    await this.inflight;
  }

  /** Vacía lo pendiente y deja de aceptar registros (shutdown). */
  async stop(): Promise<void> {
    this.stopped = true;
    await this.flush();
  }

  private arm(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, this.flushIntervalMs);
    // No mantiene vivo el proceso: el shutdown ya vacía a mano.
    this.timer.unref?.();
  }

  private disarm(): void {
    if (!this.timer) return;
    clearTimeout(this.timer);
    this.timer = null;
  }
}

/**
 * Throttle de `lastUsedAt` por key: devuelve `true` a lo sumo una vez por
 * ventana para cada id, para no actualizar la fila de la key en cada request.
 */
export class LastUsedThrottle {
  private readonly seen = new Map<string, number>();

  constructor(
    private readonly windowMs = 60_000,
    private readonly maxEntries = 10_000,
  ) {}

  shouldTouch(apiKeyId: string, nowMs = Date.now()): boolean {
    const last = this.seen.get(apiKeyId);
    if (last !== undefined && nowMs - last < this.windowMs) return false;
    if (this.seen.size >= this.maxEntries && !this.seen.has(apiKeyId)) {
      // Mapa acotado: se desecha la entrada más vieja (orden de inserción).
      const oldest = this.seen.keys().next().value;
      if (oldest !== undefined) this.seen.delete(oldest);
    }
    this.seen.delete(apiKeyId);
    this.seen.set(apiKeyId, nowMs);
    return true;
  }
}
