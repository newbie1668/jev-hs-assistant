import { NextResponse } from "next/server";
import type { AssignmentRecord } from "@/lib/assignments";
import { isLegalHs6, loadHsTaxonomy, getNode } from "@/lib/hs/taxonomy";
import { HS_DATASET_VERSION } from "@/lib/hs/types";
import { getJudgmentMode } from "@/lib/typesafe/judgments";
import {
  TraceCollector,
  costFieldsForStep,
  nextStepId,
} from "@/lib/typesafe/trace";

export const runtime = "nodejs";

// In-memory audit log for the MVP (resets on server restart)
const assignments: AssignmentRecord[] = [];

function simpleHash(text: string): string {
  let h = 0;
  for (let i = 0; i < text.length; i += 1) {
    h = (h * 31 + text.charCodeAt(i)) >>> 0;
  }
  return `doc_${h.toString(16)}`;
}

export async function GET() {
  return NextResponse.json({ assignments });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      hscode?: string;
      documentText?: string;
      confidence?: number;
      humanConfirmed?: boolean;
    };

    if (!body.humanConfirmed) {
      return NextResponse.json(
        {
          error:
            "Human confirmation required. Judgments propose; humans assign drafts.",
        },
        { status: 400 },
      );
    }

    const hscode = body.hscode?.trim() ?? "";
    const taxonomy = loadHsTaxonomy();
    if (!isLegalHs6(taxonomy, hscode)) {
      return NextResponse.json(
        {
          error: `Code ${hscode || "(empty)"} is not a legal HS6 in pinned dataset ${HS_DATASET_VERSION}.`,
        },
        { status: 400 },
      );
    }

    const mode = getJudgmentMode();
    const trace = new TraceCollector("assign_hs_draft", mode);
    const startedAt = new Date().toISOString();
    const t0 = performance.now();

    const node = getNode(taxonomy, hscode)!;
    const record: AssignmentRecord = {
      id: `asg_${Date.now().toString(36)}`,
      hscode: node.hscode,
      description: node.description,
      datasetVersion: HS_DATASET_VERSION,
      documentHash: simpleHash(body.documentText ?? ""),
      confidence: body.confidence ?? 0,
      assignedAt: new Date().toISOString(),
      status: "draft_assigned",
    };
    assignments.unshift(record);

    const finishedAt = new Date().toISOString();
    const latencyMs = Math.max(0, performance.now() - t0);
    const cost = costFieldsForStep(mode, null);
    trace.addStep({
      id: nextStepId("assign"),
      kind: "assign_draft",
      label: `Human assign draft ${node.hscode}`,
      mode,
      latencyMs,
      startedAt,
      finishedAt,
      model: null,
      usage: null,
      ...cost,
      request: {
        endpoint: "POST /api/assign (local handler)",
        model: null,
        questionType: "none",
        instructions:
          "Human-confirmed draft assignment — no TypeSafe judgment; legal HS6 validated in code.",
        state: {
          hscode: node.hscode,
          humanConfirmed: true,
          documentHash: record.documentHash,
        },
      },
      response: { assignment: record },
      logs: [
        `validated ${node.hscode} exists at HS6 in dataset ${HS_DATASET_VERSION}`,
        `stored draft assignment ${record.id}`,
        "customs submit remains blocked",
      ],
    });

    return NextResponse.json({
      assignment: record,
      note: "Draft assignment stored locally. Customs submit is out of scope.",
      trace: trace.finish(),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Assign failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
