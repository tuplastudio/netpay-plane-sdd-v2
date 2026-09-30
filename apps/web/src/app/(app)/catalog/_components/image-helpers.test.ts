import { describe, expect, it } from "vitest";
import {
  MAX_IMAGE_BYTES,
  checkImageDimensions,
  filesToQueue,
  formatBytes,
  imageAlt,
  inferImageMime,
  isUploading,
  moveItem,
  nextQueued,
  primaryImage,
  queueSummary,
  sortByPosition,
  uploadQueueReducer,
  validateImageFile,
  type UploadItem,
} from "./image-helpers";

const file = (over: Partial<{ name: string; size: number; type: string }> = {}) => ({
  name: "foto.png",
  size: 1024,
  type: "image/png",
  ...over,
});

describe("formatBytes", () => {
  it("elige la unidad y redondea", () => {
    expect(formatBytes(12)).toBe("12 B");
    expect(formatBytes(340 * 1024)).toBe("340 KB");
    expect(formatBytes(1.5 * 1024 * 1024)).toBe("1.5 MB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5 MB");
    expect(formatBytes(12.4 * 1024 * 1024)).toBe("12 MB");
    expect(formatBytes(-1)).toBe("0 B");
  });
});

describe("inferImageMime", () => {
  it("usa el tipo declarado y cae a la extensión si viene vacío", () => {
    expect(inferImageMime(file({ type: "image/jpeg" }))).toBe("image/jpeg");
    expect(inferImageMime(file({ type: "", name: "a.JPG" }))).toBe("image/jpeg");
    expect(inferImageMime(file({ type: "", name: "a.webp" }))).toBe("image/webp");
    expect(inferImageMime(file({ type: "", name: "sin-extension" }))).toBe("");
    expect(inferImageMime(file({ type: "image/png; charset=binary" }))).toBe("image/png");
  });
});

describe("validateImageFile", () => {
  it("acepta PNG, JPG y WebP dentro del peso", () => {
    expect(validateImageFile(file())).toEqual({ ok: true, mime: "image/png" });
    expect(validateImageFile(file({ type: "image/jpeg" })).ok).toBe(true);
    expect(validateImageFile(file({ type: "image/webp", size: MAX_IMAGE_BYTES })).ok).toBe(true);
  });

  it("rechaza vacíos, GIF, SVG, otros formatos y más de 5 MB con mensaje en español", () => {
    expect(validateImageFile(file({ size: 0 }))).toMatchObject({ ok: false, reason: "El archivo está vacío." });
    expect(validateImageFile(file({ type: "image/gif" }))).toMatchObject({ ok: false, reason: /GIF/ });
    expect(validateImageFile(file({ type: "image/svg+xml" }))).toMatchObject({ ok: false, reason: /SVG/ });
    expect(validateImageFile(file({ type: "application/pdf" }))).toMatchObject({
      ok: false,
      reason: "Formato no permitido. Sube un PNG, JPG o WebP.",
    });
    expect(validateImageFile(file({ size: MAX_IMAGE_BYTES + 1 }))).toMatchObject({
      ok: false,
      reason: "La imagen pesa 5 MB; el máximo es 5 MB.",
    });
  });
});

describe("checkImageDimensions", () => {
  it("aplica las cotas 200–6000 px por lado", () => {
    expect(checkImageDimensions(200, 200).ok).toBe(true);
    expect(checkImageDimensions(6000, 300).ok).toBe(true);
    expect(checkImageDimensions(199, 500)).toMatchObject({ ok: false, reason: /mínimo es 200×200/ });
    expect(checkImageDimensions(500, 6001)).toMatchObject({ ok: false, reason: /máximo es 6000×6000/ });
    expect(checkImageDimensions(0, 0)).toMatchObject({ ok: false });
    expect(checkImageDimensions(Number.NaN, 10)).toMatchObject({ ok: false });
  });
});

describe("orden de la galería", () => {
  const imgs = [
    { id: "b", position: 1 },
    { id: "c", position: 2 },
    { id: "a", position: 0 },
  ];

  it("sortByPosition no muta y ordena ascendente", () => {
    expect(sortByPosition(imgs).map((i) => i.id)).toEqual(["a", "b", "c"]);
    expect(imgs[0]!.id).toBe("b");
  });

  it("primaryImage es la de menor posición", () => {
    expect(primaryImage(imgs)?.id).toBe("a");
    expect(primaryImage([])).toBeUndefined();
  });

  it("moveItem mueve y acota los índices", () => {
    expect(moveItem(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
    expect(moveItem(["a", "b", "c"], 0, 5)).toEqual(["b", "c", "a"]);
    expect(moveItem(["a", "b", "c"], 1, -3)).toEqual(["b", "a", "c"]);
    expect(moveItem(["a", "b", "c"], 1, 1)).toEqual(["a", "b", "c"]);
    expect(moveItem(["a", "b", "c"], 7, 0)).toEqual(["a", "b", "c"]);
  });

  it("imageAlt prefiere el altText y cae al título", () => {
    expect(imageAlt({ altText: " Frente " }, "Producto")).toBe("Frente");
    expect(imageAlt({ altText: "   " }, "Producto")).toBe("Producto");
    expect(imageAlt({ altText: null }, "Producto")).toBe("Producto");
    expect(imageAlt({}, "Producto")).toBe("Producto");
  });
});

describe("cola de subida", () => {
  const deps = {
    makeId: (() => {
      let n = 0;
      return () => `id-${++n}`;
    })(),
    makePreview: (f: { name: string }) => `blob:${f.name}`,
  };

  it("filesToQueue valida cada archivo y recorta al tope por lote", () => {
    const files = [
      file({ name: "ok.png" }),
      file({ name: "malo.pdf", type: "application/pdf" }),
      ...Array.from({ length: 10 }, (_, i) => file({ name: `extra-${i}.png` })),
    ];
    const { items, skipped } = filesToQueue(files, deps);
    expect(items).toHaveLength(10);
    expect(skipped).toBe(2);
    expect(items[0]).toMatchObject({ status: "queued", previewUrl: "blob:ok.png", name: "ok.png" });
    expect(items[1]).toMatchObject({ status: "rejected", previewUrl: null, error: /Formato no permitido/ });
  });

  it("el reducer recorre queued → uploading → done / error → retry", () => {
    let state: UploadItem[] = filesToQueue([file({ name: "a.png" }), file({ name: "b.png" })], deps).items;
    const [a, b] = state.map((i) => i.id) as [string, string];
    expect(nextQueued(state)?.id).toBe(a);
    state = uploadQueueReducer(state, { type: "start", id: a });
    expect(isUploading(state)).toBe(true);
    state = uploadQueueReducer(state, { type: "progress", id: a, progress: 250 });
    expect(state[0]!.progress).toBe(100);
    state = uploadQueueReducer(state, { type: "progress", id: a, progress: 33.4 });
    expect(state[0]!.progress).toBe(33);
    state = uploadQueueReducer(state, { type: "done", id: a });
    expect(state[0]).toMatchObject({ status: "done", progress: 100 });
    expect(nextQueued(state)?.id).toBe(b);
    state = uploadQueueReducer(state, { type: "start", id: b });
    state = uploadQueueReducer(state, { type: "fail", id: b, error: "Se cayó" });
    expect(state[1]).toMatchObject({ status: "error", error: "Se cayó" });
    expect(queueSummary(state)).toEqual({ total: 2, done: 1, failed: 1, pending: 0 });
    state = uploadQueueReducer(state, { type: "retry", id: b });
    expect(state[1]).toMatchObject({ status: "queued", progress: 0 });
    expect(state[1]!.error).toBeUndefined();
    state = uploadQueueReducer(state, { type: "clearFinished" });
    expect(state.map((i) => i.id)).toEqual([b]);
    state = uploadQueueReducer(state, { type: "remove", id: b });
    expect(state).toEqual([]);
  });
});
