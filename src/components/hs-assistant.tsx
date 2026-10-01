"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type DragEvent,
} from "react";
import { Button } from "@/components/ui/button";
import type { AssignmentRecord } from "@/lib/assignments";
import {
  parseDoc,
  parseLineFields,
  type LineFields,
  type ParsedDocFields,
} from "@/lib/extract/doc-fields";
import type { LineItemSuggestion } from "@/lib/hs/types";
import { buildEntryDraft } from "@/lib/review/entry-draft";
import {
  assessLine,
  buildRationale,
  type LineAssessment,
} from "@/lib/review/exceptions";
import { SAMPLE_DOCUMENTS } from "@/lib/samples";
import { type DecisionTrace } from "@/lib/typesafe/trace";
import { AgentTrail } from "@/components/agent-trail";

interface MetaResponse {
  judgmentMode: "typesafe" | "mock";
  taxonomy: {
    version: string;
    nodeCount: number;
    chapters: number;
    maxBranching: number;
  };
}

interface CommandResponse {
  routed: {
    command: string;
    confidence: number;
    judgmentMode: string;
  };
  gate: {
    command: string;
    confidence: number;
    allowed: boolean;
    blockedReason?: string;
    message: string;
    requiresHumanConfirm: boolean;
  };
  trace?: DecisionTrace;
}

type CenterTab = "fields" | "lines";
type LineFilter = "all" | "exceptions";

interface AssignedHs {
  hscode: string;
  description: string;
}

interface ReviewRow {
  item: LineItemSuggestion;
  fields: LineFields;
  assessment: LineAssessment;
}

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

/** "Commercial invoice — portable computers" → "Portable computers" (the doc type shows in the preview). */
function sampleLabel(title: string): string {
  const subject = title.split("—")[1]?.trim();
  return subject ? subject[0]!.toUpperCase() + subject.slice(1) : title;
}

function reviewRows(
  items: LineItemSuggestion[],
  doc: ParsedDocFields,
): ReviewRow[] {
  const multiLine = items.length > 1;
  return items.map((item) => {
    const fields = parseLineFields(item.lineText, doc, multiLine);
    return { item, fields, assessment: assessLine(item.suggestion, fields) };
  });
}

function downloadJson(fileName: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke later — Safari can cancel a download whose blob URL is revoked synchronously.
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

function Sparkle({ className }: { className?: string }) {
  return (
    <span
      className={className}
      aria-hidden
      style={{ fontSize: "9px", lineHeight: 1 }}
    >
      ✦
    </span>
  );
}

function FieldCell({
  label,
  value,
  missing,
}: {
  label: string;
  value: string | null;
  missing?: boolean;
}) {
  return (
    <div className="min-w-0 space-y-1.5">
      <div className="flex items-center gap-1.5 text-[11px] text-[#807d73]">
        <Sparkle className="text-[#bfbcae]" />
        <span>{label}</span>
      </div>
      {missing || !value ? (
        <div className="relative flex h-8 items-center rounded-lg bg-[#eceae3]/90 px-2.5">
          <span className="text-[12px] font-medium text-[#7c3aed]">Missing</span>
          <span
            aria-hidden
            className="absolute top-0 right-0 size-0 border-t-[10px] border-l-[10px] border-t-[#7c3aed] border-l-transparent"
          />
        </div>
      ) : (
        <div className="flex h-8 items-center truncate rounded-lg bg-[#eceae3]/90 px-2.5 text-[12px] font-medium text-[#0d0d0d]">
          {value}
        </div>
      )}
    </div>
  );
}

function MissingTag() {
  return (
    <span className="relative inline-flex items-center rounded bg-[#f3e8ff] px-1.5 py-0.5 font-medium text-[#7c3aed]">
      Missing
      <span
        aria-hidden
        className="absolute top-0 right-0 size-0 border-t-[8px] border-l-[8px] border-t-[#7c3aed] border-l-transparent"
      />
    </span>
  );
}

function StatusPill({
  assigned,
  override,
  inReview,
  status,
}: {
  assigned: boolean;
  override: boolean;
  inReview: boolean;
  status: LineAssessment["status"];
}) {
  const [label, tone] = assigned
    ? [override ? "Assigned · override" : "Assigned", "bg-[#0d0d0d] text-white"]
    : inReview
      ? ["In review", "bg-sky-100 text-sky-900"]
      : status === "ready"
        ? ["Ready", "bg-emerald-100 text-emerald-900"]
        : ["Needs review", "bg-amber-100 text-amber-900"];
  return (
    <span
      className={`inline-flex rounded-xl px-2 py-0.5 text-[11px] leading-tight font-medium ${tone}`}
    >
      {label}
    </span>
  );
}

export function HsAssistant() {
  const [text, setText] = useState(SAMPLE_DOCUMENTS[0]!.text);
  const [sampleId, setSampleId] = useState(SAMPLE_DOCUMENTS[0]!.id);
  const [meta, setMeta] = useState<MetaResponse | null>(null);
  const [items, setItems] = useState<LineItemSuggestion[]>([]);
  const [selectedItem, setSelectedItem] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [command, setCommand] = useState("");
  const [commandResult, setCommandResult] = useState<CommandResponse | null>(
    null,
  );
  const [reviewRequested, setReviewRequested] = useState<
    Record<number, boolean>
  >({});
  const [isPending, startTransition] = useTransition();
  const [loadingSuggest, setLoadingSuggest] = useState(false);
  const [activeTrace, setActiveTrace] = useState<DecisionTrace | null>(null);
  const [traceQuery, setTraceQuery] = useState("");
  const [traceHistory, setTraceHistory] = useState<
    Array<{ query: string; latencyMs: number }>
  >([]);
  const [assignedHs, setAssignedHs] = useState<Record<number, AssignedHs>>(
    {},
  );
  const [assigning, setAssigning] = useState(false);
  const [centerTab, setCenterTab] = useState<CenterTab>("fields");
  const [lineFilter, setLineFilter] = useState<LineFilter>("all");
  const [headersOpen, setHeadersOpen] = useState(true);
  const [linesOpen, setLinesOpen] = useState(true);
  const [loadingExtract, setLoadingExtract] = useState(false);
  const [docLabel, setDocLabel] = useState(SAMPLE_DOCUMENTS[0]!.title);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);

  const fields = useMemo(() => parseDoc(text), [text]);

  /** Per-line entry fields + exception flags (review-by-exception). */
  const rows = useMemo(() => reviewRows(items, fields), [items, fields]);

  /** The suggestion under review: selected goods line, or nothing before Suggest. */
  const suggestion = items[selectedItem]?.suggestion ?? null;
  const selectedRow = rows[selectedItem] ?? null;

  /** HS is Missing until a human assigns a draft for this goods line. */
  const hsMissing = !assignedHs[selectedItem];
  const lineHasException = hsMissing || !fields.origin || !fields.qty;

  const headerFieldCount = 10;
  const headerFilled = [
    fields.mode,
    fields.vessel,
    fields.voyageNo,
    fields.shipmentDate,
    fields.masterBill,
    fields.seller,
    fields.buyer,
    fields.invoiceNo,
    fields.origin,
    fields.weight,
  ].filter(Boolean).length;

  const linesTotal = Math.max(items.length, 1);
  const linesComplete = items.filter((it) => assignedHs[it.index]).length;
  /** Unassigned lines a human must look at; ready lines can be bulk-approved. */
  const isException = (row: ReviewRow) =>
    !assignedHs[row.item.index] &&
    (row.assessment.status === "needs_review" ||
      Boolean(reviewRequested[row.item.index]));
  const exceptionRows = rows.filter(isException);
  const readyRows = rows.filter(
    (r) => !assignedHs[r.item.index] && !isException(r),
  );
  const exceptionCount =
    items.length > 0 ? exceptionRows.length : lineHasException ? 1 : 0;
  const allAssigned = items.length > 0 && linesComplete === items.length;
  const workflowStatus =
    items.length === 0
      ? "To do"
      : allAssigned
        ? "Ready to file"
        : exceptionRows.length > 0
          ? "Needs review"
          : "Ready for approval";

  function publishTrace(trace: DecisionTrace, queryLabel: string) {
    if (activeTrace) {
      const prevQuery = traceQuery || activeTrace.operation;
      setTraceHistory((h) =>
        [
          { query: prevQuery, latencyMs: activeTrace.totalLatencyMs },
          ...h,
        ].slice(0, 4),
      );
    }
    setActiveTrace(trace);
    setTraceQuery(queryLabel);
  }

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/meta");
        const data = (await res.json()) as MetaResponse;
        setMeta(data);
      } catch {
        setError("Could not load taxonomy metadata.");
      }
    })();
  }, []);

  async function runSuggest() {
    setError(null);
    setStatus(null);
    setLoadingSuggest(true);
    try {
      const res = await fetch("/api/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, verify: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Suggest failed");
      const newItems = (data.items ?? [
        {
          index: 0,
          lineText: text,
          suggestion: data.suggestion,
          trace: data.trace,
        },
      ]) as LineItemSuggestion[];
      setItems(newItems);
      setSelectedItem(0);

      const labels = newItems.map(
        (it) => `line ${it.index + 1}: ${it.lineText.slice(0, 60)}`,
      );
      const priorEntries = newItems.slice(1).map((it) => ({
        query: labels[it.index]!,
        latencyMs: it.trace.totalLatencyMs,
      }));
      setTraceHistory((h) =>
        [
          ...(activeTrace
            ? [
                {
                  query: traceQuery || activeTrace.operation,
                  latencyMs: activeTrace.totalLatencyMs,
                },
              ]
            : []),
          ...priorEntries,
          ...h,
        ].slice(0, 4),
      );
      setActiveTrace(newItems[0]!.trace);
      setTraceQuery(labels[0]!);

      setCenterTab("lines");
      setLineFilter("all");
      const assessed = reviewRows(newItems, fields);
      const flagged = assessed.filter(
        (r) => r.assessment.status === "needs_review",
      );
      const mode = newItems[0]!.suggestion.judgmentMode;
      const lead =
        newItems.length > 1
          ? `Classified ${newItems.length} lines via ${mode}`
          : `Suggested ${newItems[0]!.suggestion.hscode} via ${mode}`;
      if (flagged.length === 0) {
        setStatus(
          `${lead} — no exceptions. Approve to assign draft${newItems.length > 1 ? "s" : ""}.`,
        );
      } else {
        const reasons = [
          ...new Set(
            flagged.flatMap((r) =>
              r.assessment.exceptions
                .filter((e) => e.severity === "review")
                .map((e) => e.title),
            ),
          ),
        ];
        setStatus(
          `${lead} — ${newItems.length - flagged.length} ready, ${flagged.length} need${flagged.length === 1 ? "s" : ""} review (${reasons.join(", ")}).`,
        );
      }
    } catch (e) {
      setItems([]);
      setError(e instanceof Error ? e.message : "Suggest failed");
    } finally {
      setLoadingSuggest(false);
    }
  }

  /** Human-confirmed draft assignment of one line (suggested code or an override). */
  async function assignLine(index: number, hscode: string): Promise<boolean> {
    const item = items[index];
    if (!item) return false;
    setError(null);
    try {
      const res = await fetch("/api/assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hscode,
          documentText: item.lineText,
          confidence: item.suggestion.confidence,
          humanConfirmed: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Assign failed");
      const record = data.assignment as AssignmentRecord;
      setAssignedHs((prev) => ({
        ...prev,
        [index]: { hscode: record.hscode, description: record.description },
      }));
      if (data.trace) {
        publishTrace(data.trace as DecisionTrace, `assign ${hscode}`);
      }
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Assign failed");
      return false;
    }
  }

  async function assignDraft(hscode?: string) {
    if (!suggestion) return;
    const code = hscode ?? suggestion.hscode;
    setAssigning(true);
    const ok = await assignLine(selectedItem, code);
    setAssigning(false);
    if (!ok) return;
    const override = code !== suggestion.hscode;
    setStatus(
      `Draft assigned ${code}${override ? ` (human override of ${suggestion.hscode})` : ""}${items.length > 1 ? ` on line ${selectedItem + 1}` : ""}. Customs Post / submit remains blocked.`,
    );
  }

  /** One click approves every line with no open exceptions — still human-gated. */
  async function approveReady() {
    const targets = readyRows;
    if (targets.length === 0) return;
    setAssigning(true);
    let done = 0;
    for (const row of targets) {
      if (await assignLine(row.item.index, row.item.suggestion.hscode)) done += 1;
    }
    setAssigning(false);
    const left = exceptionRows.length;
    setStatus(
      `Approved ${done} ready line${done === 1 ? "" : "s"}.` +
        (left > 0
          ? ` ${left} exception${left === 1 ? "" : "s"} left for review.`
          : " All lines assigned — export the entry draft."),
    );
  }

  async function requestReview() {
    setReviewRequested((prev) => ({ ...prev, [selectedItem]: true }));
    setStatus(
      `${items.length > 1 ? `Line ${selectedItem + 1}` : "Shipment"} sent to a senior broker for review. No code assigned.`,
    );
  }

  function exportEntryDraft() {
    if (!allAssigned) {
      setStatus("Assign every line before exporting the entry draft.");
      return;
    }
    const draft = buildEntryDraft(
      fields,
      rows.map((r) => ({
        lineNo: r.item.index + 1,
        fields: r.fields,
        suggestion: r.item.suggestion,
        assigned: assignedHs[r.item.index]!,
        exceptions: r.assessment.exceptions,
      })),
    );
    const ref = (fields.invoiceNo ?? "shipment").replace(/[^\w-]+/g, "_");
    downloadJson(`entry-draft-${ref}.json`, draft);
    setStatus(
      `Entry draft exported (${draft.lines.length} line${draft.lines.length === 1 ? "" : "s"}). Not filed — Post stays with the broker.`,
    );
  }

  async function runCommand() {
    setError(null);
    setCommandResult(null);
    try {
      const res = await fetch("/api/command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ utterance: command }),
      });
      const data = (await res.json()) as CommandResponse & { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Command failed");
      setCommandResult(data);
      if (data.trace) {
        publishTrace(data.trace, command.trim());
      }

      const cmd = data.gate.command;
      if (!data.gate.allowed) {
        setStatus(data.gate.message);
        return;
      }

      if (cmd === "suggest_hs") {
        await runSuggest();
      } else if (cmd === "assign_hs_draft") {
        setStatus(
          "Command routed to assign_hs_draft — confirm with Assign draft.",
        );
      } else if (cmd === "request_human_review") {
        await requestReview();
      } else if (cmd === "open_shipment") {
        setStatus("Shipment workspace focused (mock).");
      } else if (cmd === "prepare_declaration_draft") {
        exportEntryDraft();
      } else if (cmd === "submit_declaration") {
        setStatus(data.gate.message);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Command failed");
    }
  }

  function loadSample(id: string) {
    const sample = SAMPLE_DOCUMENTS.find((s) => s.id === id);
    if (!sample) return;
    setSampleId(id);
    setText(sample.text);
    setDocLabel(sample.title);
    resetClassification();
    setError(null);
    setStatus(`Sample: ${sample.title}`);
  }

  function resetClassification() {
    setItems([]);
    setSelectedItem(0);
    setAssignedHs({});
    setReviewRequested({});
  }

  async function ingestUploadedFile(file: File) {
    setError(null);
    setStatus(null);
    setLoadingExtract(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/extract", {
        method: "POST",
        body: form,
      });
      const data = (await res.json()) as {
        text?: string;
        fileName?: string;
        pageCount?: number;
        source?: string;
        error?: string;
        code?: string;
      };
      if (!res.ok) {
        throw new Error(data.error ?? "Could not extract document text");
      }
      const extracted = (data.text ?? "").trim();
      if (!extracted) {
        throw new Error(
          "No extractable text found. Try a text-based PDF, .txt, a clearer image, or paste the shipment text.",
        );
      }
      setText(extracted);
      setSampleId("");
      setDocLabel(data.fileName ?? file.name);
      resetClassification();
      const pages =
        data.pageCount && data.pageCount > 0
          ? ` · ${data.pageCount} page${data.pageCount === 1 ? "" : "s"}`
          : "";
      setStatus(
        `Loaded ${data.fileName ?? file.name}${pages}. Run Suggest HS6 to classify.`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setLoadingExtract(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function onDocDragEnter(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    dragDepth.current += 1;
    setDragOver(true);
  }

  function onDocDragLeave(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragOver(false);
  }

  function onDocDragOver(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
  }

  function onDocDrop(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    dragDepth.current = 0;
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void ingestUploadedFile(file);
  }

  const showLine =
    lineFilter === "all" || (lineFilter === "exceptions" && lineHasException);

  const sampleSelectValue =
    sampleId || (docLabel ? "__uploaded__" : SAMPLE_DOCUMENTS[0]!.id);

  return (
    <div className="mx-auto flex h-[min(920px,calc(100vh-2.5rem))] w-full max-w-[1400px] flex-col overflow-y-auto rounded-[28px] border border-white/50 bg-white/30 shadow-[0_24px_80px_-20px_rgba(13,13,13,0.45),inset_0_1px_0_rgba(255,255,255,0.65)] backdrop-blur-[40px] backdrop-saturate-150 lg:overflow-hidden">
      {/* Window chrome */}
      <header className="relative flex shrink-0 items-center gap-3 border-b border-white/40 px-4 py-2.5">
        <div className="flex items-center gap-1.5" aria-hidden>
          <span className="size-3 rounded-full bg-[#ff5f57]" />
          <span className="size-3 rounded-full bg-[#febc2e]" />
          <span className="size-3 rounded-full bg-[#28c840]" />
        </div>

        <div className="pointer-events-none absolute inset-x-0 flex justify-center">
          <div className="rounded-full border border-white/60 bg-white/70 px-4 py-1 text-[12px] text-[#66645c] shadow-sm backdrop-blur-md">
            app.jev.ai/declaration
          </div>
        </div>

        <div className="ml-auto flex items-center gap-2 sm:gap-3">
          <span className="hidden items-center gap-1.5 text-[12px] text-[#66645c] sm:inline-flex">
            <span aria-hidden>◷</span>
            ETA —
          </span>
          <span className="hidden items-center gap-1.5 text-[12px] text-[#66645c] md:inline-flex">
            <span
              className={`size-1.5 rounded-full ${
                workflowStatus === "Needs review"
                  ? "bg-amber-500"
                  : workflowStatus === "To do"
                    ? "bg-[#807d73]"
                    : "bg-emerald-500"
              }`}
            />
            {workflowStatus}
          </span>
          {meta && (
            <span className="hidden rounded-full border border-white/50 bg-white/40 px-2 py-0.5 font-mono text-[10px] text-[#66645c] lg:inline">
              {meta.judgmentMode} · HS {meta.taxonomy.version}
            </span>
          )}
          <Button
            type="button"
            disabled
            title="submit_declaration is always blocked"
            className="h-8 rounded-lg bg-[#0d0d0d] px-4 text-[13px] text-[#f9f9f6] opacity-50"
          >
            Post
          </Button>
        </div>
      </header>

      {/* Three panes */}
      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(240px,280px)_minmax(0,1fr)_minmax(200px,260px)]">
        {/* Left — Customs agent */}
        <AgentTrail
          className="hidden min-h-0 lg:flex"
          trace={activeTrace}
          query={traceQuery}
          history={traceHistory}
          suggestionHs={suggestion?.hscode ?? null}
          suggestionDescription={suggestion?.description ?? null}
          suggestionConfidence={suggestion?.confidence ?? null}
          suggestionVerification={suggestion?.verification ?? null}
          documentStated={suggestion?.documentStated ?? null}
          command={command}
          onCommandChange={setCommand}
          onCommandSubmit={() => void runCommand()}
        />

        {/* Center — Review declaration */}
        <section className="flex min-h-0 flex-col border-white/40 lg:border-x">
          <div className="flex shrink-0 flex-wrap items-end justify-between gap-3 border-b border-white/35 px-5 pt-4 pb-0">
            <div>
              <h1 className="text-[22px] font-semibold tracking-tight text-[#0d0d0d]">
                Review declaration
              </h1>
              <div className="mt-3 flex gap-5 text-[13px]">
                <button
                  type="button"
                  onClick={() => setCenterTab("fields")}
                  className={
                    centerTab === "fields"
                      ? "border-b-2 border-[#0d0d0d] pb-2.5 font-medium text-[#0d0d0d]"
                      : "border-b-2 border-transparent pb-2.5 text-[#807d73]"
                  }
                >
                  Fields {headerFilled}/{headerFieldCount}
                </button>
                <button
                  type="button"
                  onClick={() => setCenterTab("lines")}
                  className={
                    centerTab === "lines"
                      ? "border-b-2 border-[#0d0d0d] pb-2.5 font-medium text-[#0d0d0d]"
                      : "border-b-2 border-transparent pb-2.5 text-[#807d73]"
                  }
                >
                  Lines {linesComplete}/{linesTotal}
                </button>
              </div>
            </div>
            <div className="mb-2.5 flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                disabled={!text.trim() || loadingSuggest || loadingExtract}
                onClick={() => startTransition(() => void runSuggest())}
              >
                {loadingSuggest || isPending ? "Classifying…" : "Suggest HS6"}
              </Button>
              {readyRows.length > 0 && (
                <Button
                  type="button"
                  size="sm"
                  disabled={assigning}
                  title="Assign every line with no open exceptions (human-confirmed)"
                  onClick={() => void approveReady()}
                  className="bg-emerald-700 text-white hover:bg-emerald-800"
                >
                  Approve {readyRows.length} ready
                </Button>
              )}
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={!suggestion || assigning || !hsMissing}
                onClick={() => void assignDraft()}
              >
                {selectedRow?.assessment.status === "needs_review" && hsMissing
                  ? "Override & assign"
                  : "Assign draft"}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={items.length === 0 || !hsMissing}
                onClick={() => void requestReview()}
              >
                Request review
              </Button>
              {items.length > 0 && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={!allAssigned}
                  title={
                    allAssigned
                      ? "Download the customs entry draft (JSON) for your filing system"
                      : "Assign every line first"
                  }
                  onClick={exportEntryDraft}
                >
                  Export entry draft
                </Button>
              )}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            {(status || error || commandResult) && (
              <p
                className={`mb-3 text-[12px] ${error ? "text-red-700" : "text-[#66645c]"}`}
                role="status"
              >
                {error ??
                  status ??
                  (commandResult
                    ? `${commandResult.routed.command} · ${pct(commandResult.routed.confidence)} — ${commandResult.gate.message}`
                    : null)}
              </p>
            )}

            {/* Mobile agent trail summary */}
            <div className="mb-4 rounded-2xl border border-white/50 bg-white/35 p-3 lg:hidden">
              <p className="text-[13px] font-semibold text-[#0d0d0d]">
                Customs agent
              </p>
              <p className="mt-1 text-[12px] text-[#66645c]">
                {activeTrace
                  ? `${activeTrace.steps.length} steps · ${Math.round(activeTrace.totalLatencyMs)}ms`
                  : "Run Suggest HS6 to populate the trail."}
              </p>
            </div>

            {centerTab === "fields" && (
              <div className="mb-2">
                <button
                  type="button"
                  className="mb-3 flex items-center gap-1.5 text-[13px] font-medium text-[#0d0d0d]"
                  onClick={() => setHeadersOpen((v) => !v)}
                >
                  <span className="text-[#807d73]">
                    {headersOpen ? "▾" : "▸"}
                  </span>
                  Headers ({headerFieldCount})
                </button>
                {headersOpen && (
                  <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3 xl:grid-cols-4">
                    <FieldCell label="Mode" value={fields.mode} />
                    <FieldCell label="Vessel" value={fields.vessel} missing={!fields.vessel} />
                    <FieldCell
                      label="Voyage No."
                      value={fields.voyageNo}
                      missing={!fields.voyageNo}
                    />
                    <FieldCell
                      label="Shipment Date"
                      value={fields.shipmentDate}
                      missing={!fields.shipmentDate}
                    />
                    <FieldCell
                      label="Master Bill"
                      value={fields.masterBill}
                      missing={!fields.masterBill}
                    />
                    <FieldCell label="Seller" value={fields.seller} missing={!fields.seller} />
                    <FieldCell label="Buyer" value={fields.buyer} missing={!fields.buyer} />
                    <FieldCell
                      label="Invoice No."
                      value={fields.invoiceNo}
                      missing={!fields.invoiceNo}
                    />
                    <FieldCell label="Origin" value={fields.origin} missing={!fields.origin} />
                    <FieldCell label="Weight" value={fields.weight} missing={!fields.weight} />
                  </div>
                )}
              </div>
            )}

            {centerTab === "lines" && (
            <div>
              <button
                type="button"
                className="mb-3 flex items-center gap-1.5 text-[13px] font-medium text-[#0d0d0d]"
                onClick={() => setLinesOpen((v) => !v)}
              >
                <span className="text-[#807d73]">{linesOpen ? "▾" : "▸"}</span>
                Invoice Lines ({linesTotal})
              </button>

              {linesOpen && (
                <>
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setLineFilter("all")}
                      className={
                        lineFilter === "all"
                          ? "h-7 rounded-full bg-[#0d0d0d] px-2.5 text-[12px] text-white"
                          : "h-7 rounded-full bg-[#eceae3]/90 px-2.5 text-[12px] text-[#0d0d0d]"
                      }
                    >
                      All {linesTotal}
                    </button>
                    <button
                      type="button"
                      onClick={() => setLineFilter("exceptions")}
                      className={
                        lineFilter === "exceptions"
                          ? "h-7 rounded-full bg-[#0d0d0d] px-2.5 text-[12px] text-white"
                          : "h-7 rounded-full bg-[#eceae3]/90 px-2.5 text-[12px] text-[#0d0d0d]"
                      }
                    >
                      Exceptions {exceptionCount}
                    </button>
                    {items.length > 0 && (
                      <span className="text-[11px] text-[#807d73]">
                        {linesComplete} assigned · {readyRows.length} ready ·{" "}
                        {exceptionRows.length} to review
                      </span>
                    )}
                    <button
                      type="button"
                      className="ml-auto text-[12px] text-[#807d73] hover:text-[#0d0d0d]"
                      onClick={() => {
                        setLineFilter("all");
                        resetClassification();
                        setStatus(null);
                      }}
                    >
                      Clear
                    </button>
                  </div>

                  <div className="overflow-x-auto rounded-xl border border-white/45 bg-white/25 backdrop-blur-md">
                    <table className="w-full border-collapse text-left text-[12px]">
                      <thead>
                        <tr className="border-b border-white/40 text-[11px] text-[#807d73]">
                          <th className="px-2 py-2.5 font-medium">Origin</th>
                          <th className="px-2 py-2.5 font-medium">Description</th>
                          <th className="px-2 py-2.5 font-medium">HS Code</th>
                          <th className="px-2 py-2.5 font-medium">Qty</th>
                          <th className="px-2 py-2.5 font-medium">Amount</th>
                          <th className="px-2 py-2.5 font-medium">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {items.length > 0 ? (
                          lineFilter === "exceptions" &&
                          exceptionRows.length === 0 ? (
                            <tr>
                              <td
                                colSpan={6}
                                className="px-3 py-8 text-center text-[#807d73]"
                              >
                                No exceptions — every open line is ready to
                                approve.
                              </td>
                            </tr>
                          ) : (
                            rows.map((row) => {
                              const { item, fields: lf, assessment } = row;
                              const i = item.index;
                              const assigned = assignedHs[i];
                              if (lineFilter === "exceptions" && !isException(row)) {
                                return null;
                              }
                              const flags = assessment.exceptions.filter(
                                (e) => e.severity === "review",
                              );
                              const match =
                                item.suggestion.verification?.matchProbability;
                              return (
                                <tr
                                  key={i}
                                  onClick={() => {
                                    setSelectedItem(i);
                                    setActiveTrace(item.trace);
                                    setTraceQuery(
                                      `line ${i + 1}: ${item.lineText.slice(0, 60)}`,
                                    );
                                  }}
                                  className={`cursor-pointer border-b border-white/30 last:border-0 ${
                                    i === selectedItem ? "bg-white/40" : ""
                                  }`}
                                >
                                  <td className="px-2 py-3 align-top text-[#0d0d0d]">
                                    {lf.origin ?? <MissingTag />}
                                  </td>
                                  <td className="max-w-[220px] px-2 py-3 align-top text-[#0d0d0d]">
                                    <span className="line-clamp-2">
                                      {lf.description}
                                    </span>
                                    {!assigned && flags.length > 0 && (
                                      <p className="mt-1 text-[10px] text-amber-800">
                                        ⚠ {flags.map((e) => e.title).join(" · ")}
                                      </p>
                                    )}
                                  </td>
                                  <td className="px-2 py-3 align-top">
                                    {assigned ? (
                                      <span className="font-mono font-semibold text-[#0d0d0d]">
                                        {assigned.hscode}
                                      </span>
                                    ) : (
                                      <MissingTag />
                                    )}
                                    {!assigned && (
                                      <p className="mt-1 font-mono text-[10px] text-[#807d73]">
                                        <span className="block">
                                          suggested{" "}
                                          <span className="whitespace-nowrap">
                                            {item.suggestion.hscode}
                                          </span>
                                        </span>
                                        {match !== undefined && (
                                          <span className="block whitespace-nowrap">
                                            match {pct(match)}
                                          </span>
                                        )}
                                      </p>
                                    )}
                                  </td>
                                  <td className="px-2 py-3 align-top text-[#0d0d0d]">
                                    {lf.qty ?? <MissingTag />}
                                  </td>
                                  <td className="px-2 py-3 align-top text-[#0d0d0d]">
                                    {lf.amount ?? <MissingTag />}
                                  </td>
                                  <td className="px-2 py-3 align-top">
                                    <StatusPill
                                      assigned={Boolean(assigned)}
                                      override={
                                        Boolean(assigned) &&
                                        assigned!.hscode !== item.suggestion.hscode
                                      }
                                      inReview={Boolean(reviewRequested[i])}
                                      status={assessment.status}
                                    />
                                  </td>
                                </tr>
                              );
                            })
                          )
                        ) : showLine ? (
                          <tr className="border-b border-white/30 last:border-0">
                            <td className="px-2 py-3 align-top text-[#0d0d0d]">
                              {fields.origin ?? <MissingTag />}
                            </td>
                            <td className="max-w-[220px] px-2 py-3 align-top text-[#0d0d0d]">
                              <span className="line-clamp-2">
                                {fields.description ?? "—"}
                              </span>
                            </td>
                            <td className="px-2 py-3 align-top">
                              <MissingTag />
                            </td>
                            <td className="px-2 py-3 align-top text-[#0d0d0d]">
                              {fields.qty ?? <MissingTag />}
                            </td>
                            <td className="px-2 py-3 align-top text-[#0d0d0d]">
                              {fields.amount ?? <MissingTag />}
                            </td>
                            <td className="px-2 py-3 align-top text-[11px] text-[#807d73]">
                              Not classified
                            </td>
                          </tr>
                        ) : (
                          <tr>
                            <td
                              colSpan={6}
                              className="px-3 py-8 text-center text-[#807d73]"
                            >
                              No exceptions in the current filter.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>

                  {suggestion && selectedRow && (
                    <div className="mt-4 space-y-3 rounded-xl border border-white/45 bg-white/30 p-3 backdrop-blur-md">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <p className="text-[11px] font-medium tracking-wide text-[#807d73] uppercase">
                          Path · HS {suggestion.datasetVersion}
                          {items.length > 1
                            ? ` · Line ${selectedItem + 1} of ${items.length}`
                            : ""}
                        </p>
                        {suggestion.verification && (
                          <p
                            className={
                              suggestion.verification.passed
                                ? "text-[11px] text-[#807d73]"
                                : "text-[11px] font-medium text-amber-800"
                            }
                          >
                            Verified match{" "}
                            {pct(suggestion.verification.matchProbability)} ·{" "}
                            {suggestion.verification.passed ? "pass" : "fail"}
                          </p>
                        )}
                      </div>
                      <ol className="space-y-1">
                        {suggestion.path.map((step) => (
                          <li
                            key={step.hscode}
                            className="flex gap-2 text-[12px]"
                          >
                            <span className="w-14 shrink-0 font-mono font-medium">
                              {step.hscode}
                            </span>
                            <span className="min-w-0 text-[#66645c]">
                              <span className="line-clamp-1">
                                {step.description}
                              </span>
                            </span>
                          </li>
                        ))}
                      </ol>

                      {selectedRow.assessment.exceptions.length > 0 && (
                        <ul className="space-y-1.5">
                          {selectedRow.assessment.exceptions.map((e) => (
                            <li
                              key={e.code}
                              className={
                                e.severity === "review"
                                  ? "rounded-lg border border-amber-400/50 bg-amber-50/70 px-2.5 py-1.5 text-[11px] text-amber-900"
                                  : "rounded-lg border border-white/50 bg-white/40 px-2.5 py-1.5 text-[11px] text-[#66645c]"
                              }
                            >
                              <span className="font-medium">{e.title}</span> —{" "}
                              {e.detail}
                            </li>
                          ))}
                        </ul>
                      )}

                      <div className="rounded-lg bg-white/45 px-3 py-2.5">
                        <p className="mb-1.5 text-[11px] font-medium tracking-wide text-[#807d73] uppercase">
                          Why this code
                        </p>
                        <ul className="list-disc space-y-1 pl-4 text-[12px] leading-snug text-[#3a3a38]">
                          {buildRationale(
                            suggestion,
                            selectedRow.fields.description,
                          ).map((line) => (
                            <li key={line}>{line}</li>
                          ))}
                        </ul>
                      </div>

                      {hsMissing &&
                        (suggestion.runnerUp ||
                          (suggestion.documentStated?.inTaxonomy &&
                            suggestion.documentStated.disagreesWithSuggestion)) && (
                          <div className="flex flex-wrap items-center gap-2 text-[11px] text-[#807d73]">
                            <span>Broker override:</span>
                            {suggestion.runnerUp && (
                              <button
                                type="button"
                                disabled={assigning}
                                onClick={() =>
                                  void assignDraft(suggestion.runnerUp!.hscode)
                                }
                                className="h-7 rounded-full border border-[#ccc9ba]/80 bg-white/50 px-2.5 text-[#0d0d0d] hover:bg-white/80"
                              >
                                Assign runner-up{" "}
                                <span className="font-mono">
                                  {suggestion.runnerUp.hscode}
                                </span>
                              </button>
                            )}
                            {suggestion.documentStated?.inTaxonomy &&
                              suggestion.documentStated.disagreesWithSuggestion && (
                                <button
                                  type="button"
                                  disabled={assigning}
                                  onClick={() =>
                                    void assignDraft(
                                      suggestion.documentStated!.hs6,
                                    )
                                  }
                                  className="h-7 rounded-full border border-[#ccc9ba]/80 bg-white/50 px-2.5 text-[#0d0d0d] hover:bg-white/80"
                                >
                                  Keep printed{" "}
                                  <span className="font-mono">
                                    {suggestion.documentStated.hs6}
                                  </span>
                                </button>
                              )}
                          </div>
                        )}
                    </div>
                  )}
                </>
              )}
            </div>
            )}
          </div>
        </section>

        {/* Right — document preview */}
        <aside
          className="relative flex min-h-0 flex-col bg-white/15 backdrop-blur-[24px]"
          onDragEnter={onDocDragEnter}
          onDragLeave={onDocDragLeave}
          onDragOver={onDocDragOver}
          onDrop={onDocDrop}
        >
          <div className="flex items-center justify-between gap-2 border-b border-white/35 px-3 py-2.5">
            <select
              value={sampleSelectValue}
              onChange={(e) => {
                const v = e.target.value;
                if (v === "__uploaded__") return;
                loadSample(v);
              }}
              className="min-w-0 flex-1 truncate rounded-md border-0 bg-transparent text-[13px] font-medium text-[#0d0d0d] outline-none"
              aria-label="Document source"
            >
              {!sampleId && (
                <option value="__uploaded__">
                  {docLabel.length > 28 ? `${docLabel.slice(0, 28)}…` : docLabel}
                </option>
              )}
              {SAMPLE_DOCUMENTS.map((s) => (
                <option key={s.id} value={s.id}>
                  {sampleLabel(s.title)}
                </option>
              ))}
            </select>
            <label
              className={`cursor-pointer text-[11px] ${
                loadingExtract
                  ? "text-[#bfbcae]"
                  : "text-[#807d73] hover:text-[#0d0d0d]"
              }`}
            >
              {loadingExtract ? "Extracting…" : "Upload"}
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                disabled={loadingExtract}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void ingestUploadedFile(file);
                }}
              />
            </label>
          </div>
          <div className="relative min-h-0 flex-1 overflow-y-auto p-3">
            {dragOver && (
              <div className="pointer-events-none absolute inset-3 z-10 flex items-center justify-center rounded-lg border-2 border-dashed border-[#0d0d0d]/35 bg-[#f9f9f6]/85 text-[13px] font-medium text-[#0d0d0d]">
                Drop any file to extract text
              </div>
            )}
            <div className="min-h-full rounded-lg bg-white p-4 shadow-[0_12px_40px_-18px_rgba(13,13,13,0.35)]">
              {loadingExtract ? (
                <p className="font-mono text-[11px] text-[#807d73]">
                  Extracting text from document…
                </p>
              ) : (
                <textarea
                  value={text}
                  onChange={(e) => {
                    setText(e.target.value);
                    resetClassification();
                    if (sampleId) {
                      setSampleId("");
                      setDocLabel("Pasted text");
                    }
                  }}
                  placeholder="Paste shipment text, or upload a PDF, image, or .txt…"
                  className="min-h-[420px] w-full resize-none border-0 bg-transparent font-mono text-[11px] leading-relaxed text-[#1a1a1a] outline-none placeholder:text-[#bfbcae]"
                  spellCheck={false}
                />
              )}
            </div>
          </div>
          <div className="flex items-center justify-between border-t border-white/35 px-3 py-2 text-[11px] text-[#807d73]">
            <span>
              {text.trim()
                ? `${text.trim().split(/\s+/).length} words`
                : "Empty"}
            </span>
            <span>Any file</span>
          </div>
        </aside>
      </div>
    </div>
  );
}
