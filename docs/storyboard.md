# RedactProof — 2-minute demo storyboard

Target runtime ~2:00. One continuous take is fine; cuts marked **[CUT]** are
optional trims if running long. Narration is a guide, not a script.

| # | Shot | Screen | Narration beat | ~Time |
|---|------|--------|----------------|-------|
| 1 | Cold open on landing page | Dropzone + "100% local" pill | "Screenshots leak PII all the time — and most people redact them wrong: translucent highlights, editable annotation layers, or a field they just missed." | 0:00–0:15 |
| 2 | Click **Try the synthetic demo screenshot** | OCR spinner with % progress | "Everything runs in the browser — nothing is uploaded. Local OCR scans the image…" | 0:15–0:30 |
| 3 | Review screen appears | ~10 labeled boxes over emails, cards, SSN, IP, token + sidebar list | "…and flags emails, phone numbers, payment cards — validated with the Luhn check, not just a regex — postal codes, SSNs, IPs, tokens." | 0:30–0:50 |
| 4 | Interaction quickies | Toggle one box off, delete one, **drag a manual box** over the token (or any missed spot) | "Every box is editable — and you can cover anything the detector missed." | 0:50–1:05 |
| 5 | Click **Redact & export PNG** | Before/after side-by-side, opaque black boxes | "Export burns opaque pixels into a fresh canvas — no reversible overlay, no source metadata." **[CUT]** | 1:05–1:15 |
| 6 | Verification banner | "N residual hits" warn state *or* clean state | "Then the twist: it re-scans its own export. Anything left over gets caught here — that's what makes it Redact**Proof**." | 1:15–1:35 |
| 7 | Audit report card + downloads | SHA-256, per-category counts, JSON/print buttons | "And you get a content-free audit report — SHA-256 of the export, counts, timestamp — proof the check happened, with no PII inside." | 1:35–1:50 |
| 8 | Close | Footer disclaimer on screen | "It's honest about its limits too: a clean scan isn't a guarantee — OCR can miss handwriting and blurry text. Always eyeball the export." | 1:50–2:00 |

## Demo choreography notes

- The strongest single beat is shot 6 in the **warn state**: leave one email
  disabled before exporting so the banner shows "1 residual hit" — it proves the
  verification pass genuinely works, then point out you can just widen a box and
  re-export.
- If network conditions matter, open DevTools first: every request is
  same-origin (`/vendor`, `/lang`) — a good visual for the "no third-party
  runtime" claim.
- All demo data is synthetic: test PANs, the Woolworth SSN, a 555 number,
  TEST-NET-3 IP, example.com emails.
- Recording asset (golden-path run): see `docs/` or the session attachments —
  `rec-*.mp4` covers shots 1–8 except the warn-state variant.
