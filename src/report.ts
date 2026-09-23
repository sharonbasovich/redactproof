import type { AuditReport, RedactionBox, VerificationHit } from "./types";

export const APP_VERSION = "0.1.0";

export const DISCLAIMER =
  "A clean verification scan only means the built-in detectors found nothing " +
  "in the exported pixels — it is not a guarantee of perfect redaction and not " +
  "cryptographic proof of PII absence. Detectors cover emails, North-American " +
  "phones, payment cards (Luhn), CA/US postal codes, SSNs, IPv4 addresses and " +
  "JWT-shaped tokens only; names, addresses, dates of birth, account/SIN/IBAN " +
  "numbers, OTP codes and non-NA phone formats are not covered, and OCR can " +
  "miss handwriting or low-resolution text. Always review the exported image " +
  "visually before sharing it.";

export function buildAuditReport(args: {
  inputFileName: string;
  inputWidth: number;
  inputHeight: number;
  outputSha256: string;
  outputWidth: number;
  outputHeight: number;
  boxes: RedactionBox[];
  hits: VerificationHit[];
  now?: Date;
}): AuditReport {
  const byCategory: Record<string, number> = {};
  let manual = 0;
  for (const b of args.boxes) {
    if (!b.enabled) continue;
    if (b.source === "manual") manual++;
    byCategory[b.category] = (byCategory[b.category] ?? 0) + 1;
  }
  return {
    tool: "RedactProof",
    toolVersion: APP_VERSION,
    generatedAt: (args.now ?? new Date()).toISOString(),
    input: {
      fileName: args.inputFileName,
      pixelWidth: args.inputWidth,
      pixelHeight: args.inputHeight,
    },
    output: {
      sha256: args.outputSha256,
      pixelWidth: args.outputWidth,
      pixelHeight: args.outputHeight,
    },
    redaction: {
      totalBoxes: args.boxes.filter((b) => b.enabled).length,
      manualBoxes: manual,
      byCategory,
    },
    verification: {
      method: "Re-OCR of exported PNG (tesseract.js WASM) + detector pass",
      residualHits: args.hits.length,
      hits: args.hits.map((h) => ({ category: h.category, rule: h.rule, bbox: h.bbox })),
      disclaimer: DISCLAIMER,
    },
  };
}

/** Content-free by contract: report must never contain detected text. */
export function reportToJson(report: AuditReport): string {
  return JSON.stringify(report, null, 2);
}

/** Render the report into a printable DOM section (uses report container). */
export function reportSummaryHtml(report: AuditReport): string {
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const rows = Object.entries(report.redaction.byCategory)
    .map(([k, v]) => `<tr><td>${esc(k)}</td><td>${v}</td></tr>`)
    .join("");
  return `
    <dl class="report-dl">
      <dt>Generated</dt><dd>${esc(report.generatedAt)}</dd>
      <dt>Input</dt><dd>${esc(report.input.fileName)} (${report.input.pixelWidth}×${report.input.pixelHeight})</dd>
      <dt>Output SHA-256</dt><dd class="mono">${esc(report.output.sha256)}</dd>
      <dt>Redaction boxes</dt><dd>${report.redaction.totalBoxes} (${report.redaction.manualBoxes} manual)</dd>
      <dt>Residual detector hits</dt><dd>${report.verification.residualHits}</dd>
    </dl>
    <table class="report-table"><thead><tr><th>Category</th><th>Boxes</th></tr></thead><tbody>${rows}</tbody></table>
    <p class="disclaimer">${esc(report.verification.disclaimer)}</p>`;
}
