---
name: youtube-algorithm-primer
description: How YouTube actually ranks videos in 2024–2026, sourced from Creator Insider, the YouTube Liaison (Rene Ritchie), Senior Director of Growth Todd Beaupré, Paddy Galloway, and the Retention Rabbit 2025 benchmark study. Read when generating titles/descriptions/chapters or when a video is underperforming. Numbers without a primary YouTube source are flagged as third-party heuristics.
---

# youtube-algorithm-primer

**When to use:** any time a tool needs to optimise FOR the algorithm — title generation, description structure, chapter placement, render-format selection, end-screen placement, multi-format render decisions. Also when the user asks "why isn't this getting views?" — the answer usually maps to one of the four signals below.

**What this is:** a working model with cited sources. Where a number comes from YouTube's own staff, it's marked **[primary]**. Where it comes from third-party tooling (vidIQ, TubeBuddy, Dataslayer) or aggregator sources, it's marked **[secondary]**. Where it's creator folklore with no traceable source, it's marked **[unverified]** — surface those to the user as heuristics, not laws.

**Source quality up front.** Most authoritative in 2024–2026 order: (1) Creator Insider, the Beaupré ↔ Ritchie video conversations, especially the Jan 23 2025 algorithm explainer; (2) Rene Ritchie's "Top Five" YouTube Blog posts and `@YouTubeLiaison` on X; (3) the YouTube Help Center on Test & Compare and Add Custom Thumbnails; (4) Paddy Galloway (data-driven creator strategist) — his X threads and Creator Science Podcast #209 (Jan 27 2026). Tool-vendor data (vidIQ, TubeBuddy, Dataslayer, Retention Rabbit) is useful directional signal but not platform-confirmed.

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
- Cliff in the first 30s → hook problem; rerun `analyze_hook` and recut opener.
- Slow steady decline → pacing; rerun `cut_filler_words`, tighten with `text_based_cut`, consider `punch_in` / `add_sfx_at_cuts`.
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

**Operational rule:** the brand kit's `outro` should chain to the next video. Description should reference previous / next uploads. `generate_outro` is the lever.

### 4. Engagement velocity (first 24–48 hours) — partial myth

The "first 48 hours decide everything" framing is overstated by SEO blogs.

**[primary]** Paddy Galloway, X thread Oct 16 2023 (still cited): *"The YouTube algorithm doesn't let you experiment. We recently tried a completely new format with a client. It started slow. 6/10. Now it's about to be our fastest ever video to hit 1 million views."*

**[secondary]** Dataslayer Jan 2026 directly debunks the "your video is dead if it doesn't pop in 48h" myth: *"YouTube's 2025 algorithm actively resurfaces old content when topics become relevant again. Videos about 'tax deductions for freelancers' spike in January and April."*

**[primary]** Rene Ritchie, YouTube Blog March 28 2024 (https://blog.youtube/culture-and-trends/renes-top-five-on-youtube-march-28-2024-edition/): *"Don't delete videos unless you have a very, very good reason. When you delete a video, you delete your channel's connection to the audience that watched that video."*

**Verdict for the agent:** first-hour CTR matters as a predictor for established formats. New formats and evergreen topics absolutely recover later. Don't tell users their video is dead at 48h.

---

## What YouTube has officially said it does NOT use

This is the most reliably citable section because it's all from YouTube's own staff.

- **Tags — minimal impact.** **[primary]** YouTube Liaison (`@YouTubeLiaison`), Aug 22 2024, summarised by Stan Ventures (https://www.stanventures.com/news/youtube-reveals-new-seo-priorities-756/): *"Liaison debunked this myth, stating that tags have a minimal impact on the algorithm. The primary recommendation was to use tags sparingly, emphasising on common misspellings of channel names or key topics related to the video."*
- **Hashtags — small effect, contextual only.** **[primary]** Same Liaison statement: *"hashtags should only be employed when they align with trending topics or help contextualise a video in a way that adds value."*
- **Categories — minor.** Same source: *"while categories help YouTube understand the general context of a video, they are a minor consideration in the grand scheme of things."*
- **Upload time of day — not algorithmic.** **[primary]** Rene Ritchie's March 28 2024 "Mythbusters" YouTube Blog post with Beaupré: posting time matters for *your audience's habits*, not algorithmically.
- **Subscriber count — weak signal.** **[secondary]** Dataslayer Jan 2026: *"In 2025, YouTube actively recommends videos from small channels. Subscriber count is one of hundreds of signals, and not a strong one. A 0-subscriber channel can appear in recommendations if the video performs well with test audiences."*
- **Dislikes — barely register.** **[secondary]** YoutoWire Jan 2026: *"Dislikes barely register. Algorithm treats them as 'engagement' (not negative signal). What DOES hurt: High 'Not Interested' clicks (when viewers tell YouTube 'Don't recommend this channel')."* Consistent with all Ritchie commentary on `Not Interested` being the actual penalty signal.
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

`generate_youtube_metadata` should propose 3 titles using **different patterns from this list**, not three variations of one. Pattern variety lets the user pick.

---

## Description structure (sidecar SEO + AVD lift)

The description's job is to:

1. **Restate the hook in the first 2 lines** — these show above-the-fold on mobile.
2. **Drop chapters** — clickable timestamps that double as table-of-contents. Required for any video > 5 minutes.
3. **Link related uploads** — pulls watch-time into your channel.
4. **CTA last** — subscribe/Patreon/etc. at the END, not the top.

Skeleton:

```
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
```

`generate_youtube_metadata` produces chapters and description body; the agent slots them into this skeleton.

---

## Shorts ranks differently

**[primary]** From Hootsuite Sept 2025 paraphrasing the official Shorts ranking explainer: *"A 30-second Short with 85% watch duration will likely rank higher than a 60-second Short with only 50% retention. Looping Shorts (where viewers rewatch part of the video) tend to get more recommendations than those with lower replay rates."*

**[primary]** Hootsuite continues: *"Unlike long-form videos, click-through rate (CTR) isn't a ranking factor [for Shorts], since users don't actively click Shorts — they swipe through them."*

**[primary]** Paddy Galloway's analysis of 3.3 billion Shorts views (Rattibha-archived X thread): *"The best-performing Shorts have between 70% and 90% of people viewing versus swiping away from them."* Operationalised: **target ≥ 70% view-vs-swipe rate** as a hard floor, ≥ 85% as the success bar.

**[primary]** Jenny Hoyos on YouTube's own blog (Jan 28 2025, https://blog.youtube/creator-and-artist-stories/youtube-shorts-deep-dive/): *"I really do think you have one second to hook someone, especially on Shorts."* The official YouTube Blog summarises her three-step formula: **shock, intrigue, satisfy**.

**Optimal Shorts duration:** **[primary]** Hoyos via Marketing Examined (May 16 2024 https://www.marketingexamined.com/blog/jenny-hoyos-short-form-video-playbook): aim for **30–34 seconds** with **90%+ retention** in the last second. **[secondary]** Boss Wallah Sept 2025 corroborates: target 90–100% retention on Shorts under 20 seconds.

**Implications for the agent (all executable today):**
- **Default Shorts length: 30–45 s, not 60 s.** `find_viral_moments` already defaults to `[20, 45]`.
- **Burned captions are not optional** — sound-off mobile is the default. Use `write_keyword_captions(autoEmoji=true)` + `burn_subtitles`.
- **First 0.5–1 s is the hook.** Use `audit_first_frame` to score the t=0 frame as a thumbnail (Galloway: 'treat your intro like a thumbnail'); pair with `analyze_hook` for the spoken-line check.
- **Seamless re-loop** — Shorts loop rate is a confirmed ranking signal. Run `loop_match_short` as the last step before delivery (crossfades the last ~0.3 s into the first frame).
- **Skip the outro on vertical.** `generate_outro` is for long-form.

---

## Operationalising this in the agent

The agent does NOT have access to live YouTube Studio metrics. When the user asks "why isn't this getting views?", first **ASK the user to paste the relevant numbers from Studio** (impressions, CTR, average view duration, average percentage viewed). Don't guess; don't fabricate.

Once numbers are in hand, **diagnose in this order** and surface the FIRST failing metric — don't dump all five:

1. **CTR < 4% (vs channel baseline)?** → Re-thumbnail + re-title. Run `compose_thumbnail_variants(strategy="expression")` for 3 face/expression variants and `generate_youtube_metadata` for 3 title candidates. Then: tell the user to upload all three thumbnails + one title per variant to YouTube Studio's **Test & Compare** — we cannot trigger that test from the agent; it lives only in Studio. Test & Compare optimises Watch Time Share (per Ritchie July 2025), so let YouTube pick the winner over 1–14 days.
2. **CTR ok but AVP% < 30%?** → Hook problem. Run `analyze_hook` for the t<3s check; if Shorts, also `audit_first_frame`. If hook scores low, run `rewrite_hook(currentHook=..., pattern="auto", videoTopic=...)` to generate 3 candidate rewrites — surface them to the user. The agent CANNOT re-record the spoken line; it can only (a) recut the opener from existing source footage via `text_based_cut`, or (b) recommend a re-shoot.
3. **AVP% ok but AVD low?** → Pacing. Run `audit_retention_structure(transcript)` to find the flat stretches between the 3-min and 6-min checkpoints. For each weak checkpoint, propose `cut_filler_words`, `text_based_cut`, `punch_in`, or `add_sfx_at_cuts` on the surrounding window.
4. **AVD ok but session contribution low?** → End-screen / outro / next-video pointer missing. Use `generate_outro` with the brand-kit chain (set `brand.outro` and the agent inherits it).
5. **Engagement velocity 0?** → No question in description (fix via `generate_youtube_metadata`'s description block) or tiny channel — the second case has no algorithmic fix; it's a community-size problem, not a tool problem. Be honest about this.

Surface ONE concrete fix per diagnosis, not the full menu.

**For pre-flight (before render):** the canonical short-form audit chain is `audit_first_frame` → `analyze_hook` → `verify_thumbnail_promise` → `audit_retention_structure` (long-form only). If any returns a blocking finding, surface a red marker and pause.

---

## Sources & further reading

**Primary (cite these first):**
- Creator Insider — Beaupré + Ritchie videos, especially Jan 23 2025 algorithm explainer (https://www.youtube.com/watch?v=dhYIb72L1hU)
- Rene Ritchie — `@YouTubeLiaison` on X; weekly "Top Five" YouTube Blog posts at https://blog.youtube/
- YouTube Help Center — Test & Compare, Add Custom Thumbnails
- YouTube Blog Jan 28 2025 — Jenny Hoyos Shorts deep dive (https://blog.youtube/creator-and-artist-stories/youtube-shorts-deep-dive/)

**Strong secondary:**
- Paddy Galloway — Creator Science Podcast #209 (Jan 27 2026); X threads at twitter.com/PaddyGalloway1
- Retention Rabbit 2025 Audience Retention Benchmark Report (May 2025) — https://www.retentionrabbit.com/blog/2025-youtube-audience-retention-benchmark-report
- Hootsuite YouTube algorithm guide (Sept 2025)
- Buffer YouTube algorithm guide (2025)

**Vendor benchmarks (treat as directional, not gospel):** vidIQ, TubeBuddy, Dataslayer, YTShark, AmpiFire.
