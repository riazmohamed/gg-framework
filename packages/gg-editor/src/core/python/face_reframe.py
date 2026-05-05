#!/usr/bin/env python3
"""Face-tracked reframe analysis sidecar.

Reads JSON on stdin:
  {
    "videoPath": "...",
    "sampleFps": <float, default 5.0>,
    "minDetectionConfidence": <float, default 0.5>,
    "smoothingWindowSec": <float, default 0.5>
  }

Writes JSON on stdout:
  {
    "shots": [{startSec, endSec, frames: [...], smoothedX, smoothedY, mode}],
    "totalSec": float,
    "fps": float,
    "sourceWidth": int,
    "sourceHeight": int
  }

On error: prints {"error": "...", "trace": "..."} to stdout and exits 1.

Pipeline:
  1. PySceneDetect (ContentDetector) -> shot boundaries.
  2. For each shot, sample at sampleFps and run MediaPipe face_detection
     (model_selection=1, full-range).
  3. Pick the largest detection per frame; collect normalized centre.
  4. Smooth via median (robust to dropouts) per shot. Mark shot as
     "static" when no detections were found.

Required deps:  pip install opencv-python mediapipe scenedetect numpy
"""
import sys
import json
import traceback


def main():
    try:
        import cv2
        import numpy as np
        import mediapipe as mp
        from scenedetect import detect, ContentDetector
    except ImportError as e:
        print(json.dumps({
            "error": (
                f"missing python dep: {e.name}; "
                "install: pip install opencv-python mediapipe scenedetect numpy"
            ),
        }))
        sys.exit(1)

    raw = sys.stdin.read() or "{}"
    try:
        args = json.loads(raw)
    except Exception as e:
        print(json.dumps({"error": f"invalid stdin JSON: {e}"}))
        sys.exit(1)

    video = args.get("videoPath")
    if not video:
        print(json.dumps({"error": "missing required arg: videoPath"}))
        sys.exit(1)
    sample_fps = float(args.get("sampleFps", 5.0))
    min_conf = float(args.get("minDetectionConfidence", 0.5))
    # smooth_win currently informs window selection; we use a robust median
    # over all in-shot samples which is tolerant to dropouts.
    _smooth_win = float(args.get("smoothingWindowSec", 0.5))  # noqa: F841

    cap = cv2.VideoCapture(video)
    if not cap.isOpened():
        print(json.dumps({"error": f"cannot open video: {video}"}))
        sys.exit(1)
    src_fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    src_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    src_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    duration = total_frames / src_fps if src_fps > 0 else 0.0

    # PySceneDetect — falls back to whole video if it errors.
    try:
        scenes = detect(video, ContentDetector(threshold=27))
        shots = [(s[0].get_seconds(), s[1].get_seconds()) for s in scenes]
    except Exception:
        shots = []
    if not shots:
        shots = [(0.0, duration)]

    detector = mp.solutions.face_detection.FaceDetection(
        model_selection=1, min_detection_confidence=min_conf,
    )

    out_shots = []
    sample_step = max(1, int(round(src_fps / sample_fps))) if sample_fps > 0 else 1
    for shot_start, shot_end in shots:
        frames_data = []
        f0 = int(shot_start * src_fps)
        f1 = int(shot_end * src_fps)
        for f in range(f0, f1, sample_step):
            cap.set(cv2.CAP_PROP_POS_FRAMES, f)
            ok, img = cap.read()
            if not ok:
                continue
            t = f / src_fps if src_fps > 0 else 0.0
            rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
            res = detector.process(rgb)
            if res.detections:
                # Pick the largest face (in normalized area).
                best = max(
                    res.detections,
                    key=lambda d: (
                        d.location_data.relative_bounding_box.width
                        * d.location_data.relative_bounding_box.height
                    ),
                )
                bb = best.location_data.relative_bounding_box
                cx = bb.xmin + bb.width / 2
                cy = bb.ymin + bb.height / 2
                frames_data.append({
                    "atSec": t,
                    "faceCx": float(cx),
                    "faceCy": float(cy),
                    "faceW": float(bb.width),
                    "faceH": float(bb.height),
                })

        if frames_data:
            xs = np.array([d["faceCx"] for d in frames_data])
            ys = np.array([d["faceCy"] for d in frames_data])
            mode = "face"
            sx = float(np.median(xs))
            sy = float(np.median(ys))
        else:
            mode = "static"
            sx, sy = 0.5, 0.5
        out_shots.append({
            "startSec": float(shot_start),
            "endSec": float(shot_end),
            "frames": frames_data,
            "smoothedX": sx,
            "smoothedY": sy,
            "mode": mode,
        })

    cap.release()
    print(json.dumps({
        "shots": out_shots,
        "totalSec": float(duration),
        "fps": float(src_fps),
        "sourceWidth": src_w,
        "sourceHeight": src_h,
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
