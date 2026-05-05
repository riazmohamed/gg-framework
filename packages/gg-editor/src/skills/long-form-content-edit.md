---
name: long-form-content-edit
description: Recipe for podcasts, interviews, vlogs, courses, talking-head. Five-pass method: utterance segmentation → take detection → filler removal → incomplete-sentence trim → silence normalization. Wires transcribe, cluster_takes, detect_silence, write_edl, import_edl, write_srt, add_marker into a single workflow.
---

# long-form-content-edit

**When to use:** podcasts, interviews, vlogs, courses, talking-head — anything
where a person speaks for >5 minutes and the editorial work is take-selection,
filler removal, silence trimming, and pacing.

**Goal:** turn a raw recording into a tight, watchable cut without losing the
speaker's voice or the moments that matter. Captions are non-negotiable.

---

## The 5-pass method

These run in order. Each pass narrows the cut. Don't skip — passes 1–2 are
where 80% of the time savings live.

### Pass 1 — Utterance segmentation

```
probe_media(input)                       → fps, duration
extract_audio(input, audio.wav, 16000)
transcribe(audio.wav, transcript.json)   → segment-level transcript
```

Now you have a segment list keyed by start/end seconds. Treat each segment as
the smallest editorial unit. Don't cut inside a segment unless the speaker
changes mid-segment.

### Pass 2 — Take detection

```
cluster_takes(transcript.json)           → groups of similar segments
```

Multi-member clusters mean the speaker re-took a line. Pick the winner per
cluster:

- **Default to the last take** — speaker had practice.
- **Visual doubt** → `score_shot(times=[mid of each member])`, pick highest.
- **Audio doubt** → `read_transcript(startSec=A, endSec=B)` to inspect.
- Add a marker on each decision: `add_marker(color="green", note="kept: take 3 of 3 — strongest delivery")`.

### Pass 3 — Filler removal

For each kept segment, look for these and add cut markers:

- "um", "uh", "like" used as filler (not as comparison)
- restart phrases: "so the thing is — actually, the thing is…"
- mid-sentence aborts the speaker self-corrected past

Mark each one with `add_marker(color="red", note="cut: filler 'um'")`.

### Pass 4 — Incomplete-sentence trim

Drop segments that:

- Trail off with no point ("…and yeah, anyway")
- Start mid-thought because the previous take was kept
- Repeat content already covered in a kept take

`add_marker(color="red", note="cut: incomplete; covered in earlier take")`.

### Pass 5 — Silence normalization

```
detect_silence(input)                    → frame-aligned KEEP ranges
```

Use the KEEP ranges to remove dead air >1s. Don't kill all silence —
breathing space matters for pacing. The default threshold usually leaves
natural pauses intact.

---

## Final assembly

Combine pass-2 winners + pass-3/4 surviving segments into a single decision
list. Each entry is one EDL event.

```
write_edl(events=decisions, frameRate=fps)
import_edl(path)
```

Then captions:

```
write_srt(cues=transcript.segments mapped to start/end/text)
import_subtitles(srtPath)
```

For long-form: sidecar SRT (don't burn in) so YouTube/podcast players can
toggle them. Mention this to the user.

---

## Red flags — pause and ask

- Cluster has takes that are roughly equal quality — `add_marker(color="red", note="PAUSE: which take? 1=A, 2=B")` and stop.
- Segment is editorial-content-bearing but has bad audio — flag, don't drop.
- The user said "trim filler" but every "um" is intentional emphasis (rare but real) — confirm.

## Don't

- Don't render until the user reviews the markers.
- Don't read full transcript without `startSec/endSec` — context blow-up.
- Don't cut inside a segment unless the speaker changes mid-segment.
- Don't skip captions for long-form unless explicitly told to.
