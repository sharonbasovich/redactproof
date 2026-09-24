import type { AttackRunResult, RedTeamGrade, RedTeamGradeResult } from "./types";

/** Confidence below this counts as marginal recovery for grading. */
export const WEAK_HIT_CONFIDENCE = 0.5;

/**
 * Grade a finished attack run A/B/C/F — a red-team verdict on how much
 * of the redacted content survived:
 *
 *   F — hits on the untouched pixels (identity pass): plainly readable.
 *   C — hits only recoverable after enhancement attacks.
 *   B — marginal recovery: hits exist but every enhanced hit is weak.
 *   A — nothing recovered by any attack.
 *
 * The result is content-free by contract: reasons describe categories
 * and counts only — never recovered strings or the input filename.
 */
export function grade(result: AttackRunResult): RedTeamGradeResult {
  const baseline = result.hits.filter((h) => h.attacks.includes("identity"));
  const enhanced = result.hits.filter((h) =>
    h.attacks.every((a) => a !== "identity"),
  );
  const reasons: string[] = [];

  let g: RedTeamGrade;
  if (baseline.length > 0) {
    g = "F";
    reasons.push(
      `${baseline.length} sensitive hit${baseline.length === 1 ? "" : "s"} readable with no enhancement (plain OCR).`,
    );
    if (enhanced.length > 0) {
      reasons.push(
        `${enhanced.length} more hit${enhanced.length === 1 ? "" : "s"} surfaced after enhancement attacks.`,
      );
    }
  } else if (enhanced.length > 0) {
    const weak = enhanced.filter((h) => h.confidence < WEAK_HIT_CONFIDENCE);
    if (weak.length === enhanced.length) {
      g = "B";
      reasons.push(
        `Only marginal recovery: ${enhanced.length} low-confidence hit${enhanced.length === 1 ? "" : "s"} required enhancement attacks.`,
      );
    } else {
      g = "C";
      reasons.push(
        `${enhanced.length - weak.length} hit${enhanced.length - weak.length === 1 ? "" : "s"} recoverable only after image enhancement (translucent/faint redaction).`,
      );
      if (weak.length > 0) {
        reasons.push(`${weak.length} additional low-confidence hit${weak.length === 1 ? "" : "s"}.`);
      }
    }
  } else {
    g = "A";
    reasons.push("No sensitive content recovered by any attack pass.");
  }

  const categories = [...new Set(result.hits.map((h) => h.category))].sort();
  if (categories.length > 0) {
    reasons.push(`Categories recovered: ${categories.join(", ")}.`);
  }

  return {
    grade: g,
    reasons,
    baselineHits: baseline.length,
    enhancedHits: enhanced.length,
    recoveredWords: result.recoveredWords,
  };
}
