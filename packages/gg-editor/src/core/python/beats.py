#!/usr/bin/env python3
"""Beat detection sidecar.

Reads JSON on stdin: {"audioPath": "...", "sr": <optional int>}
Writes JSON on stdout: {"tempo": float, "beats": [seconds...], "durationSec": float}

On error: prints {"error": "...", "trace": "..."} to stdout and exits 1.

Required deps:  pip install librosa numpy soundfile
"""
import sys
import json
import traceback


def main():
    try:
        import librosa  # noqa: F401  (heavy import — failure surfaces as ImportError below)
        import numpy as np
    except ImportError as e:
        print(json.dumps({
            "error": f"missing python dep: {e.name}; install librosa numpy soundfile",
        }))
        sys.exit(1)

    raw = sys.stdin.read() or "{}"
    try:
        args = json.loads(raw)
    except Exception as e:
        print(json.dumps({"error": f"invalid stdin JSON: {e}"}))
        sys.exit(1)

    audio_path = args.get("audioPath")
    if not audio_path:
        print(json.dumps({"error": "missing required arg: audioPath"}))
        sys.exit(1)
    sr = args.get("sr")  # may be None — librosa default

    y, sr_used = librosa.load(audio_path, sr=sr, mono=True)
    duration = float(librosa.get_duration(y=y, sr=sr_used))
    tempo, beats = librosa.beat.beat_track(y=y, sr=sr_used, units="time")
    # librosa>=0.10 returns numpy 1d array for tempo; collapse to scalar.
    if hasattr(tempo, "__len__"):
        tempo = float(np.atleast_1d(tempo)[0])

    print(json.dumps({
        "tempo": float(tempo),
        "beats": [float(b) for b in beats],
        "durationSec": duration,
    }))


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(json.dumps({
            "error": str(e),
            "trace": traceback.format_exc()[-500:],
        }))
        sys.exit(1)
