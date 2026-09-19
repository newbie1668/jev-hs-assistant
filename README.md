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
npm run build
npm start   # production server on the same port after build
```

## Environment

| Variable | Required | Purpose |
| --- | --- | --- |
| `TYPESAFE_API_KEY` | No | Live TypeSafe System One judgments. If unset, mock token-overlap Choice over the same legal children. |
| `TYPESAFE_MODEL` | No | Defaults to `jev-latest`. |

## Try it (shipment document → Suggest HS6)

1. In the right **document** pane, **Upload** a text-based commercial invoice **PDF** (or `.txt`), or drag-and-drop onto the pane. Extracted text fills the preview.
2. Click **Suggest HS6** — Customs agent trail / Decision Trace fills from that text (TypeSafe when `TYPESAFE_API_KEY` is set).
3. **Assign draft** remains human-gated; **Post** stays disabled.

Paste into the preview textarea still works. Sample invoices in the dropdown remain for a quick mock path.

**OCR is not included yet.** Scanned or image-only PDFs return a clear empty-extract message — use a text-based PDF, `.txt`, or paste.

## What this slice includes

1. **Pinned taxonomy** — DataHub / UN Comtrade Harmonized System `2022.0` under `data/hs2022/` (CSV split into `harmonized-system-part1.csv` + `harmonized-system-part2.csv`; loader merges them).
2. **Document loading** — PDF text extraction via `/api/extract` (`pdf-parse`), plus `.txt` / paste / samples.
3. **UI** — Review declaration console: Customs agent trail, Fields/Lines (purple Missing until Assign), document preview; Suggest HS6 / Assign draft / Request review; Post disabled.
4. **TypeSafe judgments only** — hierarchical Choice + optional verification Noul; never invents HS strings.
5. **Closed command catalog** — including blocked `submit_declaration`.
6. **Mock fallback** when `TYPESAFE_API_KEY` is missing.

## Out of scope

OCR / scanned-PDF engines, real customs / broker APIs, national 8–10 digit extensions, unsupervised auto-file.

## Stack

Next.js · TypeScript · Tailwind · shadcn/ui · `@typesafe-ai/sdk` · `pdf-parse`
