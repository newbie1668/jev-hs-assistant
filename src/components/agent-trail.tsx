"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import {
  formatLatency,
  formatUsd,
  type DecisionTrace,
  type TraceStep,
} from "@/lib/typesafe/trace";

interface AgentTrailProps {
  trace: DecisionTrace | null;
  query?: string;
  history?: Array<{ query: string; latencyMs: number }>;
  suggestionHs?: string | null;
  suggestionDescription?: string | null;
  suggestionConfidence?: number | null;
  suggestionVerification?: { matchProbability: number; passed: boolean } | null;
  documentStated?: {
    rawDigits: string;
    hs6: string;
    inTaxonomy: boolean;
    description: string | null;
    disagreesWithSuggestion: boolean;
  } | null;
  command: string;
  onCommandChange: (value: string) => void;
  onCommandSubmit: () => void;
  className?: string;
}

function stepConfidence(step: TraceStep): number | null {
  const response = step.response as Record<string, unknown> | null;
  if (!response) return null;
  if (typeof response.confidence === "number") return response.confidence;
  if (typeof response.noul === "number") return response.noul;
  return null;
}

function choiceRows(step: TraceStep): Array<{ code: string; p: number }> {
  const response = step.response as Record<string, unknown> | null;
  if (!response) return [];

  if (Array.isArray(response.probabilitiesTop)) {
    return (response.probabilitiesTop as Array<{ code: string; p: number }>).slice(
      0,
      5,
    );
  }

  if (response.probabilities && typeof response.probabilities === "object") {
    return Object.entries(response.probabilities as Record<string, number>)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([code, p]) => ({ code, p }));
  }

  return [];
}

function choiceWinner(step: TraceStep): string | null {
  const response = step.response as Record<string, unknown> | null;
  if (!response) return null;
  if (typeof response.choice === "string") return response.choice;
  const rows = choiceRows(step);
  return rows[0]?.code ?? null;
}

function toolCallText(step: TraceStep): string {
  const endpoint = step.request.endpoint.replace(/^\//, "");
  const parent = step.request.parentCode
    ? `, parent: "${step.request.parentCode}"`
    : "";
  const opts =
    typeof step.request.optionCount === "number"
      ? `, options: ${step.request.optionCount}`
      : "";

  switch (step.kind) {
    case "choice_child":
      return `hierarchical_choice({ endpoint: "${endpoint}"${parent}${opts} })`;
    case "verification_noul":
      return `verify_noul({ endpoint: "${endpoint}" })`;
    case "command_route":
      return `route_command({ utterance })`;
    case "assign_draft":
      return `assign_hs_draft({ humanConfirmed: true })`;
    case "skipped_singleton":
      return `skip_singleton({ parent: "${step.request.parentCode ?? "—"}" })`;
    default: {
      const _exhaustive: never = step.kind;
      return _exhaustive;
    }
  }
}

function stepTitle(step: TraceStep): string {
  switch (step.kind) {
    case "choice_child":
      return step.request.parentCode
        ? `Chose child under ${step.request.parentCode}`
        : "Chose HS chapter / heading";
    case "verification_noul":
      return "Verified suggestion gate";
    case "command_route":
      return "Routed closed command";
    case "assign_draft":
      return "Assigned HS6 draft";
    case "skipped_singleton":
      return `Skipped singleton under ${step.request.parentCode ?? "node"}`;
    default: {
      const _exhaustive: never = step.kind;
      return _exhaustive;
    }
  }
}

function TrailStepCard({
  step,
  isLast,
}: {
  step: TraceStep;
  isLast: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const rows = choiceRows(step);
  const winner = choiceWinner(step);
  const confidence = stepConfidence(step);
  const done = step.kind !== "skipped_singleton";

  return (
    <div className="relative flex gap-3 pb-4">
      {!isLast && (
        <span
          aria-hidden
          className="absolute top-5 bottom-0 left-[9px] w-px bg-[#d8d4c8]"
        />
      )}
      <span
        className={cn(
          "relative z-[1] mt-0.5 flex size-[18px] shrink-0 items-center justify-center rounded-full text-[10px] font-bold",
          done
            ? "bg-[#3b82f6] text-white"
            : "border border-[#ccc9ba] bg-white/60 text-[#807d73]",
        )}
      >
        {done ? "✓" : "·"}
      </span>

      <div className="min-w-0 flex-1 space-y-2">
        <button
          type="button"
          className="w-full text-left"
          onClick={() => setExpanded((v) => !v)}
        >
          <p className="text-[13px] font-medium leading-snug text-[#0d0d0d]">
            {stepTitle(step)}
          </p>
          <p className="mt-0.5 font-mono text-[10px] text-[#807d73]">
            {Math.round(step.latencyMs)}ms
            {step.costSource === "mock"
              ? " · mock"
              : step.costUsd !== null
                ? ` · ${formatUsd(step.costUsd)}`
                : ""}
          </p>
        </button>

        <div className="rounded-xl border border-white/60 bg-white/55 px-3 py-2.5 font-mono text-[11px] leading-relaxed text-[#3a3a38] shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] backdrop-blur-md">
          {toolCallText(step)}
        </div>

        {rows.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-[12px] font-medium text-[#0d0d0d]">
              Found Matching HS codes
            </p>
            <ul className="space-y-1">
              {rows.map((row) => (
                <li
                  key={row.code}
                  className={cn(
                    "flex items-baseline justify-between gap-2 text-[12px]",
                    row.code === winner
                      ? "font-semibold text-[#0d0d0d]"
                      : "text-[#66645c]",
                  )}
                >
                  <span className="font-mono">{row.code}</span>
                  <span className="font-mono text-[10px] text-[#807d73]">
                    p={row.p.toFixed(2)}
                  </span>
                </li>
              ))}
            </ul>
            {confidence !== null && (
              <p className="text-[11px] text-[#807d73]">
                {(confidence * 100).toFixed(0)}%+ confidence
              </p>
            )}
          </div>
        )}

        {expanded && (
          <ul className="space-y-0.5 rounded-lg bg-white/40 px-2.5 py-2 font-mono text-[10px] text-[#66645c]">
            {step.logs.map((line) => (
              <li key={line}>{line}</li>
            ))}
            <li>
              speed {formatLatency(step.latencyMs)} · {step.costLabel}
            </li>
          </ul>
        )}
      </div>
    </div>
  );
}

export function AgentTrail({
  trace,
  query,
  history = [],
  suggestionHs,
  suggestionDescription,
  suggestionConfidence,
  suggestionVerification = null,
  documentStated = null,
  command,
  onCommandChange,
  onCommandSubmit,
  className,
}: AgentTrailProps) {
  const providerLabel = trace?.mode === "typesafe" ? "TypeSafe" : "Mock";
  const missingNote =
    suggestionHs == null
      ? "I'll highlight the fields that need HS codes. Run Suggest HS6 to walk the taxonomy."
      : documentStated?.disagreesWithSuggestion
        ? `Suggested ${suggestionHs} from the goods description — document states ${documentStated.rawDigits} (HS6 ${documentStated.hs6}). Review the disagreement, then Assign draft. Post remains blocked.`
        : `Suggested ${suggestionHs} — review Fields / Lines, then Assign draft. Post remains blocked.`;

  return (
    <aside
      className={cn(
        "flex h-full min-h-0 flex-col border-r border-white/40 bg-white/25 backdrop-blur-[32px] backdrop-saturate-150",
        className,
      )}
    >
      <header className="shrink-0 px-4 pt-4 pb-2">
        <h2 className="text-[15px] font-semibold tracking-tight text-[#0d0d0d]">
          Customs agent
        </h2>
        {trace && (
          <p className="mt-1 font-mono text-[10px] text-[#807d73]">
            {providerLabel} · {Math.round(trace.totalLatencyMs)}ms
            {trace.mode === "mock"
              ? " · not billed"
              : trace.totalCostUsd !== null
                ? ` · ${formatUsd(trace.totalCostUsd)} est.`
                : ""}
          </p>
        )}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-3">
        <div className="relative flex gap-3 pb-4">
          <span
            aria-hidden
            className="absolute top-5 bottom-0 left-[9px] w-px bg-[#d8d4c8]"
          />
          <span className="relative z-[1] mt-0.5 flex size-[18px] shrink-0 items-center justify-center rounded-full bg-[#3b82f6] text-[10px] font-bold text-white">
            ✓
          </span>
          <p className="text-[13px] font-medium text-[#0d0d0d]">
            Created HS classification draft
          </p>
        </div>

        {!trace && (
          <div className="relative flex gap-3 pb-4">
            <span className="relative z-[1] mt-0.5 flex size-[18px] shrink-0 items-center justify-center rounded-full border border-dashed border-[#ccc9ba] text-[10px] text-[#807d73]">
              ·
            </span>
            <div className="space-y-2">
              <p className="text-[13px] text-[#66645c]">
                Waiting for hierarchical Choice over the pinned HS 2022 tree…
              </p>
              {history.length > 0 && (
                <ul className="space-y-1">
                  {history.map((item) => (
                    <li
                      key={`${item.query}-${item.latencyMs}`}
                      className="truncate font-mono text-[10px] text-[#807d73]"
                    >
                      {item.query} ({Math.round(item.latencyMs)}ms)
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}

        {trace?.steps.map((step, i) => (
          <TrailStepCard
            key={step.id}
            step={step}
            isLast={i === trace.steps.length - 1 && !suggestionHs}
          />
        ))}

        {suggestionHs && (
          <div className="relative flex gap-3 pb-2">
            <span className="relative z-[1] mt-0.5 flex size-[18px] shrink-0 items-center justify-center rounded-full bg-[#3b82f6] text-[10px] font-bold text-white">
              ✓
            </span>
            <div className="space-y-1.5">
              <p className="text-[13px] font-medium text-[#0d0d0d]">
                Found Matching HS codes
              </p>
              <div className="rounded-xl border border-white/60 bg-white/55 px-3 py-2.5 backdrop-blur-md">
                <p className="text-[10px] font-medium uppercase tracking-wide text-[#807d73]">
                  Suggested from description
                </p>
                <p className="font-mono text-[13px] font-semibold text-[#0d0d0d]">
                  {suggestionHs}
                </p>
                <p className="mt-0.5 text-[12px] leading-snug text-[#66645c]">
                  {suggestionDescription}
                </p>
                {suggestionConfidence != null && (
                  <p className="mt-1 text-[11px] text-[#807d73]">
                    {(suggestionConfidence * 100).toFixed(0)}%+ confidence
                  </p>
                )}
                {suggestionVerification && (
                  <p
                    className={
                      suggestionVerification.passed
                        ? "mt-1 text-[11px] text-[#807d73]"
                        : "mt-1 text-[11px] font-medium text-amber-800"
                    }
                  >
                    Verification {(suggestionVerification.matchProbability * 100).toFixed(0)}% ·{" "}
                    {suggestionVerification.passed ? "pass" : "fail"}
                  </p>
                )}
              </div>
              {documentStated && (
                <div
                  className={
                    documentStated.disagreesWithSuggestion
                      ? "rounded-xl border border-amber-400/50 bg-amber-50/70 px-3 py-2.5"
                      : "rounded-xl border border-white/60 bg-white/45 px-3 py-2.5"
                  }
                >
                  <p className="text-[10px] font-medium uppercase tracking-wide text-[#807d73]">
                    Stated on document
                  </p>
                  <p className="font-mono text-[13px] font-semibold text-[#0d0d0d]">
                    {documentStated.rawDigits}
                    <span className="ml-1.5 font-sans text-[11px] font-normal text-[#807d73]">
                      → HS6 {documentStated.hs6}
                      {!documentStated.inTaxonomy ? " (not in pinned tree)" : ""}
                    </span>
                  </p>
                  {documentStated.description && (
                    <p className="mt-0.5 text-[12px] leading-snug text-[#66645c]">
                      {documentStated.description}
                    </p>
                  )}
                  {documentStated.disagreesWithSuggestion && (
                    <p className="mt-1.5 text-[11px] font-medium text-amber-800">
                      Disagreement — suggestion follows the goods description;
                      printed codes may be misclassified.
                    </p>
                  )}
                </div>
              )}
              <p className="text-[12px] leading-snug text-[#66645c]">
                {missingNote}
              </p>
            </div>
          </div>
        )}

        {!suggestionHs && (
          <p className="mt-1 text-[12px] leading-snug text-[#66645c]">
            {missingNote}
          </p>
        )}

        {query ? (
          <p className="mt-3 line-clamp-2 text-[11px] italic text-[#807d73]">
            &ldquo;{query}&rdquo;
          </p>
        ) : null}

        {trace && (
          <p className="mt-3 text-[10px] leading-snug text-[#807d73]">
            {trace.costNote}
          </p>
        )}
      </div>

      <form
        className="shrink-0 border-t border-white/40 p-3"
        onSubmit={(e) => {
          e.preventDefault();
          onCommandSubmit();
        }}
      >
        <div className="flex items-center gap-2 rounded-full border border-white/55 bg-white/50 px-3 py-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.75)] backdrop-blur-md">
          <span className="text-sm text-[#807d73]" aria-hidden>
            ✦
          </span>
          <input
            value={command}
            onChange={(e) => onCommandChange(e.target.value)}
            placeholder="Describe what you'd like to do."
            className="min-w-0 flex-1 bg-transparent text-[13px] text-[#0d0d0d] outline-none placeholder:text-[#807d73]"
          />
        </div>
      </form>
    </aside>
  );
}
