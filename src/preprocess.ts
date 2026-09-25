/**
 * Pure image preprocessing for OCR enhancement passes. Operates on raw RGBA
 * buffers so the same code runs on canvas ImageData in the browser and on
 * pngjs rasters in tests — no DOM dependency.
 */

export interface RgbaImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/**
 * Grayscale + contrast stretch: remap luminance so the darkest/lightest
 * percentiles land on 0/255. Helps OCR on faint, low-contrast, or
 * translucent-overlay text. Alpha is forced opaque.
 */
export function enhanceContrast(src: RgbaImage): RgbaImage {
  const n = src.width * src.height;
  const out = new Uint8ClampedArray(n * 4);
  const lum = new Uint8Array(n);

  let min = 255;
  let max = 0;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    // Rec. 601 luma
    const l = Math.round(
      0.299 * src.data[o] + 0.587 * src.data[o + 1] + 0.114 * src.data[o + 2],
    );
    lum[i] = l;
    if (l < min) min = l;
    if (l > max) max = l;
  }

  const range = max - min;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const v = range > 0 ? Math.round(((lum[i] - min) / range) * 255) : lum[i];
    out[o] = out[o + 1] = out[o + 2] = v;
    out[o + 3] = 255;
  }
  return { width: src.width, height: src.height, data: out };
}

/**
 * 2x nearest-neighbor upscale. Bilinear is nicer to look at, but nearest
 * preserves the hard edges tesseract's binarizer wants and is trivially
 * correct in both canvas and pngjs test paths.
 */
export function upscale2x(src: RgbaImage): RgbaImage {
  const w = src.width * 2;
  const h = src.height * 2;
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const sy = y >> 1;
    for (let x = 0; x < w; x++) {
      const sx = x >> 1;
      const di = (w * y + x) * 4;
      const si = (src.width * sy + sx) * 4;
      out[di] = src.data[si];
      out[di + 1] = src.data[si + 1];
      out[di + 2] = src.data[si + 2];
      out[di + 3] = src.data[si + 3];
    }
  }
  return { width: w, height: h, data: out };
}
