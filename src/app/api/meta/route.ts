import { NextResponse } from "next/server";
import { loadHsTaxonomy, taxonomyStats } from "@/lib/hs/taxonomy";
import { getJudgmentMode } from "@/lib/typesafe/judgments";
import { COMMAND_CATALOG } from "@/lib/commands/catalog";
import { SAMPLE_DOCUMENTS } from "@/lib/samples";

export const runtime = "nodejs";

export async function GET() {
  const taxonomy = loadHsTaxonomy();
  return NextResponse.json({
    judgmentMode: getJudgmentMode(),
    taxonomy: taxonomyStats(taxonomy),
    commands: COMMAND_CATALOG,
    samples: SAMPLE_DOCUMENTS.map((s) => ({
      id: s.id,
      title: s.title,
      expectedHs6Hint: s.expectedHs6Hint,
    })),
  });
}
