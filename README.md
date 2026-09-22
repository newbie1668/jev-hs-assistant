# Jev — HS code assigning assistant

Human-gated HS6 suggestion MVP for Project Jev. Review shipping documents in a Raft-style **Review declaration** console: Customs agent trail (TypeSafe Decision Trace), Fields / Lines workspace, and document preview. Judgment layer is **Choice over legal children only** on pinned **HS 2022.0**. Humans confirm draft assignments. Customs **Post** / `submit_declaration` is always blocked.

## Setup (clone → run)

```bash
git clone https://github.com/newbie1668/jev-hs-assistant.git
cd jev-hs-assistant
npm install
cp .env.example .env.local
# put TYPESAFE_API_KEY in .env.local only
npm run dev
```

Open **http://127.0.0.1:43127**

Public repo: [github.com/newbie1668/jev-hs-assistant](https://github.com/newbie1668/jev-hs-assistant)

## Prerequisites

- **Node.js 20+** (developed on Node 22; 20 LTS is fine)
- npm 10+ (ships with Node)

`.env.local` is gitignored (via `.env*` in `.gitignore`). Keep secrets there only — never commit them.

Without `TYPESAFE_API_KEY` the app runs in **mock** mode and still walks the HS tree.

Optional checks:

```bash
npm run typecheck
npm test
npm run build
npm start   # production server on the same port after build
```

## Environment

| Variable | Required | Purpose |
| --- | --- | --- |
| `TYPESAFE_API_KEY` | No | Live TypeSafe System One judgments. If unset, mock token-overlap Choice over the same legal children. |
| `TYPESAFE_MODEL` | No | Defaults to `jev-latest`. |

## Try it (shipment document → Suggest HS6)

1. In the right **document** pane, **Upload** any file (or drag-and-drop onto the pane). The picker does not filter types.
2. `/api/extract` pulls text from **PDF** (`pdf-parse`), **plain text** (`.txt` / `.csv` / `.md` / text MIME), or **images** (png/jpg/webp via `tesseract.js` OCR). Extracted text fills the preview.
3. Click **Suggest HS6** — Customs agent trail / Decision Trace fills from that text (TypeSafe when `TYPESAFE_API_KEY` is set). Suggestion is driven by the **goods description**, not by HS codes printed on the doc.
4. If the document prints an HS / harmonised code, the trail shows it as **Stated on document** for human comparison and flags disagreement when it differs from the suggestion. Printed codes are **not** preferred as the answer (they may themselves be wrong).
5. **Assign draft** remains human-gated; **Post** stays disabled.

Paste into the preview textarea still works. Sample invoices in the dropdown remain for a quick mock path — try **Commercial invoice — camera underwater housing** (Fujifilm housing kit with a wrong printed `HS#85171200`).

Unsupported binaries (or empty OCR / scanned PDFs with no text layer) return a clear error — paste the shipment text as a fallback.

## What this slice includes

1. **Pinned taxonomy** — DataHub / UN Comtrade Harmonized System `2022.0` under `data/hs2022/` (CSV split into `harmonized-system-part1.csv` + `harmonized-system-part2.csv`; loader merges them).
2. **Document loading** — open file picker (any type) + `/api/extract` for PDF / text / image OCR.
3. **UI** — Review declaration console: Customs agent trail, Fields/Lines (purple Missing until Assign), document preview; Suggest HS6 / Assign draft / Request review; Post disabled.
4. **TypeSafe judgments only** — hierarchical Choice + optional verification Noul over goods wording; never invents HS strings. Codes printed on the document are extracted for compare/verify only. Finished beam leaves are verified in parallel, and when the beam's top leaf fails verification the suggestion is swapped for a passing candidate (surfaced as a rerank note in the UI).
5. **Closed command catalog** — including blocked `submit_declaration`.
6. **Mock fallback** when `TYPESAFE_API_KEY` is missing.

## Evaluating classification accuracy

A labelled eval set lives in `fixtures/eval-cases.json` (~55 real-invoice style documents). Build and start the production server first — `npm run build && npm start` (set `TYPESAFE_API_KEY` in `.env.local` for live mode; without it the eval runs in mock mode) — then:

```bash
npm run eval
```

`scripts/eval-suggest.mjs` posts each case to `/api/suggest` and grades the result **HS6** (exact), **HS4**, **HS2**, or **MISS**, printing per-case rows (verification result, rerank note, latency) plus totals, and writes the full detail to `eval-results.json`. Each case's `expect` lists acceptable HS6 codes; an empty `expect` means "not goods — expect a warning, not a code". Override the server with `BASE=http://host:port npm run eval`.

## Out of scope

Scanned-PDF OCR engines (image upload OCR is best-effort), real customs / broker APIs, national 8–10 digit extensions, unsupervised auto-file.

## Stack

Next.js · TypeScript · Tailwind · shadcn/ui · `@typesafe-ai/sdk` · `pdf-parse` · `tesseract.js`
