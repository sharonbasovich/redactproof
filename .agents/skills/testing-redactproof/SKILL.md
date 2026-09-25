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

## Golden-path demo flow (Path A)

1. Landing: click **"Try the synthetic demo screenshot"** (`#demo-btn`) → fetches same-origin `demo.png` → OCR spinner → Scan & review.
2. Expected on the synthetic demo: **10 detections** — Email×2, Phone, Payment card×2, Postal code×2 (us-zip4 + ca-postal), SSN, IP address, Token (JWT). Detection count can vary ±1 with OCR fidelity (the JWT chip is borderline ~40% conf; earlier builds missed it entirely).
3. Interactions: click a `.box` div to select; `Delete`/`Backspace` removes it; `D` toggles enabled; pointer-drag on empty image area adds a `Manual` box (min 6px); sidebar checkboxes toggle enabled. `#det-count` shows enabled count only.
4. **"Redact & export PNG"** burns opaque black rects, then re-OCRs the export. Disabled/deleted boxes leave PII visible → warn banner `N residual hits` with outlined regions (this is the honest expected result if you disabled items). Clean banner text: `Verification clean:`.
5. Audit report: SHA-256, box counts by category, disclaimer. Downloads land in `~/Downloads`: `redacted-<name>.png`, `redactproof-audit-<sha8>.json`. `sha256sum` of the PNG should equal the report's `output.sha256`.

## Red-team audit flow (Path B, real engine `src/redteam/*`)

1. Landing: the right card is **"Red-team an existing image"**. The `#deep-scan` checkbox (**"All 8 attack variants"**) is **checked by default** — leave it on for the full pass. Click **"Try the marker-covered demo"** (`#verify-demo-btn`, sub-label "looks fully opaque — isn't") → fetches same-origin `demo-redteam.png` (== `fixtures/redteam/marker-97.png`, 980×560, sha256 `c3c36877bf4d5a62…`; six PII lines under a ~97%-opacity black marker that LOOKS fully opaque on screen).
2. Spinner shows `Attack <id>… n/8` cycling identity → levels-stretch → gamma-lift → gamma-drop → invert → channel-max → upscale-sharpen → **region-stretch** (a localized per-region luminance stretch — `findCandidateRegions` auto-discovers redaction-looking flat bands and stretches each on its own p1/p99 histogram).
3. Expected result on marker-97 (measured): **grade C**, warn banner "2 recoverable patterns", 2 hits — **phone ~73% + ssn ~81% only** (email/card/zip/ip stay lost — partial recovery is the honest expected result, not a bug). **Every hit's chips must show ONLY `region-stretch`** — identity + the 6 other globals read nothing at 97% opacity; an `identity` chip would mean grade F and contradicts the premise. The audit's hits table `Found by` column shows the same. Hit rows show masked bullets (`•••`) with a reveal/hide toggle — the recovered text is real OCR output (e.g. `(416) 555-0177`), never persisted.
4. Audit card rows: `980×560px (filename omitted)`, sha `c3c36877…`, engine `redteam-engine`, all 8 variants joined by `→`, a `Container metadata` row (`None detected…` for this fixture — it has only IHDR/IDAT/IEND), residual hits count. When hits exist the OCR-quality row reads "not assessed separately — hits prove OCR functioned" (not "0 words…").
5. **"Fix it — burn opaque boxes & re-check"** burns padded opaque boxes over the hit bboxes, then re-runs ALL 8 variants on the fixed pixels. Expected on marker-55: grade **A** in one pass. **On marker-97, measured behavior needs TWO clicks**: the first burn covers phone+ssn, but the re-attack peels *new* residual hits (payment-card + postal-code) out of the still-marker'd bands — region-stretch recovery is marginal and image-statistics-sensitive, so each burn pass can surface different lines. Keep clicking "Fix it" until 0 residual hits → then grade **A** ("No sensitive content recovered by any attack pass."), fix panel with Flagged file / Burned export images, `Fix provenance` row chaining the *immediately previous* image sha, new image sha each pass. `redactproof-fixed-<sha8>.png` downloads to `~/Downloads` (real PNG, verify with `file` + `sha256sum` against the audit's image sha).
6. Gotcha: after the fix, the banner reads **"No tested attack recovered a supported pattern — but OCR coverage was thin (N words, X% avg), so the absence carries residual uncertainty."** and audit Status is "Inconclusive (low OCR confidence)" — `assessOcrQuality` marks `suspicious` when the re-OCR sees <15 words, and the fixed fixture has only ~6 words left. Deliberate conservatism, not a bug — grade A is the verdict to assert. The grade panel also gains an "Uncertainty:" reason line and every grade panel carries the caption "Grade measures recovery by the tested attacks only — never a safety certification." A "0 words, X% avg confidence" OCR-quality row is normal when all hits include identity (recoveredWords counts enhanced-only hits).

## Metadata-leak demo (container metadata inspection)

1. **"Try the metadata-leak demo"** (`#verify-meta-demo-btn`) serves `demo-metadata.png` = `clean.png` pixels + PNG tEXt chunks (`Comment: "Captured at 43.65N 79.38W by jane.doe@example.com"`, `Author: "Jane Doe"`). Pixels are plainly readable → expect grade **F** with ~6 hits whose chips include `identity` (all 8 variants find them — `region-stretch` joins the list on baseline-readable images since findCandidateRegions marks the flat rows).
2. Banner gains a "Container metadata found: PNG text chunks (Comment, Author) — ~96 removable bytes" sub-note; `#verify-strip-btn` (**"Strip metadata & re-check"**) appears in the card header; audit shows a "Container metadata" row.
3. Clicking strip re-encodes to a fresh PNG and re-runs the FULL audit: banner sub becomes "Container metadata stripped by re-encoding to a fresh PNG (was: …). Your original file on disk is untouched.", the metadata row flips to "None detected…", the strip button hides, and a new image sha appears. Pixel verdict is unchanged — strip removes metadata only. Note: the audit row/banner carries strip provenance but the report JSON has no strip-provenance field (unlike `fix` provenance).

## Local-only verification

DevTools Network (Preserve log): every request should be `localhost:4173`, `blob:http://localhost:4173`, or `data:`. Vendored assets: `/vendor/worker.min.js`, `/vendor/tesseract-core-*.wasm`, `/lang/eng.traineddata.gz` (initiator worker.min.js). Failed red entries like `blob:http://localhost:4173/... net::ERR_FILE_NOT_FOUND` and `data:image/png;base64,... net::ERR_INVALID_URL` with `VM*:479` initiators are test-tooling artifacts (revoked object URLs / DOM-snapshot fetches), not app bugs — still same-origin.

## Click-coordinate gotcha (this box)

The display is 1600×1200 but the computer tool uses a 1024×768 scaled space. To click a DOM element, get `getBoundingClientRect()` via `browser_console`, then:

- `scaled_x = (css_x + 4) * 0.64`  (window left border ≈4px)
- `scaled_y = (css_y + 87) * 0.64` (Chrome toolbar ≈87px; `outerHeight - innerHeight`)

Naively clicking where the element *appears* in the screenshot misses when DevTools is docked — the rendered page is narrower than the mapping assumes.

## Secrets

None required — the app is fully local. `HTN_SLACK_*` secrets are unrelated.
