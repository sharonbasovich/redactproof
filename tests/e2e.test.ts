/**
 * Pixel-level end-to-end test on a real image:
 *   PNG -> tesseract OCR -> detectSensitive -> burn black pixels
 *   -> re-encode PNG -> OCR the output -> assert zero residual hits
 *
 * This exercises the same detect/burn math the browser app uses, without
 * needing a DOM (pixels are painted directly onto the decoded raster).
 */
import { readFileSync } from "node:fs";
import { PNG } from "pngjs";
import { afterAll, describe, expect, it } from "vitest";
import { detectSensitive } from "../src/detect";
import { recognize, terminateOcr } from "../src/ocr";
import { buildAuditReport, reportToJson } from "../src/report";
import type { BBox, DetectorCategory, RedactionBox } from "../src/types";

const FIXTURE = "fixtures/support-ticket.png";

afterAll(async () => {
  await terminateOcr();
});

function burnIntoPng(png: PNG, boxes: BBox[]): PNG {
  for (const b of boxes) {
    const x0 = Math.max(0, Math.floor(b.x0));
    const y0 = Math.max(0, Math.floor(b.y0));
    const x1 = Math.min(png.width, Math.ceil(b.x1));
    const y1 = Math.min(png.height, Math.ceil(b.y1));
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const idx = (png.width * y + x) << 2;
        png.data[idx] = png.data[idx + 1] = png.data[idx + 2] = 0;
        png.data[idx + 3] = 255;
      }
    }
  }
  return png;
}

describe("fixture end-to-end", () => {
  it(
    "detects the seeded PII and verifies a clean export",
    async () => {
      const png = PNG.sync.read(readFileSync(FIXTURE));

      // 1. OCR + detect on the original
      const first = await recognize(FIXTURE);
      expect(first.words.length).toBeGreaterThan(50);
      const detections = detectSensitive(first.words);
      const categories = new Set(detections.map((d) => d.category));
      const expected: DetectorCategory[] = ["email", "phone", "payment-card", "postal-code", "ssn", "ipv4"];
      for (const cat of expected) {
        if (!categories.has(cat)) throw new Error(`expected a ${cat} detection, got ${[...categories]}`);
      }

      // 2. Burn every detection into a fresh raster
      const boxes: BBox[] = detections.map((d) => d.bbox);
      burnIntoPng(png, boxes);
      const out = PNG.sync.write(png);

      // 3. Re-OCR the exported pixels — the pipeline's own verification step
      const second = await recognize(out);
      const residual = detectSensitive(second.words);
      expect(residual).toHaveLength(0);

      // 4. Audit report carries counts + hash, never PII text
      const redactBoxes: RedactionBox[] = detections.map((d, i) => ({
        id: `b${i}`,
        bbox: d.bbox,
        category: d.category,
        rule: d.rule,
        confidence: d.confidence,
        enabled: true,
        source: "detector",
      }));
      const report = buildAuditReport({
        inputFileName: "support-ticket.png",
        inputWidth: png.width,
        inputHeight: png.height,
        outputSha256: "0".repeat(64),
        outputWidth: png.width,
        outputHeight: png.height,
        boxes: redactBoxes,
        hits: residual,
        now: new Date("2026-09-23T00:00:00Z"),
      });
      const json = reportToJson(report);
      expect(report.verification.residualHits).toBe(0);
      expect(report.redaction.byCategory["email"]).toBeGreaterThanOrEqual(2);
      // content-free contract: none of the seeded values may leak into the report
      for (const pii of [
        "jane.public@example.com",
        "4111",
        "078-05-1120",
        "M5V",
        "203.0.113.42",
      ]) {
        expect(json).not.toContain(pii);
      }
    },
    180_000,
  );
});
