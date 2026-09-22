"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type DragEvent,
  type ReactNode,
} from "react";
import { Button } from "@/components/ui/button";
import type { AssignmentRecord } from "@/lib/assignments";
import { goodsTextForClassification } from "@/lib/hs/stated-codes";
import type { HsSuggestion } from "@/lib/hs/types";
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

interface ParsedDocFields {
  mode: string | null;
  vessel: string | null;
  voyageNo: string | null;
  shipmentDate: string | null;
  masterBill: string | null;
  seller: string | null;
  buyer: string | null;
  invoiceNo: string | null;
  origin: string | null;
  description: string | null;
  qty: string | null;
  amount: string | null;
  weight: string | null;
}

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

/** Whitespace before an inline meta label — cuts a captured value short. */
const INLINE_META_RE =
  /\s+(?=\b(?:Qty|Quantity|COUNTRY\s+OF\s+ORIGIN|ORIGIN|HARMONIS[E]?D\s+CODE|HARMONIZED\s+CODE|HS\s*CODE|HS\s*#|UNIT\s+VALUE|UNIT\s+PRICE|NET\s+WEIGHT|GROSS\s+WEIGHT)\b)/i;

function parseDoc(text: string): ParsedDocFields {
  const grab = (re: RegExp): string | null => {
    const m = text.match(re);
    return m?.[1]?.trim() || null;
  };

  // Like grab, but trims the captured value at the first inline meta label.
  const grabField = (re: RegExp): string | null => {
    const m = text.match(re);
    const value = m?.[1]?.split(INLINE_META_RE)[0]?.trim();
    return value || null;
  };

  const description =
    grabField(/Description of goods:\s*([^\n]+)/i) ||
    grabField(/Contents:\s*([^\n]+)/i) ||
    grabField(/Commodity:\s*([^\n]+)/i) ||
    (() => {
      const goods = goodsTextForClassification(text);
      return goods && goods.length < 200 ? goods : null;
    })();

  return {
    mode: grab(/Mode:\s*([^\n]+)/i) || (text.includes("BILL OF LADING") ? "Ocean" : "Air"),
    vessel: grab(/Vessel:\s*([^\n]+)/i),
    voyageNo: grab(/Voyage(?:\s*No\.?)?:\s*([^\n]+)/i),
    shipmentDate: grab(/(?:Shipment Date|Date):\s*([^\n]+)/i),
    masterBill: grab(/(?:Master Bill|B\/L|BOL)[:\s#-]*([A-Z0-9-]+)/i),
    seller: grab(/Seller:\s*([^\n]+)/i),
    buyer: grab(/Buyer:\s*([^\n]+)/i),
    invoiceNo:
      grab(/Invoice No:\s*([^\n]+)/i) ||
      grab(/Shipment:\s*([^\n]+)/i),
    origin:
      grabField(/Country of origin:\s*([^\n]+)/i) ||
      grabField(/Origin:\s*([^\n]+)/i),
    description,
    qty:
      grabField(/Quantity:\s*([^\n]+)/i) ||
      grab(/\bQty:?\s*(\d[\d,]*)/i) ||
      grab(/(\d[\d,]*)\s*(?:units|unit)\b(?!\s+(?:value|price))/i) ||
      grab(/(\d[\d,]*)\s*pcs/i) ||
      grab(/(\d[\d,]*)\s*bags/i),
    amount: grabField(/(?:Amount|Value|UNIT\s+VALUE):\s*([^\n]+)/i),
    weight:
      grabField(/Net weight:\s*([^\n]+)/i) ||
      grabField(/Gross weight:\s*([^\n]+)/i),
  };
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

function ValuePill({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex h-7 items-center rounded-full bg-[#eceae3]/90 px-2.5 text-[12px] text-[#0d0d0d]">
      {children}
    </span>
  );
}

export function HsAssistant() {
  const [text, setText] = useState(SAMPLE_DOCUMENTS[0]!.text);
  const [sampleId, setSampleId] = useState(SAMPLE_DOCUMENTS[0]!.id);
  const [meta, setMeta] = useState<MetaResponse | null>(null);
  const [suggestion, setSuggestion] = useState<HsSuggestion | null>(null);
  const [assignments, setAssignments] = useState<AssignmentRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [command, setCommand] = useState("");
  const [commandResult, setCommandResult] = useState<CommandResponse | null>(
    null,
  );
  const [reviewQueued, setReviewQueued] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [loadingSuggest, setLoadingSuggest] = useState(false);
  const [activeTrace, setActiveTrace] = useState<DecisionTrace | null>(null);
  const [traceQuery, setTraceQuery] = useState("");
  const [traceHistory, setTraceHistory] = useState<
    Array<{ query: string; latencyMs: number }>
  >([]);
  const [assignedHs, setAssignedHs] = useState<string | null>(null);
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

  /** HS is Missing until a human assigns a draft for this document. */
  const hsMissing = !assignedHs;
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

  const linesTotal = 1;
  const linesComplete = assignedHs && fields.description ? 1 : 0;

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
        const asg = await fetch("/api/assign");
        const asgData = (await asg.json()) as {
          assignments: AssignmentRecord[];
        };
        setAssignments(asgData.assignments);
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
      const s = data.suggestion as HsSuggestion;
      setSuggestion(s);
      if (data.trace) {
        publishTrace(
          data.trace as DecisionTrace,
          text.trim().slice(0, 100) || "suggest_hs",
        );
      }
      setCenterTab("lines");
      if (s.verification?.passed === false || s.confidence < 0.3) {
        const reason =
          s.verification?.passed === false
            ? "verification failed"
            : "low confidence";
        setStatus(
          `Suggested ${s.hscode} via ${s.judgmentMode} (${reason}) — review carefully before assigning.`,
        );
      } else {
        setStatus(
          `Suggested ${s.hscode} via ${s.judgmentMode}. Assign to clear Missing.`,
        );
      }
    } catch (e) {
      setSuggestion(null);
      setError(e instanceof Error ? e.message : "Suggest failed");
    } finally {
      setLoadingSuggest(false);
    }
  }

  async function assignDraft() {
    if (!suggestion) return;
    setError(null);
    try {
      const res = await fetch("/api/assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hscode: suggestion.hscode,
          documentText: text,
          confidence: suggestion.confidence,
          humanConfirmed: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Assign failed");
      setAssignments((prev) => [data.assignment as AssignmentRecord, ...prev]);
      setAssignedHs(suggestion.hscode);
      if (data.trace) {
        publishTrace(
          data.trace as DecisionTrace,
          `assign ${suggestion.hscode}`,
        );
      }
      setStatus(
        `Draft assigned ${suggestion.hscode}. Customs Post / submit remains blocked.`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Assign failed");
    }
  }

  async function requestReview() {
    setReviewQueued(true);
    setStatus("Queued for human review. No code assigned.");
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
        if (assignments.length === 0) {
          setStatus(
            "Assign an HS6 draft before preparing a declaration draft.",
          );
        } else {
          setStatus(
            `Local declaration draft prepared for ${assignments[0]!.hscode}. Filing is out of scope.`,
          );
        }
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
    setSuggestion(null);
    setAssignedHs(null);
    setError(null);
    setStatus(`Sample: ${sample.title}`);
  }

  function resetClassification() {
    setSuggestion(null);
    setAssignedHs(null);
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

  const displayHs = assignedHs ?? suggestion?.hscode ?? null;
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
            <span className="size-1.5 rounded-full bg-[#807d73]" />
            To do
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
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={!suggestion}
                onClick={() => void assignDraft()}
              >
                Assign draft
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void requestReview()}
              >
                Request review
              </Button>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            {(status || error || commandResult || reviewQueued) && (
              <p
                className={`mb-3 text-[12px] ${error ? "text-red-700" : "text-[#66645c]"}`}
                role="status"
              >
                {error ??
                  status ??
                  (commandResult
                    ? `${commandResult.routed.command} · ${pct(commandResult.routed.confidence)} — ${commandResult.gate.message}`
                    : null)}
                {reviewQueued && !error && !status
                  ? " Human review requested."
                  : null}
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
                    <ValuePill>
                      Group by <span className="ml-1 text-[#807d73]">▾</span>
                    </ValuePill>
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
                      Exceptions {lineHasException ? 1 : 0}
                    </button>
                    <button
                      type="button"
                      className="h-7 rounded-full border border-[#ccc9ba]/80 bg-white/40 px-2.5 text-[12px] text-[#66645c]"
                    >
                      + Filter
                    </button>
                    <button
                      type="button"
                      className="ml-auto text-[12px] text-[#807d73] hover:text-[#0d0d0d]"
                      onClick={() => {
                        setLineFilter("all");
                        setSuggestion(null);
                        setAssignedHs(null);
                      }}
                    >
                      Clear
                    </button>
                  </div>

                  <div className="overflow-x-auto rounded-xl border border-white/45 bg-white/25 backdrop-blur-md">
                    <table className="w-full min-w-[520px] border-collapse text-left text-[12px]">
                      <thead>
                        <tr className="border-b border-white/40 text-[11px] text-[#807d73]">
                          <th className="px-3 py-2.5 font-medium">Origin</th>
                          <th className="px-3 py-2.5 font-medium">Description</th>
                          <th className="px-3 py-2.5 font-medium">HS Code</th>
                          <th className="px-3 py-2.5 font-medium">Qty</th>
                          <th className="px-3 py-2.5 font-medium">Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {showLine ? (
                          <tr className="border-b border-white/30 last:border-0">
                            <td className="px-3 py-3 align-top text-[#0d0d0d]">
                              {fields.origin ?? (
                                <span className="relative inline-flex rounded bg-[#f3e8ff] px-1.5 py-0.5 font-medium text-[#7c3aed]">
                                  Missing
                                  <span
                                    aria-hidden
                                    className="absolute top-0 right-0 size-0 border-t-[8px] border-l-[8px] border-t-[#7c3aed] border-l-transparent"
                                  />
                                </span>
                              )}
                            </td>
                            <td className="max-w-[220px] px-3 py-3 align-top text-[#0d0d0d]">
                              <span className="line-clamp-2">
                                {fields.description ?? "—"}
                              </span>
                            </td>
                            <td className="px-3 py-3 align-top">
                              {hsMissing ? (
                                <span className="relative inline-flex items-center rounded bg-[#f3e8ff] px-2 py-0.5 font-medium text-[#7c3aed]">
                                  Missing
                                  <span
                                    aria-hidden
                                    className="absolute top-0 right-0 size-0 border-t-[8px] border-l-[8px] border-t-[#7c3aed] border-l-transparent"
                                  />
                                </span>
                              ) : (
                                <span className="font-mono font-semibold text-[#0d0d0d]">
                                  {displayHs}
                                </span>
                              )}
                              {suggestion && hsMissing && (
                                <p className="mt-1 font-mono text-[10px] text-[#807d73]">
                                  suggested {suggestion.hscode} ·{" "}
                                  {pct(suggestion.confidence)}
                                </p>
                              )}
                            </td>
                            <td className="px-3 py-3 align-top text-[#0d0d0d]">
                              {fields.qty ?? (
                                <span className="text-[#7c3aed]">Missing</span>
                              )}
                            </td>
                            <td className="px-3 py-3 align-top text-[#0d0d0d]">
                              {fields.amount ?? (
                                <span className="text-[#7c3aed]">Missing</span>
                              )}
                            </td>
                          </tr>
                        ) : (
                          <tr>
                            <td
                              colSpan={5}
                              className="px-3 py-8 text-center text-[#807d73]"
                            >
                              No exceptions in the current filter.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>

                  {suggestion && (
                    <div className="mt-4 space-y-2 rounded-xl border border-white/45 bg-white/30 p-3 backdrop-blur-md">
                      <p className="text-[11px] font-medium tracking-wide text-[#807d73] uppercase">
                        Path · HS {suggestion.datasetVersion}
                      </p>
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
                      {suggestion.verification && (
                        <p
                          className={
                            suggestion.verification.passed
                              ? "text-[11px] text-[#807d73]"
                              : "text-[11px] font-medium text-amber-800"
                          }
                        >
                          Verification {pct(suggestion.verification.matchProbability)} ·{" "}
                          {suggestion.verification.passed ? "pass" : "fail"}
                        </p>
                      )}
                      {suggestion.runnerUp && (
                        <p className="text-[11px] text-[#807d73]">
                          Runner-up{" "}
                          <span className="font-mono">
                            {suggestion.runnerUp.hscode}
                          </span>
                        </p>
                      )}
                      {suggestion.documentStated && (
                        <p
                          className={
                            suggestion.documentStated.disagreesWithSuggestion
                              ? "text-[11px] text-amber-800"
                              : "text-[11px] text-[#807d73]"
                          }
                        >
                          Document states{" "}
                          <span className="font-mono">
                            {suggestion.documentStated.rawDigits}
                          </span>
                          {" "}
                          (HS6 {suggestion.documentStated.hs6})
                          {suggestion.documentStated.disagreesWithSuggestion
                            ? " — disagrees with description-based suggestion"
                            : ""}
                        </p>
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
              className="max-w-[58%] truncate rounded-md border-0 bg-transparent text-[13px] font-medium text-[#0d0d0d] outline-none"
              aria-label="Document source"
            >
              {!sampleId && (
                <option value="__uploaded__">
                  {docLabel.length > 28 ? `${docLabel.slice(0, 28)}…` : docLabel}
                </option>
              )}
              {SAMPLE_DOCUMENTS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title.split("—")[0]?.trim()}
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
