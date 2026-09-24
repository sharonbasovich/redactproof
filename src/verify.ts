import type { OcrQuality } from "./detect";
import { APP_VERSION } from "./report";
import type {
  BBox,
  DetectorCategory,
  VerifyHit,
  VerifyReport,
  VerifyStatus,
} from "./types";

/** Detector categories the verifier can recognize — mirrors detect.ts. */
export const DETECTOR_SCOPE: DetectorCategory[] = [
  "email",
  "phone",
  "payment-card",
  "postal-code",
  "ssn",
  "ipv4",
  "jwt",
];

export const VERIFY_LIMITATIONS =
  "This check ran local OCR plus pattern detectors on the exact pixels you " +
  "uploaded. It reports only hits in its supported categories (emails, " +
  "North-American phones, payment cards via Luhn, CA/US postal codes, SSNs, " +
  "IPv4 addresses, JWT-shaped tokens). It does not cover names, street " +
  "addresses, dates of birth, account/SIN/IBAN numbers, OTP codes, non-NA " +
  "phone formats, handwriting, QR/barcodes, or text too degraded for OCR. " +
  "A 'no hits' result is not a guarantee the image is clean — review it " +
  "visually before sharing. Detected strings are never written to this " +
  "report; the filename is not recorded.";

function bboxIoU(a: BBox, b: BBox): number {
  const x0 = Math.max(a.x0, b.x0);
  const y0 = Math.max(a.y0, b.y0);
  const x1 = Math.min(a.x1, b.x1);
  const y1 = Math.min(a.y1, b.y1);
  if (x1 <= x0 || y1 <= y0) return 0;
  const inter = (x1 - x0) * (y1 - y0);
  const area = (b: BBox) => (b.x1 - b.x0) * (b.y1 - b.y0);
  return inter / (area(a) + area(b) - inter);
}

/**
 * Merge hits that multiple passes report for the same region: same category
 * and overlapping boxes (IoU > 0.25, or one's center inside the other — deep
 * passes run at 2x then get mapped back, so boundaries shift slightly).
 * The merged hit keeps the highest confidence, a union bbox, and the list of
 * passes that found it.
 */
export function dedupeHits(hits: VerifyHit[]): VerifyHit[] {
  const merged: VerifyHit[] = [];
  for (const h of hits) {
    const cx = (h.bbox.x0 + h.bbox.x1) / 2;
    const cy = (h.bbox.y0 + h.bbox.y1) / 2;
    const existing = merged.find(
      (m) =>
        m.category === h.category &&
        (bboxIoU(m.bbox, h.bbox) > 0.25 ||
          (cx >= m.bbox.x0 && cx <= m.bbox.x1 && cy >= m.bbox.y0 && cy <= m.bbox.y1)),
    );
    if (existing) {
      existing.confidence = Math.max(existing.confidence, h.confidence);
      existing.bbox = {
        x0: Math.min(existing.bbox.x0, h.bbox.x0),
        y0: Math.min(existing.bbox.y0, h.bbox.y0),
        x1: Math.max(existing.bbox.x1, h.bbox.x1),
        y1: Math.max(existing.bbox.y1, h.bbox.y1),
      };
      for (const p of h.passes) {
        if (!existing.passes.includes(p)) existing.passes.push(p);
      }
    } else {
      merged.push({ ...h, passes: [...h.passes] });
    }
  }
  merged.sort((a, b) => a.bbox.y0 - b.bbox.y0 || a.bbox.x0 - b.bbox.x0);
  return merged;
}

export function verifyStatus(hits: VerifyHit[], quality: OcrQuality): VerifyStatus {
  if (hits.length > 0) return "hits-found";
  // no hits + shaky OCR = inconclusive, not "clean"
  return quality.suspicious ? "inconclusive" : "no-hits";
}

export function buildVerifyReport(args: {
  imageSha256: string;
  width: number;
  height: number;
  hits: VerifyHit[];
  passesRun: string[];
  quality: OcrQuality;
  now?: Date;
}): VerifyReport {
  return {
    tool: "RedactProof",
    toolVersion: APP_VERSION,
    reportKind: "independent-image-verify",
    generatedAt: (args.now ?? new Date()).toISOString(),
    image: {
      sha256: args.imageSha256,
      pixelWidth: args.width,
      pixelHeight: args.height,
    },
    check: {
      status: verifyStatus(args.hits, args.quality),
      passesRun: args.passesRun,
      ocrWords: args.quality.wordCount,
      ocrMeanConfidence: Number(args.quality.meanConfidence.toFixed(3)),
      lowOcrConfidence: args.quality.suspicious,
      residualHits: args.hits.length,
      hits: args.hits.map((h) => ({
        category: h.category,
        rule: h.rule,
        confidence: Number(h.confidence.toFixed(3)),
        bbox: h.bbox,
        passes: h.passes,
      })),
    },
    detectorScope: DETECTOR_SCOPE,
    limitations: VERIFY_LIMITATIONS,
  };
}

export function verifyReportToJson(report: VerifyReport): string {
  return JSON.stringify(report, null, 2);
}

const STATUS_LABEL: Record<VerifyStatus, string> = {
  "hits-found": "Residual detections found",
  "no-hits": "No detector hits",
  inconclusive: "Inconclusive (low OCR confidence)",
};

/** Render the verify report for the UI / printable output. */
export function verifySummaryHtml(report: VerifyReport): string {
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const rows = report.check.hits
    .map(
      (h) =>
        `<tr><td>${esc(h.category)}</td><td>${esc(h.rule)}</td>` +
        `<td>${Math.round(h.confidence * 100)}%</td>` +
        `<td>${esc(h.passes.join(", "))}</td></tr>`,
    )
    .join("");
  const hitsTable = report.check.hits.length
    ? `<table class="report-table"><thead><tr><th>Category</th><th>Rule</th><th>Conf</th><th>Found by</th></tr></thead><tbody>${rows}</tbody></table>`
    : `<p class="muted">No detector hits.</p>`;
  return `
    <dl class="report-dl">
      <dt>Generated</dt><dd>${esc(report.generatedAt)}</dd>
      <dt>Image</dt><dd>${report.image.pixelWidth}×${report.image.pixelHeight}px (filename omitted)</dd>
      <dt>Image SHA-256</dt><dd class="mono">${esc(report.image.sha256)}</dd>
      <dt>Status</dt><dd>${STATUS_LABEL[report.check.status]}</dd>
      <dt>OCR passes</dt><dd>${esc(report.check.passesRun.join(" → "))}</dd>
      <dt>OCR quality</dt><dd>${report.check.ocrWords} words, ${Math.round(
        report.check.ocrMeanConfidence * 100,
      )}% avg confidence${report.check.lowOcrConfidence ? " — low" : ""}</dd>
      <dt>Residual hits</dt><dd>${report.check.residualHits}</dd>
    </dl>
    ${hitsTable}
    <p class="disclaimer">${esc(report.limitations)}</p>`;
}
