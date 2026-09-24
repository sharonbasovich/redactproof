export interface BBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface OcrWord {
  text: string;
  bbox: BBox;
  confidence: number; // 0-1
  lineId?: number; // OCR-provided line id, if any
}

export type DetectorCategory =
  | "email"
  | "phone"
  | "payment-card"
  | "postal-code"
  | "ssn"
  | "ipv4"
  | "jwt";

export interface Detection {
  category: DetectorCategory;
  rule: string; // short rule name, e.g. "luhn+prefix"
  text: string; // matched text (used only transiently; never written to the audit report)
  confidence: number; // 0-1
  wordIndices: number[]; // indices into the scanned word array
  bbox: BBox;
}

export interface RedactionBox {
  id: string;
  bbox: BBox;
  category: DetectorCategory | "manual";
  rule: string;
  confidence: number | null; // null for manual boxes
  enabled: boolean;
  source: "detector" | "manual";
}

export interface VerificationHit {
  category: DetectorCategory;
  rule: string;
  confidence: number;
  bbox: BBox;
}

/** A hit found while independently verifying an already-exported image. */
export interface VerifyHit extends VerificationHit {
  /** Attack/scan variants that produced this hit, e.g. ["identity", "upscale-sharpen"]. */
  attackIds: string[];
  /**
   * Recovered text, shown MASKED in the UI with a reveal toggle. Transient
   * only — it is never written to the audit report or any download.
   */
  text?: string;
}

export type VerifyStatus = "hits-found" | "no-hits" | "inconclusive";

/**
 * Audit for the standalone "verify an existing image" path. Deliberately
 * narrower than AuditReport: no redaction section (nothing was redacted
 * here), no filename, no detected strings — just what was checked and
 * how much trust to put in it.
 */
export interface VerifyReport {
  tool: "RedactProof";
  toolVersion: string;
  reportKind: "independent-image-verify";
  generatedAt: string; // ISO 8601
  image: {
    sha256: string;
    pixelWidth: number;
    pixelHeight: number;
  };
  check: {
    status: VerifyStatus;
    /** Engine/attack engine id that produced these results. */
    engine: string;
    /** Attack/scan variants that ran (identity plus any red-team variants). */
    attacksRun: string[];
    grade: { letter: "A" | "B" | "C" | "F"; reasons: string[] };
    ocrWords: number;
    ocrMeanConfidence: number;
    lowOcrConfidence: boolean;
    residualHits: number;
    hits: Array<{
      category: string;
      rule: string;
      confidence: number;
      bbox: BBox;
      attackIds: string[];
    }>;
  };
  /**
   * Set when this report describes a re-check of a file the user just fixed
   * in-app: provenance chain from the flagged image to the burned export.
   */
  fix?: {
    fromSha256: string;
    boxesBurned: number;
    priorStatus: VerifyStatus;
    priorHits: number;
  };
  detectorScope: string[];
  limitations: string;
}

export interface AuditReport {
  tool: "RedactProof";
  toolVersion: string;
  generatedAt: string; // ISO 8601
  input: {
    pixelWidth: number;
    pixelHeight: number;
  };
  output: {
    sha256: string;
    pixelWidth: number;
    pixelHeight: number;
  };
  redaction: {
    totalBoxes: number;
    manualBoxes: number;
    byCategory: Record<string, number>;
  };
  verification: {
    method: string;
    residualHits: number;
    hits: Array<{ category: string; rule: string; bbox: BBox }>;
    disclaimer: string;
  };
}
