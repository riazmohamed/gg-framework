/**
 * Brand-kit loader.
 *
 * A "brand kit" is a small JSON file at `<cwd>/.gg/brand.json` that holds the
 * channel-level constants every render-time tool wants: logo, intro/outro/
 * watermark video paths, default fonts, colour palette, channel name, CTA
 * text. The loader is opt-in — if the file isn't present, every consumer
 * falls back to its existing defaults.
 *
 * Why JSON, not YAML: zero new deps; brand kits are short enough that the
 * JSON line noise doesn't hurt readability.
 *
 * Why separate from styles (`<cwd>/.gg/editor-styles/*.md`): styles modulate
 * the LLM's behaviour (its writing voice, tone, defaults). The brand kit
 * modulates raw render output (which logo to overlay, which font to draw
 * with). They serve different layers and we keep them separate so a user
 * can change one without touching the other.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";

export interface BrandKitFonts {
  /** Display font for headlines / titles. */
  heading?: string;
  /** Body font for captions / lower-thirds. */
  body?: string;
}

export interface BrandKitColors {
  /** Hex (RRGGBB, no leading #). */
  primary?: string;
  secondary?: string;
  accent?: string;
}

export interface BrandKit {
  /** Channel display name; surfaced in outros, lower-thirds, end-screens. */
  channelName?: string;
  /** Path (relative to cwd) to a logo PNG with alpha — used by overlay_watermark and generate_outro. */
  logo?: string;
  /** Default watermark path (logo, but a more polished pre-positioned variant if you have one). */
  watermark?: string;
  /** Pre-rendered intro video. concat_videos uses this. */
  intro?: string;
  /** Pre-rendered outro video. concat_videos / generate_outro use this. */
  outro?: string;
  /** Per-font-role family (or path to .ttf for ffmpeg drawtext). */
  fonts?: BrandKitFonts;
  /** Brand palette (hex without leading #). */
  colors?: BrandKitColors;
  /** Default CTA text — used by generate_outro and overlay banners. */
  ctaText?: string;
  /** Default subscribe handle / URL surfaced in description templates. */
  subscribeUrl?: string;
}

/** Path of the brand-kit file relative to cwd. Stable so docs can quote it. */
export const BRAND_KIT_PATH = ".gg/brand.json";

/**
 * Load `<cwd>/.gg/brand.json` if present. Returns `null` when the file is
 * missing OR malformed — callers should treat absence as "no brand kit
 * configured" and fall back to their normal defaults. Malformed JSON also
 * returns null (we don't want a syntax slip in a config file to break a
 * render); the agent surfaces the issue separately via `validateBrandKit`.
 */
export function loadBrandKit(cwd: string): BrandKit | null {
  const path = resolvePath(cwd, BRAND_KIT_PATH);
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    return parsed as BrandKit;
  } catch {
    return null;
  }
}

export interface BrandKitValidation {
  ok: boolean;
  /** Empty when ok=true. */
  errors: string[];
  /** Warnings don't block; they surface "you set logo but the file doesn't exist" cases. */
  warnings: string[];
}

/**
 * Validate a brand kit. Returns structured findings the agent can surface.
 * Doesn't throw — caller decides whether to gate.
 *
 * Strict checks (errors):
 *   - any path field that isn't a string
 *   - any color that isn't 6-hex chars
 *
 * Soft checks (warnings):
 *   - referenced files that don't exist on disk
 */
export function validateBrandKit(
  kit: BrandKit,
  cwd: string,
  fileExists?: (absPath: string) => boolean,
): BrandKitValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const exists = fileExists ?? ((p: string) => existsSync(p));

  const pathFields: Array<keyof BrandKit> = ["logo", "watermark", "intro", "outro"];
  for (const f of pathFields) {
    const v = kit[f];
    if (v === undefined) continue;
    if (typeof v !== "string" || v.trim().length === 0) {
      errors.push(`${f}: must be a non-empty string`);
      continue;
    }
    const abs = resolvePath(cwd, v);
    if (!exists(abs)) warnings.push(`${f}: file not found at ${abs}`);
  }

  if (kit.colors) {
    for (const [k, v] of Object.entries(kit.colors)) {
      if (v !== undefined && !/^[0-9a-fA-F]{6}$/.test(v)) {
        errors.push(`colors.${k}: '${v}' is not 6-char hex (RRGGBB, no #)`);
      }
    }
  }

  if (kit.fonts) {
    for (const [k, v] of Object.entries(kit.fonts)) {
      if (v !== undefined && typeof v !== "string") {
        errors.push(`fonts.${k}: must be a string (font name or path to .ttf)`);
      }
    }
  }

  if (kit.channelName !== undefined && typeof kit.channelName !== "string") {
    errors.push("channelName: must be a string");
  }

  return { ok: errors.length === 0, errors, warnings };
}
