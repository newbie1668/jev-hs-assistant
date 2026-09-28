import { goodsTextForClassification } from "@/lib/hs/stated-codes";

export interface ParsedDocFields {
  mode: string | null;
  vessel: string | null;
  voyageNo: string | null;
  shipmentDate: string | null;
  masterBill: string | null;
  seller: string | null;
  buyer: string | null;
  invoiceNo: string | null;
  origin: string | null;
  /** Origin given as its own field line, not inline on a goods line. */
  headerOrigin: string | null;
  description: string | null;
  qty: string | null;
  amount: string | null;
  weight: string | null;
}

/** Fields a customs entry needs per goods line. */
export interface LineFields {
  description: string;
  origin: string | null;
  qty: string | null;
  amount: string | null;
}

/** Whitespace before an inline meta label — cuts a captured value short. */
const INLINE_META_RE =
  /\s+(?=\b(?:Qty|Quantity|COUNTRY\s+OF\s+ORIGIN|ORIGIN|HARMONIS[E]?D\s+CODE|HARMONIZED\s+CODE|HS\s*CODE|HS\s*#|UNIT\s+VALUE|UNIT\s+PRICE|NET\s+WEIGHT|GROSS\s+WEIGHT)\b)/i;

function grab(text: string, re: RegExp): string | null {
  const m = text.match(re);
  return m?.[1]?.trim() || null;
}

/** Like grab, but trims the captured value at the first inline meta label. */
function grabField(text: string, re: RegExp): string | null {
  const m = text.match(re);
  const value = m?.[1]?.split(INLINE_META_RE)[0]?.trim();
  return value || null;
}

function parseOrigin(text: string): string | null {
  return (
    grabField(text, /Country of origin:\s*([^\n]+)/i) ||
    grabField(text, /Origin:\s*([^\n]+)/i)
  );
}

function parseQty(text: string): string | null {
  return (
    grabField(text, /Quantity:\s*([^\n]+)/i) ||
    grab(text, /\bQty:?\s*(\d[\d,]*)/i) ||
    grab(text, /(\d[\d,]*)\s*(?:units|unit)\b(?!\s+(?:value|price))/i) ||
    grab(
      text,
      /(\d[\d,]*)\s*(?:pcs|pieces|sets|pairs|ctns?|cartons|boxes|pkgs|packages|rolls)\b/i,
    ) ||
    grab(text, /(\d[\d,]*)\s*bags/i) ||
    // Trailing "… x200" only — not "10 x 20 cm" or model names like "Sony X90 TV".
    grab(text, /(?:^|\s)[x×](\d[\d,]*)(?=\s*(?:[,;]|$))/m)
  );
}

function parseAmount(text: string): string | null {
  return grabField(text, /(?:Amount|Value|UNIT\s+VALUE):\s*([^\n]+)/i);
}

/** Header-level fields from shipping document text (best-effort regex). */
export function parseDoc(text: string): ParsedDocFields {
  const description =
    grabField(text, /Description of goods:\s*([^\n]+)/i) ||
    grabField(text, /Contents:\s*([^\n]+)/i) ||
    grabField(text, /Commodity:\s*([^\n]+)/i) ||
    (() => {
      const goods = goodsTextForClassification(text);
      return goods && goods.length < 200 ? goods : null;
    })();

  return {
    mode:
      grab(text, /Mode:\s*([^\n]+)/i) ||
      (text.includes("BILL OF LADING") ? "Ocean" : "Air"),
    vessel: grab(text, /Vessel:\s*([^\n]+)/i),
    voyageNo: grab(text, /Voyage(?:\s*No\.?)?:\s*([^\n]+)/i),
    shipmentDate: grab(text, /(?:Shipment Date|Date):\s*([^\n]+)/i),
    masterBill: grab(text, /(?:Master Bill|B\/L|BOL)[:\s#-]*([A-Z0-9-]+)/i),
    seller: grab(text, /Seller:\s*([^\n]+)/i),
    buyer: grab(text, /Buyer:\s*([^\n]+)/i),
    invoiceNo:
      grab(text, /Invoice No:\s*([^\n]+)/i) || grab(text, /Shipment:\s*([^\n]+)/i),
    origin: parseOrigin(text),
    headerOrigin: grabField(
      text,
      /^\s*(?:Country\s+of\s+origin|Origin)\s*:\s*([^\n]+)/im,
    ),
    description,
    qty: parseQty(text),
    amount: parseAmount(text),
    weight:
      grabField(text, /Net weight:\s*([^\n]+)/i) ||
      grabField(text, /Gross weight:\s*([^\n]+)/i),
  };
}

/**
 * Per-line entry fields. On a multi-line document, qty / value come from the
 * line only (a document-level match would belong to another line); origin
 * falls back to one stated outside the goods lines, never to another line's.
 */
export function parseLineFields(
  lineText: string,
  doc: ParsedDocFields,
  multiLine: boolean,
): LineFields {
  // Display the product wording only — drop trailing qty / origin / value labels.
  const goods = goodsTextForClassification(lineText).split(INLINE_META_RE)[0]!.trim();
  const description = multiLine
    ? goods || lineText
    : (doc.description ?? (goods || lineText));
  if (!multiLine) {
    return {
      description,
      origin: doc.origin,
      qty: doc.qty,
      amount: doc.amount,
    };
  }
  return {
    description,
    origin: parseOrigin(lineText) ?? doc.headerOrigin,
    qty: parseQty(lineText),
    amount: parseAmount(lineText),
  };
}
