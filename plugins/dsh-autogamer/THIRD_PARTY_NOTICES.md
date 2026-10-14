# Third-party notices

Redistributed with this plugin, with the terms each source states. This is a
packaging obligation, not an upstream-attribution one: nothing here comes from
`google/artemis` (see `LICENSE` and AGENTS.md D20).

## tesseract.js

- Used by: `src/ocr/recognize.ts` (built-in offline OCR, T5).
- Package: `tesseract.js` ^7.0.0, MIT — `node_modules/tesseract.js/LICENSE.md`.
- Loaded at runtime through `createRequire` from the plugin's own dependencies;
  no build step of the host is involved.

## Tesseract language data (`ocr/*.traineddata.gz`)

| File | Source | Version | Size (gzipped) | Licence |
|---|---|---|---|---|
| `ocr/eng.traineddata.gz` | `https://tessdata.projectnaptha.com/4.0.0_fast/eng.traineddata.gz` | tessdata_fast, 4.0.0 | 1,984,273 bytes | Apache-2.0 |
| `ocr/chi_sim.traineddata.gz` | `https://tessdata.projectnaptha.com/4.0.0_fast/chi_sim.traineddata.gz` | tessdata_fast, 4.0.0 | 1,730,011 bytes | Apache-2.0 |

The `fast` line is what the sizes above are: the standard `4.0.0` trainables are
10.9 MB (`eng`) and 20.2 MB (`chi_sim`) gzipped, which is too large to ship to
every user for the one job this does — locating a label the UI hierarchy cannot
show. The licence column repeats what the upstream repository states for that
line; re-check it at the source URL when these files are next replaced (the
tessdata repositories carry per-model notices, and `chi_sim` includes data with
its own terms). Some scripts in tessdata are distributed under the OFL rather
than Apache-2.0, so this row is a pointer to verify, not a finished legal
conclusion. Accuracy consequences were measured per frame (`node scripts/ocr-probe.mjs`
in the repository root): matched labels score 72–92 confidence, background noise
14–47, and `OCR_MIN_CONFIDENCE = 60` sits between the two.

The data is stored gzipped because that is the form `tesseract.js` reads with
`gzip: true`, which also keeps it out of the install cache (`cacheMethod: "none"`).

## Screenshot fixture

- `tests/fixtures/screen-chrome-tab-overview.png` was captured with
  `adb exec-out screencap -p` from a locally-run Android 15 emulator
  (`emulator-5554`, product `aurora`) on 2026-10-15. It shows a launcher screen
  with public app labels; it exists so the OCR probe runs on a real frame rather
  than a synthetic one, and it is test data, not shipped code.
