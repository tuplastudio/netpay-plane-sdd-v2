import { PDFParse } from "pdf-parse";

/**
 * Texto plano de un PDF (para `constancia-parser.ts`). `null` si el PDF no
 * es válido, está protegido con contraseña, o no trae texto seleccionable
 * (una foto/escaneo sin OCR) — nunca lanza: un PDF raro no debe tumbar la
 * petición de facturación, solo degradar a "captúralo a mano".
 */
export async function extractPdfText(bytes: Buffer): Promise<string | null> {
  let parser: PDFParse | null = null;
  try {
    parser = new PDFParse({ data: bytes });
    const result = await parser.getText();
    const text = (result.text || "").trim();
    return text.length > 0 ? text : null;
  } catch {
    return null;
  } finally {
    await parser?.destroy().catch(() => undefined);
  }
}
