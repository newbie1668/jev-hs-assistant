/**
 * Deterministic description cues that steer hierarchical Choice toward the
 * correct HS branch regardless of judgment mode (mock or TypeSafe).
 *
 * Printed / supplier HS codes are never used here — only goods wording.
 */

export interface GoodsPrior {
  id: string;
  /** Preferred ancestry from chapter → HS4 → HS6 */
  path: string[];
  reason: string;
}

const CAMERA_HOUSING_QUERY =
  /underwater\s+housing|camera\s+housing|dive\s+housing|(?:fujifilm|canon|nikon|sony|olympus|gopro).{0,40}housing|housing.{0,40}(?:fujifilm|canon|nikon|sony|camera|x-?t\d)|housing\s+kit.{0,60}(?:camera|photograph|underwater|dive)|(?:camera|photograph|underwater|dive).{0,60}housing\s+kit/i;

/**
 * Camera underwater housing kits are photographic accessories (HS 9006.91),
 * not telecom apparatus — even when the invoice prints HS#8517….
 */
export function detectGoodsPrior(goodsDescription: string): GoodsPrior | null {
  const text = goodsDescription.trim();
  if (!text) return null;

  if (CAMERA_HOUSING_QUERY.test(text)) {
    return {
      id: "camera_underwater_housing",
      // 900691 — Cameras, photographic; parts and accessories
      // (housing is an accessory, not a camera specially designed for underwater use → 900630)
      path: ["90", "9006", "900691"],
      reason:
        "Underwater camera housing kit → photographic camera parts/accessories (900691)",
    };
  }

  return null;
}

/** Child code the prior wants under this parent, if any. */
export function priorChildForParent(
  prior: GoodsPrior,
  parentCode: string,
): string | null {
  if (parentCode === "TOTAL" || parentCode === "") {
    return prior.path[0] ?? null;
  }
  const idx = prior.path.indexOf(parentCode);
  if (idx < 0) return null;
  return prior.path[idx + 1] ?? null;
}
