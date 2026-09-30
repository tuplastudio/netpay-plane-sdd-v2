/**
 * Lógica pura de las fotos de catálogo: límites (espejo de
 * `apps/commerce-api/src/catalog/product-image-validation.ts`), validación
 * previa en el navegador, orden de la galería y la cola de subida. Sin DOM ni
 * React para que se pueda probar con vitest.
 */

// --- Límites (mantener en sync con product-image-validation.ts) -------------

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MIN_IMAGE_SIDE = 200;
export const MAX_IMAGE_SIDE = 6000;
export const ACCEPTED_IMAGE_MIMES = ["image/png", "image/jpeg", "image/webp"] as const;
/** Valor del atributo `accept` del input de archivos. */
export const IMAGE_ACCEPT_ATTR = ACCEPTED_IMAGE_MIMES.join(",");
/** Tope de archivos por arrastre/selección para no disparar decenas de requests. */
export const MAX_FILES_PER_BATCH = 10;
/** Largo máximo del texto alternativo (mismo que `UpdateImageDto`). */
export const MAX_ALT_TEXT_LENGTH = 200;

export type AcceptedImageMime = (typeof ACCEPTED_IMAGE_MIMES)[number];

const MIME_BY_EXT: Record<string, AcceptedImageMime> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

/** Lo mínimo de `File` que necesita la validación (para poder probar sin DOM). */
export interface FileLike {
  name: string;
  size: number;
  type: string;
}

export type FileCheck = { ok: true; mime: AcceptedImageMime } | { ok: false; reason: string };

/** "1.5 MB", "340 KB", "12 B". Sin `toLocaleString`: el formato es fijo. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(mb >= 10 ? 0 : 1).replace(/\.0$/, "")} MB`;
}

/**
 * Tipo MIME efectivo: el que declara el navegador y, si viene vacío (pasa al
 * arrastrar desde algunos gestores de archivos), el que sugiere la extensión.
 */
export function inferImageMime(file: FileLike): string {
  const declared = file.type.toLowerCase().split(";")[0]?.trim() ?? "";
  if (declared) return declared;
  const ext = file.name.toLowerCase().split(".").pop() ?? "";
  return MIME_BY_EXT[ext] ?? "";
}

/**
 * Chequeo previo a subir: tipo y peso. Las dimensiones se validan aparte
 * (`checkImageDimensions`) porque exigen decodificar la imagen. Los mensajes
 * repiten los del backend para que el usuario vea lo mismo antes y después.
 */
export function validateImageFile(file: FileLike): FileCheck {
  if (file.size <= 0) return { ok: false, reason: "El archivo está vacío." };
  const mime = inferImageMime(file);
  if (mime === "image/gif") {
    return { ok: false, reason: "Los GIF no están permitidos: usa PNG, JPG o WebP." };
  }
  if (mime === "image/svg+xml") {
    return { ok: false, reason: "SVG no está permitido para fotos de producto: usa PNG, JPG o WebP." };
  }
  if (!(ACCEPTED_IMAGE_MIMES as readonly string[]).includes(mime)) {
    return { ok: false, reason: "Formato no permitido. Sube un PNG, JPG o WebP." };
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return {
      ok: false,
      reason: `La imagen pesa ${formatBytes(file.size)}; el máximo es ${formatBytes(MAX_IMAGE_BYTES)}.`,
    };
  }
  return { ok: true, mime: mime as AcceptedImageMime };
}

/** Mismas cotas de píxeles que el backend (200–6000 por lado). */
export function checkImageDimensions(width: number, height: number): FileCheck {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return { ok: false, reason: "No se pudieron leer las dimensiones de la imagen." };
  }
  if (width < MIN_IMAGE_SIDE || height < MIN_IMAGE_SIDE) {
    return {
      ok: false,
      reason: `La imagen mide ${width}×${height} px; el mínimo es ${MIN_IMAGE_SIDE}×${MIN_IMAGE_SIDE} px.`,
    };
  }
  if (width > MAX_IMAGE_SIDE || height > MAX_IMAGE_SIDE) {
    return {
      ok: false,
      reason: `La imagen mide ${width}×${height} px; el máximo es ${MAX_IMAGE_SIDE}×${MAX_IMAGE_SIDE} px.`,
    };
  }
  return { ok: true, mime: "image/png" };
}

// --- Orden de la galería ----------------------------------------------------

/** Copia de la lista con el elemento `from` movido a `to` (índices acotados). */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const out = [...list];
  if (from < 0 || from >= out.length) return out;
  const target = Math.max(0, Math.min(out.length - 1, to));
  if (from === target) return out;
  const [item] = out.splice(from, 1);
  out.splice(target, 0, item as T);
  return out;
}

export function sortByPosition<T extends { position: number }>(images: readonly T[]): T[] {
  return [...images].sort((a, b) => a.position - b.position);
}

/** Portada de la galería: la de menor `position` (el backend garantiza 0). */
export function primaryImage<T extends { position: number }>(images: readonly T[]): T | undefined {
  return sortByPosition(images)[0];
}

/** `alt` de una foto: su texto alternativo o, si no tiene, el título del producto. */
export function imageAlt(image: { altText?: string | null }, fallback: string): string {
  const alt = image.altText?.trim();
  return alt ? alt : fallback;
}

// --- Cola de subida ---------------------------------------------------------

export type UploadStatus = "rejected" | "queued" | "uploading" | "done" | "error";

export interface UploadItem {
  /** Id local (no es el id de la foto en el backend). */
  id: string;
  name: string;
  size: number;
  /** `URL.createObjectURL` para la previsualización; null si se rechazó. */
  previewUrl: string | null;
  status: UploadStatus;
  /** 0–100 mientras sube. */
  progress: number;
  error?: string;
}

export type UploadAction =
  | { type: "add"; items: UploadItem[] }
  | { type: "start"; id: string }
  | { type: "progress"; id: string; progress: number }
  | { type: "done"; id: string }
  | { type: "fail"; id: string; error: string }
  | { type: "retry"; id: string }
  | { type: "remove"; id: string }
  | { type: "clearFinished" };

function patch(state: UploadItem[], id: string, changes: Partial<UploadItem>): UploadItem[] {
  return state.map((it) => (it.id === id ? { ...it, ...changes } : it));
}

/** Reducer de la cola: puro, sin efectos. La subida real la dispara el componente. */
export function uploadQueueReducer(state: UploadItem[], action: UploadAction): UploadItem[] {
  switch (action.type) {
    case "add":
      return [...state, ...action.items];
    case "start":
      return patch(state, action.id, { status: "uploading", progress: 0, error: undefined });
    case "progress":
      return patch(state, action.id, {
        progress: Math.max(0, Math.min(100, Math.round(action.progress))),
      });
    case "done":
      return patch(state, action.id, { status: "done", progress: 100 });
    case "fail":
      return patch(state, action.id, { status: "error", error: action.error });
    case "retry":
      return patch(state, action.id, { status: "queued", progress: 0, error: undefined });
    case "remove":
      return state.filter((it) => it.id !== action.id);
    case "clearFinished":
      return state.filter((it) => it.status !== "done");
    default:
      return state;
  }
}

/** Siguiente archivo por subir (se sube de uno en uno, en orden de llegada). */
export function nextQueued(state: readonly UploadItem[]): UploadItem | undefined {
  return state.find((it) => it.status === "queued");
}

export function isUploading(state: readonly UploadItem[]): boolean {
  return state.some((it) => it.status === "uploading");
}

export interface QueueSummary {
  total: number;
  done: number;
  failed: number;
  pending: number;
}

export function queueSummary(state: readonly UploadItem[]): QueueSummary {
  const summary: QueueSummary = { total: 0, done: 0, failed: 0, pending: 0 };
  for (const it of state) {
    summary.total += 1;
    if (it.status === "done") summary.done += 1;
    else if (it.status === "error" || it.status === "rejected") summary.failed += 1;
    else summary.pending += 1;
  }
  return summary;
}

/**
 * Convierte los archivos elegidos en elementos de la cola: valida cada uno
 * (los inválidos entran como `rejected` con su motivo, para que el usuario
 * vea qué pasó) y recorta al tope por lote. `makeId`/`makePreview` se inyectan
 * para poder probar sin `crypto`/`URL` del navegador.
 */
export function filesToQueue(
  files: readonly FileLike[],
  deps: { makeId: () => string; makePreview: (file: FileLike) => string | null },
): { items: UploadItem[]; skipped: number } {
  const accepted = files.slice(0, MAX_FILES_PER_BATCH);
  const items = accepted.map<UploadItem>((file) => {
    const check = validateImageFile(file);
    return {
      id: deps.makeId(),
      name: file.name,
      size: file.size,
      previewUrl: check.ok ? deps.makePreview(file) : null,
      status: check.ok ? "queued" : "rejected",
      progress: 0,
      error: check.ok ? undefined : check.reason,
    };
  });
  return { items, skipped: files.length - accepted.length };
}
