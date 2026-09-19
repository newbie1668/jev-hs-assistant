import { choice, noul, TypeSafeClient } from "@typesafe-ai/sdk";
import {
  costFieldsForStep,
  nextStepId,
  type TraceCollector,
  type TokenUsage,
} from "@/lib/typesafe/trace";

export type JudgmentMode = "typesafe" | "mock";

// FULL FILE LOADED FROM DISK VIA NEXT APPROACH
export function createJudgmentClient(trace?: TraceCollector): JudgmentClient {
  return hasApiKey() ? createTypeSafeClient(trace) : createMockClient(trace);
}
