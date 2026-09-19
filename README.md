# Jev — HS code assigning assistant

Human-gated HS6 suggestion MVP for Project Jev. Review shipping documents in a Raft-style **Review declaration** console: Customs agent trail (TypeSafe Decision Trace), Fields / Lines workspace, and document preview. Judgment layer is **Choice over legal children only** on pinned **HS 2022.0**. Humans confirm draft assignments. Customs **Post** / `submit_declaration` is always blocked.

## Clone

```bash
git clone https://github.com/newbie1668/jev-hs-assistant.git
cd jev-hs-assistant
```

Public repo: [github.com/newbie1668/jev-hs-assistant](https://github.com/newbie1668/jev-hs-assistant)

## Prerequisites

- **Node.js 20+** (developed on Node 22; 20 LTS is fine)
- npm 10+ (ships with Node)

## Run locally

```bash
# from the repo root
npm install
npm run dev
```

Dev server binds to **http://127.0.0.1:43127** (see `package.json` scripts).

Open [http://127.0.0.1:43127](http://127.0.0.1:43127).

Optional checks:

```bash
npm run typecheck
npm run build
npm start   # production server on the same port after build
```

## Environment

| Variable | Required | Purpose |
| --- | --- | --- |
| `TYPESAFE_API_KEY` | No | Live TypeSafe System One judgments. If unset, the app uses a **mock** token-overlap Choice over the same legal children. |
| `TYPESAFE_MODEL` | No | Defaults to `jev-latest`. |

```bash
cp .env.example .env.local
# edit .env.local and set TYPESAFE_API_KEY if you have one
```

Without a key the UI shows **mock** mode and still walks the HS tree.

## What this slice includes

1. **Pinned taxonomy** — DataHub / UN Comtrade Harmonized System `2022.0` CSVs under `data/hs2022/`.
2. **UI** — Review declaration console: Customs agent trail, Fields/Lines (purple Missing until Assign), document preview; Suggest HS6 / Assign draft / Request review; Post disabled.
3. **TypeSafe judgments only** — hierarchical Choice + optional verification Noul; never invents HS strings. Trail shows tool-call style steps, latency, and cost (mock = not billed).
4. **Closed command catalog** — including blocked `submit_declaration`.
5. **Mock fallback** when `TYPESAFE_API_KEY` is missing.

## Out of scope

Real customs / broker APIs, national 8–10 digit extensions, unsupervised auto-file.

## Stack

Next.js · TypeScript · Tailwind · shadcn/ui · `@typesafe-ai/sdk`

TypeSafe skill for agents: `.agents/skills/typesafe-ai/` (see also [docs.typesafe.ai](https://docs.typesafe.ai/introduction)).
