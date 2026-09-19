import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { suggestHsCode } from "../classify/beam";
import {
  extractStatedHsCandidates,
  goodsTextForClassification,
  pickPrimaryStatedHs6,
} from "../hs/stated-codes";

const FUJI_INVOICE = `Fujifilm X-T2 40M/130FT Underwater housing kit Qty 1 COUNTRY OF ORIGIN: Hong Kong HARMONISED CODE: HS#85171200 UNIT VALUE: 389.99`;

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

describe("suggestHsCode — camera underwater housing", () => {
  it("suggests photographic accessories (9006xx), not telecom 851762; flags document disagreement", async () => {
    const { suggestion } = await suggestHsCode(FUJI_INVOICE, { verify: true });

    assert.notEqual(suggestion.hscode, "851762");
    assert.match(suggestion.hscode, /^9006/);
    // Housing kit → camera parts/accessories is the preferred leaf
    assert.equal(suggestion.hscode, "900691");

    assert.ok(suggestion.documentStated);
    assert.equal(suggestion.documentStated.hs6, "851712");
    assert.equal(suggestion.documentStated.rawDigits, "85171200");
    assert.equal(suggestion.documentStated.disagreesWithSuggestion, true);
    // 851712 is not a legal HS6 in the pinned 2022 tree
    assert.equal(suggestion.documentStated.inTaxonomy, false);
  });
});
