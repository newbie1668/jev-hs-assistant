import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { suggestHsCode } from "./beam";
import { detectGoodsPrior } from "./goods-priors";
import { SAMPLE_DOCUMENTS } from "../samples";

const GARDEN_LIGHTING =
  "Plastic housing kit for garden lighting fixture, ABS enclosure";

const FUJI_SAMPLE = SAMPLE_DOCUMENTS.find(
  (s) => s.id === "underwater-housing",
)!.text;

describe("goods prior — camera evidence required", () => {
  it("does not fire on a garden-lighting housing kit", () => {
    assert.equal(detectGoodsPrior(GARDEN_LIGHTING), null);
  });

  it("fires on the Fujifilm underwater housing sample (path ends 900691)", () => {
    const prior = detectGoodsPrior(FUJI_SAMPLE);
    assert.ok(prior);
    assert.equal(prior.path[prior.path.length - 1], "900691");
  });
});

describe("suggestHsCode — no camera evidence", () => {
  it("garden lighting housing kit is not forced to 900691", async () => {
    const { suggestion } = await suggestHsCode(GARDEN_LIGHTING, {
      verify: true,
    });
    assert.notEqual(suggestion.hscode, "900691");
  });
});
