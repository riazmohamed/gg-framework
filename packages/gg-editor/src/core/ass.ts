/**
 * ASS (Advanced SubStation Alpha) writer.
 *
 * SRT only has text + timing. ASS supports:
 *   - Font name + size
 *   - Primary / outline / shadow color (hex BGRA)
 *   - Position (canvas-relative — needed for vertical-format burned captions)
 *   - Bold / italic / underline / strikeout
 *   - Margins
 *
 * For TikTok / Reels / Shorts burned-in captions, this is the format you want.
 * ffmpeg's `subtitles` filter renders ASS directly into a video stream:
 *   ffmpeg -i in.mp4 -vf "subtitles=captions.ass" -c:a copy out.mp4
 *
 * Resolve also imports ASS as a subtitle track and lets the user style it
 * further on the timeline.
 *
 * Time format is "H:MM:SS.cc" (centiseconds), NOT "HH:MM:SS,mmm" like SRT.
 */

export interface AssCue {
  /** Start in seconds. */
  start: number;
  /** End in seconds. */
  end: number;
  /** Text. Newlines become \\N in ASS. */
  text: string;
  /** Optional override style name (must exist in `styles`). Default "Default". */
  style?: string;
}

export interface AssStyle {
  /** Style name; referenced by AssCue.style. "Default" is required. */
  name: string;
  fontName?: string;
  fontSize?: number;
  /** Primary color in hex RRGGBB or RRGGBBAA (alpha first byte in ASS). */
  primaryColor?: string;
  /** Outline color in hex RRGGBB or RRGGBBAA. */
  outlineColor?: string;
  /** Shadow color in hex RRGGBB or RRGGBBAA. */
  shadowColor?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  /** 1-9 numpad layout. 2=bottom-center (default), 5=center, 8=top-center. */
  alignment?: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
  /** Outline thickness. Default 2. Critical for legibility on busy backgrounds. */
  outline?: number;
  /** Shadow distance. Default 0. */
  shadow?: number;
  /** Bottom margin in pixels (alignment 1-3) / top margin (7-9). Default 60. */
  marginV?: number;
  marginL?: number;
  marginR?: number;
}

export interface AssOptions {
  title?: string;
  /** Canvas resolution. Default 1920x1080. For vertical burn use 1080x1920. */
  playResX?: number;
  playResY?: number;
  styles: AssStyle[];
  cues: AssCue[];
}

/**
 * Build an ASS file. The `styles` array MUST include one named "Default".
 * Cues without an explicit `style` field reference "Default".
 */
export function buildAss(opts: AssOptions): string {
  const playX = opts.playResX ?? 1920;
  const playY = opts.playResY ?? 1080;
  const styles = opts.styles;
  if (!styles.find((s) => s.name === "Default")) {
    throw new Error("buildAss: styles must include one named 'Default'");
  }
  const styleNames = new Set(styles.map((s) => s.name));

  const lines: string[] = [];
  lines.push("[Script Info]");
  lines.push(`Title: ${(opts.title ?? "GG Editor").replace(/[\r\n]+/g, " ")}`);
  lines.push("ScriptType: v4.00+");
  lines.push("WrapStyle: 0");
  lines.push("ScaledBorderAndShadow: yes");
  lines.push(`PlayResX: ${playX}`);
  lines.push(`PlayResY: ${playY}`);
  lines.push("");

  lines.push("[V4+ Styles]");
  lines.push(
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
  );
  for (const s of styles) lines.push(formatStyle(s));
  lines.push("");

  lines.push("[Events]");
  lines.push("Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text");
  for (const cue of opts.cues) {
    if (cue.end <= cue.start) {
      throw new Error(`ASS cue: end (${cue.end}) must be > start (${cue.start})`);
    }
    const text = (cue.text ?? "").trim();
    if (!text) continue;
    const style = cue.style ?? "Default";
    if (!styleNames.has(style)) {
      throw new Error(`ASS cue references unknown style: ${style}`);
    }
    lines.push(
      `Dialogue: 0,${formatAssTime(cue.start)},${formatAssTime(cue.end)},${style},,0,0,0,,${escapeText(text)}`,
    );
  }
  return lines.join("\n") + "\n";
}

/** Format seconds as "H:MM:SS.cc" — ASS uses centiseconds, not ms. */
export function formatAssTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const totalCs = Math.round(sec * 100);
  const cs = totalCs % 100;
  const totalSec = Math.floor(totalCs / 100);
  const ss = totalSec % 60;
  const mm = Math.floor(totalSec / 60) % 60;
  const hh = Math.floor(totalSec / 3600);
  return `${hh}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

function formatStyle(s: AssStyle): string {
  return [
    "Style:",
    [
      s.name,
      s.fontName ?? "Arial",
      s.fontSize ?? 72,
      assColor(s.primaryColor ?? "FFFFFF"),
      assColor("FFFFFF"), // secondary
      assColor(s.outlineColor ?? "000000"),
      assColor(s.shadowColor ?? "000000"),
      s.bold ? -1 : 0,
      s.italic ? -1 : 0,
      s.underline ? -1 : 0,
      0, // strikeout
      100, // scaleX
      100, // scaleY
      0, // spacing
      0, // angle
      1, // borderStyle 1=outline+shadow
      s.outline ?? 2,
      s.shadow ?? 0,
      s.alignment ?? 2,
      s.marginL ?? 20,
      s.marginR ?? 20,
      s.marginV ?? 60,
      1, // encoding
    ].join(","),
  ].join(" ");
}

/**
 * Convert hex RRGGBB or RRGGBBAA into ASS &HAABBGGRR& format.
 * ASS uses BGR byte order with the alpha BYTE FIRST (00 = opaque).
 */
export function assColor(hex: string): string {
  const clean = hex.replace(/^#/, "").trim();
  if (!/^[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(clean)) {
    throw new Error(`bad color: ${hex} (expected RRGGBB or RRGGBBAA)`);
  }
  const r = clean.slice(0, 2);
  const g = clean.slice(2, 4);
  const b = clean.slice(4, 6);
  // ASS alpha: 00 = opaque, FF = transparent. Convention is OPPOSITE of CSS.
  // We accept CSS-style alpha (FF=opaque) and invert for the user.
  const cssAlpha = clean.slice(6, 8);
  const a = cssAlpha ? (255 - parseInt(cssAlpha, 16)).toString(16).padStart(2, "0") : "00";
  return `&H${a}${b}${g}${r}&`.toUpperCase();
}

function escapeText(s: string): string {
  // Real newlines → ASS hard linebreak; commas inside text are fine on the
  // last column. Strip CR.
  return s.replace(/\r\n?|\n/g, "\\N");
}
