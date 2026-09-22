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

export interface DocumentStatedHs {
  /** Digits as printed on the document (6–10) */
  rawDigits: string;
  /** Normalized HS6 (first 6 digits) */
  hs6: string;
  /** True when hs6 exists as a level-6 node in the pinned taxonomy */
  inTaxonomy: boolean;
  /** Official description when inTaxonomy */
  description: string | null;
  /** Suggested HS6 differs from document-stated HS6 */
  disagreesWithSuggestion: boolean;
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
  /** Set when the beam top failed verification and a passing leaf was swapped in */
  verificationRerank?: { from: string; to: string } | null;
  /** HS printed on the document (for human compare — not used as the suggestion) */
  documentStated: DocumentStatedHs | null;
}
