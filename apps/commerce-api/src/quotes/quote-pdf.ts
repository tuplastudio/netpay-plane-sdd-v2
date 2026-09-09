import PDFDocument from "pdfkit";

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
  };
}

const STATUS_LABEL: Record<string, string> = {
  DRAFT: "Borrador",
  ISSUED: "Emitida",
  ACCEPTED: "Aceptada",
  CANCELLED: "Cancelada",
  EXPIRED: "Vencida",
};

const STATUS_COLOR: Record<string, string> = {
  DRAFT: "#8a8a8a",
  ISSUED: "#0f766e",
  ACCEPTED: "#15803d",
  CANCELLED: "#b91c1c",
  EXPIRED: "#92400e",
};

const BRAND_COLOR = "#0f172a";

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

/** Genera el PDF comercial de una cotización. No es CFDI ni comprobante fiscal. */
export function renderQuotePdf(quote: QuotePdfData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "letter", margin: 50 });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.rect(0, 0, 612, 90).fill(BRAND_COLOR);
    doc
      .fillColor("#ffffff")
      .fontSize(20)
      .font("Helvetica-Bold")
      .text(quote.tenant.name, 50, 30);
    doc
      .fontSize(11)
      .font("Helvetica")
      .fillColor("#cbd5e1")
      .text("Cotización comercial", 50, doc.y + 2);

    const statusColor = STATUS_COLOR[quote.status] ?? "#334155";
    const statusLabel = STATUS_LABEL[quote.status] ?? quote.status;
    doc.font("Helvetica-Bold").fontSize(10);
    const badgeWidth = doc.widthOfString(statusLabel) + 20;
    doc.roundedRect(562 - badgeWidth, 34, badgeWidth, 20, 10).fill(statusColor);
    doc
      .fillColor("#ffffff")
      .fontSize(10)
      .font("Helvetica-Bold")
      .text(statusLabel, 562 - badgeWidth, 39, { width: badgeWidth, align: "center" });

    doc.fillColor("#000000");
    doc.y = 110;

    const infoTop = doc.y;
    doc.fontSize(10).font("Helvetica-Bold").text("Folio:", 50, infoTop, { continued: true });
    doc.font("Helvetica").text(` ${quote.id}`);
    doc.font("Helvetica-Bold").text("Creada:", 50, doc.y, { continued: true });
    doc.font("Helvetica").text(` ${fmtDate(quote.createdAt)}`);
    if (quote.issuedAt) {
      doc.font("Helvetica-Bold").text("Emitida:", 50, doc.y, { continued: true });
      doc.font("Helvetica").text(` ${fmtDate(quote.issuedAt)}`);
    }
    doc.font("Helvetica-Bold").text("Vigente hasta:", 50, doc.y, { continued: true });
    doc.font("Helvetica").text(` ${fmtDate(quote.expiresAt)}`);

    doc.moveDown(0.75);
    doc.font("Helvetica-Bold").fontSize(11).text("Cliente");
    doc.font("Helvetica").fontSize(10);
    doc.text(quote.customer.fullName);
    if (quote.customer.email) doc.text(quote.customer.email);
    if (quote.customer.phone) doc.text(quote.customer.phone);
    if (quote.customer.taxId) doc.text(`RFC: ${quote.customer.taxId}`);

    doc.moveDown(1);

    const colX = { sku: 50, title: 130, qty: 320, price: 375, disc: 445, sub: 495 };
    const tableTop = doc.y;
    doc.font("Helvetica-Bold").fontSize(9);
    doc.text("SKU", colX.sku, tableTop, { width: colX.title - colX.sku - 5 });
    doc.text("Descripción", colX.title, tableTop, { width: colX.qty - colX.title - 5 });
    doc.text("Cant.", colX.qty, tableTop, { width: colX.price - colX.qty - 5, align: "right" });
    doc.text("P. unit.", colX.price, tableTop, { width: colX.disc - colX.price - 5, align: "right" });
    doc.text("Desc. %", colX.disc, tableTop, { width: colX.sub - colX.disc - 5, align: "right" });
    doc.text("Importe", colX.sub, tableTop, { width: 562 - colX.sub, align: "right" });
    doc.moveDown(0.3);
    doc.strokeColor("#dddddd").moveTo(50, doc.y).lineTo(562, doc.y).stroke();
    doc.moveDown(0.3);

    doc.font("Helvetica").fontSize(9);
    for (const line of quote.lines) {
      const rowTop = doc.y;
      if (rowTop > 700) {
        doc.addPage();
      }
      const y = doc.y;
      doc.text(line.sku, colX.sku, y, { width: colX.title - colX.sku - 5 });
      doc.text(line.title, colX.title, y, { width: colX.qty - colX.title - 5 });
      doc.text(qty(line.quantity), colX.qty, y, {
        width: colX.price - colX.qty - 5,
        align: "right",
      });
      doc.text(`$${money(line.unitPrice)}`, colX.price, y, {
        width: colX.disc - colX.price - 5,
        align: "right",
      });
      doc.text(`${Number(line.discountPct.toString())}%`, colX.disc, y, {
        width: colX.sub - colX.disc - 5,
        align: "right",
      });
      doc.text(`$${money(line.lineSubtotal)}`, colX.sub, y, {
        width: 562 - colX.sub,
        align: "right",
      });
      doc.moveDown(0.5);
    }

    doc.moveDown(0.3);
    doc.strokeColor("#dddddd").moveTo(50, doc.y).lineTo(562, doc.y).stroke();
    doc.moveDown(0.5);

    const totalsX = 400;
    const totalsWidth = 162;
    doc.fontSize(10).font("Helvetica");
    const totalRow = (label: string, value: string, bold = false) => {
      doc.font(bold ? "Helvetica-Bold" : "Helvetica");
      const y = doc.y;
      doc.text(label, totalsX, y, { width: 90 });
      doc.text(`$${value}`, totalsX + 90, y, { width: totalsWidth - 90, align: "right" });
      doc.moveDown(0.35);
    };
    totalRow("Subtotal", money(quote.subtotal));
    totalRow("Descuento", money(quote.discount));
    totalRow("Base gravable", money(quote.taxBase));
    totalRow(`IVA (${Number(quote.tenant.taxRatePct.toString())}%)`, money(quote.tax));
    totalRow("Envío", money(quote.shipping));
    doc.moveDown(0.15);
    doc.fontSize(12);
    totalRow("TOTAL", money(quote.total), true);

    if (quote.notes) {
      doc.moveDown(1);
      doc.fontSize(10).font("Helvetica-Bold").text("Notas");
      doc.font("Helvetica").text(quote.notes, { width: 512 });
    }

    doc.moveDown(1.5);
    doc
      .fontSize(8)
      .fillColor("#777777")
      .text(
        "Documento comercial generado por NetPay Plane. No constituye comprobante fiscal digital (CFDI).",
        { width: 512 },
      )
      .text(`Generado el ${fmtDate(new Date())}`, { width: 512 });

    doc.end();
  });
}
