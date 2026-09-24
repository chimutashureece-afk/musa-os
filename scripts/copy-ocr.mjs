// Copies the in-browser text reader (Tesseract) into public/tesseract so photos can be
// read without depending on a CDN. Runs automatically before `npm run dev` / `npm run build`.
import { cpSync, existsSync, mkdirSync } from 'node:fs';
const out = 'public/tesseract';
mkdirSync(`${out}/lang`, { recursive: true });
const files = [
  ['node_modules/tesseract.js/dist/worker.min.js', `${out}/worker.min.js`],
  ...['lstm', 'simd-lstm', 'relaxedsimd-lstm'].map((v) => [`node_modules/tesseract.js-core/tesseract-core-${v}.wasm.js`, `${out}/tesseract-core-${v}.wasm.js`]),
  ['node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz', `${out}/lang/eng.traineddata.gz`],
];
for (const [from, to] of files) {
  if (!existsSync(from)) { console.warn(`[copy-ocr] missing ${from} — photo reading will fall back to the CDN`); continue; }
  cpSync(from, to);
}
console.log('[copy-ocr] text reader ready in public/tesseract');
