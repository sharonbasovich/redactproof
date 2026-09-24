// Memory/time probe: runAttacks on a ~6MP raster (the MAX_ATTACK_PIXELS
// boundary) — all 7 variant rasters are retained until the run returns.
import { readFileSync } from "node:fs";
import { PNG } from "pngjs";
import { runAttacks } from "../src/redteam/attack";
import { terminateOcr } from "../src/ocr";
import type { Raster } from "../src/redteam/types";

const src = PNG.sync.read(readFileSync("fixtures/redteam/marker-55.png"));

// nearest-neighbor scale up to 3000x2000 (6,000,000 px)
const W = 3000, H = 2000;
const raster: Raster = { width: W, height: H, data: new Uint8ClampedArray(W * H * 4) };
for (let y = 0; y < H; y++) {
  const sy = Math.min(src.height - 1, Math.floor((y * src.height) / H));
  for (let x = 0; x < W; x++) {
    const sx = Math.min(src.width - 1, Math.floor((x * src.width) / W));
    const s = (sy * src.width + sx) * 4, d = (y * W + x) * 4;
    raster.data[d] = src.data[s]; raster.data[d+1] = src.data[s+1];
    raster.data[d+2] = src.data[s+2]; raster.data[d+3] = src.data[s+3];
  }
}
console.log(`raster ${W}x${H} = ${(W*H*4/1e6).toFixed(0)}MB pixels`);

let peak = 0;
const timer = setInterval(() => {
  const m = process.memoryUsage();
  if (m.rss > peak) peak = m.rss;
}, 50);

const res = await runAttacks(raster, {
  onProgress: (d, t, id) => console.log(`  ${d}/${t} ${id} rss=${(process.memoryUsage().rss/1e9).toFixed(2)}GB`),
});
clearInterval(timer);
console.log(`elapsed ${(res.elapsedMs/1000).toFixed(1)}s, hits ${res.hits.length}, peak rss ~${(peak/1e9).toFixed(2)}GB`);
await terminateOcr();
process.exit(0);
