#!/usr/bin/env bash
# Build the file set behind data/video-track-ignored.csv (measured 2026-10-11).
#
# One 9.984 s speech clip is muxed into nine files. Seven of them carry the same
# audio track and differ only in the container and in the picture attached to
# it — including one with no picture at all and one at 1920x1080 / 30 fps. One
# carries a picture and no audio track at all. One carries the same picture as
# another but different speech.
#
# ffmpeg 9.0.1 (gyan.dev full build) was used. Byte counts depend on the x264
# build, so a re-run elsewhere will not reproduce the sizes exactly; the
# decoded geometry and the page's behaviour are the reproducible parts.
#
#   bash build-video-track-set.sh <out-dir> <speech-a.mp3> <speech-b.mp3>
#
set -e
OUT="${1:-.}"
A="${2:?path to the first speech mp3}"
B="${3:?path to the second speech mp3}"
mkdir -p "$OUT"
cd "$OUT"

# the same speech, no picture
ffmpeg -y -v error -i "$A" -c:a aac -b:a 128k a-only.m4a
ffmpeg -y -v error -i "$A" -c:a libmp3lame -b:a 128k a-only.mp3

# the same speech, plus a picture at three sizes
ffmpeg -y -v error -f lavfi -i testsrc2=size=64x64:rate=1 -i "$A" \
  -map 0:v -map 1:a -c:v libx264 -preset ultrafast -crf 30 -pix_fmt yuv420p \
  -c:a aac -b:a 128k -shortest v-64.mp4
ffmpeg -y -v error -f lavfi -i testsrc2=size=320x240:rate=10 -i "$A" \
  -map 0:v -map 1:a -c:v libx264 -preset ultrafast -crf 30 -pix_fmt yuv420p \
  -c:a aac -b:a 128k -shortest v-320.mp4
ffmpeg -y -v error -f lavfi -i testsrc2=size=1920x1080:rate=30 -i "$A" \
  -map 0:v -map 1:a -c:v libx264 -preset ultrafast -crf 18 -pix_fmt yuv420p \
  -c:a aac -b:a 128k -shortest v-1080.mp4

# the same picture and speech in two more containers
ffmpeg -y -v error -f lavfi -i testsrc2=size=1920x1080:rate=30 -i "$A" \
  -map 0:v -map 1:a -c:v libx264 -preset ultrafast -crf 18 -pix_fmt yuv420p \
  -c:a aac -b:a 128k -shortest v-1080.mov
ffmpeg -y -v error -f lavfi -i testsrc2=size=1920x1080:rate=30 -i "$A" \
  -map 0:v -map 1:a -c:v libx264 -preset ultrafast -crf 18 -pix_fmt yuv420p \
  -c:a aac -b:a 128k -shortest v-1080.mkv

# a picture and no audio track
ffmpeg -y -v error -f lavfi -i testsrc2=size=320x240:rate=10 -t 10 \
  -c:v libx264 -preset ultrafast -crf 30 -pix_fmt yuv420p -an no-audio.mp4

# the same picture as v-320.mp4, different speech
ffmpeg -y -v error -f lavfi -i testsrc2=size=320x240:rate=10 -i "$B" \
  -map 0:v -map 1:a -c:v libx264 -preset ultrafast -crf 30 -pix_fmt yuv420p \
  -c:a aac -b:a 128k -shortest v-320-otheraudio.mp4

ls -l
