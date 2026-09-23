# RedactProof

**Redact it. Then prove you checked.**

RedactProof is a local-first browser app for redacting sensitive details from
screenshots and scans — and, crucially, *checking the exported pixels afterward*.
Most redaction mishaps happen because a translucent highlight, an annotation
layer, or a missed field leaves the data recoverable. RedactProof burns opaque
pixels into a fresh canvas and then re-runs its own OCR + detectors on the
export, so a leaked field shows up before you ship the image.

Built for the **InfinityX Global Hackathon 2K26**. Team: Sharon & Terry.

## The flow

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
   residual detector hit is highlighted on the export. A content-free audit
   report (JSON + printable) records the output's SHA-256, detection counts by
   category, app version, and timestamp — never the detected text.

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
- PDF input is not supported in this version — convert to PNG first.
- English-language OCR only (`eng` traineddata).

## Privacy / security model

- Everything runs client-side. There is no backend, no analytics, no network
  call at runtime — the tesseract worker, WASM core, and language data are
  vendored into `public/` (`npm run vendor`).
- The audit report is content-free by contract: it contains counts, categories,
  bounding boxes, the output SHA-256, version and time — never detected strings.
- The original file never leaves the page; exports are generated in-memory.

## Architecture

```
src/
  types.ts    shared types (OcrWord, Detection, RedactionBox, AuditReport)
  detect.ts   pure detector engine: line grouping, regex rules, Luhn, overlap
              dedup, bbox union — no DOM, fully unit-testable
  ocr.ts      tesseract.js wrapper; shared worker; vendored WASM/lang assets
  redact.ts   burnRedactions() (fresh canvas, opaque fill) + SHA-256 helpers
  report.ts   content-free audit report builder (JSON + printable HTML)
  main.ts     UI orchestration: upload, review overlay, manual boxes, export,
              verification pass, report rendering
tests/
  detect.test.ts  22 unit tests: Luhn, per-category rules, overlap/union logic
  e2e.test.ts     pixel-level pipeline: fixture PNG -> OCR -> detect -> burn
                  -> re-OCR -> assert zero residual hits + report contract
scripts/
  make_fixtures.py  generates the synthetic demo/fixture screenshot (PIL)
  vendor.sh         copies tesseract assets into public/
```

## Development

```bash
npm install
npm run vendor      # self-host tesseract assets into public/
npm run fixtures    # regenerate fixtures/support-ticket.png + public/demo.png
npm run dev         # dev server
npm test            # unit + e2e tests
npm run build       # typecheck + production build -> dist/
```

## Demo fixtures

`fixtures/support-ticket.png` and `public/demo.png` are 100% synthetic:
the card numbers are published test PANs, the SSN is the historical Woolworth
specimen, the phone number is a reserved 555 range, the IP is TEST-NET-3, and
the emails use example.com. No real personal data is used anywhere.

## License

MIT — see [LICENSE](LICENSE).
