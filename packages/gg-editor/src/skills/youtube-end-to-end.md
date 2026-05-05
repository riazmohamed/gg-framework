---
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

- **Input duration** via `probe_media`. Anything > 5 minutes → assume long-form. Anything ≤ 5 minutes → assume short-form. Both for source > 5 min when prompt is silent.
- **Brand kit:** read `<cwd>/.gg/brand.json` silently. All render-time tools inherit; don't ask about typography or logos.
- **Host check:** call `host_info`. If host=none, tell the user *"No NLE attached — I'll produce standalone mp4s. Open Resolve / Premiere if you want a timeline-native edit you can keep tweaking."* Then proceed with the file-only fallback path (skip steps 2-5 timeline ops; jump to render).

If duration is 4–6 min AND prompt is silent on format, ASK once: *"Long-form, Shorts, or both?"*. One question, then run.

---

## Step 1 — Foundation pass (timeline-safe; runs once)

```
host_info                               → confirm host + caps
get_timeline                            → fps, duration, existing markers
get_markers                             → prior decisions / session resume
clone_timeline(name="…-edit-v1")        → SAFETY NET before destructive ops
save_project                            → checkpoint
probe_media(input)                      → fps, duration, codecs
extract_audio(input, audio.wav, sampleRate=16000)
transcribe(audio.wav, transcript.json,
           wordTimestamps=true)         → word-level transcript
```

Word timings are mandatory — every retention multiplier downstream needs them. If the source is multi-cam, also run `multicam_sync` first and pick the alignment.

**No render in step 1. No file-baking. The user's timeline is now the working copy.**

---

## Step 2 — Long-form edits, ON THE TIMELINE (when long-form is in the brief)

Each of these MODIFIES THE TIMELINE the user is watching. The user can play back, scrub, and ask for changes between any of them.

```
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
```

After step 2 the user has a fully-edited LONG-FORM TIMELINE in Resolve/Premiere. They can play it. Scrub to any point. Watch the b-roll cutaways. Read the chapter markers. **No mp4 has been rendered yet.**

---

## Step 3 — Shorts pass, ALSO timeline-first

```
find_viral_moments(transcript, maxClips=3,
                   durationRange=[20, 45])      → ranked candidate windows
```

For each candidate (top score first):

```
analyze_hook(input, startSec=startSec, endSec=startSec+3)
                                                 → score 0-100 + findings
```

If `score < 60`, drop a red marker and skip — bad hook = bad short. Don't ship a sub-60 hook silently; either run `rewrite_hook` to surface candidates and let the user decide, or move on to the next moment.

Otherwise, **build the short on a NEW Resolve timeline so the long-form timeline isn't disturbed:**

```
clone_timeline(name="short-${i}")                # New timeline for this short
# Trim to the candidate window via EDL:
text_based_cut(sourceVideo,
               cuts=[{startSec: 0, endSec: candidate.startSec},
                     {startSec: candidate.endSec, endSec: totalSec}])
import_edl(path)                                 # Window appears on the new timeline ✓

# Captions burned (vertical Shorts; sidecar isn't standard for Shorts)
write_keyword_captions(transcript, output="short-${i}.ass",
                       startSec=candidate.startSec,
                       endSec=candidate.endSec,
                       autoEmoji=true, groupSize=2)
import_subtitles(srtPath="short-${i}.ass")     # Attached to subtitle track ✓
# (Final pixel-burn happens at render time, not here.)

# Punch-ins at the candidate's internal cut points (timeline-native — coming;
# for now, surface to user with a marker so they apply manually OR queue
# for the file-bake step at render time)

# SFX on cuts — TIMELINE-NATIVE
add_sfx_to_timeline(sfx="whoosh", cutPoints=[…internal cuts…], track=3)  ✓

add_marker(color="green",
           note="short ${i}: hook=${analyzeHook.score}, virality=${candidate.score}")
```

User can now switch between long-form timeline and each `short-${i}` timeline in Resolve, play back, scrub, tweak.

---

## Step 4 — Pre-flight audit (still no render)

```
audit_first_frame(sourceClipPath)                # Galloway: "intro = thumbnail"
analyze_hook(sourceClipPath)                     # spoken-line check
verify_thumbnail_promise(thumb, video, 60)       # MrBeast: deliver in first 60s
audit_retention_structure(transcript, [180,360]) # mid-video checkpoints
```

Surface every finding with score + suggestion. **Don't render past a blocker.** If the user says "fix the weak hook," go back to step 2/3 with `rewrite_hook` candidates and propose them — DON'T silently re-cut.

---

## Step 5 — Metadata bundle (REQUIRED before declaring "ready to ship")

```
generate_youtube_metadata(transcript)            # titles[3], description, tags[15],
                                                 #   chapters[], hashtags[]

compose_thumbnail_variants(input=long-form-render-OR-source-frame,
                           outputDir="./thumbs",
                           text="<distill best title to 2–4 words>",
                           count=3,
                           strategy="expression")
```

Surface the 3 candidate titles + 3 thumbnail variants + the description to the user. Tell them to upload all three thumbnails to YouTube Studio's **Test & Compare** (no API for this — must be manual).

---

## Step 6 — STOP HERE

This is the natural pause point. The user has:
- A fully-edited long-form timeline in their NLE
- 1–3 Shorts timelines in their NLE
- 3 thumbnail variants on disk
- A metadata bundle (titles, description, chapters, tags, hashtags)

Tell the user:

> ✅ Long-form ready on timeline `<name>` (12:34, captions attached, brand-kit outro)
> ✅ Shorts ready on timelines `short-1`, `short-2`, `short-3` (hooks: 82, 76, 71)
> ✅ Thumbnail variants: `./thumbs/long-form.{1,2,3}.jpg`
> ✅ Metadata bundle written to chat above
>
> Play them back, scrub, tell me what to tweak. When you're happy, say **"render"** / **"export"** / **"ship it"** and I'll:
>   1. Run `pre_render_check` on each timeline
>   2. `render(...)` the long-form via Resolve's deliver page
>   3. `render_multi_format` the shorts to 9:16 / 1:1 / 4:5
>
> ⚠️ N candidate(s) dropped (<reason>): …

**Wait for the user's go-ahead. Do not call `render(...)` or `render_multi_format(...)` until they explicitly ask.**

---

## Step 7 — Render (only on "ship it" / "render" / "export")

When the user explicitly asks to render:

```
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
```

---

## What CHANGED vs the old export-everything flow

- **No file-baking mid-edit.** Captions are sidecar SRT, SFX are real audio clips on track A3, b-roll lands on V2 — all live in the user's NLE.
- **`burn_subtitles`, `add_sfx_at_cuts`, `face_reframe`, `mix_audio`, `clean_audio`, `duck_audio`, `loop_match_short`, `bleep_words`, `speed_ramp`, `stabilize_video`** are the file-only tools the agent does NOT chain mid-edit. They're for the final delivery pass on user request.
- **`render(...)` / `render_multi_format(...)`** only fire after explicit user intent.
- **Each step modifies the live timeline** — user plays back, scrubs, asks for tweaks. The session is iterative, not a one-shot pipeline.

---

## What the agent CANNOT do (be honest with the user)

- Generate new footage. No re-shoots, no AI scenes. Only re-cut from existing source.
- Trigger YouTube Studio Test & Compare. No public API. Agent produces 3 variants; user uploads them.
- Read live channel metrics. No public CTR / AVD feed. ASK the user to paste from Studio.
- Re-record a hook line. `rewrite_hook` proposes 3 rewrites; user picks an existing alternative opener via `text_based_cut` or re-shoots.
- Render anything until the user says so. Even if you think it's done.

---

## Defaults & gates

- **Hook gate**: 60 (`analyze_hook`).
- **Virality gate**: 50 (`score_clip` total).
- **First-frame gate**: 60 (`audit_first_frame`).
- **Thumbnail-promise gate**: 0.6 (`verify_thumbnail_promise`).
- **Retention-checkpoint gate**: 0.5 per checkpoint (`audit_retention_structure`).
- **Short duration range**: 20–45 s — `find_viral_moments` default.
- **Loudness target**: -14 LUFS / -1 dBTP for YouTube + every short-form platform.
- **Caption style** (vertical): yellow keyword pop on white default, lower-third margin 220, `autoEmoji=true`.
- **SFX track**: A3 — keeps A1 dialogue / A2 music free.
- **Render**: only on explicit user intent — never automatic.
