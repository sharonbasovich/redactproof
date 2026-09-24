/**
 * Tests for the standalone "verify an existing image" path:
 *   - the leaky fixture (translucent white-out over an email) is caught
 *   - the enhanced deep pass still detects it
 *   - the same image hashes identically every time
 *   - the audit JSON omits detected strings AND the source filename
 *   - low OCR confidence produces an "inconclusive" status, not "clean"
 *   - dedupeHits merges cross-pass duplicates with provenance
 */
import { readFileSync } from "node:fs";
import { PNG } from "pngjs";
import { afterAll, describe, expect, it } from "vitest";
import { assessOcrQuality, detectSensitive } from "../src/detect";
import { recognize, terminateOcr } from "../src/ocr";
import { enhanceContrast, upscale2x, type RgbaImage } from "../src/preprocess";
import { sha256Hex } from "../src/redact";
import {
  buildVerifyReport,
  dedupeHits,
  verifyReportToJson,
  verifyStatus,
} from "../src/verify";
import type { OcrWord, VerifyHit } from "../src/types";

const FIXTURE = "fixtures/leaky-redaction.png";

afterAll(async () => {
  await terminateOcr();
});

function toRgba(png: PNG): RgbaImage {
  return { width: png.width, height: png.height, data: new Uint8ClampedArray(png.data) };
}

function pngOf(img: RgbaImage): PNG {
  const png = new PNG({ width: img.width, height: img.height });
  png.data = Buffer.from(img.data.buffer, img.data.byteOffset, img.data.byteLength);
  return png;
}

describe("preprocess", () => {
  it("upscale2x doubles dimensions and keeps alpha opaque", () => {
    const src: RgbaImage = {
      width: 2,
      height: 2,
      data: new Uint8ClampedArray([
        10, 20, 30, 255, 40, 50, 60, 255, 70, 80, 90, 255, 1, 2, 3, 255,
      ]),
    };
    const out = upscale2x(src);
    expect(out.width).toBe(4);
    expect(out.height).toBe(4);
    expect(out.data.length).toBe(4 * 4 * 4);
    for (let i = 3; i < out.data.length; i += 4) expect(out.data[i]).toBe(255);
    // nearest neighbor: top-left pixel replicated into the 2x2 block
    expect(out.data[0]).toBe(10);
    expect(out.data[(4 * 1 + 1) * 4]).toBe(10);
  });

  it("enhanceContrast produces grayscale with full range", () => {
    const src: RgbaImage = {
      width: 2,
      height: 1,
      data: new Uint8ClampedArray([100, 100, 100, 255, 200, 210, 220, 255]),
    };
    const out = enhanceContrast(src);
    // grayscale: r=g=b
    expect(out.data[0]).toBe(out.data[1]);
    expect(out.data[4]).toBe(out.data[5]);
    // stretched: darkest -> 0, brightest -> 255
    expect(out.data[0]).toBe(0);
    expect(out.data[4]).toBe(255);
  });
});

describe("dedupeHits", () => {
  const base: VerifyHit = {
    category: "email",
    rule: "rfc5322-lite",
    confidence: 0.8,
    bbox: { x0: 10, y0: 10, x1: 100, y1: 30 },
    passes: ["standard"],
  };

  it("merges same-category overlapping hits and unions passes", () => {
    const shifted: VerifyHit = {
      ...base,
      confidence: 0.9,
      bbox: { x0: 12, y0: 11, x1: 102, y1: 31 },
      passes: ["enhanced-2x"],
    };
    const out = dedupeHits([base, shifted]);
    expect(out).toHaveLength(1);
    expect(out[0].passes.sort()).toEqual(["enhanced-2x", "standard"]);
    expect(out[0].confidence).toBe(0.9);
    expect(out[0].bbox).toEqual({ x0: 10, y0: 10, x1: 102, y1: 31 });
  });

  it("keeps different categories and distant boxes separate", () => {
    const otherCat: VerifyHit = { ...base, category: "phone", passes: ["standard"] };
    const far: VerifyHit = {
      ...base,
      bbox: { x0: 10, y0: 300, x1: 100, y1: 320 },
      passes: ["enhanced-2x"],
    };
    expect(dedupeHits([base, otherCat, far])).toHaveLength(3);
  });
});

describe("verifyStatus / low OCR confidence", () => {
  it("warns as inconclusive when OCR found almost nothing", () => {
    const thin: OcrWord[] = [
      { text: "blur", bbox: { x0: 0, y0: 0, x1: 20, y1: 10 }, confidence: 0.3 },
    ];
    const q = assessOcrQuality(thin);
    expect(q.suspicious).toBe(true);
    expect(verifyStatus([], q)).toBe("inconclusive");
  });

  it("no-hits requires decent OCR; hits always win", () => {
    const good: OcrWord[] = Array.from({ length: 40 }, (_, i) => ({
      text: `word${i}`,
      bbox: { x0: 0, y0: i, x1: 10, y1: i + 8 },
      confidence: 0.95,
    }));
    const q = assessOcrQuality(good);
    expect(q.suspicious).toBe(false);
    const hit: VerifyHit = {
      category: "email",
      rule: "rfc5322-lite",
      confidence: 0.9,
      bbox: { x0: 0, y0: 0, x1: 10, y1: 8 },
      passes: ["standard"],
    };
    expect(verifyStatus([hit], q)).toBe("hits-found");
    expect(verifyStatus([], q)).toBe("no-hits");
  });
});

describe("leaky fixture — independent verify catches what 'redaction' missed", () => {
  it(
    "flags the translucent-covered email and the missed phone number",
    async () => {
      const res = await recognize(FIXTURE);
      const hits = detectSensitive(res.words).map((d) => ({
        category: d.category,
        rule: d.rule,
        confidence: d.confidence,
        bbox: d.bbox,
        passes: ["standard"],
      }));
      const cats = new Set(hits.map((h) => h.category));
      expect(cats.has("email")).toBe(true);
      expect(cats.has("phone")).toBe(true);
      // solid boxes over card + SSN must NOT fire — proves the boxes are opaque
      expect(cats.has("payment-card")).toBe(false);
      expect(cats.has("ssn")).toBe(false);
    },
    180_000,
  );

  it(
    "deep pass (contrast + 2x upscale) still detects the residual email",
    async () => {
      const png = PNG.sync.read(readFileSync(FIXTURE));
      const enhanced = pngOf(upscale2x(enhanceContrast(toRgba(png))));
      const res = await recognize(PNG.sync.write(enhanced));
      const hits = detectSensitive(res.words);
      expect(hits.some((h) => h.category === "email")).toBe(true);
    },
    180_000,
  );

  it("produces a stable SHA-256 for identical bytes", async () => {
    const bytes = readFileSync(FIXTURE);
    const a = await sha256Hex(new Uint8Array(bytes));
    const b = await sha256Hex(new Uint8Array(bytes));
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it(
    "audit JSON omits detected strings and the filename",
    async () => {
      const res = await recognize(FIXTURE);
      const hits = dedupeHits(
        detectSensitive(res.words).map((d) => ({
          category: d.category,
          rule: d.rule,
          confidence: d.confidence,
          bbox: d.bbox,
          passes: ["standard"],
        })),
      );
      const quality = assessOcrQuality(res.words);
      const report = buildVerifyReport({
        imageSha256: await sha256Hex(new Uint8Array(readFileSync(FIXTURE))),
        width: 1100,
        height: 640,
        hits,
        passesRun: ["standard"],
        quality,
        now: new Date("2026-09-24T00:00:00Z"),
      });
      expect(report.check.status).toBe("hits-found");
      const json = verifyReportToJson(report);
      for (const leaked of [
        "jane.public@example.com",
        "555-0142",
        "leaky-redaction.png",
      ]) {
        expect(json).not.toContain(leaked);
      }
      expect(report.detectorScope).toHaveLength(7);
    },
    180_000,
  );
});
