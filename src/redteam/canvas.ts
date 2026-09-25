import type { Raster } from "./types";

/**
 * Browser canvas helpers + the bridge that feeds rasters to tesseract.
 *
 * The attack engine operates on raw `Raster` buffers so it stays pure;
 * this module is the only place that knows about canvases (browser) or
 * PNG encoding (node/tests). Everything here is environment-guarded so
 * importing it in node is safe.
 */

type OcrInput = Parameters<
  Awaited<ReturnType<typeof import("tesseract.js")["createWorker"]>>["recognize"]
>[0];

/** Build an empty canvas in the browser. Throws in node (tests use PNG). */
export function createCanvas(width: number, height: number): HTMLCanvasElement {
  if (typeof document === "undefined") {
    throw new Error("createCanvas is only available in the browser");
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/** Raster → canvas. */
export function rasterToCanvas(src: Raster): HTMLCanvasElement {
  const canvas = createCanvas(src.width, src.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d context unavailable");
  ctx.putImageData(new ImageData(src.data, src.width, src.height), 0, 0);
  return canvas;
}

/** Canvas (or any drawable source) → Raster. */
export function canvasToRaster(
  source: CanvasImageSource,
  width: number,
  height: number,
): Raster {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d context unavailable");
  ctx.drawImage(source, 0, 0, width, height);
  const img = ctx.getImageData(0, 0, width, height);
  return { width, height, data: img.data };
}

/** Encode a raster as a PNG Blob (browser). */
export function rasterToPngBlob(src: Raster): Promise<Blob> {
  const canvas = rasterToCanvas(src);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("canvas.toBlob returned null"));
    }, "image/png");
  });
}

/**
 * Convert a raster into whatever tesseract.js recognizes in the current
 * environment: a canvas in the browser, a PNG buffer in node (vitest).
 * pngjs is imported lazily so the browser bundle never includes it.
 */
export async function rasterToOcrInput(src: Raster): Promise<OcrInput> {
  if (typeof document !== "undefined") {
    return rasterToCanvas(src);
  }
  const { PNG } = await import("pngjs");
  const png = new PNG({ width: src.width, height: src.height });
  Buffer.from(src.data.buffer, src.data.byteOffset, src.data.byteLength).copy(
    png.data,
  );
  return PNG.sync.write(png);
}

/** Decode a PNG buffer → Raster (node/tests). */
export async function pngBufferToRaster(buf: Uint8Array): Promise<Raster> {
  const { PNG } = await import("pngjs");
  const png = PNG.sync.read(Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength));
  return { width: png.width, height: png.height, data: new Uint8ClampedArray(png.data) };
}
