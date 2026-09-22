import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { suggestHsCode } from "./beam";
import type { JudgmentClient } from "../typesafe/judgments";

/**
 * Judgment client that strongly prefers 85 → 8517 → 851762 for laptops,
 * while keeping 84 → 8471 → 847130 in the beam at lower probability.
 * verifyMatch fails 851762 and passes 847130.
 */
function telecomBiasedClient(): JudgmentClient {
  return {
    mode: "mock",
    async chooseChild(_state, options) {
      const pick =
        options.find((o) => o.id === "851762") ??
        options.find((o) => o.id === "8517") ??
        options.find((o) => o.id === "847130") ??
        options.find((o) => o.id === "8471") ??
        options.find((o) => o.id === "85") ??
        options.find((o) => o.id === "84") ??
        options.find((o) => o.id.startsWith("8517")) ??
        options.find((o) => o.id.startsWith("8471")) ??
        options[0]!;
      const keep = options.find(
        (o) => o.id === "84" || o.id === "8471" || o.id === "847130",
      );
      const probabilities: Record<string, number> = {};
      const rest =
        (1 - 0.82 - (keep && keep.id !== pick.id ? 0.12 : 0)) /
        Math.max(1, options.length - (keep && keep.id !== pick.id ? 2 : 1));
      for (const o of options) {
        if (o.id === pick.id) probabilities[o.id] = 0.82;
        else if (keep && o.id === keep.id) probabilities[o.id] = 0.12;
        else probabilities[o.id] = rest;
      }
      return { choice: pick.id, confidence: 0.9, probabilities };
    },
    async verifyMatch(state) {
      if (state.hscode === "847130") return { matchProbability: 0.9 };
      if (state.hscode === "851762") return { matchProbability: 0.1 };
      return { matchProbability: 0.3 };
    },
    async routeCommand(_utterance, catalog) {
      const id = Object.keys(catalog)[0]!;
      return { choice: id, confidence: 1, probabilities: { [id]: 1 } };
    },
  };
}

describe("suggestHsCode — verification rerank", () => {
  it("swaps a failing beam top for a passing finished leaf", async () => {
    const { suggestion } = await suggestHsCode(
      "Portable computers (laptops)",
      { verify: true, judgmentClient: telecomBiasedClient() },
    );

    assert.equal(suggestion.hscode, "847130");
    assert.equal(suggestion.verificationRerank?.from, "851762");
    assert.equal(suggestion.verificationRerank?.to, "847130");
    assert.equal(suggestion.verification?.matchProbability, 0.9);
    assert.equal(suggestion.verification?.passed, true);
    assert.equal(suggestion.runnerUp?.hscode, "851762");
  });
});
