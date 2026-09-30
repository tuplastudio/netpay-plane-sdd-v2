"use client";
import * as React from "react";
import { toast } from "sonner";
import { AlertCircle, CheckCircle2, ImagePlus, RotateCcw, X } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Tip } from "@/components/app/info-tip";
import { apiErrorMessage } from "../catalog-shared";
import {
  IMAGE_ACCEPT_ATTR,
  MAX_FILES_PER_BATCH,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_SIDE,
  MIN_IMAGE_SIDE,
  checkImageDimensions,
  filesToQueue,
  formatBytes,
  queueSummary,
  uploadQueueReducer,
  type UploadItem,
} from "./image-helpers";

/** Dimensiones reales del archivo decodificándolo en el navegador. */
function readImageDimensions(url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error("No se pudo leer la imagen; el archivo puede estar dañado."));
    img.src = url;
  });
}

function makeId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export interface UploadQueue {
  items: UploadItem[];
  /** Hay una subida en curso. */
  uploading: boolean;
  /** Cuántos archivos válidos esperan turno (útil para "se subirán al guardar"). */
  queuedCount: number;
  addFiles: (files: Iterable<File>) => void;
  remove: (id: string) => void;
  retry: (id: string) => void;
  clearFinished: () => void;
  /** Vacía la cola entera (previews incluidas). */
  reset: () => void;
  /**
   * Sube, de uno en uno, todo lo que esté en espera a `uploadUrl` (multipart,
   * campo `file`). Resuelve con el conteo; nunca lanza.
   */
  uploadAll: (uploadUrl: string) => Promise<{ done: number; failed: number }>;
}

/**
 * Cola de subida de fotos: valida en el navegador (tipo, peso y, ya al
 * subir, dimensiones), previsualiza y sube en serie con progreso por archivo.
 * La subida no arranca sola: quien la usa decide cuándo (`uploadAll`), así
 * sirve tanto para la galería de un producto existente como para el alta,
 * donde las fotos esperan a que el producto tenga id.
 */
export function useImageUploadQueue(opts: {
  /** Se llama una vez al terminar `uploadAll` si al menos una foto subió. */
  onUploaded?: () => Promise<unknown> | void;
} = {}): UploadQueue {
  const [items, dispatch] = React.useReducer(uploadQueueReducer, []);
  const filesRef = React.useRef(new Map<string, File>());
  // Previews por id, aparte del estado: `uploadAll` puede arrancar en el mismo
  // tick que `addFiles`, antes de que el reducer haya re-renderizado.
  const previewsRef = React.useRef(new Map<string, string>());
  const pendingRef = React.useRef<string[]>([]);
  const runningRef = React.useRef(false);
  const [uploading, setUploading] = React.useState(false);
  const onUploadedRef = React.useRef(opts.onUploaded);
  onUploadedRef.current = opts.onUploaded;

  const revoke = (item: UploadItem | undefined) => {
    if (item?.previewUrl) URL.revokeObjectURL(item.previewUrl);
  };

  // Al desmontar se liberan las previews que queden.
  const itemsRef = React.useRef(items);
  itemsRef.current = items;
  React.useEffect(() => {
    const files = filesRef.current;
    return () => {
      for (const it of itemsRef.current) revoke(it);
      files.clear();
    };
  }, []);

  const addFiles = React.useCallback((files: Iterable<File>) => {
    const list = [...files];
    if (list.length === 0) return;
    const { items: next, skipped } = filesToQueue(list, {
      makeId,
      makePreview: (f) => URL.createObjectURL(f as File),
    });
    next.forEach((it, i) => {
      if (it.status === "queued") {
        filesRef.current.set(it.id, list[i]!);
        if (it.previewUrl) previewsRef.current.set(it.id, it.previewUrl);
        pendingRef.current.push(it.id);
      }
    });
    dispatch({ type: "add", items: next });
    if (skipped > 0) {
      toast.warning(`Solo se toman ${MAX_FILES_PER_BATCH} fotos por vez; ${skipped} quedaron fuera.`);
    }
  }, []);

  const remove = React.useCallback((id: string) => {
    revoke(itemsRef.current.find((it) => it.id === id));
    filesRef.current.delete(id);
    previewsRef.current.delete(id);
    pendingRef.current = pendingRef.current.filter((x) => x !== id);
    dispatch({ type: "remove", id });
  }, []);

  const retry = React.useCallback((id: string) => {
    if (!filesRef.current.has(id)) return;
    pendingRef.current.push(id);
    dispatch({ type: "retry", id });
  }, []);

  const clearFinished = React.useCallback(() => {
    for (const it of itemsRef.current) {
      if (it.status === "done") {
        revoke(it);
        filesRef.current.delete(it.id);
        previewsRef.current.delete(it.id);
      }
    }
    dispatch({ type: "clearFinished" });
  }, []);

  const reset = React.useCallback(() => {
    for (const it of itemsRef.current) {
      revoke(it);
      dispatch({ type: "remove", id: it.id });
    }
    filesRef.current.clear();
    previewsRef.current.clear();
    pendingRef.current = [];
  }, []);

  const uploadAll = React.useCallback(async (uploadUrl: string) => {
    if (runningRef.current) return { done: 0, failed: 0 };
    runningRef.current = true;
    setUploading(true);
    let done = 0;
    let failed = 0;
    try {
      for (;;) {
        const id = pendingRef.current.shift();
        if (!id) break;
        const file = filesRef.current.get(id);
        if (!file) continue;
        const previewUrl = previewsRef.current.get(id);
        dispatch({ type: "start", id });
        try {
          if (previewUrl) {
            const dims = await readImageDimensions(previewUrl);
            const check = checkImageDimensions(dims.width, dims.height);
            if (!check.ok) throw new Error(check.reason);
          }
          const body = new FormData();
          body.append("file", file, file.name);
          await api.post(uploadUrl, body, {
            headers: { "content-type": "multipart/form-data" },
            onUploadProgress: (e) => {
              const total = e.total ?? file.size;
              dispatch({ type: "progress", id, progress: total > 0 ? (e.loaded / total) * 100 : 0 });
            },
          });
          dispatch({ type: "done", id });
          done += 1;
        } catch (err) {
          const isHttp = typeof err === "object" && err !== null && "response" in err;
          const message =
            !isHttp && err instanceof Error ? err.message : apiErrorMessage(err, "No se pudo subir la foto.");
          dispatch({ type: "fail", id, error: message });
          failed += 1;
        }
      }
    } finally {
      runningRef.current = false;
      setUploading(false);
    }
    if (done > 0) await onUploadedRef.current?.();
    return { done, failed };
  }, []);

  const queuedCount = items.filter((it) => it.status === "queued").length;

  return { items, uploading, queuedCount, addFiles, remove, retry, clearFinished, reset, uploadAll };
}

/** Texto de ayuda con los límites, en una sola línea. */
export const IMAGE_LIMITS_HINT = `PNG, JPG o WebP · máx. ${formatBytes(MAX_IMAGE_BYTES)} · de ${MIN_IMAGE_SIDE} a ${MAX_IMAGE_SIDE} px por lado`;

/**
 * Zona de arrastre + selector de archivos (múltiple). Es un `<button>` real
 * para teclado y lector; el `<input type=file>` queda oculto.
 */
export function ImageDropzone({
  onFiles,
  disabled = false,
  compact = false,
  className,
  label = "Arrastra fotos aquí o haz clic para elegir",
}: {
  onFiles: (files: File[]) => void;
  disabled?: boolean;
  compact?: boolean;
  className?: string;
  label?: string;
}) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [over, setOver] = React.useState(false);

  const hasFiles = (e: React.DragEvent) => Array.from(e.dataTransfer.types).includes("Files");

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          if (!hasFiles(e) || disabled) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          if (!hasFiles(e) || disabled) return;
          e.preventDefault();
          setOver(false);
          onFiles(Array.from(e.dataTransfer.files));
        }}
        aria-describedby={undefined}
        className={cn(
          "flex w-full flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-input bg-muted text-center text-muted-foreground transition-colors",
          "hover:border-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          "disabled:cursor-not-allowed disabled:opacity-60",
          over && "border-foreground bg-secondary text-foreground",
          compact ? "min-h-16 px-3 py-2" : "min-h-28 px-4 py-5",
          className,
        )}
      >
        <ImagePlus aria-hidden className={compact ? "h-4 w-4" : "h-6 w-6"} />
        <span className={cn("font-medium text-foreground", compact ? "text-xs" : "text-sm")}>{label}</span>
        <span className="text-xs">{IMAGE_LIMITS_HINT}</span>
      </button>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={IMAGE_ACCEPT_ATTR}
        className="hidden"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          const files = e.target.files ? Array.from(e.target.files) : [];
          e.target.value = "";
          if (files.length) onFiles(files);
        }}
      />
    </>
  );
}

/** Estado por archivo: preview, nombre, peso y progreso/estado, con quitar o reintentar. */
export function UploadQueueList({
  queue,
  className,
}: {
  queue: Pick<UploadQueue, "items" | "remove" | "retry" | "clearFinished">;
  className?: string;
}) {
  if (queue.items.length === 0) return null;
  const summary = queueSummary(queue.items);
  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span aria-live="polite">
          {summary.pending > 0
            ? `${summary.pending} en espera`
            : summary.failed > 0
              ? `${summary.done} listas · ${summary.failed} con error`
              : `${summary.done} ${summary.done === 1 ? "lista" : "listas"}`}
        </span>
        {summary.done > 0 ? (
          <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={queue.clearFinished}>
            Ocultar terminadas
          </Button>
        ) : null}
      </div>
      <ul className="divide-y rounded-lg border" aria-label="Fotos por subir">
        {queue.items.map((it) => (
          <li key={it.id} className="flex items-center gap-3 p-2">
            <div className="h-10 w-10 shrink-0 overflow-hidden rounded-md border bg-muted">
              {it.previewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- preview local (blob:)
                <img src={it.previewUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                  <AlertCircle aria-hidden className="h-4 w-4" />
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex items-center gap-2 text-xs">
                <span className="truncate font-medium">{it.name}</span>
                <span className="shrink-0 text-muted-foreground">{formatBytes(it.size)}</span>
              </div>
              {it.status === "uploading" ? (
                <div
                  role="progressbar"
                  aria-label={`Subiendo ${it.name}`}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={it.progress}
                  className="h-1.5 w-full overflow-hidden rounded-pill bg-secondary"
                >
                  <div className="h-full rounded-pill bg-foreground transition-[width]" style={{ width: `${it.progress}%` }} />
                </div>
              ) : it.status === "queued" ? (
                <p className="text-xs text-muted-foreground">En espera</p>
              ) : it.status === "done" ? (
                <p className="flex items-center gap-1 text-xs text-success-foreground">
                  <CheckCircle2 aria-hidden className="h-3.5 w-3.5" />
                  Subida
                </p>
              ) : (
                <p className="flex items-center gap-1 text-xs text-destructive">
                  <AlertCircle aria-hidden className="h-3.5 w-3.5 shrink-0" />
                  <span className="min-w-0">{it.error}</span>
                </p>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-0.5">
              {it.status === "uploading" ? (
                <Spinner size="sm" label={null} />
              ) : (
                <>
                  {it.status === "error" ? (
                    <Tip label="Reintentar">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        aria-label={`Reintentar ${it.name}`}
                        onClick={() => queue.retry(it.id)}
                      >
                        <RotateCcw aria-hidden className="h-3.5 w-3.5" />
                      </Button>
                    </Tip>
                  ) : null}
                  <Tip label="Quitar de la lista">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      aria-label={`Quitar ${it.name}`}
                      onClick={() => queue.remove(it.id)}
                    >
                      <X aria-hidden className="h-3.5 w-3.5" />
                    </Button>
                  </Tip>
                </>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
