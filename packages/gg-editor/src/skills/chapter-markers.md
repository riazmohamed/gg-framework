# chapter-markers

**When to use:** YouTube videos, podcasts, courses, long-form interviews. The
user wants chapter timestamps the audience can jump to.

**Goal:** derive 5–15 semantic chapter boundaries from a transcript, drop a
timeline marker at each one, and (optionally) emit a YouTube-formatted
description block.

---

## Recipe

### 1. Get a transcript

```
probe_media(input)
extract_audio(input, audio.wav, 16000)
transcribe(audio.wav, transcript.json)
```

### 2. Read with topic-shift framing

DON'T dump the whole transcript. Read in 60–120 second windows and look for
**topic shifts** — sentences that change subject, introduce a new question,
move from setup to payoff, etc.

```
read_transcript(transcript.json, startSec=0, endSec=120)
read_transcript(transcript.json, startSec=120, endSec=240)
...
```

For each window, identify ZERO or ONE chapter start. Skip windows with no
clear topic boundary.

### 3. Constraints (YouTube specifics)

- First chapter MUST be `00:00` (YouTube's rule).
- Chapters must be ≥10 seconds apart.
- Aim for 5–15 chapters total. Fewer is fine; more crowds the scrubber.
- Title each chapter with **3–6 words**, plain language, no clickbait.
  - ✅ `"Why most edits fail"`
  - ❌ `"You won't believe this insane editing tip!!"`

### 4. Drop markers + emit description

For each chapter:

```
add_marker(frame=<sec * fps>, color="purple", note="Chapter: <title>")
```

Then output a YouTube-formatted block to the user as a chat message:

```
00:00 Intro
01:42 Why most edits fail
04:30 The 3-pass method
...
```

This block lives in the YouTube description; markers in the timeline help the
user verify before publishing.

---

## Defaults

| Knob | Default | Why |
|---|---|---|
| Marker color | purple | Distinct from take/cut markers |
| Min chapter length | 30s | YouTube standard |
| Max chapters | 15 | Audience scrubber readability |
| Window size for reading | 90s | Balances context vs. token cost |

## Red flags — pause and ask

- Transcript is monologue with no clear topic shifts → tell the user; suggest
  manual chapter input rather than fabricating boundaries.
- Video is <5 minutes total — chapters add noise. Tell the user; ask to skip.
- User wants "chapters that match my outline" without supplying one → ask for
  the outline. Don't guess from headings in the script alone.

## Don't

- Don't invent topic boundaries to hit a target count.
- Don't use timestamps you didn't verify with `read_transcript` (including the
  text at that timestamp). Drift kills the feature.
- Don't burn chapters into video — markers + description block only.
- Don't render until the user reviews the chapters.
