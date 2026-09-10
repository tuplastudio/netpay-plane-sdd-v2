import PDFDocument from "pdfkit";
import { keyFromPublicUrl, readObject } from "../tenants/logo-storage.js";
import { parseJpeg, parsePng, sniffFormat } from "../tenants/logo-validation.js";

interface Money {
  toString(): string;
}

export interface QuotePdfLine {
  sku: string;
  title: string;
  quantity: Money;
  unitPrice: Money;
  discountPct: Money;
  lineSubtotal: Money;
}

export interface QuotePdfData {
  id: string;
  status: string;
  subtotal: Money;
  discount: Money;
  taxBase: Money;
  tax: Money;
  shipping: Money;
  total: Money;
  notes: string | null;
  createdAt: Date;
  issuedAt: Date | null;
  expiresAt: Date;
  customer: {
    fullName: string;
    email: string | null;
    phone: string | null;
    taxId: string | null;
  };
  lines: QuotePdfLine[];
  tenant: {
    name: string;
    taxRatePct: Money;
    /** Hex como "#0f172a" o "#fff". Si no viene, se cae al azul de marca. */
    primaryColor?: string | null;
    secondaryColor?: string | null;
    accentColor?: string | null;
    logoUrl?: string | null;
  };
}

const STATUS_LABEL: Record<string, string> = {
  DRAFT: "Borrador",
  ISSUED: "Emitida",
  ACCEPTED: "Aceptada",
  CANCELLED: "Cancelada",
  EXPIRED: "Vencida",
};

// Tonos oscuros que combinan con casi cualquier color primario de marca
// (los `#000000` puros se ven duros contra el primario; los `#FFFFFF` no
// contrastan sobre fondos claros). El primario se conserva tal cual.
const STATUS_COLOR: Record<string, string> = {
  DRAFT: "#475569",
  ISSUED: "#0f766e",
  ACCEPTED: "#15803d",
  CANCELLED: "#b91c1c",
  EXPIRED: "#92400e",
};

const BRAND_FALLBACK = "#0f172a";

/** Convierte "#RRGGBB" a `{r,g,b}` 0-255. Si no parsea, cae al fallback. */
function hexToRgb(hex: string | null | undefined, fallback = BRAND_FALLBACK): [number, number, number] {
  if (!hex) return rgb(fallback);
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return rgb(fallback);
  const raw = m[1]!;
  const full = raw.length === 3 ? raw.split("").map((c) => c + c).join("") : raw;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

function rgb(hex: string): [number, number, number] {
  const [r, g, b] = hexToRgb(hex, BRAND_FALLBACK);
  return [r, g, b];
}

function rgbStr(hex: string | null | undefined, fallback = BRAND_FALLBACK): string {
  const [r, g, b] = hexToRgb(hex, fallback);
  return `rgb(${r},${g},${b})`;
}

/** Devuelve blanco o negro según el contraste sobre el primario (WCAG). */
function contrastInk(hex: string | null | undefined): string {
  const [r, g, b] = hexToRgb(hex);
  // Luminancia relativa (sRGB → linear).
  const lum = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  const L = 0.2126 * lum(r) + 0.7152 * lum(g) + 0.0722 * lum(b);
  return L > 0.45 ? "#0f172a" : "#ffffff";
}

function money(value: Money): string {
  const n = Number(value.toString());
  return n.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** "2.000" -> "2", "2.500" -> "2.5": la cotización valida 3 decimales, pero
 * mostrarlos siempre es ruido visual para cantidades enteras o simples. */
function qty(value: Money): string {
  const n = Number(value.toString());
  return Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

function fmtDate(d: Date): string {
  return d.toLocaleString("es-MX", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Mexico_City",
  });
}

interface PdfLogo {
  bytes: Buffer;
  width: number;
  height: number;
}

const LOGO_FETCH_TIMEOUT_MS = 3_000;
const LOGO_MAX_BYTES = 2 * 1024 * 1024;
/** Caja máxima del logo en el header (puntos PDF). */
const LOGO_BOX = { x: 50, y: 20, w: 140, h: 70 } as const;

/**
 * Trae los bytes del logo para incrustarlos. Si vive en nuestro `/uploads/` se
 * lee de disco; si es una URL externa se descarga con timeout. pdfkit solo
 * incrusta PNG y JPEG: WebP/SVG (o cualquier fallo) devuelven `null` y el PDF
 * sale sin logo, nunca roto.
 */
async function loadPdfLogo(logoUrl: string | null | undefined): Promise<PdfLogo | null> {
  if (!logoUrl) return null;
  try {
    let bytes: Buffer | null = null;
    const key = keyFromPublicUrl(logoUrl);
    if (key) bytes = await readObject(key);
    if (!bytes) {
      const res = await fetch(logoUrl, { signal: AbortSignal.timeout(LOGO_FETCH_TIMEOUT_MS) });
      if (!res.ok) return null;
      const raw = Buffer.from(await res.arrayBuffer());
      if (raw.length === 0 || raw.length > LOGO_MAX_BYTES) return null;
      bytes = raw;
    }
    const format = sniffFormat(bytes);
    const dims = format === "png" ? parsePng(bytes) : format === "jpeg" ? parseJpeg(bytes) : null;
    if (!dims || dims.width <= 0 || dims.height <= 0) return null;
    return { bytes, width: dims.width, height: dims.height };
  } catch {
    return null;
  }
}

/** Genera el PDF comercial de una cotización. No es CFDI ni comprobante fiscal.
 *  La paleta (header, regla, chip de status, fondo del total) sale del branding
 *  del tenant; el resto de la tipografía y márgenes es estable para que el
 *  documento se lea igual entre clientes. */
export async function renderQuotePdf(quote: QuotePdfData): Promise<Buffer> {
  const logo = await loadPdfLogo(quote.tenant.logoUrl);
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "letter", margin: 50 });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const primary = quote.tenant.primaryColor ?? BRAND_FALLBACK;
    const secondary = quote.tenant.secondaryColor ?? primary;
    const accent = quote.tenant.accentColor ?? primary;
    const headerInk = contrastInk(primary);
    const totalInk = contrastInk(secondary);
    const accentInk = contrastInk(accent);

    // ---- HEADER con banda de color de marca -----------------------------
    doc.rect(0, 0, 612, 110).fill(primary);

    // Logo arriba a la izquierda (si hay y se pudo incrustar); el nombre se
    // corre a la derecha del logo. Sin logo, el layout es el de siempre.
    let textX = 50;
    if (logo) {
      const scale = Math.min(LOGO_BOX.w / logo.width, LOGO_BOX.h / logo.height, 1);
      const drawW = logo.width * scale;
      const drawH = logo.height * scale;
      try {
        doc.image(logo.bytes, LOGO_BOX.x, LOGO_BOX.y + (LOGO_BOX.h - drawH) / 2, {
          width: drawW,
          height: drawH,
        });
        textX = LOGO_BOX.x + drawW + 14;
      } catch {
        // Imagen que pdfkit no pudo decodificar: se sigue sin logo.
      }
    }

    doc
      .fillColor(headerInk)
      .fontSize(22)
      .font("Helvetica-Bold")
      .text(quote.tenant.name, textX, 38, { width: 430 - textX });

    doc
      .fontSize(10)
      .font("Helvetica")
      .fillColor(headerInk === "#ffffff" ? "#cbd5e1" : "#475569")
      .text("Cotización comercial", textX, 72);

    // Status badge a la derecha.
    const statusColor = STATUS_COLOR[quote.status] ?? "#334155";
    const statusLabel = STATUS_LABEL[quote.status] ?? quote.status;
    doc.font("Helvetica-Bold").fontSize(10);
    const badgeWidth = doc.widthOfString(statusLabel) + 24;
    doc.roundedRect(562 - badgeWidth, 42, badgeWidth, 22, 11).fill(statusColor);
    doc
      .fillColor("#ffffff")
      .fontSize(10)
      .font("Helvetica-Bold")
      .text(statusLabel, 562 - badgeWidth, 48, { width: badgeWidth, align: "center" });

    // ---- Banda de acento debajo del header ------------------------------
    doc.rect(0, 110, 612, 6).fill(secondary);

    doc.fillColor("#0f172a");
    doc.y = 138;

    // ---- Bloque de metadatos: folio y vigencia (izq) + cliente (der) ----
    const metaTop = doc.y;
    doc.fontSize(10).font("Helvetica-Bold").fillColor("#0f172a").text("Folio", 50, metaTop);
    doc.font("Helvetica").fillColor("#334155").text(quote.id, 50, doc.y);
    doc.moveDown(0.3);
    doc.font("Helvetica-Bold").fillColor("#0f172a").text("Creada", 50, doc.y);
    doc.font("Helvetica").fillColor("#334155").text(fmtDate(quote.createdAt), 50, doc.y);
    if (quote.issuedAt) {
      doc.moveDown(0.3);
      doc.font("Helvetica-Bold").fillColor("#0f172a").text("Emitida", 50, doc.y);
      doc.font("Helvetica").fillColor("#334155").text(fmtDate(quote.issuedAt), 50, doc.y);
    }
    doc.moveDown(0.3);
    doc.font("Helvetica-Bold").fillColor("#0f172a").text("Vigente hasta", 50, doc.y);
    doc.font("Helvetica").fillColor("#334155").text(fmtDate(quote.expiresAt), 50, doc.y);

    // ---- Bloque cliente (a la derecha) ---------------------------------
    const customerX = 360;
    const customerTop = metaTop;
    doc
      .font("Helvetica-Bold")
      .fontSize(11)
      .fillColor("#0f172a")
      .text("Cliente", customerX, customerTop);
    doc.font("Helvetica").fontSize(10).fillColor("#0f172a");
    doc.text(quote.customer.fullName, customerX, doc.y, { width: 200 });
    if (quote.customer.email) doc.fillColor("#334155").text(quote.customer.email, customerX, doc.y, { width: 200 });
    if (quote.customer.phone) doc.text(quote.customer.phone, customerX, doc.y, { width: 200 });
    if (quote.customer.taxId) doc.text(`RFC: ${quote.customer.taxId}`, customerX, doc.y, { width: 200 });

    doc.y = Math.max(doc.y, customerTop + 70) + 14;
    doc.x = 50;

    // ---- Tabla de líneas ------------------------------------------------
    const colX = { sku: 50, title: 130, qty: 330, price: 380, disc: 445, sub: 495 };
    const tableTop = doc.y;
    doc.rect(50, tableTop - 4, 512, 20).fill(rgbStr(secondary));
    doc.font("Helvetica-Bold").fontSize(9).fillColor(totalInk);
    doc.text("SKU", colX.sku, tableTop, { width: colX.title - colX.sku - 5 });
    doc.text("Descripción", colX.title, tableTop, { width: colX.qty - colX.title - 5 });
    doc.text("Cant.", colX.qty, tableTop, { width: colX.price - colX.qty - 5, align: "right" });
    doc.text("P. unit.", colX.price, tableTop, { width: colX.disc - colX.price - 5, align: "right" });
    doc.text("Desc. %", colX.disc, tableTop, { width: colX.sub - colX.disc - 5, align: "right" });
    doc.text("Importe", colX.sub, tableTop, { width: 562 - colX.sub, align: "right" });
    doc.y = tableTop + 18;

    doc.font("Helvetica").fontSize(9).fillColor("#0f172a");
    let alt = false;
    for (const line of quote.lines) {
      if (doc.y > 700) {
        doc.addPage();
        doc.y = 50;
      }
      const rowY = doc.y;
      if (alt) {
        doc.rect(50, rowY - 3, 512, 18).fill("#f8fafc");
      }
      alt = !alt;
      doc.text(line.sku, colX.sku, rowY, { width: colX.title - colX.sku - 5 });
      doc.text(line.title, colX.title, rowY, { width: colX.qty - colX.title - 5 });
      doc.text(qty(line.quantity), colX.qty, rowY, {
        width: colX.price - colX.qty - 5,
        align: "right",
      });
      doc.text(`$${money(line.unitPrice)}`, colX.price, rowY, {
        width: colX.disc - colX.price - 5,
        align: "right",
      });
      doc.text(`${Number(line.discountPct.toString())}%`, colX.disc, rowY, {
        width: colX.sub - colX.disc - 5,
        align: "right",
      });
      doc.text(`$${money(line.lineSubtotal)}`, colX.sub, rowY, {
        width: 562 - colX.sub,
        align: "right",
      });
      doc.y = rowY + 18;
    }

    doc.strokeColor("#e2e8f0").lineWidth(0.5).moveTo(50, doc.y).lineTo(562, doc.y).stroke();
    doc.moveDown(0.5);

    // ---- Totales con acento ---------------------------------------------
    const totalsX = 360;
    const totalsWidth = 202;
    doc.fontSize(10).font("Helvetica");
    const totalRow = (label: string, value: string, bold = false, accent2 = false) => {
      doc.font(bold ? "Helvetica-Bold" : "Helvetica");
      const y = doc.y;
      doc.fillColor("#334155").text(label, totalsX, y, { width: 120 });
      doc.fillColor(accent2 ? "#0f172a" : "#0f172a").text(
        `$${value}`,
        totalsX + 120,
        y,
        { width: totalsWidth - 120, align: "right" },
      );
      doc.moveDown(0.35);
    };
    totalRow("Subtotal", money(quote.subtotal));
    totalRow("Descuento", money(quote.discount));
    totalRow("Base gravable", money(quote.taxBase));
    totalRow(`IVA (${Number(quote.tenant.taxRatePct.toString())}%)`, money(quote.tax));
    totalRow("Envío", money(quote.shipping));

    // Bloque destacado del TOTAL: fondo accent + ink contrastado.
    doc.moveDown(0.4);
    const totalBoxY = doc.y;
    const totalBoxH = 30;
    doc.rect(totalsX, totalBoxY, totalsWidth, totalBoxH).fill(accent);
    doc
      .fontSize(12)
      .font("Helvetica-Bold")
      .fillColor(accentInk)
      .text("TOTAL", totalsX + 12, totalBoxY + 9, { width: 80 });
    doc
      .fontSize(14)
      .font("Helvetica-Bold")
      .fillColor(accentInk)
      .text(`$${money(quote.total)}`, totalsX + 90, totalBoxY + 8, {
        width: totalsWidth - 102,
        align: "right",
      });
    doc.y = totalBoxY + totalBoxH + 4;
    doc.x = 50;

    // ---- Notas ---------------------------------------------------------
    if (quote.notes) {
      doc.moveDown(0.6);
      doc.fontSize(11).font("Helvetica-Bold").fillColor("#0f172a").text("Notas");
      doc.font("Helvetica").fillColor("#334155").text(quote.notes, { width: 512 });
    }

    // ---- Pie -----------------------------------------------------------
    doc.moveDown(2);
    doc
      .fontSize(8)
      .fillColor("#777777")
      .font("Helvetica")
      .text(
        `Documento comercial generado por ${quote.tenant.name}. No constituye comprobante fiscal digital (CFDI).`,
        { width: 512, align: "center" },
      )
      .text(`Generado el ${fmtDate(new Date())}`, { width: 512, align: "center" });

    doc.end();
  });
}
