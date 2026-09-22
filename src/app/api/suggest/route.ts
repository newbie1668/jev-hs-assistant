import { NextResponse } from "next/server";
import { suggestHsCode } from "@/lib/classify/beam";
import { taxonomyStats, loadHsTaxonomy } from "@/lib/hs/taxonomy";
import { getJudgmentMode } from "@/lib/typesafe/judgments";
import { invalidJsonResponse, readJsonBody } from "@/lib/api/json-body";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await readJsonBody<{ text?: string; verify?: boolean }>(
      request,
    );
    if (!body) return invalidJsonResponse();
    const text = body.text?.trim() ?? "";
    if (!text) {
      return NextResponse.json(
        { error: "Paste or upload shipping document text first." },
        { status: 400 },
      );
    }

    const { suggestion, trace } = await suggestHsCode(text, {
      verify: body.verify !== false,
    });

    return NextResponse.json({
      suggestion,
      trace,
      meta: {
        judgmentMode: getJudgmentMode(),
        taxonomy: taxonomyStats(loadHsTaxonomy()),
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Suggestion failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
