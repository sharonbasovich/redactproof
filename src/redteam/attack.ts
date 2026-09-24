import { detectSensitive } from "../detect";
import { recognize } from "../ocr";
import type { BBox } from "../types";
import { rasterToOcrInput } from "./canvas";
import type {
  AttackHit,
  AttackId,
  AttackRunOptions,
  AttackRunResult,
  AttackVariant,
  Raster,
} from "./types";
import { ATTACK_IDS } from "./types";

/**
 * Margin (px) added around each scoped region. Region-scoped transforms
 * only rewrite pixels inside the padded region, so the OCR still sees a
 * little of the surrounding context exactly as exported.
 */
export const REGION_PAD = 24;

/** Safety ceiling for upscale-sharpen — never emit more than this many pixels. */
export const UPSCALE_MAX_PIXELS = 16_000_000;

export function cloneRaster(src: Raster): Raster {
  return {
    width: src.width,
    height: src.height,
    data: new Uint8ClampedArray(src.data),
  };
}

function luma(data: Uint8ClampedArray, o: number): number {
  return 0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2];
}

interface RegionMask {
  /** padded, clamped regions in pixel space */
  boxes: Array<{ x0: number; y0: number; x1: number; y1: number }>;
}

function paddedRegions(src: Raster, regions?: BBox[]): RegionMask | null {
  if (!regions || regions.length === 0) return null;
  const boxes = regions
    .map((b) => ({
      x0: Math.max(0, Math.floor(Math.min(b.x0, b.x1) - REGION_PAD)),
      y0: Math.max(0, Math.floor(Math.min(b.y0, b.y1) - REGION_PAD)),
      x1: Math.min(src.width, Math.ceil(Math.max(b.x0, b.x1) + REGION_PAD)),
      y1: Math.min(src.height, Math.ceil(Math.max(b.y0, b.y1) + REGION_PAD)),
    }))
    .filter((b) => b.x1 > b.x0 && b.y1 > b.y0);
  return boxes.length ? { boxes } : null;
}

/** Iterate byte offsets of pixels inside the mask (whole image when null). */
function* maskedOffsets(src: Raster, mask: RegionMask | null) {
  if (!mask) {
    for (let i = 0; i < src.width * src.height; i++) yield i * 4;
    return;
  }
  for (const b of mask.boxes) {
    for (let y = b.y0; y < b.y1; y++) {
      for (let x = b.x0; x < b.x1; x++) {
        yield (src.width * y + x) * 4;
      }
    }
  }
}

function percentile(hist: Uint32Array, count: number, p: number): number {
  if (count === 0) return 0;
  const target = count * p;
  let acc = 0;
  for (let i = 0; i < 256; i++) {
    acc += hist[i];
    if (acc >= target) return i;
  }
  return 255;
}

/**
 * Local-background flatten + percentile stretch.
 *
 * A global contrast stretch is not enough for marker recovery: a
 * translucent black band leaves the text darker than the band but the
 * band itself mid-gray, and tesseract's Otsu binarization then treats
 * the whole band as black. Dividing each pixel's luma by a box-blurred
 * local background (radius much larger than a stroke, smaller than a
 * marker band) turns the band white and keeps the strokes dark —
 * "high-pass" normalization. A final [p2, p98] stretch restores global
 * contrast. Radius scales with the image and is clamped to [8, 24]px.
 */
function levelsStretch(src: Raster, mask: RegionMask | null): Raster {
  const { width: w, height: h } = src;
  const n = w * h;
  const lum = new Float32Array(n);
  for (let i = 0; i < n; i++) lum[i] = luma(src.data, i * 4);

  const radius = Math.max(8, Math.min(24, Math.round(Math.min(w, h) * 0.03)));
  const bg = boxBlur(lum, w, h, radius);

  const flat = new Uint8Array(n);
  const hist = new Uint32Array(256);
  let count = 0;
  const norm = new Uint8ClampedArray(n); // clamps the divide at 255
  for (let i = 0; i < n; i++) norm[i] = (255 * lum[i]) / Math.max(1, bg[i]);
  for (const o of maskedOffsets(src, mask)) {
    const v = norm[o / 4];
    flat[o / 4] = v;
    hist[v]++;
    count++;
  }
  const lo = percentile(hist, count, 0.02);
  const hi = percentile(hist, count, 0.98);
  const range = Math.max(1, hi - lo);
  const lut = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v++) lut[v] = ((v - lo) / range) * 255;

  const out = cloneRaster(src);
  for (const o of maskedOffsets(src, mask)) {
    const v = lut[flat[o / 4]];
    out.data[o] = out.data[o + 1] = out.data[o + 2] = v;
    out.data[o + 3] = 255;
  }
  return out;
}

/** Separable box blur on a Float32 single-channel image, O(n) per pass. */
function boxBlur(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  // horizontal
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let sum = 0;
    for (let x = -r; x <= r; x++) sum += src[row + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = sum / (2 * r + 1);
      const xAdd = Math.min(w - 1, x + r + 1);
      const xSub = Math.max(0, x - r);
      sum += src[row + xAdd] - src[row + xSub];
    }
  }
  // vertical
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let y = -r; y <= r; y++) sum += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = sum / (2 * r + 1);
      const yAdd = Math.min(h - 1, y + r + 1);
      const ySub = Math.max(0, y - r);
      sum += tmp[yAdd * w + x] - tmp[ySub * w + x];
    }
  }
  return out;
}

/**
 * Gamma remap on luminance. `gamma < 1` lifts shadows (reveals strokes
 * under dark translucent overlays); `gamma > 1` deepens mid-tones
 * (reveals faint marks under light/white overlays).
 */
function gammaRemap(src: Raster, gamma: number, mask: RegionMask | null): Raster {
  const lut = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v++) lut[v] = 255 * Math.pow(v / 255, gamma);

  const out = cloneRaster(src);
  for (const o of maskedOffsets(src, mask)) {
    const v = lut[Math.round(luma(src.data, o))];
    out.data[o] = out.data[o + 1] = out.data[o + 2] = v;
    out.data[o + 3] = 255;
  }
  return out;
}

function invert(src: Raster, mask: RegionMask | null): Raster {
  const out = cloneRaster(src);
  for (const o of maskedOffsets(src, mask)) {
    out.data[o] = 255 - src.data[o];
    out.data[o + 1] = 255 - src.data[o + 1];
    out.data[o + 2] = 255 - src.data[o + 2];
    out.data[o + 3] = 255;
  }
  return out;
}

/**
 * Per-pixel max(R,G,B) → grayscale. A colored marker (e.g. a yellow
 * highlight, pure-red block) suppresses one channel while the strokes
 * survive in the others; taking the channel max restores them.
 */
function channelMax(src: Raster, mask: RegionMask | null): Raster {
  const out = cloneRaster(src);
  for (const o of maskedOffsets(src, mask)) {
    const v = Math.max(src.data[o], src.data[o + 1], src.data[o + 2]);
    out.data[o] = out.data[o + 1] = out.data[o + 2] = v;
    out.data[o + 3] = 255;
  }
  return out;
}

/**
 * Nearest-neighbor upscale (factor 2 when the output stays under
 * UPSCALE_MAX_PIXELS) followed by a 3x3 unsharp mask. Nearest keeps the
 * hard edges tesseract's binarizer wants; the unsharp pass restores edge
 * contrast lost to blur/pixelation.
 *
 * Scoped mode pastes the sharpened regions back over a 1x copy so the
 * surrounding context stays at native scale.
 */
function upscaleSharpen(src: Raster, mask: RegionMask | null): Raster {
  let factor = 2;
  if (src.width * src.height * 4 > UPSCALE_MAX_PIXELS) factor = 1;
  const w = src.width * factor;
  const h = src.height * factor;
  const up = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const sy = Math.min(src.height - 1, Math.floor(y / factor));
    for (let x = 0; x < w; x++) {
      const sx = Math.min(src.width - 1, Math.floor(x / factor));
      const di = (w * y + x) * 4;
      const si = (src.width * sy + sx) * 4;
      up[di] = src.data[si];
      up[di + 1] = src.data[si + 1];
      up[di + 2] = src.data[si + 2];
      up[di + 3] = 255;
    }
  }

  // unsharp: out = clamp(orig + 1.5 * (orig - blurred3x3))
  const amount = 1.5;
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const di = (w * y + x) * 4;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) {
        out[di] = up[di];
        out[di + 1] = up[di + 1];
        out[di + 2] = up[di + 2];
        out[di + 3] = 255;
        continue;
      }
      for (let c = 0; c < 3; c++) {
        let sum = 0;
        for (let ky = -1; ky <= 1; ky++) {
          for (let kx = -1; kx <= 1; kx++) {
            sum += up[(w * (y + ky) + (x + kx)) * 4 + c];
          }
        }
        const blurred = sum / 9;
        out[di + c] = up[di + c] + amount * (up[di + c] - blurred);
      }
      out[di + 3] = 255;
    }
  }

  if (!mask) return { width: w, height: h, data: out };

  const result = cloneRaster(src);
  for (const b of mask.boxes) {
    for (let y = b.y0; y < b.y1; y++) {
      for (let x = b.x0; x < b.x1; x++) {
        const di = (src.width * y + x) * 4;
        const si = (w * (y * factor) + x * factor) * 4;
        result.data[di] = out[si];
        result.data[di + 1] = out[si + 1];
        result.data[di + 2] = out[si + 2];
        result.data[di + 3] = 255;
      }
    }
  }
  return result;
}

/**
 * Apply one attack transform. With `regions`, pixels inside each padded
 * region are transformed and everything else is copied through, so the
 * output keeps the exported image's surrounding context.
 */
export function applyAttack(src: Raster, id: AttackId, regions?: BBox[]): Raster {
  const mask = paddedRegions(src, regions);
  switch (id) {
    case "identity":
      return cloneRaster(src);
    case "levels-stretch":
      return levelsStretch(src, mask);
    case "gamma-lift":
      return gammaRemap(src, 0.35, mask);
    case "gamma-drop":
      return gammaRemap(src, 2.6, mask);
    case "invert":
      return invert(src, mask);
    case "channel-max":
      return channelMax(src, mask);
    case "upscale-sharpen":
      return upscaleSharpen(src, mask);
  }
}

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
 * Merge hits that different variants report for the same underlying
 * region: same category and overlapping boxes (IoU > 0.25 or one's
 * center inside the other — attack passes distort boundaries). The
 * surviving hit keeps the highest-confidence detection's fields, a
 * union bbox, and every contributing attack id.
 */
export function dedupeAttackHits(hits: AttackHit[]): AttackHit[] {
  const merged: AttackHit[] = [];
  for (const h of hits) {
    const cx = (h.bbox.x0 + h.bbox.x1) / 2;
    const cy = (h.bbox.y0 + h.bbox.y1) / 2;
    const existing = merged.find(
      (m) =>
        m.category === h.category &&
        (bboxIoU(m.bbox, h.bbox) > 0.25 ||
          (cx >= m.bbox.x0 && cx <= m.bbox.x1 && cy >= m.bbox.y0 && cy <= m.bbox.y1)),
    );
    if (!existing) {
      merged.push({ ...h, attacks: [...h.attacks] });
      continue;
    }
    for (const a of h.attacks) {
      if (!existing.attacks.includes(a)) existing.attacks.push(a);
    }
    existing.bbox = {
      x0: Math.min(existing.bbox.x0, h.bbox.x0),
      y0: Math.min(existing.bbox.y0, h.bbox.y0),
      x1: Math.max(existing.bbox.x1, h.bbox.x1),
      y1: Math.max(existing.bbox.y1, h.bbox.y1),
    };
    if (h.confidence > existing.confidence) {
      const attacks = existing.attacks;
      const bbox = existing.bbox;
      Object.assign(existing, h);
      existing.attacks = attacks;
      existing.bbox = bbox;
    }
  }
  merged.sort((a, b) => a.bbox.y0 - b.bbox.y0 || a.bbox.x0 - b.bbox.x0);
  return merged;
}

export class AbortedError extends Error {
  constructor() {
    super("attack run aborted");
    this.name = "AbortedError";
  }
}

/**
 * Run each attack variant over the source raster, OCR + detect
 * sequentially, and dedupe the resulting hits.
 *
 * Sequencing is deliberate: the shared tesseract worker is
 * single-threaded, so parallel recognizes would just queue inside the
 * worker while multiplying memory use.
 *
 * Throws AbortedError when `signal` aborts mid-run; partial progress is
 * reported through `onProgress` up to that point.
 */
export async function runAttacks(
  src: Raster,
  opts: AttackRunOptions = {},
): Promise<AttackRunResult> {
  const started = Date.now();
  const ids = opts.variants ?? [...ATTACK_IDS];
  const variants: AttackVariant[] = [];
  const rawHits: AttackHit[] = [];

  let done = 0;
  for (const id of ids) {
    if (opts.signal?.aborted) throw new AbortedError();
    const raster = applyAttack(src, id, opts.regions);
    variants.push({ id, raster });
    const input = await rasterToOcrInput(raster);
    const { words } = await recognize(input);
    const scale = raster.width / src.width; // upscale variants map back
    for (const d of detectSensitive(words)) {
      rawHits.push({
        ...d,
        bbox: {
          x0: d.bbox.x0 / scale,
          y0: d.bbox.y0 / scale,
          x1: d.bbox.x1 / scale,
          y1: d.bbox.y1 / scale,
        },
        attack: id,
        attacks: [id],
      });
    }
    done++;
    opts.onProgress?.(done, ids.length, id);
  }

  const hits = dedupeAttackHits(rawHits);
  const recoveredWords = hits
    .filter((h) => h.attacks.every((a) => a !== "identity"))
    .reduce((s, h) => s + h.wordIndices.length, 0);

  return { variants, hits, recoveredWords, elapsedMs: Date.now() - started };
}
