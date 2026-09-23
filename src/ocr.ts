import { createWorker } from "tesseract.js";
import type { OcrWord } from "./types";

export interface OcrResult {
  words: OcrWord[];
  text: string;
}

export type OcrProgress = (status: string, progress: number) => void;

let workerPromise: Promise<Awaited<ReturnType<typeof createWorker>>> | null = null;

/**
 * Fully self-hosted tesseract assets: the worker script, WASM core and
 * eng.traineddata are vendored into public/ (browser) or resolved from
 * node_modules (tests). No CDN or third-party runtime is ever contacted.
 */
function workerOptions() {
  if (typeof document === "undefined") {
    return {
      langPath: "node_modules/@tesseract.js-data/eng/4.0.0_best_int",
      gzip: true,
      cacheMethod: "none" as const,
    };
  }
  return {
    workerPath: "vendor/worker.min.js",
    corePath: "vendor",
    langPath: "lang",
    gzip: true,
    cacheMethod: "none" as const,
  };
}

async function getWorker(onProgress?: OcrProgress) {
  if (!workerPromise) {
    workerPromise = createWorker("eng", 1, {
      ...workerOptions(),
      logger: (m: { status: string; progress: number }) => {
        if (onProgress && m.status === "recognizing text") {
          onProgress(m.status, m.progress);
        }
      },
    });
  }
  return workerPromise;
}

/**
 * OCR an image entirely locally via tesseract.js (WASM).
 * Accepts anything tesseract.js accepts: Blob/File/URL/canvas.
 * Returns words in reading order with line ids assigned per OCR line.
 */
export async function recognize(
  image: Parameters<Awaited<ReturnType<typeof createWorker>>["recognize"]>[0],
  onProgress?: OcrProgress,
): Promise<OcrResult> {
  const worker = await getWorker(onProgress);
  const { data } = await worker.recognize(image);
  const words: OcrWord[] = [];
  const lines = data.lines ?? [];
  lines.forEach((line, lineIdx) => {
    for (const w of line.words ?? []) {
      if (!w.text || !w.text.trim()) continue;
      words.push({
        text: w.text,
        confidence: Math.min(1, Math.max(0, w.confidence / 100)),
        lineId: lineIdx,
        bbox: {
          x0: w.bbox.x0,
          y0: w.bbox.y0,
          x1: w.bbox.x1,
          y1: w.bbox.y1,
        },
      });
    }
  });
  return { words, text: data.text };
}

/** Release the shared OCR worker (tests / teardown). */
export async function terminateOcr() {
  if (workerPromise) {
    const w = await workerPromise;
    await w.terminate();
    workerPromise = null;
  }
}
