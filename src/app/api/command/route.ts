import { NextResponse } from "next/server";
import {
  COMMAND_CATALOG,
  gateCommand,
  isCommandId,
  type CommandId,
} from "@/lib/commands/catalog";
import {
  createJudgmentClient,
  getJudgmentMode,
} from "@/lib/typesafe/judgments";
import { TraceCollector } from "@/lib/typesafe/trace";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { utterance?: string };
    const utterance = body.utterance?.trim() ?? "";
    if (!utterance) {
      return NextResponse.json(
        { error: "Enter a dashboard command." },
        { status: 400 },
      );
    }

    const mode = getJudgmentMode();
    const trace = new TraceCollector("route_command", mode);
    const client = createJudgmentClient(trace);
    const catalog: Record<string, string> = { ...COMMAND_CATALOG };
    const routed = await client.routeCommand(utterance, catalog);

    if (!isCommandId(routed.choice)) {
      return NextResponse.json(
        { error: `Unknown command: ${routed.choice}` },
        { status: 400 },
      );
    }

    const command = routed.choice as CommandId;
    const gated = gateCommand(command, routed.confidence);

    return NextResponse.json({
      routed: {
        command,
        confidence: routed.confidence,
        probabilities: routed.probabilities,
        judgmentMode: client.mode,
      },
      gate: gated,
      catalog: COMMAND_CATALOG,
      trace: trace.finish(),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Command routing failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
