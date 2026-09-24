import type { BBox } from "../../src/types";
import type { Raster } from "../../src/redteam/analyze";

/** Synthetic byte/raster builders shared by the red-team tests. Everything is
 *  hand-constructed so fixtures stay dependency-free and fully deterministic. */

export type Rgba = [number, number, number, number];

export function makeRaster(width: number, height: number, fill: Rgba = [255, 255, 255, 255]): Raster {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = fill[0];
    data[i + 1] = fill[1];
    data[i + 2] = fill[2];
    data[i + 3] = fill[3];
  }
  return { width, height, data };
}

export function paintRect(raster: Raster, box: BBox, color: Rgba): void {
  for (let y = Math.max(0, box.y0); y < Math.min(raster.height, box.y1); y++) {
    for (let x = Math.max(0, box.x0); x < Math.min(raster.width, box.x1); x++) {
      const i = (y * raster.width + x) * 4;
      raster.data[i] = color[0];
      raster.data[i + 1] = color[1];
      raster.data[i + 2] = color[2];
      raster.data[i + 3] = color[3];
    }
  }
}

export function paintPixels(
  raster: Raster,
  box: BBox,
  fn: (x: number, y: number) => Rgba,
): void {
  for (let y = Math.max(0, box.y0); y < Math.min(raster.height, box.y1); y++) {
    for (let x = Math.max(0, box.x0); x < Math.min(raster.width, box.x1); x++) {
      const i = (y * raster.width + x) * 4;
      const [r, g, b, a] = fn(x, y);
      raster.data[i] = r;
      raster.data[i + 1] = g;
      raster.data[i + 2] = b;
      raster.data[i + 3] = a;
    }
  }
}

/** Deterministic pseudo-random source (mulberry32) for noise fixtures. */
export function seededRandom(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- byte helpers ----------

function ascii(s: string): number[] {
  return [...s].map((c) => c.charCodeAt(0));
}

function u16be(v: number): number[] {
  return [(v >> 8) & 0xff, v & 0xff];
}

function u32be(v: number): number[] {
  return [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff];
}

function u16le(v: number): number[] {
  return [v & 0xff, (v >> 8) & 0xff];
}

function u32le(v: number): number[] {
  return [v & 0xff, (v >> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];
}

/**
 * Minimal little-endian TIFF payload (no "Exif\0\0" header — callers add that
 * for JPEG APP1). With `gps: true` it carries a GPS Info IFD pointer (0x8825).
 */
export function makeTiff(opts: { gps: boolean }): Uint8Array {
  const bytes: number[] = [
    ...ascii("II"),
    ...u16le(42),
    ...u32le(8), // IFD0 offset
  ];
  if (!opts.gps) {
    bytes.push(...u16le(1)); // one entry
    bytes.push(...u16le(0x0100), ...u16le(4), ...u32le(1), ...u32le(640)); // ImageWidth
    bytes.push(...u32le(0));
    return new Uint8Array(bytes);
  }
  const gpsIfdOffset = 8 + 2 + 12 + 4; // after header + 1 entry + next-IFD
  bytes.push(...u16le(1));
  bytes.push(...u16le(0x8825), ...u16le(4), ...u32le(1), ...u32le(gpsIfdOffset));
  bytes.push(...u32le(0));
  bytes.push(...u16le(0)); // empty GPS IFD
  return new Uint8Array(bytes);
}

function app1(payload: number[] | Uint8Array): number[] {
  const p = [...payload];
  return [0xff, 0xe1, ...u16be(p.length + 2), ...p];
}

/** Minimal JPEG container: SOI, optional APP1 segments, SOS marker, EOI. */
export function makeJpeg(opts: { exif?: boolean; gps?: boolean; xmp?: boolean }): Uint8Array {
  const bytes: number[] = [0xff, 0xd8];
  if (opts.exif || opts.gps) {
    bytes.push(...app1([...ascii("Exif"), 0, 0, ...makeTiff({ gps: opts.gps === true })]));
  }
  if (opts.xmp) {
    bytes.push(...app1(ascii("http://ns.adobe.com/xap/1.0/\x00<rdf>fake</rdf>")));
  }
  bytes.push(0xff, 0xda, ...u16be(8), 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00); // SOS header
  bytes.push(0x11, 0x22, 0x33); // fake scan data
  bytes.push(0xff, 0xd9); // EOI
  return new Uint8Array(bytes);
}

export interface PngTextChunk {
  type: "tEXt" | "zTXt" | "iTXt";
  key: string;
  value: string;
}

function pngChunk(type: string, data: number[]): number[] {
  return [...u32be(data.length), ...ascii(type), ...data, 0, 0, 0, 0]; // zero CRC: parser does not verify
}

function textChunkPayload(c: PngTextChunk): number[] {
  if (c.type === "tEXt") return [...ascii(c.key), 0, ...ascii(c.value)];
  if (c.type === "zTXt") return [...ascii(c.key), 0, 0, ...ascii(c.value)];
  // iTXt: keyword, null, compression flag, compression method, language\0, translated\0, text
  return [...ascii(c.key), 0, 0, 0, 0, 0, ...ascii(c.value)];
}

/** Minimal PNG container: signature, IHDR, requested chunks, IEND. */
export function makePng(opts: {
  text?: PngTextChunk[];
  exif?: boolean;
  gps?: boolean;
  xmp?: boolean;
}): Uint8Array {
  const bytes: number[] = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const ihdr = [
    ...u32be(1),
    ...u32be(1),
    8,
    6, // 8-bit RGBA
    0,
    0,
    0,
  ];
  bytes.push(...pngChunk("IHDR", ihdr));
  for (const c of opts.text ?? []) {
    bytes.push(...pngChunk(c.type, textChunkPayload(c)));
  }
  if (opts.xmp) {
    bytes.push(
      ...pngChunk(
        "iTXt",
        textChunkPayload({ type: "iTXt", key: "XML:com.adobe.xmp", value: "<rdf>fake</rdf>" }),
      ),
    );
  }
  if (opts.exif || opts.gps) {
    bytes.push(...pngChunk("eXIf", [...makeTiff({ gps: opts.gps === true })]));
  }
  bytes.push(...pngChunk("IEND", []));
  return new Uint8Array(bytes);
}
