/**
 * Red-team engine tests.
 *
 * Unit tests exercise the pure raster transforms, dedupe, and grading
 * without OCR. The fixture tests run the real pipeline (PNG -> attacks
 * -> tesseract -> detectSensitive) and assert only recoverability that
 * was actually measured — no aspirational claims.
 */
import { readFileSync } from "node:fs";
import { PNG } from "pngjs";
import { afterAll, describe, expect, it } from "vitest";
import {
  applyAttack,
  dedupeAttackHits,
  REGION_PAD,
  runAttacks,
} from "../src/redteam/attack";
import { grade } from "../src/redteam/grade";
import { terminateOcr } from "../src/ocr";
import type {
  AttackHit,
  AttackRunResult,
  Raster,
} from "../src/redteam/types";

function pngToRaster(path: string): Raster {
  const png = PNG.sync.read(readFileSync(path));
  return { width: png.width, height: png.height, data: new Uint8ClampedArray(png.data) };
}

function solidRaster(w: number, h: number, rgb: [number, number, number]): Raster {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = rgb[0];
    data[i * 4 + 1] = rgb[1];
    data[i * 4 + 2] = rgb[2];
    data[i * 4 + 3] = 255;
  }
  return { width: w, height: h, data };
}

function px(r: Raster, x: number, y: number): number[] {
  const o = (r.width * y + x) * 4;
  return [r.data[o], r.data[o + 1], r.data[o + 2], r.data[o + 3]];
}

function fakeHit(partial: Partial<AttackHit>): AttackHit {
  return {
    category: "email",
    rule: "rfc5322-lite",
    text: "a@b.co",
    confidence: 0.8,
    wordIndices: [0],
    bbox: { x0: 0, y0: 0, x1: 50, y1: 20 },
    attack: "identity",
    attacks: ["identity"],
    ...partial,
  };
}

afterAll(async () => {
  await terminateOcr();
});

describe("applyAttack transforms", () => {
  it("identity clones without sharing the buffer", () => {
    const src = solidRaster(4, 4, [10, 20, 30]);
    const out = applyAttack(src, "identity");
    expect(out.data).not.toBe(src.data);
    expect([...out.data]).toEqual([...src.data]);
  });

  it("invert flips each channel and forces alpha opaque", () => {
    const src = solidRaster(2, 2, [10, 128, 250]);
    src.data[3] = 128; // translucent source pixel
    const out = applyAttack(src, "invert");
    expect(px(out, 0, 0)).toEqual([245, 127, 5, 255]);
  });

  it("channel-max takes the strongest channel into grayscale", () => {
    const src = solidRaster(2, 2, [30, 200, 90]);
    const out = applyAttack(src, "channel-max");
    expect(px(out, 0, 0)).toEqual([200, 200, 200, 255]);
  });

  it("gamma-lift brightens mid-tones, gamma-drop darkens them", () => {
    const src = solidRaster(2, 2, [128, 128, 128]);
    const lift = applyAttack(src, "gamma-lift");
    const drop = applyAttack(src, "gamma-drop");
    expect(lift.data[0]).toBeGreaterThan(128);
    expect(drop.data[0]).toBeLessThan(128);
  });

  it("region scope leaves pixels outside the padded region untouched", () => {
    const src = solidRaster(100, 100, [128, 128, 128]);
    const out = applyAttack(src, "invert", [{ x0: 40, y0: 40, x1: 50, y1: 50 }]);
    // padded region is 40-24..50+24 = 16..74
    expect(px(out, 5, 5)).toEqual([128, 128, 128, 255]); // outside
    expect(px(out, 45, 45)).toEqual([127, 127, 127, 255]); // inside
    expect(px(out, 17, 45)).toEqual([127, 127, 127, 255]); // inside pad
    expect(px(out, 15, 45)).toEqual([128, 128, 128, 255]); // just outside pad
    expect(REGION_PAD).toBe(24);
  });

  it("upscale-sharpen doubles dimensions under the cap", () => {
    const src = solidRaster(40, 30, [100, 100, 100]);
    const out = applyAttack(src, "upscale-sharpen");
    expect(out.width).toBe(80);
    expect(out.height).toBe(60);
  });

  it("upscale-sharpen is capped: huge sources keep native scale", () => {
    const src = solidRaster(2001, 2000, [100, 100, 100]); // >4M px => 2x exceeds cap
    const out = applyAttack(src, "upscale-sharpen");
    expect(out.width).toBe(2001);
    expect(out.height).toBe(2000);
  });
});

describe("dedupeAttackHits", () => {
  it("merges same-category overlapping hits, unions attacks, keeps best", () => {
    const a = fakeHit({ attack: "identity", attacks: ["identity"], confidence: 0.9 });
    const b = fakeHit({
      attack: "levels-stretch",
      attacks: ["levels-stretch"],
      confidence: 0.6,
      bbox: { x0: 4, y0: 2, x1: 60, y1: 24 },
    });
    const out = dedupeAttackHits([a, b]);
    expect(out).toHaveLength(1);
    expect(out[0].confidence).toBe(0.9);
    expect(out[0].attacks.sort()).toEqual(["identity", "levels-stretch"]);
    expect(out[0].bbox.x1).toBe(60);
  });

  it("does not merge different categories", () => {
    const a = fakeHit({ category: "email" });
    const b = fakeHit({ category: "ssn" });
    expect(dedupeAttackHits([a, b])).toHaveLength(2);
  });
});

describe("grade", () => {
  const result = (hits: AttackHit[]): AttackRunResult => ({
    variants: [],
    hits,
    recoveredWords: hits.length,
    elapsedMs: 1,
  });

  it("grades F when identity finds hits", () => {
    const g = grade(result([fakeHit({})]));
    expect(g.grade).toBe("F");
    expect(g.baselineHits).toBe(1);
  });

  it("grades C when only enhancement recovers", () => {
    const g = grade(
      result([fakeHit({ attack: "levels-stretch", attacks: ["levels-stretch"] })]),
    );
    expect(g.grade).toBe("C");
    expect(g.enhancedHits).toBe(1);
  });

  it("grades B for marginal weak recovery", () => {
    const g = grade(
      result([
        fakeHit({ attack: "invert", attacks: ["invert"], confidence: 0.3 }),
      ]),
    );
    expect(g.grade).toBe("B");
  });

  it("grades A with no hits and never leaks recovered text", () => {
    const g = grade(result([]));
    expect(g.grade).toBe("A");
    expect(JSON.stringify(g)).not.toContain("@");
  });

  it("reasons never contain the recovered string", () => {
    const g = grade(
      result([
        fakeHit({ text: "secret@example.com", attack: "invert", attacks: ["invert"] }),
      ]),
    );
    expect(JSON.stringify(g.reasons)).not.toContain("secret@example.com");
  });
});

describe("fixture recovery (real OCR)", () => {
  const cats = (r: AttackRunResult) => new Set(r.hits.map((h) => h.category));

  it("clean fixture grades F — everything readable on identity", async () => {
    const r = await runAttacks(pngToRaster("fixtures/redteam/clean.png"));
    expect(grade(r).grade).toBe("F");
    for (const c of ["email", "phone", "payment-card", "ssn", "postal-code", "ipv4"] as const) {
      expect(cats(r).has(c), `missing ${c}`).toBe(true);
    }
  }, 120_000);

  it("55% black marker: text recovered by enhancement (grade C)", async () => {
    const r = await runAttacks(pngToRaster("fixtures/redteam/marker-55.png"));
    const g = grade(r);
    expect(g.grade).toBe("C");
    expect(r.hits.some((h) => h.attacks.includes("levels-stretch"))).toBe(true);
    // measured: all 6 categories recovered via levels-stretch
    expect(cats(r).size).toBeGreaterThanOrEqual(5);
    expect(cats(r).has("payment-card")).toBe(true);
  }, 120_000);

  it("75% black marker: partial recovery via levels-stretch", async () => {
    const r = await runAttacks(pngToRaster("fixtures/redteam/marker-75.png"));
    const g = grade(r);
    expect(g.grade).toBe("C");
    // measured: phone, card, ssn, zip recovered; email+ipv4 lost
    expect(cats(r).size).toBeGreaterThanOrEqual(3);
    expect(cats(r).has("ssn")).toBe(true);
  }, 120_000);

  it("opaque marker: nothing recoverable (grade A, the control)", async () => {
    const r = await runAttacks(pngToRaster("fixtures/redteam/marker-opaque.png"));
    expect(r.hits).toHaveLength(0);
    expect(grade(r).grade).toBe("A");
  }, 120_000);

  it("translucent yellow highlighter: recovered via channel/luminance attacks", async () => {
    const r = await runAttacks(pngToRaster("fixtures/redteam/marker-yellow.png"));
    const g = grade(r);
    expect(g.grade).toBe("C");
    expect(cats(r).size).toBeGreaterThanOrEqual(5);
  }, 120_000);

  it("gaussian blur r4: measured unrecoverable by this engine", async () => {
    const r = await runAttacks(pngToRaster("fixtures/redteam/blur.png"));
    // honest result: no variant recovers the seeded categories
    expect(cats(r).size).toBe(0);
  }, 120_000);

  it("8x pixelation: measured unrecoverable", async () => {
    const r = await runAttacks(pngToRaster("fixtures/redteam/pixelate.png"));
    expect(cats(r).size).toBe(0);
  }, 120_000);

  it("respects AbortSignal between variants", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      runAttacks(pngToRaster("fixtures/redteam/clean.png"), {
        signal: controller.signal,
      }),
    ).rejects.toThrow();
  }, 30_000);

  it("reports progress for each variant", async () => {
    const calls: number[] = [];
    await runAttacks(pngToRaster("fixtures/redteam/marker-opaque.png"), {
      variants: ["identity", "invert"],
      onProgress: (done, total) => calls.push(done / total),
    });
    expect(calls).toEqual([0.5, 1]);
  }, 60_000);
});
