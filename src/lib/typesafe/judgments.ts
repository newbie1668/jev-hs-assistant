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
