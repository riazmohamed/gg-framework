/**
 * Hook rewriter.
 *
 * Given a current hook + topic + (optional) transcript context + a target
 * pattern from the `viral-hook-patterns` skill, produce 3 candidate
 * rewrites. ONE LLM call. The agent surfaces candidates to the user;
 * we never auto-apply (we don't generate footage).
 *
 * The 12 patterns below are the compact form of the skill — name +
 * one-line structure each. Plenty for the LLM; not enough to bloat the
 * prompt.
 */

import { resolveApiKey } from "./auth/api-keys.js";

export const HOOK_PATTERNS = [
  "click-to-unpause",
  "shock-intrigue-satisfy",
  "foreshadow-ending",
  "but-so-escalation",
  "power-word",
  "crazy-progression",
  "match-thumbnail",
  "i-asked-google",
  "credibility-plus-n",
  "cliffhanger",
  "first-frame-thumbnail",
  "auto",
] as const;

export type HookPattern = (typeof HOOK_PATTERNS)[number];

const PATTERN_LIBRARY = `Pattern library (12 viral hook patterns):

1. click-to-unpause       — open with the most arresting visual moment, then "rewind" verbally. ("This is the moment X — but to understand it, we need to start an hour earlier.")
2. shock-intrigue-satisfy — line 1 shocks; line 2 reframes; line 3 promises payoff. ("I found a $1 phone. It actually works. Here's what's wrong with it.")
3. foreshadow-ending      — open by referencing the climax. ("In 8 minutes I'll be holding $10,000 cash — but first…")
4. but-so-escalation      — string two reversals: "I tried X. But Y went wrong. So I doubled down."
5. power-word             — lead with one ALL-CAPS power word. ("ILLEGAL. This is illegal in 14 states.")
6. crazy-progression      — escalate scale across the line. ("First 1, then 10, then 100, then 1,000.")
7. match-thumbnail        — the hook restates the thumbnail's promise verbally in the first 3s.
8. i-asked-google         — frame as a research question. ("I asked Google, what's the rarest…")
9. credibility-plus-n     — credential + specific number. ("As a 12-year sommelier, I tried 47 wines.")
10. cliffhanger            — open mid-action with a missing answer. ("I can't believe what just happened.")
11. first-frame-thumbnail  — describe the literal first visual frame as if reading the thumbnail aloud.
12. auto                   — no constraint; pick the closest-fit pattern based on topic.

Each pattern is a STRUCTURE, not a script. Adapt to the topic — never reuse a verbatim example from this list.`;

const SYSTEM = `You rewrite YouTube / Shorts / Reels / TikTok hooks. You receive:
  - A CURRENT HOOK (may be empty when none exists yet).
  - The VIDEO TOPIC (one line).
  - Optionally a 200-500 char EXCERPT from the transcript for tone.
  - A target PATTERN from the library below.

${PATTERN_LIBRARY}

Output JSON with these EXACT keys:
{
  "candidates":     [
    { "line": "<≤140 char rewritten hook>", "pattern": "<pattern name>", "why": "<≤120 char rationale>" },
    ...exactly 3 entries...
  ],
  "chosenPattern": "<the pattern actually used (matches the requested one unless 'auto' was passed)>",
  "why":           "<≤200 char overall rationale>"
}

Rules:
- Exactly 3 candidates.
- Each candidate ≤140 chars.
- All 3 candidates use the SAME pattern (consistency for A/B testing).
- Vary the candidates: different specifics, different power words, different opens. Don't paraphrase the same line three times.
- When the requested pattern is "auto", pick the closest-fit pattern from the library and stamp it into "chosenPattern".
- Honest tone — no clickbait that the video can't deliver.`;

export interface HookCandidate {
  line: string;
  pattern: string;
  why: string;
}

export interface HookRewriteResult {
  candidates: HookCandidate[];
  chosenPattern: string;
  why: string;
}

export interface RewriteOptions {
  apiKey?: string;
  model?: string;
  signal?: AbortSignal;
}

export interface RewriteInput {
  currentHook: string;
  videoTopic: string;
  transcriptExcerpt?: string;
  pattern: HookPattern;
}

/**
 * Run ONE LLM call. Throws on parse / network error so the wrapper
 * converts to err().
 */
export async function runHookRewrite(
  input: RewriteInput,
  opts: RewriteOptions = {},
): Promise<HookRewriteResult> {
  const apiKey = opts.apiKey ?? resolveApiKey("OPENAI_API_KEY", "openai");
  if (!apiKey) throw new Error("OPENAI_API_KEY required for rewrite_hook.");
  const model = opts.model ?? "gpt-4o-mini";

  const userParts: string[] = [];
  userParts.push(`PATTERN: ${input.pattern}`);
  userParts.push(`VIDEO TOPIC: ${input.videoTopic}`);
  userParts.push(`CURRENT HOOK: ${input.currentHook || "[none — write a fresh one]"}`);
  if (input.transcriptExcerpt) {
    userParts.push(`TRANSCRIPT EXCERPT (for tone):\n${input.transcriptExcerpt.slice(0, 600)}`);
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
  if (!content) throw new Error("rewrite_hook: empty model response");
  return parseRewriteResponse(content, input.pattern);
}

/**
 * Parse the model's JSON. Robust to missing keys; pads to exactly 3
 * candidates so the caller always has a stable shape.
 *
 * Pure — exported for testing.
 */
export function parseRewriteResponse(
  content: string,
  requestedPattern: HookPattern,
): HookRewriteResult {
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start < 0 || end < start) {
    throw new Error("rewrite_hook: no JSON object in response");
  }
  const parsed = JSON.parse(content.slice(start, end + 1)) as Record<string, unknown>;
  const candRaw = Array.isArray(parsed.candidates) ? parsed.candidates : [];
  const candidates: HookCandidate[] = [];
  for (const c of candRaw) {
    if (typeof c !== "object" || c === null) continue;
    const r = c as Record<string, unknown>;
    const line = String(r.line ?? "").trim();
    if (!line) continue;
    candidates.push({
      line: line.slice(0, 200),
      pattern: String(r.pattern ?? requestedPattern).slice(0, 60),
      why: String(r.why ?? "").slice(0, 200),
    });
    if (candidates.length === 3) break;
  }
  // Pad to 3 by duplicating the first usable candidate.
  while (candidates.length > 0 && candidates.length < 3) {
    candidates.push({ ...candidates[0] });
  }

  const chosenPattern = String(parsed.chosenPattern ?? requestedPattern).slice(0, 60);
  const why = String(parsed.why ?? "").slice(0, 240);
  return { candidates, chosenPattern, why };
}
