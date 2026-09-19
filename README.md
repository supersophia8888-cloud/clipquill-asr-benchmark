---
license: cc-by-4.0
language:
  - en
pretty_name: whisper-tiny vs whisper-base in a browser tab
task_categories:
  - automatic-speech-recognition
size_categories:
  - n<1K
tags:
  - whisper
  - word-error-rate
  - benchmark
  - browser
  - wasm
  - onnx
  - client-side-inference
  - speech-recognition
configs:
  - config_name: wer_by_sample
    data_files: data/wer-by-sample.csv
  - config_name: wer_by_condition
    data_files: data/wer-by-condition.csv
  - config_name: timing_same_material_local
    data_files: data/timing-same-material-local.csv
  - config_name: timing_live_clipquill_com
    data_files: data/timing-live-clipquill-com.csv
  - config_name: memory_peak
    data_files: data/memory-peak.csv
  - config_name: transfer_size_by_file
    data_files: data/transfer-size-by-file.csv
  - config_name: chinese_cer_one_clip
    data_files: data/chinese-cer-one-clip.csv
  - config_name: decode_format_support
    data_files: data/decode-format-support.csv
---

# Measuring whisper-tiny vs whisper-base in a browser tab

Word error rate, wall-clock timing, transfer size and peak memory for two
quantised Whisper tiers running entirely client-side in a real Chrome window,
with the scripts that produced every number.

If you are building an in-browser transcription page, the two results worth
knowing before you pick a model tier:

1. **On clean synthetic audio the two tiers tie.** If that is all you test, you
   will conclude the tier does not matter, and you will be wrong. On real speech
   with noise, `tiny` collapses: weighted WER 59.0 % against `base` at 19.7 %.
2. **"Smaller model is faster" does not hold past about 13 seconds of audio.**
   On byte-identical long audio `base` finished 1.5–2.3× sooner than `tiny`.
   The mechanism is not fully pinned down here (see `METHOD.md`).

## Where these numbers come from

The measurements were taken on [clipquill.com](https://clipquill.com), a page
that runs the model in the visitor's own tab and never uploads the file; the
live timings in `data/` are from that page over the public internet.

## Contents

```
data/     the measurements, as CSV, plus a data dictionary
scripts/  the CDP harnesses that produced them, all runnable
samples/  reference transcripts for the eight WER clips
METHOD.md how each number was measured, and what is not covered
```

## The headline table

Weighted WER by acoustic condition, 8 clips / 229 reference words:

| condition | clips | words | tiny | base |
|---|---|---|---|---|
| clean synthetic TTS | 1 | 33 | 6.1 % | 6.1 % |
| real speech, no noise | 2 | 28 | 21.4 % | 10.7 % |
| real speech, light pink noise | 2 | 57 | 54.4 % | 8.8 % |
| real speech, heavy pink noise | 2 | 89 | 92.1 % | 33.7 % |
| real speech, telephone band + echo | 1 | 22 | 63.6 % | 22.7 % |
| **all** | **8** | **229** | **59.0 %** | **19.7 %** |

`base` is better on 7 of 8 clips and tied on the eighth. It is not worse on any.

## Running the scripts yourself

Everything is Node 22 with no dependencies (the CDP client is hand-rolled on the
global `WebSocket`, and the page is driven over `Runtime.evaluate`). The two
Python files are optional: `serve-ab.py` serves a build with the COOP/COEP
headers the page needs, and `cer-zh.py` does the Mandarin normalizations.

```
node scripts/run-ab.mjs            # WER, both tiers, the eight clips
node scripts/run-timing.mjs        # same-material A/B timing
node scripts/run-timing-live.mjs   # cold/warm timing against the live page
node scripts/run-formats.mjs       # which containers decodeAudioData accepts
node scripts/run-zh.mjs            # the Mandarin clip
python scripts/cer-zh.py           # the three CER normalizations
```

The scripts contain absolute paths from the machine they were written on.
Change the path constants at the top before running them elsewhere.

Two things that will bite you if you adapt these:

- `Runtime.evaluate` hangs while the page's main thread is busy loading or
  running the model. Poll with a short per-call timeout (8 s) and treat a
  timeout as "still busy", not as a failure.
- `DOM.setFileInputFiles` needs the **backend** node id, which is nested under
  `node` in the result of `DOM.describeNode`.

## Reuse

Data and documentation are CC BY 4.0 (`LICENSE`). Scripts are MIT
(`scripts/LICENSE`). If you reuse the data, please keep the attribution and
say which measurement date you are citing — the numbers move when the model or
the page changes.

## Archived versions and DOI

This dataset is archived on Zenodo. Cite the version DOI for one specific release, or the concept DOI to
point at the dataset as a whole.

- Concept DOI, all versions: https://doi.org/10.5281/zenodo.22826968
- Version DOI, v1.0.0: https://doi.org/10.5281/zenodo.22826969

The same files are also published as a Hugging Face dataset:
https://huggingface.co/datasets/sophia8888/clipquill-asr-benchmark

## Citing

See `CITATION.cff`. Author is listed as *Clipquill*; if you are the owner and
want your own name there, change it in `CITATION.cff` and `codemeta.json`
before depositing.
