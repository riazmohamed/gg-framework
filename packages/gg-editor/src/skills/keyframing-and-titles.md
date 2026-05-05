---
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

```
get_timeline                                  # discover clipIds in order
clone_timeline(newName="<original>-v2")       # safety net
reorder_timeline(newOrder=["c5","c1","c2","c3","c4"])
```

`reorder_timeline` reads the current timeline, emits a permuted FCPXML,
and `import_timeline`s it. Clips not listed in `newOrder` keep their
original relative order and append at the end.

---

## Recipe 2 — Multi-track B-roll composition

The user wants several B-roll cutaways stacked above the main A-roll
with per-clip opacity and timing.

```
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
```

For single-clip layers without keyframes, `insert_broll` is simpler.

---

## Recipe 3 — Lower-thirds + title cards

Both go through `.ass` (Advanced SubStation Alpha) files because stock
Homebrew ffmpeg doesn't ship `drawtext`. Pair with `burn_subtitles` to
bake into a finished video.

```
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
```

To keep titles editable inside the NLE instead of baked, use
`write_fcpxml` with the `titles` field, then `import_edl`.

---

## Recipe 4 — Speed ramps

Cinematic slow-down-then-resume:

```
speed_ramp(
  input="action.mp4", output="action.ramped.mp4",
  points=[
    { atSec:0,   speed:1   },   # normal
    { atSec:2.5, speed:0.4 },   # slow-mo
    { atSec:4.0, speed:1   }    # back to normal
  ]
)
```

Audio is time-stretched via atempo, no pitch shift. For ramps where
you want video without audio: pass `muteAudio=true`.

---

## Recipe 5 — Audio mixing per clip

Voice-preset:

```
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
```

Order: `clean_audio` (denoise) → `mix_audio` (shape) →
`normalize_loudness` (target platform LUFS).

---

## Recipe 6 — Ken-Burns on stills

For photo galleries / quote cards / book covers:

```
ken_burns(input="photo.jpg", output="photo.kb.mp4",
         durationSec=4, startZoom=1, endZoom=1.4, direction="ne")
```

Output is a silent libx264 clip. Then `concat_videos` it with main
footage, or `insert_broll` it onto a higher track via `compose_layered`.

---

## Recipe 7 — Named transitions

For energetic cuts:

```
transition_videos(inputA="a.mp4", inputB="b.mp4", output="ab.mp4",
                  preset="whip-left")        # 0.15s wipe
transition_videos(..., preset="smash-cut")    # 1-frame blend, jump-cut feel
transition_videos(..., preset="dip-to-black", durationSec=0.8)
```

For raw xfade names beyond the preset list, use `crossfade_videos`.

---

## Don't

- Don't render before the user reviews the rebuilt timeline.
- Don't run reorder_timeline / compose_layered without
  `clone_timeline` first — the import is destructive.
- Don't try to drawtext on a still frame; ffmpeg doesn't have it on
  most installs. Always go through ASS.
- Don't keyframe opacity / position on Premiere via UXP — it's not
  exposed; emit FCPXML with the keyframes baked in instead.
