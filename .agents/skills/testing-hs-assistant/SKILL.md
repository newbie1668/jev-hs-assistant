---
name: testing-hs-assistant
description: Run browser end-to-end checks for live or mock HS classification, verification, draft gating, and document ingestion.
---

# HS assistant browser testing

## Runtime and access
- App URL: `http://127.0.0.1:43127`; no application login is required.
- Follow the repository blueprint for dependencies. Production requires `npm run build` then `npm start`; development uses `npm run dev`.
- Confirm the visible header says `typesafe` for live testing, and inspect expanded Agent Trail steps for a `jev-*` model and cost estimates. Missing credentials intentionally select mock mode.
- If a running server was started with credentials supplied by the lead, do not restart it unless those credentials are also available for the replacement process.
- Assignments are local draft state, not real customs filing. Post must remain disabled.

## Devin Secrets Needed
- `TYPESAFE_API_KEY` for live judgments (server environment or `.env.local`).
- No key is required for explicitly scoped mock testing.

## High-value UI checks
- Built-in samples: laptop `847130`, coffee `090121`, cotton tees `610910`, underwater housing `900691`.
- Verify results in both the Path box and the Agent Trail summary; the latter is near the bottom of the independently scrolling left pane. Click a step heading to expose model, token use and cost-estimate logs.
- Underwater housing should flag printed `851712` as a disagreement, not prefer it over goods.
- Assignment must require a human action. Clear should remove suggestion, assignment and stale status.
- A failing beam top is reranked only when another finished candidate passes verification. Live outcomes vary: never claim this branch was exercised just because the final code is correct. Capture the rerank note, displaced Runner-up, and verification trace.
- A useful natural-language rerank candidate is: `Description of goods: Portable wireless electronic terminals, complete notebook laptop computers running Windows, integrated CPU, keyboard and 14-inch display, 1.4 kg.` It is not guaranteed to trigger a swap.

## Upload and OCR evidence
- `fixtures/sample-laptop-invoice.pdf` has a text layer; `fixtures/sample-empty-scan.pdf` tests the documented image-only-PDF fallback.
- Image-only PDFs do not invoke OCR. Upload PNG/JPEG to exercise Tesseract.
- On macOS, create a PNG fixture with `sips -s format png fixtures/sample-laptop-invoice.pdf --out /tmp/ocr-invoice.png`. Default rasterization can introduce OCR mistakes; inspect extracted text rather than equating HTTP 200 with accurate recognition.
- Use native Chrome Network timings to measure extraction, and confirm unsupported binary returns 415.
- For a real drag/drop recording, reveal a fixture in Finder, hold the mouse over the document pane, capture the drop overlay before release, then confirm filename and text change.
- Test 600px-wide access. If touch emulation interferes with mouse/keyboard tools, use a native narrow Chrome window to verify text editing and internal scrolling.
