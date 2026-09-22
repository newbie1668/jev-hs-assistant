import {
  detectGoodsPrior,
  priorChildForParent,
  type GoodsPrior,
} from "@/lib/classify/goods-priors";
import {
  buildAncestryPath,
  getChildren,
  getNode,
  isLegalHs6,
  loadHsTaxonomy,
  type HsTaxonomy,
} from "@/lib/hs/taxonomy";
import {
  extractStatedHsCandidates,
  goodsTextForClassification,
  pickPrimaryStatedHs6,
} from "@/lib/hs/stated-codes";
import {
  HS6_LEVEL,
  HS_DATASET_VERSION,
  HS_ROOT_PARENT,
  type DocumentStatedHs,
  type HsNode,
  type HsPathStep,
  type HsSuggestion,
} from "@/lib/hs/types";
import {
  createJudgmentClient,
  getJudgmentMode,
  type ChoiceResult,
  type JudgmentClient,
} from "@/lib/typesafe/judgments";
import {
  TraceCollector,
  type DecisionTrace,
} from "@/lib/typesafe/trace";

const EPSILON = 1e-9;
const DEFAULT_BEAM_WIDTH = 3;

interface BeamCandidate {
  pathCodes: string[];
  probabilityProduct: number;
  decisionCount: number;
  edgeProbabilities: number[];
  edgeConfidences: number[];
}

function pathScore(candidate: BeamCandidate): number {
  if (candidate.decisionCount === 0) return 1;
  return (
    candidate.probabilityProduct ** (1 / candidate.decisionCount)
  );
}

function currentNode(
  taxonomy: HsTaxonomy,
  candidate: BeamCandidate,
): { code: string; description: string } {
  if (candidate.pathCodes.length === 0) {
    return { code: HS_ROOT_PARENT, description: "Harmonized System root" };
  }
  const code = candidate.pathCodes[candidate.pathCodes.length - 1]!;
  const node = getNode(taxonomy, code);
  return {
    code,
    description: node?.description ?? code,
  };
}

function isLeafForMvp(taxonomy: HsTaxonomy, node: HsNode): boolean {
  if (node.level === HS6_LEVEL) return true;
  const children = getChildren(taxonomy, node.hscode);
  return children.length === 0;
}

function resolveDocumentStated(
  taxonomy: HsTaxonomy,
  documentText: string,
  suggestedHs6: string,
): DocumentStatedHs | null {
  const primary = pickPrimaryStatedHs6(extractStatedHsCandidates(documentText));
  if (!primary) return null;
  const node = getNode(taxonomy, primary.hs6);
  const inTaxonomy = isLegalHs6(taxonomy, primary.hs6);
  return {
    rawDigits: primary.rawDigits,
    hs6: primary.hs6,
    inTaxonomy,
    description: node?.description ?? null,
    disagreesWithSuggestion: primary.hs6 !== suggestedHs6,
  };
}

/**
 * Steer Choice toward a description-driven prior path when the preferred
 * child is among legal options. Applies in mock and TypeSafe modes so a
 * wrong live model (or residual telecom cues) cannot override obvious goods.
 */
function applyGoodsPriorToChoice(
  prior: GoodsPrior | null,
  parentCode: string,
  options: Array<{ id: string; label: string }>,
  result: ChoiceResult,
): ChoiceResult {
  if (!prior || options.length <= 1) return result;
  const preferred = priorChildForParent(prior, parentCode);
  if (!preferred || !options.some((o) => o.id === preferred)) return result;

  const probabilities: Record<string, number> = {};
  const mass = 0.92;
  const rest = (1 - mass) / Math.max(1, options.length - 1);
  for (const opt of options) {
    probabilities[opt.id] = opt.id === preferred ? mass : rest;
  }
  return {
    choice: preferred,
    confidence: Math.max(result.confidence, 0.9),
    probabilities,
  };
}

async function expandCandidate(
  taxonomy: HsTaxonomy,
  client: JudgmentClient,
  goodsDescription: string,
  candidate: BeamCandidate,
  prior: GoodsPrior | null,
): Promise<BeamCandidate[]> {
  const parent = currentNode(taxonomy, candidate);
  const children = getChildren(taxonomy, parent.code);
  if (children.length === 0) return [candidate];

  const ancestryLabels = candidate.pathCodes.map((code) => {
    const n = getNode(taxonomy, code);
    return n ? `${n.hscode} — ${n.description}` : code;
  });

  const optionList = children.map((c) => ({
    id: c.hscode,
    label: c.description,
  }));

  const raw = await client.chooseChild(
    {
      goodsDescription,
      ancestry: ancestryLabels,
      parentCode: parent.code,
      parentDescription: parent.description,
    },
    optionList,
  );
  const result = applyGoodsPriorToChoice(prior, parent.code, optionList, raw);

  const next: BeamCandidate[] = [];
  for (const child of children) {
    const p = result.probabilities[child.hscode] ?? EPSILON;
    const isDecision = children.length > 1;
    next.push({
      pathCodes: [...candidate.pathCodes, child.hscode],
      probabilityProduct:
        candidate.probabilityProduct *
        (isDecision ? Math.max(p, EPSILON) : 1),
      decisionCount: candidate.decisionCount + (isDecision ? 1 : 0),
      edgeProbabilities: [...candidate.edgeProbabilities, p],
      edgeConfidences: [...candidate.edgeConfidences, result.confidence],
    });
  }
  return next;
}

export async function suggestHsCode(
  goodsDescription: string,
  options?: {
    beamWidth?: number;
    verify?: boolean;
    /** Test-only: inject a judgment client (e.g. telecom-poisoned). */
    judgmentClient?: JudgmentClient;
  },
): Promise<{ suggestion: HsSuggestion; trace: DecisionTrace }> {
  const rawText = goodsDescription.trim();
  if (!rawText) {
    throw new Error("Goods description is empty — paste shipping document text first.");
  }

  // Classify from goods wording only — strip / ignore printed HS spans that may be wrong.
  const classifyText = goodsTextForClassification(rawText);
  if (!classifyText) {
    throw new Error("Goods description is empty — paste shipping document text first.");
  }

  const taxonomy = loadHsTaxonomy();
  const mode = options?.judgmentClient?.mode ?? getJudgmentMode();
  const trace = new TraceCollector("suggest_hs", mode);
  const client = options?.judgmentClient ?? createJudgmentClient(trace);
  const goodsPrior = detectGoodsPrior(classifyText);
  const beamWidth = options?.beamWidth ?? DEFAULT_BEAM_WIDTH;

  let beam: BeamCandidate[] = [
    {
      pathCodes: [],
      probabilityProduct: 1,
      decisionCount: 0,
      edgeProbabilities: [],
      edgeConfidences: [],
    },
  ];

  // Descend until all beam tips are HS6 (or childless)
  for (let depth = 0; depth < 8; depth += 1) {
    const unfinished = beam.filter((c) => {
      if (c.pathCodes.length === 0) return true;
      const node = getNode(taxonomy, c.pathCodes[c.pathCodes.length - 1]!);
      return node ? !isLeafForMvp(taxonomy, node) : false;
    });
    if (unfinished.length === 0) break;

    const expanded = (
      await Promise.all(
        unfinished.map((candidate) =>
          expandCandidate(
            taxonomy,
            client,
            classifyText,
            candidate,
            goodsPrior,
          ),
        ),
      )
    ).flat();
    // Keep finished leaves from previous beam
    const finished = beam.filter((c) => {
      if (c.pathCodes.length === 0) return false;
      const node = getNode(taxonomy, c.pathCodes[c.pathCodes.length - 1]!);
      return node ? isLeafForMvp(taxonomy, node) : false;
    });
    const merged = [...finished, ...expanded];
    merged.sort((a, b) => pathScore(b) - pathScore(a));
    beam = merged.slice(0, beamWidth);
  }

  beam.sort((a, b) => pathScore(b) - pathScore(a));
  let top = beam[0];
  if (!top || top.pathCodes.length === 0) {
    throw new Error("Could not traverse HS taxonomy for this description.");
  }

  // Hard prior: if description cues lock a legal HS6, prefer that leaf even when
  // the judgment client (esp. live TypeSafe) drifted into telecom / other chapters.
  const priorHs6 = goodsPrior?.path[goodsPrior.path.length - 1];
  let priorApplied = false;
  if (priorHs6 && isLegalHs6(taxonomy, priorHs6)) {
    priorApplied = true;
    const priorMatch = beam.find(
      (c) => c.pathCodes[c.pathCodes.length - 1] === priorHs6,
    );
    if (priorMatch) {
      top = priorMatch;
    } else {
      const ancestry = buildAncestryPath(taxonomy, priorHs6);
      top = {
        pathCodes: ancestry.map((s) => s.hscode),
        probabilityProduct: 0.92 ** Math.max(1, ancestry.length),
        decisionCount: ancestry.length,
        edgeProbabilities: ancestry.map(() => 0.92),
        edgeConfidences: ancestry.map(() => 0.95),
      };
    }
  }

  let leafCode = top.pathCodes[top.pathCodes.length - 1]!;
  let leaf = getNode(taxonomy, leafCode);
  if (!leaf) {
    throw new Error(`Invalid HS code produced: ${leafCode}`);
  }

  let verification: HsSuggestion["verification"];
  let verificationRerank: HsSuggestion["verificationRerank"] = null;
  if (options?.verify !== false) {
    if (priorApplied) {
      const pathLabels = buildAncestryPath(taxonomy, leafCode).map(
        (p) => `${p.hscode} ${p.description}`,
      );
      const v = await client.verifyMatch({
        goodsDescription: classifyText,
        hscode: leaf.hscode,
        officialDescription: leaf.description,
        pathLabels,
      });
      verification = {
        matchProbability: v.matchProbability,
        passed: v.matchProbability >= 0.55,
      };
    } else {
      // Verify the top finished HS6 leaves in parallel; if the beam top fails
      // verification but another candidate passes, prefer the passing leaf.
      const seenCodes = new Set<string>();
      const targets: Array<{ candidate: BeamCandidate; node: HsNode }> = [];
      for (const candidate of beam) {
        const code = candidate.pathCodes[candidate.pathCodes.length - 1]!;
        const node = getNode(taxonomy, code);
        if (!node || node.level !== HS6_LEVEL || seenCodes.has(code)) continue;
        seenCodes.add(code);
        targets.push({ candidate, node });
        if (targets.length >= 3) break;
      }
      if (!seenCodes.has(leafCode)) {
        targets.unshift({ candidate: top, node: leaf });
      }

      const results = await Promise.all(
        targets.map(async ({ candidate, node }) => {
          const pathLabels = buildAncestryPath(taxonomy, node.hscode).map(
            (p) => `${p.hscode} ${p.description}`,
          );
          const v = await client.verifyMatch({
            goodsDescription: classifyText,
            hscode: node.hscode,
            officialDescription: node.description,
            pathLabels,
          });
          return { candidate, node, matchProbability: v.matchProbability };
        }),
      );

      let chosen = results.find((r) => r.node.hscode === leafCode) ?? results[0]!;
      if (chosen.matchProbability < 0.55) {
        const passing = results
          .filter((r) => r !== chosen && r.matchProbability >= 0.55)
          .sort((a, b) => b.matchProbability - a.matchProbability)[0];
        if (passing) {
          verificationRerank = {
            from: chosen.node.hscode,
            to: passing.node.hscode,
          };
          chosen = passing;
          top = passing.candidate;
          leafCode = passing.node.hscode;
          leaf = passing.node;
        }
      }
      verification = {
        matchProbability: chosen.matchProbability,
        passed: chosen.matchProbability >= 0.55,
      };
    }
  }

  const path: HsPathStep[] = buildAncestryPath(taxonomy, leafCode).map(
    (step, index) => ({
      ...step,
      edgeProbability: top.edgeProbabilities[index],
    }),
  );

  const second = beam.find(
    (c) => c.pathCodes[c.pathCodes.length - 1] !== leafCode,
  );
  const topScore = pathScore(top);
  const secondScore = second ? pathScore(second) : null;
  const separation =
    secondScore && secondScore > 0 ? topScore / secondScore : null;

  const minEdgeConfidence =
    top.edgeConfidences.length === 0
      ? 0
      : Math.min(...top.edgeConfidences);

  const runnerUpNode = second
    ? getNode(taxonomy, second.pathCodes[second.pathCodes.length - 1]!)
    : undefined;

  const documentStated = resolveDocumentStated(taxonomy, rawText, leaf.hscode);

  return {
    suggestion: {
      hscode: leaf.hscode,
      description: leaf.description,
      path,
      pathScore: topScore,
      confidence: minEdgeConfidence,
      separation,
      runnerUp: runnerUpNode
        ? {
            hscode: runnerUpNode.hscode,
            description: runnerUpNode.description,
            pathScore: secondScore ?? 0,
          }
        : null,
      datasetVersion: HS_DATASET_VERSION,
      judgmentMode: client.mode,
      edgeConfidences: top.edgeConfidences,
      verification,
      verificationRerank,
      documentStated,
    },
    trace: trace.finish(),
  };
}
