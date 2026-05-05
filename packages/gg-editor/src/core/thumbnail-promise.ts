/**
 * Thumbnail-promise verifier.
 *
 * The thumbnail makes a visual promise (a man underwater, a huge pile
 * of money, a broken phone). Per the MrBeast manual: "match the
 * clickbait expectations and front-load." If the promised element
 * doesn't show up until minute 8, retention craters before the payoff.
 *
 * This module asks the vision model to:
 *   1. Look at the thumbnail FIRST and identify the visual promise.
 *   2. Look at N sampled frames from the opening window.
 *   3. Score how well those frames deliver on (or build up to) the
 *      promise.
 *
 * One LLM call, structured JSON out. Pure parser exported for tests.
 */

import { readFileSync } from "node:fs";
import { resolveApiKey } from "./auth/api-keys.js";

export interface ThumbnailPromiseResult {
  /** 0..1 — how well the opening delivers on the thumbnail's visual promise. */
  matches: number;
  /** ≤200 char description of what the thumbnail is promising. */
  thumbnailPromise: string;
  /** ≤200 char description of what the opening frames actually show. */
  openingShows: string;
  /** Up to 4 specific elements promised by the thumbnail but missing from the opening. */
  missing: string[];
  /** ≤200 char actionable suggestion. */
  suggestion: string;
}

const SYSTEM = `You verify that a YouTube thumbnail's visual promise is delivered in the OPENING N seconds of the video.

Process:
  1. Look at the THUMBNAIL FIRST. What concrete visual element is it promising? (e.g. "man underwater", "huge pile of money", "broken phone screen", "1000 mousetraps".) The promise is what would make a scroller click.
  2. Then look at the N sampled OPENING FRAMES (in order). They were sampled across the first windowSec seconds of the video.
  3. Decide: does the promised element appear in the opening? Is it CLEARLY building toward the promise? Or is the opening a logo slate / unrelated b-roll?

Output JSON with these EXACT keys:
{
  "matches":          <0..1>,
  "thumbnailPromise": "<≤200 char>",
  "openingShows":     "<≤200 char>",
  "missing":          [<≤80 char>, ...],   // 0-4 entries; promised elements absent in opening
  "suggestion":       "<≤200 char>"
}

Scoring rubric:
  1.0 = promised element is on-screen within the opening window.
  0.7 = element is clearly being built up to (visible in last sampled frame, or directly referenced).
  0.4 = related but indirect — a tease without the payoff.
  0.0 = no connection. Logo slate, unrelated b-roll, or completely different content.

Be honest. A thumbnail that promises X but shows X at minute 8 must score low even if the eventual payoff is good — retention is decided in seconds.`;

export interface VerifyOptions {
  apiKey?: string;
  model?: string;
  detail?: "low" | "high";
  /** Window length used to sample frames; surfaced in the prompt for context. */
  windowSec: number;
  signal?: AbortSignal;
}

/**
 * Run ONE vision call against the thumbnail + N opening frames.
 */
export async function runThumbnailPromise(
  thumbnailPath: string,
  framePaths: string[],
  opts: VerifyOptions,
): Promise<ThumbnailPromiseResult> {
  const apiKey = opts.apiKey ?? resolveApiKey("OPENAI_API_KEY", "openai");
  if (!apiKey) throw new Error("OPENAI_API_KEY required for verify_thumbnail_promise.");
  const model = opts.model ?? "gpt-4o-mini";
  const detail = opts.detail ?? "low";

  const thumbB64 = readFileSync(thumbnailPath).toString("base64");
  const thumbMime = thumbnailPath.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg";

  const userContent: Array<
    | { type: "text"; text: string }
    | { type: "image_url"; image_url: { url: string; detail: "low" | "high" } }
  > = [
    { type: "text", text: "THUMBNAIL:" },
    {
      type: "image_url",
      image_url: { url: `data:${thumbMime};base64,${thumbB64}`, detail },
    },
    {
      type: "text",
      text: `OPENING FRAMES (${framePaths.length} samples across the first ${opts.windowSec}s):`,
    },
  ];

  for (let i = 0; i < framePaths.length; i++) {
    const p = framePaths[i];
    const mime = p.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg";
    const b64 = readFileSync(p).toString("base64");
    userContent.push({ type: "text", text: `FRAME ${i + 1}/${framePaths.length}:` });
    userContent.push({
      type: "image_url",
      image_url: { url: `data:${mime};base64,${b64}`, detail },
    });
  }

  const body = {
    model,
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: userContent },
    ],
    response_format: { type: "json_object" },
    max_tokens: 2000,
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
  if (!content) throw new Error("verify_thumbnail_promise: empty model response");
  return parsePromiseResponse(content);
}

/**
 * Parse the model's JSON. Robust to missing keys; clamps `matches` to
 * [0, 1] and caps strings. Pure — exported for testing.
 */
export function parsePromiseResponse(content: string): ThumbnailPromiseResult {
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start < 0 || end < start) {
    throw new Error("verify_thumbnail_promise: no JSON object in response");
  }
  const parsed = JSON.parse(content.slice(start, end + 1)) as Record<string, unknown>;
  const missing = Array.isArray(parsed.missing)
    ? (parsed.missing as unknown[])
        .map((v) => String(v ?? "").slice(0, 100))
        .filter((v) => v.length > 0)
        .slice(0, 4)
    : [];
  return {
    matches: clamp01(Number(parsed.matches)),
    thumbnailPromise: String(parsed.thumbnailPromise ?? "").slice(0, 240),
    openingShows: String(parsed.openingShows ?? "").slice(0, 240),
    missing,
    suggestion: String(parsed.suggestion ?? "").slice(0, 240),
  };
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}
