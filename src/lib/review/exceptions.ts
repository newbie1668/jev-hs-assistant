/**
 * Review-by-exception for classified goods lines: which lines a broker can
 * approve as-is and which need a human look, with a reason for each flag.
 * Pure functions — no judgments, no I/O.
 */

import type { LineFields } from "@/lib/extract/doc-fields";
import type { HsSuggestion } from "@/lib/hs/types";

/** Below this the verifier says the goods do not fit the subheading. */
export const VERIFY_PASS = 0.55;
/** Verified, but not strongly enough to skip a human look. */
export const VERIFY_STRONG = 0.75;
/** Top path score / runner-up path score below this is a near tie. */
export const CLOSE_SEPARATION = 1.15;

export type ExceptionCode =
  | "printed_hs_mismatch"
  | "printed_hs_not_in_tariff"
  | "verification_failed"
  | "weak_verification"
  | "close_alternative"
  | "reranked"
  | "missing_origin"
  | "missing_quantity"
  | "missing_value";

/** `review` blocks straight-through approval; `info` is shown but does not. */
export type ExceptionSeverity = "review" | "info";

export interface LineException {
  code: ExceptionCode;
  severity: ExceptionSeverity;
  title: string;
  detail: string;
}

export type LineStatus = "ready" | "needs_review";

export interface LineAssessment {
  status: LineStatus;
  exceptions: LineException[];
}

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

export function assessLine(
  suggestion: HsSuggestion,
  fields: Pick<LineFields, "origin" | "qty" | "amount">,
): LineAssessment {
  const out: LineException[] = [];
  const stated = suggestion.documentStated;
  const match = suggestion.verification?.matchProbability ?? null;

  if (stated && !stated.inTaxonomy) {
    out.push({
      code: "printed_hs_not_in_tariff",
      severity: "review",
      title: "Printed HS not in HS 2022",
      detail: `Document prints ${stated.rawDigits}; HS6 ${stated.hs6} does not exist in the pinned HS ${suggestion.datasetVersion} nomenclature — likely an outdated code from an earlier HS edition, or a typo.`,
    });
  } else if (stated?.disagreesWithSuggestion) {
    out.push({
      code: "printed_hs_mismatch",
      severity: "review",
      title: "Printed HS disagrees",
      detail: `Document prints ${stated.rawDigits} (HS6 ${stated.hs6}${stated.description ? ` — ${stated.description}` : ""}); the goods description points to ${suggestion.hscode}.`,
    });
  }

  if (match !== null && match < VERIFY_PASS) {
    out.push({
      code: "verification_failed",
      severity: "review",
      title: "Verification failed",
      detail: `Independent check rates the fit of ${suggestion.hscode} at ${pct(match)} — below the ${pct(VERIFY_PASS)} pass mark.`,
    });
  } else if (match !== null && match < VERIFY_STRONG) {
    out.push({
      code: "weak_verification",
      severity: "review",
      title: "Weak verification",
      detail: `Verified at ${pct(match)} — passes, but below the ${pct(VERIFY_STRONG)} straight-through threshold.`,
    });
  }

  const sep = suggestion.separation;
  if (suggestion.runnerUp && sep !== null && sep < CLOSE_SEPARATION) {
    // A near tie only blocks when the verifier is not strongly confident.
    const strong = match !== null && match >= VERIFY_STRONG;
    out.push({
      code: "close_alternative",
      severity: strong ? "info" : "review",
      title: "Close alternative",
      detail: `${suggestion.runnerUp.hscode} (${suggestion.runnerUp.description}) scored nearly as high.`,
    });
  }

  if (suggestion.verificationRerank) {
    out.push({
      code: "reranked",
      severity: "info",
      title: "Re-ranked by verification",
      detail: `First-pass choice ${suggestion.verificationRerank.from} failed verification; ${suggestion.verificationRerank.to} passed.`,
    });
  }

  if (!fields.origin) {
    out.push({
      code: "missing_origin",
      severity: "review",
      title: "Missing origin",
      detail: "Country of origin not found on the document — required for the entry.",
    });
  }
  if (!fields.qty) {
    out.push({
      code: "missing_quantity",
      severity: "review",
      title: "Missing quantity",
      detail: "Quantity not found for this line.",
    });
  }
  if (!fields.amount) {
    out.push({
      code: "missing_value",
      severity: "review",
      title: "Missing value",
      detail: "Customs value not found for this line.",
    });
  }

  return {
    status: out.some((e) => e.severity === "review") ? "needs_review" : "ready",
    exceptions: out,
  };
}

/**
 * Plain-English classification rationale a broker can keep on file:
 * what the goods are, the legal path taken, and how it was checked.
 */
export function buildRationale(
  suggestion: HsSuggestion,
  goodsDescription: string,
): string[] {
  const out: string[] = [];
  out.push(
    `Classified from the goods description: “${goodsDescription.length > 160 ? `${goodsDescription.slice(0, 157)}…` : goodsDescription}”.`,
  );

  const levels = ["Chapter", "Heading", "Subheading"];
  const path = suggestion.path
    .map((step, i) => `${levels[i] ?? "Level"} ${step.hscode} (${step.description})`)
    .join(" → ");
  if (path) out.push(`Legal path in HS ${suggestion.datasetVersion}: ${path}.`);

  const match = suggestion.verification?.matchProbability;
  if (match !== undefined) {
    out.push(
      match >= VERIFY_PASS
        ? `An independent verification check confirms the goods fall within ${suggestion.hscode} (${pct(match)} match).`
        : `The verification check does not confirm ${suggestion.hscode} (${pct(match)} match) — treat as a lead, not an answer.`,
    );
  }

  if (suggestion.runnerUp) {
    out.push(
      `Closest alternative considered: ${suggestion.runnerUp.hscode} (${suggestion.runnerUp.description}).`,
    );
  }

  const stated = suggestion.documentStated;
  if (stated?.disagreesWithSuggestion) {
    out.push(
      stated.inTaxonomy
        ? `The supplier printed ${stated.rawDigits} (${stated.description ?? `HS6 ${stated.hs6}`}), which does not describe these goods — recommend correcting before filing.`
        : `The supplier printed ${stated.rawDigits}, which is not a valid HS 2022 subheading — recommend correcting before filing.`,
    );
  } else if (stated) {
    out.push(`Agrees with the HS code printed on the document (${stated.rawDigits}).`);
  }

  return out;
}
