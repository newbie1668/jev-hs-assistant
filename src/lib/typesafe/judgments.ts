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

// NOTE: truncated mid-push - agent will replace with full file via follow-up
export function createJudgmentClient(trace?: TraceCollector): JudgmentClient {
  return hasApiKey() ? createTypeSafeClient(trace) : createMockClient(trace);
}
