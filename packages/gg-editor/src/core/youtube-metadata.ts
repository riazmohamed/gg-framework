/**
 * YouTube metadata generation — title / description / tags / chapters.
 *
 * One LLM call, transcript in, complete metadata out. The LLM is
 * instructed to derive chapters from REAL topic shifts (not fabricated
 * ones) and to keep titles ≤70 chars (YouTube truncates above that on
 * mobile).
 */

import { resolveApiKey } from "./auth/api-keys.js";
import type { Transcript } from "./whisper.js";

export interface YouTubeChapter {
  atSec: number;
  title: string;
}

export interface YouTubeMetadata {
  titles: string[];
  description: string;
  tags: string[];
  chapters: YouTubeChapter[];
  hashtags: string[];
}

const SYSTEM = `You are a YouTube growth specialist. Given a transcript, produce a complete metadata package optimized for ranking AND click-through.

Output JSON with these EXACT keys:
{
  "titles":      [string, string, string],   // 3 candidates, EACH ≤70 chars, hook-driven
  "description": string,                      // 200-500 words, includes timestamp lines that match the chapters EXACTLY
  "tags":        [string, ...],               // exactly 15, single phrases (no #), ordered most→least specific
  "chapters":    [{"atSec": number, "title": string}, ...],
  "hashtags":    [string, string, string]    // 3-5 trending hashtag candidates, "#"-prefixed
}

Rules — non-negotiable:
- Titles: NO clickbait that doesn't deliver. Use a number, a question, or a named subject. ≤70 chars. Include the primary keyword.
- Chapters: derive from REAL topic shifts in the transcript — do NOT invent boundaries. First chapter MUST be at 00:00 (atSec 0). Adjacent chapters ≥ 30s apart. 5-15 chapters total. If the transcript is shorter than ~5 minutes, return chapters: [].
- Description: starts with a 1-2 sentence hook (NOT just the title). Include the chapter list (\`00:00 Title\` per line, MM:SS or HH:MM:SS format). End with a single CTA + the hashtags.
- Tags: 15 entries, lowercase preferred, no leading "#", no duplicates, no quotes.
- Hashtags: leading "#", camelCase or lowercase, no spaces.

Be honest. If the content doesn't justify a chapter, omit it. Sparse-but-real beats dense-but-fake.`;

export interface MetadataOptions {
  apiKey?: string;
  model?: string;
  channelStyle?: string;
  videoTopic?: string;
  signal?: AbortSignal;
}

export async function generateMetadata(
  t: Transcript,
  opts: MetadataOptions = {},
): Promise<YouTubeMetadata> {
  const apiKey = opts.apiKey ?? resolveApiKey("OPENAI_API_KEY", "openai");
  if (!apiKey) throw new Error("OPENAI_API_KEY required for generate_youtube_metadata.");
  const model = opts.model ?? "gpt-4o-mini";

  const transcriptText = t.segments
    .map((s) => `[${s.start.toFixed(1)}s] ${s.text.trim()}`)
    .join("\n");

  const userParts: string[] = [];
  if (opts.channelStyle) userParts.push(`CHANNEL VOICE:\n${opts.channelStyle}`);
  if (opts.videoTopic) userParts.push(`VIDEO TOPIC HINT:\n${opts.videoTopic}`);
  userParts.push(`DURATION: ${t.durationSec.toFixed(1)}s`);
  userParts.push(`TRANSCRIPT (with [t]s tags for chapter alignment):\n${transcriptText}`);

  const body = {
    model,
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: userParts.join("\n\n") },
    ],
    response_format: { type: "json_object" },
    temperature: 0,
  };

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: opts.signal,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`OpenAI HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = (await res.json()) as { choices: Array<{ message: { content: string } }> };
  const content = data.choices[0]?.message?.content;
  if (!content) throw new Error("generate_youtube_metadata: empty model response");
  return enforceMetadataConstraints(parseMetadataResponse(content), t.durationSec);
}

/**
 * Robust parser. Tolerates prose around the JSON, missing keys, mistyped
 * arrays. Mirrors `parseHookVisionResponse` in spirit.
 */
export function parseMetadataResponse(content: string): YouTubeMetadata {
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start < 0 || end < start) {
    throw new Error("youtube-metadata: no JSON object in response");
  }
  const parsed = JSON.parse(content.slice(start, end + 1));

  const titles = arrOf(parsed.titles, (v) => String(v).slice(0, 100));
  const description = String(parsed.description ?? "");
  const tags = arrOf(parsed.tags, (v) => String(v).replace(/^#/, "").trim().slice(0, 60)).filter(
    Boolean,
  );
  const hashtags = arrOf(parsed.hashtags, (v) => {
    const s = String(v).trim().slice(0, 60);
    return s.startsWith("#") ? s : `#${s}`;
  }).filter((s) => s.length > 1);
  const chaptersRaw = Array.isArray(parsed.chapters) ? parsed.chapters : [];
  const chapters: YouTubeChapter[] = [];
  for (const c of chaptersRaw) {
    if (typeof c !== "object" || c === null) continue;
    const r = c as Record<string, unknown>;
    const atSec = Number(r.atSec);
    const title = String(r.title ?? "").trim();
    if (!Number.isFinite(atSec) || atSec < 0 || !title) continue;
    chapters.push({ atSec, title: title.slice(0, 100) });
  }
  return { titles, description, tags, chapters, hashtags };
}

/**
 * Apply the hard constraints we promise downstream:
 *   - titles: max 3, each truncated to 70 chars
 *   - tags: exactly 15 (slice or pad — pad with empty filtered out)
 *   - chapters: drop if duration < 5 min; first must be at 00:00; adjacent ≥30s
 *   - hashtags: 3-5 entries
 *
 * Pure — exported for testing.
 */
export function enforceMetadataConstraints(
  m: YouTubeMetadata,
  durationSec: number,
): YouTubeMetadata {
  const titles = m.titles.slice(0, 3).map((t) => t.slice(0, 70));
  // pad to 3 only if we got >=1; otherwise leave empty so caller sees the gap.
  while (titles.length > 0 && titles.length < 3) titles.push(titles[0]);

  const tags = uniq(m.tags).slice(0, 15);

  const hashtags = uniq(m.hashtags).slice(0, 5);

  let chapters: YouTubeChapter[] = [];
  if (durationSec >= 300) {
    // Sort, force first at 0, enforce ≥30s gap between consecutive.
    const sorted = [...m.chapters].sort((a, b) => a.atSec - b.atSec);
    if (sorted.length > 0) {
      sorted[0] = { atSec: 0, title: sorted[0].title };
    }
    for (const c of sorted) {
      if (chapters.length === 0) {
        chapters.push(c);
        continue;
      }
      const last = chapters[chapters.length - 1];
      if (c.atSec - last.atSec >= 30 && c.atSec < durationSec) chapters.push(c);
    }
    if (chapters.length < 5 || chapters.length > 15) {
      // YouTube requires ≥3 to render; we promise 5-15. If we can't honor
      // it, emit []. The caller will surface that the LLM didn't find
      // enough real topic shifts.
      if (chapters.length < 5) chapters = [];
      else chapters = chapters.slice(0, 15);
    }
  }

  return { titles, description: m.description, tags, chapters, hashtags };
}

// ── Helpers ─────────────────────────────────────────────────

function arrOf<T>(v: unknown, map: (raw: unknown) => T): T[] {
  if (!Array.isArray(v)) return [];
  return v.map(map);
}

function uniq(xs: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of xs) {
    if (!x) continue;
    const k = x.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(x);
  }
  return out;
}
