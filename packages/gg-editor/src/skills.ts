/**
 * Bundled skill markdowns. Auto-generated from src/skills/*.md by
 * scripts/build-skills.mjs — DO NOT EDIT BY HAND. Add a new skill by
 * dropping a .md file in src/skills/ (with optional YAML frontmatter)
 * and re-running `node scripts/build-skills.mjs`.
 *
 * Skills are exposed through the read_skill tool; their descriptions live
 * in the system prompt. Pattern follows the Anthropic skill convention:
 * description in the prompt, full content on demand.
 */

export interface BundledSkill {
  name: string;
  description: string;
  content: string;
}

const CHAPTER_MARKERS = `---
name: chapter-markers
description: Author YouTube/podcast chapter timestamps from a transcript: 5–15 chapters, first at 00:00, ≥30s apart, only at real topic shifts. Drops purple markers + emits a YouTube-formatted description block.
---

# chapter-markers

**When to use:** YouTube videos, podcasts, courses, long-form interviews. The
user wants chapter timestamps the audience can jump to.

**Goal:** derive 5–15 semantic chapter boundaries from a transcript, drop a
timeline marker at each one, and (optionally) emit a YouTube-formatted
description block.

---

## Recipe

### 1. Get a transcript

\`\`\`
probe_media(input)
extract_audio(input, audio.wav, 16000)
transcribe(audio.wav, transcript.json)
\`\`\`

### 2. Read with topic-shift framing

DON'T dump the whole transcript. Read in 60–120 second windows and look for
**topic shifts** — sentences that change subject, introduce a new question,
move from setup to payoff, etc.

\`\`\`
read_transcript(transcript.json, startSec=0, endSec=120)
read_transcript(transcript.json, startSec=120, endSec=240)
...
\`\`\`

For each window, identify ZERO or ONE chapter start. Skip windows with no
clear topic boundary.

### 3. Constraints (YouTube specifics)

- First chapter MUST be \`00:00\` (YouTube's rule).
- Chapters must be ≥10 seconds apart.
- Aim for 5–15 chapters total. Fewer is fine; more crowds the scrubber.
- Title each chapter with **3–6 words**, plain language, no clickbait.
  - ✅ \`"Why most edits fail"\`
  - ❌ \`"You won't believe this insane editing tip!!"\`

### 4. Drop markers + emit description

For each chapter:

\`\`\`
add_marker(frame=<sec * fps>, color="purple", note="Chapter: <title>")
\`\`\`

Then output a YouTube-formatted block to the user as a chat message:

\`\`\`
00:00 Intro
01:42 Why most edits fail
04:30 The 3-pass method
...
\`\`\`

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
- Don't use timestamps you didn't verify with \`read_transcript\` (including the
  text at that timestamp). Drift kills the feature.
- Don't burn chapters into video — markers + description block only.
- Don't render until the user reviews the chapters.
`;

const FUSION_LOWER_THIRD = `---
name: fusion-lower-third
description: Build a name/title chyron natively in DaVinci Resolve's Fusion via fusion_comp — Background + TextPlus + Merge node graph, wiring, styling, lower-third positioning, keyframed fade in/out. Resolve Studio only; cross-host fallback is write_lower_third + burn_subtitles.
---

# fusion-lower-third

**When to use:** the user asks for a name/title chyron that should be
*editable inside the NLE* (not baked-in pixels), or wants a quick
title card built natively in DaVinci Resolve's Fusion page.

**Goal:** compose a Background + TextPlus + Merge graph in Fusion via
\`fusion_comp\`. Resolve only — Premiere has no Fusion equivalent; for
that, fall back to \`write_lower_third\` + \`burn_subtitles\`.

---

## When to pick which

- **fusion_comp** — Resolve, comp lives inside the project, user can
  tweak it later. Best when the user is already on the Fusion page or
  wants a chyron that travels with the project file.
- **write_lower_third + burn_subtitles** — works on any host, output
  is a baked-in pixel layer. Faster to iterate from the agent side
  but the user can no longer edit the text without re-running the
  pipeline.

If unsure, ask: "Resolve-native (editable) or baked-in?"

---

## Recipe — name + title lower-third on the active comp

Pre-flight: \`host_info\` must report \`name === "resolve"\`. If it doesn't,
stop and tell the user this skill is Resolve-only.

\`\`\`
host_info                                # confirm Resolve

# 1. Get to the Fusion page so the user can see the result.
open_page(name="fusion")

# 2. Build the graph.
fusion_comp(action="add_node", toolId="Background", name="LT_Strap")
fusion_comp(action="add_node", toolId="TextPlus",   name="LT_Text")
fusion_comp(action="add_node", toolId="Merge",      name="LT_Comp")

# 3. Wire it: strap as Background, text as Foreground.
fusion_comp(action="connect", fromNode="LT_Strap", toNode="LT_Comp",
            toInput="Background")
fusion_comp(action="connect", fromNode="LT_Text",  toNode="LT_Comp",
            toInput="Foreground")

# 4. Set the text content + colour.
fusion_comp(action="set_input", node="LT_Text", input="StyledText",
            value="<Name>\\n<Title>")
fusion_comp(action="set_input", node="LT_Text", input="Size",  value=0.06)
fusion_comp(action="set_input", node="LT_Text", input="Color1Red",   value=1)
fusion_comp(action="set_input", node="LT_Text", input="Color1Green", value=1)
fusion_comp(action="set_input", node="LT_Text", input="Color1Blue",  value=1)

# 5. Park the strap in the lower-left third.
fusion_comp(action="set_input", node="LT_Strap", input="TopLeftRed",   value=0)
fusion_comp(action="set_input", node="LT_Strap", input="TopLeftGreen", value=0)
fusion_comp(action="set_input", node="LT_Strap", input="TopLeftBlue",  value=0)
fusion_comp(action="set_input", node="LT_Strap", input="TopLeftAlpha", value=0.85)
\`\`\`

The Merge node is the comp's MediaOut by default; the user sees the
result on the active timeline clip immediately.

---

## Animating in / out

Use \`set_keyframe\` on the Merge's \`Blend\` input (overall opacity):

\`\`\`
fusion_comp(action="set_keyframe", node="LT_Comp", input="Blend",
            frame=0,  value=0)        # invisible at clip start
fusion_comp(action="set_keyframe", node="LT_Comp", input="Blend",
            frame=12, value=1)        # fade in over 12f
fusion_comp(action="set_keyframe", node="LT_Comp", input="Blend",
            frame=72, value=1)        # hold
fusion_comp(action="set_keyframe", node="LT_Comp", input="Blend",
            frame=84, value=0)        # fade out
\`\`\`

Frames are relative to the comp's render range — set it explicitly if
the agent needs to control the in/out range:

\`\`\`
fusion_comp(action="set_render_range", start=0, end=120)
\`\`\`

---

## Targeting a specific clip's comp

Pass \`clipId\` to scope every action to that clip's first Fusion comp
(auto-created if the clip has none). Useful for batched lower-thirds
across multiple clips:

\`\`\`
get_timeline                                          # discover clipIds
fusion_comp(action="add_node", toolId="TextPlus",
            name="LT_Text", clipId="<clipId>")
\`\`\`

---

## Troubleshooting

- **\`Resolve.Fusion() unavailable\`** — Resolve build is too old or
  user is on a free seat. Fusion is Studio-only at scriptable depth.
- **\`No active Fusion comp\`** — user hasn't switched to the Fusion
  page on a clip with a comp. Either call \`open_page("fusion")\` first
  on a known clip, or pass \`clipId\` so we operate on that clip's comp
  directly.
- **\`AddTool('X') returned None\`** — \`toolId\` is wrong. The canonical
  IDs the agent will hit: \`Background\`, \`TextPlus\`, \`Merge\`,
  \`Transform\`, \`ColorCorrector\`, \`DeltaKeyer\`, \`Brightness\`, \`Glow\`,
  \`Blur\`. There's no scriptable enumeration; check Fusion's docs if
  the user names a tool not in this list.
`;

const KEYFRAMING_AND_TITLES = `---
name: keyframing-and-titles
description: Recipes for the seven scripting gaps neither Resolve nor Premiere expose: timeline reorder, multi-track lanes, lower-thirds + title cards (ASS), keyframed opacity/position/volume ramps, audio mixing chains (EQ + comp + gate + de-esser + limiter), speed ramps, Ken-Burns, named transitions (smash-cut, whip-pan, dip-to-black).
---

# keyframing-and-titles

**When to use:** the user asks to reorder clips, animate fades / pans /
zooms, add lower-thirds or title cards, build coordinated multi-track
B-roll compositions, or do speed ramps.

**Goal:** these are the seven gaps neither Resolve nor Premiere exposes
through their scripting APIs. The agent's path is FCPXML rebuild for
timeline-shape changes (reorder, lanes, keyframes, titles) and
file-only ffmpeg passes for content-shape changes (speed ramps, mixing,
zoom-on-stills, transitions).

---

## Recipe 1 — Reorder clips on the timeline

The user says "move clip 5 to the start" or "swap clips 2 and 3".

\`\`\`
get_timeline                                  # discover clipIds in order
clone_timeline(newName="<original>-v2")       # safety net
reorder_timeline(newOrder=["c5","c1","c2","c3","c4"])
\`\`\`

\`reorder_timeline\` reads the current timeline, emits a permuted FCPXML,
and \`import_timeline\`s it. Clips not listed in \`newOrder\` keep their
original relative order and append at the end.

---

## Recipe 2 — Multi-track B-roll composition

The user wants several B-roll cutaways stacked above the main A-roll
with per-clip opacity and timing.

\`\`\`
clone_timeline(newName="<original>-broll")
compose_layered(
  title="<sequence name>",
  frameRate=<source fps>,
  layers=[
    # Main spine (lane 0)
    { reel:"main", sourcePath:"main.mov", sourceInFrame:0, sourceOutFrame:1800,
      lane:0, recordOffsetFrame:0 },
    # B-roll on lane 1 with a 30-frame opacity fade-in
    { reel:"broll1", sourcePath:"broll-coffee.mov", sourceInFrame:0,
      sourceOutFrame:120, lane:1, recordOffsetFrame:300,
      opacity:{ keyframes:[
        { frame:0,   value:0 },
        { frame:30,  value:1, interp:"easeOut" },
        { frame:90,  value:1 },
        { frame:120, value:0, interp:"easeIn" }
      ] } }
  ]
)
\`\`\`

For single-clip layers without keyframes, \`insert_broll\` is simpler.

---

## Recipe 3 — Lower-thirds + title cards

Both go through \`.ass\` (Advanced SubStation Alpha) files because stock
Homebrew ffmpeg doesn't ship \`drawtext\`. Pair with \`burn_subtitles\` to
bake into a finished video.

\`\`\`
write_lower_third(
  output="lt.ass", width=1920, height=1080,
  items=[{
    primaryText:"Jane Doe",
    secondaryText:"Director, Cinema Co.",
    startSec:8, durationSec:4,
    position:"bottom-left",
    animation:"slide-left",
    primaryColor:"FFFFFF", accentColor:"000000"
  }]
)
write_title_card(
  output="cards.ass", width=1920, height=1080,
  items=[{ text:"Chapter 1", startSec:0, durationSec:3,
           animation:"fade-in-out", fontSize:140 }]
)
burn_subtitles(input="rough.mp4", subtitles="lt.ass", output="rough+lt.mp4")
burn_subtitles(input="rough+lt.mp4", subtitles="cards.ass", output="final.mp4")
\`\`\`

To keep titles editable inside the NLE instead of baked, use
\`write_fcpxml\` with the \`titles\` field, then \`import_edl\`.

---

## Recipe 4 — Speed ramps

Cinematic slow-down-then-resume:

\`\`\`
speed_ramp(
  input="action.mp4", output="action.ramped.mp4",
  points=[
    { atSec:0,   speed:1   },   # normal
    { atSec:2.5, speed:0.4 },   # slow-mo
    { atSec:4.0, speed:1   }    # back to normal
  ]
)
\`\`\`

Audio is time-stretched via atempo, no pitch shift. For ramps where
you want video without audio: pass \`muteAudio=true\`.

---

## Recipe 5 — Audio mixing per clip

Voice-preset:

\`\`\`
mix_audio(
  input="raw.wav", output="raw.mixed.wav",
  eq=[
    { type:"high", freqHz:80 },                       # rumble
    { type:"peak", freqHz:4000, gainDb:3, q:1.5 }     # presence
  ],
  compressor={ thresholdDb:-18, ratio:4, attackMs:20, releaseMs:250, makeupDb:3 },
  deess={ freqHz:6500, thresholdDb:-25 },
  limiter={ ceilingDb:-1 }
)
\`\`\`

Order: \`clean_audio\` (denoise) → \`mix_audio\` (shape) →
\`normalize_loudness\` (target platform LUFS).

---

## Recipe 6 — Ken-Burns on stills

For photo galleries / quote cards / book covers:

\`\`\`
ken_burns(input="photo.jpg", output="photo.kb.mp4",
         durationSec=4, startZoom=1, endZoom=1.4, direction="ne")
\`\`\`

Output is a silent libx264 clip. Then \`concat_videos\` it with main
footage, or \`insert_broll\` it onto a higher track via \`compose_layered\`.

---

## Recipe 7 — Named transitions

For energetic cuts:

\`\`\`
transition_videos(inputA="a.mp4", inputB="b.mp4", output="ab.mp4",
                  preset="whip-left")        # 0.15s wipe
transition_videos(..., preset="smash-cut")    # 1-frame blend, jump-cut feel
transition_videos(..., preset="dip-to-black", durationSec=0.8)
\`\`\`

For raw xfade names beyond the preset list, use \`crossfade_videos\`.

---

## Don't

- Don't render before the user reviews the rebuilt timeline.
- Don't run reorder_timeline / compose_layered without
  \`clone_timeline\` first — the import is destructive.
- Don't try to drawtext on a still frame; ffmpeg doesn't have it on
  most installs. Always go through ASS.
- Don't keyframe opacity / position on Premiere via UXP — it's not
  exposed; emit FCPXML with the keyframes baked in instead.
`;

const LONG_FORM_CONTENT_EDIT = `---
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

\`\`\`
probe_media(input)                       → fps, duration
extract_audio(input, audio.wav, 16000)
transcribe(audio.wav, transcript.json)   → segment-level transcript
\`\`\`

Now you have a segment list keyed by start/end seconds. Treat each segment as
the smallest editorial unit. Don't cut inside a segment unless the speaker
changes mid-segment.

### Pass 2 — Take detection

\`\`\`
cluster_takes(transcript.json)           → groups of similar segments
\`\`\`

Multi-member clusters mean the speaker re-took a line. Pick the winner per
cluster:

- **Default to the last take** — speaker had practice.
- **Visual doubt** → \`score_shot(times=[mid of each member])\`, pick highest.
- **Audio doubt** → \`read_transcript(startSec=A, endSec=B)\` to inspect.
- Add a marker on each decision: \`add_marker(color="green", note="kept: take 3 of 3 — strongest delivery")\`.

### Pass 3 — Filler removal

For each kept segment, look for these and add cut markers:

- "um", "uh", "like" used as filler (not as comparison)
- restart phrases: "so the thing is — actually, the thing is…"
- mid-sentence aborts the speaker self-corrected past

Mark each one with \`add_marker(color="red", note="cut: filler 'um'")\`.

### Pass 4 — Incomplete-sentence trim

Drop segments that:

- Trail off with no point ("…and yeah, anyway")
- Start mid-thought because the previous take was kept
- Repeat content already covered in a kept take

\`add_marker(color="red", note="cut: incomplete; covered in earlier take")\`.

### Pass 5 — Silence normalization

\`\`\`
detect_silence(input)                    → frame-aligned KEEP ranges
\`\`\`

Use the KEEP ranges to remove dead air >1s. Don't kill all silence —
breathing space matters for pacing. The default threshold usually leaves
natural pauses intact.

---

## Final assembly

Combine pass-2 winners + pass-3/4 surviving segments into a single decision
list. Each entry is one EDL event.

\`\`\`
write_edl(events=decisions, frameRate=fps)
import_edl(path)
\`\`\`

Then captions:

\`\`\`
write_srt(cues=transcript.segments mapped to start/end/text)
import_subtitles(srtPath)
\`\`\`

For long-form: sidecar SRT (don't burn in) so YouTube/podcast players can
toggle them. Mention this to the user.

---

## Red flags — pause and ask

- Cluster has takes that are roughly equal quality — \`add_marker(color="red", note="PAUSE: which take? 1=A, 2=B")\` and stop.
- Segment is editorial-content-bearing but has bad audio — flag, don't drop.
- The user said "trim filler" but every "um" is intentional emphasis (rare but real) — confirm.

## Don't

- Don't render until the user reviews the markers.
- Don't read full transcript without \`startSec/endSec\` — context blow-up.
- Don't cut inside a segment unless the speaker changes mid-segment.
- Don't skip captions for long-form unless explicitly told to.
`;

const SHORT_FORM_CONTENT_EDIT = `---
name: short-form-content-edit
description: Recipe for TikTok / Reels / Shorts. Find the moment → reformat 9:16 → hook the first 2 seconds → burn captions → render. Uses reformat_timeline, import_edl, set_clip_speed, write_srt, import_subtitles, open_page (Resolve).
---

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

\`\`\`
probe_media(input)
extract_audio(input, audio.wav, 16000)
transcribe(audio.wav, transcript.json)
read_transcript(transcript.json, contains="<keyword from user>")
\`\`\`

Or for visual moments: \`score_shot(input, intervalSec=15)\` then inspect tops.

Settle on a \`[startSec, endSec]\` window. Aim for **15–60 seconds** for shorts;
90s max for Reels.

### 2. Reformat to vertical

Build the vertical timeline as FCPXML and import:

\`\`\`
reformat_timeline(
  output="vertical.fcpxml",
  preset="9:16",
  title="<short name>",
  frameRate=<source fps>,
  events=[{ reel, sourcePath, sourceInFrame, sourceOutFrame }]
)
import_edl("vertical.fcpxml")
\`\`\`

Then on Resolve Studio, switch to color page and prompt the user to apply
Smart Reframe per clip:

\`\`\`
open_page("color")
add_marker(color="yellow", note="apply Smart Reframe per clip (Resolve Studio: right-click clip → Smart Reframe)")
\`\`\`

Premiere users: prompt for Auto Reframe via the captions/effects panel.

### 3. Hook the first 2 seconds

The hook lives in the first 60 frames. Options:

- **Cold-open the punchline** — start at the most attention-grabbing line,
  not the setup. Use \`read_transcript\` to find it.
- **Speed-up the intro** — \`set_clip_speed(clipId, speed=1.5)\` on the opening clip.
- **Pre-roll text/marker** — \`add_marker(color="yellow", note="add hook text overlay: '<line from transcript>'")\` for the user to add.

### 4. Burned-in captions

Vertical = burned-in (most viewers watch muted, native captions are tiny).

\`\`\`
write_srt(cues=transcript.segments_in_window)
import_subtitles(srtPath)
add_marker(color="yellow", note="style captions: large, center-bottom, high-contrast — burn in via Resolve subtitle track styling")
\`\`\`

If the user is on Resolve Studio, they can right-click the subtitle track →
"Convert Subtitles to Text+" and style it. Note this to them.

### 5. Render

Don't render until the user reviews. When they say "render":

\`\`\`
render(preset=<host preset>, output="<name>.mp4")
\`\`\`

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

- User wants 9:16 but the source has critical wide-shot framing → \`add_marker(color="red", note="PAUSE: source is composed for 16:9. 9:16 will crop heads/sides. Confirm reframe vs. letterbox.")\`.
- Window selection is ambiguous → propose 2–3 candidates as red markers, stop.
- No clear hook in the chosen window → say so, suggest a different start.

## Don't

- Don't render until the user reviews markers.
- Don't burn captions before the user approves the SRT text.
- Don't pick a hook blindly — surface options.
- Don't leave silence >0.4s in the first 2 seconds.
`;

const SKIN_TONE_MATCHING = `---
name: skin-tone-matching
description: Match faces across clips when host scripting can't reach power windows or qualifiers. Two paths: grade_skin_tones (file-only — bakes a vision-derived colorbalance + selectivecolor + eq into a new mp4, pair with replace_clip) and match_clip_color (Resolve only — derives the same grade as a CDL via set_primary_correction).
---

# skin-tone-matching

**When to use:** the host's face looks different across clips — warmer in
one shot, cooler / paler in the next. Different camera, different
location, different white-balance setting, sun behind a cloud. The user
wants the faces to match.

**Goal:** bring the target clip's skin tones toward a reference clip
without re-grading the whole frame. Skin lives in the reds and yellows;
that's where we operate.

---

## Two paths

| Path | When | Where the grade lives |
|---|---|---|
| \`grade_skin_tones\` | works on every host (Resolve, Premiere, no-NLE) | baked into a new file |
| \`match_clip_color\` | Resolve only | non-destructive, in the clip's grade node |

Pick **\`grade_skin_tones\`** when the user is on Premiere, when there's no
NLE, or when they want a finished file they can drop anywhere. Pair with
\`replace_clip\` to swap it onto the timeline.

Pick **\`match_clip_color\`** when the user is on Resolve and wants to keep
the grade tweakable. The tool pipes the CDL through
\`set_primary_correction\`, so the colorist can adjust after.

---

## Recipe

### 1. Pick the frames (most important step)

Vision is only as good as what you show it. For BOTH the reference and
the target:

- The face must be visible and large enough (not a wide shot from across
  the room).
- The lighting on the face must be representative (not the one frame
  where they walked through a shadow).
- Eyes open, mouth not in a weird shape, no motion blur.

Use \`score_shot(input, intervalSec=15)\` or \`extract_frame\` to find good
candidates. If the user already pointed at a moment ("match shot 3 to
shot 1") use those timestamps directly.

### 2. Run the grade

**File-only path (works in every host):**

\`\`\`
grade_skin_tones(
  referenceVideo="<ref.mp4>",
  referenceAtSec=<face-forward time>,
  targetVideo="<tgt.mp4>",
  targetAtSec=<face-forward time>,
  output="<tgt-graded.mp4>"
)
\`\`\`

Returns \`{path, confidence, why, grade}\`. Then:

\`\`\`
replace_clip(clipId="<target clip id>", mediaPath="<tgt-graded.mp4>")
add_marker(color="yellow", note="skin grade: <why>")
\`\`\`

**Resolve non-baked path:**

\`\`\`
match_clip_color(
  referenceVideo="<ref.mp4>",
  referenceAtSec=<face-forward time>,
  targetClipId="<target clip id>",
  targetAtSec=<face-forward time>,
  applyAutomatically=true
)
\`\`\`

Returns \`{applied, confidence, why, grade}\`. The CDL goes into node 1
(or \`nodeIndex=N\` if you want a specific node).

### 3. Check confidence

The model's confidence is the most important field. Always inspect it:

- \`confidence ≥ 0.7\` — apply. Trust the result.
- \`0.4 ≤ confidence < 0.7\` — apply but flag for review:
  \`add_marker(color="yellow", note="skin grade: review — confidence <X>")\`.
- \`confidence < 0.4\` — DO NOT apply. The model is guessing. Tell the
  user what you saw, suggest they grade the shot manually or pick a
  better reference frame.

\`match_clip_color\` enforces this: with \`applyAutomatically=true\`,
confidence < 0.4 returns \`{applied: false}\` and the grade is surfaced
without writing to the node. \`grade_skin_tones\` always bakes the file
because the agent asked for an output path — but you can re-run with a
better reference frame if confidence was low.

---

## Defaults

| Knob | Default | Why |
|---|---|---|
| Vision detail | \`low\` | cheap; skin balance doesn't need pixel-peeping |
| Vision model | \`gpt-4o-mini\` | well-calibrated for color comparisons |
| Output codec | \`libx264 crf=18\` | visually lossless |
| Reference frame width | 768px | enough for skin-tone discrimination |

---

## What this is NOT

- NOT a deterministic ColorChecker match. There's no chart, no
  colorimetry — it's a vision pass.
- NOT a substitute for a colorist. Power windows / qualifiers / curves
  are out of scope. If skin needs to be isolated from a colored
  background, surface that and stop.
- NOT for whole-look matching across a project. For session-wide LUT
  application use \`apply_lut\` + \`copy_grade\`.

---

## Red flags — pause and ask

- Reference and target are filmed under fundamentally different
  lighting (tungsten vs daylight) → confidence will be low. Tell the
  user and suggest a less aggressive match (or LUT-based correction
  first).
- Target shot has multiple people with different skin tones → the
  vision model averages. Pick the primary face's frame and warn the
  user the secondary face may shift.
- User wants pixel-perfect match across 50 clips → run on a hero pair,
  then \`copy_grade(sourceClipId=hero, targetClipIds=[...])\` instead of
  re-running vision on every clip.

## Don't

- Don't pick a target frame where the face is in shadow or motion blur.
- Don't apply low-confidence grades silently.
- Don't run on top of an existing aggressive grade — clean state first
  or expect compounding shifts.
- Don't bake \`grade_skin_tones\` over the original target file. Always
  write to a new path.
`;

const VIRAL_HOOK_PATTERNS = `---
name: viral-hook-patterns
description: Hook patterns sourced from primary creators (Jenny Hoyos on the official YouTube Blog, the leaked MrBeast production manual, Paddy Galloway's data analyses) — not generic creator-folklore. Read when analyze_hook fails, when picking a find_viral_moments candidate, or when generate_youtube_metadata needs a punchier title. Each pattern names a real creator example, the primary source, and the failure mode.
---

# viral-hook-patterns

**When to use:** the user wants a stronger opener, a Short's hook scored < 60 in \`analyze_hook\`, or \`generate_youtube_metadata\` needs to phrase a title around a proven structure. Also useful when picking which \`find_viral_moments\` candidate to ship — the candidate's \`hookLine\` should map to one of these patterns; if it doesn't, the hook is probably weak.

**Sources used.** All patterns below reference **at least one named creator example AND a primary source** — the leaked MrBeast production manual (authenticated by 2 former producers per Passionfruit's August 2024 reporting), Jenny Hoyos's interview on YouTube's own blog (Jan 28 2025), the My First Million ep. 580 with Hoyos (May 3 2024), Paddy Galloway's LinkedIn / X analyses, and the YouTube Creator Liaison's official commentary. Patterns without that level of provenance were dropped.

---

## How a hook is judged in 2025

The retention bar:

- **Shorts:** **[primary]** Jenny Hoyos on YouTube's blog (Jan 28 2025, https://blog.youtube/creator-and-artist-stories/youtube-shorts-deep-dive/): *"I really do think you have one second to hook someone, especially on Shorts."*
- **Shorts continued:** **[primary]** Paddy Galloway's analysis of 3.3 billion Shorts views (Rattibha-archived X thread, 2023): the best-performing Shorts hold **70–90%** of viewers from swiping away. Below 70% view-vs-swipe = burial.
- **Long-form:** **[primary]** YouTube's Senior Director of Growth, Todd Beaupré, via Stan Ventures (Sept 5 2024): *"the importance of the first 30 seconds of a video, the role of thumbnails, and engaging intros in capturing the audience's attention."* Marketing Agent's recap of Feb 2025 Creator Insider: *"Establish value within 7 seconds."*
- **Mid-video:** **[primary]** MrBeast leaked production manual: re-engagement checkpoints at the **3-minute** and **6-minute** marks for long-form (per Cybernews Sept 16 2024).

**The retention data backdrop.** Retention Rabbit's 2025 benchmark study (75+ niches, Q1 2024 – Q1 2025): the average video retains 23.7% of viewers; only 1 in 6 surpasses 50%; 55% of viewers leave within the first minute. A working hook isn't optional — it's the difference between distribution and burial.

---

## The 12 patterns

### 1. Click-to-unpause packaging (Paddy Galloway)

**Structure:** Thumbnail captures a mid-action moment that the brain wants to resolve by clicking.

**Source.** **[primary]** Paddy Galloway, LinkedIn post March 2026 analysing four viral thumbnails (a MrBeast piece, an old man mid-conversation, two others): *"They each use a simple (yet powerful) packaging technique. Click to unpause. All four of these videos create a scene that you have to 'click' to 'unpause' and see for yourself. The thumbnail and title create an open loop in the brain we want to close."*

**Worked example (Galloway's own).** *"Imagine the opposite — MrBeast standing beside the steps pointing vs actually partaking. The old man smiling and posing for the camera instead of being mid-conversation. Dead in the water."*

**Failure mode:** posed shot, neutral expression, completed action. The loop is closed before the click. Eyes-at-camera-while-smiling is the universal signal of "nothing is about to happen."

### 2. Shock → Intrigue → Satisfy (Jenny Hoyos's three-beat)

**Structure:** Three distinct beats compressed into the first second of a Short. Shock = a visual/audio interrupt. Intrigue = a one-line setup that withholds the answer. Satisfy = the implied promise the rest of the Short will deliver.

**Source.** **[primary]** YouTube's own blog (Jan 28 2025): *"Jenny emphasises the critical importance of hooking viewers within the first second of a Short, using a three-step formula of shock, intrigue, and satisfy."*

**Worked example.** Hoyos's $1 chicken sandwich vs Chick-fil-A Short — opens with the punchier visual hit (shock), poses the value question (intrigue), promises the comparison (satisfy). Marketing Examined's breakdown of her playbook (May 16 2024): she would "even change the idea of the entire video for a strong hook."

**Failure mode.** Hook is too abstract or builds slowly. Her test: *"a good hook should be so clear that viewers understand the video even on mute."*

### 3. Foreshadow the ending (Hoyos)

**Structure:** Open on a moment from the END of the video, rewind, withhold the payoff until the end.

**Source.** **[primary]** Hoyos via vidIQ blog (Dec 2023, https://vidiq.com/blog/post/how-jenny-hoyos-gets-10m-views-per-youtube-short/): *"I started a video by giving my grandma a $5 Christmas present and showing her reaction… you don't see what the gift is until the end of the video."*

**Worked example.** Her $5 Christmas-gift Short — opens on grandma's reaction shot, hides the actual gift, makes viewers stay to find out.

**Failure mode.** Foreshadowing something the ending can't visually pay off. AVP collapses around the reveal point.

### 4. "But / So" escalation (Hoyos)

**Structure:** Every story beat connected by a \`but\` or \`so\`, not \`and then\`. Each \`but\` raises stakes; each \`so\` makes a consequence visible.

**Source.** **[primary]** Hoyos via vidIQ: *"You can bring this to life by using the words 'but' and 'so'… 'But the dog whined softly, so I followed him for a few miles. He led me to a dark tunnel, so I backed away in fear. But I saw a bunch of abandoned puppies at the rim of the opening.' Each 'but' stops the viewer from scrolling away as conflict rises."*

**Failure mode.** Plot progression via \`and then… and then…\` produces flat retention curves and reads as low-satisfaction.

### 5. Power-word opener (Hoyos)

**Structure:** Open with a single high-curiosity word: \`$1\`, \`banned\`, \`free\`, \`secret\`, \`cheap\`, \`nobody\`. Pair it with a concrete claim.

**Source.** **[primary]** Marketing Examined (May 2024) on Hoyos's playbook: hook should be "Concise, no more than 3 seconds, visually pleasing — power words like 'banned,' 'free,' 'one dollar,' 'secret,' or 'cheap' instantly pique curiosity."

**Failure mode.** Power word with no payoff — classic clickbait. Triggers Ritchie's CTR/retention penalty: *"If you over-index on CTR, it could become click-bait, which could tank retention, and hurt performance."*

### 6. Crazy Progression — show, don't tell, then skip ahead (MrBeast)

**Structure:** First 3 minutes of long-form aren't a setup — they're an escalation. Don't say "we'll do X" — show X already happening at scale.

**Source.** **[primary]** Leaked MrBeast production manual (per ProTunesOne Oct 2025 https://protunesone.com/blog/leaked-mrbeast-document-on-his-youtube-strategies/): *"Minutes 1-3: Instead of telling viewers what you will do, show them. MrBeast uses a technique called 'crazy progression.' For example, if he is making a video about a guy surviving weeks in the forest, he would cover multiple days instead of making the first 3 minutes about the first day. The intention here is to hook viewers as fast as possible and get them emotionally invested in the story."*

**Worked example.** *$1 vs $1,000,000,000 Yacht!* — the manual explicitly: *"As the viewer progresses through the video, the stakes rise, first presenting the $1 yacht, then a $1 million yacht, then a $10 million yacht, and so on, until the payoff at the end."*

**Failure mode.** A first 3 minutes that explains the rules instead of showing escalation. The manual's frame: *"Match the clickbait expectations and front-load as much information about the video as possible while incorporating the maximum amount of visuals, music, effects and quick scene changes."*

### 7. Match-the-thumbnail-promise (MrBeast)

**Structure:** Whatever the thumbnail visually promises, deliver in the first 60 seconds. Not at minute 8.

**Source.** **[primary]** MrBeast manual via Creator Handbook (Sept 18 2024): *"Thumbnails must align with expectations set by the title. If a thumbnail promises a specific scene or visual spectacle, the video must deliver on that promise to keep viewers engaged."* Plus: *"CTR is what dictates what we do for videos. 'I Spent 50 Hours In My Front Yard' is lame, and you wouldn't click it. But you would click 'I Spent 50 Hours In Ketchup.'"*

**Source corroboration.** **[primary]** Rene Ritchie via vidIQ Aug 2025: *"Great thumbnails don't just get viewers to click — they also help viewers understand what the video is about, so that they can make informed decisions about what to watch."*

**Failure mode.** Thumbnail-bait. CTR spikes, retention craters, the algorithm penalises distribution.

### 8. Mid-video re-engagement at minute 3 and 6 (MrBeast)

**Structure:** A mini-hook (twist, reveal, escalation) at exactly the points where retention historically dips. Not the climax — a refresh.

**Source.** **[primary]** Leaked MrBeast manual via Cybernews (Sept 16 2024): *"Around the three-minute mark, MrBeast's team aims to include a 're-engagement,' which is highly interesting and impressive… The next most crucial segment of a video is the 3–6 minute mark, which needs to be filled with most exciting and interesting content. After another 're-engagement' at the six-minute mark, the hope is to retain the viewers till the end."*

**Failure mode.** Recapping what just happened instead of escalating. Recap-style re-engagements drop retention sharper than no recap.

### 9. The "I asked Google" / "I asked an expert" hook (Sean Andrew)

**Structure:** Open with a researched question whose answer the audience wants. The hook frames you as proxy: you found out, viewer doesn't have to.

**Source.** **[secondary, named example]** vidIQ Shorts hooks roundup (Feb 2026, https://vidiq.com/blog/post/viral-video-hooks-youtube-shorts/): *"Sean Andrew used this opener to get 478,000 views on a long-jumping video. He asked Google 'what the longest jump in history is,' and then attempted to break the long-jump record."*

**Failure mode.** The answer is in the hook. The hook works because Google's answer becomes the implicit promise *to be tested*; if you reveal the answer, the test loses tension.

### 10. Credibility + specific N (Erika Kullberg)

**Structure:** "Here are N things I do before [scenario], coming from [credential]." Combines foreshadowing (audience knows it ends on item N) with credential framing.

**Source.** **[secondary, named example]** vidIQ (Feb 2026): *"Erika Kullberg's 'Quick Travel Tips' starts: 'Here are three things I do before every flight, coming from a lawyer who travels six months out of the year.' She speaks directly to travellers and builds credibility by saying how often she travels."*

**Failure mode.** Generic credibility ("as a content creator…") or N too high. Lists of 10+ erode foreshadowing because viewers can't track them.

### 11. End-of-video cliffhanger (Rene Ritchie's underused tactic)

**Structure:** End the current video on a cliffhanger that resolves in the next upload. Pulls watch-time INTO the channel, not out of it.

**Source.** **[primary]** Rene Ritchie via Search Engine Journal (Aug 15 2023 — older but still cited canonically): *"Cliffhangers are an underused tactic on YouTube. Similar to how they're used in television and movies, implementing cliffhangers at the end of YouTube videos can make viewers eager to watch the next video to see what happens. This builds excitement and investment in the audience."*

**Failure mode.** No payoff in the next upload. The cliffhanger creates an unfulfilled loop, dropping satisfaction surveys (one of the four signals YouTube weighs in 2025).

### 12. First-frame-as-thumbnail (Hoyos + Galloway)

**Structure:** The literal first frame of the video should communicate the promise without audio. Treat it like a thumbnail.

**Source.** **[primary]** Paddy Galloway's Rattibha-archived X thread (2023): *"It's important to make your first second really punchy and engaging to hook viewers early into the video. Treat your intro like a thumbnail."* **[primary]** Hoyos on My First Million ep. 580 (May 3 2024) discusses the importance of "the first frame" as a retention lever; she found that removing a single frame can change a Short's retention curve.

**Failure mode.** First frame is a logo, a black slate, a cold-open loading shot, or a face mid-blink. Mobile autoplay shows this in the feed before audio loads.

---

## Picking a pattern

Default order to try, by content type:

| Content type | First choice | Backup |
|---|---|---|
| Shorts | Pattern 2 (Shock/Intrigue/Satisfy) + Pattern 5 (power word) | Pattern 3 (foreshadow ending) |
| Long-form challenge / spectacle | Pattern 6 (crazy progression) + Pattern 7 (match thumbnail) | Pattern 8 (3-min re-engagement) |
| Educational long-form | Pattern 10 (credibility + N) | Pattern 1 (click to unpause) |
| Vlog / journey | Pattern 4 (but/so) | Pattern 11 (cliffhanger to next) |
| Reaction / opinion | Pattern 1 (click to unpause) | Pattern 9 (asked Google) |
| Series content | Pattern 11 (cliffhanger) | – |

**Avoid combining patterns** — viewers can only track one promise at a time. One pattern, executed well, beats three layered patterns.

---

## Anti-patterns (don't ship these)

- **"Hey guys what's up so today I want to talk about…"** — Beaupré's quote about establishing value in 7 seconds rules this out. \`analyze_hook\` will catch it; flag with a red marker.
- **Static talking head with no visual change in 0–2 seconds** — even with a perfect line, retention adds zero. Pair every hook with a visual change (cut, zoom, gesture). MrBeast manual: *"incorporating the maximum amount of visuals, music, effects and quick scene changes."*
- **Hooks that contain the answer.** "Here are 5 ways to save money: 1. budget, 2. invest, 3. …" — burns the curiosity gap immediately.
- **Generic music sting with no spoken content for 1+ second** — the first second is the hook on Shorts. Move the punchline forward.
- **Posed thumbnail mismatch.** A posed studio thumbnail paired with a candid mid-action video opener loses both audiences (no click-to-unpause AND no thumbnail-promise match).

---

## Operationalising in the agent

The agent does NOT generate footage. It can only re-cut from what was filmed, or recommend a re-shoot. Frame every hook diagnosis around that constraint.

When \`analyze_hook\` returns a low score:

1. Read the \`hookLine\` field from \`find_viral_moments\` (or the first sentence of the chosen window).
2. Call \`rewrite_hook(currentHook=<line>, videoTopic=<one-line>, transcriptExcerpt=<200–500 chars>, pattern="auto")\` — returns 3 candidate rewrites with the chosen pattern + rationale.
3. Surface the candidates to the user. **Do NOT auto-apply** — we can't speak the new line on-camera; the user has to either:
   - **Pick an existing alternative opener from the source footage** — if so, propose a cut window via \`text_based_cut\`.
   - **Re-shoot the opener** — if so, drop a red marker:
     \`\`\`
     add_marker(color="red", note="PAUSE: hook needs re-shoot. Suggested line: '[candidate]'")
     \`\`\`
4. **Never silently ship a sub-60 hook.** If the user can't re-shoot and source has no better alternative, the right move is to tell them so explicitly — not to pretend the current opener is fine.

For Shorts specifically, the canonical pre-flight chain is:

\`\`\`
audit_first_frame(input)               # is the t=0 frame thumbnail-quality?
analyze_hook(input)                    # does the spoken line earn the watch?
verify_thumbnail_promise(thumb, input) # does the opening deliver the thumbnail's promise?
\`\`\`

Gate at all three. If any returns blocking findings, pause before render.

**Operational targets** (executable today via the tools above):
- **Optimal duration 30–45 s** — \`find_viral_moments\` already defaults to \`[20, 45]\`.
- **Target ≥ 90% retention** through to last second (Hoyos's bar) — the agent can't measure this until upload, but it's the bar to rewrite toward.
- **Target ≥ 70% view-vs-swipe** (Galloway's 3.3B-views floor) — same: post-upload metric the user reports.
- **Seamless re-loop** — run \`loop_match_short\` as the last step before delivery.

For long-form retention checkpoints (Pattern 8 — 3-min and 6-min re-engagement), use \`audit_retention_structure(transcript)\`. It returns per-checkpoint scores and weakest-checkpoint suggestions; the agent then proposes \`cut_filler_words\` / \`text_based_cut\` / \`punch_in\` / \`add_sfx_at_cuts\` on the flat windows.

---

## Sources & further reading

**Primary creator sources:**
- Jenny Hoyos × Todd Sherman, **YouTube Creator Blog**, Jan 28 2025 — https://blog.youtube/creator-and-artist-stories/youtube-shorts-deep-dive/
- Jenny Hoyos, **My First Million** ep. 580, May 3 2024 — https://www.mfmpod.com/videos/the-formula-to-break-100-million-views-on-shorts-ft-jenny-hoyos/
- Jenny Hoyos × **Marketing Examined**, May 16 2024 — https://www.marketingexamined.com/blog/jenny-hoyos-short-form-video-playbook
- **Leaked MrBeast production manual**, August 2024, full PDF mirrored at https://simonwillison.net/2024/Sep/15/how-to-succeed-in-mrbeast-production/
- Paddy Galloway, **Creator Science Podcast #209**, Jan 27 2026 — https://podcast.creatorscience.com/paddy-galloway-2/
- Paddy Galloway, **LinkedIn "Click to unpause"** post, March 2026
- Paddy Galloway, **3.3 billion Shorts views** X thread, archived at https://en.rattibha.com/thread/1646898356419981315

**Authoritative third-party syntheses:**
- vidIQ — Hoyos breakdown (Dec 2023), Shorts hooks roundup (Feb 2026)
- Creator Handbook — MrBeast manual recap, Sept 18 2024
- ProTunesOne — Leaked MrBeast doc breakdown, Oct 28 2025
- Cybernews — MrBeast manual on retention checkpoints, Sept 16 2024
- Search Engine Journal — Rene Ritchie on cliffhangers, Aug 15 2023
`;

const YOUTUBE_ALGORITHM_PRIMER = `---
name: youtube-algorithm-primer
description: How YouTube actually ranks videos in 2024–2026, sourced from Creator Insider, the YouTube Liaison (Rene Ritchie), Senior Director of Growth Todd Beaupré, Paddy Galloway, and the Retention Rabbit 2025 benchmark study. Read when generating titles/descriptions/chapters or when a video is underperforming. Numbers without a primary YouTube source are flagged as third-party heuristics.
---

# youtube-algorithm-primer

**When to use:** any time a tool needs to optimise FOR the algorithm — title generation, description structure, chapter placement, render-format selection, end-screen placement, multi-format render decisions. Also when the user asks "why isn't this getting views?" — the answer usually maps to one of the four signals below.

**What this is:** a working model with cited sources. Where a number comes from YouTube's own staff, it's marked **[primary]**. Where it comes from third-party tooling (vidIQ, TubeBuddy, Dataslayer) or aggregator sources, it's marked **[secondary]**. Where it's creator folklore with no traceable source, it's marked **[unverified]** — surface those to the user as heuristics, not laws.

**Source quality up front.** Most authoritative in 2024–2026 order: (1) Creator Insider, the Beaupré ↔ Ritchie video conversations, especially the Jan 23 2025 algorithm explainer; (2) Rene Ritchie's "Top Five" YouTube Blog posts and \`@YouTubeLiaison\` on X; (3) the YouTube Help Center on Test & Compare and Add Custom Thumbnails; (4) Paddy Galloway (data-driven creator strategist) — his X threads and Creator Science Podcast #209 (Jan 27 2026). Tool-vendor data (vidIQ, TubeBuddy, Dataslayer, Retention Rabbit) is useful directional signal but not platform-confirmed.

---

## The 2025 shift: satisfaction-weighted discovery

The biggest change creators must internalise. YouTube announced a recommendation model overhaul in early 2025; the new system layers four qualitative satisfaction signals on top of clicks and watch time:

1. **Surveys** — post-view "Did you enjoy this video?" prompts.
2. **Sentiment modelling** — comments + like/dislike ratios.
3. **Long-session retention** — time spent across multiple videos in a session.
4. **Feedback suppression** — "Not Interested" / "Don't Recommend Channel" clicks.

**[primary]** Todd Beaupré (YouTube Sr. Director, Growth & Discovery), via Buffer's recap of the Jan 2025 Creator Insider conversation: *"We're trying to understand not just about the viewer's behavior and what they do, but how they feel about the time they're spending. What do they say about their experience watching a video."* (https://buffer.com/resources/youtube-algorithm/, 2025)

**[primary]** Rene Ritchie (YouTube Creator Liaison), Jan 2025 Creator Insider video, paraphrased on Lia Haberman's ICYMI newsletter: *"YouTube's Algorithm Pulls, Not Pushes: The recommendation system doesn't 'push' creator videos out to YouTube audiences but instead pulls in content based on the user's individual viewing habits — think of it as automating word of mouth. Viewer Satisfaction Matters: YouTube measures user satisfaction through engagement signals such as likes, comments, and surveys. Total watch time is not the golden standard — sometimes viewers want a video to be more efficient and just get to the point."* (https://liahaberman.substack.com/p/icymi-how-youtubes-2025-algorithm, Jan 31 2025)

**Editorial implication.** Stop padding videos to hit a watch-time number. The platform now reads "got to the point fast" as a positive satisfaction signal, not a missed-watch-time signal.

---

## The four metrics that move ranking

In rough order of importance for general distribution:

### 1. Click-through rate (CTR) on impressions

CTR is driven by the **thumbnail + title pair**. **[secondary]** Tool-vendor benchmarks roughly converge:

| Band | vidIQ (Nov 2025) | Dataslayer (~2026) | YTShark (Mar 2026) |
|------|---|---|---|
| Poor | < 4% (thumbnail/title isn't clear enough) | < 3% needs immediate fixes | – |
| Average | 4–6% | 4–6% | 2–10% (most channels) |
| Good | 7%+ | 7–10% | – |
| Excellent | 9–10%+ | > 10% (niche channels with loyal audiences) | – |

Niche-specific (PostEverywhere citing vidIQ + TubeBuddy data, Jan 2026): gaming averages 8.5%, educational averages 4.5%.

**[unverified]** The "1,000 impressions / 10% CTR triggers expanded distribution" claim that floats in SEO blogs (Hashmeta and others) has no traceable YouTube source. Treat as folk wisdom.

**[primary]** What Paddy Galloway actually says about CTR — Creator Science Podcast #209, Jan 27 2026: *"CTR itself is a very fickle and in some ways infuriating metric… because the more impressions a video gets, the lower the CTR drops typically… CTR itself as a whole is not very useful. CTR in the first hour or first 24 hours can be a good predictor of success on videos. There's a very strong correlation between first-hour CTR and long-term video performance on a lot of established channels."*

**[primary]** What YouTube itself says about CTR's role — Rene Ritchie on the Test & Compare A/B tool, July 25 2025 (via vidIQ blog https://vidiq.com/blog/post/youtube-launches-new-title-testing-tool/): *"Thumbnail Test & Compare returns watch time rather than separate metrics on click-through rate (CTR) and retention (AVP), because watch time includes both! You have to click to watch and you have to retain to build up time. If you over-index on CTR, it could become click-bait, which could tank retention, and hurt performance."*

**Operational rule for the agent:** judge CTR against the channel's own first-hour baseline, not industry averages. YouTube's native A/B tool optimises Watch Time Share, not CTR — match that bias.

### 2. Average view duration (AVD) and average percentage viewed (AVP%)

The single best 2024–2026 retention dataset is **[secondary, large N]** Retention Rabbit's May 2025 audience-retention benchmark report (75+ niches; Q1 2024 – Q1 2025; https://www.retentionrabbit.com/blog/2025-youtube-audience-retention-benchmark-report):

- **Average YouTube video retains 23.7%** of its viewers.
- **Only 1 in 6 videos (16.8%) surpass 50% retention.**
- **55%+ viewer drop-off occurs in the first minute.**
- Channels improving average retention by 10 percentage points see a correlated **25%+ increase in impressions**.
- Educational How-Tos average **42.1% retention** — top niche.

**[secondary]** Threshold consensus across multiple 2025 sources (Solveigmm Aug 2025; PostEverywhere Jan 2026; Virvid Feb 2026):

- **50–60% AVP%** is solid.
- **70%+** earns priority placement in suggested videos.
- **< 40%** triggers active deprioritisation regardless of CTR.

**[primary]** The "50% rule" reframed — Rene Ritchie / Todd Beaupré (Jan 2025 Creator Insider, paraphrased on Hootsuite Sept 2025 https://blog.hootsuite.com/youtube-algorithm/): the platform now *"prioritises videos that provide a positive viewing experience, not just those that hold attention the longest."* Translation: a 6-minute video at 80% retention beats a 20-minute video at 30% retention even though the longer one logged more raw watch time.

**[primary]** Retention shape vs absolute time — YouTube's own guidance is that *relative* watch time matters more on short videos, *absolute* watch time more on long-form (cited by Virvid Feb 2026 from YouTube Help Center).

**The first-minute problem is the loudest signal.** Multiple converging sources:

- Retention Rabbit: **55%+ leave within 60 seconds**.
- 1of10 (cited by PostEverywhere): *"nearly 20% of viewers drop off within the first 15 seconds — not because the video is bad, but because the intro fails to connect."*
- **[primary]** Todd Beaupré, via Stan Ventures recap (Sept 5 2024): *"the importance of the first 30 seconds of a video, the role of thumbnails, and engaging intros in capturing the audience's attention."*
- **[primary]** Marketing Agent Blog summarising Creator Insider Feb 2025: *"Establish value within 7 seconds (per Creator Insider, 2025)."*

**Diagnostic patterns on the audience-retention graph:**
- Cliff in the first 30s → hook problem; rerun \`analyze_hook\` and recut opener.
- Slow steady decline → pacing; rerun \`cut_filler_words\`, tighten with \`text_based_cut\`, consider \`punch_in\` / \`add_sfx_at_cuts\`.
- Spike up at minute X → viewers told friends to skip there; move it earlier next time.
- Steep drop at chapter boundary → chapter title oversold; rewrite the chapter title.

### 3. Session contribution / next-video continuation

**[primary]** Beaupré's framing (Jan 2025 Creator Insider): channels grow fastest when each video naturally leads viewers to watch another, creating "bingeable journeys." YoutoWire's Jan 2026 ranking-of-ranking-signals: session time (does your video lead to more YouTube watching?) sits behind only CTR and AVD in importance.

What extends a session:
- End-screen elements pointing to your next video.
- Series content / episodic structure.
- Chapters + a clear "next" hook in the outro.

What ends sessions:
- Long static outros (viewer closes tab while waiting).
- Generic "subscribe" outros without a next-video pointer.

**Operational rule:** the brand kit's \`outro\` should chain to the next video. Description should reference previous / next uploads. \`generate_outro\` is the lever.

### 4. Engagement velocity (first 24–48 hours) — partial myth

The "first 48 hours decide everything" framing is overstated by SEO blogs.

**[primary]** Paddy Galloway, X thread Oct 16 2023 (still cited): *"The YouTube algorithm doesn't let you experiment. We recently tried a completely new format with a client. It started slow. 6/10. Now it's about to be our fastest ever video to hit 1 million views."*

**[secondary]** Dataslayer Jan 2026 directly debunks the "your video is dead if it doesn't pop in 48h" myth: *"YouTube's 2025 algorithm actively resurfaces old content when topics become relevant again. Videos about 'tax deductions for freelancers' spike in January and April."*

**[primary]** Rene Ritchie, YouTube Blog March 28 2024 (https://blog.youtube/culture-and-trends/renes-top-five-on-youtube-march-28-2024-edition/): *"Don't delete videos unless you have a very, very good reason. When you delete a video, you delete your channel's connection to the audience that watched that video."*

**Verdict for the agent:** first-hour CTR matters as a predictor for established formats. New formats and evergreen topics absolutely recover later. Don't tell users their video is dead at 48h.

---

## What YouTube has officially said it does NOT use

This is the most reliably citable section because it's all from YouTube's own staff.

- **Tags — minimal impact.** **[primary]** YouTube Liaison (\`@YouTubeLiaison\`), Aug 22 2024, summarised by Stan Ventures (https://www.stanventures.com/news/youtube-reveals-new-seo-priorities-756/): *"Liaison debunked this myth, stating that tags have a minimal impact on the algorithm. The primary recommendation was to use tags sparingly, emphasising on common misspellings of channel names or key topics related to the video."*
- **Hashtags — small effect, contextual only.** **[primary]** Same Liaison statement: *"hashtags should only be employed when they align with trending topics or help contextualise a video in a way that adds value."*
- **Categories — minor.** Same source: *"while categories help YouTube understand the general context of a video, they are a minor consideration in the grand scheme of things."*
- **Upload time of day — not algorithmic.** **[primary]** Rene Ritchie's March 28 2024 "Mythbusters" YouTube Blog post with Beaupré: posting time matters for *your audience's habits*, not algorithmically.
- **Subscriber count — weak signal.** **[secondary]** Dataslayer Jan 2026: *"In 2025, YouTube actively recommends videos from small channels. Subscriber count is one of hundreds of signals, and not a strong one. A 0-subscriber channel can appear in recommendations if the video performs well with test audiences."*
- **Dislikes — barely register.** **[secondary]** YoutoWire Jan 2026: *"Dislikes barely register. Algorithm treats them as 'engagement' (not negative signal). What DOES hurt: High 'Not Interested' clicks (when viewers tell YouTube 'Don't recommend this channel')."* Consistent with all Ritchie commentary on \`Not Interested\` being the actual penalty signal.
- **Subscriber-feed checkbox / unchecking notifications — no effect.** **[primary]** Rene Ritchie: *"Shorts don't trigger notifications on upload, so that part won't make a difference. For long-form, most subscribers watch from the home page."*
- **Description links — fine unless spammy.** **[secondary]** Dataslayer: links to resources mentioned in the video are fine; the algorithm just favours videos that keep viewers on YouTube longer.

---

## Algorithm changes worth knowing (2024–2026)

Don't recite these to the user, but reflect them in tool defaults.

- **Oct 15 2024:** Shorts max length raised from 60 s → 3 minutes. (PPC.land timeline)
- **March 31 2025:** Shorts view counting changed — view counts now register on play/replay with no minimum watch time; YPP eligibility and Shorts ad-revenue sharing remain on the renamed *Engaged Views* metric. (TubeBuddy, Pixability, PPC.land all confirm.)
- **Feb 2025:** "Satisfaction-weighted" recommendation model rolled out (Creator Insider, paraphrased on Marketing Agent Blog Nov 4 2025).
- **July 2025:** YouTube removed the Trending page and Trending Now list; replaced by per-vertical micro-trend tracking. (Shopify summary citing the YouTube announcement.)
- **2024–2025:** Native title + thumbnail A/B testing (Test & Compare) rolled out widely. **[primary]** Rene Ritchie via vidIQ July 25 2025: *"You can pick up to 3 versions of your title… up to 3 thumbnails… YouTube doesn't use click-through rate (CTR) as the winning metric — it uses Watch Time Share. Tests typically run from 1 to 14 days, depending on how quickly statistical significance is reached. Once there's a clear winner, YouTube automatically applies it."*
- **Late 2025:** Shorts and long-form recommendation surfaces partially decoupled. **[secondary, partial]** YTShark Mar 2026 says fully decoupled; **[primary]** YouTube Creator Blog July 2025 (per Marketing Agent) says short-form retention still feeds satisfaction signals back into long-form discovery. Reality is in between: ranking systems separate, but viewer-graph cross-pollination remains.

---

## Title rules (the highest-leverage lever)

Constraints (cross-source consensus from vidIQ Aug 2025, AmpiFire Nov 2025, multiple creator analysts):

- **≤ 70 characters** before mobile feed truncation; **60 is safer**.
- **Front-load the hook** in the first 4–6 words (mobile crops the rest).
- **One specific number** if applicable — "5 mistakes" beats "common mistakes"; "$3,000" beats "expensive."
- **Curiosity gap, not spoiler** — title should make the viewer want the answer, not contain it.
- **No clickbait that doesn't deliver** — see Ritchie's quote above. CTR-spike + AVP-collapse is now actively penalised.
- **One emoji max** if any.

Patterns that consistently perform across creator data (vidIQ + TubeBuddy public analyses):

- **"How I [achieved] [in time] (with [twist])"** — How I built X in 3 days (without Y)
- **"[Number] [things] [audience] [verb]"** — 5 mistakes new editors make
- **"Why [common belief] is wrong"** — Why the 10K hour rule is wrong
- **"I [extreme behaviour] for [time]. Here's what happened."** — I cooked one new dish per day for 30 days
- **"The [adjective] truth about [topic]"** — The boring truth about productivity apps

\`generate_youtube_metadata\` should propose 3 titles using **different patterns from this list**, not three variations of one. Pattern variety lets the user pick.

---

## Description structure (sidecar SEO + AVD lift)

The description's job is to:

1. **Restate the hook in the first 2 lines** — these show above-the-fold on mobile.
2. **Drop chapters** — clickable timestamps that double as table-of-contents. Required for any video > 5 minutes.
3. **Link related uploads** — pulls watch-time into your channel.
4. **CTA last** — subscribe/Patreon/etc. at the END, not the top.

Skeleton:

\`\`\`
<one-line restated hook>
<one specific question to drive comments>

⏱️  Chapters
00:00  <chapter 1 title>
01:23  <chapter 2 title>
…

🎥  Related videos
- <previous video title> → <link>
- <related video title> → <link>

📌  About this channel
<one-paragraph "what to expect" + subscribe url>
\`\`\`

\`generate_youtube_metadata\` produces chapters and description body; the agent slots them into this skeleton.

---

## Shorts ranks differently

**[primary]** From Hootsuite Sept 2025 paraphrasing the official Shorts ranking explainer: *"A 30-second Short with 85% watch duration will likely rank higher than a 60-second Short with only 50% retention. Looping Shorts (where viewers rewatch part of the video) tend to get more recommendations than those with lower replay rates."*

**[primary]** Hootsuite continues: *"Unlike long-form videos, click-through rate (CTR) isn't a ranking factor [for Shorts], since users don't actively click Shorts — they swipe through them."*

**[primary]** Paddy Galloway's analysis of 3.3 billion Shorts views (Rattibha-archived X thread): *"The best-performing Shorts have between 70% and 90% of people viewing versus swiping away from them."* Operationalised: **target ≥ 70% view-vs-swipe rate** as a hard floor, ≥ 85% as the success bar.

**[primary]** Jenny Hoyos on YouTube's own blog (Jan 28 2025, https://blog.youtube/creator-and-artist-stories/youtube-shorts-deep-dive/): *"I really do think you have one second to hook someone, especially on Shorts."* The official YouTube Blog summarises her three-step formula: **shock, intrigue, satisfy**.

**Optimal Shorts duration:** **[primary]** Hoyos via Marketing Examined (May 16 2024 https://www.marketingexamined.com/blog/jenny-hoyos-short-form-video-playbook): aim for **30–34 seconds** with **90%+ retention** in the last second. **[secondary]** Boss Wallah Sept 2025 corroborates: target 90–100% retention on Shorts under 20 seconds.

**Implications for the agent (all executable today):**
- **Default Shorts length: 30–45 s, not 60 s.** \`find_viral_moments\` already defaults to \`[20, 45]\`.
- **Burned captions are not optional** — sound-off mobile is the default. Use \`write_keyword_captions(autoEmoji=true)\` + \`burn_subtitles\`.
- **First 0.5–1 s is the hook.** Use \`audit_first_frame\` to score the t=0 frame as a thumbnail (Galloway: 'treat your intro like a thumbnail'); pair with \`analyze_hook\` for the spoken-line check.
- **Seamless re-loop** — Shorts loop rate is a confirmed ranking signal. Run \`loop_match_short\` as the last step before delivery (crossfades the last ~0.3 s into the first frame).
- **Skip the outro on vertical.** \`generate_outro\` is for long-form.

---

## Operationalising this in the agent

The agent does NOT have access to live YouTube Studio metrics. When the user asks "why isn't this getting views?", first **ASK the user to paste the relevant numbers from Studio** (impressions, CTR, average view duration, average percentage viewed). Don't guess; don't fabricate.

Once numbers are in hand, **diagnose in this order** and surface the FIRST failing metric — don't dump all five:

1. **CTR < 4% (vs channel baseline)?** → Re-thumbnail + re-title. Run \`compose_thumbnail_variants(strategy="expression")\` for 3 face/expression variants and \`generate_youtube_metadata\` for 3 title candidates. Then: tell the user to upload all three thumbnails + one title per variant to YouTube Studio's **Test & Compare** — we cannot trigger that test from the agent; it lives only in Studio. Test & Compare optimises Watch Time Share (per Ritchie July 2025), so let YouTube pick the winner over 1–14 days.
2. **CTR ok but AVP% < 30%?** → Hook problem. Run \`analyze_hook\` for the t<3s check; if Shorts, also \`audit_first_frame\`. If hook scores low, run \`rewrite_hook(currentHook=..., pattern="auto", videoTopic=...)\` to generate 3 candidate rewrites — surface them to the user. The agent CANNOT re-record the spoken line; it can only (a) recut the opener from existing source footage via \`text_based_cut\`, or (b) recommend a re-shoot.
3. **AVP% ok but AVD low?** → Pacing. Run \`audit_retention_structure(transcript)\` to find the flat stretches between the 3-min and 6-min checkpoints. For each weak checkpoint, propose \`cut_filler_words\`, \`text_based_cut\`, \`punch_in\`, or \`add_sfx_at_cuts\` on the surrounding window.
4. **AVD ok but session contribution low?** → End-screen / outro / next-video pointer missing. Use \`generate_outro\` with the brand-kit chain (set \`brand.outro\` and the agent inherits it).
5. **Engagement velocity 0?** → No question in description (fix via \`generate_youtube_metadata\`'s description block) or tiny channel — the second case has no algorithmic fix; it's a community-size problem, not a tool problem. Be honest about this.

Surface ONE concrete fix per diagnosis, not the full menu.

**For pre-flight (before render):** the canonical short-form audit chain is \`audit_first_frame\` → \`analyze_hook\` → \`verify_thumbnail_promise\` → \`audit_retention_structure\` (long-form only). If any returns a blocking finding, surface a red marker and pause.

---

## Sources & further reading

**Primary (cite these first):**
- Creator Insider — Beaupré + Ritchie videos, especially Jan 23 2025 algorithm explainer (https://www.youtube.com/watch?v=dhYIb72L1hU)
- Rene Ritchie — \`@YouTubeLiaison\` on X; weekly "Top Five" YouTube Blog posts at https://blog.youtube/
- YouTube Help Center — Test & Compare, Add Custom Thumbnails
- YouTube Blog Jan 28 2025 — Jenny Hoyos Shorts deep dive (https://blog.youtube/creator-and-artist-stories/youtube-shorts-deep-dive/)

**Strong secondary:**
- Paddy Galloway — Creator Science Podcast #209 (Jan 27 2026); X threads at twitter.com/PaddyGalloway1
- Retention Rabbit 2025 Audience Retention Benchmark Report (May 2025) — https://www.retentionrabbit.com/blog/2025-youtube-audience-retention-benchmark-report
- Hootsuite YouTube algorithm guide (Sept 2025)
- Buffer YouTube algorithm guide (2025)

**Vendor benchmarks (treat as directional, not gospel):** vidIQ, TubeBuddy, Dataslayer, YTShark, AmpiFire.
`;

const YOUTUBE_END_TO_END = `---
name: youtube-end-to-end
description: Orchestrator for "make me a YouTube video from this footage" using a TIMELINE-FIRST workflow. The agent edits the live Resolve/Premiere timeline so the user can scrub, tweak, and undo at every stage. Renders only happen at the end on explicit user intent ("render" / "export" / "ship it"). When host=none, falls back to file-only delivery and says so up front. Covers long-form, Shorts, captions, retention pipeline, and the metadata bundle.
---

# youtube-end-to-end

**When to use:** the user gives a single broad ask like *"make me a YouTube video from this footage"*, *"turn this recording into something I can ship"*, or *"give me a YouTube cut and a Shorts cut"*. This is the orchestrator skill — it composes the per-pass skills (long-form, short-form, chapter-markers, retention) into a single end-to-end run that **edits the user's timeline live** and produces metadata, captions, and SFX they can review before exporting.

**Core posture: you are an EDITOR, not an export pipeline.** Read the system prompt's "You are an editor, not an export pipeline" section. It overrides everything else here. Render only when the user says so.

**Goal:** the user watches the agent build the cut on their timeline. Cuts appear, SFX clips land on A3, captions attach as a sidecar, markers document each decision, the brand-kit outro splices onto the end. The user plays back, scrubs, asks for a tweak. Then says "ship it." Then the agent renders.

---

## Step 0 — Intent triage (ONE question max)

Look at the input and the user's prompt:

- **Input duration** via \`probe_media\`. Anything > 5 minutes → assume long-form. Anything ≤ 5 minutes → assume short-form. Both for source > 5 min when prompt is silent.
- **Brand kit:** read \`<cwd>/.gg/brand.json\` silently. All render-time tools inherit; don't ask about typography or logos.
- **Host check:** call \`host_info\`. If host=none, tell the user *"No NLE attached — I'll produce standalone mp4s. Open Resolve / Premiere if you want a timeline-native edit you can keep tweaking."* Then proceed with the file-only fallback path (skip steps 2-5 timeline ops; jump to render).

If duration is 4–6 min AND prompt is silent on format, ASK once: *"Long-form, Shorts, or both?"*. One question, then run.

---

## Step 1 — Foundation pass (timeline-safe; runs once)

\`\`\`
host_info                               → confirm host + caps
get_timeline                            → fps, duration, existing markers
get_markers                             → prior decisions / session resume
clone_timeline(name="…-edit-v1")        → SAFETY NET before destructive ops
save_project                            → checkpoint
probe_media(input)                      → fps, duration, codecs
extract_audio(input, audio.wav, sampleRate=16000)
transcribe(audio.wav, transcript.json,
           wordTimestamps=true)         → word-level transcript
\`\`\`

Word timings are mandatory — every retention multiplier downstream needs them. If the source is multi-cam, also run \`multicam_sync\` first and pick the alignment.

**No render in step 1. No file-baking. The user's timeline is now the working copy.**

---

## Step 2 — Long-form edits, ON THE TIMELINE (when long-form is in the brief)

Each of these MODIFIES THE TIMELINE the user is watching. The user can play back, scrub, and ask for changes between any of them.

\`\`\`
# Filler removal (transcript-driven; lands as EDL on the timeline)
cut_filler_words(transcript, sourceVideo)       → emits EDL of keep ranges
import_edl(path)                                → cuts appear on timeline ✓
add_marker(color="green", note="filler-cut: removed N (Ms)")

# Chapters as markers (visible in Resolve marker pane immediately)
read_skill(name="chapter-markers")              → recipe
# … per the recipe: read_transcript in 90s windows, identify topic shifts,
#   add_marker(color="purple", note="00:00 — Intro") at each boundary

# Captions as sidecar SRT (attached to timeline; not baked)
write_srt(transcript, output="captions.srt", cues=...)
import_subtitles(srtPath="captions.srt")       → SRT attached to subtitle track ✓

# B-roll over flat stretches (live insert on V2)
suggest_broll(transcript, topN=5)               → ranked candidates from Pexels
# for each: insert_broll(mediaPath=..., track=2, recordFrame=...) ✓

# Audit retention structure — SHOW the user the weak checkpoints, propose fixes
audit_retention_structure(transcript)           → weak spots + suggestions
# DON'T silently rewrite. Surface to user, propose punch_in / cut_filler_words /
#   add_sfx_to_timeline on the surrounding window. Wait for their OK or tweak.

# Outro splice (from brand kit if available, otherwise generate)
generate_outro(output="outro.mp4")              → produces outro card mp4
import_to_media_pool(path="outro.mp4")
append_clip(track=1, mediaPath="outro.mp4")     → outro lands at end of timeline ✓
\`\`\`

After step 2 the user has a fully-edited LONG-FORM TIMELINE in Resolve/Premiere. They can play it. Scrub to any point. Watch the b-roll cutaways. Read the chapter markers. **No mp4 has been rendered yet.**

---

## Step 3 — Shorts pass, ALSO timeline-first

\`\`\`
find_viral_moments(transcript, maxClips=3,
                   durationRange=[20, 45])      → ranked candidate windows
\`\`\`

For each candidate (top score first):

\`\`\`
analyze_hook(input, startSec=startSec, endSec=startSec+3)
                                                 → score 0-100 + findings
\`\`\`

If \`score < 60\`, drop a red marker and skip — bad hook = bad short. Don't ship a sub-60 hook silently; either run \`rewrite_hook\` to surface candidates and let the user decide, or move on to the next moment.

Otherwise, **build the short on a NEW Resolve timeline so the long-form timeline isn't disturbed:**

\`\`\`
clone_timeline(name="short-\${i}")                # New timeline for this short
# Trim to the candidate window via EDL:
text_based_cut(sourceVideo,
               cuts=[{startSec: 0, endSec: candidate.startSec},
                     {startSec: candidate.endSec, endSec: totalSec}])
import_edl(path)                                 # Window appears on the new timeline ✓

# Captions burned (vertical Shorts; sidecar isn't standard for Shorts)
write_keyword_captions(transcript, output="short-\${i}.ass",
                       startSec=candidate.startSec,
                       endSec=candidate.endSec,
                       autoEmoji=true, groupSize=2)
import_subtitles(srtPath="short-\${i}.ass")     # Attached to subtitle track ✓
# (Final pixel-burn happens at render time, not here.)

# Punch-ins at the candidate's internal cut points (timeline-native — coming;
# for now, surface to user with a marker so they apply manually OR queue
# for the file-bake step at render time)

# SFX on cuts — TIMELINE-NATIVE
add_sfx_to_timeline(sfx="whoosh", cutPoints=[…internal cuts…], track=3)  ✓

add_marker(color="green",
           note="short \${i}: hook=\${analyzeHook.score}, virality=\${candidate.score}")
\`\`\`

User can now switch between long-form timeline and each \`short-\${i}\` timeline in Resolve, play back, scrub, tweak.

---

## Step 4 — Pre-flight audit (still no render)

\`\`\`
audit_first_frame(sourceClipPath)                # Galloway: "intro = thumbnail"
analyze_hook(sourceClipPath)                     # spoken-line check
verify_thumbnail_promise(thumb, video, 60)       # MrBeast: deliver in first 60s
audit_retention_structure(transcript, [180,360]) # mid-video checkpoints
\`\`\`

Surface every finding with score + suggestion. **Don't render past a blocker.** If the user says "fix the weak hook," go back to step 2/3 with \`rewrite_hook\` candidates and propose them — DON'T silently re-cut.

---

## Step 5 — Metadata bundle (REQUIRED before declaring "ready to ship")

\`\`\`
generate_youtube_metadata(transcript)            # titles[3], description, tags[15],
                                                 #   chapters[], hashtags[]

compose_thumbnail_variants(input=long-form-render-OR-source-frame,
                           outputDir="./thumbs",
                           text="<distill best title to 2–4 words>",
                           count=3,
                           strategy="expression")
\`\`\`

Surface the 3 candidate titles + 3 thumbnail variants + the description to the user. Tell them to upload all three thumbnails to YouTube Studio's **Test & Compare** (no API for this — must be manual).

---

## Step 6 — STOP HERE

This is the natural pause point. The user has:
- A fully-edited long-form timeline in their NLE
- 1–3 Shorts timelines in their NLE
- 3 thumbnail variants on disk
- A metadata bundle (titles, description, chapters, tags, hashtags)

Tell the user:

> ✅ Long-form ready on timeline \`<name>\` (12:34, captions attached, brand-kit outro)
> ✅ Shorts ready on timelines \`short-1\`, \`short-2\`, \`short-3\` (hooks: 82, 76, 71)
> ✅ Thumbnail variants: \`./thumbs/long-form.{1,2,3}.jpg\`
> ✅ Metadata bundle written to chat above
>
> Play them back, scrub, tell me what to tweak. When you're happy, say **"render"** / **"export"** / **"ship it"** and I'll:
>   1. Run \`pre_render_check\` on each timeline
>   2. \`render(...)\` the long-form via Resolve's deliver page
>   3. \`render_multi_format\` the shorts to 9:16 / 1:1 / 4:5
>
> ⚠️ N candidate(s) dropped (<reason>): …

**Wait for the user's go-ahead. Do not call \`render(...)\` or \`render_multi_format(...)\` until they explicitly ask.**

---

## Step 7 — Render (only on "ship it" / "render" / "export")

When the user explicitly asks to render:

\`\`\`
# Long-form
list_render_presets()                             # see what's installed in Resolve
pre_render_check(timelineEmpty=false,
                 expectCaptions=true,
                 loudnessSource=...,
                 loudnessTarget="youtube")
render(preset="<from list>",
       output="./out/long-form.mp4")              # Resolve's deliver page ✓

# Per Short
render_multi_format(input="<short-mp4-from-Resolve-or-file>",
                    outputDir="./out/shorts",
                    formats=["shorts-9x16"])     # 9:16 deliverable

# Audio finalisation (these MUST bake — Fairlight is closed)
normalize_loudness(input="./out/long-form.mp4",
                   output="./out/long-form.delivery.mp4",
                   platform="youtube")           # -14 LUFS / -1 dBTP
# Then auto-import the normalized file back so the user has the final on hand:
import_to_media_pool(path="./out/long-form.delivery.mp4")
add_marker(color="green", note="DELIVERY: long-form.delivery.mp4 (-14 LUFS)")
\`\`\`

---

## What CHANGED vs the old export-everything flow

- **No file-baking mid-edit.** Captions are sidecar SRT, SFX are real audio clips on track A3, b-roll lands on V2 — all live in the user's NLE.
- **\`burn_subtitles\`, \`add_sfx_at_cuts\`, \`face_reframe\`, \`mix_audio\`, \`clean_audio\`, \`duck_audio\`, \`loop_match_short\`, \`bleep_words\`, \`speed_ramp\`, \`stabilize_video\`** are the file-only tools the agent does NOT chain mid-edit. They're for the final delivery pass on user request.
- **\`render(...)\` / \`render_multi_format(...)\`** only fire after explicit user intent.
- **Each step modifies the live timeline** — user plays back, scrubs, asks for tweaks. The session is iterative, not a one-shot pipeline.

---

## What the agent CANNOT do (be honest with the user)

- Generate new footage. No re-shoots, no AI scenes. Only re-cut from existing source.
- Trigger YouTube Studio Test & Compare. No public API. Agent produces 3 variants; user uploads them.
- Read live channel metrics. No public CTR / AVD feed. ASK the user to paste from Studio.
- Re-record a hook line. \`rewrite_hook\` proposes 3 rewrites; user picks an existing alternative opener via \`text_based_cut\` or re-shoots.
- Render anything until the user says so. Even if you think it's done.

---

## Defaults & gates

- **Hook gate**: 60 (\`analyze_hook\`).
- **Virality gate**: 50 (\`score_clip\` total).
- **First-frame gate**: 60 (\`audit_first_frame\`).
- **Thumbnail-promise gate**: 0.6 (\`verify_thumbnail_promise\`).
- **Retention-checkpoint gate**: 0.5 per checkpoint (\`audit_retention_structure\`).
- **Short duration range**: 20–45 s — \`find_viral_moments\` default.
- **Loudness target**: -14 LUFS / -1 dBTP for YouTube + every short-form platform.
- **Caption style** (vertical): yellow keyword pop on white default, lower-third margin 220, \`autoEmoji=true\`.
- **SFX track**: A3 — keeps A1 dialogue / A2 music free.
- **Render**: only on explicit user intent — never automatic.
`;

const YOUTUBE_THUMBNAIL_DESIGN = `---
name: youtube-thumbnail-design
description: Thumbnail design rules sourced from a 300K-video study (1of10 Media via Search Engine Journal Dec 2025), the official YouTube Test & Compare guidance from Rene Ritchie (July 2025), and creator strategists. Read before composing thumbnails or picking variants from compose_thumbnail_variants. Numbers are tagged with their source so the agent doesn't misquote.
---

# youtube-thumbnail-design

**When to use:** any time you compose a thumbnail (\`compose_thumbnail\`, \`compose_thumbnail_variants\`) or rank candidate hero frames (\`score_shot\`). Read this BEFORE writing the headline text — getting the headline wrong is the most common reason creator thumbnails underperform, more than any single visual choice.

**Source authority.** The strongest 2025 evidence on what actually works in thumbnails comes from: (1) **1of10 Media's 300,000-video viral study**, reported on Search Engine Journal (Dec 22 2025); (2) **YouTube's own Test & Compare tool** + Rene Ritchie's July 2025 commentary on what it optimises; (3) creator A/B data from **vidIQ, TubeBuddy, AmpiFire**. Tags \`[primary]\`, \`[secondary, large-N]\`, \`[secondary, vendor]\` mark provenance.

---

## The viewing context (this is everything)

Most thumbnails are first seen at:
- **120 × 67 px** — mobile feed
- **246 × 138 px** — desktop home feed
- **360 × 202 px** — sidebar suggestions

Anything finer than ~3 pixels is invisible at the smallest size. **Design for 100 × 56 first.** If it works there, it works everywhere.

Sanity test: render the thumbnail, scale it to 100 × 56, look at it. If you can't tell the subject + topic in 1 second, it fails.

---

## Faces vs. no-faces — the data is more nuanced than blogs claim

The headline question every creator asks. The clearest answer comes from the largest 2025 study:

**[secondary, large-N]** Search Engine Journal Dec 22 2025 (https://www.searchenginejournal.com/do-faces-help-youtube-thumbnails-heres-what-the-data-says/563944/), reporting 1of10 Media's analysis of 300,000 viral 2025 YouTube videos: *"thumbnails with faces and thumbnails without faces perform similarly, even though faces appear on a large share of videos in the sample."* Niche-level: **Finance benefits from faces; Business performs better without.** Channel-size: faces helped larger channels more than smaller ones. Multi-face thumbnails outperform single-face in their dataset.

**[secondary, vendor — flagged]** Tool-vendor counter-claim: vidIQ has reported that thumbnails with faces showing strong emotion can lift CTR by 20–30%, with surprise expressions specifically lifting CTR by ~49% (per Banana Thumbnail's March 2026 summary citing vidIQ data). AmpiFire's Nov 2025 synthesis: human-face videos receive 921,000 more views on average than faceless ones; sad faces appear in only 1.8% of thumbnails yet achieve the highest average views at 2.3 million.

**Disagreement called out.** The 1of10 dataset (300K videos) is the larger N and methodologically the most defensible. vidIQ's 20–30% number is not dataset-anchored in the public version. Use 1of10's "depends on niche and channel size" framing as the primary truth; use vidIQ's expression-specific lifts as supporting evidence.

**Operational rule:** assume faces help **for talking-head / vlog / finance** content, but DON'T force a face into product / screen-recording / B-roll-heavy thumbnails. If \`score_shot\`'s ranked frames don't surface a strong expressive face within the top 5, that's diagnostic — pick a strong product / screen frame instead.

When \`compose_thumbnail_variants\` does pick face frames, prefer:

- **Face fills ≥35% of frame area.** Half a face is fine if the visible half is expressive.
- **Clear emotion** — surprise, delight, focus, mild anger, fear. Neutral does NOT work; the eyes do most of the work.
- **Eyes look at the camera** OR at the label / subject.
- **Surprise specifically** — wide eyes, open mouth — reportedly the strongest single emotion (vidIQ).

---

## Text in the thumbnail

YouTube's own guidance is "minimal, high-impact words" — confirmed across multiple primary sources:

- **[primary]** YouTube's Test & Compare commentary, via vidIQ (July 25 2025, citing Rene Ritchie): *"Great thumbnails don't just get viewers to click. They also help viewers understand what the video is about, so that they can make informed decisions about what to watch."*
- **[secondary]** Influencer Marketing Hub paraphrasing YouTube guidance: *"Text on thumbnails should clarify the promise of the video, but there's a fine balance between brevity and context. YouTube recommends using minimal, high-impact words rather than full sentences. For example, 'Best Budget Camera' will often outperform 'Here Are the Best Budget Cameras for 2025'."*

**Operational constraints at 100 × 56:**

- **2–4 words MAX.** "How I built this in a weekend" is 6 words — unreadable. **"WEEKEND BUILD"** wins.
- **One font, two weights at most.** Bold for the headline, regular for any subtitle. Picking a third "fun" font cheapens the thumbnail every time.
- **Heavy outlines/stroke** — 4–8 px on a 1280 × 720 thumbnail. Without an outline the text disappears against any non-uniform background.
- **Avoid serifs at thumbnail size.** They blur. Use sans-serif (Bebas, Impact, Inter Black, similar).
- **Hard-cap title length.** A 30-character ceiling forces the discipline.

**Don't use the video title as the thumbnail text.** They're different jobs:
- **Title** — SEO + curiosity (8–10 words, optimised for search)
- **Thumbnail text** — visual punch (2–4 words, optimised for scan)

\`compose_thumbnail_variants(text=...)\` should NOT receive the YouTube title verbatim. Pass a 2–4 word distillation. Often this is the **hook line shortened**.

---

## Colour budget

**[secondary, common-practice]** Use **3 colours maximum** in the thumbnail (excluding skin tones, which are free).

Classic creator palette:
- **High-contrast hero colour** — saturated yellow, red, or cyan, used for text outline OR a single accent
- **Background fill** — solid or near-solid; dark or light enough to make the subject pop
- **Subject's natural colours** — skin, clothing

At 100 × 56 every additional colour is one fewer "lock-on" point for the eye.

**[primary, brand kit hook]** If \`<cwd>/.gg/brand.json\` defines \`colors.primary\`, USE IT for the text outline or the accent. Channel-level colour identity drives recognition in a feed (the viewer recognises the channel's palette before reading the text). Don't pick a new colour every video.

---

## Composition / layout

The dominant compositions creators converge on:

### A. Rule-of-thirds: face left + label right (default for talking-head)
\`\`\`
+----------------------+
|        |             |
|  FACE  |   LABEL     |
|        | TWO LINES   |
|        |             |
+----------------------+
\`\`\`
Face takes left third or two-thirds; label sits in negative space. Vlogs, tutorials, reactions.

### B. Centred subject + arc text (products / builds)
\`\`\`
+----------------------+
|     LABEL ABOVE      |
|       (PRODUCT)      |
|     LABEL BELOW      |
+----------------------+
\`\`\`
Object centred; label arcs above and below or just above. Eye locks on the centred object first.

### C. Before / after split (transformations)
\`\`\`
+----------+----------+
|  BEFORE  |  AFTER   |
|     -- ARROW --     |
|         WORD        |
+----------+----------+
\`\`\`
Vertical or horizontal split, an arrow, a single labelling word. Fitness, builds, redesigns, makeovers.

### D. Tight close-up + circle / red zone (tutorials, especially software)
\`\`\`
+----------------------+
|     LABEL ABOVE      |
|     [⊙ ZOOMED-IN     |
|       DETAIL]        |
+----------------------+
\`\`\`
Red circle or arrow on a specific detail. Universal in tech / software niches.

**One focal point.** The viewer's eye should know where to look in 0.3 seconds. Pick one composition; stick to it.

---

## YouTube's native A/B testing — Test & Compare

Critical change in 2024–2025: YouTube rolled out native thumbnail (and title) A/B testing. **The agent should default to producing 3 variants and recommend Test & Compare to the user.**

**[primary]** Rene Ritchie via vidIQ (July 25 2025, https://vidiq.com/blog/post/youtube-launches-new-title-testing-tool/):

> *"Pick up to 3 versions of your title. You can also select up to 3 thumbnails. Mix and match if you want. YouTube will randomly serve each variation to viewers… YouTube doesn't use click-through rate (CTR) as the winning metric — it uses Watch Time Share. That means the title that leads to more sustained viewing wins, not necessarily the one that gets the fastest clicks. Tests typically run from 1 to 14 days, depending on how quickly statistical significance is reached. Once there's a clear winner, YouTube automatically applies it to your video."*

**[primary]** Same source on why CTR isn't the winning metric: *"If you over-index on CTR, it could become click-bait, which could tank retention, and hurt performance."*

**Operational implication — the agent CANNOT trigger Test & Compare itself** (no public API; the test lives only in YouTube Studio). The agent's job is to PRODUCE the right 3 variants and tell the user to upload them.

**Single-variable A/B is built into \`compose_thumbnail_variants\` via the \`strategy\` param:**

- **\`strategy="expression"\`** — picks 3 distinct face/expression frames; same label on all three. Use when source has multiple expressive faces.
- **\`strategy="label"\`** — picks ONE strong frame; LLM generates 3 distinct 2–4-word label variants; renders the same frame three times with different labels. Use when source has only one usable face / product / screen.
- **\`strategy="mixed"\`** (default) — 3 distinct frames + same label. Use when neither single-variable mode applies cleanly.

Don't ship a single thumbnail. Always 3 variants.

---

## What NOT to do

- **All-caps shouty SEVEN-WORD HEADLINES.** Unreadable.
- **Rainbow gradient text.** Wins zero A/B tests across the public datasets.
- **Stock arrow templates.** Identifies the channel as "first month on YouTube" instantly.
- **Watermarks on top of the subject.** If you must brand, place the watermark in a corner outside the focal area.
- **Repeating the title word-for-word.** Wastes the second hook surface.
- **Last week's expression, last week's composition.** Channels stagnate when every thumbnail looks identical. Vary expression and composition while keeping colour identity.
- **Clickbait that doesn't deliver.** Ritchie's quote above — Watch Time Share is the metric Test & Compare uses; CTR-spike + AVP-collapse is now actively penalised.

---

## Operationalising in the agent

The default \`compose_thumbnail_variants\` flow:

1. **Pre-call \`generate_youtube_metadata\`** to get the candidate titles. Pick the strongest one.
2. **Distill to 2–4 words** for the thumbnail label. Usually the hook line shortened, NOT the title verbatim.
3. **Call \`compose_thumbnail_variants(input, count=3, text="<distilled label>", strategy="...")\`**.
4. **Surface 3 outputs** to the user with the per-variant rationale the tool returns.
5. **Verify the thumbnail's promise** with \`verify_thumbnail_promise(thumbnail=variants[0].path, video=...)\` — if the opening 60s doesn't show what the thumbnail promises, surface a red marker and don't ship until the user picks a different frame or recuts the opener.
6. **Tell the user to run Test & Compare manually.** Suggested copy: *"Upload all three thumbnails to YouTube Studio's Test & Compare. YouTube picks the winner by Watch Time Share over 1–14 days. The agent can't trigger this for you — there's no API."*

**Brand kit integration (auto-applied).** When \`<cwd>/.gg/brand.json\` exists, \`compose_thumbnail\` and \`compose_thumbnail_variants\` already inherit:
- \`fonts.heading\` → used as \`fontFile\` if not overridden
- \`colors.primary\` → used as \`outlineColor\` if not overridden

The agent does not need to pass these explicitly. Each tool's output reports \`brandKitLoaded: true\` so the agent can confirm the kit was used.

---

## Sources & further reading

**Primary:**
- Search Engine Journal, *"Do Faces Help YouTube Thumbnails? Here's What the Data Says"*, Dec 22 2025 (1of10 Media's 300K viral video study) — https://www.searchenginejournal.com/do-faces-help-youtube-thumbnails-heres-what-the-data-says/563944/
- vidIQ, *"YouTube Launches New Title Testing Tool"*, July 25 2025 (Rene Ritchie quotes) — https://vidiq.com/blog/post/youtube-launches-new-title-testing-tool/
- YouTube Help Center — Test & Compare; Add Custom Thumbnails

**Secondary (vendor data, treat as directional):**
- AmpiFire, thumbnail face research, Nov 2025
- vidIQ, thumbnail psychology / face emotion lift, 2024–2025
- Banana Thumbnail, summary of vidIQ data, March 2026
- Influencer Marketing Hub, YouTube thumbnail guide, 2025

**Creator strategists worth following:**
- Paddy Galloway — paddygalloway.com, X threads
- Roberto Blake — YouTube channel + blog
- MrBeast leaked production manual, Aug 2024 (mirrored at simonwillison.net)
`;

export const SKILLS: Record<string, BundledSkill> = {
  "chapter-markers": {
    name: "chapter-markers",
    description: "Author YouTube/podcast chapter timestamps from a transcript: 5–15 chapters, first at 00:00, ≥30s apart, only at real topic shifts. Drops purple markers + emits a YouTube-formatted description block.",
    content: CHAPTER_MARKERS,
  },
  "fusion-lower-third": {
    name: "fusion-lower-third",
    description: "Build a name/title chyron natively in DaVinci Resolve's Fusion via fusion_comp — Background + TextPlus + Merge node graph, wiring, styling, lower-third positioning, keyframed fade in/out. Resolve Studio only; cross-host fallback is write_lower_third + burn_subtitles.",
    content: FUSION_LOWER_THIRD,
  },
  "keyframing-and-titles": {
    name: "keyframing-and-titles",
    description: "Recipes for the seven scripting gaps neither Resolve nor Premiere expose: timeline reorder, multi-track lanes, lower-thirds + title cards (ASS), keyframed opacity/position/volume ramps, audio mixing chains (EQ + comp + gate + de-esser + limiter), speed ramps, Ken-Burns, named transitions (smash-cut, whip-pan, dip-to-black).",
    content: KEYFRAMING_AND_TITLES,
  },
  "long-form-content-edit": {
    name: "long-form-content-edit",
    description: "Recipe for podcasts, interviews, vlogs, courses, talking-head. Five-pass method: utterance segmentation → take detection → filler removal → incomplete-sentence trim → silence normalization. Wires transcribe, cluster_takes, detect_silence, write_edl, import_edl, write_srt, add_marker into a single workflow.",
    content: LONG_FORM_CONTENT_EDIT,
  },
  "short-form-content-edit": {
    name: "short-form-content-edit",
    description: "Recipe for TikTok / Reels / Shorts. Find the moment → reformat 9:16 → hook the first 2 seconds → burn captions → render. Uses reformat_timeline, import_edl, set_clip_speed, write_srt, import_subtitles, open_page (Resolve).",
    content: SHORT_FORM_CONTENT_EDIT,
  },
  "skin-tone-matching": {
    name: "skin-tone-matching",
    description: "Match faces across clips when host scripting can't reach power windows or qualifiers. Two paths: grade_skin_tones (file-only — bakes a vision-derived colorbalance + selectivecolor + eq into a new mp4, pair with replace_clip) and match_clip_color (Resolve only — derives the same grade as a CDL via set_primary_correction).",
    content: SKIN_TONE_MATCHING,
  },
  "viral-hook-patterns": {
    name: "viral-hook-patterns",
    description: "Hook patterns sourced from primary creators (Jenny Hoyos on the official YouTube Blog, the leaked MrBeast production manual, Paddy Galloway's data analyses) — not generic creator-folklore. Read when analyze_hook fails, when picking a find_viral_moments candidate, or when generate_youtube_metadata needs a punchier title. Each pattern names a real creator example, the primary source, and the failure mode.",
    content: VIRAL_HOOK_PATTERNS,
  },
  "youtube-algorithm-primer": {
    name: "youtube-algorithm-primer",
    description: "How YouTube actually ranks videos in 2024–2026, sourced from Creator Insider, the YouTube Liaison (Rene Ritchie), Senior Director of Growth Todd Beaupré, Paddy Galloway, and the Retention Rabbit 2025 benchmark study. Read when generating titles/descriptions/chapters or when a video is underperforming. Numbers without a primary YouTube source are flagged as third-party heuristics.",
    content: YOUTUBE_ALGORITHM_PRIMER,
  },
  "youtube-end-to-end": {
    name: "youtube-end-to-end",
    description: "Orchestrator for \"make me a YouTube video from this footage\" using a TIMELINE-FIRST workflow. The agent edits the live Resolve/Premiere timeline so the user can scrub, tweak, and undo at every stage. Renders only happen at the end on explicit user intent (\"render\" / \"export\" / \"ship it\"). When host=none, falls back to file-only delivery and says so up front. Covers long-form, Shorts, captions, retention pipeline, and the metadata bundle.",
    content: YOUTUBE_END_TO_END,
  },
  "youtube-thumbnail-design": {
    name: "youtube-thumbnail-design",
    description: "Thumbnail design rules sourced from a 300K-video study (1of10 Media via Search Engine Journal Dec 2025), the official YouTube Test & Compare guidance from Rene Ritchie (July 2025), and creator strategists. Read before composing thumbnails or picking variants from compose_thumbnail_variants. Numbers are tagged with their source so the agent doesn't misquote.",
    content: YOUTUBE_THUMBNAIL_DESIGN,
  },
};

export const SKILL_NAMES = Object.keys(SKILLS);
