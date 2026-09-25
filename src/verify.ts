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
 * Merge hits that multiple variants report for the same region: same category
 * and overlapping boxes (IoU > 0.25, or one's center inside the other — attack
 * variants run at 2x then get mapped back, so boundaries shift slightly).
 * The merged hit keeps the highest confidence, a union bbox, and the list of
 * attack variants that found it.
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
      for (const p of h.attackIds) {
        if (!existing.attackIds.includes(p)) existing.attackIds.push(p);
      }
    } else {
      merged.push({ ...h, attackIds: [...h.attackIds] });
    }
  }
  merged.sort((a, b) => a.bbox.y0 - b.bbox.y0 || a.bbox.x0 - b.bbox.x0);
  return merged;
}

/**
 * Pad an OCR-tight bbox before burning it: glyph boxes hug the text, so the
 * opaque cover needs margin (~6% of box size, min 4px), clamped to the image.
 */
export function padHitBbox(bbox: BBox, width: number, height: number): BBox {
  const px = Math.max(4, Math.round((bbox.x1 - bbox.x0) * 0.06));
  const py = Math.max(4, Math.round((bbox.y1 - bbox.y0) * 0.25));
  return {
    x0: Math.max(0, bbox.x0 - px),
    y0: Math.max(0, bbox.y0 - py),
    x1: Math.min(width, bbox.x1 + px),
    y1: Math.min(height, bbox.y1 + py),
  };
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
  engine: string;
  attacksRun: string[];
  grade: { letter: "A" | "B" | "C" | "F"; reasons: string[] };
  quality: OcrQuality;
  metadata?: {
    hasExif: boolean;
    hasGps: boolean;
    hasXmp: boolean;
    pngTextChunks: string[];
    bytesStripped: number | null;
  };
  fix?: { fromSha256: string; boxesBurned: number; priorStatus: VerifyStatus; priorHits: number };
  metadataStrip?: { fromSha256: string; removed: string[] };
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
      engine: args.engine,
      attacksRun: args.attacksRun,
      grade: args.grade,
      ocrWords: args.quality.wordCount,
      ocrMeanConfidence: Number(args.quality.meanConfidence.toFixed(3)),
      lowOcrConfidence: args.quality.suspicious,
      residualHits: args.hits.length,
      hits: args.hits.map((h) => ({
        category: h.category,
        rule: h.rule,
        confidence: Number(h.confidence.toFixed(3)),
        bbox: h.bbox,
        attackIds: h.attackIds,
      })),
      ...(args.metadata ? { metadata: args.metadata } : {}),
    },
    ...(args.fix ? { fix: args.fix } : {}),
    ...(args.metadataStrip ? { metadataStrip: args.metadataStrip } : {}),
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
        `<td>${esc(h.attackIds.join(", "))}</td></tr>`,
    )
    .join("");
  const hitsTable = report.check.hits.length
    ? `<table class="report-table"><thead><tr><th>Category</th><th>Rule</th><th>Conf</th><th>Found by</th></tr></thead><tbody>${rows}</tbody></table>`
    : `<p class="muted">No detector hits.</p>`;
  const stripRow = report.metadataStrip
    ? `<dt>Metadata stripped</dt><dd>re-encoded from sha ${esc(
        report.metadataStrip.fromSha256.slice(0, 16),
      )}… (removed: ${esc(report.metadataStrip.removed.join(", "))})</dd>`
    : "";
  const fixRow = report.fix
    ? `<dt>Fix provenance</dt><dd>${report.fix.boxesBurned} opaque box${
        report.fix.boxesBurned === 1 ? "" : "es"
      } burned over sha ${esc(report.fix.fromSha256.slice(0, 16))}… (was: ${
        STATUS_LABEL[report.fix.priorStatus]
      })</dd>`
    : "";
  const md = report.check.metadata;
  const mdLeak =
    md && (md.hasExif || md.hasGps || md.hasXmp || md.pngTextChunks.length > 0);
  const mdRow = !md
    ? ""
    : `<dt>Container metadata</dt><dd>${
        mdLeak
          ? `Residual metadata in the file: ${esc(
              [
                md.hasGps ? "GPS (EXIF)" : "",
                md.hasExif && !md.hasGps ? "EXIF" : "",
                md.hasXmp ? "XMP" : "",
                md.pngTextChunks.length
                  ? `PNG text chunks: ${md.pngTextChunks.join(", ")}`
                  : "",
              ]
                .filter(Boolean)
                .join(", "),
            )}${
              md.bytesStripped
                ? ` — ~${md.bytesStripped} bytes removable by re-export`
                : ""
            }`
          : "None detected (no EXIF/GPS/XMP or PNG text chunks)"
      }</dd>`;
  return `
    <dl class="report-dl">
      <dt>Generated</dt><dd>${esc(report.generatedAt)}</dd>
      <dt>Image</dt><dd>${report.image.pixelWidth}×${report.image.pixelHeight}px (filename omitted)</dd>
      <dt>Image SHA-256</dt><dd class="mono">${esc(report.image.sha256)}</dd>
      <dt>Status</dt><dd>${STATUS_LABEL[report.check.status]}</dd>
      <dt>Grade</dt><dd>${esc(report.check.grade.letter)} — ${esc(
        report.check.grade.reasons.join(" "),
      )}</dd>
      <dt>Engine</dt><dd>${esc(report.check.engine)}</dd>
      <dt>Attack variants</dt><dd>${esc(report.check.attacksRun.join(" → "))}</dd>
      <dt>OCR quality</dt><dd>${
        report.check.residualHits > 0
          ? "not assessed separately — hits prove OCR functioned"
          : `${report.check.ocrWords} words, ${Math.round(
              report.check.ocrMeanConfidence * 100,
            )}% avg confidence${report.check.lowOcrConfidence ? " — low" : ""}`
      }</dd>
      <dt>Residual hits</dt><dd>${report.check.residualHits}</dd>
      ${mdRow}
      ${stripRow}
      ${fixRow}
    </dl>
    ${hitsTable}
    <p class="disclaimer">${esc(report.limitations)}</p>`;
}
