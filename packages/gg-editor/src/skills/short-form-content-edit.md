# short-form-content-edit

**When to use:** TikTok / Reels / Shorts / vertical clips. Source is usually
a longer horizontal video the user wants reframed, captioned, hooked, and
shipped.

**Goal:** the first 2 seconds win or lose retention. The cut, the caption,
and the hook all serve that one number.

---

## Recipe

### 1. Find the moment

If the user gives you a horizontal video without timestamps, find the moment
worth clipping:

```
probe_media(input)
extract_audio(input, audio.wav, 16000)
transcribe(audio.wav, transcript.json)
read_transcript(transcript.json, contains="<keyword from user>")
```

Or for visual moments: `score_shot(input, intervalSec=15)` then inspect tops.

Settle on a `[startSec, endSec]` window. Aim for **15–60 seconds** for shorts;
90s max for Reels.

### 2. Reformat to vertical

Build the vertical timeline as FCPXML and import:

```
reformat_timeline(
  output="vertical.fcpxml",
  preset="9:16",
  title="<short name>",
  frameRate=<source fps>,
  events=[{ reel, sourcePath, sourceInFrame, sourceOutFrame }]
)
import_edl("vertical.fcpxml")
```

Then on Resolve Studio, switch to color page and prompt the user to apply
Smart Reframe per clip:

```
open_page("color")
add_marker(color="yellow", note="apply Smart Reframe per clip (Resolve Studio: right-click clip → Smart Reframe)")
```

Premiere users: prompt for Auto Reframe via the captions/effects panel.

### 3. Hook the first 2 seconds

The hook lives in the first 60 frames. Options:

- **Cold-open the punchline** — start at the most attention-grabbing line,
  not the setup. Use `read_transcript` to find it.
- **Speed-up the intro** — `set_clip_speed(clipId, speed=1.5)` on the opening clip.
- **Pre-roll text/marker** — `add_marker(color="yellow", note="add hook text overlay: '<line from transcript>'")` for the user to add.

### 4. Burned-in captions

Vertical = burned-in (most viewers watch muted, native captions are tiny).

```
write_srt(cues=transcript.segments_in_window)
import_subtitles(srtPath)
add_marker(color="yellow", note="style captions: large, center-bottom, high-contrast — burn in via Resolve subtitle track styling")
```

If the user is on Resolve Studio, they can right-click the subtitle track →
"Convert Subtitles to Text+" and style it. Note this to them.

### 5. Render

Don't render until the user reviews. When they say "render":

```
render(preset=<host preset>, output="<name>.mp4")
```

Common presets: H.264 Master, YouTube 1080p (works for Shorts too),
Vimeo 1080p.

---

## Defaults for short-form

| Knob | Default | Why |
|---|---|---|
| Aspect | 9:16 (TikTok/Reels/Shorts) | Most platforms |
| Length | 15–60s | Algorithm sweet spot |
| Captions | burned-in | Watched muted |
| First 2s | the hook | Retention curve |
| Music | not added by you | Style decision; ask the user |

## Red flags — pause and ask

- User wants 9:16 but the source has critical wide-shot framing → `add_marker(color="red", note="PAUSE: source is composed for 16:9. 9:16 will crop heads/sides. Confirm reframe vs. letterbox.")`.
- Window selection is ambiguous → propose 2–3 candidates as red markers, stop.
- No clear hook in the chosen window → say so, suggest a different start.

## Don't

- Don't render until the user reviews markers.
- Don't burn captions before the user approves the SRT text.
- Don't pick a hook blindly — surface options.
- Don't leave silence >0.4s in the first 2 seconds.
