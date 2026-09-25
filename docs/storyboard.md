# RedactProof Red Team — demo storyboard (≤2:30)

Target runtime ~2:20. One continuous take; cuts marked **[CUT]** are optional
trims. Narration is a guide, not a script. The centerpiece is the **red-team
attack → grade → one-click fix → re-attack** loop on a file that *looks*
redacted.

| # | Shot | Screen | Narration beat | ~Time |
|---|------|--------|----------------|-------|
| 1 | Cold open on landing | Two paths side by side + "100% local" pill | "Most redaction tools trust the editor. RedactProof attacks the pixels — whether it redacted the image, or some other tool did." | 0:00–0:15 |
| 2 | Click **Try the marker-covered demo** (red-team path) | Attack spinner cycling variants (`identity → levels-stretch → … → region-stretch`) | "This screenshot was 'redacted' somewhere else — a black marker box at 97% opacity. Looks fully opaque. Everything runs locally; nothing uploads." | 0:15–0:35 |
| 3 | **Attack results appear** | Grade **C** panel + warn banner + outlined recovered regions | "Plain OCR sees nothing — every global attack sees nothing. But a localized stretch that zooms into the marker's own pixels peels the residual it left: sensitive patterns, still recoverable. That's what you just almost shared." | 0:35–1:00 |
| 4 | Hit list, masked text | Category/rule/confidence + attack chips (`levels-stretch`), bullets for text, reveal toggle | "Every hit names the attack that broke it. The recovered text stays masked — you can reveal it to confirm, and it never lands in the audit." **[CUT]** | 1:00–1:10 |
| 5 | Audit card | SHA-256, grade C, engine + variants, metadata row, limitations | "The audit is deliberately narrow: the file's hash, the grade, which attacks ran, where the hits are — detected strings and even the filename are never written into it." | 1:10–1:25 |
| 6 | Click **Fix it — burn opaque boxes & re-check** | Spinner, then grade **A**, fix panel before/after | "One click burns *opaque* boxes over every recovered region and re-attacks the fixed pixels — nothing survives, nothing to peel off." | 1:25–1:55 |
| 7 | New audit + download | "Fix provenance" row chaining the flagged hash | "And the re-check chains back to the flagged file's hash, so the audit tells the whole story." **[CUT]** | 1:55–2:05 |
| 8 | Close | Footer disclaimer / honest-limitations | "An A means *these* attacks recovered nothing — not 'safe'. Names, addresses, handwriting, QR codes aren't covered — mask those yourself. Redact it. Then prove you checked." | 2:05–2:20 |

## Demo choreography notes

- Shot 3 is the money shot: the baseline (`identity`) pass reads nothing, the
  *global* variants read nothing, and the localized `region-stretch` recovers
  covered patterns — that gap is the whole point. Linger on a recovered
  region before the grade reads out.
- The hero fixture is `fixtures/redteam/marker-97.png` (served as
  `public/demo-redteam.png`): a synthetic support screenshot under a ~97%
  black marker — visually opaque. Measured behavior in
  `tests/redteam.test.ts`: identity + all seven global variants recover
  nothing; `region-stretch` recovers phone + SSN (partial — honestly
  incomplete) → grade **C**. Opaque-burned export → grade **A**.
- Say "the localized stretch partially recovered the marker's residual" —
  never "we cracked it completely": two of six categories come back, the
  rest stay lost. Partial recovery is itself the demo point.
- Honest grade vocabulary on screen: F = readable as-is, C = recoverable only
  after enhancement, B = marginal weak recovery, A = nothing recovered *by
  these tests*. Never say "safe".
- If network conditions matter, open DevTools first: every request is
  same-origin (`/vendor`, `/lang`) — a good visual for the "no third-party
  runtime" claim.
- Wording that keeps us honest: say "omits detected strings and the filename",
  never "contains no personal information"; say "a check ran", never "proof
  the image is clean".
- Screenshots of this flow live in `docs/screenshots/`.

## Demo candidate

`docs/demo-redteam-final.mp4` — recorded run on the merged-engine build
(the 55%-marker cut; re-record on marker-97 before submission):
marker demo → grade C ("recovery by the tested attacks only, never a safety
certification") → masked recovered text → Fix → re-attack → grade A with
"no tested attack recovered a supported pattern — residual uncertainty" +
the metadata-leak demo → strip → re-check clean. This is the ≤2:30 demo cut.
SHA-256: `7ba538138105a8dad43890255429045c42a03a3f6c0e92c95f59327a525dda0b`

`docs/demo-two-path-126s.mp4` — 126s raw take of the **pre-red-team** two-path
flow. Superseded by the recording above; kept for comparison only.
SHA-256: `e07db30b42a92ef4c4a5e02c4a067d53a986a8572835d4b2fa42e8b09ffd2e92`

## Reference hashes (this build)

- `public/demo-redteam.png` (copied from `fixtures/redteam/marker-97.png`)
  SHA-256: `c3c36877bf4d5a628c4d600b24ef56f82ce4bf7924b557356adf4ccbf4bcb0b2`
  (the audit hashes the uploaded bytes verbatim — same as `sha256sum`).
- Prior hero fixture `fixtures/redteam/marker-55.png` (55% marker — visibly
  readable, superseded as the demo) SHA-256:
  `e9421db4b73eea7a4d48982d9308247fe179db219671595af725e4a913973520`
  (the audit hashes the uploaded bytes verbatim — same as `sha256sum`).
- Redact-path export PNG SHA-256 from the golden-path run:
  `8e75b14e258e0641f4bf2fdc59b8bdabe4357e9fc312a28ab672ca590f84eea4`
  (PNG re-encode is deterministic in this build, but treat export hashes as
  run-specific, not fixture constants).
