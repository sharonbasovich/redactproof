import type { BBox } from "../types";

/**
 * Pixel-level red-team checks on decoded image data.
 *
 * `checkRegions` classifies a set of regions (typically the boxes that were
 * redacted) to verify the underlying content is actually gone. `findCandidateRegions`
 * scans a raster for areas that look like redaction attempts — uniform fills
 * that stand out from the surrounding image, or translucent overlays that
 * still carry recoverable pixels.
 */

export interface Raster {
  width: number;
  height: number;
  /** RGBA pixel data, row-major, 4 bytes per pixel. */
  data: Uint8ClampedArray;
}

export type RegionKind = "uniform" | "translucent" | "blurred" | "pixelated" | "unknown";

export interface RegionCheck {
  bbox: BBox;
  kind: RegionKind;
  /** Fraction of pixels within a small distance of the region's mean color; 1.0 = perfectly flat. */
  uniformity: number;
  /** Mean luminance gradient magnitude, normalized to [0, 1]. */
  edgeEnergy: number;
  /** Minimum alpha byte observed in the region (255 = fully opaque). */
  alphaMin: number;
  /** Free-form measured details; populated especially when kind is "unknown". */
  note: string;
}

const TRANSLUCENT_ALPHA = 250;
const TRANSLUCENT_FRACTION = 0.005; // ignore a stray semi-transparent pixel or two
const UNIFORM_TOLERANCE = 16; // per-channel distance from mean color
const UNIFORM_THRESHOLD = 0.98;
const BLUR_MAX_EDGE = 0.12;
const BLUR_MEAN_EDGE = 0.02;
const FLAT_STDDEV = 4; // luminance stddev below which a region is treated as flat
const PIXELATION_BOUNDARY_SHARE = 0.55;
const PIXEL_BLOCK_SIZES = [2, 3, 4, 6, 8, 12, 16, 24];

interface RegionStats {
  uniformity: number;
  edgeEnergy: number;
  maxEdge: number;
  stddev: number;
  alphaMin: number;
  translucentFraction: number;
  blockiness: { share: number; size: number };
  pixels: number;
}

function clampBox(b: BBox, w: number, h: number): BBox | null {
  const x0 = Math.max(0, Math.min(w, Math.floor(Math.min(b.x0, b.x1))));
  const y0 = Math.max(0, Math.min(h, Math.floor(Math.min(b.y0, b.y1))));
  const x1 = Math.max(0, Math.min(w, Math.ceil(Math.max(b.x0, b.x1))));
  const y1 = Math.max(0, Math.min(h, Math.ceil(Math.max(b.y0, b.y1))));
  if (x1 - x0 < 1 || y1 - y0 < 1) return null;
  return { x0, y0, x1, y1 };
}

function measure(src: Raster, box: BBox): RegionStats {
  const { width, data } = src;
  const w = box.x1 - box.x0;
  const h = box.y1 - box.y0;
  const n = w * h;

  const lum = new Float64Array(n);
  let alphaMin = 255;
  let translucent = 0;
  let mr = 0;
  let mg = 0;
  let mb = 0;
  for (let y = 0; y < h; y++) {
    const row = (box.y0 + y) * width + box.x0;
    for (let x = 0; x < w; x++) {
      const i = (row + x) * 4;
      const a = data[i + 3];
      if (a < alphaMin) alphaMin = a;
      if (a < TRANSLUCENT_ALPHA) translucent += 1;
      mr += data[i];
      mg += data[i + 1];
      mb += data[i + 2];
      lum[y * w + x] = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
    }
  }
  mr /= n;
  mg /= n;
  mb /= n;

  let nearMean = 0;
  let sum = 0;
  let sumSq = 0;
  for (let y = 0; y < h; y++) {
    const row = (box.y0 + y) * width + box.x0;
    for (let x = 0; x < w; x++) {
      const i = (row + x) * 4;
      const dr = data[i] - mr;
      const dg = data[i + 1] - mg;
      const db = data[i + 2] - mb;
      if (Math.sqrt(dr * dr + dg * dg + db * db) <= UNIFORM_TOLERANCE) nearMean += 1;
      const l = lum[y * w + x];
      sum += l;
      sumSq += l * l;
    }
  }
  const mean = sum / n;
  const stddev = Math.sqrt(Math.max(0, sumSq / n - mean * mean));

  // Central-difference luminance gradient; borders use forward difference.
  let edgeSum = 0;
  let maxEdge = 0;
  let edgeCount = 0;
  const at = (x: number, y: number) => lum[y * w + x];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const gx =
        x > 0 && x < w - 1
          ? (at(x + 1, y) - at(x - 1, y)) / 2
          : x < w - 1
            ? at(x + 1, y) - at(x, y)
            : at(x, y) - at(x - 1, y);
      const gy =
        y > 0 && y < h - 1
          ? (at(x, y + 1) - at(x, y - 1)) / 2
          : y < h - 1
            ? at(x, y + 1) - at(x, y)
            : at(x, y) - at(x, y - 1);
      const g = Math.abs(gx) + Math.abs(gy);
      edgeSum += g;
      if (g > maxEdge) maxEdge = g;
      edgeCount += 1;
    }
  }
  const edgeEnergy = edgeCount > 0 ? Math.min(1, edgeSum / edgeCount / 255) : 0;

  // Blockiness: share of total horizontal gradient that falls on block
  // boundaries for the best-fitting block size. Real pixelation concentrates
  // its gradient on a regular grid; blur and text do not.
  let best = { share: 0, size: 0 };
  for (const b of PIXEL_BLOCK_SIZES) {
    if (b * 2 > w || b * 2 > h) continue;
    let boundary = 0;
    let total = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 1; x < w; x++) {
        const g = Math.abs(at(x, y) - at(x - 1, y));
        total += g;
        if (x % b === 0) boundary += g;
      }
    }
    for (let y = 1; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const g = Math.abs(at(x, y) - at(x, y - 1));
        total += g;
        if (y % b === 0) boundary += g;
      }
    }
    const share = total > 0 ? boundary / total : 0;
    if (share > best.share) best = { share, size: b };
  }

  return {
    uniformity: nearMean / n,
    edgeEnergy,
    maxEdge: Math.min(1, maxEdge / 255),
    stddev,
    alphaMin,
    translucentFraction: translucent / n,
    blockiness: best,
    pixels: n,
  };
}

function classify(s: RegionStats): { kind: RegionKind; note: string } {
  const stats =
    `uniformity=${s.uniformity.toFixed(3)} stddev=${s.stddev.toFixed(1)} ` +
    `edgeEnergy=${s.edgeEnergy.toFixed(3)} maxEdge=${s.maxEdge.toFixed(3)} ` +
    `alphaMin=${s.alphaMin}`;

  if (s.alphaMin < TRANSLUCENT_ALPHA && (s.translucentFraction > TRANSLUCENT_FRACTION || s.alphaMin < 128)) {
    const pct = (s.translucentFraction * 100).toFixed(1);
    return {
      kind: "translucent",
      note: `semi-transparent pixels remain (${pct}% of region below alpha ${TRANSLUCENT_ALPHA}); ${stats}`,
    };
  }
  if (s.uniformity >= UNIFORM_THRESHOLD) {
    return { kind: "uniform", note: `opaque solid fill; ${stats}` };
  }
  if (s.blockiness.share >= PIXELATION_BOUNDARY_SHARE && s.edgeEnergy > BLUR_MEAN_EDGE) {
    return {
      kind: "pixelated",
      note: `gradient concentrates on a ${s.blockiness.size}px grid (share=${s.blockiness.share.toFixed(2)}); ${stats}`,
    };
  }
  if (s.edgeEnergy <= BLUR_MEAN_EDGE && s.maxEdge <= BLUR_MAX_EDGE && s.stddev > FLAT_STDDEV) {
    return { kind: "blurred", note: `low-frequency content, no sharp edges; ${stats}` };
  }
  return { kind: "unknown", note: `unclassified region; ${stats}` };
}

/**
 * Classify each region of `src`. Degenerate or fully out-of-bounds boxes
 * come back as `unknown` rather than being dropped, so callers can report them.
 */
export function checkRegions(src: Raster, regions: BBox[]): RegionCheck[] {
  return regions.map((bbox) => {
    const box = clampBox(bbox, src.width, src.height);
    if (!box) {
      return {
        bbox,
        kind: "unknown",
        uniformity: 0,
        edgeEnergy: 0,
        alphaMin: 255,
        note: "empty or out-of-bounds region",
      };
    }
    const s = measure(src, box);
    const { kind, note } = classify(s);
    return { bbox: box, kind, uniformity: s.uniformity, edgeEnergy: s.edgeEnergy, alphaMin: s.alphaMin, note };
  });
}

const CANDIDATE_CELL = 8;
const CANDIDATE_MIN_CELLS = 2;

/**
 * Scan `src` for regions that look like redaction attempts: flat areas whose
 * color departs from the image's dominant background, plus any area with
 * meaningful transparency. Returns bounding boxes only — run them through
 * `checkRegions` for classification.
 */
export function findCandidateRegions(src: Raster): BBox[] {
  const { width, height, data } = src;
  if (width <= 0 || height <= 0 || data.length < width * height * 4) return [];

  // Global dominant color: average over a strided sample.
  const step = Math.max(1, Math.floor((width * height) / 4096));
  let br = 0;
  let bg = 0;
  let bb = 0;
  let samples = 0;
  for (let p = 0; p < width * height; p += step) {
    br += data[p * 4];
    bg += data[p * 4 + 1];
    bb += data[p * 4 + 2];
    samples += 1;
  }
  br /= samples;
  bg /= samples;
  bb /= samples;

  const cols = Math.ceil(width / CANDIDATE_CELL);
  const rows = Math.ceil(height / CANDIDATE_CELL);
  const flagged = new Uint8Array(cols * rows);

  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      const x0 = cx * CANDIDATE_CELL;
      const y0 = cy * CANDIDATE_CELL;
      const x1 = Math.min(width, x0 + CANDIDATE_CELL);
      const y1 = Math.min(height, y0 + CANDIDATE_CELL);
      let mr = 0;
      let mg = 0;
      let mb = 0;
      let translucent = 0;
      const n = (x1 - x0) * (y1 - y0);
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * width + x) * 4;
          mr += data[i];
          mg += data[i + 1];
          mb += data[i + 2];
          if (data[i + 3] < TRANSLUCENT_ALPHA) translucent += 1;
        }
      }
      mr /= n;
      mg /= n;
      mb /= n;
      if (translucent / n > 0.5) {
        flagged[cy * cols + cx] = 1;
        continue;
      }
      // Flat cell whose color differs from the global background.
      const dr = mr - br;
      const dg = mg - bg;
      const db = mb - bb;
      if (Math.sqrt(dr * dr + dg * dg + db * db) <= UNIFORM_TOLERANCE * 2) continue;
      let flat = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * width + x) * 4;
          const er = data[i] - mr;
          const eg = data[i + 1] - mg;
          const eb = data[i + 2] - mb;
          if (Math.sqrt(er * er + eg * eg + eb * eb) <= UNIFORM_TOLERANCE) flat += 1;
        }
      }
      if (flat / n >= UNIFORM_THRESHOLD) flagged[cy * cols + cx] = 1;
    }
  }

  // Connected components over flagged cells (8-connectivity).
  const seen = new Uint8Array(cols * rows);
  const boxes: BBox[] = [];
  for (let start = 0; start < flagged.length; start++) {
    if (!flagged[start] || seen[start]) continue;
    let minCx = cols;
    let minCy = rows;
    let maxCx = -1;
    let maxCy = -1;
    let cells = 0;
    const stack = [start];
    seen[start] = 1;
    while (stack.length) {
      const c = stack.pop()!;
      const cx = c % cols;
      const cy = (c / cols) | 0;
      cells += 1;
      if (cx < minCx) minCx = cx;
      if (cx > maxCx) maxCx = cx;
      if (cy < minCy) minCy = cy;
      if (cy > maxCy) maxCy = cy;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
          const ni = ny * cols + nx;
          if (flagged[ni] && !seen[ni]) {
            seen[ni] = 1;
            stack.push(ni);
          }
        }
      }
    }
    if (cells < CANDIDATE_MIN_CELLS) continue;
    boxes.push({
      x0: minCx * CANDIDATE_CELL,
      y0: minCy * CANDIDATE_CELL,
      x1: Math.min(width, (maxCx + 1) * CANDIDATE_CELL),
      y1: Math.min(height, (maxCy + 1) * CANDIDATE_CELL),
    });
  }
  return boxes;
}
