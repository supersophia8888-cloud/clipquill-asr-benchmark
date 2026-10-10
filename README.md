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
  - config_name: container_codec_matrix
    data_files: data/container-codec-matrix.csv
  - config_name: page_decode_endtoend
    data_files: data/page-decode-endtoend.csv
  - config_name: video_track_ignored
    data_files: data/video-track-ignored.csv
  - config_name: edit_load_8clips
    data_files: data/edit-load-8-clips.csv
  - config_name: edit_load_longfiles
    data_files: data/edit-load-long-files.csv
---

# Measuring whisper-tiny vs whisper-base in a browser tab

Word error rate, wall-clock timing, transfer size and peak memory for two
quantised Whisper tiers running entirely client-side in a real Chrome window,
with the scripts that produced every number.

If you are building an in-browser transcription page, the two results worth
knowing before you pick a model tier:

1. **On the audio most people actually record, the shipped English model is
   accurate.** Across the four clean and light-noise real-speech clips — 85
   reference words, the kind of voice memo or interview a normal user uploads —
   the English default (`moonshine-base`) is **7.1 %** wrong and the optional
   `whisper-small` tier is **8.2 %** wrong (measured 2026-10-03). Test only clean
   synthetic audio and the tiers look tied; test deliberately harsh audio
   (telephone band, heavy pink noise) and `tiny` collapses to 81.7 % against
   `base` at 20.1 % on the full eight-clip set. The realistic number is the one
   to design around.
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

**On the audio most people actually have — four clean and light-noise
real-speech clips, 85 reference words — the English default (`moonshine-base`)
is 7.1 % wrong and the optional `whisper-small` tier is 8.2 % wrong (measured
2026-10-03).** That is the number to design around for a normal user.

The full eight-clip set, by acoustic condition (229 reference words):

| condition | clips | words | tiny | base | moonshine-base |
|---|---|---|---|---|---|
| clean synthetic TTS | 1 | 33 | 6.1 % | 6.1 % | 6.1 % |
| real speech, no noise | 2 | 28 | 28.6 % | 10.7 % | 7.1 % |
| real speech, light pink noise | 2 | 57 | 59.6 % | 8.8 % | 7.0 % |
| real speech, heavy pink noise * | 2 | 89 | 143.8 % | 34.8 % | 21.3 % |
| real speech, telephone band + echo * | 1 | 22 | 68.2 % | 22.7 % | 18.2 % |
| **all eight** | **8** | **229** | **81.7 %** | **20.1 %** | **13.5 %** |

\* deliberately harsh conditions, not typical of consumer recordings — kept
separate so the realistic number above is not dragged up by stress tests.
The four non-starred real-speech rows (clean + light noise, 85 words) combine to
`moonshine-base` 7.1 % / `whisper-small` 8.2 %; see the
`typical_clean_and_light_real_speech` row in `data/wer-by-condition.csv`.

`moonshine-base` is the model the site ships for English; `whisper-base` and
`whisper-small` remain the models for the other languages. On these English
clips `moonshine-base` matches or beats `whisper-base` on every clip (better on
five, tied on three), and it is ahead of `whisper-small` on the typical
clean-and-light-noise set — 7.1 % against 8.2 % — while `whisper-small` stays
ahead on the deliberately harsh heavy-noise clips.

> `tiny` is not reproducible on the hardest clip (E1 ranges 84.5–111.3 % across
> runs), so its all-clips figure is one run, not a stable measurement. The
> retuned engine's gains show up in the edit-load tables below (fewer words
> dropped), not in `tiny`'s word-error rate.

## Edit-load tables (2026-09-28 expansion)

The word-error-rate tables above count wrong words as a percentage. These two
tables count the same runs a different way, because a percentage hides the thing
that actually matters when you are fixing a transcript by hand:

- **Words dropped** — reference words the transcript never produced (a silent
  loss; you would not even know they were missing).
- **Spots to fix by hand** — consecutive edits collapsed into one spot, so a
  22-word invented sentence counts as one spot.

Four tiers are covered: `tiny`, `base` (the one the site ships), `small`, and a
**cloud speech API used as a reference point only, not a recommendation**.

| file | what it covers |
|---|---|
| `data/edit-load-8-clips.csv` | the eight short clips, 229 reference words |
| `data/edit-load-long-files.csv` | three long files, 7,385 reference words (L1 ≈ 5.6 min, L2 ≈ 13.1 min, L3 ≈ 27.9 min) |

Totals, both batches:

| tier | 8-clip dropped / spots | long-file dropped / spots |
|---|---|---|
| tiny | 5 / 20 | 203 / 273 |
| base (shipped) | 4 / 6 | 82 / 133 |
| small | 1 / 2 | 45 / 79 |
| cloud reference | 7 / 16 | 111 / 592 |

Read the two columns separately. On the long files the local tiers now lead
**both** columns: `small` needs the fewest hand-fixes (79, against the cloud
reference's 592) and drops the fewest words (45, against 111). The cloud
reference is printed only as a reference point, not a recommendation — it is a
different system that uploads your audio, whereas the local tiers keep it on
your device. On the eight short clips, by contrast, the four tiers land close
enough (the cloud reference drops 7 and needs 16 hand-fixes; `small` drops 1 and
needs 2) that we still say "about the same".

**Cloud reference row — exactly what it was measured on** (no number goes on the
page without all of this written down):

- Service and API version: Google Cloud Speech-to-Text, v1.
- Method: 8 short clips — synchronous recognition; three long files — long-running
  recognition (the synchronous method rejects audio longer than 1 minute:
  `Sync input too long`).
- Model: `model` not specified, so the API default was used. Chirp / Chirp 2 were
  not selected.
- Date called: 2026-09-27 (8 clips), 2026-09-28 (three long files).
- Parameters: `languageCode: en-US`, `enableAutomaticPunctuation: true`,
  `encoding: MP3`.
- How called: from this machine, with Application Default Credentials; the project
  was named on each call. Long files were uploaded to Cloud Storage first and
  passed in as a `gs://` URI.
- Audio path: the **same MP3 files**, not two sets. The local tiers and the cloud
  API ran on the identical files (LibriSpeech `dev-clean` FLAC re-encoded to 16 kHz
  mono MP3; 64 kb/s for the long files, 24 kb/s for the 8 clips, A-clean being
  24 kHz / 48 kb/s — the one exception, same file both sides).

These two tables are the data behind the site's `/transcription-benchmark/` page.

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
node scripts/run-container-codec-matrix.mjs   # same audio, 20 containers and codecs
node scripts/run-page-endtoend.mjs            # the live page's own verdict, file by file
bash scripts/build-video-track-set.sh <out> <speech-a.mp3> <speech-b.mp3>
node scripts/run-video-track.mjs              # with a picture, without one, without audio
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
- Version DOI, v1.0.1: https://doi.org/10.5281/zenodo.22840611
- Version DOI, v1.0.0: https://doi.org/10.5281/zenodo.22826969

The same files are also published as a Hugging Face dataset:
https://huggingface.co/datasets/sophia8888/clipquill-asr-benchmark

## Citing

See `CITATION.cff`. Author is listed as *Clipquill*; if you are the owner and
want your own name there, change it in `CITATION.cff` and `codemeta.json`
before depositing.
