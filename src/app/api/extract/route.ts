import { NextResponse } from "next/server";
import {
  extractTextFromPdf,
  PdfExtractError,
} from "@/lib/extract/pdf";

export const runtime = "nodejs";

const TEXT_EXTENSIONS = new Set([".txt", ".csv", ".md", ".text"]);
const PDF_EXTENSIONS = new Set([".pdf"]);

function extensionOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i).toLowerCase() : "";
}

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "Upload a file under the form field “file”." },
        { status: 400 },
      );
    }

    const name = file.name || "upload";
    const ext = extensionOf(name);
    const mime = (file.type || "").toLowerCase();
    const bytes = new Uint8Array(await file.arrayBuffer());

    if (PDF_EXTENSIONS.has(ext) || mime === "application/pdf") {
      const extracted = await extractTextFromPdf(bytes);
      return NextResponse.json({
        text: extracted.text,
        source: "pdf",
        fileName: name,
        pageCount: extracted.pageCount,
        bytes: extracted.bytes,
      });
    }

    if (
      TEXT_EXTENSIONS.has(ext) ||
      mime.startsWith("text/") ||
      mime === "application/csv"
    ) {
      const text = new TextDecoder("utf-8").decode(bytes).trim();
      if (!text) {
        return NextResponse.json(
          { error: "Text file is empty." },
          { status: 400 },
        );
      }
      return NextResponse.json({
        text,
        source: "text",
        fileName: name,
        pageCount: 1,
        bytes: bytes.byteLength,
      });
    }

    return NextResponse.json(
      {
        error:
          "Unsupported file type. Upload a .pdf (text-based) or .txt / .csv / .md file.",
      },
      { status: 415 },
    );
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
    const message =
      error instanceof Error ? error.message : "Extraction failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
