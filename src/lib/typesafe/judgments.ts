import { choice, noul, TypeSafeClient } from "@typesafe-ai/sdk";
import {
  costFieldsForStep,
  nextStepId,
  type TraceCollector,
  type TokenUsage,
} from "@/lib/typesafe/trace";

export type JudgmentMode = "typesafe" | "mock";

export interface ChoiceResult {
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
}

export interface JudgmentClient {
  mode: JudgmentMode;
  chooseChild(
    state: {
      goodsDescription: string;
      ancestry: string[];
      parentCode: string;
      parentDescription: string;
    },
    options: Array<{ id: string; label: string }>,
  ): Promise<ChoiceResult>;
  verifyMatch(state: {
    goodsDescription: string;
    hscode: string;
    officialDescription: string;
    pathLabels: string[];
  }): Promise<{ matchProbability: number }>;
  routeCommand(
    utterance: string,
    catalog: Record<string, string>,
  ): Promise<ChoiceResult>;
}

function hasApiKey(): boolean {
  const key = process.env.TYPESAFE_API_KEY?.trim();
  return Boolean(key);
}

export function getJudgmentMode(): JudgmentMode {
  return hasApiKey() ? "typesafe" : "mock";
}

const STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "that",
  "this",
  "than",
  "other",
  "into",
  "onto",
  "over",
  "under",
  "such",
  "each",
  "have",
  "has",
  "are",
  "was",
  "were",
  "not",
  "any",
  "all",
  "per",
  "unit",
  "units",
  "qty",
  "net",
  "gross",
  "weight",
  "invoice",
  "seller",
  "buyer",
  "description",
  "goods",
  "shipment",
  "packing",
  "commercial",
  "country",
  "origin",
  "marks",
  "quantity",
  "contents",
  "consisting",
  "least",
  "more",
  "less",
  "n.e.c",
  "nec",
  "parts",
  "thereof",
  "including",
  "similar",
]);

function stem(token: string): string {
  if (token.endsWith("ies") && token.length > 5) return `${token.slice(0, -3)}y`;
  if (token.endsWith("ing") && token.length > 5) return token.slice(0, -3);
  if (token.endsWith("ers") && token.length > 5) return token.slice(0, -1);
  if (token.endsWith("es") && token.length > 4) return token.slice(0, -2);
  if (token.endsWith("s") && token.length > 3) return token.slice(0, -1);
  if (token === "machinery") return "machin";
  if (token.startsWith("machin")) return "machin";
  return token;
}

function tokenize(text: string): string[] {
  const normalized = text
    .toLowerCase()
    .replace(/\bnot roasted or decaffeinated\b/g, "unroasted caffeinated")
    .replace(/\bnot\s+roasted\b/g, "unroasted")
    .replace(/\broasted,\s+not decaffeinated\b/g, "roasted caffeinated")
    .replace(/\bnot\s+decaffeinated\b/g, "caffeinated")
    .replace(/[^a-z0-9\s]/g, " ");
  return normalized
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t))
    .map(stem);
}

function overlapScore(
  queryTokens: string[],
  candidate: string,
  rawQuery?: string,
): number {
  const candTokens = tokenize(candidate);
  const candSet = new Set(candTokens);
  if (candSet.size === 0 || queryTokens.length === 0) return 0.01;
  let hits = 0;
  const lower = candidate.toLowerCase();
  for (const t of queryTokens) {
    if (candSet.has(t)) hits += 1.6;
    else if (t.length >= 5 && lower.includes(t)) hits += 0.9;
    else {
      for (const c of candSet) {
        if (c.length >= 5 && (c.startsWith(t) || t.startsWith(c))) {
          hits += 0.7;
          break;
        }
      }
    }
  }

  const raw = (rawQuery ?? "").toLowerCase();
  const cues: Array<{ query: RegExp; candidate: RegExp; boost: number }> = [
    {
      query: /automatic data processing|\badp\b|laptop|portable.{0,40}comput/i,
      candidate: /machinery|mechanical|data processing|automatic data|84\b|8471/i,
      boost: 6,
    },
    {
      query: /roasted coffee|coffee.{0,40}roasted|not decaffeinat/i,
      candidate: /roasted|09012/i,
      boost: 8,
    },
    {
      query: /roasted coffee|coffee.{0,40}roasted/i,
      candidate: /not roasted|09011/i,
      boost: -5,
    },
    {
      query: /green coffee|not roasted|raw coffee/i,
      candidate: /not roasted|09011/i,
      boost: 6,
    },
    {
      query: /t-?shirts?|singlets|crew neck|blank tees/i,
      candidate: /t-shirts|singlets|6109/i,
      boost: 8,
    },
    {
      query: /t-?shirts?|singlets|blank tees/i,
      candidate: /shirts; men's|6105/i,
      boost: -4,
    },
    // Photographic / camera gear (incl. underwater housings) → ch. 90 / 9006
    {
      query:
        /underwater\s+housing|camera\s+housing|fujifilm|photographic|digital\s+camera|\bx-?t\d\b|\bdslr\b|mirrorless|canon|nikon/i,
      candidate: /^90\s|optical, photographic, cinematographic/i,
      boost: 14,
    },
    {
      query:
        /underwater\s+housing|camera\s+housing|fujifilm|photographic|digital\s+camera|\bx-?t\d\b|\bdslr\b|mirrorless/i,
      candidate: /^9006\s|cameras, photographic \(excluding/i,
      boost: 16,
    },
    {
      query:
        /underwater\s+housing|camera\s+housing|fujifilm|\bx-?t\d\b/i,
      candidate: /^900691\s|cameras, photographic.{0,60}parts and accessories/i,
      boost: 14,
    },
    {
      query:
        /underwater\s+housing|camera\s+housing|fujifilm|\bx-?t\d\b/i,
      candidate: /photographic flashlight|900699|90066/i,
      boost: -8,
    },
    {
      query:
        /underwater\s+housing|camera\s+housing|fujifilm|photographic|\bx-?t\d\b/i,
      candidate:
        /laboratory apparatus|negatoscopes|projection screens|9010|parts and accessories n\.e\.c\. in chapter 90|9033/i,
      boost: -12,
    },
    {
      query:
        /underwater.{0,30}camera|camera.{0,30}underwater|specially designed for underwater/i,
      candidate: /specially designed for underwater|900630/i,
      boost: 7,
    },
    {
      query:
        /underwater\s+housing|camera\s+housing|fujifilm|photographic|digital\s+camera|\bx-?t\d\b/i,
      candidate:
        /telephone|smartphone|transmission or reception of voice|8517|85176|communication apparatus|sound or video recording|8522|8521|8525/i,
      boost: -14,
    },
    {
      query:
        /underwater\s+housing|camera\s+housing|fujifilm|photographic|\bx-?t\d\b/i,
      candidate:
        /electrical machinery|vehicles; other than railway|musical instruments|arms and ammunition|toys, games|automatic data processing|8471/i,
      boost: -10,
    },
  ];
  for (const cue of cues) {
    if (cue.query.test(raw) && cue.candidate.test(lower)) {
      hits += cue.boost;
    }
  }
  return Math.max(0.01, hits + 0.01);
}

function softmax(scores: number[]): number[] {
  const max = Math.max(...scores);
  const temperature = 3.4;
  const exps = scores.map((s) => Math.exp((s - max) * temperature));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map((e) => e / sum);
}

function confidenceFromProbs(probs: Record<string, number>): number {
  const values = Object.values(probs).sort((a, b) => b - a);
  if (values.length <= 1) return 1;
  const top = values[0] ?? 0;
  const second = values[1] ?? 0;
  const margin = (top - second) / Math.max(top, 1e-9);
  return Math.min(1, Math.max(0, 0.55 * margin + 0.45 * top));
}

function truncateText(text: string, max = 280): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…`;
}

function previewState(state: unknown): unknown {
  if (typeof state === "string") return truncateText(state);
  if (state && typeof state === "object") {
    const copy = { ...(state as Record<string, unknown>) };
    if (typeof copy.goods_description === "string") {
      copy.goods_description = truncateText(copy.goods_description);
    }
    if (typeof copy.goodsDescription === "string") {
      copy.goodsDescription = truncateText(copy.goodsDescription);
    }
    return copy;
  }
  return state;
}

async function withTiming<T>(
  fn: () => Promise<T> | T,
): Promise<{ result: T; startedAt: string; finishedAt: string; latencyMs: number }> {
  const startedAt = new Date().toISOString();
  const t0 = performance.now();
  const result = await fn();
  const finishedAt = new Date().toISOString();
  const latencyMs = Math.max(0, performance.now() - t0);
  return { result, startedAt, finishedAt, latencyMs };
}

function createMockClient(trace?: TraceCollector): JudgmentClient {
  const mode = "mock" as const;
  return {
    mode,
    async chooseChild(state, options) {
      const instructions =
        "Which direct child HS node best matches the goods description? (mock token-overlap)";
      const timed = await withTiming(async () => {
        if (options.length === 1) {
          const only = options[0]!.id;
          return {
            choice: only,
            confidence: 1,
            probabilities: { [only]: 1 } as Record<string, number>,
            singleton: true as const,
          };
        }
        const tokens = tokenize(state.goodsDescription);
        const scores = options.map((opt) =>
          overlapScore(
            tokens,
            `${opt.id} ${opt.label}`,
            state.goodsDescription,
          ),
        );
        const soft = softmax(scores);
        const probabilities: Record<string, number> = {};
        options.forEach((opt, i) => {
          probabilities[opt.id] = soft[i] ?? 0;
        });
        const ranked = [...options].sort(
          (a, b) => (probabilities[b.id] ?? 0) - (probabilities[a.id] ?? 0),
        );
        return {
          choice: ranked[0]!.id,
          confidence: confidenceFromProbs(probabilities),
          probabilities,
          singleton: false as const,
        };
      });

      const { result, startedAt, finishedAt, latencyMs } = timed;
      const cost = costFieldsForStep(mode, null);
      const topProb = result.probabilities[result.choice] ?? 0;
      trace?.addStep({
        id: nextStepId("child"),
        kind: result.singleton ? "skipped_singleton" : "choice_child",
        label: result.singleton
          ? `Singleton child @ ${state.parentCode}`
          : `Choice @ ${state.parentCode} → ${result.choice}`,
        mode,
        latencyMs,
        startedAt,
        finishedAt,
        model: null,
        usage: null,
        ...cost,
        request: {
          endpoint: "mock://local/chooseChild",
          model: null,
          questionType: result.singleton ? "none" : "choice",
          instructions,
          optionCount: options.length,
          parentCode: state.parentCode,
          state: previewState({
            goods_description: state.goodsDescription,
            current_parent: {
              code: state.parentCode,
              description: state.parentDescription,
            },
            ancestry: state.ancestry,
          }),
          criteriaPreview: options.slice(0, 12).map((o) => ({
            id: o.id,
            label: truncateText(o.label, 80),
          })),
        },
        response: {
          choice: result.choice,
          confidence: result.confidence,
          topProbability: topProb,
          probabilitiesTop: Object.entries(result.probabilities)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 8)
            .map(([k, v]) => ({ code: k, p: v })),
        },
        logs: [
          `mock Choice over ${options.length} legal children of ${state.parentCode}`,
          `selected ${result.choice} (p=${topProb.toFixed(3)}, conf=${result.confidence.toFixed(3)})`,
          `latency ${Math.round(latencyMs)}ms — local only, not TypeSafe API`,
        ],
      });

      return {
        choice: result.choice,
        confidence: result.confidence,
        probabilities: result.probabilities,
      };
    },
    async verifyMatch(state) {
      const timed = await withTiming(async () => {
        const tokens = tokenize(state.goodsDescription);
        const score = overlapScore(
          tokens,
          `${state.officialDescription} ${state.pathLabels.join(" ")}`,
          state.goodsDescription,
        );
        const maxPossible = tokens.length * 1.35 + 0.01;
        const matchProbability = Math.min(
          0.98,
          Math.max(0.05, score / Math.max(maxPossible, 1)),
        );
        return { matchProbability };
      });
      const { result, startedAt, finishedAt, latencyMs } = timed;
      const cost = costFieldsForStep(mode, null);
      const instructions =
        "Does the official HS description reasonably match the goods as stated? (mock — product wording only; ignore printed HS codes)";
      trace?.addStep({
        id: nextStepId("verify"),
        kind: "verification_noul",
        label: `Verify ${state.hscode}`,
        mode,
        latencyMs,
        startedAt,
        finishedAt,
        model: null,
        usage: null,
        ...cost,
        request: {
          endpoint: "mock://local/verifyMatch",
          model: null,
          questionType: "noul",
          instructions,
          state: previewState({
            goods_description: state.goodsDescription,
            suggested_hscode: state.hscode,
            official_description: state.officialDescription,
            path_labels: state.pathLabels,
          }),
        },
        response: { noul: result.matchProbability, type: "noul" },
        logs: [
          `mock Noul verification for ${state.hscode}`,
          `matchProbability=${result.matchProbability.toFixed(3)}`,
          `latency ${Math.round(latencyMs)}ms — not billed`,
        ],
      });
      return result;
    },
    async routeCommand(utterance, catalog) {
      const timed = await withTiming(async () => {
        const tokens = tokenize(utterance);
        const entries = Object.entries(catalog);
        const scores = entries.map(([, desc]) => overlapScore(tokens, desc));
        const lower = utterance.toLowerCase();
        entries.forEach(([id], i) => {
          if (id === "suggest_hs" && /suggest|classify|hs\b|code/.test(lower)) {
            scores[i]! += 3;
          }
          if (
            id === "assign_hs_draft" &&
            /assign|apply|draft|confirm/.test(lower) &&
            !/submit/.test(lower)
          ) {
            scores[i]! += 3;
          }
          if (
            id === "request_human_review" &&
            /review|human|escalate|unsure/.test(lower)
          ) {
            scores[i]! += 3;
          }
          if (id === "open_shipment" && /open|show shipment|load/.test(lower)) {
            scores[i]! += 2;
          }
          if (
            id === "prepare_declaration_draft" &&
            /prepare|declaration draft|draft declaration/.test(lower) &&
            !/submit/.test(lower)
          ) {
            scores[i]! += 2;
          }
          if (
            id === "submit_declaration" &&
            /submit|file customs|file (a |the )?declaration/.test(lower)
          ) {
            scores[i]! += 8;
          }
        });
        const soft = softmax(scores);
        const probabilities: Record<string, number> = {};
        entries.forEach(([id], i) => {
          probabilities[id] = soft[i] ?? 0;
        });
        const ranked = entries.sort(
          (a, b) => (probabilities[b[0]] ?? 0) - (probabilities[a[0]] ?? 0),
        );
        return {
          choice: ranked[0]![0],
          confidence: confidenceFromProbs(probabilities),
          probabilities,
        };
      });
      const { result, startedAt, finishedAt, latencyMs } = timed;
      const cost = costFieldsForStep(mode, null);
      trace?.addStep({
        id: nextStepId("cmd"),
        kind: "command_route",
        label: `Route → ${result.choice}`,
        mode,
        latencyMs,
        startedAt,
        finishedAt,
        model: null,
        usage: null,
        ...cost,
        request: {
          endpoint: "mock://local/routeCommand",
          model: null,
          questionType: "choice",
          instructions: "Which dashboard command is the user asking for? (mock)",
          optionCount: Object.keys(catalog).length,
          state: previewState({ user_utterance: utterance }),
          criteriaPreview: catalog,
        },
        response: {
          choice: result.choice,
          confidence: result.confidence,
          probabilities: result.probabilities,
        },
        logs: [
          `mock command Choice over ${Object.keys(catalog).length} handlers`,
          `selected ${result.choice} (conf=${result.confidence.toFixed(3)})`,
          `latency ${Math.round(latencyMs)}ms — not billed`,
        ],
      });
      return result;
    },
  };
}

function createTypeSafeClient(trace?: TraceCollector): JudgmentClient {
  const client = new TypeSafeClient({
    apiKey: process.env.TYPESAFE_API_KEY,
  });
  const model = process.env.TYPESAFE_MODEL?.trim() || "jev-latest";
  const mode = "typesafe" as const;

  return {
    mode,
    async chooseChild(state, options) {
      const instructions =
        "Which direct child HS node best matches the goods description? Classify from the product / goods wording only — ignore any HS, harmonised, or tariff codes printed on the document (those may be wrong). Choose only among the listed legal children; do not invent codes.";

      if (options.length === 1) {
        const only = options[0]!;
        const startedAt = new Date().toISOString();
        const cost = costFieldsForStep(mode, null);
        trace?.addStep({
          id: nextStepId("child"),
          kind: "skipped_singleton",
          label: `Singleton child @ ${state.parentCode} → ${only.id}`,
          mode,
          latencyMs: 0,
          startedAt,
          finishedAt: startedAt,
          model: null,
          usage: null,
          ...cost,
          request: {
            endpoint: "skipped (single legal child)",
            model: null,
            questionType: "none",
            instructions: "No Choice call — only one legal child.",
            optionCount: 1,
            parentCode: state.parentCode,
            state: previewState({
              goods_description: state.goodsDescription,
              current_parent: {
                code: state.parentCode,
                description: state.parentDescription,
              },
            }),
            criteriaPreview: [{ id: only.id, label: only.label }],
          },
          response: {
            choice: only.id,
            confidence: 1,
            probabilities: { [only.id]: 1 },
          },
          logs: [
            `skipped TypeSafe call — sole child ${only.id} under ${state.parentCode}`,
          ],
        });
        return {
          choice: only.id,
          confidence: 1,
          probabilities: { [only.id]: 1 },
        };
      }

      const criteria: Record<string, string> = {};
      for (const opt of options) {
        criteria[opt.id] = `${opt.id}: ${opt.label}`;
      }
      const requestPayload = {
        model,
        state: {
          goods_description: state.goodsDescription,
          current_parent: {
            code: state.parentCode,
            description: state.parentDescription,
          },
          ancestry: state.ancestry,
          task: "Select the single best Harmonized System child node for these goods.",
          policy:
            "Classify from goods / product wording only. Ignore any HS, harmonised, or tariff codes printed on the document — they may be wrong.",
        },
        questions: {
          child: choice(instructions, criteria),
        },
      };

      const timed = await withTiming(() => client.systemOne(requestPayload));
      const response = timed.result;
      const answer = response.answers.child;
      const probabilities: Record<string, number> = {};
      for (const [key, value] of Object.entries(answer.probabilities)) {
        probabilities[key] = value;
      }
      const usage: TokenUsage = {
        input_tokens: response.usage.input_tokens,
        output_tokens: response.usage.output_tokens,
      };
      const cost = costFieldsForStep(mode, usage);
      const selected = String(answer.choice);
      trace?.addStep({
        id: nextStepId("child"),
        kind: "choice_child",
        label: `Choice @ ${state.parentCode} → ${selected}`,
        mode,
        latencyMs: timed.latencyMs,
        startedAt: timed.startedAt,
        finishedAt: timed.finishedAt,
        model: response.model,
        usage,
        ...cost,
        request: {
          endpoint: "POST https://api.typesafe.ai/v1/systemone",
          model,
          questionType: "choice",
          instructions,
          optionCount: options.length,
          parentCode: state.parentCode,
          state: previewState(requestPayload.state),
          criteriaPreview: Object.fromEntries(
            Object.entries(criteria).slice(0, 12),
          ),
        },
        response: {
          model: response.model,
          choice: selected,
          confidence: answer.confidence,
          usage,
          probabilitiesTop: Object.entries(probabilities)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 8)
            .map(([k, v]) => ({ code: k, p: v })),
        },
        logs: [
          `TypeSafe systemOne Choice @ parent ${state.parentCode} (${options.length} options)`,
          `model=${response.model} choice=${selected} conf=${answer.confidence.toFixed(3)}`,
          `usage in=${usage.input_tokens} out=${usage.output_tokens} · ${cost.costLabel}`,
          `wall latency ${Math.round(timed.latencyMs)}ms`,
        ],
      });

      return {
        choice: selected,
        confidence: answer.confidence,
        probabilities,
      };
    },
    async verifyMatch(state) {
      const instructions =
        "Would a customs officer classify these goods under this HS subheading? HS wording is a legal category written in technical terms, not a product name: goods fit when they fall within the category even if the everyday product name differs (e.g. a phone charger is a 'static converter'). Judge from the goods wording only; any printed HS / harmonised code on the document may be wrong and must not decide the answer.";
      const criteria = {
        true: "The goods fall within this subheading: the chapter, heading and subheading path all apply to what the goods are, what they are made of and their state (fresh/frozen/assembled/etc.).",
        false: "The goods belong under a different chapter, heading or subheading, or an element of the path conflicts with the goods (wrong material, wrong function, wrong processing state, only a part/accessory, or not goods at all).",
      };
      const requestPayload = {
        model,
        state: {
          goods_description: state.goodsDescription,
          candidate: {
            hscode: state.hscode,
            chapter: state.pathLabels[0] ?? "",
            heading: state.pathLabels[state.pathLabels.length - 2] ?? "",
            subheading: `${state.hscode} ${state.officialDescription}`,
          },
        },
        questions: {
          matches: noul(instructions, criteria),
        },
      };
      const timed = await withTiming(() => client.systemOne(requestPayload));
      const response = timed.result;
      const matchProbability = response.answers.matches.noul;
      const usage: TokenUsage = {
        input_tokens: response.usage.input_tokens,
        output_tokens: response.usage.output_tokens,
      };
      const cost = costFieldsForStep(mode, usage);
      trace?.addStep({
        id: nextStepId("verify"),
        kind: "verification_noul",
        label: `Verify ${state.hscode}`,
        mode,
        latencyMs: timed.latencyMs,
        startedAt: timed.startedAt,
        finishedAt: timed.finishedAt,
        model: response.model,
        usage,
        ...cost,
        request: {
          endpoint: "POST https://api.typesafe.ai/v1/systemone",
          model,
          questionType: "noul",
          instructions,
          state: previewState(requestPayload.state),
          criteriaPreview: criteria,
        },
        response: {
          model: response.model,
          type: "noul",
          noul: matchProbability,
          usage,
        },
        logs: [
          `TypeSafe systemOne Noul verify ${state.hscode}`,
          `noul=${matchProbability.toFixed(3)} model=${response.model}`,
          `usage in=${usage.input_tokens} out=${usage.output_tokens} · ${cost.costLabel}`,
          `wall latency ${Math.round(timed.latencyMs)}ms`,
        ],
      });
      return { matchProbability };
    },
    async routeCommand(utterance, catalog) {
      const instructions = "Which dashboard command is the user asking for?";
      const requestPayload = {
        model,
        state: {
          user_utterance: utterance,
          note: "Pick exactly one dashboard command. submit_declaration is never auto-executed.",
        },
        questions: {
          command: choice(instructions, catalog),
        },
      };
      const timed = await withTiming(() => client.systemOne(requestPayload));
      const response = timed.result;
      const answer = response.answers.command;
      const probabilities: Record<string, number> = {};
      for (const [key, value] of Object.entries(answer.probabilities)) {
        probabilities[key] = value;
      }
      const usage: TokenUsage = {
        input_tokens: response.usage.input_tokens,
        output_tokens: response.usage.output_tokens,
      };
      const cost = costFieldsForStep(mode, usage);
      const selected = String(answer.choice);
      trace?.addStep({
        id: nextStepId("cmd"),
        kind: "command_route",
        label: `Route → ${selected}`,
        mode,
        latencyMs: timed.latencyMs,
        startedAt: timed.startedAt,
        finishedAt: timed.finishedAt,
        model: response.model,
        usage,
        ...cost,
        request: {
          endpoint: "POST https://api.typesafe.ai/v1/systemone",
          model,
          questionType: "choice",
          instructions,
          optionCount: Object.keys(catalog).length,
          state: previewState(requestPayload.state),
          criteriaPreview: catalog,
        },
        response: {
          model: response.model,
          choice: selected,
          confidence: answer.confidence,
          probabilities,
          usage,
        },
        logs: [
          `TypeSafe systemOne command Choice`,
          `choice=${selected} conf=${answer.confidence.toFixed(3)} model=${response.model}`,
          `usage in=${usage.input_tokens} out=${usage.output_tokens} · ${cost.costLabel}`,
          `wall latency ${Math.round(timed.latencyMs)}ms`,
        ],
      });
      return {
        choice: selected,
        confidence: answer.confidence,
        probabilities,
      };
    },
  };
}

export function createJudgmentClient(trace?: TraceCollector): JudgmentClient {
  return hasApiKey() ? createTypeSafeClient(trace) : createMockClient(trace);
}
