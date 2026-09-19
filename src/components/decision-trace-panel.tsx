"use client";

import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import {
  formatLatency,
  formatUsd,
  type DecisionTrace,
  type TraceStep,
} from "@/lib/typesafe/trace";

interface DecisionTracePanelProps {
  trace: DecisionTrace | null;
  query?: string;
  history?: Array<{ query: string; latencyMs: number }>;
  className?: string;
}

function badgeKind(step: TraceStep): {
  label: string;
  className: string;
} {
  switch (step.kind) {
    case "choice_child":
    case "command_route":
      return {
        label: "choice",
        className:
          "bg-[var(--raft-stone)] text-[var(--raft-ink)] border-[var(--raft-line)]",
      };
    case "verification_noul":
      return {
        label: "noul",
        className: "bg-[#e8f0e6] text-[#2f5d3a] border-[#c5d9c2]",
      };
    case "assign_draft":
      return {
        label: "assign",
        className:
          "bg-white text-[var(--raft-muted-2)] border-[var(--raft-line)]",
      };
    case "skipped_singleton":
      return {
        label: "skip",
        className:
          "bg-[var(--raft-bg)] text-[var(--raft-muted)] border-[var(--raft-line)]",
      };
    default: {
      const _exhaustive: never = step.kind;
      return _exhaustive;
    }
  }
}

function confidenceTone(score: number | null): string {
  if (score === null) {
    return "bg-[var(--raft-stone)] text-[var(--raft-muted-2)]";
  }
  if (score >= 0.9) return "bg-[#e8f0e6] text-[#2f5d3a]";
  if (score >= 0.5) {
    return "bg-[color-mix(in_srgb,var(--raft-amber)_22%,white)] text-[var(--raft-ink)]";
  }
  return "bg-[#f5e6e4] text-[#8a3b32]";
}

function stepConfidence(step: TraceStep): number | null {
  const response = step.response as Record<string, unknown> | null;
  if (!response) return null;
  if (typeof response.confidence === "number") return response.confidence;
  if (typeof response.noul === "number") return response.noul;
  return null;
}

function stepTitle(step: TraceStep): string {
  return step.request.instructions.split("(")[0]!.trim() || step.label;
}

function probabilityLogs(step: TraceStep): Array<{
  label: string;
  value: string;
  primary: boolean;
}> {
  const response = step.response as Record<string, unknown> | null;
  if (!response) return [];

  if (Array.isArray(response.probabilitiesTop)) {
    const rows = response.probabilitiesTop as Array<{
      code: string;
      p: number;
    }>;
    const winner =
      typeof response.choice === "string" ? response.choice : rows[0]?.code;
    return rows.map((row) => ({
      label: row.code,
      value: row.p.toFixed(2),
      primary: row.code === winner,
    }));
  }

  if (response.probabilities && typeof response.probabilities === "object") {
    const entries = Object.entries(
      response.probabilities as Record<string, number>,
    ).sort((a, b) => b[1] - a[1]);
    const winner =
      typeof response.choice === "string" ? response.choice : entries[0]?.[0];
    return entries.slice(0, 8).map(([k, v]) => ({
      label: k,
      value: v.toFixed(2),
      primary: k === winner,
    }));
  }

  if (typeof response.noul === "number") {
    return [
      {
        label: "probability",
        value: `${(response.noul * 100).toFixed(1)}%`,
        primary: response.noul >= 0.55,
      },
    ];
  }

  return [];
}

function TraceStepRow({ step }: { step: TraceStep }) {
  const [expanded, setExpanded] = useState(false);
  const badge = badgeKind(step);
  const confidence = stepConfidence(step);
  const logs = probabilityLogs(step);

  return (
    <div
      className={cn(
        "group border-b border-white/35 px-1 py-2.5 transition-colors hover:bg-white/25",
        step.kind === "skipped_singleton" && "opacity-60",
      )}
    >
      <button
        type="button"
        className="flex w-full items-start gap-2.5 text-left"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <span
          className={cn(
            "mt-0.5 shrink-0 rounded border px-1.5 py-0.5 font-mono text-[10px] font-medium tracking-wide",
            badge.className,
          )}
        >
          {expanded ? "−" : "+"} {badge.label}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium leading-snug text-[var(--raft-ink)]">
            {stepTitle(step)}
          </p>
          {logs.length > 0 && (
            <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-[11px] leading-relaxed">
              {logs.map((log) => (
                <span
                  key={`${log.label}-${log.value}`}
                  className={
                    log.primary
                      ? "font-semibold text-[var(--raft-ink)]"
                      : "text-[var(--raft-muted)]"
                  }
                >
                  {log.label} {log.value}
                </span>
              ))}
            </p>
          )}
          {!expanded && (
            <p className="mt-1 font-mono text-[10px] text-[var(--raft-muted)]">
              {Math.round(step.latencyMs)}ms
              {step.costSource === "mock"
                ? " · mock"
                : step.costUsd !== null
                  ? ` · ${formatUsd(step.costUsd)} est.`
                  : ""}
            </p>
          )}
        </div>
        {confidence !== null && (
          <span
            className={cn(
              "mt-0.5 shrink-0 rounded-md px-1.5 py-0.5 font-mono text-[11px] font-medium",
              confidenceTone(confidence),
            )}
          >
            {confidence.toFixed(2)}
          </span>
        )}
      </button>

      {expanded && (
        <div className="mt-2 ml-1 space-y-2 border-l-2 border-[var(--raft-line)] pl-3">
          <div className="grid gap-1 font-mono text-[11px] text-[var(--raft-muted-2)] sm:grid-cols-2">
            <div>
              <span className="text-[var(--raft-muted)]">call </span>
              {step.request.endpoint}
            </div>
            <div>
              <span className="text-[var(--raft-muted)]">speed </span>
              {formatLatency(step.latencyMs)}
            </div>
            <div>
              <span className="text-[var(--raft-muted)]">cost </span>
              {step.costLabel}
            </div>
            {step.usage && (
              <div>
                <span className="text-[var(--raft-muted)]">tokens </span>
                in {step.usage.input_tokens} · out {step.usage.output_tokens}
              </div>
            )}
            {step.model && (
              <div>
                <span className="text-[var(--raft-muted)]">model </span>
                {step.model}
              </div>
            )}
            {step.request.parentCode && (
              <div>
                <span className="text-[var(--raft-muted)]">parent </span>
                {step.request.parentCode}
              </div>
            )}
          </div>
          <div>
            <p className="raft-eyebrow mb-1">Logs</p>
            <ul className="space-y-0.5 font-mono text-[11px] text-[var(--raft-muted-2)]">
              {step.logs.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
          <details className="rounded-lg border border-white/40 bg-white/30 p-2 backdrop-blur-sm">
            <summary className="cursor-pointer text-[11px] font-medium text-[var(--raft-muted-2)]">
              Request payload
            </summary>
            <pre className="mt-2 max-h-48 overflow-auto text-[10px] leading-relaxed text-[var(--raft-ink)]">
              {JSON.stringify(step.request, null, 2)}
            </pre>
          </details>
          <details className="rounded-lg border border-white/40 bg-white/30 p-2 backdrop-blur-sm">
            <summary className="cursor-pointer text-[11px] font-medium text-[var(--raft-muted-2)]">
              Response
            </summary>
            <pre className="mt-2 max-h-48 overflow-auto text-[10px] leading-relaxed text-[var(--raft-ink)]">
              {JSON.stringify(step.response, null, 2)}
            </pre>
          </details>
        </div>
      )}
    </div>
  );
}

export function DecisionTracePanel({
  trace,
  query,
  history = [],
  className,
}: DecisionTracePanelProps) {
  const promptCount = useMemo(() => {
    if (!trace) return 0;
    return trace.steps.filter(
      (s) =>
        s.kind === "choice_child" ||
        s.kind === "verification_noul" ||
        s.kind === "command_route",
    ).length;
  }, [trace]);

  const providerLabel = trace?.mode === "typesafe" ? "TypeSafe" : "Mock";

  return (
    <aside
      className={cn(
        "flex h-full min-h-0 flex-col bg-[var(--raft-panel)] backdrop-blur-[36px] backdrop-saturate-150",
        className,
      )}
    >
      <header className="border-b border-white/40 bg-white/20 px-4 py-4 backdrop-blur-md">
        <p className="raft-eyebrow mb-1">Activity</p>
        <h2 className="text-[17px] font-semibold tracking-tight text-[var(--raft-ink)]">
          Decision Trace
        </h2>
        {query ? (
          <p className="mt-1.5 text-[13px] text-[var(--raft-muted)] italic">
            &ldquo;{query.length > 120 ? `${query.slice(0, 120)}…` : query}
            &rdquo;
          </p>
        ) : null}

        {trace ? (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-[13px]">
            <span className="rounded-full border border-white/30 bg-[var(--raft-ink)] px-2.5 py-0.5 font-mono text-[11px] font-medium text-[var(--raft-cta-fg)]">
              {providerLabel} {Math.round(trace.totalLatencyMs)}ms
            </span>
            {trace.mode === "mock" ? (
              <span className="rounded-full border border-white/50 bg-white/35 px-2.5 py-0.5 font-mono text-[11px] text-[var(--raft-muted-2)] backdrop-blur-md">
                mock — not billed
              </span>
            ) : trace.totalCostUsd !== null ? (
              <span className="rounded-full border border-white/50 bg-white/35 px-2.5 py-0.5 font-mono text-[11px] text-[var(--raft-muted-2)] backdrop-blur-md">
                {formatUsd(trace.totalCostUsd)} est. (input tokens)
              </span>
            ) : (
              <span className="rounded-full border border-white/50 bg-white/35 px-2.5 py-0.5 font-mono text-[11px] text-[var(--raft-muted)] backdrop-blur-md">
                cost n/a
              </span>
            )}
            {trace.totalInputTokens > 0 && (
              <span className="font-mono text-[11px] text-[var(--raft-muted)]">
                {trace.totalInputTokens} in · {trace.totalOutputTokens} out
              </span>
            )}
          </div>
        ) : null}

        {history.length > 0 && (
          <ul className="mt-3 space-y-1 border-t border-white/35 pt-2">
            {history.map((item) => (
              <li
                key={`${item.query}-${item.latencyMs}`}
                className="truncate font-mono text-[12px] text-[var(--raft-muted)]"
              >
                &ldquo;{item.query}&rdquo; ({Math.round(item.latencyMs)}ms)
              </li>
            ))}
          </ul>
        )}
      </header>

      <div className="flex-1 overflow-y-auto px-3 py-1">
        {!trace && (
          <p className="px-1 py-16 text-center text-sm text-[var(--raft-muted)]">
            Submit a request to see the decision trace.
          </p>
        )}

        {trace &&
          trace.steps.map((step) => (
            <TraceStepRow key={step.id} step={step} />
          ))}
      </div>

      {trace && (
        <footer className="border-t border-white/40 bg-white/15 px-4 py-2.5 font-mono text-[11px] text-[var(--raft-muted)] backdrop-blur-md">
          {providerLabel} · {promptCount} prompts ·{" "}
          {Math.round(trace.totalLatencyMs)}ms
          {trace.mode === "mock"
            ? " · mock"
            : trace.totalCostUsd !== null
              ? ` · ${formatUsd(trace.totalCostUsd)} est.`
              : ""}
          <p className="mt-1 font-sans text-[10px] leading-snug text-[var(--raft-muted)] normal-case">
            {trace.costNote}
          </p>
        </footer>
      )}
    </aside>
  );
}
