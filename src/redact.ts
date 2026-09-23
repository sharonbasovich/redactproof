import type { BBox } from "./types";

/**
 * Draw the source image onto a brand-new canvas and paint fully opaque
 * rectangles over each box. Destructive by design: there is no overlay,
 * no alpha, and no recoverable layer — the pixel data itself is replaced.
 */
export function burnRedactions(
  source: CanvasImageSource,
  width: number,
  height: number,
  boxes: BBox[],
  fill = "#000000",
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");
  ctx.drawImage(source, 0, 0, width, height);
  ctx.globalAlpha = 1;
  ctx.fillStyle = fill;
  for (const b of boxes) {
    const x = Math.max(0, Math.floor(b.x0));
    const y = Math.max(0, Math.floor(b.y0));
    const x1 = Math.min(width, Math.ceil(b.x1));
    const y1 = Math.min(height, Math.ceil(b.y1));
    if (x1 > x && y1 > y) ctx.fillRect(x, y, x1 - x, y1 - y);
  }
  return canvas;
}

export function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("PNG encode failed"))), "image/png");
  });
}

export async function sha256Hex(data: ArrayBuffer | Uint8Array): Promise<string> {
  const buf = data instanceof Uint8Array ? data : new Uint8Array(data);
  const digest = await crypto.subtle.digest("SHA-256", buf as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
