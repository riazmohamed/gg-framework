/**
 * Bundled skill markdowns. Embedded as TS string constants so they ship in the
 * compiled package without depending on disk layout. Authored in
 * src/skills/*.md — regenerate this file by running `node build-skills.mjs`
 * from the package root if you edit the source markdowns.
 *
 * Skills are exposed through the read_skill tool; their descriptions live in
 * the system prompt. Pattern follows the Anthropic skills convention:
 * description in the prompt, full content on demand.
 */

export interface BundledSkill {
  name: string;
  description: string;
  content: string;
}

const LONG_FORM_CONTENT_EDIT = `# long-form-content-edit

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

const SHORT_FORM_CONTENT_EDIT = `# short-form-content-edit

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

const CHAPTER_MARKERS = `# chapter-markers

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

const KEYFRAMING_AND_TITLES = `# keyframing-and-titles

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

const SKIN_TONE_MATCHING = `# skin-tone-matching

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

const FUSION_LOWER_THIRD = `# fusion-lower-third

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

export const SKILLS: Record<string, BundledSkill> = {
  "long-form-content-edit": {
    name: "long-form-content-edit",
    description:
      "Recipe for podcasts, interviews, vlogs, courses, talking-head. Five-pass method: utterance segmentation → take detection → filler removal → incomplete-sentence trim → silence normalization. Wires our tools (transcribe, cluster_takes, detect_silence, write_edl, import_edl, write_srt, add_marker) into a single workflow.",
    content: LONG_FORM_CONTENT_EDIT,
  },
  "short-form-content-edit": {
    name: "short-form-content-edit",
    description:
      "Recipe for TikTok / Reels / Shorts. Find the moment → reformat 9:16 → hook the first 2 seconds → burn captions → render. Uses reformat_timeline, import_edl, set_clip_speed, write_srt, import_subtitles, open_page (Resolve).",
    content: SHORT_FORM_CONTENT_EDIT,
  },
  "chapter-markers": {
    name: "chapter-markers",
    description:
      "Recipe for YouTube/podcast chapter timestamps. Reads transcript in 90s windows, identifies topic shifts, drops purple markers, and emits a YouTube-formatted description block. Constraints: first chapter at 00:00, 5–15 chapters, ≥30s apart.",
    content: CHAPTER_MARKERS,
  },
  "keyframing-and-titles": {
    name: "keyframing-and-titles",
    description:
      "Recipes for the seven gaps neither Resolve nor Premiere expose via scripting: timeline reordering, multi-track / lane composition, lower-thirds and title cards (via ASS), keyframed opacity / position / volume ramps, audio mixing chains (EQ + comp + gate + de-esser + limiter), speed ramps, Ken-Burns on stills, and named transitions (smash-cut, whip-pan, dip-to-black). Wires reorder_timeline, compose_layered, write_lower_third, write_title_card, mix_audio, speed_ramp, ken_burns, transition_videos.",
    content: KEYFRAMING_AND_TITLES,
  },
  "skin-tone-matching": {
    name: "skin-tone-matching",
    description:
      "Recipe for matching faces across clips when host scripting can't reach power windows or qualifiers. Two paths: grade_skin_tones (file-only, every host — bakes a vision-derived colorbalance + selectivecolor + eq grade into a new mp4, pair with replace_clip) and match_clip_color (Resolve only — derives the same grade as a CDL and pipes it through set_primary_correction, non-baked). Both share one vision pass over a reference frame and a target frame; below confidence 0.4 the grade is unreliable.",
    content: SKIN_TONE_MATCHING,
  },
  "fusion-lower-third": {
    name: "fusion-lower-third",
    description:
      "Recipe for building a name/title chyron natively in DaVinci Resolve's Fusion page via fusion_comp. Walks the agent through Background + TextPlus + Merge node graph, wiring, text styling, lower-third positioning, and keyframed fade in/out via Merge.Blend. Resolve-only (Studio); for cross-host pixel-baked chyrons fall back to write_lower_third + burn_subtitles.",
    content: FUSION_LOWER_THIRD,
  },
};

export const SKILL_NAMES = Object.keys(SKILLS);
