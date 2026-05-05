/**
 * Long-form → multi-shorts orchestrator.
 *
 * The "1 hour podcast → 10 shorts" pipeline. Slides a window across a
 * transcript, asks the LLM to nominate up to 3 candidate clips inside
 * each window, then `score_clip`'s every nominee, dedups overlaps, and
 * returns the top-N.
 *
 * Pure helpers + the LLM proposal step live here so the tool wrapper
 * can stay thin. The ranking + dedup pass is plain TS — easy to unit
 * test without the network.
 */

import { resolveApiKey } from "./auth/api-keys.js";
import type { Transcript } from "./whisper.js";

export interface ViralCandidate {
  startSec: number;
  endSec: number;
  hookLine: string;
  suggestedTitle: string;
  suggestedCaption: string;
  why: string;
}

export interface ScoredCandidate extends ViralCandidate {
  score: number;
  hook: number;
  flow: number;
  engagement: number;
  trend: number;
  durationSec: number;
}

export interface WindowSpec {
  startSec: number;
  endSec: number;
  /** Transcript text within this window, already extracted. */
  text: string;
}

/**
 * Slice the transcript into overlapping windows. Each window covers
 * `windowSec` seconds with `overlapSec` spillover into the next so a
 * clip straddling a boundary can still be proposed by at least one
 * window. The dedup step later collapses duplicates.
 *
 * Pure — exported for unit testing.
 */
export function buildSlidingWindows(
  t: Transcript,
  windowSec: number,
  overlapSec: number,
): WindowSpec[] {
  if (windowSec <= 0) throw new Error("windowSec must be > 0");
  if (overlapSec < 0 || overlapSec >= windowSec) {
    throw new Error("overlapSec must be in [0, windowSec)");
  }
  const total = t.durationSec;
  if (!Number.isFinite(total) || total <= 0) return [];

  const step = windowSec - overlapSec;
  const out: WindowSpec[] = [];
  for (let s = 0; s < total; s += step) {
    const e = Math.min(total, s + windowSec);
    const text = collectText(t, s, e);
    if (text) out.push({ startSec: s, endSec: e, text });
    if (e >= total) break;
  }
  return out;
}

function collectText(t: Transcript, startSec: number, endSec: number): string {
  const parts: string[] = [];
  for (const seg of t.segments) {
    if (seg.end <= startSec || seg.start >= endSec) continue;
    parts.push(seg.text.trim());
  }
  return parts.join(" ").trim();
}

/**
 * Dedup overlapping candidates: when two candidates overlap > 50% (of
 * the smaller), keep the higher-scoring one. Stable / sort-agnostic —
 * the function sorts internally before walking.
 *
 * Pure — exported for testing.
 */
export function dedupCandidates(cands: ScoredCandidate[]): ScoredCandidate[] {
  // Sort by score desc; for each, drop subsequent ones that overlap > 50%.
  const sorted = [...cands].sort((a, b) => b.score - a.score);
  const kept: ScoredCandidate[] = [];
  for (const c of sorted) {
    const conflict = kept.some((k) => overlapFraction(c, k) > 0.5);
    if (!conflict) kept.push(c);
  }
  return kept;
}

function overlapFraction(
  a: { startSec: number; endSec: number },
  b: { startSec: number; endSec: number },
): number {
  const lo = Math.max(a.startSec, b.startSec);
  const hi = Math.min(a.endSec, b.endSec);
  const overlap = Math.max(0, hi - lo);
  if (overlap === 0) return 0;
  const minLen = Math.min(a.endSec - a.startSec, b.endSec - b.startSec);
  if (minLen <= 0) return 0;
  return overlap / minLen;
}

/**
 * Clamp candidate ranges to [0, totalSec] and to the requested duration
 * range. Drops candidates that fall outside or are degenerate.
 */
export function normalizeCandidates(
  cands: ViralCandidate[],
  totalSec: number,
  minSec: number,
  maxSec: number,
): ViralCandidate[] {
  const out: ViralCandidate[] = [];
  for (const c of cands) {
    const s = Math.max(0, Math.min(totalSec, c.startSec));
    let e = Math.max(0, Math.min(totalSec, c.endSec));
    if (e <= s) continue;
    const dur = e - s;
    if (dur < minSec) continue;
    if (dur > maxSec) e = s + maxSec;
    out.push({ ...c, startSec: s, endSec: e });
  }
  return out;
}

// ── LLM proposal step ───────────────────────────────────────

const PROPOSAL_SYSTEM = `You are a short-form-video selector. Find up to 3 distinct moments inside the given transcript window that would make great standalone Shorts / Reels / TikToks.

Each candidate must satisfy:
- duration is within the requested range (the user will tell you the seconds bounds)
- hookLine = the FIRST SENTENCE of the clip (verbatim from transcript)
- suggestedTitle ≤ 60 chars, hook-driven (a question, a claim, or a number)
- suggestedCaption ≤ 220 chars, social-ready (hook + payoff tease, ≤2 hashtags)
- why ≤ 140 chars, names what makes this moment work

Return JSON: {"candidates":[{"startSec":number,"endSec":number,"hookLine":string,"suggestedTitle":string,"suggestedCaption":string,"why":string}, ...]}

Return at most 3 candidates. If nothing in the window is strong enough, return {"candidates":[]}. Be ruthless — bad clips waste compute downstream.`;

export interface ProposeOptions {
  apiKey?: string;
  model?: string;
  durationRange: [number, number];
  signal?: AbortSignal;
}

export async function proposeCandidates(
  window: WindowSpec,
  opts: ProposeOptions,
): Promise<ViralCandidate[]> {
  const apiKey = opts.apiKey ?? resolveApiKey("OPENAI_API_KEY", "openai");
  if (!apiKey) throw new Error("OPENAI_API_KEY required for find_viral_moments.");
  const model = opts.model ?? "gpt-4o-mini";
  const [minSec, maxSec] = opts.durationRange;

  const userText =
    `Window: ${window.startSec.toFixed(2)}s → ${window.endSec.toFixed(2)}s.\n` +
    `Duration range: ${minSec}s..${maxSec}s.\n\n` +
    `TRANSCRIPT:\n${window.text}`;

  const body = {
    model,
    messages: [
      { role: "system", content: PROPOSAL_SYSTEM },
      { role: "user", content: userText },
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
  const content = data.choices[0]?.message?.content ?? "";
  return parseProposalResponse(content);
}

/**
 * Tolerant parser. Drops malformed entries silently (we'd rather skip a
 * bad candidate than blow up the whole window).
 */
export function parseProposalResponse(content: string): ViralCandidate[] {
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start < 0 || end < start) return [];
  let obj: unknown;
  try {
    obj = JSON.parse(content.slice(start, end + 1));
  } catch {
    return [];
  }
  if (typeof obj !== "object" || obj === null) return [];
  const cands = (obj as { candidates?: unknown }).candidates;
  if (!Array.isArray(cands)) return [];
  const out: ViralCandidate[] = [];
  for (const c of cands) {
    if (typeof c !== "object" || c === null) continue;
    const r = c as Record<string, unknown>;
    const startSec = Number(r.startSec);
    const endSec = Number(r.endSec);
    if (!Number.isFinite(startSec) || !Number.isFinite(endSec)) continue;
    if (endSec <= startSec) continue;
    out.push({
      startSec,
      endSec,
      hookLine: String(r.hookLine ?? "").slice(0, 240),
      suggestedTitle: String(r.suggestedTitle ?? "").slice(0, 80),
      suggestedCaption: String(r.suggestedCaption ?? "").slice(0, 280),
      why: String(r.why ?? "").slice(0, 200),
    });
  }
  return out.slice(0, 3);
}
