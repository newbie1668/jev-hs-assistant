import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { suggestHsCode } from "./beam";
import { extractGoodsLines } from "../hs/stated-codes";
import { SAMPLE_DOCUMENTS } from "../samples";

describe("suggestHsCode — sample documents regression", () => {
  for (const sample of SAMPLE_DOCUMENTS) {
    if (sample.expectedLines) {
      it(`${sample.id} → ${sample.expectedLines.join(" + ")}`, async () => {
        const lines = extractGoodsLines(sample.text);
        assert.equal(lines.length, sample.expectedLines!.length);
        const codes = await Promise.all(
          lines.map(async (line) => (await suggestHsCode(line)).suggestion.hscode),
        );
        assert.deepEqual(codes, sample.expectedLines);
      });
      continue;
    }
    it(`${sample.id} → ${sample.expectedHs6Hint ?? "?"}`, async () => {
      const { suggestion } = await suggestHsCode(sample.text, {
        verify: true,
      });
      assert.equal(suggestion.hscode, sample.expectedHs6Hint);
    });
  }
});
