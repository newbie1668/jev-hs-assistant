import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  extractGoodsLines,
  extractStatedHsCandidates,
  goodsTextForClassification,
  MAX_GOODS_LINES,
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

  it("extracts goods wording before meta labels in non-camera inline blobs", () => {
    const text =
      "Stainless steel bolts M8 Qty 500 COUNTRY OF ORIGIN: DE HS CODE: 731815 UNIT PRICE: 0.10";
    assert.equal(goodsTextForClassification(text), "Stainless steel bolts M8");
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

describe("extractGoodsLines", () => {
  it("returns one line per Description: entry", () => {
    const text = [
      "COMMERCIAL INVOICE",
      "Description: Wireless Headphones (HS 8518.30.20) x200",
      "Description: Bluetooth Speakers (HS 8518.22.00) x150",
      "Description: USB-C Charging Docks (HS 8504.40.82) x100",
      "Total: USD 21,150.00",
    ].join("\n");
    const lines = extractGoodsLines(text);
    assert.equal(lines.length, 3);
    assert.ok(lines[0]!.includes("Wireless Headphones"));
  });

  it("recognises a numbered item list when no labelled lines exist", () => {
    const text = [
      "PACKING LIST",
      "1. Stainless steel hex bolts M8x40, 5000 pcs",
      "2. Frozen shrimp, peeled, 10 kg cartons, 200 ctn",
      "3. Men's cotton T-shirts knitted, 1200 pcs",
    ].join("\n");
    const lines = extractGoodsLines(text);
    assert.equal(lines.length, 3);
    assert.ok(lines[1]!.includes("shrimp"));
  });

  it("single-description invoice yields 1 line; metadata lines are not items", () => {
    const text = [
      "COMMERCIAL INVOICE",
      "Description of goods: Wireless Bluetooth headphones",
      "Quantity: 200 units",
      "Unit price: USD 45.00",
      "Country of origin: China",
      "Incoterm: CIF London",
    ].join("\n");
    const lines = extractGoodsLines(text);
    assert.equal(lines.length, 1);
    assert.ok(lines[0]!.includes("headphones"));
  });

  it("caps at MAX_GOODS_LINES", () => {
    const text = Array.from(
      { length: 12 },
      (_, i) => `Description: Item ${i} widgets`,
    ).join("\n");
    assert.equal(extractGoodsLines(text).length, MAX_GOODS_LINES);
  });
});
