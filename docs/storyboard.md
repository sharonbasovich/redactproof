# RedactProof — refreshed demo storyboard (≤2:30)

Target runtime ~2:20. One continuous take; cuts marked **[CUT]** are optional
trims. Narration is a guide, not a script. The new centerpiece is the
**independent verifier** — shot 3 is the money shot.

| # | Shot | Screen | Narration beat | ~Time |
|---|------|--------|----------------|-------|
| 1 | Cold open on landing | Two paths side by side + "100% local" pill | "Most redaction tools trust the editor. RedactProof checks the *pixels* — whether it redacted the image, or some other tool did." | 0:00–0:15 |
| 2 | Click **Try the leaky-redaction demo** (verify path) | OCR spinner with % progress | "This screenshot was 'redacted' somewhere else. The card and ID look covered — everything runs locally, nothing uploads." | 0:15–0:30 |
| 3 | **Verify results appear** | "2 residual detector hits" warn banner + outlined regions on the real image | "But look: the email was only covered by a translucent white-out — still readable. And the phone number in the sign-off was missed entirely. That's what you just almost shared." | 0:30–0:55 |
| 4 | Sidebar + pass provenance | Hit list with category/rule/confidence + "standard" chips | "Each hit shows what fired and where — eight pattern rules, checked against the actual file." **[CUT]** | 0:55–1:05 |
| 5 | Verification audit card | SHA-256, 1100×640 (filename omitted), hits table, limitations | "And the audit is deliberately minimal: the file's hash, counts, hit locations, detector limits. Detected strings and even the filename are never written into it." | 1:05–1:20 |
| 6 | Path A quick pass: **Try the synthetic demo** → de-collided labels → Redact & export | Review screen with ~10 labeled boxes; before/after export | "When RedactProof does the redaction itself, it burns opaque pixels into a fresh canvas — no reversible overlay." **[CUT the review dwell]** | 1:20–1:50 |
| 7 | Export verification + report | "Verification clean" banner + audit report | "Then it re-scans its own export. Clean means the detectors found nothing — not that nothing could ever be missed." | 1:50–2:10 |
| 8 | Close | Footer disclaimer / honest-limitations | "It's honest about limits: names, addresses, handwriting, QR codes aren't covered — mask those yourself. Redact it. Then prove you checked." | 2:10–2:20 |

## Demo choreography notes

- Shot 3 is the core demo moment: an apparently covered screenshot still has
  readable email text, and the independent final-file check flags it before
  sharing. Linger on the outlined region.
- The leaky fixture is synthetic: `jane.public@example.com` under a ~40%
  white-out rectangle, `(416) 555-0142` missed in the sign-off, opaque boxes
  over card + SSN (which correctly do *not* fire).
- For a second beat in shot 4, re-run with **Deeper scan** checked: the audit
  shows `standard → enhanced-2x` passes and each hit gains an `enhanced-2x`
  provenance chip — proves the contrast/upscale pass works and dedupe merges.
- If network conditions matter, open DevTools first: every request is
  same-origin (`/vendor`, `/lang`) — a good visual for the "no third-party
  runtime" claim.
- Wording that keeps us honest: say "omits detected strings and the filename",
  never "contains no personal information"; say "a check ran", never "proof
  the image is clean"; the verifier reads pixels, it can't recover truly
  burned ones or guarantee coverage.
- Screenshots of this flow live in `docs/screenshots/`:
  `landing-two-paths.png`, `verify-leaky-flagged.png`, `verify-deep-scan.png`,
  `review-de-collided-tags.png`, `export-clean-audit.png`.

## Reference hashes (this build)

- `fixtures/leaky-redaction.png` / `public/demo-leaky.png` image SHA-256 as
  reported by the verifier: `90ac2ac90d11e4e97e8a387349aabf53adafbd7bdecbb985f57cd0b520794c32`
  (matches `sha256sum` of the file — it hashes the uploaded bytes verbatim).
- Redact-path export PNG SHA-256 from the golden-path run:
  `8e75b14e258e0641f4bf2fdc59b8bdabe4357e9fc312a28ab672ca590f84eea4`
  (PNG re-encode is deterministic in this build, but treat export hashes as
  run-specific, not fixture constants).
