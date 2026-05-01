import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, "..");

const long = readFileSync(resolve(pkgRoot, "src/skills/long-form-content-edit.md"), "utf8");
const short = readFileSync(resolve(pkgRoot, "src/skills/short-form-content-edit.md"), "utf8");
const chapters = readFileSync(resolve(pkgRoot, "src/skills/chapter-markers.md"), "utf8");
const keyframing = readFileSync(resolve(pkgRoot, "src/skills/keyframing-and-titles.md"), "utf8");
const skinTone = readFileSync(resolve(pkgRoot, "src/skills/skin-tone-matching.md"), "utf8");
const fusionLowerThird = readFileSync(
  resolve(pkgRoot, "src/skills/fusion-lower-third.md"),
  "utf8",
);

function esc(s) {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/`/g, "\\`")
    .replace(/\$\{/g, "\\${");
}

const out = [
  "/**",
  " * Bundled skill markdowns. Embedded as TS string constants so they ship in the",
  " * compiled package without depending on disk layout. Authored in",
  " * src/skills/*.md — regenerate this file by running `node build-skills.mjs`",
  " * from the package root if you edit the source markdowns.",
  " *",
  " * Skills are exposed through the read_skill tool; their descriptions live in",
  " * the system prompt. Pattern follows the Anthropic skills convention:",
  " * description in the prompt, full content on demand.",
  " */",
  "",
  "export interface BundledSkill {",
  "  name: string;",
  "  description: string;",
  "  content: string;",
  "}",
  "",
  "const LONG_FORM_CONTENT_EDIT = `" + esc(long) + "`;",
  "",
  "const SHORT_FORM_CONTENT_EDIT = `" + esc(short) + "`;",
  "",
  "const CHAPTER_MARKERS = `" + esc(chapters) + "`;",
  "",
  "const KEYFRAMING_AND_TITLES = `" + esc(keyframing) + "`;",
  "",
  "const SKIN_TONE_MATCHING = `" + esc(skinTone) + "`;",
  "",
  "const FUSION_LOWER_THIRD = `" + esc(fusionLowerThird) + "`;",
  "",

  "export const SKILLS: Record<string, BundledSkill> = {",
  '  "long-form-content-edit": {',
  '    name: "long-form-content-edit",',
  "    description:",
  '      "Recipe for podcasts, interviews, vlogs, courses, talking-head. Five-pass method: utterance segmentation → take detection → filler removal → incomplete-sentence trim → silence normalization. Wires our tools (transcribe, cluster_takes, detect_silence, write_edl, import_edl, write_srt, add_marker) into a single workflow.",',
  "    content: LONG_FORM_CONTENT_EDIT,",
  "  },",
  '  "short-form-content-edit": {',
  '    name: "short-form-content-edit",',
  "    description:",
  '      "Recipe for TikTok / Reels / Shorts. Find the moment → reformat 9:16 → hook the first 2 seconds → burn captions → render. Uses reformat_timeline, import_edl, set_clip_speed, write_srt, import_subtitles, open_page (Resolve).",',
  "    content: SHORT_FORM_CONTENT_EDIT,",
  "  },",
  '  "chapter-markers": {',
  '    name: "chapter-markers",',
  "    description:",
  '      "Recipe for YouTube/podcast chapter timestamps. Reads transcript in 90s windows, identifies topic shifts, drops purple markers, and emits a YouTube-formatted description block. Constraints: first chapter at 00:00, 5–15 chapters, ≥30s apart.",',
  "    content: CHAPTER_MARKERS,",
  "  },",
  '  "keyframing-and-titles": {',
  '    name: "keyframing-and-titles",',
  "    description:",
  '      "Recipes for the seven gaps neither Resolve nor Premiere expose via scripting: timeline reordering, multi-track / lane composition, lower-thirds and title cards (via ASS), keyframed opacity / position / volume ramps, audio mixing chains (EQ + comp + gate + de-esser + limiter), speed ramps, Ken-Burns on stills, and named transitions (smash-cut, whip-pan, dip-to-black). Wires reorder_timeline, compose_layered, write_lower_third, write_title_card, mix_audio, speed_ramp, ken_burns, transition_videos.",',
  "    content: KEYFRAMING_AND_TITLES,",
  "  },",
  '  "skin-tone-matching": {',
  '    name: "skin-tone-matching",',
  "    description:",
  '      "Recipe for matching faces across clips when host scripting can\'t reach power windows or qualifiers. Two paths: grade_skin_tones (file-only, every host \u2014 bakes a vision-derived colorbalance + selectivecolor + eq grade into a new mp4, pair with replace_clip) and match_clip_color (Resolve only \u2014 derives the same grade as a CDL and pipes it through set_primary_correction, non-baked). Both share one vision pass over a reference frame and a target frame; below confidence 0.4 the grade is unreliable.",',
  "    content: SKIN_TONE_MATCHING,",
  "  },",
  '  "fusion-lower-third": {',
  '    name: "fusion-lower-third",',
  "    description:",
  '      "Recipe for building a name/title chyron natively in DaVinci Resolve\'s Fusion page via fusion_comp. Walks the agent through Background + TextPlus + Merge node graph, wiring, text styling, lower-third positioning, and keyframed fade in/out via Merge.Blend. Resolve-only (Studio); for cross-host pixel-baked chyrons fall back to write_lower_third + burn_subtitles.",',
  "    content: FUSION_LOWER_THIRD,",
  "  },",
  "};",
  "",
  "export const SKILL_NAMES = Object.keys(SKILLS);",
  "",
].join("\n");

const target = resolve(pkgRoot, "src/skills.ts");
writeFileSync(target, out);
console.log("wrote", target, "\u2014", out.length, "bytes");
