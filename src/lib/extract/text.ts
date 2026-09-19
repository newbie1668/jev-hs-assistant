const MAX_BYTES = 12 * 1024 * 1024; // 12 MB
const PRINTABLE_RATIO = 0.85;

export class TextExtractError extends Error {
  constructor(
    message: string,
    readonly code: "empty" | "too_large" | "binary",
  ) {
    super(message);
    this.name = "TextExtractError";
  }
}

/**
 * Decode UTF-8 text when the payload looks like plain text.
 * Rejects obvious binary so classify never gets garbage.
 */
export function extractTextFromBytes(
  data: Uint8Array,
  opts?: { requireTextLike?: boolean },
): string {
  if (data.byteLength === 0) {
    throw new TextExtractError("Text file is empty.", "empty");
  }
  if (data.byteLength > MAX_BYTES) {
    throw new TextExtractError(
      `File exceeds ${MAX_BYTES / (1024 * 1024)} MB limit.`,
      "too_large",
    );
  }

  if (opts?.requireTextLike && !looksLikeText(data)) {
    throw new TextExtractError(
      "Could not extract text from this file. Upload a PDF, image (png/jpg/webp), .txt, or paste the shipment text.",
      "binary",
    );
  }

  const text = new TextDecoder("utf-8", { fatal: false })
    .decode(data)
    .replace(/\u0000/g, "")
    .trim();

  if (!text) {
    throw new TextExtractError("Text file is empty.", "empty");
  }

  return text;
}

function looksLikeText(data: Uint8Array): boolean {
  const sample = data.subarray(0, Math.min(data.byteLength, 4096));
  if (sample.length === 0) return false;

  let printable = 0;
  for (const byte of sample) {
    if (
      byte === 0x09 ||
      byte === 0x0a ||
      byte === 0x0d ||
      (byte >= 0x20 && byte <= 0x7e) ||
      byte >= 0x80
    ) {
      printable += 1;
    }
  }
  return printable / sample.length >= PRINTABLE_RATIO;
}

export function looksLikePdf(data: Uint8Array): boolean {
  if (data.byteLength < 5) return false;
  const header = new TextDecoder("latin1").decode(data.subarray(0, 5));
  return header.startsWith("%PDF");
}
