import { describe, expect, it } from "vitest";
import {
  assessOcrQuality,
  detectSensitive,
  groupLines,
  isSupportedImageType,
  knownCardPrefix,
  luhnCheck,
} from "../src/detect";
import type { OcrWord } from "../src/types";

/** Build a single-line word stream like OCR would emit. */
function words(text: string, lineId = 0): OcrWord[] {
  let x = 0;
  return text.split(" ").map((t) => {
    const w = t.length * 10;
    const word: OcrWord = {
      text: t,
      confidence: 0.95,
      lineId,
      bbox: { x0: x, y0: 0, x1: x + w, y1: 20 },
    };
    x += w + 10;
    return word;
  });
}

describe("luhnCheck", () => {
  it.each([
    ["4111111111111111", true], // test Visa
    ["5555555555554444", true], // test Mastercard
    ["378282246310005", true], // test Amex
    ["6011111111111117", true], // test Discover
    ["4111111111111112", false], // one digit off
    ["1234567890123456", false],
    ["", false],
    ["411a", false],
  ])("luhn(%s) === %s", (digits, expected) => {
    expect(luhnCheck(digits)).toBe(expected);
  });

  it("recognizes known card prefixes", () => {
    expect(knownCardPrefix("4111111111111111")).toBe(true);
    expect(knownCardPrefix("5555555555554444")).toBe(true);
    expect(knownCardPrefix("378282246310005")).toBe(true);
    expect(knownCardPrefix("9999999999999999")).toBe(false);
  });
});

describe("groupLines", () => {
  it("clusters words without lineId by vertical position", () => {
    const top = { text: "a", confidence: 1, bbox: { x0: 0, y0: 0, x1: 10, y1: 12 } };
    const top2 = { text: "b", confidence: 1, bbox: { x0: 20, y0: 1, x1: 30, y1: 13 } };
    const bottom = { text: "c", confidence: 1, bbox: { x0: 0, y0: 40, x1: 10, y1: 52 } };
    const lines = groupLines([bottom, top, top2]);
    expect(lines).toHaveLength(2);
    expect(lines[0].map((w) => w.text)).toEqual(["a", "b"]);
    expect(lines[1].map((w) => w.text)).toEqual(["c"]);
  });
});

describe("detectSensitive", () => {
  it("finds an email", () => {
    const hits = detectSensitive(words("Contact jane.public@example.com today"));
    expect(hits).toHaveLength(1);
    expect(hits[0].category).toBe("email");
    expect(hits[0].text).toBe("jane.public@example.com");
  });

  it("finds a spaced payment card number and validates Luhn", () => {
    const hits = detectSensitive(words("Card: 4111 1111 1111 1111 exp 12/29"));
    expect(hits.filter((h) => h.category === "payment-card")).toHaveLength(1);
    expect(hits[0].rule).toBe("luhn+prefix");
  });

  it("finds a dashed card number", () => {
    const hits = detectSensitive(words("Backup 5555-5555-5555-4444 thanks"));
    expect(hits[0]?.category).toBe("payment-card");
  });

  it("rejects a digit string that fails Luhn", () => {
    const hits = detectSensitive(words("Ref 4111 1111 1111 1112 noted"));
    expect(hits.filter((h) => h.category === "payment-card")).toHaveLength(0);
  });

  it("finds a phone number", () => {
    const hits = detectSensitive(words("Call (416) 555-0142 please"));
    expect(hits.some((h) => h.category === "phone")).toBe(true);
  });

  it("does not double-report phone digits inside a card", () => {
    const hits = detectSensitive(words("Card 4111 1111 1111 1111"));
    expect(hits.filter((h) => h.category === "phone")).toHaveLength(0);
  });

  it("finds a Canadian postal code and US ZIP+4", () => {
    const hits = detectSensitive(words("Lives at M5V 3L9 or 94107-1234"));
    const cats = hits.map((h) => h.text.replace(" ", ""));
    expect(cats).toContain("M5V3L9");
    expect(cats).toContain("94107-1234");
  });

  it("finds an SSN but rejects invalid ranges", () => {
    const good = detectSensitive(words("SSN 078-05-1120 on file"));
    expect(good.some((h) => h.category === "ssn")).toBe(true);
    const bad = detectSensitive(words("SSN 000-12-3456 on file"));
    expect(bad.some((h) => h.category === "ssn")).toBe(false);
  });

  it("finds a valid IPv4 and rejects bad octets", () => {
    const good = detectSensitive(words("Gateway 203.0.113.42 logged"));
    expect(good.some((h) => h.category === "ipv4")).toBe(true);
    const bad = detectSensitive(words("Version 1.2.300.4 released"));
    expect(bad.some((h) => h.category === "ipv4")).toBe(false);
  });

  it("finds a JWT-shaped token", () => {
    const hits = detectSensitive(
      words("token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJkZW1vIn0.SflKxwRJSMeKKF2QT4fwpMeJ here"),
    );
    expect(hits.some((h) => h.category === "jwt")).toBe(true);
  });

  it("leaves ordinary money and invoice text alone", () => {
    const hits = detectSensitive(words("Order total: $1,204.55 Ref: INV-004821"));
    expect(hits).toHaveLength(0);
  });

  it("covers every word of a multi-word card with the union bbox", () => {
    const ws = words("Pay 4111 1111 1111 1111 now");
    const hits = detectSensitive(ws);
    const card = hits.find((h) => h.category === "payment-card")!;
    expect(card.wordIndices).toEqual([1, 2, 3, 4]);
    expect(card.bbox.x0).toBeLessThanOrEqual(ws[1].bbox.x0);
    expect(card.bbox.x1).toBeGreaterThanOrEqual(ws[4].bbox.x1);
  });
});

describe("assessOcrQuality", () => {
  const mk = (n: number, conf: number): OcrWord[] =>
    Array.from({ length: n }, (_, i) => ({
      text: `w${i}`,
      confidence: conf,
      bbox: { x0: i * 20, y0: 0, x1: i * 20 + 10, y1: 10 },
    }));

  it("flags too-little-text output as suspicious", () => {
    expect(assessOcrQuality(mk(5, 0.9)).suspicious).toBe(true);
    expect(assessOcrQuality([]).suspicious).toBe(true);
  });

  it("flags low-confidence output as suspicious", () => {
    expect(assessOcrQuality(mk(50, 0.3)).suspicious).toBe(true);
  });

  it("accepts healthy OCR output", () => {
    const q = assessOcrQuality(mk(50, 0.9));
    expect(q.suspicious).toBe(false);
    expect(q.wordCount).toBe(50);
    expect(q.meanConfidence).toBeCloseTo(0.9);
  });
});

describe("isSupportedImageType", () => {
  it("accepts PNG and JPEG", () => {
    expect(isSupportedImageType("image/png", "a.png")).toBe(true);
    expect(isSupportedImageType("image/jpeg", "a.jpg")).toBe(true);
  });

  it("rejects PDF and other types", () => {
    expect(isSupportedImageType("application/pdf", "scan.pdf")).toBe(false);
    expect(isSupportedImageType("image/gif", "a.gif")).toBe(false);
    expect(isSupportedImageType("text/plain", "a.txt")).toBe(false);
  });

  it("falls back to extension for octet-stream", () => {
    expect(isSupportedImageType("application/octet-stream", "shot.png")).toBe(true);
    expect(isSupportedImageType("application/octet-stream", "doc.pdf")).toBe(false);
  });
});
