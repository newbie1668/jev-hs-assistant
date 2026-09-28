/**
 * Customs entry draft — the hand-off a broker's filing system (TMS / customs
 * software) would ingest. Built only from human-assigned lines; never filed.
 */

import type { LineFields, ParsedDocFields } from "@/lib/extract/doc-fields";
import type { HsSuggestion } from "@/lib/hs/types";
import type { LineException } from "@/lib/review/exceptions";

export interface EntryDraftLineInput {
  lineNo: number;
  fields: LineFields;
  suggestion: HsSuggestion;
  assigned: { hscode: string; description: string };
  exceptions: LineException[];
}

export interface EntryDraft {
  kind: "customs_entry_draft";
  status: "draft_not_filed";
  generatedAt: string;
  hsNomenclature: string;
  header: {
    invoiceNo: string | null;
    seller: string | null;
    buyer: string | null;
    transportMode: string | null;
    masterBill: string | null;
    weight: string | null;
  };
  lines: Array<{
    lineNo: number;
    goodsDescription: string;
    hs6: string;
    hs6Description: string;
    origin: string | null;
    quantity: string | null;
    value: string | null;
    suggestedHs6: string;
    humanOverride: boolean;
    printedHs: string | null;
    verificationMatch: number | null;
    openFlags: string[];
  }>;
  filing: string;
}

export function buildEntryDraft(
  doc: ParsedDocFields,
  lines: EntryDraftLineInput[],
  now: Date = new Date(),
): EntryDraft {
  return {
    kind: "customs_entry_draft",
    status: "draft_not_filed",
    generatedAt: now.toISOString(),
    hsNomenclature: `HS ${lines[0]?.suggestion.datasetVersion ?? "2022.0"}`,
    header: {
      invoiceNo: doc.invoiceNo,
      seller: doc.seller,
      buyer: doc.buyer,
      transportMode: doc.mode,
      masterBill: doc.masterBill,
      weight: doc.weight,
    },
    lines: lines.map((l) => ({
      lineNo: l.lineNo,
      goodsDescription: l.fields.description,
      hs6: l.assigned.hscode,
      hs6Description: l.assigned.description,
      origin: l.fields.origin,
      quantity: l.fields.qty,
      value: l.fields.amount,
      suggestedHs6: l.suggestion.hscode,
      humanOverride: l.assigned.hscode !== l.suggestion.hscode,
      printedHs: l.suggestion.documentStated?.rawDigits ?? null,
      verificationMatch: l.suggestion.verification?.matchProbability ?? null,
      openFlags: l.exceptions
        .filter((e) => e.severity === "review")
        .map((e) => e.code),
    })),
    filing:
      "Not filed. Human-assigned HS6 draft only — national tariff extension, duty and submission are completed by a licensed broker.",
  };
}
