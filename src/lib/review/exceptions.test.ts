import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseDoc, parseLineFields } from "../extract/doc-fields";
import { extractGoodsLines } from "../hs/stated-codes";
import type { HsSuggestion } from "../hs/types";
import { SAMPLE_DOCUMENTS } from "../samples";
import { buildEntryDraft } from "./entry-draft";
import { assessLine, buildRationale } from "./exceptions";

function suggestion(overrides: Partial<HsSuggestion> = {}): HsSuggestion {
  return {
    hscode: "900691",
    description: "Cameras, photographic; parts and accessories",
    path: [
      { hscode: "90", description: "Optical, photographic…", level: 2, section: "XVIII" },
      { hscode: "9006", description: "Cameras, photographic…", level: 4, section: "XVIII" },
      { hscode: "900691", description: "Cameras, photographic; parts and accessories", level: 6, section: "XVIII" },
    ],
    pathScore: 0.9,
    confidence: 0.9,
    separation: 4,
    runnerUp: { hscode: "900630", description: "Cameras for underwater use", pathScore: 0.2 },
    datasetVersion: "2022.0",
    judgmentMode: "mock",
    edgeConfidences: [0.9, 0.9, 0.9],
    verification: { matchProbability: 0.95, passed: true },
    verificationRerank: null,
    documentStated: null,
    ...overrides,
  };
}

const complete = { origin: "HK", qty: "12", amount: "389.99" };

describe("assessLine", () => {
  it("is ready when verified, well separated and complete", () => {
    const a = assessLine(suggestion(), complete);
    assert.equal(a.status, "ready");
    assert.deepEqual(a.exceptions, []);
  });

  it("flags a printed HS that disagrees with the description", () => {
    const a = assessLine(
      suggestion({
        documentStated: {
          rawDigits: "85171200",
          hs6: "851712",
          inTaxonomy: true,
          description: "Telephones for cellular networks",
          disagreesWithSuggestion: true,
        },
      }),
      complete,
    );
    assert.equal(a.status, "needs_review");
    assert.deepEqual(a.exceptions.map((e) => e.code), ["printed_hs_mismatch"]);
  });

  it("flags printed codes that are not in the pinned nomenclature", () => {
    const a = assessLine(
      suggestion({
        documentStated: {
          rawDigits: "99999900",
          hs6: "999999",
          inTaxonomy: false,
          description: null,
          disagreesWithSuggestion: true,
        },
      }),
      complete,
    );
    assert.deepEqual(a.exceptions.map((e) => e.code), ["printed_hs_not_in_tariff"]);
  });

  it("grades verification: fail and weak both need review", () => {
    const fail = assessLine(
      suggestion({ verification: { matchProbability: 0.3, passed: false } }),
      complete,
    );
    assert.equal(fail.exceptions[0]?.code, "verification_failed");
    const weak = assessLine(
      suggestion({ verification: { matchProbability: 0.6, passed: true } }),
      complete,
    );
    assert.equal(weak.exceptions[0]?.code, "weak_verification");
    assert.equal(weak.status, "needs_review");
  });

  it("a close runner-up only blocks when verification is not strong", () => {
    const strong = assessLine(suggestion({ separation: 1.05 }), complete);
    assert.equal(strong.status, "ready");
    assert.equal(strong.exceptions[0]?.severity, "info");
    const weak = assessLine(
      suggestion({
        separation: 1.05,
        verification: { matchProbability: 0.7, passed: true },
      }),
      complete,
    );
    assert.ok(
      weak.exceptions.some((e) => e.code === "close_alternative" && e.severity === "review"),
    );
  });

  it("flags missing entry fields", () => {
    const a = assessLine(suggestion(), { origin: null, qty: null, amount: null });
    assert.deepEqual(
      a.exceptions.map((e) => e.code),
      ["missing_origin", "missing_quantity", "missing_value"],
    );
  });
});

describe("buildRationale", () => {
  it("explains the path, verification and a printed-code disagreement", () => {
    const lines = buildRationale(
      suggestion({
        documentStated: {
          rawDigits: "85171200",
          hs6: "851712",
          inTaxonomy: true,
          description: "Telephones for cellular networks",
          disagreesWithSuggestion: true,
        },
      }),
      "Fujifilm X-T2 underwater housing kit",
    );
    const text = lines.join("\n");
    assert.match(text, /Chapter 90 .* → Heading 9006 .* → Subheading 900691/);
    assert.match(text, /95% match/);
    assert.match(text, /900630/);
    assert.match(text, /printed 85171200 .*correcting before filing/);
  });
});

describe("parseLineFields", () => {
  const sample = SAMPLE_DOCUMENTS.find((s) => s.id === "mixed-invoice")!;
  const doc = parseDoc(sample.text);
  const lines = extractGoodsLines(sample.text);

  it("reads per-line qty, origin and value on a multi-line invoice", () => {
    const f = parseLineFields(lines[3]!, doc, true);
    assert.equal(f.description, "Fujifilm X-T2 40M/130FT Underwater housing kit");
    assert.equal(f.qty, "12");
    assert.equal(f.origin, "HK");
    assert.equal(f.amount, "389.99");
    const tees = parseLineFields(lines[2]!, doc, true);
    assert.equal(tees.description, "Men's T-shirts, knitted, of cotton, crew neck");
    assert.equal(tees.qty, "1,500");
  });

  it("never borrows another line's origin; falls back to a header origin", () => {
    const inline = [
      "COMMERCIAL INVOICE",
      "Description: Wireless headphones Qty 200 COUNTRY OF ORIGIN: TW",
      "Description: Bluetooth speakers Qty 150",
    ].join("\n");
    const inlineDoc = parseDoc(inline);
    const [first, second] = extractGoodsLines(inline);
    assert.equal(parseLineFields(first!, inlineDoc, true).origin, "TW");
    assert.equal(parseLineFields(second!, inlineDoc, true).origin, null);

    const header = [
      "COMMERCIAL INVOICE",
      "Country of origin: CN",
      "Description: Wireless headphones Qty 200",
      "Description: Bluetooth speakers Qty 150",
    ].join("\n");
    const headerDoc = parseDoc(header);
    for (const line of extractGoodsLines(header)) {
      assert.equal(parseLineFields(line, headerDoc, true).origin, "CN");
    }
  });

  it("reads x200 and carton quantities used in the eval fixtures", () => {
    const qty = (line: string) => parseLineFields(line, doc, true).qty;
    assert.equal(qty("Description: Wireless Headphones (HS 8518.30.20) x200"), "200");
    assert.equal(qty("2. Frozen shrimp, peeled, 10 kg cartons, 200 ctn"), "200");
    assert.equal(qty("1. Stainless steel hex bolts M8x40, 5000 pcs"), "5000");
    assert.equal(qty("Description: Ceramic tiles 30 x 60 cm"), null);
    assert.equal(qty("Description: Sony Bravia X90 television"), null);
    assert.equal(qty("Description: Studio speakers model x100 pair"), null);
  });

  it("uses the goods description, not the whole document, on single-line docs", () => {
    const laptop = SAMPLE_DOCUMENTS.find((s) => s.id === "laptop")!;
    const f = parseLineFields(laptop.text, parseDoc(laptop.text), false);
    assert.match(f.description, /^Portable automatic data processing machines/);
  });
});

describe("buildEntryDraft", () => {
  it("records human overrides and open flags per line", () => {
    const s = suggestion();
    const draft = buildEntryDraft(
      parseDoc("Invoice No: INV-1\nSeller: A\nBuyer: B"),
      [
        {
          lineNo: 1,
          fields: { description: "housing kit", ...complete },
          suggestion: s,
          assigned: { hscode: "900630", description: "Cameras for underwater use" },
          exceptions: assessLine(s, { origin: null, qty: "1", amount: "1" }).exceptions,
        },
      ],
      new Date("2026-01-01T00:00:00Z"),
    );
    assert.equal(draft.status, "draft_not_filed");
    assert.equal(draft.header.invoiceNo, "INV-1");
    assert.equal(draft.lines[0]?.humanOverride, true);
    assert.deepEqual(draft.lines[0]?.openFlags, ["missing_origin"]);
  });
});
