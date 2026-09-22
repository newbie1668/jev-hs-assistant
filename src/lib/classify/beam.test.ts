import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { suggestHsCode } from "./beam";
import type { JudgmentClient } from "../typesafe/judgments";

function equalProbabilities(
  options: Array<{ id: string; label: string }>,
): Record<string, number> {
  const probabilities: Record<string, number> = {};
  for (const o of options) probabilities[o.id] = 1 / options.length;
  return probabilities;
}

/**
 * Strongly prefers 85 → 8517 → 851762 while keeping 84 → 8471 → 847130
 * in the beam at 0.09. verifyMatch fails 851762, passes 847130.
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
        options[0]!;
      const keep = options.find(
        (o) => o.id === "84" || o.id === "8471" || o.id === "847130",
      );
      const probabilities: Record<string, number> = {};
      for (const o of options) {
        if (o.id === pick.id) probabilities[o.id] = 0.9;
        else if (keep && o.id === keep.id) probabilities[o.id] = 0.09;
        else probabilities[o.id] = 0.005;
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

/**
 * Prefers a strong "prefer" chain (edges .95/.98/.99) and keeps a weaker
 * "keep" chain alive (root edge .35, then .5). verifyMatch fails the
 * prefer leaf and barely passes the keep leaf.
 */
function strongTopWeakAltClient(): JudgmentClient {
  const prefer = ["03", "0306", "030617"];
  const keep = ["16", "1605", "160521"];
  return {
    mode: "mock",
    async chooseChild(state, options) {
      const parent = state.parentCode;
      const onKeepPath = keep.includes(parent);
      const onPreferPath = prefer.includes(parent) || parent === "TOTAL";
      const chain = onKeepPath ? keep : prefer;
      const pick =
        options.find((o) => chain.includes(o.id)) ??
        options.find((o) => (parent === "TOTAL" ? prefer : []).includes(o.id)) ??
        options[0]!;
      const pickP = onKeepPath
        ? 0.5
        : parent === "TOTAL"
          ? 0.95
          : onPreferPath
            ? parent.length === 2
              ? 0.98
              : 0.99
            : 0.5;
      const probabilities: Record<string, number> = {};
      for (const o of options) {
        if (o.id === pick.id) probabilities[o.id] = pickP;
        else if (parent === "TOTAL" && keep.includes(o.id))
          probabilities[o.id] = 0.35;
        else probabilities[o.id] = 0.005;
      }
      return { choice: pick.id, confidence: 0.9, probabilities };
    },
    async verifyMatch(state) {
      if (state.hscode === "030617") return { matchProbability: 0.33 };
      if (state.hscode === "160521") return { matchProbability: 0.56 };
      return { matchProbability: 0.3 };
    },
    async routeCommand(_utterance, catalog) {
      const id = Object.keys(catalog)[0]!;
      return { choice: id, confidence: 1, probabilities: { [id]: 1 } };
    },
  };
}

/**
 * Root: 85 p=0.97, 84 p=0.03, everything else 0 — so 84 is pruned at
 * depth 2 by stronger 85-descendants. All 85 leaves verify 0.1; the
 * fallback descent into 84 finds 847130 verifying 0.9.
 */
function chapterFallbackClient(): {
  client: JudgmentClient;
  parentCodes: string[];
} {
  const parentCodes: string[] = [];
  const client: JudgmentClient = {
    mode: "mock",
    async chooseChild(state, options) {
      parentCodes.push(state.parentCode);
      const probabilities = equalProbabilities(options);
      const set = (id: string, p: number) => {
        if (options.some((o) => o.id === id)) probabilities[id] = p;
      };
      if (options.some((o) => o.id === "85")) {
        set("85", 0.97);
        set("84", 0.03);
        for (const o of options) {
          if (o.id !== "85" && o.id !== "84") probabilities[o.id] = 0;
        }
      }
      set("8517", 0.5);
      set("8543", 0.3);
      set("8501", 0.1);
      set("8471", 0.98);
      set("847130", 0.99);
      const choice = options.reduce((a, b) =>
        (probabilities[b.id] ?? 0) > (probabilities[a.id] ?? 0) ? b : a,
      );
      return { choice: choice.id, confidence: 0.9, probabilities };
    },
    async verifyMatch(state) {
      if (state.hscode === "847130") return { matchProbability: 0.9 };
      return { matchProbability: 0.1 };
    },
    async routeCommand(_utterance, catalog) {
      const id = Object.keys(catalog)[0]!;
      return { choice: id, confidence: 1, probabilities: { [id]: 1 } };
    },
  };
  return { client, parentCodes };
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

  it("does not swap for a barely-passing weaker path", async () => {
    const { suggestion } = await suggestHsCode(
      "Frozen cold-water shrimp",
      { verify: true, judgmentClient: strongTopWeakAltClient() },
    );

    assert.equal(suggestion.hscode, "030617");
    assert.equal(suggestion.verificationRerank, null);
    assert.equal(suggestion.verification?.passed, false);
  });

  it("chapter fallback recovers a pruned chapter", async () => {
    const { client, parentCodes } = chapterFallbackClient();
    const { suggestion } = await suggestHsCode(
      "Electrical apparatus - portable automatic data processing machines, laptop computers",
      { verify: true, judgmentClient: client },
    );

    assert.equal(suggestion.hscode, "847130");
    assert.equal(suggestion.verification?.passed, true);
    assert.equal(suggestion.verification?.matchProbability, 0.9);
    assert.ok(suggestion.verificationRerank);
    assert.match(suggestion.verificationRerank!.from, /^85/);
    assert.equal(suggestion.verificationRerank!.to, "847130");
    // The initial beam also expands whichever zero-probability chapter fills
    // the third slot (chapter-level only); the fallback is the only descent
    // below chapter level outside the 85-subtree — and it goes into 84.
    assert.ok(
      parentCodes.every(
        (p) =>
          p === "TOTAL" ||
          p.length <= 2 ||
          p.startsWith("85") ||
          p.startsWith("84"),
      ),
      `unexpected parents explored: ${parentCodes.join(",")}`,
    );
    assert.ok(parentCodes.includes("84"));
  });
});
