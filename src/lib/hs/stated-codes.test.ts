import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  extractStatedHsCandidates,
  goodsTextForClassification,
  pickPrimaryStatedHs6,
} from "./stated-codes";

describe("stated HS extraction — word boundaries", () => {
  it("ignores 'hs' inside words like 'months'", () => {
    const text = "Warranty 12 months, serial 12345678 units";
    assert.equal(extractStatedHsCandidates(text).length, 0);
    assert.equal(goodsTextForClassification(text), text);
  });

  it("ignores 'hs' at the end of 'depths'", () => {
    const text = "Fresh fish, depths 250000 kg";
    assert.equal(extractStatedHsCandidates(text).length, 0);
  });

  it("ignores 'HS' inside tokens like 'THS-2024'", () => {
    const text = "Ref THS-2024 order 4412001";
    assert.equal(extractStatedHsCandidates(text).length, 0);
  });

  it("still extracts a labelled HS code and strips it for classification", () => {
    const text = "Description of goods: Widgets\nHS Code: 8471.30";
    const candidates = extractStatedHsCandidates(text);
    const primary = pickPrimaryStatedHs6(candidates);
    assert.ok(primary);
    assert.equal(primary.hs6, "847130");
    assert.equal(goodsTextForClassification(text), "Widgets");
  });

  it("still extracts HS# prefixed codes", () => {
    const text = "HARMONISED CODE: HS#85171200";
    const candidates = extractStatedHsCandidates(text);
    const primary = pickPrimaryStatedHs6(candidates);
    assert.ok(primary);
    assert.equal(primary.hs6, "851712");
    assert.equal(primary.rawDigits, "85171200");
  });
});
