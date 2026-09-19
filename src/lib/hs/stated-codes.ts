/**
 * Extract HS codes printed on shipping documents for human comparison.
 * Validation against the pinned taxonomy stays in app code — this only finds spans.
 */

export interface StatedHsCandidate {
  /** Digits as printed (6–10), without HS# prefix */
  rawDigits: string;
  /** First 6 digits (HS6) */
  hs6: string;
  /** Matched label / cue when available */
  label: string | null;
  /** Character offset in source text */
  index: number;
}

const LABELLED_HS_RE =
  /(?:harmonis[e]?d\s*code|harmonized\s*code|hs\s*code|h\.?\s*s\.?\s*code|tariff\s*code|commodity\s*code)\s*[:#.\-\s]*\s*(?:hs\s*[#:]?\s*)?(\d{4}\.?\d{2}\.?\d{0,4}|\d{6,10})/gi;

const HASH_HS_RE = /\bHS\s*[#:]?\s*(\d{6,10})\b/gi;

const LOOSE_NEAR_LABEL_RE =
  /(?:HS|H\.S\.|harmonis[e]?d|harmonized)[^\n]{0,40}?(\d{6,10})/gi;

function digitsOnly(span: string): string {
  return span.replace(/\D/g, "");
}

function toHs6(digits: string): string | null {
  const clean = digitsOnly(digits);
  if (clean.length < 6) return null;
  return clean.slice(0, 6);
}

function pushUnique(
  out: StatedHsCandidate[],
  seen: Set<string>,
  rawDigits: string,
  label: string | null,
  index: number,
): void {
  const hs6 = toHs6(rawDigits);
  if (!hs6) return;
  const key = `${hs6}:${rawDigits}:${index}`;
  if (seen.has(key)) return;
  seen.add(key);
  out.push({
    rawDigits: digitsOnly(rawDigits),
    hs6,
    label,
    index,
  });
}

/**
 * Find HS / harmonised code spans printed on a document.
 * Over-finds slightly; callers map into the taxonomy and pick for display.
 */
export function extractStatedHsCandidates(text: string): StatedHsCandidate[] {
  const out: StatedHsCandidate[] = [];
  const seen = new Set<string>();

  for (const re of [LABELLED_HS_RE, HASH_HS_RE, LOOSE_NEAR_LABEL_RE]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const digits = m[1] ?? "";
      const labelMatch = m[0].match(
        /harmonis[e]?d\s*code|harmonized\s*code|hs\s*code|h\.?\s*s\.?\s*code|tariff\s*code|commodity\s*code|HS/i,
      );
      pushUnique(out, seen, digits, labelMatch?.[0] ?? null, m.index);
    }
  }

  out.sort((a, b) => a.index - b.index);
  return out;
}

/**
 * Prefer a single stated HS6 for UI: first labelled hit, else first span.
 * Existence in the taxonomy is checked by the caller.
 */
export function pickPrimaryStatedHs6(
  candidates: StatedHsCandidate[],
): StatedHsCandidate | null {
  if (candidates.length === 0) return null;
  const labelled = candidates.find((c) =>
    /harmonis|hs\s*code|tariff|commodity/i.test(c.label ?? ""),
  );
  return labelled ?? candidates[0]!;
}

/**
 * Remove printed HS code spans so hierarchical Choice is not biased by
 * supplier-printed (and possibly wrong) codes in the same document blob.
 */
export function stripStatedHsFromText(text: string): string {
  // Fresh regexes — global flags retain lastIndex across calls.
  return text
    .replace(
      /(?:harmonis[e]?d\s*code|harmonized\s*code|hs\s*code|h\.?\s*s\.?\s*code|tariff\s*code|commodity\s*code)\s*[:#.\-\s]*\s*(?:hs\s*[#:]?\s*)?(\d{4}\.?\d{2}\.?\d{0,4}|\d{6,10})/gi,
      " ",
    )
    .replace(/\bHS\s*[#:]?\s*(\d{6,10})\b/gi, " ")
    .replace(
      /(?:HS|H\.S\.|harmonis[e]?d|harmonized)[^\n]{0,40}?(\d{6,10})/gi,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Prefer explicit goods / commodity / contents lines when present;
 * fall back to the full document with stated HS spans stripped.
 */
export function goodsTextForClassification(documentText: string): string {
  const lines = documentText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const descLines: string[] = [];
  for (const line of lines) {
    const m = line.match(
      /^(?:description(?:\s+of\s+goods)?|contents|commodity|goods|product|item)\s*[:\-]\s*(.+)$/i,
    );
    if (m?.[1]) {
      descLines.push(m[1].trim());
      continue;
    }
    // Inline commercial-invoice blobs: keep product wording before origin / HS / value.
    if (
      /underwater\s+housing|camera|lens|fujifilm|canon|nikon|sony\s+a\d|photographic/i.test(
        line,
      )
    ) {
      const beforeMeta = line
        .split(
          /\b(?:COUNTRY\s+OF\s+ORIGIN|ORIGIN|HARMONIS[E]?D\s+CODE|HARMONIZED\s+CODE|HS\s*CODE|HS\s*#|UNIT\s+VALUE|UNIT\s+PRICE)\b/i,
        )[0]
        ?.trim();
      if (beforeMeta && beforeMeta.length >= 8) {
        descLines.push(beforeMeta);
      } else {
        descLines.push(line);
      }
    }
  }

  const focused =
    descLines.length > 0
      ? descLines.join(" ")
      : stripStatedHsFromText(documentText);

  return stripStatedHsFromText(focused) || stripStatedHsFromText(documentText);
}
