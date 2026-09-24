# RedactProof

**Redact it. Then prove you checked.**

RedactProof is a local-first browser app for redacting sensitive details from
screenshots and scans — and, crucially, *checking the exported pixels afterward*.
Most redaction mishaps happen because a translucent highlight, an annotation
layer, or a missed field leaves the data recoverable. RedactProof burns opaque
pixels into a fresh canvas and then re-runs its own OCR + detectors on the
export, so residual matches within its supported patterns can surface before
you share the image.

It also works as a **last-mile check for images redacted anywhere else**: the
independent *Verify an existing image* path audits the actual file you're
about to share — not the editing session — so a white-out highlight that only
*looks* opaque still gets caught.

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

### Path B — verify an existing image

Already redacted a screenshot in another tool (Preview, Photos, a markup
extension)? Drop the **final file** on the verifier:

1. The uploaded bytes are hashed (SHA-256) and OCR'd locally — the filename
   itself is never read into the report.
2. The same 8 detector rules scan the real pixels; residual hits are
   outlined on the image with category, rule and confidence.
3. An optional **deeper scan** re-OCRs a contrast-stretched, 2×-upscaled
   copy to catch faint or low-contrast text; hits are deduplicated across
   passes and each hit records which pass(es) found it.
4. The audit JSON is narrowly worded: image SHA-256, dimensions, hit counts
   and locations, passes run, OCR quality, detector scope and limitations.
   Statuses are `hits-found`, `no-hits`, or `inconclusive` (when OCR
   confidence is too low to trust a clean result) — never "PII-free".

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
  verify.ts   independent-verifier report builder + cross-pass hit dedupe
  preprocess.ts  pure RGBA ops (contrast stretch, 2x upscale) for the deep
              OCR pass — shared by the browser canvas path and pngjs tests
  main.ts     UI orchestration: upload, review overlay, manual boxes, export,
              verification pass, verify path, report rendering
tests/
  detect.test.ts  28 unit tests: Luhn, per-category rules, overlap/union logic
  e2e.test.ts     pixel-level pipeline: fixture PNG -> OCR -> detect -> burn
                  -> re-OCR -> assert zero residual hits + report contract
  verify.test.ts  leaky-fixture detection (standard + deep pass), dedupe,
                  status logic, stable SHA-256, report string/filename hygiene
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

`fixtures/leaky-redaction.png` / `public/demo-leaky.png` is the verifier demo:
a screenshot "redacted" in another tool where the card and SSN are covered by
solid boxes but the email only got a translucent white-out — still readable
to OCR — and a phone number was missed entirely. Verifying it should flag
exactly the residual email and phone.

## License

MIT — see [LICENSE](LICENSE).
