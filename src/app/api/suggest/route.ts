import { NextResponse } from "next/server";
import { suggestHsCode } from "@/lib/classify/beam";
import { extractGoodsLines } from "@/lib/hs/stated-codes";
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

    const verify = body.verify !== false;
    const lines = extractGoodsLines(text);

    const items =
      lines.length >= 2
        ? await Promise.all(
            lines.map(async (line, index) => ({
              index,
              lineText: line,
              ...(await suggestHsCode(line, { verify })),
            })),
          )
        : [
            {
              index: 0,
              lineText: text,
              ...(await suggestHsCode(text, { verify })),
            },
          ];

    const first = items[0]!;
    return NextResponse.json({
      suggestion: first.suggestion,
      trace: first.trace,
      items,
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
