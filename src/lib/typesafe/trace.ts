/** Decision-trace types for TypeSafe / mock judgment runs. */

export type TraceStepKind =
  | "choice_child"
  | "verification_noul"
  | "command_route"
  | "assign_draft"
  | "skipped_singleton";

export type CostSource = "typesafe_tokens" | "mock" | "none";

export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
}

export interface TraceRequestSummary {
  endpoint: string;
  model: string | null;
  questionType: "choice" | "noul" | "none";
  instructions: string;
  optionCount?: number;
  parentCode?: string;
  /** Truncated / redacted state sent with the call */
  state: unknown;
  criteriaPreview?: unknown;
}

export interface TraceStep {
  id: string;
  kind: TraceStepKind;
  label: string;
  mode: "typesafe" | "mock";
  latencyMs: number;
  startedAt: string;
  finishedAt: string;
  model: string | null;
  usage: TokenUsage | null;
  /** USD when estimable from TypeSafe input tokens; null in mock */
  costUsd: number | null;
  costSource: CostSource;
  costLabel: string;
  request: TraceRequestSummary;
  response: unknown;
  logs: string[];
}

export interface DecisionTrace {
  id: string;
  operation: "suggest_hs" | "route_command" | "assign_hs_draft";
  mode: "typesafe" | "mock";
  startedAt: string;
  finishedAt: string;
  totalLatencyMs: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number | null;
  costSource: CostSource;
  costNote: string;
  steps: TraceStep[];
}

/**
 * Jev pricing from https://docs.typesafe.ai/models.md (jev-1.13):
 * $0.042 per million input tokens; output tokens are free.
 * Cost is not returned on the wire — we estimate from `usage.input_tokens`.
 */
export const JEV_INPUT_USD_PER_MTOK = 0.042;

export function estimateCostUsdFromUsage(
  usage: TokenUsage | null | undefined,
): number | null {
  if (!usage) return null;
  return (usage.input_tokens / 1_000_000) * JEV_INPUT_USD_PER_MTOK;
}

export function formatUsd(amount: number | null): string {
  if (amount === null) return "—";
  if (amount === 0) return "$0";
  if (amount < 0.000001) return `$${amount.toExponential(2)}`;
  if (amount < 0.01) return `$${amount.toFixed(6)}`;
  return `$${amount.toFixed(4)}`;
}

export function formatLatency(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

let stepCounter = 0;

export function nextStepId(prefix: string): string {
  stepCounter += 1;
  return `${prefix}_${stepCounter.toString(36)}_${Date.now().toString(36)}`;
}

export class TraceCollector {
  readonly id: string;
  readonly operation: DecisionTrace["operation"];
  readonly mode: "typesafe" | "mock";
  readonly startedAt: string;
  readonly startedMs: number;
  readonly steps: TraceStep[] = [];

  constructor(
    operation: DecisionTrace["operation"],
    mode: "typesafe" | "mock",
  ) {
    this.id = `trace_${Date.now().toString(36)}`;
    this.operation = operation;
    this.mode = mode;
    this.startedAt = new Date().toISOString();
    this.startedMs = performance.now();
  }

  addStep(step: TraceStep): void {
    this.steps.push(step);
  }

  finish(): DecisionTrace {
    const finishedAt = new Date().toISOString();
    const totalLatencyMs = Math.max(0, performance.now() - this.startedMs);
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalCostUsd = 0;
    let anyCost = false;

    for (const step of this.steps) {
      if (step.usage) {
        totalInputTokens += step.usage.input_tokens;
        totalOutputTokens += step.usage.output_tokens;
      }
      if (step.costUsd !== null) {
        totalCostUsd += step.costUsd;
        anyCost = true;
      }
    }

    const costSource: CostSource =
      this.mode === "mock"
        ? "mock"
        : anyCost
          ? "typesafe_tokens"
          : "none";

    const costNote =
      this.mode === "mock"
        ? "Mock mode — not billed. Latencies are local compute only; no TypeSafe API cost."
        : anyCost
          ? `Estimated from TypeSafe usage.input_tokens @ $${JEV_INPUT_USD_PER_MTOK}/Mtok (output free; see docs.typesafe.ai/models). API does not return a dollar field.`
          : "No token usage recorded on this run.";

    return {
      id: this.id,
      operation: this.operation,
      mode: this.mode,
      startedAt: this.startedAt,
      finishedAt,
      totalLatencyMs,
      totalInputTokens,
      totalOutputTokens,
      totalCostUsd: this.mode === "mock" ? null : anyCost ? totalCostUsd : null,
      costSource,
      costNote,
      steps: this.steps,
    };
  }
}

export function costFieldsForStep(
  mode: "typesafe" | "mock",
  usage: TokenUsage | null,
): Pick<TraceStep, "costUsd" | "costSource" | "costLabel"> {
  if (mode === "mock") {
    return {
      costUsd: null,
      costSource: "mock",
      costLabel: "mock — not billed",
    };
  }
  const costUsd = estimateCostUsdFromUsage(usage);
  if (costUsd === null) {
    return {
      costUsd: null,
      costSource: "none",
      costLabel: "n/a — no usage",
    };
  }
  return {
    costUsd,
    costSource: "typesafe_tokens",
    costLabel: `${formatUsd(costUsd)} est. (input tokens)`,
  };
}
