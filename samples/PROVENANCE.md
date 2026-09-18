# Where the test clips come from

The audio itself is **not** redistributed here, only the reference transcripts.
That is deliberate: the recordings carry their own licences and, for two of the
sources, the exact utterance identifiers were not recorded at measurement time,
so shipping the audio would mean shipping something whose provenance could not
be stated precisely. If you want to reproduce the numbers, rebuild the clips
from the sources below and add your own noise at the amplitudes given.

| clip | seconds | source | reference |
|---|---|---|---|
| `A-clean` | 10.0 | synthetic TTS of a sentence written for this benchmark | own text |
| `C1-real-clean` | 5.9 | LibriSpeech `dev-clean`, speaker 1272 | dataset transcript |
| `C2-real-clean` | 4.8 | LibriSpeech `dev-clean`, speaker 1272 | dataset transcript |
| `D1-real-noise-light` | 12.5 | LibriSpeech `dev-clean`, speaker 1272 + pink noise a=0.06 | dataset transcript |
| `D2-real-noise-light` | 9.9 | LibriSpeech `dev-clean`, speaker 1272 + pink noise a=0.06 | dataset transcript |
| `E1-real-noise-heavy` | 29.4 | LibriSpeech `dev-clean`, speaker 1272 + pink noise a=0.14 | dataset transcript |
| `E2-real-noise-heavy` | 9.0 | LibriSpeech `dev-clean`, speaker 1272 + pink noise a=0.14 | dataset transcript |
| `B-hard` | 11.2 | 1961 public-domain public speech (Boston accent), band-limited to telephone range, echo and pink noise added | own transcription |

LibriSpeech is distributed under CC BY 4.0. The 1961 recording is public
domain. `A-clean` and the `B-hard` transcription are original to this
benchmark and released under CC BY 4.0 along with everything else here.

Known provenance gap: only the LibriSpeech **speaker** (1272) was recorded, not
the individual utterance ids. The transcripts in this directory are the exact
strings that were scored, so the WER figures are reproducible from them — but
you will have to find the matching utterances in `dev-clean` yourself.

The Mandarin clip (23.088 s, 97 characters) is original audio recorded for this
benchmark. Its reference text is not published here because it contains a
personal schedule; the character count (97), the error count and the six
residual errors are published in `../data/chinese-residual-errors.md`.
