/**
 * Aspect-ratio reformat presets for short-form / vertical / square exports.
 *
 * Used by the `reformat_timeline` tool to derive the FCPXML format spec
 * (width × height) for a new timeline. The tool then emits an FCPXML that
 * imports as a fresh timeline at the target aspect; the user's NLE handles
 * the actual reframing (Resolve Smart Reframe, Premiere Auto Reframe).
 *
 * The chosen base resolutions are the platform-canonical defaults:
 *   - 9:16  → 1080×1920 (TikTok / Reels / Shorts)
 *   - 1:1   → 1080×1080 (Instagram feed)
 *   - 4:5   → 1080×1350 (Instagram portrait feed)
 *   - 16:9  → 1920×1080 (long-form horizontal)
 *   - 4:3   → 1440×1080 (legacy / old-school cuts)
 */

export type ReformatPreset = "9:16" | "1:1" | "4:5" | "16:9" | "4:3";

export interface ReformatSpec {
  preset: ReformatPreset;
  width: number;
  height: number;
  /** Suggested label for use in clip / sequence names. */
  label: string;
}

const PRESETS: Record<ReformatPreset, ReformatSpec> = {
  "9:16": { preset: "9:16", width: 1080, height: 1920, label: "Vertical 9:16" },
  "1:1": { preset: "1:1", width: 1080, height: 1080, label: "Square 1:1" },
  "4:5": { preset: "4:5", width: 1080, height: 1350, label: "Portrait 4:5" },
  "16:9": { preset: "16:9", width: 1920, height: 1080, label: "Horizontal 16:9" },
  "4:3": { preset: "4:3", width: 1440, height: 1080, label: "Classic 4:3" },
};

export function reformatSpec(preset: ReformatPreset): ReformatSpec {
  const spec = PRESETS[preset];
  if (!spec) {
    throw new Error(
      `unknown reformat preset: ${preset}; valid: ${Object.keys(PRESETS).join(", ")}`,
    );
  }
  return spec;
}

export const REFORMAT_PRESETS = Object.keys(PRESETS) as ReformatPreset[];
