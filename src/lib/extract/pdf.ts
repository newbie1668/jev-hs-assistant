import { PDFParse } from "pdf-parse";

const MAX_BYTES = 12 * 1024 * 1024; // 12 MB

export class PdfExtractError extends Error {
  constructor(
    message: string,
    readonly code:
      | "empty"
      | "too_large"
      | "invalid"
      | "unsupported"
      | "failed",
  ) {
    super(message);
    this.name = "PdfExtractError";
  }
}

export interface PdfExtractResult {
  text: string;
  pageCount: number;
  bytes: number;
}

/**
 * Extract text from a text-based PDF. Scanned/image-only PDFs yield empty
 * text — OCR is intentionally out of scope.
 */
export async function extractTextFromPdf(
  data: Uint8Array,
): Promise<PdfExtractResult> {
  if (data.byteLength === 0) {
    throw new PdfExtractError("PDF file is empty.", "empty");
  }
  if (data.byteLength > MAX_BYTES) {
    throw new PdfExtractError(
      `PDF exceeds ${MAX_BYTES / (1024 * 1024)} MB limit.`,
      "too_large",
    );
  }

  const header = new TextDecoder("latin1").decode(data.subarray(0, 8));
  if (!header.startsWith("%PDF")) {
    throw new PdfExtractError(
      "File does not look like a PDF (missing %PDF header).",
      "invalid",
    );
  }

  const byteLength = data.byteLength;

  let parser: PDFParse | null = null;
  try {
    parser = new PDFParse({ data });
    const result = await parser.getText();
    const text = (result.text ?? "")
      .replace(/(?:^|\n)\s*--\s*\d+\s+of\s+\d+\s*--\s*(?:\n|$)/gi, "\n")
      .replace(/\u0000/g, "")
      .trim();

    if (!text) {
      throw new PdfExtractError(
        "No extractable text found. This PDF may be a scan or image-only — OCR is not supported yet. Upload a text-based PDF, a .txt file, or paste the shipment text.",
        "empty",
      );
    }

    return {
      text,
      pageCount: result.total ?? result.pages?.length ?? 0,
      bytes: byteLength,
    };
  } catch (error) {
    if (error instanceof PdfExtractError) throw error;
    const message =
      error instanceof Error ? error.message : "PDF extraction failed";
    throw new PdfExtractError(message, "failed");
  } finally {
    if (parser) {
      try {
        await parser.destroy();
      } catch {
        // ignore cleanup errors
      }
    }
  }
}
