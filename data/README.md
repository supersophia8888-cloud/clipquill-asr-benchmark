# Data dictionary

All numbers in this directory were produced by the scripts in `../scripts/`,
driving a real (non-headless) Chrome window against the live site named in the
top-level README, or against a byte-identical local build of it.
Measurement dates 2026-09-17 and 2026-09-18. See `../METHOD.md` for how, and
for what these numbers do **not** cover.

## Files

| file | what it holds |
|---|---|
| `wer-by-sample.csv` | Per-clip word error rate for the two model tiers |
| `wer-by-condition.csv` | Same data grouped by acoustic condition, weighted |
| `timing-same-material-local.csv` | Tiny vs base on byte-identical audio, local build |
| `timing-live-clipquill-com.csv` | Cold / warm timings measured on the live public site |
| `memory-peak.csv` | Peak RSS of the whole spawned Chrome process tree |
| `transfer-size-by-file.csv` | Per-file transfer size of whisper-base as served |
| `chinese-cer-one-clip.csv` | Mandarin character error rate, three normalizations |
| `chinese-residual-errors.md` | The 6 remaining wrong characters, listed one by one |
| `decode-format-support.csv` | Which containers the browser can decode in-page |

## Conventions

**WER** is computed by DP alignment of the hypothesis against the reference
after light normalization, as `substitutions + deletions + insertions`
divided by reference words. Grouped rows are *weighted*: total errors divided
by total reference words, not an average of per-clip percentages.

**Word counting.** The scorer splits possessive apostrophes into separate
tokens, so a whitespace word count of the reference files comes out lower for
three clips:

| clip | `wc -w` | scorer | difference |
|---|---|---|---|
| C2-real-clean | 10 | 11 | 1 apostrophe |
| D2-real-noise-light | 24 | 25 | 1 apostrophe |
| E1-real-noise-heavy | 68 | 71 | 3 apostrophes |

The counts in the CSVs are the scorer counts. Total reference words: 229.

**CER** for Mandarin is reported at three normalization levels because the
model emits Traditional Chinese while the reference is Simplified. Reporting
only the raw number (43.3 %) would be misleading: 36 of the 97 characters
differ by script alone.

**Cold vs warm.** Cold means Cache Storage and the HTTP cache were cleared and
the page reloaded, so the full 78.4 MiB crosses the network. Warm means the
same profile reloaded with the model already cached.

**rtf** (real time factor) is processing seconds divided by audio seconds.
Lower is faster; below 1.0 means faster than real time.

## Known gaps

Two speakers only. One noise type (pink noise). Six of eight clips are read
speech. 97 of the 99 language tokens have never been run. The 1610 s timing
row is a single run. See `../METHOD.md`.

## Notes that used to sit inside the CSV files

These lines were the header comments of each CSV. They were removed from the CSV files so that a
strict RFC 4180 reader (the Hugging Face dataset viewer, pandas, DuckDB) can parse the files: in
CSV a line starting with `#` is not a comment, it is data, so those lines made the column count
inconsistent and the file failed to load. Nothing was reworded.

### chinese-cer-one-clip.csv

```
# Chinese (Mandarin) measurement, whisper-base, clipquill.com, 2026-09-18.
# Clip: 23.088 s, 97 reference characters, language manually set to "zh".
# The model emits Traditional Chinese while the reference text is Simplified,
# so a raw character comparison is meaningless: 36 of the 97 characters differ
# only by script. Three normalization levels are reported.
```

### decode-format-support.csv

```
# Browser-side decodability of container formats, real Chrome window with
# crossOriginIsolated = true, 2026-09-18. 2 s 440 Hz mono test tones produced
# with ffmpeg and injected straight into AudioContext.decodeAudioData().
# This tests decoding only - the 76 MiB model is not loaded.
```

### memory-peak.csv

```
# Peak resident memory of the whole Chrome process tree spawned for each
# measurement run. Sampled every 3 s via CDP SystemInfo.getProcessInfo to get
# process ids, then tasklist summing WorkingSetSize for those ids.
# The browser's own JS heap is not used: the model lives in a worker, which the
# page-level heap snapshot does not show.
```

### timing-live-clipquill-com.csv

```
# Live timings measured on the public site https://clipquill.com , 2026-09-18,
# real (non-headless) Chrome window, over the public internet, on a 2-core
# 3.94 GB machine that was also running other workloads.
# cold = Cache Storage + HTTP cache cleared, then reload (re-downloads 78.4 MiB)
# warm = same profile reloaded, model already in Cache Storage
# app_reported = seconds shown by the page's own status line (file handed over ->
#   text on screen); wall_clock = measured by the harness (adds file read + decode)
```

### timing-same-material-local.csv

```
# Same-material A/B timing, local build, real Chrome window, 2026-09-17/18.
# Both model tiers ran byte-identical audio (the 8 clips concatenated into a
# 92.619 s pool, then cut/looped to the lengths below).
# First row is a cold start (includes model download); the rest are warm.
# rtf = real time factor = processing_seconds / audio_seconds (lower is faster).
```

### transfer-size-by-file.csv

```
# Per-file transfer size of whisper-base as served by clipquill.com, 2026-09-18.
# bytes_on_wire = what actually crossed the network (brotli where applicable)
# bytes_decoded = size after decompression. ONNX weights barely compress, which
# is why 74.0 of the 78.4 MiB first-visit total is model weights at full size.
```

