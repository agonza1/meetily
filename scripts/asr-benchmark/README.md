# Kokoro meeting transcription fixture

Generate two versions of the same scripted, three-person meeting. The clean version leaves a gap between turns. The overlap version puts five interruptions over the preceding speaker. Both use the same reference, including the interruptions, in speaker onset order.

## Generate the clips

Use Python 3.12 and put FFmpeg on PATH. Run the commands below from the repository root. The virtual environment, Kokoro files, and outputs live outside the checkout.

```sh
fixture_dir=$(mktemp -d "${TMPDIR:-/tmp}/meetily-kokoro.XXXXXX")
python3.12 -m venv "$fixture_dir/env"
"$fixture_dir/env/bin/pip" install 'kokoro-onnx==0.6.1'

model_release=https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.1
curl -fL "$model_release/kokoro-v1.0.onnx" -o "$fixture_dir/kokoro-v1.0.onnx"
curl -fL "$model_release/voices-v1.0.bin" -o "$fixture_dir/voices-v1.0.bin"

"$fixture_dir/env/bin/python" scripts/asr-benchmark/kokoro_meeting.py \
  --model "$fixture_dir/kokoro-v1.0.onnx" \
  --voices "$fixture_dir/voices-v1.0.bin" \
  --output "$fixture_dir/audio"
```

The generator writes 16 kHz mono `clean.wav`, `overlap.wav`, and `reference.txt`. [Kokoro model card](https://huggingface.co/hexgrad/Kokoro-82M) · [ONNX release files](https://github.com/thewh1teagle/kokoro-onnx/releases/tag/model-files-v1.1)

## Score a transcript

In Meetily, use **Import Audio** to select either WAV. Open the resulting meeting and use **Copy Transcript**. Save the pasted text as a text file and remove the title and date lines from the export. The scorer removes bracketed timestamps.

```sh
python3 scripts/asr-benchmark/wer.py "$fixture_dir/audio/reference.txt" /path/to/transcript.txt
```

Word error rate is the number of substitutions, deletions, and insertions divided by the reference word count. The scorer ignores case and punctuation. Differences in numbers written as digits versus words still count. Overlapping words are scored in scripted turn order, so a correct word in a different order can still count as an error. The clips are synthetic and contain no room noise.

## Reference run

On an Apple M4 with 24 GB RAM, the local Meetily final-transcription implementation and the RTC-ASR MLX adapter used the same Parakeet TDT 0.6B v3 model family and matching 24-second windows with one second of context on each side. Results are medians of three trials after model initialization. The Meetily times cover the native final-transcription function.

| Clip | Meetily ONNX INT8 WER / time | RTC-ASR MLX WER / time |
| --- | ---: | ---: |
| Clean · 166.1 s | 3.33% / 6.79 s | 7.62% / 3.71 s |
| Overlap · 161.1 s | 5.00% / 6.65 s | 7.14% / 3.62 s |
