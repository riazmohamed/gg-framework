/**
 * Skin-tone matching grade derivation.
 *
 * Resolve's scripting API can only do CDL/LUT/copy-grade. The biggest gap for
 * creators is *skin-tone matching across clips* — making a face look the same
 * warmth, exposure, and saturation as a reference shot. Power windows,
 * qualifiers, and curves aren't scriptable.
 *
 * This module asks GPT-4o to compare two frames and emit a structured grade
 * tuned for skin tones (warmth in reds + yellows). The grade ships in two
 * complementary representations:
 *
 *   1. ffmpeg filter chain — `colorbalance` + `selectivecolor` + `eq`. Used
 *      by `grade_skin_tones` to bake a graded file (works on every host).
 *   2. CDL approximation — slope/offset/power/saturation. Used by
 *      `match_clip_color` to pipe through `set_primary_correction` (Resolve
 *      only, non-baked).
 *
 * Only one vision call covers both paths.
 */
import { readFileSync } from "node:fs";
import { resolveApiKey } from "./auth/api-keys.js";
import { runFfmpeg } from "./media/ffmpeg.js";

export interface SkinGradeColorBalance {
  shadows: [number, number, number];
  midtones: [number, number, number];
  highlights: [number, number, number];
}

export interface SkinGradeSelectiveColor {
  reds: [number, number, number, number];
  yellows: [number, number, number, number];
}

export interface SkinGradeEq {
  saturation: number;
  contrast: number;
  brightness: number;
}

export interface SkinGradeCdl {
  slope: [number, number, number];
  offset: [number, number, number];
  power: [number, number, number];
  saturation: number;
}

export interface SkinGrade {
  colorbalance: SkinGradeColorBalance;
  selectivecolor: SkinGradeSelectiveColor;
  eq: SkinGradeEq;
  cdl: SkinGradeCdl;
  /** Confidence 0-1; below 0.4 means "I'm guessing" — don't apply blindly. */
  confidence: number;
  /** ≤120 char rationale. */
  why: string;
}

export interface SkinGradeOptions {
  apiKey?: string;
  model?: string;
  detail?: "low" | "high";
  signal?: AbortSignal;
}

const SYSTEM = `You match the SKIN TONE LOOK of a target frame to a reference frame.

Skin tones live primarily in the REDS and YELLOWS of the image. Your job is
to bring the target's faces toward the reference's faces — warmth (R/Y
balance), exposure (luma), and saturation. Don't grade the whole image
into a different look; grade the skin.

Output a JSON object with these EXACT keys (no extras, no prose):
{
  "colorbalance": {
    "shadows":    [r, g, b],
    "midtones":   [r, g, b],
    "highlights": [r, g, b]
  },
  "selectivecolor": {
    "reds":    [c, m, y, k],
    "yellows": [c, m, y, k]
  },
  "eq": {
    "saturation": <number>,
    "contrast":   <number>,
    "brightness": <number>
  },
  "cdl": {
    "slope":      [r, g, b],
    "offset":     [r, g, b],
    "power":      [r, g, b],
    "saturation": <number>
  },
  "confidence": <0..1>,
  "why": "<≤120 char rationale>"
}

Neutral (no change) values:
  colorbalance.shadows / midtones / highlights = [0, 0, 0]
  selectivecolor.reds / yellows                = [0, 0, 0, 0]
  eq.saturation = 1, eq.contrast = 1, eq.brightness = 0
  cdl.slope = [1,1,1], cdl.offset = [0,0,0], cdl.power = [1,1,1], cdl.saturation = 1

Conventions:
  - colorbalance components: ±0.3 typical, ±0.5 max. Positive R warms, positive B cools.
  - selectivecolor components: ±0.3 typical. Positive C/M/Y/K shifts the reds/yellows toward that primary.
  - eq.saturation 0.5..1.5 typical. eq.contrast 0.8..1.2 typical. eq.brightness ±0.1 typical.
  - cdl is the SAME correction expressed as slope/offset/power so a host that only takes CDL can apply it.

Stay subtle. If the two frames look indistinguishable, return neutral values + low confidence. The CDL must approximate the same look — don't let the two paths drift.`;

export async function deriveSkinGrade(
  referenceFramePath: string,
  targetFramePath: string,
  opts: SkinGradeOptions = {},
): Promise<SkinGrade> {
  const apiKey = opts.apiKey ?? resolveApiKey("OPENAI_API_KEY", "openai");
  if (!apiKey) throw new Error("OPENAI_API_KEY required for skin-tone matching.");

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
          { type: "text", text: "REFERENCE (skin look you want):" },
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
  if (!content) throw new Error("skin-grade: empty model response");
  return parseSkinGradeResponse(content);
}

/**
 * Parse a model JSON response into a SkinGrade with all values clamped to
 * safe ranges. Tolerates missing fields (falls back to neutral) and prose
 * wrapping around the JSON.
 */
export function parseSkinGradeResponse(content: string): SkinGrade {
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start < 0 || end < start) {
    throw new Error("skin-grade: no JSON object in response");
  }
  const parsed = JSON.parse(content.slice(start, end + 1));

  const cb = (parsed.colorbalance ?? {}) as Record<string, unknown>;
  const sc = (parsed.selectivecolor ?? {}) as Record<string, unknown>;
  const eq = (parsed.eq ?? {}) as Record<string, unknown>;
  const cdl = (parsed.cdl ?? {}) as Record<string, unknown>;

  const triple3 = (v: unknown, fb: [number, number, number], lo: number, hi: number) =>
    clampTriple(toTriple(v, fb), lo, hi);

  const quad4 = (
    v: unknown,
    fb: [number, number, number, number],
    lo: number,
    hi: number,
  ): [number, number, number, number] => clampQuad(toQuad(v, fb), lo, hi);

  return {
    colorbalance: {
      shadows: triple3(cb.shadows, [0, 0, 0], -0.5, 0.5),
      midtones: triple3(cb.midtones, [0, 0, 0], -0.5, 0.5),
      highlights: triple3(cb.highlights, [0, 0, 0], -0.5, 0.5),
    },
    selectivecolor: {
      reds: quad4(sc.reds, [0, 0, 0, 0], -1, 1),
      yellows: quad4(sc.yellows, [0, 0, 0, 0], -1, 1),
    },
    eq: {
      saturation: clamp(num(eq.saturation, 1), 0, 3),
      contrast: clamp(num(eq.contrast, 1), 0, 3),
      brightness: clamp(num(eq.brightness, 0), -0.3, 0.3),
    },
    cdl: {
      slope: triple3(cdl.slope, [1, 1, 1], 0.5, 2),
      offset: triple3(cdl.offset, [0, 0, 0], -0.3, 0.3),
      power: triple3(cdl.power, [1, 1, 1], 0.5, 2),
      saturation: clamp(num(cdl.saturation, 1), 0, 3),
    },
    confidence: clamp(num(parsed.confidence, 0), 0, 1),
    why: String(parsed.why ?? "").slice(0, 200),
  };
}

const NEUTRAL_CB: SkinGradeColorBalance = {
  shadows: [0, 0, 0],
  midtones: [0, 0, 0],
  highlights: [0, 0, 0],
};

const NEUTRAL_SC: SkinGradeSelectiveColor = {
  reds: [0, 0, 0, 0],
  yellows: [0, 0, 0, 0],
};

const NEUTRAL_EQ: SkinGradeEq = {
  saturation: 1,
  contrast: 1,
  brightness: 0,
};

/**
 * Build the ffmpeg `-vf` filter string for a SkinGrade. Returns an empty
 * string when the grade is effectively neutral (no-op pass-through).
 */
export function buildSkinGradeFilter(grade: SkinGrade): string {
  const parts: string[] = [];

  if (!eqDeep(grade.colorbalance, NEUTRAL_CB)) {
    parts.push(buildColorBalance(grade.colorbalance));
  }
  if (!eqDeep(grade.selectivecolor, NEUTRAL_SC)) {
    parts.push(buildSelectiveColor(grade.selectivecolor));
  }
  if (!eqDeep(grade.eq, NEUTRAL_EQ)) {
    parts.push(buildEq(grade.eq));
  }
  return parts.join(",");
}

function buildColorBalance(cb: SkinGradeColorBalance): string {
  const [rs, gs, bs] = cb.shadows;
  const [rm, gm, bm] = cb.midtones;
  const [rh, gh, bh] = cb.highlights;
  return (
    "colorbalance=" +
    `rs=${fmt(rs)}:gs=${fmt(gs)}:bs=${fmt(bs)}:` +
    `rm=${fmt(rm)}:gm=${fmt(gm)}:bm=${fmt(bm)}:` +
    `rh=${fmt(rh)}:gh=${fmt(gh)}:bh=${fmt(bh)}`
  );
}

function buildSelectiveColor(sc: SkinGradeSelectiveColor): string {
  const r = sc.reds.map(fmt).join(" ");
  const y = sc.yellows.map(fmt).join(" ");
  return `selectivecolor=reds=${r}:yellows=${y}`;
}

function buildEq(eq: SkinGradeEq): string {
  return `eq=saturation=${fmt(eq.saturation)}:contrast=${fmt(eq.contrast)}:brightness=${fmt(eq.brightness)}`;
}

export interface ApplySkinGradeOptions {
  videoCodec?: string;
  crf?: number;
  signal?: AbortSignal;
}

/**
 * Spawn ffmpeg to render `inputPath` through a SkinGrade filter chain into
 * `outputPath`. Audio is copied. Returns the absolute output path.
 *
 * If the grade is effectively neutral, ffmpeg still re-encodes (since the
 * caller asked for an output file) but with no `-vf` filter.
 */
export async function applySkinGrade(
  inputPath: string,
  outputPath: string,
  grade: SkinGrade,
  opts: ApplySkinGradeOptions = {},
): Promise<string> {
  const filter = buildSkinGradeFilter(grade);
  const codec = opts.videoCodec ?? "libx264";
  const crf = String(opts.crf ?? 18);
  const args = ["-i", inputPath];
  if (filter) args.push("-vf", filter);
  args.push("-c:v", codec, "-crf", crf, "-c:a", "copy", outputPath);
  const r = await runFfmpeg(args, { signal: opts.signal });
  if (r.code !== 0) {
    throw new Error(`ffmpeg skin-grade failed: ${tail(r.stderr)}`);
  }
  return outputPath;
}

function fmt(n: number): string {
  // Trim trailing zeros, but keep at least one digit after the decimal so
  // ffmpeg parses it as a float consistently.
  if (!Number.isFinite(n)) return "0";
  const rounded = Math.round(n * 10000) / 10000;
  return String(rounded);
}

function toTriple(v: unknown, fb: [number, number, number]): [number, number, number] {
  if (Array.isArray(v) && v.length === 3) {
    return [num(v[0], fb[0]), num(v[1], fb[1]), num(v[2], fb[2])];
  }
  return fb;
}

function toQuad(
  v: unknown,
  fb: [number, number, number, number],
): [number, number, number, number] {
  if (Array.isArray(v) && v.length === 4) {
    return [num(v[0], fb[0]), num(v[1], fb[1]), num(v[2], fb[2]), num(v[3], fb[3])];
  }
  return fb;
}

function clampTriple(
  v: [number, number, number],
  lo: number,
  hi: number,
): [number, number, number] {
  return [clamp(v[0], lo, hi), clamp(v[1], lo, hi), clamp(v[2], lo, hi)];
}

function clampQuad(
  v: [number, number, number, number],
  lo: number,
  hi: number,
): [number, number, number, number] {
  return [clamp(v[0], lo, hi), clamp(v[1], lo, hi), clamp(v[2], lo, hi), clamp(v[3], lo, hi)];
}

function num(v: unknown, fb: number): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fb;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function eqDeep(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function tail(s: string): string {
  return s.split("\n").filter(Boolean).slice(-3).join(" | ").slice(-300);
}
