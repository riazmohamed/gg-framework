/**
 * Clip scoring — does this arbitrary window earn the watch?
 *
 * `analyze_hook` only scores the first 3 seconds (the algorithmic
 * checkpoint). Once you're past the hook, the next questions are:
 *
 *   - Hook       — does the OPENER (first ~5s) earn the watch?
 *   - Flow       — does the middle stay engaging without dragging?
 *   - Engagement — emotional intensity, curiosity gap, payoff.
 *   - Trend      — is the topic something currently shareable?
 *
 * One LLM call: transcript window in (and optional sample frames),
 * structured 0-1 scores out, weighted total 0-100. Pure-ish — the
 * scoring rubric, prompt template, parser and weighting all live here so
 * `find_viral_moments` can reuse the engine without going through the
 * tool wrapper.
 */
import { readFileSync } from "node:fs";
import { resolveApiKey } from "./auth/api-keys.js";

export interface ClipScoreResponse {
  hook: number;
  flow: number;
  engagement: number;
  trend: number;
  why: string;
}

export interface ClipScore extends ClipScoreResponse {
  score: number;
  durationSec: number;
}

export interface ClipScoreWeights {
  hook?: number;
  flow?: number;
  engagement?: number;
  trend?: number;
}

const DEFAULT_WEIGHTS = {
  hook: 30,
  flow: 25,
  engagement: 30,
  trend: 15,
};

const CLIP_SYSTEM = `You are a short-form video selector. Your job is to score a CLIP (transcript ± sample frames) on its potential to go viral as a standalone Short / Reel / TikTok.

Output a JSON object with these EXACT keys (no extras, no prose):
{
  "hook":       <0..1>,
  "flow":       <0..1>,
  "engagement": <0..1>,
  "trend":      <0..1>,
  "why": "<≤160 char rationale: name the strongest + weakest dimension>"
}

Scoring rubric:

hook        — Does the OPENING line earn the watch?
  1.0 = strong scroll-stop opener (question, claim, shocking number, named subject);
  0.5 = neutral lead; 0.0 = throat-clear / "so basically..." / dead air.

flow        — Does the clip stay engaging across its full duration?
  1.0 = every beat earns its time, no dragging, payoff lands;
  0.5 = some slack but recovers; 0.0 = meanders / repeats / loses thread.

engagement  — Emotional intensity, curiosity gap, surprise, payoff.
  1.0 = strong emotional beat (laugh / shock / tension / aha);
  0.5 = mildly interesting; 0.0 = flat informational.

trend       — Topic currency. Does it intersect with what's currently
  trending / evergreen-shareable on short-form?
  1.0 = on-trend (AI, money, dating, fitness, productivity, gaming meta, current events);
  0.5 = niche but proven shareable; 0.0 = obscure / dated / business-jargon.

Be honest. A technically-clean but flat clip should score 0.3-0.4, not 0.6+.`;

/**
 * Robust parser — tolerates prose around the JSON, missing keys, and
 * out-of-range numbers. Mirrors `parseHookVisionResponse`.
 */
export function parseClipScoreResponse(content: string): ClipScoreResponse {
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start < 0 || end < start) {
    throw new Error("clip-scoring: no JSON object in response");
  }
  const parsed = JSON.parse(content.slice(start, end + 1));
  return {
    hook: clamp01(num(parsed.hook, 0)),
    flow: clamp01(num(parsed.flow, 0)),
    engagement: clamp01(num(parsed.engagement, 0)),
    trend: clamp01(num(parsed.trend, 0)),
    why: String(parsed.why ?? "").slice(0, 240),
  };
}

/**
 * Combine the four 0-1 dimensions into a single 0-100 score, using the
 * default (or caller-supplied) weights.
 */
export function combineClipScore(
  vision: ClipScoreResponse,
  durationSec: number,
  weights: ClipScoreWeights = {},
): ClipScore {
  const w = { ...DEFAULT_WEIGHTS, ...weights };
  const wSum = w.hook + w.flow + w.engagement + w.trend;
  const raw =
    w.hook * vision.hook +
    w.flow * vision.flow +
    w.engagement * vision.engagement +
    w.trend * vision.trend;
  const score = Math.round((raw / wSum) * 100);
  return {
    score,
    hook: vision.hook,
    flow: vision.flow,
    engagement: vision.engagement,
    trend: vision.trend,
    why: vision.why,
    durationSec,
  };
}

export interface ScoreClipOptions {
  apiKey?: string;
  model?: string;
  detail?: "low" | "high";
  weights?: ClipScoreWeights;
  signal?: AbortSignal;
}

/**
 * Run the LLM scoring pass. Frames are optional — transcript-only is
 * the cheap default; pass frames when visual energy matters.
 *
 * Pure-ish: the only side effects are the OpenAI fetch and reading
 * frame files off disk. Used directly by both the tool wrapper and
 * `find_viral_moments`.
 */
export async function scoreClipInternal(
  transcriptText: string,
  startSec: number,
  endSec: number,
  framePaths: string[] = [],
  opts: ScoreClipOptions = {},
): Promise<ClipScore> {
  const apiKey = opts.apiKey ?? resolveApiKey("OPENAI_API_KEY", "openai");
  if (!apiKey) throw new Error("OPENAI_API_KEY required for score_clip.");
  const durationSec = Math.max(0, endSec - startSec);
  const detail = opts.detail ?? "low";
  const model = opts.model ?? "gpt-4o-mini";

  const userContent: Array<
    | { type: "text"; text: string }
    | { type: "image_url"; image_url: { url: string; detail: "low" | "high" } }
  > = [
    {
      type: "text",
      text:
        `CLIP WINDOW: ${startSec.toFixed(2)}s → ${endSec.toFixed(2)}s ` +
        `(${durationSec.toFixed(2)}s).\n\nTRANSCRIPT:\n${transcriptText.trim() || "(empty)"}`,
    },
  ];
  for (const p of framePaths) {
    const mime = p.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg";
    const b64 = readFileSync(p).toString("base64");
    userContent.push({
      type: "image_url",
      image_url: { url: `data:${mime};base64,${b64}`, detail },
    });
  }

  const body = {
    model,
    messages: [
      { role: "system", content: CLIP_SYSTEM },
      { role: "user", content: userContent },
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
  if (!content) throw new Error("score_clip: empty model response");
  const parsed = parseClipScoreResponse(content);
  return combineClipScore(parsed, durationSec, opts.weights);
}

// ── Helpers ─────────────────────────────────────────────────

function num(v: unknown, fb: number): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fb;
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}
