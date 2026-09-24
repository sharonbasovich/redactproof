import { describe, expect, it } from "vitest";
import { inspectMetadata } from "../../src/redteam/metadata";
import { makeJpeg, makePng } from "./fixtures";

describe("inspectMetadata (JPEG)", () => {
  it("detects EXIF without GPS", () => {
    const r = inspectMetadata(makeJpeg({ exif: true }), "image/jpeg");
    expect(r.hasExif).toBe(true);
    expect(r.hasGps).toBe(false);
    expect(r.hasXmp).toBe(false);
    expect(r.bytesStripped).toBeGreaterThan(0);
  });

  it("detects GPS via the GPS Info IFD pointer", () => {
    const r = inspectMetadata(makeJpeg({ gps: true }), "image/jpeg");
    expect(r.hasExif).toBe(true);
    expect(r.hasGps).toBe(true);
  });

  it("detects XMP in an APP1 segment", () => {
    const r = inspectMetadata(makeJpeg({ xmp: true }), "image/jpeg");
    expect(r.hasXmp).toBe(true);
    expect(r.hasExif).toBe(false);
  });

  it("reports a clean JPEG as metadata-free", () => {
    const r = inspectMetadata(makeJpeg({}), "image/jpeg");
    expect(r.hasExif).toBe(false);
    expect(r.hasGps).toBe(false);
    expect(r.hasXmp).toBe(false);
    expect(r.bytesStripped).toBe(0);
  });
});

describe("inspectMetadata (PNG)", () => {
  it("collects tEXt/zTXt/iTXt keyword names, not values", () => {
    const r = inspectMetadata(
      makePng({
        text: [
          { type: "tEXt", key: "Author", value: "Jane Public" },
          { type: "zTXt", key: "Comment", value: "secret note" },
          { type: "iTXt", key: "Description", value: "internal" },
        ],
      }),
      "image/png",
    );
    expect(r.pngTextChunks).toEqual(["Author", "Comment", "Description"]);
    expect(r.pngTextChunks.join(" ")).not.toContain("Jane Public");
    expect(r.bytesStripped).toBeGreaterThan(0);
  });

  it("deduplicates repeated keywords", () => {
    const r = inspectMetadata(
      makePng({
        text: [
          { type: "tEXt", key: "Author", value: "a" },
          { type: "tEXt", key: "Author", value: "b" },
        ],
      }),
      "image/png",
    );
    expect(r.pngTextChunks).toEqual(["Author"]);
  });

  it("detects eXIf chunks and GPS inside them", () => {
    const r = inspectMetadata(makePng({ gps: true }), "image/png");
    expect(r.hasExif).toBe(true);
    expect(r.hasGps).toBe(true);
  });

  it("detects XMP stored as an iTXt chunk", () => {
    const r = inspectMetadata(makePng({ xmp: true }), "image/png");
    expect(r.hasXmp).toBe(true);
    expect(r.pngTextChunks).toContain("XML:com.adobe.xmp");
  });

  it("reports a bare PNG as metadata-free", () => {
    const r = inspectMetadata(makePng({}), "image/png");
    expect(r.hasExif).toBe(false);
    expect(r.pngTextChunks).toEqual([]);
    expect(r.bytesStripped).toBe(0);
  });
});

describe("inspectMetadata (format handling)", () => {
  it("returns null bytesStripped for unrecognized input", () => {
    const r = inspectMetadata(new Uint8Array([1, 2, 3, 4, 5]), "text/plain");
    expect(r.bytesStripped).toBeNull();
    expect(r.hasExif).toBe(false);
    expect(r.hasGps).toBe(false);
    expect(r.hasXmp).toBe(false);
    expect(r.pngTextChunks).toEqual([]);
  });

  it("lets magic bytes win over a wrong mime hint", () => {
    const png = makePng({ exif: true });
    const r = inspectMetadata(png, "image/jpeg");
    expect(r.hasExif).toBe(true);
    const jpg = makeJpeg({ exif: true });
    const r2 = inspectMetadata(jpg, "image/png");
    expect(r2.hasExif).toBe(true);
  });

  it("handles truncated input without throwing", () => {
    const png = makePng({ text: [{ type: "tEXt", key: "Author", value: "x".repeat(500) }] });
    expect(() => inspectMetadata(png.slice(0, 40), "image/png")).not.toThrow();
    expect(() => inspectMetadata(makeJpeg({ exif: true }).slice(0, 12), "image/jpeg")).not.toThrow();
    expect(() => inspectMetadata(new Uint8Array(0), "image/png")).not.toThrow();
  });
});
