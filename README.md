# RedactProof

**Redact it. Then prove you checked.**

RedactProof is a local-first browser app for redacting sensitive details from
screenshots and scans — and, crucially, *checking the exported pixels afterward*.
Most redaction mishaps happen because a translucent highlight, an annotation
layer, or a missed field leaves the data recoverable. RedactProof burns opaque
pixels into a fresh canvas and then re-runs its own OCR + detectors on the
export, so residual matches within its supported patterns can surface before
you share the image.

It also works as a **last-mile red-team check for images redacted anywhere
else**: the *Red-team an existing image* path attacks the actual file you're
about to share — not the editing session — so a white-out highlight that only
*looks* opaque still gets caught, and a one-click opaque burn fixes it.

Built for the **InfinityX Global Hackathon 2K26**.

## The flow

### Path A — redact a screenshot

1. **Upload** — PNG or JPG. Drag-drop, file picker, or the bundled synthetic demo.
2. **Scan & review** — local OCR (tesseract.js WASM) finds emails, phone numbers,
   payment cards (Luhn + network prefix), Canadian postal codes, US ZIP+4,
   SSNs, IPv4 addresses, and JWT-shaped tokens. Each hit becomes an editable
   box labeled with category, rule, and confidence. Toggle, delete, or
   drag-to-add your own boxes.
3. **Redact & export** — enabled boxes are painted as fully opaque black
   rectangles onto a *brand-new canvas*. There is no reversible overlay and the
   exported PNG carries no source metadata.
4. **Verify & report** — the exported pixels are re-OCR'd and re-scanned. Any
   residual detector hit is highlighted on the export. A minimal-content audit
   report (JSON + printable) records the output's SHA-256, detection counts by
   category, app version, and timestamp — detected strings and the input
   filename are omitted by design.

### Path B — red-team an existing image

Already redacted a screenshot in another tool (Preview, Photos, a markup
extension)? Drop the **final file** and let the attack engine try to break
its cover-up:

1. The uploaded bytes are hashed (SHA-256), checked for residual container
   metadata (EXIF/GPS/XMP/PNG text chunks), and rasterized; up to 7 attack
   variants (`identity`, `levels-stretch`, `gamma-lift`, `gamma-drop`,
   `invert`, `channel-max`, `upscale-sharpen`) each get an OCR pass, locally.
2. Hits are deduplicated across variants and carry attack provenance — which
   variant(s) recovered the region. Recovered text is shown **masked by
   default** with a click-to-reveal; it never enters the audit.
3. The engine grades the run: **F** (hits readable on the untouched pixels),
   **C** (hits recoverable only after enhancement — the translucent-cover
   case), **B** (marginal recovery — every enhanced hit is low-confidence),
   **A** (nothing recovered by any attack run). An A still means "not
   flagged by *these* checks", never "safe".
4. **Fix it** — one click burns padded opaque boxes over every flagged
   region, then re-attacks the *fixed* pixels end-to-end. The new audit
   carries fix provenance back to the flagged file's hash.
5. The audit JSON is narrowly worded: image SHA-256, dimensions, grade,
   engine id, variants run, hit counts/locations, OCR quality, container
   metadata findings, detector scope and limitations. Statuses are
   `hits-found`, `no-hits`, or `inconclusive` — never "PII-free".

Images over 24MP are refused up front; 2× attack variants are skipped above
6MP to keep the tab responsive (the audit says so when that happens).

## Honest limitations — read this before trusting it

- **A clean verification scan is not a guarantee of perfect redaction.** OCR can
  miss handwriting, low-resolution or distorted text, rotated text, unusual
  fonts, and data encoded visually (QR codes, barcodes) or in ways the detectors
  don't cover.
- **This is not cryptographic proof of PII absence.** The SHA-256 identifies the
  exported file; it does not prove anything about its content. The audit report
  records *that a check ran* — not that the image is safe.
- Detectors are pattern-based with false-positive and false-negative rates.
  Always visually review the export before sharing.
- **The verifier reads pixels, it doesn't recover them.** A hit means the
  text survived the cover-up well enough for OCR to read it — it can't tell
  you what's under a truly opaque box, and it can't promise a clean image is
  safe. Mask names, addresses, photos and anything outside the 8 supported
  patterns manually.
- PDF input is not supported in this version — convert to PNG first.
- English-language OCR only (`eng` traineddata).

## Privacy / security model

- Everything runs client-side. There is no backend, no analytics, no network
  call at runtime — the tesseract worker, WASM core, and language data are
  vendored into `public/` (`npm run vendor`).
- The audit report omits detected strings by contract: it contains counts,
  categories, bounding boxes, the output SHA-256, version and time — never
  detected strings, and never the original filename (which can itself contain
  PII). We say "omits detected text", not "contains no personal information" —
  a filename or a metadata field could still say something about you if we
  ever added one, so the report is kept minimal instead of trusted blindly.
- The original file never leaves the page; exports are generated in-memory.

## Architecture

```
src/
  types.ts    shared types (OcrWord, Detection, RedactionBox, AuditReport)
  detect.ts   pure detector engine: line grouping, regex rules, Luhn, overlap
              dedup, bbox union — no DOM, fully unit-testable
  ocr.ts      tesseract.js wrapper; shared worker; vendored WASM/lang assets
  redact.ts   burnRedactions() (fresh canvas, opaque fill) + SHA-256 helpers
  report.ts   minimal-content audit report builder (JSON + printable HTML)
  verify.ts   independent-verifier report builder + cross-attack hit dedupe,
              hit-bbox padding for the opaque fix
  redteam/    attack engine (merged from codex/redactproof-redteam-*):
              types.ts (Raster/AttackId/contracts), attack.ts (7 variants,
              runAttacks, cross-variant dedupe), grade.ts (A/B/C/F grading),
              canvas.ts (raster <-> canvas/pngjs bridge), analyze.ts
              (redaction-region classification), metadata.ts (EXIF/GPS/XMP/
              PNG-chunk inspector)
  preprocess.ts  pure RGBA ops (contrast stretch, 2x upscale) — shared by
              the browser canvas path and pngjs tests
  main.ts     UI orchestration: upload, review overlay, manual boxes, export,
              verification pass, red-team path (grade/masked hits/fix loop),
              report rendering
tests/
  detect.test.ts  28 unit tests: Luhn, per-category rules, overlap/union logic
  e2e.test.ts     pixel-level pipeline: fixture PNG -> OCR -> detect -> burn
                  -> re-OCR -> assert zero residual hits + report contract
  verify.test.ts  leaky-fixture detection, dedupe, status logic, stable
                  SHA-256, report string/filename hygiene, bbox padding,
                  fix provenance, engine integration (marker-55 baseline-miss
                  -> enhancement recovery -> opaque-burn -> re-attack clean),
                  metadata inspector
  redteam.test.ts engine suite: transforms, dedupe, grading, measured
                  fixture recovery
  redteam/      analyze + metadata test suites
scripts/
  make_fixtures.py  generates the synthetic demo/fixture screenshot (PIL)
  vendor.sh         copies tesseract assets into public/
```

## Development

```bash
npm install
npm run vendor      # self-host tesseract assets into public/
npm run fixtures    # regenerate fixtures/*.png + public/demo*.png
npm run dev         # dev server
npm test            # unit + e2e tests
npm run build       # typecheck + production build -> dist/
```

## Demo fixtures

`fixtures/support-ticket.png` and `public/demo.png` are 100% synthetic:
the card numbers are published test PANs, the SSN is the historical Woolworth
specimen, the phone number is a reserved 555 range, the IP is TEST-NET-3, and
the emails use example.com. No real personal data is used anywhere.

`fixtures/redteam/marker-55.png` / `public/demo-redteam.png` is the red-team
demo: a screenshot covered by a 55%-opacity black marker — it *looks*
redacted, plain OCR reads nothing, but the `levels-stretch` attack recovers
5+ supported categories (measured in `tests/redteam.test.ts`). The expected
flow is grade **C** → **Fix it** → re-attack grades **A** on the burned
export. `fixtures/redteam/` also holds `marker-75`, `marker-yellow`,
`marker-opaque` (the control), `blur`, `pixelate` and `clean`.

## License

MIT — see [LICENSE](LICENSE).
