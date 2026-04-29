import { readFileSync } from "node:fs";

/**
 * Vision shot scoring via OpenAI's chat completions API.
 *
 * Self-contained on purpose — gg-ai is for streaming agent loops; this is a
 * one-shot batch call. Keeps the dependency surface small and lets us tune
 * the structured-output prompt independently.
 *
 * Why OpenAI: gpt-4o-mini is cost-effective (~$0.15/1M tokens) and follows
 * strict JSON output reliably. Anthropic vision is comparable and could be
 * added as an alternate backend later.
 */

export interface FrameToScore {
  /** Path to a JPEG/PNG file on disk. */
  path: string;
  /** Time in seconds where this frame was sampled. */
  atSec: number;
}

export interface ShotScore {
  atSec: number;
  /** 0-10. Higher = better composition / focus / subject clarity. */
  score: number;
  /** One-line reason. ≤ 80 chars. */
  why: string;
}

export interface ScoreOptions {
  apiKey?: string;
  model?: string;
  /** "low" = ~85 tokens/image (cheap), "high" = ~700 tokens/image (more accurate). */
  detail?: "low" | "high";
  /** Override the system prompt used to instruct the scorer. */
  systemPrompt?: string;
  signal?: AbortSignal;
}

/**
 * Default scoring rubric. Compact, structured, gives the model a clear
 * grading scale and forbids chatty output.
 */
const DEFAULT_SYSTEM = `You are a video shot grader. For each frame, output a JSON object with:
- score: 0-10 (composition + focus + subject clarity + visual energy combined)
- why: ONE short reason (≤80 chars), specific (e.g. "subject centered, sharp eyes" not "looks good")

Return ONLY a JSON array, one entry per frame in order. No prose.

Grading scale:
  9-10: hero frame — sharp, well-composed, strong subject, eye-catching
  6-8:  usable — focused, clear subject, decent composition
  4-5:  weak — soft focus, awkward framing, or low energy
  0-3:  unusable — blurry, subject obscured, mid-blink, mid-word`;

const MAX_FRAMES_PER_REQUEST = 20;

/**
 * Score a batch of frames. Splits into requests of ≤20 frames each (OpenAI
 * vision practical limit). Returns ShotScore[] in the same order as input.
 */
export async function scoreFrames(
  frames: FrameToScore[],
  opts: ScoreOptions = {},
): Promise<ShotScore[]> {
  const apiKey = opts.apiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY required for vision scoring.");
  if (frames.length === 0) return [];

  const model = opts.model ?? "gpt-4o-mini";
  const detail = opts.detail ?? "low";
  const system = opts.systemPrompt ?? DEFAULT_SYSTEM;

  const results: ShotScore[] = [];
  for (let i = 0; i < frames.length; i += MAX_FRAMES_PER_REQUEST) {
    const batch = frames.slice(i, i + MAX_FRAMES_PER_REQUEST);
    const batchResults = await scoreBatch(batch, {
      apiKey,
      model,
      detail,
      system,
      signal: opts.signal,
    });
    results.push(...batchResults);
  }
  return results;
}

// ── Internal ────────────────────────────────────────────────

interface BatchOpts {
  apiKey: string;
  model: string;
  detail: "low" | "high";
  system: string;
  signal?: AbortSignal;
}

async function scoreBatch(frames: FrameToScore[], opts: BatchOpts): Promise<ShotScore[]> {
  const userContent: Array<
    | { type: "text"; text: string }
    | { type: "image_url"; image_url: { url: string; detail: "low" | "high" } }
  > = [
    {
      type: "text",
      text:
        `Score these ${frames.length} frames in order. Return a JSON array of ` +
        `${frames.length} entries, each {score, why}. Frame timestamps for context: ` +
        frames.map((f, i) => `[${i}]=${f.atSec.toFixed(2)}s`).join(", "),
    },
  ];

  for (const f of frames) {
    const mime = f.path.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg";
    const b64 = readFileSync(f.path).toString("base64");
    userContent.push({
      type: "image_url",
      image_url: { url: `data:${mime};base64,${b64}`, detail: opts.detail },
    });
  }

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${opts.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: opts.model,
      messages: [
        { role: "system", content: opts.system },
        { role: "user", content: userContent },
      ],
      // Force JSON output. Some smaller models follow this strictly; 4o-mini does.
      response_format: { type: "json_object" },
      max_tokens: 2000,
    }),
    signal: opts.signal,
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`OpenAI vision HTTP ${res.status}: ${errText.slice(0, 300)}`);
  }

  const body = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = body.choices?.[0]?.message?.content ?? "";
  const parsed = parseScoreResponse(content, frames.length);
  return frames.map((f, i) => ({
    atSec: f.atSec,
    score: clampScore(parsed[i]?.score),
    why: clampWhy(parsed[i]?.why),
  }));
}

/**
 * Parse the model's JSON response. Robust to:
 *   - Array-of-objects: `[{score, why}, ...]`
 *   - Object-wrapped:   `{"shots": [...]}` or `{"results": [...]}`
 *   - Stray prose around the JSON (extracts first array)
 */
export function parseScoreResponse(
  content: string,
  expected: number,
): Array<{ score?: unknown; why?: unknown }> {
  // Try direct parse first.
  let arr: unknown;
  try {
    const obj: unknown = JSON.parse(content);
    arr = Array.isArray(obj) ? obj : extractArray(obj);
  } catch {
    // Fall back: regex-extract the first JSON array in the text.
    const m = content.match(/\[[\s\S]*\]/);
    if (m) {
      try {
        arr = JSON.parse(m[0]);
      } catch {
        arr = [];
      }
    } else {
      arr = [];
    }
  }
  if (!Array.isArray(arr)) arr = [];
  // Pad / truncate to expected length so callers always get N entries.
  const out = arr as Array<{ score?: unknown; why?: unknown }>;
  while (out.length < expected) out.push({});
  return out.slice(0, expected);
}

function extractArray(obj: unknown): unknown[] {
  if (typeof obj !== "object" || obj === null) return [];
  for (const v of Object.values(obj as Record<string, unknown>)) {
    if (Array.isArray(v)) return v;
  }
  return [];
}

/** Clamp a score value to the 0-10 grading scale. Exposed for testing. */
export function clampScore(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(10, Math.round(n * 10) / 10));
}

/** Truncate the rationale to 80 chars; non-strings collapse to "". Exposed for testing. */
export function clampWhy(v: unknown): string {
  const s = typeof v === "string" ? v : "";
  return s.slice(0, 80);
}
