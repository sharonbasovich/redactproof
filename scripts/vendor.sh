#!/usr/bin/env bash
# Copies the tesseract.js worker script, WASM core and eng language data into
# public/ so the built site is fully self-hosted (no CDN calls at runtime).
set -euo pipefail
cd "$(dirname "$0")/.."

mkdir -p public/vendor public/lang

cp node_modules/tesseract.js/dist/worker.min.js public/vendor/
cp node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm public/vendor/
cp node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js public/vendor/
cp node_modules/tesseract.js-core/tesseract-core-lstm.wasm public/vendor/
cp node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js public/vendor/
cp node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz public/lang/

echo "Vendored tesseract assets into public/"
