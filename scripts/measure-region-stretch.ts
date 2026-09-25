/**
 * Probe: does `region-stretch` recover what the 7 global attacks cannot?
 * Runs identity + all globals on each marker fixture, then region-stretch
 * alone, and reports per-variant hits + categories recovered.
 *
 *   npx vite-node scripts/measure-region-stretch.ts
 */
import { readFileSync } from "node:fs";
import { PNG } from "pngjs";
import { runAttacks, applyAttack } from "../src/redteam/attack";
import { grade } from "../src/redteam/grade";
import { findCandidateRegions } from "../src/redteam/analyze";
import { recognize } from "../src/ocr";
import { detectSensitive } from "../src/detect";
import { rasterToOcrInput } from "../src/redteam/canvas";
import type { Raster } from "../src/redteam/types";
import { ATTACK_IDS } from "../src/redteam/types";

function pngToRaster(path: string): Raster {
  const png = PNG.sync.read(readFileSync(path));
  return { width: png.width, height: png.height, data: png.data };
}

const FIXTURES = [
  "fixtures/redteam/marker-97.png",
  "fixtures/redteam/marker-99.png",
  "fixtures/redteam/marker-opaque.png",
  "fixtures/redteam/clean.png",
];

for (const f of FIXTURES) {
  const raster = pngToRaster(f);
  const regions = findCandidateRegions(raster);
  const regionPx = regions.reduce(
    (s, b) => s + (b.x1 - b.x0) * (b.y1 - b.y0),
    0,
  );
  console.log(
    `\n=== ${f} ===  candidates: ${regions.length} regions, ` +
      `${regionPx}px covered (${((regionPx / (raster.width * raster.height)) * 100).toFixed(1)}%)`,
  );

  // Global set (everything except region-stretch)
  const globals = ATTACK_IDS.filter((a) => a !== "region-stretch");
  const run = await runAttacks(raster, { variants: [...globals] });
  const g = grade(run);
  const byAttack = new Map<string, number>();
  for (const h of run.hits) {
    for (const a of h.attacks) byAttack.set(a, (byAttack.get(a) ?? 0) + 1);
  }
  console.log(
    `  7 globals : grade ${g.grade}  hits ${run.hits.length}  ` +
      `by-attack ${JSON.stringify([...byAttack])}`,
  );
  console.log(`           categories: ${[...new Set(run.hits.map((h) => h.category))].join(", ") || "none"}`);

  // region-stretch alone
  const rs = applyAttack(raster, "region-stretch");
  const { words } = await recognize(await rasterToOcrInput(rs));
  const hits = detectSensitive(words);
  const cats = [...new Set(hits.map((h) => h.category))];
  console.log(
    `  region-stretch: ${hits.length} hits, ${words.length} words OCR'd — ` +
      `categories: ${cats.join(", ") || "none"}`,
  );

  // prototype: per-TIGHT-region raw luma stretch (no pad, no blur-divide)
  const proto = {
    width: raster.width,
    height: raster.height,
    data: new Uint8ClampedArray(raster.data),
  };
  for (const b of regions) {
    const hist = new Uint32Array(256);
    let count = 0;
    for (let y = b.y0; y < b.y1; y++) {
      for (let x = b.x0; x < b.x1; x++) {
        const i = (raster.width * y + x) * 4;
        const v = Math.round(
          0.299 * raster.data[i] + 0.587 * raster.data[i + 1] + 0.114 * raster.data[i + 2],
        );
        hist[v]++;
        count++;
      }
    }
    const pct = (p: number) => {
      let acc = 0;
      const t = count * p;
      for (let v = 0; v < 256; v++) {
        acc += hist[v];
        if (acc >= t) return v;
      }
      return 255;
    };
    const lo = pct(0.01);
    const hi = pct(0.99);
    const range = Math.max(1, hi - lo);
    for (let y = b.y0; y < b.y1; y++) {
      for (let x = b.x0; x < b.x1; x++) {
        const i = (raster.width * y + x) * 4;
        const v = Math.round(
          0.299 * raster.data[i] + 0.587 * raster.data[i + 1] + 0.114 * raster.data[i + 2],
        );
        const s = Math.max(0, Math.min(255, Math.round(((v - lo) / range) * 255)));
        proto.data[i] = proto.data[i + 1] = proto.data[i + 2] = s;
      }
    }
  }
  const pIn = await rasterToOcrInput(proto);
  const { words: pw } = await recognize(pIn);
  const ph = detectSensitive(pw);
  console.log(
    `  proto tight-stretch: ${ph.length} hits, ${pw.length} words — ` +
      `categories: ${[...new Set(ph.map((h) => h.category))].join(", ") || "none"}`,
  );

  // Full 8-variant run incl. region-stretch
  const full = await runAttacks(raster);
  const fg = grade(full);
  console.log(`  all 8     : grade ${fg.grade}  hits ${full.hits.length}  recoveredWords ${full.recoveredWords}`);
}
