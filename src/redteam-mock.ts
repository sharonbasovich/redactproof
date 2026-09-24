/**
 * TEMPORARY UI-side mock of the red-team engine contract.
 *
 * Mirrors the shared spec implemented on branch codex/redactproof-redteam-engine:
 * when src/redteam/{types,attack,grade}.ts lands, every import of this file
 * swaps to the real modules unchanged — the signatures here match the agreed
 * contract exactly.
 *
 *   Raster = { width, height, data: Uint8ClampedArray RGBA }
 *   applyAttack(src, id, regions?)
 *   runAttacks(src, { variants?, onProgress?, signal? })
 *     -> { variants, hits, recoveredWords, elapsedMs }
 *   hits carry the attack ID plus a Detection (src/types.ts)
 *   grade() -> A/B/C/F with reasons
 *
 * The mock substitutes two stand-in variants (identity + an enhanced-2x pass
 * standing in for 'upscale-sharpen') so the UI can be built and exercised end
 * to end before the real attack transforms arrive. All exports are @mock.
 */
import { assessOcrQuality, detectSensitive, type OcrQuality } from "./detect";
import { recognize } from "./ocr";
import { enhanceContrast, upscale2x } from "./preprocess";
import { dedupeHits } from "./verify";
import type { Detection } from "./types";

export interface Raster {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export type AttackId =
  | "identity"
  | "levels-stretch"
  | "gamma-lift"
  | "gamma-drop"
  | "invert"
  | "channel-max"
  | "upscale-sharpen";

export interface RedteamHit {
  attackId: AttackId;
  detection: Detection;
  /** Every variant that flagged this region (dedupe merges single ids). */
  attackIds?: AttackId[];
}

export interface AttackVariantResult {
  id: AttackId;
  hits: number;
}

export interface AttackRunResult {
  variants: AttackVariantResult[];
  hits: RedteamHit[];
  recoveredWords: number;
  elapsedMs: number;
  /** @mock extension: identity-pass OCR quality, for status/grading. */
  ocrQuality: OcrQuality;
}

export type OcrSource = Parameters<typeof recognize>[0];

/**
 * Pixels plus a way back to something OCR can read. The UI supplies these
 * doors (canvas-backed in the browser); attack code only sees Raster + doors.
 */
export interface RasterDoors {
  /** Feed an arbitrary raster to OCR (attack output or the original). */
  ocrInputFor(src: Raster): OcrSource;
}

export interface RunAttacksOptions {
  /** Subset of attacks to run; default = every variant the engine offers. */
  variants?: AttackId[];
  onProgress?: (attackId: AttackId, fraction: number) => void;
  signal?: AbortSignal;
}

/** Attack variants the mock can actually produce. */
const MOCK_VARIANTS: AttackId[] = ["identity", "upscale-sharpen"];

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
}

/**
 * @mock Sequential OCR over stand-in variants: identity, then a
 * contrast-stretched 2x upscale standing in for 'upscale-sharpen' (bboxes are
 * mapped back to original coordinates, like a real attack would). Hits are
 * deduped across variants and keep every attackId that found them.
 */
export async function runAttacks(
  src: Raster,
  doors: RasterDoors,
  opts: RunAttacksOptions = {},
): Promise<AttackRunResult> {
  const t0 = performance.now();
  const requested = opts.variants ?? MOCK_VARIANTS;
  const variants: AttackVariantResult[] = [];
  const allHits: RedteamHit[] = [];
  let recoveredWords = 0;
  let ocrQuality: OcrQuality = { wordCount: 0, meanConfidence: 0, suspicious: true };

  for (const id of requested) {
    throwIfAborted(opts.signal);
    if (!MOCK_VARIANTS.includes(id)) continue; // honest: mock skips what it can't do
    let input: OcrSource;
    let scale = 1;
    if (id === "identity") {
      input = doors.ocrInputFor(src);
    } else {
      // 'upscale-sharpen' stand-in: contrast stretch + 2x nearest-neighbor
      input = doors.ocrInputFor(upscale2x(enhanceContrast(src)));
      scale = 2;
    }
    const res = await recognize(input, (_s, p) => opts.onProgress?.(id, p));
    if (id === "identity") {
      recoveredWords = res.words.length;
      ocrQuality = assessOcrQuality(res.words);
    }
    const hits = detectSensitive(res.words).map<RedteamHit>((d) => ({
      attackId: id,
      detection: {
        ...d,
        bbox:
          scale === 1
            ? d.bbox
            : {
                x0: d.bbox.x0 / scale,
                y0: d.bbox.y0 / scale,
                x1: d.bbox.x1 / scale,
                y1: d.bbox.y1 / scale,
              },
      },
    }));
    variants.push({ id, hits: hits.length });
    allHits.push(...hits);
  }

  return {
    variants,
    hits: dedupeAcrossAttacks(allHits),
    recoveredWords,
    elapsedMs: Math.round(performance.now() - t0),
    ocrQuality,
  };
}

/** Merge hits the same pattern produced across variants; union attackIds. */
function dedupeAcrossAttacks(hits: RedteamHit[]): RedteamHit[] {
  const asVerify = hits.map((h) => ({
    category: h.detection.category,
    rule: h.detection.rule,
    confidence: h.detection.confidence,
    bbox: h.detection.bbox,
    attackIds: [h.attackId],
  }));
  return dedupeHits(asVerify).map((h) => ({
    attackId: h.attackIds[0] as AttackId,
    attackIds: h.attackIds as AttackId[],
    detection: {
      category: h.category,
      rule: h.rule,
      text: "", // @mock: real engine supplies recovered text; UI masks it anyway
      confidence: h.confidence,
      wordIndices: [],
      bbox: h.bbox,
    },
  }));
}

export interface AttackGrade {
  letter: "A" | "B" | "C" | "F";
  reasons: string[];
}

/**
 * @mock Placeholder grade — honest by construction, never an A:
 *   F  any supported pattern was recovered despite the cover-up
 *   C  nothing found, but the image barely OCR'd (absence can't be confirmed)
 *   B  nothing found and OCR was healthy — still "not flagged", not "safe"
 * The real grade() may redefine letters; the UI renders letter + reasons only.
 */
export function grade(run: AttackRunResult, ocrSuspicious: boolean): AttackGrade {
  if (run.hits.length > 0) {
    return {
      letter: "F",
      reasons: [
        `${run.hits.length} supported pattern${run.hits.length === 1 ? "" : "s"} ` +
          `recovered under the cover-up`,
        "Opaque burn + re-check recommended before sharing",
      ],
    };
  }
  if (ocrSuspicious) {
    return {
      letter: "C",
      reasons: [
        "Nothing recovered, but OCR read this image poorly —",
        "absence of a hit can't be confirmed; try more variants and eyeball it",
      ],
    };
  }
  return {
    letter: "B",
    reasons: [
      "Not flagged by these checks — not the same as safe:",
      "names, addresses, handwriting, QR/barcodes were never tested",
    ],
  };
}
