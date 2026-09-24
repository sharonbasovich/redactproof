import { describe, expect, it } from "vitest";
import { checkRegions, findCandidateRegions } from "../../src/redteam/analyze";
import { makeRaster, paintPixels, paintRect, seededRandom } from "./fixtures";

const REGION = { x0: 16, y0: 16, x1: 48, y1: 48 };

describe("checkRegions", () => {
  it("classifies an opaque solid fill as uniform, never translucent", () => {
    const img = makeRaster(64, 64);
    paintRect(img, REGION, [0, 0, 0, 255]);
    const [r] = checkRegions(img, [REGION]);
    expect(r.kind).toBe("uniform");
    expect(r.alphaMin).toBe(255);
    expect(r.uniformity).toBeGreaterThan(0.98);
  });

  it("does not call a uniform white fill translucent either", () => {
    const img = makeRaster(64, 64);
    const [r] = checkRegions(img, [REGION]);
    expect(r.kind).toBe("uniform");
    expect(r.alphaMin).toBe(255);
  });

  it("flags a semi-transparent overlay as translucent", () => {
    const img = makeRaster(64, 64);
    paintRect(img, REGION, [0, 0, 0, 160]);
    const [r] = checkRegions(img, [REGION]);
    expect(r.kind).toBe("translucent");
    expect(r.alphaMin).toBe(160);
    expect(r.note).toContain("semi-transparent");
  });

  it("flags a region that is only partially covered in alpha", () => {
    const img = makeRaster(64, 64);
    // 1/4 of the region carries alpha 200 — still recoverable content.
    paintRect(img, { x0: 16, y0: 16, x1: 32, y1: 48 }, [30, 30, 30, 200]);
    const [r] = checkRegions(img, [REGION]);
    expect(r.kind).toBe("translucent");
    expect(r.alphaMin).toBe(200);
  });

  it("classifies block-quantized content as pixelated", () => {
    const img = makeRaster(64, 64);
    // 8px checkerboard blocks aligned to the region origin.
    paintPixels(img, REGION, (x, y) => {
      const on = (Math.floor(x / 8) + Math.floor(y / 8)) % 2 === 0;
      const v = on ? 20 : 220;
      return [v, v, v, 255];
    });
    const [r] = checkRegions(img, [REGION]);
    expect(r.kind).toBe("pixelated");
    expect(r.note).toContain("grid");
  });

  it("classifies a smooth low-frequency gradient as blurred", () => {
    const img = makeRaster(64, 64);
    paintPixels(img, REGION, (x) => {
      const v = 100 + Math.round(((x - REGION.x0) / (REGION.x1 - REGION.x0)) * 40);
      return [v, v, v, 255];
    });
    const [r] = checkRegions(img, [REGION]);
    expect(r.kind).toBe("blurred");
    expect(r.edgeEnergy).toBeLessThan(0.05);
  });

  it("reports unknown with measured stats for high-frequency content", () => {
    const img = makeRaster(64, 64);
    const rand = seededRandom(42);
    paintPixels(img, REGION, () => {
      const v = Math.floor(rand() * 256);
      return [v, v, v, 255];
    });
    const [r] = checkRegions(img, [REGION]);
    expect(r.kind).toBe("unknown");
    expect(r.note).toContain("edgeEnergy");
    expect(r.edgeEnergy).toBeGreaterThan(0.05);
  });

  it("handles degenerate and out-of-bounds boxes without throwing", () => {
    const img = makeRaster(64, 64);
    const [empty, offscreen, swapped] = checkRegions(img, [
      { x0: 10, y0: 10, x1: 10, y1: 20 },
      { x0: 100, y0: 100, x1: 200, y1: 200 },
      { x0: 40, y0: 40, x1: 16, y1: 16 },
    ]);
    expect(empty.kind).toBe("unknown");
    expect(empty.note).toContain("out-of-bounds");
    expect(offscreen.kind).toBe("unknown");
    expect(swapped.kind).not.toBeUndefined(); // clamped, not dropped
  });
});

describe("findCandidateRegions", () => {
  it("finds a solid box that departs from the background", () => {
    const img = makeRaster(128, 128);
    paintRect(img, { x0: 24, y0: 24, x1: 56, y1: 48 }, [0, 0, 0, 255]);
    const boxes = findCandidateRegions(img);
    expect(boxes).toHaveLength(1);
    const b = boxes[0];
    expect(b.x0).toBeLessThanOrEqual(24);
    expect(b.y0).toBeLessThanOrEqual(24);
    expect(b.x1).toBeGreaterThanOrEqual(56);
    expect(b.y1).toBeGreaterThanOrEqual(48);
  });

  it("finds a translucent overlay", () => {
    const img = makeRaster(128, 128);
    paintRect(img, { x0: 40, y0: 40, x1: 72, y1: 72 }, [0, 0, 0, 128]);
    const boxes = findCandidateRegions(img);
    expect(boxes).toHaveLength(1);
  });

  it("does not flag flat background-colored areas", () => {
    const img = makeRaster(128, 128);
    paintRect(img, { x0: 0, y0: 0, x1: 32, y1: 32 }, [255, 255, 255, 255]);
    expect(findCandidateRegions(img)).toHaveLength(0);
  });

  it("skips isolated single-cell specks", () => {
    const img = makeRaster(128, 128);
    paintRect(img, { x0: 60, y0: 60, x1: 64, y1: 64 }, [0, 0, 0, 255]);
    expect(findCandidateRegions(img)).toHaveLength(0);
  });

  it("returns nothing for an empty raster", () => {
    expect(findCandidateRegions({ width: 0, height: 0, data: new Uint8ClampedArray(0) })).toEqual([]);
  });
});
