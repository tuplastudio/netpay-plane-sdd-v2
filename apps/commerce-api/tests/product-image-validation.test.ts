import { BadRequestException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import {
  MAX_PRODUCT_IMAGE_BYTES,
  MAX_PRODUCT_IMAGE_SIDE,
  MIN_PRODUCT_IMAGE_SIDE,
  validateProductImage,
} from "../src/catalog/product-image-validation.js";

/**
 * Reglas de las fotos de catálogo (producto y variante): mismo chequeo de
 * bytes reales que el logo del tenant, pero sin exigir proporción y sin SVG
 * (ver product-image-validation.ts).
 */

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  return Buffer.concat([len, Buffer.from(type, "latin1"), data, Buffer.alloc(4)]);
}

function png(width: number, height: number, opts: { animated?: boolean } = {}): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  const parts = [
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
  ];
  if (opts.animated) parts.push(pngChunk("acTL", Buffer.alloc(8)));
  parts.push(pngChunk("IDAT", Buffer.from([0, 1, 2])), pngChunk("IEND", Buffer.alloc(0)));
  return Buffer.concat(parts);
}

function jpeg(width: number, height: number): Buffer {
  const app0 = Buffer.from([
    0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0,
  ]);
  const sof = Buffer.alloc(2 + 2 + 5 + 3);
  sof[0] = 0xff;
  sof[1] = 0xc0;
  sof.writeUInt16BE(sof.length - 2, 2);
  sof[4] = 8;
  sof.writeUInt16BE(height, 5);
  sof.writeUInt16BE(width, 7);
  sof[9] = 1;
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    app0,
    sof,
    Buffer.from([0xff, 0xda, 0, 2]),
    Buffer.from([0xff, 0xd9]),
  ]);
}

function webpVp8x(width: number, height: number, opts: { animated?: boolean } = {}): Buffer {
  const buf = Buffer.alloc(30);
  buf.write("RIFF", 0, "latin1");
  buf.writeUInt32LE(22, 4);
  buf.write("WEBP", 8, "latin1");
  buf.write("VP8X", 12, "latin1");
  buf.writeUInt32LE(10, 16);
  buf[20] = opts.animated ? 0x02 : 0x00;
  buf.writeUIntLE(width - 1, 24, 3);
  buf.writeUIntLE(height - 1, 27, 3);
  return buf;
}

function svg(): Buffer {
  return Buffer.from('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><rect/></svg>');
}

function messageOf(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(BadRequestException);
    const res = (err as BadRequestException).getResponse() as { code: string; message: string };
    expect(res.code).toBe("VALIDATION_FAILED");
    return res.message;
  }
  throw new Error("se esperaba un rechazo");
}

describe("validateProductImage", () => {
  it("acepta PNG/JPEG/WebP válidos, cualquier proporción, y deduce ext/mime de los bytes", () => {
    expect(validateProductImage(png(1200, 1200))).toMatchObject({
      format: "png",
      ext: "png",
      mime: "image/png",
      width: 1200,
      height: 1200,
    });
    expect(validateProductImage(jpeg(2000, 300))).toMatchObject({ format: "jpeg", ext: "jpg", width: 2000, height: 300 });
    expect(validateProductImage(webpVp8x(300, 2000))).toMatchObject({ format: "webp", ext: "webp", width: 300, height: 2000 });
  });

  it("no confía en el mimetype declarado", () => {
    const exe = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);
    expect(messageOf(() => validateProductImage(exe, "image/png"))).toMatch(/dice ser image\/png/);
  });

  it("rechaza SVG, GIF, vacío y formatos desconocidos", () => {
    expect(messageOf(() => validateProductImage(svg()))).toMatch(/SVG no está permitido/);
    expect(messageOf(() => validateProductImage(Buffer.from("GIF89a....")))).toMatch(/GIF/);
    expect(messageOf(() => validateProductImage(Buffer.alloc(0)))).toMatch(/vacío/);
    expect(messageOf(() => validateProductImage(Buffer.from("%PDF-1.4")))).toMatch(/Formato no permitido/);
  });

  it(`rechaza más de ${MAX_PRODUCT_IMAGE_BYTES / (1024 * 1024)} MB`, () => {
    const big = Buffer.concat([png(1200, 1200), Buffer.alloc(MAX_PRODUCT_IMAGE_BYTES)]);
    expect(messageOf(() => validateProductImage(big))).toMatch(/máximo es 5 MB/);
  });

  it(`exige mínimo ${MIN_PRODUCT_IMAGE_SIDE}×${MIN_PRODUCT_IMAGE_SIDE} y máximo ${MAX_PRODUCT_IMAGE_SIDE}×${MAX_PRODUCT_IMAGE_SIDE}`, () => {
    expect(messageOf(() => validateProductImage(png(199, 500)))).toMatch(/mínimo es 200×200/);
    expect(messageOf(() => validateProductImage(jpeg(7000, 3000)))).toMatch(/máximo es 6000×6000/);
    expect(validateProductImage(png(6000, 6000)).width).toBe(6000);
  });

  it("rechaza APNG y WebP animado", () => {
    expect(messageOf(() => validateProductImage(png(300, 300, { animated: true })))).toMatch(/animad/);
    expect(messageOf(() => validateProductImage(webpVp8x(300, 300, { animated: true })))).toMatch(/animad/);
  });

  it("rechaza encabezados truncados o dañados", () => {
    expect(messageOf(() => validateProductImage(Buffer.from([0xff, 0xd8, 0xff, 0xd9])))).toMatch(/dañado/);
  });
});
