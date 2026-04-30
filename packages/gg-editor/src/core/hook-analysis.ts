/**
 * Hook analysis — does the first 3 seconds of a video earn the
 * scroll-stop?
 *
 * Platform algorithms (TikTok / Reels / Shorts / YouTube) treat the
 * first 2-3 seconds as the algorithmic checkpoint. Videos with strong
 * 3-second retention get pushed to larger audiences; videos that lose
 * viewers immediately get buried. This module bundles the four checks
 * every retention guide preaches:
 *
 *   1. Speech in the first 0.5s   — silent openings = scroll death.
 *   2. On-screen text             — sound-off mobile is the default.
 *   3. Visual motion              — static openers fail (sample two frames).
 *   4. Clear subject (face/etc.)  — abstract intro cards underperform.
 *
 * #1 is a silencedetect probe (deterministic, free).
 * #2-#4 are folded into ONE vision call against an early-frame sample.
 *
 * Returns a structured score plus a short list of issues the agent can
 * surface verbatim. The agent's job is to drop a red marker if the
 * score is below a threshold and propose a stronger opener.
 */

import { readFileSync } from "node:fs";

export interface HookAnalysisFinding {
  /** Stable id for this issue. */
  id:
    | "silent_open"
    | "no_on_screen_text"
    | "static_first_frame"
    | "no_clear_subject"
    | "weak_emotional_hook";
  severity: "info" | "warn" | "block";
  /** One-line human description. */
  message: string;
}

export interface HookAnalysisResult {
  /** 0-100. ≥70 = solid hook, 40-69 = weak, <40 = will tank retention. */
  score: number;
  /** True if score >= passThreshold (default 70). */
  passes: boolean;
  /** Sub-scores (0-1). */
  speechAt0_5s: number;
  onScreenText: number;
  motion: number;
  subjectClarity: number;
  emotionalIntensity: number;
  findings: HookAnalysisFinding[];
  /** ≤120 char overall verdict from the vision pass. */
  why: string;
}

// ── Silence-side helpers ────────────────────────────────────

/**
 * Compute the speech-at-0.5s score from a list of silence ranges
 * within the first `windowSec` seconds.
 *
 * 1.0  = speech is active throughout the first 500ms.
 * 0.0  = totally silent for the entire first 500ms.
 * Linear in between. Used both by the live tool and the unit tests.
 */
export function speechAt0_5sScore(
  silences: Array<{ startSec: number; endSec: number }>,
  windowSec = 0.5,
): number {
  if (windowSec <= 0) return 1;
  let silentSec = 0;
  for (const s of silences) {
    const lo = Math.max(0, s.startSec);
    const hi = Math.min(windowSec, s.endSec);
    if (hi > lo) silentSec += hi - lo;
  }
  const speechSec = Math.max(0, windowSec - silentSec);
  return +(speechSec / windowSec).toFixed(3);
}

// ── Vision-side: prompt + parser ────────────────────────────

const VISION_SYSTEM = `You are a short-form video retention analyst. You see ONE frame from the FIRST SECOND of a video and ONE frame from the THIRD SECOND. Your job is to score the OPENING for scroll-stop power on TikTok / Reels / YouTube Shorts.

Output a JSON object with these EXACT keys (no extras, no prose):
{
  "onScreenText":       <0..1>,
  "motion":             <0..1>,
  "subjectClarity":     <0..1>,
  "emotionalIntensity": <0..1>,
  "why": "<≤120 char rationale>"
}

Scoring rubric:

onScreenText  — Is there bold, readable on-screen text in either frame?
  1.0 = large hook text (e.g. "DON'T DO THIS"); 0.5 = small caption only;
  0.0 = no text at all.

motion        — Did the framing change between frame 1 and frame 2?
  1.0 = camera move / cut to a new angle / clear visual change;
  0.5 = subject moved within the frame; 0.0 = static lockoff.

subjectClarity — Is there an obvious focal point (face, product, action)?
  1.0 = clear single subject filling significant frame area;
  0.5 = subject present but small or off-centre; 0.0 = abstract / cluttered.

emotionalIntensity — Does anyone in frame display a strong emotion or
  is something visually surprising happening?
  1.0 = laughing / shouting / pointing / fail moment / dramatic action;
  0.5 = neutral but engaged; 0.0 = blank / corporate / boring.

Be honest — this rubric exists so the creator knows when to recut their
opener. A bland but technically competent intro should score 0.3, not 0.7.`;

export interface HookVisionResponse {
  onScreenText: number;
  motion: number;
  subjectClarity: number;
  emotionalIntensity: number;
  why: string;
}

export function parseHookVisionResponse(content: string): HookVisionResponse {
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start < 0 || end < start) {
    throw new Error("hook-analysis: no JSON object in response");
  }
  const parsed = JSON.parse(content.slice(start, end + 1));
  return {
    onScreenText: clamp01(num(parsed.onScreenText, 0)),
    motion: clamp01(num(parsed.motion, 0)),
    subjectClarity: clamp01(num(parsed.subjectClarity, 0)),
    emotionalIntensity: clamp01(num(parsed.emotionalIntensity, 0)),
    why: String(parsed.why ?? "").slice(0, 200),
  };
}

export interface HookVisionOptions {
  apiKey?: string;
  model?: string;
  detail?: "low" | "high";
  signal?: AbortSignal;
}

export async function runHookVision(
  earlyFramePath: string,
  laterFramePath: string,
  opts: HookVisionOptions = {},
): Promise<HookVisionResponse> {
  const apiKey = opts.apiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY required for analyze_hook.");

  const earlyB64 = readFileSync(earlyFramePath).toString("base64");
  const laterB64 = readFileSync(laterFramePath).toString("base64");
  const detail = opts.detail ?? "low";
  const model = opts.model ?? "gpt-4o-mini";

  const body = {
    model,
    messages: [
      { role: "system", content: VISION_SYSTEM },
      {
        role: "user",
        content: [
          { type: "text", text: "FRAME 1 (~0.5s into video):" },
          {
            type: "image_url",
            image_url: { url: `data:image/jpeg;base64,${earlyB64}`, detail },
          },
          { type: "text", text: "FRAME 2 (~2.5s into video):" },
          {
            type: "image_url",
            image_url: { url: `data:image/jpeg;base64,${laterB64}`, detail },
          },
        ],
      },
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
  if (!content) throw new Error("analyze_hook: empty model response");
  return parseHookVisionResponse(content);
}

// ── Score combiner ──────────────────────────────────────────

export interface ScoreOptions {
  /** Pass threshold (default 70). */
  passThreshold?: number;
  /** Component weights (sum doesn't have to equal 1). */
  weights?: {
    speech?: number;
    onScreenText?: number;
    motion?: number;
    subjectClarity?: number;
    emotionalIntensity?: number;
  };
}

const DEFAULT_WEIGHTS = {
  speech: 25,
  onScreenText: 25,
  motion: 15,
  subjectClarity: 20,
  emotionalIntensity: 15,
};

/**
 * Combine the deterministic speech score and the vision response into
 * an overall HookAnalysisResult. Pure function — easy to unit-test the
 * scoring rubric without booting ffmpeg or OpenAI.
 */
export function buildHookResult(
  speech: number,
  vision: HookVisionResponse,
  opts: ScoreOptions = {},
): HookAnalysisResult {
  const w = { ...DEFAULT_WEIGHTS, ...(opts.weights ?? {}) };
  const wSum = w.speech + w.onScreenText + w.motion + w.subjectClarity + w.emotionalIntensity;
  const raw =
    w.speech * speech +
    w.onScreenText * vision.onScreenText +
    w.motion * vision.motion +
    w.subjectClarity * vision.subjectClarity +
    w.emotionalIntensity * vision.emotionalIntensity;
  const score = Math.round((raw / wSum) * 100);

  const findings: HookAnalysisFinding[] = [];
  if (speech < 0.5) {
    findings.push({
      id: "silent_open",
      severity: speech < 0.2 ? "block" : "warn",
      message:
        "Silent (or near-silent) opening detected. Move the punchline / strongest line to frame 1; cold-open instead of leading with breath/pause.",
    });
  }
  if (vision.onScreenText < 0.4) {
    findings.push({
      id: "no_on_screen_text",
      severity: "warn",
      message:
        "No bold on-screen hook text. ~60% of mobile views are sound-off — burn the hook line large in the first 2 seconds.",
    });
  }
  if (vision.motion < 0.3) {
    findings.push({
      id: "static_first_frame",
      severity: "warn",
      message:
        "First frames look static. Add a quick zoom, cut to a different angle, or open mid-action to give the eye something to lock onto.",
    });
  }
  if (vision.subjectClarity < 0.4) {
    findings.push({
      id: "no_clear_subject",
      severity: "warn",
      message:
        "No clear focal subject. Re-frame so the face / product / action fills the frame in the first second.",
    });
  }
  if (vision.emotionalIntensity < 0.3) {
    findings.push({
      id: "weak_emotional_hook",
      severity: "info",
      message:
        "Low emotional intensity in the opener. Consider starting with a reaction / surprise / dramatic line — neutral intros lose retention.",
    });
  }

  const passThreshold = opts.passThreshold ?? 70;
  return {
    score,
    passes: score >= passThreshold,
    speechAt0_5s: speech,
    onScreenText: vision.onScreenText,
    motion: vision.motion,
    subjectClarity: vision.subjectClarity,
    emotionalIntensity: vision.emotionalIntensity,
    findings,
    why: vision.why,
  };
}

// ── Helpers ─────────────────────────────────────────────────

function num(v: unknown, fb: number): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fb;
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}
