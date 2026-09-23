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

export interface AuditReport {
  tool: "RedactProof";
  toolVersion: string;
  generatedAt: string; // ISO 8601
  input: {
    fileName: string;
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
