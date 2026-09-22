import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { suggestHsCode } from "./beam";
import { SAMPLE_DOCUMENTS } from "../samples";

describe("suggestHsCode — sample documents regression", () => {
  for (const sample of SAMPLE_DOCUMENTS) {
    it(`${sample.id} → ${sample.expectedHs6Hint ?? "?"}`, async () => {
      const { suggestion } = await suggestHsCode(sample.text, {
        verify: true,
      });
      assert.equal(suggestion.hscode, sample.expectedHs6Hint);
    });
  }
});
