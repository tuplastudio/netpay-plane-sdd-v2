import { BadRequestException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import {
  MAX_LOGO_BYTES,
  parseJpeg,
  parsePng,
  parseWebp,
  validateLogo,
} from "../src/tenants/logo-validation.js";
import { keyFromPublicUrl } from "../src/tenants/logo-storage.js";

/**
 * Reglas del logo de la empresa: formato por magic bytes (no por el mimetype
 * declarado), dimensiones leídas del encabezado, sin animación, proporción
 * acotada, y SVG sin scripts/eventos/foreignObject/recursos externos. Todo
 * rechazo llega como `VALIDATION_FAILED` con mensaje en español.
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

function webpLossless(width: number, height: number): Buffer {
  const buf = Buffer.alloc(30);
  buf.write("RIFF", 0, "latin1");
  buf.write("WEBP", 8, "latin1");
  buf.write("VP8L", 12, "latin1");
  buf[20] = 0x2f;
  buf.writeUInt32LE(((height - 1) << 14) | (width - 1), 21);
  return buf;
}

function svg(body: string, attrs = 'width="200" height="100"'): Buffer {
  return Buffer.from(
    `<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" ${attrs}>${body}</svg>`,
    "utf8",
  );
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

describe("validateLogo · formato por magic bytes", () => {
  it("acepta PNG/JPEG/WebP/SVG válidos y deduce ext/mime de los bytes", () => {
    expect(validateLogo(png(256, 256))).toMatchObject({
      format: "png",
      ext: "png",
      mime: "image/png",
      width: 256,
      height: 256,
    });
    expect(validateLogo(jpeg(300, 150))).toMatchObject({ format: "jpeg", ext: "jpg", width: 300, height: 150 });
    expect(validateLogo(webpVp8x(400, 200))).toMatchObject({ format: "webp", ext: "webp", width: 400, height: 200 });
    expect(validateLogo(webpLossless(128, 128))).toMatchObject({ format: "webp", width: 128, height: 128 });
    expect(validateLogo(svg("<rect/>"))).toMatchObject({
      format: "svg",
      ext: "svg",
      mime: "image/svg+xml",
      width: 200,
      height: 100,
    });
  });

  it("no confía en el mimetype declarado", () => {
    // Un ejecutable renombrado a .png con Content-Type image/png.
    const exe = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);
    expect(messageOf(() => validateLogo(exe, "image/png"))).toMatch(/dice ser image\/png/);
    // Un JPEG declarado como PNG se acepta como lo que realmente es.
    expect(validateLogo(jpeg(200, 200), "image/png").ext).toBe("jpg");
  });

  it("rechaza GIF, vacío y formatos desconocidos con mensaje claro", () => {
    expect(messageOf(() => validateLogo(Buffer.from("GIF89a....")))).toMatch(/GIF/);
    expect(messageOf(() => validateLogo(Buffer.alloc(0)))).toMatch(/vacío/);
    expect(messageOf(() => validateLogo(Buffer.from("%PDF-1.4")))).toMatch(/Formato no permitido/);
  });

  it("rechaza más de 2 MB", () => {
    const big = Buffer.concat([png(256, 256), Buffer.alloc(MAX_LOGO_BYTES)]);
    expect(messageOf(() => validateLogo(big))).toMatch(/máximo es 2 MB/);
  });
});

describe("validateLogo · dimensiones y proporción", () => {
  it("exige mínimo 128×128 y máximo 4096×4096 en raster", () => {
    expect(messageOf(() => validateLogo(png(127, 200)))).toMatch(/mínimo es 128×128/);
    expect(messageOf(() => validateLogo(jpeg(5000, 2000)))).toMatch(/máximo es 4096×4096/);
    expect(validateLogo(png(4096, 4096)).width).toBe(4096);
  });

  it("acota la proporción entre 1:3 y 3:1", () => {
    expect(messageOf(() => validateLogo(png(1000, 300)))).toMatch(/proporción/);
    expect(messageOf(() => validateLogo(png(300, 1000)))).toMatch(/proporción/);
    expect(validateLogo(png(900, 300)).width).toBe(900);
  });

  it("rechaza APNG y WebP animado", () => {
    expect(messageOf(() => validateLogo(png(256, 256, { animated: true })))).toMatch(/animad/);
    expect(messageOf(() => validateLogo(webpVp8x(256, 256, { animated: true })))).toMatch(/animad/);
  });

  it("rechaza encabezados truncados o dañados", () => {
    expect(messageOf(() => validateLogo(Buffer.from([0xff, 0xd8, 0xff, 0xd9])))).toMatch(/dañado/);
    expect(parsePng(Buffer.from([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
    expect(parseJpeg(Buffer.from([0xff, 0xd8]))).toBeNull();
    expect(parseWebp(Buffer.from("RIFF....WEBPXXXX"))).toBeNull();
  });
});

describe("validateLogo · SVG saneado", () => {
  it("rechaza scripts, handlers, foreignObject y hrefs externos", () => {
    expect(messageOf(() => validateLogo(svg("<script>alert(1)</script>")))).toMatch(/script/);
    expect(messageOf(() => validateLogo(svg('<rect onload="x()"/>')))).toMatch(/eventos/);
    expect(messageOf(() => validateLogo(svg("<foreignObject><div/></foreignObject>")))).toMatch(
      /foreignObject/,
    );
    expect(messageOf(() => validateLogo(svg('<image href="https://evil.example/x.png"/>')))).toMatch(
      /externos/,
    );
    expect(messageOf(() => validateLogo(svg('<image xlink:href="//evil.example/x.png"/>')))).toMatch(
      /externos/,
    );
    expect(messageOf(() => validateLogo(svg('<a href="javascript:alert(1)"><rect/></a>')))).toMatch(
      /javascript/,
    );
    expect(messageOf(() => validateLogo(svg("<style>@import url(https://x/y.css)</style>")))).toMatch(
      /importa/,
    );
    expect(messageOf(() => validateLogo(svg('<image href="data:text/html;base64,AAAA"/>')))).toMatch(
      /data:/,
    );
  });

  it("acepta referencias internas, data:image y atributos legítimos", () => {
    const ok = svg(
      '<defs><linearGradient id="g"/></defs><rect fill="url(#g)"/><use href="#g"/>' +
        '<image href="data:image/png;base64,iVBORw0KGgo="/><marker orient="auto"/>',
    );
    expect(validateLogo(ok).format).toBe("svg");
  });

  it("aplica proporción con viewBox y admite SVG sin dimensiones", () => {
    expect(messageOf(() => validateLogo(svg("<rect/>", 'viewBox="0 0 1000 100"')))).toMatch(
      /proporción/,
    );
    expect(validateLogo(svg("<rect/>", 'viewBox="0 0 300 100"'))).toMatchObject({ width: 300, height: 100 });
    expect(validateLogo(svg("<rect/>", ""))).toMatchObject({ width: null, height: null });
  });

  it("rechaza XML que no sea SVG aunque se declare image/svg+xml", () => {
    const msg = messageOf(() =>
      validateLogo(Buffer.from('<?xml version="1.0"?><html/>'), "image/svg+xml"),
    );
    expect(msg).toMatch(/dice ser image\/svg\+xml/);
  });
});

describe("logo-storage · keyFromPublicUrl", () => {
  it("resuelve solo URLs de /uploads/ sin path traversal", () => {
    expect(keyFromPublicUrl("http://localhost:4000/uploads/tenants/t1/logo-abc.png")).toBe(
      "tenants/t1/logo-abc.png",
    );
    expect(keyFromPublicUrl("http://localhost:4000/uploads/tenants/..%2F..%2Fetc/passwd")).toBeNull();
    expect(keyFromPublicUrl("https://cdn.example.com/logo.png")).toBeNull();
    expect(keyFromPublicUrl("no-es-url")).toBeNull();
    expect(keyFromPublicUrl(null)).toBeNull();
  });
});
