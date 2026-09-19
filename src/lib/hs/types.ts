export const HS_DATASET_VERSION = "2022.0" as const;
export const HS_ROOT_PARENT = "TOTAL" as const;
export const HS6_LEVEL = 6;

export type HsLevel = 2 | 4 | 6 | number;

export interface HsNode {
  section: string;
  hscode: string;
  description: string;
  parent: string;
  level: HsLevel;
}

export interface HsPathStep {
  hscode: string;
  description: string;
  level: HsLevel;
  section: string;
  edgeProbability?: number;
}

export interface HsSuggestion {
  hscode: string;
  description: string;
  path: HsPathStep[];
  pathScore: number;
  confidence: number;
  separation: number | null;
  runnerUp: {
    hscode: string;
    description: string;
    pathScore: number;
  } | null;
  datasetVersion: typeof HS_DATASET_VERSION;
  judgmentMode: "typesafe" | "mock";
  edgeConfidences: number[];
  verification?: {
    matchProbability: number;
    passed: boolean;
  };
}
