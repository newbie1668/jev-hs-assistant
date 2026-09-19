import fs from "node:fs";
import path from "node:path";
import Papa from "papaparse";
import {
  HS_DATASET_VERSION,
  HS_ROOT_PARENT,
  HS6_LEVEL,
  type HsNode,
  type HsPathStep,
} from "./types";

export interface HsTaxonomy {
  version: typeof HS_DATASET_VERSION;
  byCode: Map<string, HsNode>;
  childrenOf: Map<string, HsNode[]>;
  nodeCount: number;
}

let cached: HsTaxonomy | null = null;

function dataDir(): string {
  return path.join(process.cwd(), "data", "hs2022");
}

function parseNodes(csv: string): HsNode[] {
  const parsed = Papa.parse<Record<string, string>>(csv, {
    header: true,
    skipEmptyLines: true,
  });
  if (parsed.errors.length > 0) {
    throw new Error(`Failed to parse HS CSV: ${parsed.errors[0]?.message}`);
  }
  return parsed.data
    .filter((row) => row.hscode)
    .map((row) => ({
      section: row.section ?? "",
      hscode: row.hscode.trim(),
      description: (row.description ?? "").trim(),
      parent: (row.parent ?? HS_ROOT_PARENT).trim(),
      level: Number(row.level) as HsNode["level"],
    }));
}

function readHsCsv(): string {
  const dir = dataDir();
  const fullPath = path.join(dir, "harmonized-system.csv");
  if (fs.existsSync(fullPath)) {
    return fs.readFileSync(fullPath, "utf8");
  }

  const part1Path = path.join(dir, "harmonized-system-part1.csv");
  const part2Path = path.join(dir, "harmonized-system-part2.csv");
  if (fs.existsSync(part1Path) && fs.existsSync(part2Path)) {
    const part1 = fs.readFileSync(part1Path, "utf8");
    const part2 = fs.readFileSync(part2Path, "utf8");
    const part2Body = part2.split(/\r?\n/).slice(1).join("\n");
    return part1.trimEnd() + "\n" + part2Body.trim() + "\n";
  }

  throw new Error(
    `HS taxonomy CSV not found under ${dir} (expected harmonized-system.csv or part1/part2)`,
  );
}

export function loadHsTaxonomy(): HsTaxonomy {
  if (cached) return cached;

  const csv = readHsCsv();
  const nodes = parseNodes(csv);

  const byCode = new Map<string, HsNode>();
  const childrenOf = new Map<string, HsNode[]>();

  for (const node of nodes) {
    byCode.set(node.hscode, node);
    const siblings = childrenOf.get(node.parent) ?? [];
    siblings.push(node);
    childrenOf.set(node.parent, siblings);
  }

  for (const [, children] of childrenOf) {
    children.sort((a, b) => a.hscode.localeCompare(b.hscode));
  }

  cached = {
    version: HS_DATASET_VERSION,
    byCode,
    childrenOf,
    nodeCount: nodes.length,
  };
  return cached;
}

export function getChildren(
  taxonomy: HsTaxonomy,
  parentCode: string,
): HsNode[] {
  return taxonomy.childrenOf.get(parentCode) ?? [];
}

export function getNode(
  taxonomy: HsTaxonomy,
  hscode: string,
): HsNode | undefined {
  return taxonomy.byCode.get(hscode);
}

export function isLegalHs6(taxonomy: HsTaxonomy, hscode: string): boolean {
  const node = taxonomy.byCode.get(hscode);
  return Boolean(node && node.level === HS6_LEVEL);
}

export function buildAncestryPath(
  taxonomy: HsTaxonomy,
  hscode: string,
): HsPathStep[] {
  const steps: HsPathStep[] = [];
  let current = taxonomy.byCode.get(hscode);
  while (current) {
    steps.unshift({
      hscode: current.hscode,
      description: current.description,
      level: current.level,
      section: current.section,
    });
    if (current.parent === HS_ROOT_PARENT) break;
    current = taxonomy.byCode.get(current.parent);
  }
  return steps;
}

export function taxonomyStats(taxonomy: HsTaxonomy) {
  const chapters = getChildren(taxonomy, HS_ROOT_PARENT).length;
  let maxBranch = 0;
  for (const children of taxonomy.childrenOf.values()) {
    maxBranch = Math.max(maxBranch, children.length);
  }
  return {
    version: taxonomy.version,
    nodeCount: taxonomy.nodeCount,
    chapters,
    maxBranching: maxBranch,
    hs6Ceiling: true,
  };
}
