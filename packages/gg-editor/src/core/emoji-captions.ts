/**
 * Emoji-injection pass for keyword captions.
 *
 * Submagic / CapCut have made the "💯 caption + 🔥 emoji" look the
 * default vibe of viral short-form. Rather than ship a static emoji
 * map, we ask the LLM (one call over ALL cues) for the single
 * most-fitting emoji per cue (or empty when nothing clearly fits).
 *
 * Pure-ish: takes the OpenAI-style chat client as a dependency so the
 * caller can swap in `fetch` directly OR mock it in tests.
 */
import type { AssCue } from "./ass.js";
import { resolveApiKey } from "./auth/api-keys.js";

export type EmojiDensity = "low" | "med" | "high";

export interface InjectEmojisOptions {
  density?: EmojiDensity;
  model?: string;
  apiKey?: string;
  signal?: AbortSignal;
  /** Override fetch — for tests. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

export interface InjectEmojisResult {
  cues: AssCue[];
  /** Count of cues that received an emoji (excluding empty strings). */
  injected: number;
  /** When set, the LLM call failed and cues were returned unchanged. */
  error?: string;
}

const SYSTEM = `You are an emoji selector for short-form video captions. For each caption line, return the SINGLE most-fitting emoji or an empty string when nothing clearly fits.

Rules:
- Output JSON: {"emojis": [string, ...]} aligned 1-to-1 with the input order. Length MUST equal the input length.
- Each entry is a single emoji character (e.g. "🔥") or "". No multi-emoji entries, no text.
- Don't force emojis where they'd feel random — empty string is the right answer ~half the time.
- Match the density target the user specifies.`;

const DENSITY_TARGETS: Record<EmojiDensity, string> = {
  low: "Roughly 1 in 4 cues should get an emoji. Be very selective — only when an emoji genuinely amplifies the line.",
  med: "Roughly 1 in 2 cues should get an emoji. Pick the obvious wins; leave neutral lines empty.",
  high: "Every cue should get an emoji where ANY emoji fits. Empty only for purely connective lines.",
};

/**
 * Inject emojis into a list of cues via one LLM call. On failure
 * (network down, malformed response, length mismatch) we return the
 * cues UNCHANGED + populate `error` so the caller can surface it.
 *
 * For density="high" the emoji is rendered on its own line ABOVE the
 * caption text (separated by ASS's `\\N` break) for the stacked CapCut
 * look. For low/med it's appended inline.
 */
export async function injectEmojis(
  cues: AssCue[],
  opts: InjectEmojisOptions = {},
): Promise<InjectEmojisResult> {
  if (cues.length === 0) return { cues, injected: 0 };

  const density = opts.density ?? "med";
  const model = opts.model ?? "gpt-4o-mini";
  const apiKey = opts.apiKey ?? resolveApiKey("OPENAI_API_KEY", "openai");
  if (!apiKey) {
    return { cues, injected: 0, error: "OPENAI_API_KEY not set" };
  }

  const numbered = cues.map((c, i) => `${i + 1}. ${c.text}`).join("\n");
  const userText =
    `Density target: ${DENSITY_TARGETS[density]}\n\n` +
    `Return exactly ${cues.length} entries.\n\n` +
    `CAPTIONS:\n${numbered}`;

  const fetchImpl = opts.fetchImpl ?? fetch;
  let emojis: string[];
  try {
    const res = await fetchImpl("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: userText },
        ],
        response_format: { type: "json_object" },
        temperature: 0,
      }),
      signal: opts.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return {
        cues,
        injected: 0,
        error: `OpenAI HTTP ${res.status}: ${text.slice(0, 160)}`,
      };
    }
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content ?? "";
    emojis = parseEmojiResponse(content, cues.length);
  } catch (e) {
    return { cues, injected: 0, error: (e as Error).message };
  }

  if (emojis.length !== cues.length) {
    return { cues, injected: 0, error: "emoji count mismatch" };
  }

  let injected = 0;
  const out = cues.map((c, i) => {
    const e = (emojis[i] ?? "").trim();
    if (!e) return c;
    injected++;
    const text = density === "high" ? `${e}\\N${c.text}` : `${c.text} ${e}`;
    return { ...c, text };
  });
  return { cues: out, injected };
}

/**
 * Tolerant parser. Accepts either {emojis: [...]} or a bare array, pads
 * / truncates to `expected` length so length always lines up. Exported
 * for testing.
 */
export function parseEmojiResponse(content: string, expected: number): string[] {
  let arr: unknown;
  try {
    const obj: unknown = JSON.parse(content);
    if (Array.isArray(obj)) arr = obj;
    else if (typeof obj === "object" && obj !== null) {
      const v = (obj as { emojis?: unknown }).emojis;
      arr = Array.isArray(v) ? v : [];
    } else arr = [];
  } catch {
    const m = content.match(/\[[\s\S]*\]/);
    if (m) {
      try {
        arr = JSON.parse(m[0]);
      } catch {
        arr = [];
      }
    } else arr = [];
  }
  const list = Array.isArray(arr) ? arr.map((v) => (typeof v === "string" ? v : "")) : [];
  while (list.length < expected) list.push("");
  return list.slice(0, expected);
}
