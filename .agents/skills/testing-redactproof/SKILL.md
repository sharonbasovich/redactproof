---
name: testing-redactproof
description: How to run and end-to-end test the RedactProof local-first redaction demo (vite preview, demo button flow, coordinate mapping for clicks, expected detection counts, verifying local-only behavior)
---

# Testing RedactProof

RedactProof is a local-first screenshot-redaction demo (vanilla TS + vite + tesseract.js). All OCR runs in the browser against vendored assets — there is no backend.

## Running

- Node 20 lives at `~/node-v20.18.1-linux-x64/bin` (also symlinked in `~/.local/bin`). Add to PATH first.
- `npm run preview` serves the built `dist/` on `http://localhost:4173`. Run `npm run build` first if dist might be stale (build also runs `scripts/vendor.sh` to re-vendor tesseract assets).
- `npm test` = vitest (22 unit + 1 real-OCR pixel e2e, ~2s).

## Golden-path demo flow

1. Landing: click **"Try the synthetic demo screenshot"** (`#demo-btn`) → fetches same-origin `demo.png` → OCR spinner → Scan & review.
2. Expected on the synthetic demo: **9 detections** — Email×2, Phone, Payment card×2, Postal code×2 (us-zip4 + ca-postal), SSN, IP address. The seeded JWT is **not** detected (OCR misreads the token string, breaking the `eyJ…` regex) — a known OCR-fidelity gap, also absent from the repo's own e2e expectations.
3. Interactions: click a `.box` div to select; `Delete`/`Backspace` removes it; `D` toggles enabled; pointer-drag on empty image area adds a `Manual` box (min 6px); sidebar checkboxes toggle enabled. `#det-count` shows enabled count only.
4. **"Redact & export PNG"** burns opaque black rects, then re-OCRs the export. Disabled/deleted boxes leave PII visible → warn banner `N residual hits` with outlined regions (this is the honest expected result if you disabled items). Clean banner text: `Verification clean:`.
5. Audit report: SHA-256, box counts by category, disclaimer. Downloads land in `~/Downloads`: `redacted-<name>.png`, `redactproof-audit-<sha8>.json`. `sha256sum` of the PNG should equal the report's `output.sha256`.

## Local-only verification

DevTools Network (Preserve log): every request should be `localhost:4173`, `blob:http://localhost:4173`, or `data:`. Vendored assets: `/vendor/worker.min.js`, `/vendor/tesseract-core-*.wasm`, `/lang/eng.traineddata.gz` (initiator worker.min.js). Failed red entries like `blob:http://localhost:4173/... net::ERR_FILE_NOT_FOUND` and `data:image/png;base64,... net::ERR_INVALID_URL` with `VM*:479` initiators are test-tooling artifacts (revoked object URLs / DOM-snapshot fetches), not app bugs — still same-origin.

## Click-coordinate gotcha (this box)

The display is 1600×1200 but the computer tool uses a 1024×768 scaled space. To click a DOM element, get `getBoundingClientRect()` via `browser_console`, then:

- `scaled_x = (css_x + 4) * 0.64`  (window left border ≈4px)
- `scaled_y = (css_y + 87) * 0.64` (Chrome toolbar ≈87px; `outerHeight - innerHeight`)

Naively clicking where the element *appears* in the screenshot misses when DevTools is docked — the rendered page is narrower than the mapping assumes.

## Secrets

None required — the app is fully local. `HTN_SLACK_*` secrets are unrelated.
