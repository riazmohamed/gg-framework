/**
 * Retention-structure auditor.
 *
 * Long-form videos live or die at the 3-min and 6-min marks. Per the
 * MrBeast manual: every ~3 minutes a "mini-hook" / re-engagement is
 * required — a twist, a reveal, a visual spectacle, an escalation. Flat
 * stretches between mini-hooks bleed retention; the YouTube graph
 * shows the dip almost every time.
 *
 * This module:
 *   1. Builds a 60s window centred on each requested checkpoint.
 *   2. Bundles all windows + a compact transcript outline into ONE LLM call.
 *   3. Parses the response into a structured report with per-checkpoint
 *      scores + an overall escalation pattern score.
 *
 * Pure parser + window-builder for unit tests; the network call lives
 * here too but is exported as `runRetentionAudit` so the wrapper tool
 * stays thin.
 */

import { resolveApiKey } from "./auth/api-keys.js";
import type { Transcript } from "./whisper.js";

export interface RetentionWindow {
  /** Centre of the window. */
  atSec: number;
  /** Inclusive [startSec, endSec]. */
  startSec: number;
  endSec: number;
  /** Concatenated transcript text falling inside the window. */
  text: string;
}

export interface CheckpointScore {
  atSec: number;
  /** 0-1. ≥0.5 = re-engagement detected. <0.5 = flat / weak. */
  score: number;
  /** ≤120 char description of what's happening at this checkpoint. */
  summary: string;
  /** ≤200 char actionable suggestion when score < 0.5. Empty otherwise. */
  suggestion: string;
}

export interface RetentionAuditResult {
  checkpoints: CheckpointScore[];
  /** 0-1. Does the video build progressively (1) or stay flat (0)? */
  escalationScore: number;
  /** ≤200 char overall verdict. */
  overallSummary: string;
  /** atSec of the lowest-scoring checkpoint (-1 when checkpoints is empty). */
  weakestCheckpoint: number;
}

/**
 * Build a 60s window centred on `atSec`, clamped to [0, totalSec].
 * Returns the concatenated transcript text inside the window for LLM
 * context. Pure — exported for testing.
 */
export function buildWindow(
  t: Transcript,
  atSec: number,
  totalSec: number,
  windowSec = 60,
): RetentionWindow {
  const half = windowSec / 2;
  const startSec = Math.max(0, atSec - half);
  const endSec = Math.min(totalSec, atSec + half);
  const parts: string[] = [];
  for (const seg of t.segments) {
    if (seg.end <= startSec || seg.start >= endSec) continue;
    const txt = seg.text.trim();
    if (txt) parts.push(txt);
  }
  return { atSec, startSec, endSec, text: parts.join(" ").trim() };
}

/**
 * Compact transcript outline — every Nth segment trimmed to ~60 chars
 * with a leading [t]s tag. Keeps the LLM grounded in overall pacing
 * without blowing the context budget on a long transcript.
 */
export function buildOutline(t: Transcript, maxLines = 40): string {
  const segs = t.segments.filter((s) => s.text.trim().length > 0);
  if (segs.length === 0) return "";
  const stride = Math.max(1, Math.floor(segs.length / maxLines));
  const lines: string[] = [];
  for (let i = 0; i < segs.length; i += stride) {
    const s = segs[i];
    const txt = s.text.trim().slice(0, 80);
    lines.push(`[${s.start.toFixed(1)}s] ${txt}`);
  }
  return lines.join("\n");
}

const SYSTEM = `You audit long-form videos for retention structure. Per MrBeast's documented manual, every ~3 minutes a "mini-hook" / re-engagement is required: a twist, reveal, escalation, visual spectacle, or stakes shift. Flat stretches without re-engagement bleed retention.

You receive:
  - The CHECKPOINT WINDOWS (one 60s block of transcript text per requested checkpoint).
  - An OUTLINE of the whole transcript for global context.

Output a JSON object with these EXACT keys:
{
  "checkpoints": [
    { "atSec": <number>, "score": <0..1>, "summary": "<≤120 char>", "suggestion": "<≤200 char or empty>" }
    ...one per input checkpoint, in input order...
  ],
  "escalationScore": <0..1>,
  "overallSummary":  "<≤200 char>"
}

Scoring rubric:

score (per checkpoint):
  1.0  = clear re-engagement — twist / reveal / shift in stakes / new visual element introduced.
  0.6  = something shifts but it's understated.
  0.3  = mostly flat — same energy as the surrounding minutes.
  0.0  = dead zone — no shift, no escalation, no surprise.

escalationScore (whole video):
  1.0 = each act bigger than the last (stakes, spectacle, payoff escalate).
  0.5 = some progression but inconsistent.
  0.0 = flat from start to finish (no build).

suggestion (only when score < 0.5):
  Concrete and short, e.g. "Insert a b-roll cutaway here" or "Add a stakes-raising line: 'but then…'" or
  "Punch in + sound effect on the reveal." Empty string when score ≥ 0.5.

Be honest — flat stretches must score low even when the content is competent. Sparse-but-real beats dense-but-fake.`;

export interface RetentionAuditOptions {
  apiKey?: string;
  model?: string;
  /** Default [180, 360] (3min, 6min). */
  checkpoints?: number[];
  /** Override transcript.durationSec (e.g. when you trust ffprobe more). */
  durationSec?: number;
  signal?: AbortSignal;
}

/**
 * Run ONE LLM audit pass and return the structured result. Throws on
 * network / parse error so the wrapper can convert to err().
 */
export async function runRetentionAudit(
  t: Transcript,
  opts: RetentionAuditOptions = {},
): Promise<RetentionAuditResult> {
  const apiKey = opts.apiKey ?? resolveApiKey("OPENAI_API_KEY", "openai");
  if (!apiKey) throw new Error("OPENAI_API_KEY required for audit_retention_structure.");
  const model = opts.model ?? "gpt-4o-mini";
  const totalSec = opts.durationSec ?? t.durationSec;
  const checkpoints = (opts.checkpoints ?? [180, 360]).filter((c) => c > 0 && c < totalSec);

  if (checkpoints.length === 0) {
    return {
      checkpoints: [],
      escalationScore: 0,
      overallSummary: "video too short for any requested checkpoint",
      weakestCheckpoint: -1,
    };
  }

  const windows = checkpoints.map((c) => buildWindow(t, c, totalSec));
  const outline = buildOutline(t);

  const userParts: string[] = [];
  userParts.push(`DURATION: ${totalSec.toFixed(1)}s`);
  userParts.push(`OUTLINE:\n${outline}`);
  for (const w of windows) {
    userParts.push(
      `CHECKPOINT @${w.atSec}s (window ${w.startSec.toFixed(1)}s\u2013${w.endSec.toFixed(1)}s):\n${w.text || "[no speech in window]"}`,
    );
  }

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
  if (!content) throw new Error("audit_retention_structure: empty model response");
  return parseAuditResponse(content, checkpoints);
}

/**
 * Parse the model's JSON. Robust to missing keys; pads checkpoints to
 * match the requested order so the caller can correlate by index.
 *
 * Pure — exported for testing.
 */
export function parseAuditResponse(content: string, requested: number[]): RetentionAuditResult {
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start < 0 || end < start) {
    throw new Error("audit_retention_structure: no JSON object in response");
  }
  const parsed = JSON.parse(content.slice(start, end + 1)) as Record<string, unknown>;
  const cpRaw = Array.isArray(parsed.checkpoints) ? parsed.checkpoints : [];

  const byAt = new Map<number, CheckpointScore>();
  for (const c of cpRaw) {
    if (typeof c !== "object" || c === null) continue;
    const r = c as Record<string, unknown>;
    const atSec = Number(r.atSec);
    if (!Number.isFinite(atSec)) continue;
    byAt.set(Math.round(atSec), {
      atSec: Math.round(atSec),
      score: clamp01(Number(r.score)),
      summary: String(r.summary ?? "").slice(0, 200),
      suggestion: String(r.suggestion ?? "").slice(0, 240),
    });
  }

  // Re-order to match the requested checkpoint list. If the LLM dropped
  // one, fill in a zero-score placeholder so the caller still gets N.
  const checkpoints: CheckpointScore[] = requested.map((at) => {
    const hit = byAt.get(at);
    if (hit) return { ...hit, atSec: at };
    return {
      atSec: at,
      score: 0,
      summary: "no response from model for this checkpoint",
      suggestion: "",
    };
  });

  const escalationScore = clamp01(Number(parsed.escalationScore));
  const overallSummary = String(parsed.overallSummary ?? "").slice(0, 240);

  let weakestCheckpoint = -1;
  let lowest = Infinity;
  for (const c of checkpoints) {
    if (c.score < lowest) {
      lowest = c.score;
      weakestCheckpoint = c.atSec;
    }
  }

  return { checkpoints, escalationScore, overallSummary, weakestCheckpoint };
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}
