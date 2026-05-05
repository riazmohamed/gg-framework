/**
 * Bundled sound-effect library.
 *
 * gg-editor's `add_sfx_at_cuts` needs a WAV/MP3 file per hit. Without this
 * module the agent had to either ask the user to supply one or invent a path
 * — both broke the canonical retention pipeline. Now the agent calls
 * `add_sfx_at_cuts(sfx="whoosh", …)` with a bundled name and the resolver
 * either returns a cached WAV or synthesises one via ffmpeg into
 * `~/.gg/sfx-cache/<name>.wav` (~50 ms one-time per name; cached forever).
 *
 * Why synthesised, not shipped: no third-party files = no IP risk + no npm
 * weight. Every recipe is a pure ffmpeg-lavfi expression so the output is
 * deterministic and reproducible. Quality is "creator-vlog acceptable" —
 * not Skywalker Sound, but indistinguishable from typical CapCut presets in
 * a sub-1-second cut.
 *
 * Design rules for recipes:
 *   - Stereo (`-ac 2`) — every consumer mixes into stereo audio.
 *   - 200–500 ms long. Anything longer fights the next cut.
 *   - Peak ≤ -3 dBFS (the recipes all keep amplitude ≤ 0.7) so
 *     `add_sfx_at_cuts`'s default -8 dB gain leaves headroom for voice.
 *   - Linear fade in (≥5 ms) + fade out — no clicks at the envelope edges.
 */

import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve as resolvePath } from "node:path";
import { runFfmpeg } from "./media/ffmpeg.js";

export interface SfxRecipe {
  /** One-line creator description shown in the system prompt + tool description. */
  description: string;
  /**
   * ffmpeg args producing the WAV. The cached output path is appended at
   * synthesis time; recipes should NOT include it themselves.
   */
  args: string[];
}

/**
 * The bundled set. Keep this list short and creator-relevant —
 * 8–10 names covers the entire short-form vocabulary.
 */
export const BUNDLED_SFX: Record<string, SfxRecipe> = {
  pop: {
    description: "Short upward blip — punctuates a cut without dominating",
    args: [
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=880:duration=0.08",
      "-af",
      "afade=t=in:d=0.005,afade=t=out:d=0.05:st=0.03,volume=0.5",
      "-ac",
      "2",
    ],
  },
  click: {
    description: "Very short tick — for fast-cut emphasis where pop would be too musical",
    args: [
      "-f",
      "lavfi",
      "-i",
      "anoisesrc=color=white:duration=0.03:amplitude=0.6",
      "-af",
      "bandpass=frequency=4000:width_type=h:w=3000,afade=t=in:d=0.002,afade=t=out:d=0.025:st=0.005,volume=2",
      "-ac",
      "2",
    ],
  },
  whoosh: {
    description: "Downward frequency sweep — classic vlog cut effect",
    args: [
      "-f",
      "lavfi",
      // Linear sweep 3000 Hz → ~200 Hz over 0.3 s (phase = 2π·(f₀·t + ½·k·t²))
      "-i",
      "aevalsrc='0.4*sin(2*PI*(3000*t-4667*t*t))':d=0.3",
      "-af",
      "afade=t=in:d=0.05,afade=t=out:d=0.1:st=0.2",
      "-ac",
      "2",
    ],
  },
  "whoosh-up": {
    description: "Upward frequency sweep — for reveals / 'lift' moments",
    args: [
      "-f",
      "lavfi",
      // Sweep 200 Hz → ~3000 Hz over 0.3 s
      "-i",
      "aevalsrc='0.4*sin(2*PI*(200*t+4667*t*t))':d=0.3",
      "-af",
      "afade=t=in:d=0.05,afade=t=out:d=0.1:st=0.2",
      "-ac",
      "2",
    ],
  },
  swoosh: {
    description: "Filtered noise sweep — softer/airier than whoosh, good for transitions",
    args: [
      "-f",
      "lavfi",
      "-i",
      "anoisesrc=color=brown:duration=0.4:amplitude=0.5",
      "-af",
      "bandpass=frequency=1500:width_type=h:w=2500,afade=t=in:d=0.05,afade=t=out:d=0.15:st=0.25,volume=2.5",
      "-ac",
      "2",
    ],
  },
  riser: {
    description: "600 ms sine sweep up — builds tension before a reveal",
    args: [
      "-f",
      "lavfi",
      // Sweep 200 → ~2200 Hz over 0.6 s with rising amplitude
      "-i",
      "aevalsrc='(0.2+0.4*t)*sin(2*PI*(200*t+1667*t*t))':d=0.6",
      "-af",
      "afade=t=in:d=0.1,afade=t=out:d=0.05:st=0.55",
      "-ac",
      "2",
    ],
  },
  "bass-drop": {
    description: "Sub bass with downward sweep — for big-reveal cuts (use sparingly)",
    args: [
      "-f",
      "lavfi",
      // Sweep 120 Hz → ~40 Hz over 0.45 s
      "-i",
      "aevalsrc='0.6*sin(2*PI*(120*t-89*t*t))':d=0.45",
      "-af",
      "afade=t=in:d=0.02,afade=t=out:d=0.15:st=0.3",
      "-ac",
      "2",
    ],
  },
  ding: {
    description: "Soft bell — for highlighting an on-screen item / list bullet",
    args: [
      "-f",
      "lavfi",
      "-i",
      // Two-harmonic bell: fundamental + perfect fifth, exponential decay
      "aevalsrc='exp(-4*t)*(0.5*sin(2*PI*1318*t)+0.25*sin(2*PI*1976*t))':d=0.5",
      "-af",
      "afade=t=in:d=0.005",
      "-ac",
      "2",
    ],
  },
  thump: {
    description: "Low percussive hit — landing impact, soft punch",
    args: [
      "-f",
      "lavfi",
      "-i",
      // Damped sine ~80 Hz with fast decay
      "aevalsrc='exp(-12*t)*0.7*sin(2*PI*80*t)':d=0.25",
      "-af",
      "afade=t=in:d=0.005",
      "-ac",
      "2",
    ],
  },
};

/** Names of every bundled SFX (sorted for stable display). */
export function listBundledSfxNames(): string[] {
  return Object.keys(BUNDLED_SFX).sort();
}

/** A short markdown-style list of bundled SFX for tool descriptions / system prompts. */
export function bundledSfxDescriptionList(): string {
  return listBundledSfxNames()
    .map((n) => `${n} (${BUNDLED_SFX[n].description})`)
    .join(", ");
}

/** Cache dir for synthesised WAVs. Stable across sessions, gitignored by convention. */
export function getSfxCacheDir(): string {
  return resolvePath(homedir(), ".gg", "sfx-cache");
}

/**
 * Resolve an SFX argument:
 *
 *   - Bundled name (e.g. `"whoosh"`) → cache hit at `~/.gg/sfx-cache/whoosh.wav`,
 *     synthesising via ffmpeg on first request.
 *   - File-like string (contains `/`, `\`, `.`, `~`) → resolve against `cwd`
 *     and return as-is. The caller still has to verify the file exists.
 *
 * Throws when the name is neither bundled nor file-like.
 */
export async function resolveSfx(
  nameOrPath: string,
  cwd: string,
  signal?: AbortSignal,
): Promise<{ path: string; bundled: boolean; name?: string }> {
  // Bundled names are bare alphanumeric+hyphen tokens with no path / extension.
  // Any string with `/`, `\`, `.`, or `~` is a file path.
  const looksLikePath = /[/\\.~]/.test(nameOrPath);
  if (!looksLikePath) {
    const recipe = BUNDLED_SFX[nameOrPath];
    if (!recipe) {
      throw new Error(
        `unknown SFX name: '${nameOrPath}'. Bundled: ${listBundledSfxNames().join(", ")}`,
      );
    }
    const path = await ensureBundledSfx(nameOrPath, signal);
    return { path, bundled: true, name: nameOrPath };
  }
  // Treat as a file path.
  return { path: resolvePath(cwd, nameOrPath), bundled: false };
}

/**
 * Ensure a bundled SFX is present on disk, synthesising it via ffmpeg if not.
 * Returns the absolute cache path.
 */
export async function ensureBundledSfx(name: string, signal?: AbortSignal): Promise<string> {
  const recipe = BUNDLED_SFX[name];
  if (!recipe) {
    throw new Error(`unknown bundled SFX: '${name}'`);
  }
  const dir = getSfxCacheDir();
  mkdirSync(dir, { recursive: true });
  const out = join(dir, `${name}.wav`);
  if (existsSync(out)) return out;

  const ffArgs = [...recipe.args, out];
  const r = await runFfmpeg(ffArgs, { signal });
  if (r.code !== 0) {
    const tail = r.stderr.split("\n").filter(Boolean).slice(-3).join(" | ").slice(-300);
    throw new Error(`ffmpeg failed synthesising '${name}' SFX: ${tail}`);
  }
  return out;
}
