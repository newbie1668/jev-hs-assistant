import { createWorker } from "tesseract.js";

const MAX_BYTES = 12 * 1024 * 1024; // 12 MB
const MIN_TEXT_CHARS = 8;

export class ImageExtractError extends Error {
  constructor(
    message: string,
    readonly code: "empty" | "too_large" | "failed",
  ) {
    super(message);
    this.name = "ImageExtractError";
  }
}

export interface ImageExtractResult {
  text: string;
  bytes: number;
}

/**
 * Best-effort OCR for shipment photos / screenshots (png/jpg/webp).
 * Uses tesseract.js English; fails clearly when no usable text is found.
 */
export async function extractTextFromImage(
  data: Uint8Array,
): Promise<ImageExtractResult> {
  if (data.byteLength === 0) {
    throw new ImageExtractError("Image file is empty.", "empty");
  }
  if (data.byteLength > MAX_BYTES) {
    throw new ImageExtractError(
      `Image exceeds ${MAX_BYTES / (1024 * 1024)} MB limit.`,
      "too_large",
    );
  }

  let worker: Awaited<ReturnType<typeof createWorker>> | null = null;
  try {
    worker = await createWorker("eng");
    const {
      data: { text: raw },
    } = await worker.recognize(Buffer.from(data));
    const text = (raw ?? "").replace(/\u0000/g, "").trim();

    if (text.replace(/\s+/g, "").length < MIN_TEXT_CHARS) {
      throw new ImageExtractError(
        "OCR found little or no readable text. Try a clearer image, a text-based PDF / .txt, or paste the shipment text.",
        "empty",
      );
    }

    return { text, bytes: data.byteLength };
  } catch (error) {
    if (error instanceof ImageExtractError) throw error;
    const message =
      error instanceof Error ? error.message : "Image OCR failed";
    throw new ImageExtractError(message, "failed");
  } finally {
    if (worker) {
      try {
        await worker.terminate();
      } catch {
        // ignore cleanup errors
      }
    }
  }
}
