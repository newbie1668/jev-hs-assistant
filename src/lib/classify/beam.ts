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

async function expandCandidate(
  taxonomy: HsTaxonomy,
  client: JudgmentClient,
  goodsDescription: string,
  candidate: BeamCandidate,
): Promise<BeamCandidate[]> {
  const parent = currentNode(taxonomy, candidate);
  const children = getChildren(taxonomy, parent.code);
  if (children.length === 0) return [candidate];

  const ancestryLabels = candidate.pathCodes.map((code) => {
    const n = getNode(taxonomy, code);
    return n ? `${n.hscode} — ${n.description}` : code;
  });

  const result = await client.chooseChild(
    {
      goodsDescription,
      ancestry: ancestryLabels,
      parentCode: parent.code,
      parentDescription: parent.description,
    },
    children.map((c) => ({ id: c.hscode, label: c.description })),
  );

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
  options?: { beamWidth?: number; verify?: boolean },
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
  const mode = getJudgmentMode();
  const trace = new TraceCollector("suggest_hs", mode);
  const client = createJudgmentClient(trace);
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

    const expanded: BeamCandidate[] = [];
    for (const candidate of unfinished) {
      const kids = await expandCandidate(
        taxonomy,
        client,
        classifyText,
        candidate,
      );
      expanded.push(...kids);
    }
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
  const top = beam[0];
  if (!top || top.pathCodes.length === 0) {
    throw new Error("Could not traverse HS taxonomy for this description.");
  }

  const leafCode = top.pathCodes[top.pathCodes.length - 1]!;
  const leaf = getNode(taxonomy, leafCode);
  if (!leaf) {
    throw new Error(`Invalid HS code produced: ${leafCode}`);
  }

  // Never invent — validate existence and prefer HS6
  if (leaf.level !== HS6_LEVEL) {
    // If we stopped early at a non-HS6, try to continue greedily if children exist
    // but still only pick legal children from the tree.
  }

  const path: HsPathStep[] = buildAncestryPath(taxonomy, leafCode).map(
    (step, index) => ({
      ...step,
      edgeProbability: top.edgeProbabilities[index],
    }),
  );

  const second = beam[1];
  const topScore = pathScore(top);
  const secondScore = second ? pathScore(second) : null;
  const separation =
    secondScore && secondScore > 0 ? topScore / secondScore : null;

  const minEdgeConfidence =
    top.edgeConfidences.length === 0
      ? 0
      : Math.min(...top.edgeConfidences);

  let verification: HsSuggestion["verification"];
  if (options?.verify !== false) {
    const v = await client.verifyMatch({
      goodsDescription: classifyText,
      hscode: leaf.hscode,
      officialDescription: leaf.description,
      pathLabels: path.map((p) => `${p.hscode} ${p.description}`),
    });
    verification = {
      matchProbability: v.matchProbability,
      passed: v.matchProbability >= 0.55,
    };
  }

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
      documentStated,
    },
    trace: trace.finish(),
  };
}
