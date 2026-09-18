# How these numbers were produced

Everything here was measured by driving a real Chrome window over the Chrome
DevTools Protocol. Nothing is extrapolated, simulated or quoted from a vendor.

## Machine and conditions

- 2-core AMD EPYC 9754, 3.94 GB RAM, running other workloads throughout.
- Real (non-headless) Chrome window, a fresh throwaway profile per tier.
- The page runs under COOP/COEP, so `crossOriginIsolated` is true and it gets
  SharedArrayBuffer. `crossOriginIsolated` has to be read after navigating to
  the live page; on `about:blank` it always reports false.
- Model: `onnx-community/whisper-base`, quantised ONNX, served from the site.
- The compared tier is `onnx-community/whisper-tiny`, same quantised format.

## Word error rate

Eight clips, 229 reference words total, in five acoustic conditions:

- `A` — synthetic TTS, my own sentence, no noise.
- `C1`, `C2` — real read speech from LibriSpeech (dev-clean, speaker 1272),
  using the dataset's own transcripts as reference, not my transcription.
- `D1`, `D2` — the same real speech with pink noise added at amplitude 0.06.
- `E1`, `E2` — the same real speech with pink noise added at amplitude 0.14.
- `B` — real historical speech (a 1961 public-domain recording, Boston accent)
  band-limited to telephone range with echo and pink noise.

Scoring is DP alignment of hypothesis to reference after light normalization.
Grouped figures are weighted by reference word count, not averaged.

## Timing

Two separate measurements, deliberately not mixed:

1. **Same-material A/B** (`timing-same-material-local.csv`). The eight clips
   were concatenated into a 92.619 s pool, then cut or looped to 13 / 60 / 277
   / 1610 s. Both tiers ran byte-identical audio. First run cold, the rest warm.
2. **Live** (`timing-live-clipquill-com.csv`). Run against the public site over
   the public internet, 2026-09-18. Cold means Cache Storage and HTTP cache
   cleared then reloaded. App-reported seconds come from the page's own status
   line; wall-clock seconds are measured by the harness and include file read
   and decode.

Single-run rows are marked. Timing on this machine jitters because the CPU is
shared; the aggregate rows are the trustworthy ones.

## Memory

The page-level JS heap cannot see the model, because it lives in a worker. Peak
memory is therefore measured at the OS level: CDP `SystemInfo.getProcessInfo`
gives the process ids of the spawned browser tree, then `tasklist` sums
`WorkingSetSize` for exactly those ids, sampled every 3 s. The owner's own
running Chrome is excluded.

## Transfer size

Each model file was fetched from the live site with brotli negotiation, per
file, and the bytes were summed. ONNX weights are already quantised and barely
compress, so 74.0 of the 78.4 MiB first-visit total is weights crossing at full
size. What does compress is text: `tokenizer.json` goes from 2,480,466 bytes
to 641,057.

The site reports volume in MiB rather than exact bytes on purpose: publishing
an exact byte count self-expires the moment any copy on the page changes.

## Mandarin

One clip, 23.088 s, 97 reference characters, language set to `zh` by hand.
The model emits Traditional Chinese; the reference is Simplified. Three
normalizations are reported because the raw comparison counts 36 characters
that differ only by script. Conversion uses `zhconv`.

One clip is a count, not a rate. It is published as "6 of 97 characters were
wrong", never as a percentage.

## What this does not cover

- Two speakers only. No accents other than the one Boston-accent recording, no
  male/female/child balance, no multi-speaker conversation.
- One noise type. No cafe babble, keyboard, reverb room, or music under speech.
- Six of eight clips are read speech. Real user uploads (meetings, interviews,
  short video) are harder. The real gap may be larger than measured, or
  different in ways not covered here. No extrapolation is claimed.
- 97 of the 99 language tokens have never been run.
- The 1610 s timing row is a single run per tier; the jitter range is unknown.
- Why `base` is faster than `tiny` on long audio is not fully explained. There
  is one direct piece of evidence (an anti-loop retry triggered by noised
  output, which makes the same audio pay twice) but no per-segment timing to
  prove it is the main cause, so it is not stated as a conclusion.
- No phone was used. The site says so too.
