import { NextResponse } from "next/server";
import {
  extractTextFromImage,
  ImageExtractError,
} from "@/lib/extract/image";
import {
  extractTextFromPdf,
  PdfExtractError,
} from "@/lib/extract/pdf";
import {
  extractTextFromBytes,
  looksLikePdf,
  TextExtractError,
} from "@/lib/extract/text";

export const runtime = "nodejs";
export const maxDuration = 60;

const TEXT_EXTENSIONS = new Set([
  ".txt",
  ".csv",
  ".md",
  ".text",
  ".tsv",
  ".json",
  ".xml",
  ".html",
  ".htm",
]);
const PDF_EXTENSIONS = new Set([".pdf"]);
const IMAGE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
  ".bmp",
  ".tif",
  ".tiff",
]);

function extensionOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i).toLowerCase() : "";
}

function isPdf(ext: string, mime: string, bytes: Uint8Array): boolean {
  return (
    PDF_EXTENSIONS.has(ext) ||
    mime === "application/pdf" ||
    looksLikePdf(bytes)
  );
}

function isImage(ext: string, mime: string): boolean {
  return IMAGE_EXTENSIONS.has(ext) || mime.startsWith("image/");
}

function isText(ext: string, mime: string): boolean {
  return (
    TEXT_EXTENSIONS.has(ext) ||
    mime.startsWith("text/") ||
    mime === "application/csv" ||
    mime === "application/json" ||
    mime === "application/xml"
  );
}

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "Upload a file under the form field “file”.” },
        { status: 400 },
      );
    }

    const name = file.name || "upload";
    const ext = extensionOf(name);
    const mime = (file.type || "").toLowerCase();
    const bytes = new Uint8Array(await file.arrayBuffer());

    if (isPdf(ext, mime, bytes)) {
      const extracted = await extractTextFromPdf(bytes);
      return NextResponse.json({
        text: extracted.text,
        source: "pdf",
        fileName: name,
        pageCount: extracted.pageCount,
        bytes: extracted.bytes,
      });
    }

    if (isImage(ext, mime)) {
      const extracted = await extractTextFromImage(bytes);
      return NextResponse.json({
        text: extracted.text,
        source: "ocr",
        fileName: name,
        pageCount: 1,
        bytes: extracted.bytes,
      });
    }

    if (isText(ext, mime)) {
      const text = extractTextFromBytes(bytes);
      return NextResponse.json({
        text,
        source: "text",
        fileName: name,
        pageCount: 1,
        bytes: bytes.byteLength,
      });
    }

    // Unknown extension/MIME: try text-like decode, else clear error.
    const text = extractTextFromBytes(bytes, { requireTextLike: true });
    return NextResponse.json({
      text,
      source: "text",
      fileName: name,
      pageCount: 1,
      bytes: bytes.byteLength,
    });
  } catch (error) {
    if (error instanceof PdfExtractError) {
      const status =
        error.code === "empty"
          ? 422
          : error.code === "too_large"
            ? 413
            : error.code === "invalid" || error.code === "unsupported"
              ? 400
              : 500;
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status },
      );
    }
    if (error instanceof ImageExtractError) {
      const status =
        error.code === "empty"
          ? 422
          : error.code === "too_large"
            ? 413
            : 500;
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status },
      );
    }
    if (error instanceof TextExtractError) {
      const status =
        error.code === "empty"
          ? 400
          : error.code === "too_large"
            ? 413
            : 415;
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status },
      );
    }
    const message =
      error instanceof Error ? error.message : "Extraction failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
