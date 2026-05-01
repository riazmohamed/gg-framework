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
| `grade_skin_tones` | works on every host (Resolve, Premiere, no-NLE) | baked into a new file |
| `match_clip_color` | Resolve only | non-destructive, in the clip's grade node |

Pick **`grade_skin_tones`** when the user is on Premiere, when there's no
NLE, or when they want a finished file they can drop anywhere. Pair with
`replace_clip` to swap it onto the timeline.

Pick **`match_clip_color`** when the user is on Resolve and wants to keep
the grade tweakable. The tool pipes the CDL through
`set_primary_correction`, so the colorist can adjust after.

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

Use `score_shot(input, intervalSec=15)` or `extract_frame` to find good
candidates. If the user already pointed at a moment ("match shot 3 to
shot 1") use those timestamps directly.

### 2. Run the grade

**File-only path (works in every host):**

```
grade_skin_tones(
  referenceVideo="<ref.mp4>",
  referenceAtSec=<face-forward time>,
  targetVideo="<tgt.mp4>",
  targetAtSec=<face-forward time>,
  output="<tgt-graded.mp4>"
)
```

Returns `{path, confidence, why, grade}`. Then:

```
replace_clip(clipId="<target clip id>", mediaPath="<tgt-graded.mp4>")
add_marker(color="yellow", note="skin grade: <why>")
```

**Resolve non-baked path:**

```
match_clip_color(
  referenceVideo="<ref.mp4>",
  referenceAtSec=<face-forward time>,
  targetClipId="<target clip id>",
  targetAtSec=<face-forward time>,
  applyAutomatically=true
)
```

Returns `{applied, confidence, why, grade}`. The CDL goes into node 1
(or `nodeIndex=N` if you want a specific node).

### 3. Check confidence

The model's confidence is the most important field. Always inspect it:

- `confidence ≥ 0.7` — apply. Trust the result.
- `0.4 ≤ confidence < 0.7` — apply but flag for review:
  `add_marker(color="yellow", note="skin grade: review — confidence <X>")`.
- `confidence < 0.4` — DO NOT apply. The model is guessing. Tell the
  user what you saw, suggest they grade the shot manually or pick a
  better reference frame.

`match_clip_color` enforces this: with `applyAutomatically=true`,
confidence < 0.4 returns `{applied: false}` and the grade is surfaced
without writing to the node. `grade_skin_tones` always bakes the file
because the agent asked for an output path — but you can re-run with a
better reference frame if confidence was low.

---

## Defaults

| Knob | Default | Why |
|---|---|---|
| Vision detail | `low` | cheap; skin balance doesn't need pixel-peeping |
| Vision model | `gpt-4o-mini` | well-calibrated for color comparisons |
| Output codec | `libx264 crf=18` | visually lossless |
| Reference frame width | 768px | enough for skin-tone discrimination |

---

## What this is NOT

- NOT a deterministic ColorChecker match. There's no chart, no
  colorimetry — it's a vision pass.
- NOT a substitute for a colorist. Power windows / qualifiers / curves
  are out of scope. If skin needs to be isolated from a colored
  background, surface that and stop.
- NOT for whole-look matching across a project. For session-wide LUT
  application use `apply_lut` + `copy_grade`.

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
  then `copy_grade(sourceClipId=hero, targetClipIds=[...])` instead of
  re-running vision on every clip.

## Don't

- Don't pick a target frame where the face is in shadow or motion blur.
- Don't apply low-confidence grades silently.
- Don't run on top of an existing aggressive grade — clean state first
  or expect compounding shifts.
- Don't bake `grade_skin_tones` over the original target file. Always
  write to a new path.
