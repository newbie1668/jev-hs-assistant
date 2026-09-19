import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { suggestHsCode } from "../classify/beam";
import {
  detectGoodsPrior,
  priorChildForParent,
} from "../classify/goods-priors";
import {
  extractStatedHsCandidates,
  goodsTextForClassification,
  pickPrimaryStatedHs6,
} from "../hs/stated-codes";
import { SAMPLE_DOCUMENTS } from "../samples";
import type { JudgmentClient } from "../typesafe/judgments";

const FUJI_INVOICE = `Fujifilm X-T2 40M/130FT Underwater housing kit Qty 1 COUNTRY OF ORIGIN: Hong Kong HARMONISED CODE: HS#85171200 UNIT VALUE: 389.99`;

const SAMPLE =
  SAMPLE_DOCUMENTS.find((s) => s.id === "underwater-housing")!.text;

/** Judgment client that always prefers chapter 85 / 8517 telecom children. */
function telecomPoisonedClient(): JudgmentClient {
  return {
    mode: "mock",
    async chooseChild(_state, options) {
      const pick =
        options.find((o) => o.id === "85") ??
        options.find((o) => o.id === "8517") ??
        options.find((o) => o.id.startsWith("8517")) ??
        options.find((o) => o.id.startsWith("85")) ??
        options[0]!;
      const probabilities: Record<string, number> = {};
      for (const o of options) {
        probabilities[o.id] = o.id === pick.id ? 0.95 : 0.05 / Math.max(1, options.length - 1);
      }
      return { choice: pick.id, confidence: 0.9, probabilities };
    },
    async verifyMatch() {
      return { matchProbability: 0.2 };
    },
    async routeCommand(_utterance, catalog) {
      const id = Object.keys(catalog)[0]!;
      return { choice: id, confidence: 1, probabilities: { [id]: 1 } };
    },
  };
}

describe("stated HS extraction", () => {
  it("extracts HS#85171200 from harmonised-code label", () => {
    const candidates = extractStatedHsCandidates(FUJI_INVOICE);
    const primary = pickPrimaryStatedHs6(candidates);
    assert.ok(primary);
    assert.equal(primary.hs6, "851712");
    assert.equal(primary.rawDigits, "85171200");
  });

  it("strips printed HS from classification text", () => {
    const goods = goodsTextForClassification(FUJI_INVOICE);
    assert.match(goods, /Fujifilm|Underwater housing/i);
    assert.doesNotMatch(goods, /85171200|851712/);
  });
});

describe("goods prior — camera underwater housing", () => {
  it("locks path 90 → 9006 → 900691", () => {
    const prior = detectGoodsPrior(
      goodsTextForClassification(FUJI_INVOICE),
    );
    assert.ok(prior);
    assert.equal(prior.id, "camera_underwater_housing");
    assert.deepEqual(prior.path, ["90", "9006", "900691"]);
    assert.equal(priorChildForParent(prior, "TOTAL"), "90");
    assert.equal(priorChildForParent(prior, "90"), "9006");
    assert.equal(priorChildForParent(prior, "9006"), "900691");
  });
});

describe("suggestHsCode — camera underwater housing", () => {
  it("suggests photographic accessories (900691), not telecom 851762; flags document disagreement", async () => {
    const { suggestion } = await suggestHsCode(FUJI_INVOICE, { verify: true });

    assert.notEqual(suggestion.hscode, "851762");
    assert.notEqual(suggestion.hscode, "851712");
    assert.match(suggestion.hscode, /^9006/);
    assert.equal(suggestion.hscode, "900691");

    assert.ok(suggestion.documentStated);
    assert.equal(suggestion.documentStated.hs6, "851712");
    assert.equal(suggestion.documentStated.rawDigits, "85171200");
    assert.equal(suggestion.documentStated.disagreesWithSuggestion, true);
    assert.equal(suggestion.documentStated.inTaxonomy, false);
  });

  it("UI sample document also yields 900691; printed HS stays compare-only", async () => {
    const { suggestion } = await suggestHsCode(SAMPLE, { verify: true });
    assert.equal(suggestion.hscode, "900691");
    assert.equal(suggestion.documentStated?.hs6, "851712");
    assert.equal(suggestion.documentStated?.disagreesWithSuggestion, true);
    assert.notEqual(suggestion.hscode, suggestion.documentStated?.hs6);
  });

  it("description prior wins even when judgment client prefers telecom 85xx", async () => {
    const { suggestion } = await suggestHsCode(FUJI_INVOICE, {
      verify: false,
      judgmentClient: telecomPoisonedClient(),
    });
    assert.equal(suggestion.hscode, "900691");
    assert.notEqual(suggestion.hscode, "851762");
    assert.equal(suggestion.documentStated?.rawDigits, "85171200");
  });
});
