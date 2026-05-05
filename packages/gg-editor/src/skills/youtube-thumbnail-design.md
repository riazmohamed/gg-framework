---
name: youtube-thumbnail-design
description: Thumbnail design rules sourced from a 300K-video study (1of10 Media via Search Engine Journal Dec 2025), the official YouTube Test & Compare guidance from Rene Ritchie (July 2025), and creator strategists. Read before composing thumbnails or picking variants from compose_thumbnail_variants. Numbers are tagged with their source so the agent doesn't misquote.
---

# youtube-thumbnail-design

**When to use:** any time you compose a thumbnail (`compose_thumbnail`, `compose_thumbnail_variants`) or rank candidate hero frames (`score_shot`). Read this BEFORE writing the headline text — getting the headline wrong is the most common reason creator thumbnails underperform, more than any single visual choice.

**Source authority.** The strongest 2025 evidence on what actually works in thumbnails comes from: (1) **1of10 Media's 300,000-video viral study**, reported on Search Engine Journal (Dec 22 2025); (2) **YouTube's own Test & Compare tool** + Rene Ritchie's July 2025 commentary on what it optimises; (3) creator A/B data from **vidIQ, TubeBuddy, AmpiFire**. Tags `[primary]`, `[secondary, large-N]`, `[secondary, vendor]` mark provenance.

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

**Operational rule:** assume faces help **for talking-head / vlog / finance** content, but DON'T force a face into product / screen-recording / B-roll-heavy thumbnails. If `score_shot`'s ranked frames don't surface a strong expressive face within the top 5, that's diagnostic — pick a strong product / screen frame instead.

When `compose_thumbnail_variants` does pick face frames, prefer:

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

`compose_thumbnail_variants(text=...)` should NOT receive the YouTube title verbatim. Pass a 2–4 word distillation. Often this is the **hook line shortened**.

---

## Colour budget

**[secondary, common-practice]** Use **3 colours maximum** in the thumbnail (excluding skin tones, which are free).

Classic creator palette:
- **High-contrast hero colour** — saturated yellow, red, or cyan, used for text outline OR a single accent
- **Background fill** — solid or near-solid; dark or light enough to make the subject pop
- **Subject's natural colours** — skin, clothing

At 100 × 56 every additional colour is one fewer "lock-on" point for the eye.

**[primary, brand kit hook]** If `<cwd>/.gg/brand.json` defines `colors.primary`, USE IT for the text outline or the accent. Channel-level colour identity drives recognition in a feed (the viewer recognises the channel's palette before reading the text). Don't pick a new colour every video.

---

## Composition / layout

The dominant compositions creators converge on:

### A. Rule-of-thirds: face left + label right (default for talking-head)
```
+----------------------+
|        |             |
|  FACE  |   LABEL     |
|        | TWO LINES   |
|        |             |
+----------------------+
```
Face takes left third or two-thirds; label sits in negative space. Vlogs, tutorials, reactions.

### B. Centred subject + arc text (products / builds)
```
+----------------------+
|     LABEL ABOVE      |
|       (PRODUCT)      |
|     LABEL BELOW      |
+----------------------+
```
Object centred; label arcs above and below or just above. Eye locks on the centred object first.

### C. Before / after split (transformations)
```
+----------+----------+
|  BEFORE  |  AFTER   |
|     -- ARROW --     |
|         WORD        |
+----------+----------+
```
Vertical or horizontal split, an arrow, a single labelling word. Fitness, builds, redesigns, makeovers.

### D. Tight close-up + circle / red zone (tutorials, especially software)
```
+----------------------+
|     LABEL ABOVE      |
|     [⊙ ZOOMED-IN     |
|       DETAIL]        |
+----------------------+
```
Red circle or arrow on a specific detail. Universal in tech / software niches.

**One focal point.** The viewer's eye should know where to look in 0.3 seconds. Pick one composition; stick to it.

---

## YouTube's native A/B testing — Test & Compare

Critical change in 2024–2025: YouTube rolled out native thumbnail (and title) A/B testing. **The agent should default to producing 3 variants and recommend Test & Compare to the user.**

**[primary]** Rene Ritchie via vidIQ (July 25 2025, https://vidiq.com/blog/post/youtube-launches-new-title-testing-tool/):

> *"Pick up to 3 versions of your title. You can also select up to 3 thumbnails. Mix and match if you want. YouTube will randomly serve each variation to viewers… YouTube doesn't use click-through rate (CTR) as the winning metric — it uses Watch Time Share. That means the title that leads to more sustained viewing wins, not necessarily the one that gets the fastest clicks. Tests typically run from 1 to 14 days, depending on how quickly statistical significance is reached. Once there's a clear winner, YouTube automatically applies it to your video."*

**[primary]** Same source on why CTR isn't the winning metric: *"If you over-index on CTR, it could become click-bait, which could tank retention, and hurt performance."*

**Operational implication — the agent CANNOT trigger Test & Compare itself** (no public API; the test lives only in YouTube Studio). The agent's job is to PRODUCE the right 3 variants and tell the user to upload them.

**Single-variable A/B is built into `compose_thumbnail_variants` via the `strategy` param:**

- **`strategy="expression"`** — picks 3 distinct face/expression frames; same label on all three. Use when source has multiple expressive faces.
- **`strategy="label"`** — picks ONE strong frame; LLM generates 3 distinct 2–4-word label variants; renders the same frame three times with different labels. Use when source has only one usable face / product / screen.
- **`strategy="mixed"`** (default) — 3 distinct frames + same label. Use when neither single-variable mode applies cleanly.

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

The default `compose_thumbnail_variants` flow:

1. **Pre-call `generate_youtube_metadata`** to get the candidate titles. Pick the strongest one.
2. **Distill to 2–4 words** for the thumbnail label. Usually the hook line shortened, NOT the title verbatim.
3. **Call `compose_thumbnail_variants(input, count=3, text="<distilled label>", strategy="...")`**.
4. **Surface 3 outputs** to the user with the per-variant rationale the tool returns.
5. **Verify the thumbnail's promise** with `verify_thumbnail_promise(thumbnail=variants[0].path, video=...)` — if the opening 60s doesn't show what the thumbnail promises, surface a red marker and don't ship until the user picks a different frame or recuts the opener.
6. **Tell the user to run Test & Compare manually.** Suggested copy: *"Upload all three thumbnails to YouTube Studio's Test & Compare. YouTube picks the winner by Watch Time Share over 1–14 days. The agent can't trigger this for you — there's no API."*

**Brand kit integration (auto-applied).** When `<cwd>/.gg/brand.json` exists, `compose_thumbnail` and `compose_thumbnail_variants` already inherit:
- `fonts.heading` → used as `fontFile` if not overridden
- `colors.primary` → used as `outlineColor` if not overridden

The agent does not need to pass these explicitly. Each tool's output reports `brandKitLoaded: true` so the agent can confirm the kit was used.

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
