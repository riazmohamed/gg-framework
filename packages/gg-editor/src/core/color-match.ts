/**
 * Vision-derived CDL: ask GPT-4o to compare a reference frame to a target
 * frame and emit slope/offset/power/saturation deltas to bring the target
 * toward the reference.
 *
 * NOT a substitute for ColorChecker-based matching — that's deterministic.
 * This is a "look match" useful when shots are similar but feel off (white
 * balance drift, exposure mismatch, slightly different skin tones).
 *
 * Returns CDL values centred around neutral (slope/power=1, offset=0, sat=1)
 * so the agent can feed them straight into set_primary_correction.
 */
import { readFileSync } from "node:fs";

export interface CdlValues {
  slope: [number, number, number];
  offset: [number, number, number];
  power: [number, number, number];
  saturation: number;
  /** Confidence 0-1; below 0.4 means "I'm guessing". */
  confidence: number;
  /** One-line rationale (≤120 chars). */
  why: string;
}

export interface ColorMatchOptions {
  apiKey?: string;
  model?: string;
  detail?: "low" | "high";
  signal?: AbortSignal;
}

const SYSTEM = `You match the COLOR LOOK of a target frame to a reference frame.

Output a JSON object with these EXACT keys (no extras, no prose):
{
  "slope":  [r, g, b],
  "offset": [r, g, b],
  "power":  [r, g, b],
  "saturation": <number>,
  "confidence": <0..1>,
  "why": "<≤120 char rationale>"
}

Neutral (no change) values:
  slope = [1, 1, 1]
  offset = [0, 0, 0]
  power = [1, 1, 1]
  saturation = 1

Conventions:
  - slope is gain per channel (multiplier). 1.05 = 5% brighter on that channel.
  - offset is a small additive lift, ±0.1 typical, ±0.3 max.
  - power is gamma per channel. >1 darkens midtones.
  - saturation: 0.5..1.5 typical range.

Stay subtle. The CDL will be applied additively to whatever grade is already on the target — don't try to do everything in one node. If the two frames look indistinguishable, return neutral values + low confidence.`;

export async function deriveColorMatch(
  referenceFramePath: string,
  targetFramePath: string,
  opts: ColorMatchOptions = {},
): Promise<CdlValues> {
  const apiKey = opts.apiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY required for color_match.");

  const refB64 = readFileSync(referenceFramePath).toString("base64");
  const tgtB64 = readFileSync(targetFramePath).toString("base64");
  const detail = opts.detail ?? "low";
  const model = opts.model ?? "gpt-4o-mini";

  const body = {
    model,
    messages: [
      { role: "system", content: SYSTEM },
      {
        role: "user",
        content: [
          { type: "text", text: "REFERENCE (the look you want):" },
          {
            type: "image_url",
            image_url: { url: `data:image/jpeg;base64,${refB64}`, detail },
          },
          { type: "text", text: "TARGET (needs to match the reference):" },
          {
            type: "image_url",
            image_url: { url: `data:image/jpeg;base64,${tgtB64}`, detail },
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
  const data = (await res.json()) as {
    choices: Array<{ message: { content: string } }>;
  };
  const content = data.choices[0]?.message?.content;
  if (!content) throw new Error("color_match: empty model response");
  return parseColorMatchResponse(content);
}

export function parseColorMatchResponse(content: string): CdlValues {
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start < 0 || end < start) {
    throw new Error("color_match: no JSON object in response");
  }
  const parsed = JSON.parse(content.slice(start, end + 1));
  return {
    slope: triple(parsed.slope, [1, 1, 1]),
    offset: triple(parsed.offset, [0, 0, 0]),
    power: triple(parsed.power, [1, 1, 1]),
    saturation: clamp(num(parsed.saturation, 1), 0, 4),
    confidence: clamp(num(parsed.confidence, 0), 0, 1),
    why: String(parsed.why ?? "").slice(0, 200),
  };
}

function triple(v: unknown, fallback: [number, number, number]): [number, number, number] {
  if (Array.isArray(v) && v.length === 3) {
    return [num(v[0], fallback[0]), num(v[1], fallback[1]), num(v[2], fallback[2])];
  }
  return fallback;
}

function num(v: unknown, fallback: number): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
