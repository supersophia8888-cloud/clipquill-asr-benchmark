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
