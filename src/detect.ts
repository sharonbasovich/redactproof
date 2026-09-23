import type { BBox, Detection, DetectorCategory, OcrWord } from "./types";

/** Padding (px) added around detected text when building a redaction box. */
export const BOX_PAD = 5;

export function luhnCheck(digits: string): boolean {
  if (!/^\d+$/.test(digits)) return false;
  let sum = 0;
  let dbl = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (dbl) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    dbl = !dbl;
  }
  return sum % 10 === 0;
}

/** Known card-network prefixes (BIN/IIN). Used to boost confidence, not required. */
export function knownCardPrefix(digits: string): boolean {
  return (
    /^4/.test(digits) || // Visa
    /^(5[1-5]|2[2-7])/.test(digits) || // Mastercard (51-55, 2221-2720 approx)
    /^3[47]/.test(digits) || // Amex
    /^6(?:011|5)/.test(digits) || // Discover
    /^35(?:2[89]|[3-8])/.test(digits) || // JCB
    /^3(?:0[0-5]|[68])/.test(digits) // Diners
  );
}

interface LineSpan {
  start: number; // char offset in joined line text
  end: number;
  wordIndices: number[];
}

interface LineCtx {
  words: OcrWord[]; // global words, referenced by index
  indices: number[]; // global word indices in this line, in order
  text: string;
  /** charOffset[i] -> index into `indices` (the word that char belongs to) */
  charToSlot: Int32Array;
}

/**
 * Group words into reading-order lines. Uses OCR line ids when present;
 * otherwise clusters by vertical overlap.
 */
export function groupLines(words: OcrWord[]): OcrWord[][] {
  if (words.length === 0) return [];
  const byId = new Map<number, OcrWord[]>();
  const noId: OcrWord[] = [];
  words.forEach((w) => {
    if (w.lineId !== undefined) {
      const arr = byId.get(w.lineId) ?? [];
      arr.push(w);
      byId.set(w.lineId, arr);
    } else noId.push(w);
  });
  const lines = [...byId.values()];
  if (noId.length === words.length) {
    // No line ids at all: cluster by horizontal-band overlap.
    const sorted = [...words].sort((a, b) => a.bbox.y0 - b.bbox.y0);
    const clusters: OcrWord[][] = [];
    for (const w of sorted) {
      const midY = (w.bbox.y0 + w.bbox.y1) / 2;
      const cluster = clusters.find((c) => {
        const ys = c.map((o) => [o.bbox.y0, o.bbox.y1]);
        const y0 = Math.min(...ys.map((y) => y[0]));
        const y1 = Math.max(...ys.map((y) => y[1]));
        return midY >= y0 && midY <= y1;
      });
      if (cluster) cluster.push(w);
      else clusters.push([w]);
    }
    for (const c of clusters) c.sort((a, b) => a.bbox.x0 - b.bbox.x0);
    clusters.sort(
      (a, b) => Math.min(...a.map((w) => w.bbox.y0)) - Math.min(...b.map((w) => w.bbox.y0)),
    );
    return clusters;
  }
  // Mixed: put un-tagged words each on their own line.
  return [...lines, ...noId.map((w) => [w])];
}

function buildLineCtx(lineWords: OcrWord[], allWords: OcrWord[]): LineCtx {
  const indexOf = new Map<OcrWord, number>();
  allWords.forEach((w, i) => indexOf.set(w, i));
  const indices = lineWords.map((w) => indexOf.get(w) ?? -1);
  const parts: string[] = [];
  const positions: number[] = [];
  let offset = 0;
  for (const w of lineWords) {
    positions.push(offset);
    parts.push(w.text);
    offset += w.text.length + 1; // +1 for joining space
  }
  const text = parts.join(" ");
  const charToSlot = new Int32Array(text.length).fill(-1);
  lineWords.forEach((w, slot) => {
    const s = positions[slot];
    for (let c = 0; c < w.text.length; c++) charToSlot[s + c] = slot;
  });
  return { words: allWords, indices, text, charToSlot };
}

function spanToWords(ctx: LineCtx, start: number, end: number): LineSpan {
  const wordIndices = new Set<number>();
  for (let c = start; c < end && c < ctx.charToSlot.length; c++) {
    const slot = ctx.charToSlot[c];
    if (slot >= 0) {
      const gi = ctx.indices[slot];
      if (gi >= 0) wordIndices.add(gi);
    }
  }
  return { start, end, wordIndices: [...wordIndices] };
}

export function unionBBox(boxes: BBox[], pad = 0): BBox {
  const b: BBox = {
    x0: Math.min(...boxes.map((x) => x.x0)),
    y0: Math.min(...boxes.map((x) => x.y0)),
    x1: Math.max(...boxes.map((x) => x.x1)),
    y1: Math.max(...boxes.map((x) => x.y1)),
  };
  return { x0: b.x0 - pad, y0: b.y0 - pad, x1: b.x1 + pad, y1: b.y1 + pad };
}

function bboxForSpan(ctx: LineCtx, span: LineSpan): BBox {
  return unionBBox(
    span.wordIndices.map((i) => ctx.words[i].bbox),
    BOX_PAD,
  );
}

function avgConfidence(ctx: LineCtx, span: LineSpan): number {
  if (span.wordIndices.length === 0) return 0.5;
  const sum = span.wordIndices.reduce((s, i) => s + ctx.words[i].confidence, 0);
  return sum / span.wordIndices.length;
}

interface PatternSpec {
  category: DetectorCategory;
  rule: string;
  regex: RegExp;
  /** validate captured text; return extra rule suffix or null to reject */
  validate?: (matched: string) => string | null;
  baseConfidence: number;
}

const CARD_RE = /(?<![\d])\d(?:[ -]?\d){11,18}(?![\d])/g;
const PATTERNS: PatternSpec[] = [
  {
    category: "payment-card",
    rule: "digits",
    regex: CARD_RE,
    baseConfidence: 0.85,
    validate: (m) => {
      const digits = m.replace(/[^\d]/g, "");
      if (digits.length < 13 || digits.length > 19) return null;
      if (!luhnCheck(digits)) return null;
      return knownCardPrefix(digits) ? "luhn+prefix" : "luhn";
    },
  },
  {
    category: "email",
    rule: "rfc5322-lite",
    regex: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g,
    baseConfidence: 0.95,
  },
  {
    category: "jwt",
    rule: "jwt-shape",
    regex: /eyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}/g,
    baseConfidence: 0.9,
  },
  {
    category: "ssn",
    rule: "ssn-dashes",
    regex: /\b\d{3}-\d{2}-\d{4}\b/g,
    baseConfidence: 0.85,
    validate: (m) => {
      const [a, g, s] = m.split("-").map(Number);
      if (a === 0 || g === 0 || s === 0) return null;
      if (a === 666 || a >= 900) return null;
      return "ssn-dashes";
    },
  },
  {
    category: "phone",
    rule: "nanp",
    regex: /(?<![\d])(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}(?![\d])/g,
    baseConfidence: 0.75,
  },
  {
    category: "ipv4",
    rule: "ipv4-octets",
    regex: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
    baseConfidence: 0.8,
    validate: (m) => {
      const ok = m.split(".").every((o) => o.length > 0 && Number(o) <= 255 && !/^0\d/.test(o));
      return ok ? "ipv4-octets" : null;
    },
  },
  {
    category: "postal-code",
    rule: "ca-postal",
    regex: /\b[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z] ?\d[ABCEGHJ-NPRSTV-Z]\d\b/gi,
    baseConfidence: 0.7,
  },
  {
    category: "postal-code",
    rule: "us-zip4",
    regex: /\b\d{5}-\d{4}\b/g,
    baseConfidence: 0.7,
  },
];

/**
 * Run all detectors over OCR words. Words must be the same array passed to
 * groupLines (detections reference indices into it).
 *
 * Detections are line-scoped: patterns that span multiple words (e.g.
 * "4111 1111 1111 1111") are found on the joined line text and mapped back
 * to the covering words. Categories run in priority order; a span of
 * characters already claimed by a higher-priority match is not re-reported,
 * which prevents e.g. a phone pattern double-reporting inside a card number.
 */
export function detectSensitive(words: OcrWord[]): Detection[] {
  const detections: Detection[] = [];
  for (const lineWords of groupLines(words)) {
    const ctx = buildLineCtx(lineWords, words);
    const claimed: Array<[number, number]> = [];
    const overlapsClaimed = (s: number, e: number) =>
      claimed.some(([cs, ce]) => s < ce && e > cs);

    for (const p of PATTERNS) {
      p.regex.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = p.regex.exec(ctx.text)) !== null) {
        if (m[0].length === 0) {
          p.regex.lastIndex++;
          continue;
        }
        const start = m.index;
        const end = m.index + m[0].length;
        if (overlapsClaimed(start, end)) continue;
        const ruleSuffix = p.validate ? p.validate(m[0]) : p.rule;
        if (ruleSuffix === null) continue;
        const span = spanToWords(ctx, start, end);
        if (span.wordIndices.length === 0) continue;
        claimed.push([start, end]);
        const ocrConf = avgConfidence(ctx, span);
        detections.push({
          category: p.category,
          rule: ruleSuffix,
          text: m[0],
          confidence: p.baseConfidence * (0.4 + 0.6 * Math.min(1, Math.max(0, ocrConf))),
          wordIndices: span.wordIndices,
          bbox: bboxForSpan(ctx, span),
        });
      }
    }
  }
  // Sort in reading order for stable review UI.
  detections.sort(
    (a, b) => a.bbox.y0 - b.bbox.y0 || a.bbox.x0 - b.bbox.x0,
  );
  return detections;
}

export interface OcrQuality {
  wordCount: number;
  meanConfidence: number; // 0-1
  suspicious: boolean; // true when OCR output is too thin/fuzzy to trust
}

/**
 * Sanity-check OCR output before showing a "nothing found" state: dark,
 * low-resolution, or non-text images produce few words or low confidences,
 * in which case "no detections" is unreliable.
 */
export function assessOcrQuality(words: OcrWord[]): OcrQuality {
  const wordCount = words.length;
  const meanConfidence = wordCount
    ? words.reduce((s, w) => s + w.confidence, 0) / wordCount
    : 0;
  const suspicious = wordCount < 15 || meanConfidence < 0.55;
  return { wordCount, meanConfidence, suspicious };
}

/** Accepted upload types (PDFs are rejected — render to PNG first). */
export function isSupportedImageType(mime: string, fileName: string): boolean {
  if (mime === "image/png" || mime === "image/jpeg") return true;
  if (!mime || mime === "application/octet-stream") {
    return /\.(png|jpe?g)$/i.test(fileName);
  }
  return false;
}
