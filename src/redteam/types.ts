import type { BBox, Detection } from "../types";

/**
 * Raw RGBA pixel buffer. `data` is exactly `width * height * 4` bytes,
 * row-major, 4 channels per pixel — the same shape as canvas ImageData
 * and pngjs rasters, so the attack engine runs identically in the
 * browser and in node tests.
 */
export interface Raster {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/**
 * The fixed set of recovery attacks. Each takes the (already-exported)
 * pixels and produces a transformed raster that is then re-OCR'd:
 *
 * - `identity`          baseline pass over the untouched pixels
 * - `levels-stretch`    luminance percentile stretch to full 0-255 range
 * - `gamma-lift`        gamma < 1, brightens shadows under dark overlays
 * - `gamma-drop`        gamma > 1, deepens faint marks under light overlays
 * - `invert`            channel inversion (white-out / negative overlays)
 * - `channel-max`       per-pixel max(R,G,B) — defeats single-channel colored
 *                       markers/highlights
 * - `upscale-sharpen`   2x upscale + unsharp mask for faint/small text
 * - `region-stretch`    localized recovery: redaction-looking regions are
 *                       auto-discovered (findCandidateRegions) and each gets
 *                       its own high-pass stretch — near-opaque (97%+)
 *                       markers that defeat every global transform leave a
 *                       1-3% residual the local histogram can still peel
 */
export type AttackId =
  | "identity"
  | "levels-stretch"
  | "gamma-lift"
  | "gamma-drop"
  | "invert"
  | "channel-max"
  | "upscale-sharpen"
  | "region-stretch";

export const ATTACK_IDS: readonly AttackId[] = [
  "identity",
  "levels-stretch",
  "gamma-lift",
  "gamma-drop",
  "invert",
  "channel-max",
  "upscale-sharpen",
  "region-stretch",
];

/** One transformed image produced by an attack pass. */
export interface AttackVariant {
  id: AttackId;
  raster: Raster;
}

/**
 * A detector hit surfaced by the attack engine. Carries the full
 * Detection (category/rule/confidence/bbox/wordIndices) plus the attack
 * that produced it. When hits are deduplicated across variants, `attack`
 * is the pass whose detection survived the merge and `attacks` lists
 * every variant that found it.
 *
 * `text` is transient OCR output: it must never be persisted into an
 * audit report or any other durable artifact.
 */
export interface AttackHit extends Detection {
  /** The attack variant this detection was taken from. */
  attack: AttackId;
  /** Every variant that reported a hit merged into this one. */
  attacks: AttackId[];
}

export interface AttackRunOptions {
  /** Subset/order of attacks to run; defaults to ATTACK_IDS. */
  variants?: AttackId[];
  /**
   * Optional regions to scope the attack to. When present, transforms
   * apply inside each region (expanded by a small context margin) and
   * pixels outside are copied through unchanged, so OCR still sees the
   * surrounding text context.
   */
  regions?: BBox[];
  /** Called after each variant finishes: (completed, total, lastFinished). */
  onProgress?: (done: number, total: number, finished: AttackId) => void;
  /** Abort between variants; the partial result is still returned. */
  signal?: AbortSignal;
}

export interface AttackRunResult {
  /** Every variant actually executed (empty entries are still included). */
  variants: AttackVariant[];
  /** Deduplicated hits across all executed variants. */
  hits: AttackHit[];
  /**
   * OCR words covered by hits found *only* by non-identity variants —
   * text that plain OCR could not see but an attack recovered.
   */
  recoveredWords: number;
  elapsedMs: number;
}

export type RedTeamGrade = "A" | "B" | "C" | "F";

/**
 * Outcome of grading one attack run. Content-free by contract: never
 * carries recovered text, matched strings, or the input filename.
 */
export interface RedTeamGradeResult {
  grade: RedTeamGrade;
  /** Human-readable explanations, ordered by importance. */
  reasons: string[];
  /** Hits found on the untouched pixels (worst case). */
  baselineHits: number;
  /** Hits only recoverable via enhancement attacks. */
  enhancedHits: number;
  recoveredWords: number;
}
