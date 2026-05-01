/**
 * FCPXML 1.10 emitter.
 *
 * FCPXML preserves what EDL drops:
 *   - Per-clip names (not just reel comments)
 *   - Frame-rational time (no rounding loss for 23.976/29.97/59.94)
 *   - Multi-source media in one timeline
 *   - Color/audio metadata can be added later as extensions
 *
 * Premiere Pro imports FCPXML natively as a Sequence. DaVinci Resolve
 * imports it as a Timeline. Both treat it as the "richer" interchange
 * compared to EDL, which is why we expose write_fcpxml as the preferred
 * format for Premiere and an alternative for Resolve.
 *
 * v2 scope:
 *   - One or more source assets (each unique `reel` becomes an asset)
 *   - Multi-track / multi-lane composition (lane="N" on asset-clip)
 *   - <adjust-transform> with static OR keyframed position/scale/rotation/anchor
 *   - <param name="opacity"> + <keyframeAnimation> for fade ramps
 *   - <filter-audio name="Volume"> + <param name="gain"> + <keyframe> for
 *     audio gain ramps
 *   - <title> elements (Basic Title effect ref) with <text-style-def>
 *   - Integer or rational frame rates (24, 25, 29.97, 30, 50, 59.94, 60)
 *
 * Real-world references:
 *   - mifi/lossless-cut FCPXML 1.9 fixtures: <adjust-transform position scale anchor>
 *   - mazsola2k/ai-video-editor: <filter-audio>/<keyframe> for volume ramps
 *   - hysmichael/srt_fcpxml_converter: <title>/<text-style-def> shape
 *   - subtitleedit FinalCutProXmlGap.cs: lane= on title
 *   - eoyilmaz/anima conformer: emitter shape verified
 */

// ── Public types ────────────────────────────────────────────

/** Single keyframe at a clip-relative frame. */
export interface Keyframe<T> {
  /** Time within the clip, in frames (0-based, frame 0 = start of clip). */
  frame: number;
  value: T;
  /**
   * Interpolation between this keyframe and the next. Per FCPXML spec,
   * position keyframes ignore curve/interp attributes — the emitter omits
   * them automatically for position. "linear" is the most portable choice.
   */
  interp?: "linear" | "easeIn" | "easeOut" | "smooth";
}

/** Animated value driven by 2+ keyframes. Single-frame = static. */
export interface KeyframedValue<T> {
  keyframes: Keyframe<T>[];
}

/** Static or animated transform on a clip. */
export interface TransformSpec {
  /** [x, y] in FCPXML normalized units. (0,0) = centred. Animatable. */
  position?: [number, number] | KeyframedValue<[number, number]>;
  /** [sx, sy] uniform-or-anisotropic scale. 1 = native. Animatable. */
  scale?: [number, number] | KeyframedValue<[number, number]>;
  /** [ax, ay] anchor point. Static only (FCPXML doesn't keyframe anchor). */
  anchor?: [number, number];
  /** Rotation in degrees. Animatable. */
  rotation?: number | KeyframedValue<number>;
}

export interface FcpxmlEvent {
  /** Source identifier — multiple events with the same reel share an asset. */
  reel: string;
  /** Absolute path or file:// URL to the source media. */
  sourcePath: string;
  /** Source IN (frames into the source clip). */
  sourceInFrame: number;
  /** Source OUT (exclusive). */
  sourceOutFrame: number;
  /** Optional clip name on the timeline. */
  clipName?: string;
  /** Optional source duration in frames. Used to declare the asset's total length. */
  sourceDurationFrames?: number;
  /**
   * Lane number for multi-track composition. 0 (or undefined) = main spine.
   * 1, 2, … = stacked above (B-roll, overlays, lower-thirds).
   *
   * IMPORTANT: lane clips use absolute timeline offset — they do NOT advance
   * the spine cursor. Two events with lane=1 at offset 0 both start at 0.
   * If you omit recordOffsetFrame on a lane clip, it inherits the cursor
   * position at emit time (rare; usually you want to specify it).
   */
  lane?: number;
  /**
   * Override the timeline offset where this clip starts. Required for lane
   * clips so they sit at the right time. Spine clips (lane undefined / 0)
   * normally leave this unset and accept contiguous placement.
   */
  recordOffsetFrame?: number;
  /** Static or animated transform applied via <adjust-transform>. */
  transform?: TransformSpec;
  /**
   * Static or animated opacity 0..1. Static emits a single keyframe, animated
   * emits the full ramp. Backed by <param name="opacity">.
   */
  opacity?: number | KeyframedValue<number>;
  /**
   * Static or animated audio gain in dB. Static emits <adjust-volume>;
   * animated emits <filter-audio name="Volume"> + <keyframe time= value=> ramp.
   * Convention: 0 dB = unchanged, -inf approximated as -60 dB.
   */
  volumeDb?: number | KeyframedValue<number>;
}

/** A standalone <title> element (lower-third / title card / lyric). */
export interface FcpxmlTitle {
  /** Text content. Newlines emit as &#10;. */
  text: string;
  /** Lane to render on. 0 = main spine (rare). 1+ = above. */
  lane?: number;
  /** Timeline offset in frames. */
  startFrame: number;
  /** Duration in frames. */
  durationFrames: number;
  /** Optional name in the timeline panel. */
  name?: string;
  fontName?: string;
  /** Font size in points (FCPXML coords). 63 ≈ medium HD title. */
  fontSize?: number;
  /** Hex RRGGBB; converted to FCPXML's 0..1 RGB. White by default. */
  fontColor?: string;
  /** "left" | "center" | "right" — passed through to text-style alignment. */
  alignment?: "left" | "center" | "right";
}

export interface FcpxmlOptions {
  title: string;
  /** Frame rate as a number. 29.97 / 23.976 are auto-mapped to NTSC fractions. */
  frameRate: number;
  width?: number;
  height?: number;
  events: FcpxmlEvent[];
  /**
   * Standalone titles to emit on the spine alongside asset-clips. Useful for
   * lower-thirds / chapter cards. If you only want titles, leave events empty
   * is NOT valid — pass at least one event (use a black gap clip if needed).
   */
  titles?: FcpxmlTitle[];
  /**
   * Audio metadata applied to every emitted asset. These attributes are
   * standard in real-world Resolve / Premiere / FCP exports and let
   * importers route audio without guessing. The defaults match the most
   * common content-creator setup (stereo 48kHz).
   */
  audioChannels?: number;
  audioRate?: number;
}

interface FrameRational {
  /** Numerator of frame duration (seconds). */
  num: number;
  /** Denominator of frame duration (seconds). */
  den: number;
}

/**
 * Map a frame rate to FCPXML rational frame duration.
 *
 * 30/1001 NDF maps to 1001/30000s, etc. Integer rates use 1/N.
 */
export function frameRateToRational(fps: number): FrameRational {
  // NTSC standard fractions
  if (Math.abs(fps - 23.976) < 0.01) return { num: 1001, den: 24000 };
  if (Math.abs(fps - 29.97) < 0.01) return { num: 1001, den: 30000 };
  if (Math.abs(fps - 59.94) < 0.01) return { num: 1001, den: 60000 };
  // Integer fps — exact 1/N
  const r = Math.round(fps);
  if (Math.abs(fps - r) < 0.001) return { num: 1, den: r };
  // Fallback: best-effort rational with denominator 1000
  return { num: Math.round(1000 / fps), den: 1000 };
}

/** Convert a frame count to FCPXML time string e.g. "1001/30000s × 30 = 30030/30000s". */
export function framesToTime(frames: number, fr: FrameRational): string {
  const num = frames * fr.num;
  const den = fr.den;
  // Reduce by GCD so output stays small.
  const g = gcd(Math.abs(num), den);
  return `${num / g}/${den / g}s`;
}

function gcd(a: number, b: number): number {
  while (b) {
    [a, b] = [b, a % b];
  }
  return a || 1;
}

/** Title effect resource ID — the Apple "Basic Title" placeholder. */
const TITLE_EFFECT_ID = "rTitleBasic";
const TITLE_EFFECT_UID =
  ".../Titles.localized/Bumper:Opener.localized/Basic Title.localized/Basic Title.moti";

/**
 * Build an FCPXML 1.10 string. Lays spine events out contiguously
 * (event N starts where N-1 ended) — matches our EDL emitter's contract.
 * Lane events (lane>=1) and titles use absolute offsets and do NOT advance
 * the cursor.
 */
export function buildFcpxml(opts: FcpxmlOptions): string {
  const { title, frameRate, width = 1920, height = 1080, events, titles = [] } = opts;
  if (events.length === 0) throw new Error("buildFcpxml: events must not be empty");

  const fr = frameRateToRational(frameRate);
  const formatId = "r1";
  const formatName = `FFVideoFormat${height}p${Math.round(frameRate)}`;

  // Group events by reel → one asset per unique source.
  const assetIds = new Map<string, string>();
  let nextAssetIndex = 2;
  for (const ev of events) {
    if (!assetIds.has(ev.reel)) {
      assetIds.set(ev.reel, `r${nextAssetIndex++}`);
    }
  }

  const assets: string[] = [];
  for (const [reel, assetId] of assetIds) {
    const ev = events.find((e) => e.reel === reel)!;
    const url = pathToFileUrl(ev.sourcePath);
    const durFrames = ev.sourceDurationFrames ?? maxOutFrameForReel(events, reel);
    assets.push(
      `    <asset id="${assetId}" name="${xmlEscape(reel)}" ` +
        `src="${xmlEscape(url)}" start="0s" ` +
        `duration="${framesToTime(durFrames, fr)}" ` +
        `hasVideo="1" videoSources="1" ` +
        `hasAudio="1" audioSources="1" ` +
        `audioChannels="${opts.audioChannels ?? 2}" ` +
        `audioRate="${opts.audioRate ?? 48000}" ` +
        `format="${formatId}" />`,
    );
  }

  // Title effect resource (emitted only when there are titles).
  const effects: string[] = [];
  if (titles.length > 0) {
    effects.push(
      `    <effect id="${TITLE_EFFECT_ID}" name="Basic Title" uid="${xmlEscape(TITLE_EFFECT_UID)}" />`,
    );
  }

  // Spine and lane clips. Spine = lane undefined or 0; lanes advance no cursor.
  const spineLines: string[] = [];
  let recordCursor = 0;
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    const dur = ev.sourceOutFrame - ev.sourceInFrame;
    if (dur <= 0) {
      throw new Error(`event ${i + 1}: sourceOutFrame must be > sourceInFrame`);
    }
    const ref = assetIds.get(ev.reel)!;
    const isLane = (ev.lane ?? 0) > 0;
    const offsetFrames = ev.recordOffsetFrame ?? (isLane ? 0 : recordCursor);
    const offset = framesToTime(offsetFrames, fr);
    const duration = framesToTime(dur, fr);
    const start = framesToTime(ev.sourceInFrame, fr);
    const name = ev.clipName ?? `${ev.reel} ${i + 1}`;
    const laneAttr = isLane ? ` lane="${ev.lane}"` : "";
    const inner = renderClipInner(ev, fr, dur);
    if (inner.length === 0) {
      // Self-closing, matches the original v1 behaviour.
      spineLines.push(
        `        <asset-clip ref="${ref}" name="${xmlEscape(name)}"${laneAttr} ` +
          `offset="${offset}" start="${start}" duration="${duration}" />`,
      );
    } else {
      spineLines.push(
        `        <asset-clip ref="${ref}" name="${xmlEscape(name)}"${laneAttr} ` +
          `offset="${offset}" start="${start}" duration="${duration}">`,
      );
      for (const line of inner) spineLines.push("  " + line);
      spineLines.push(`        </asset-clip>`);
    }
    if (!isLane && ev.recordOffsetFrame === undefined) recordCursor += dur;
  }

  // Titles after all asset-clips (FCPXML spine accepts mixed order; emitting
  // titles last simplifies cursor logic and is what real-world tools do).
  for (const t of titles) {
    spineLines.push(...renderTitle(t, fr));
  }

  const seqDuration = framesToTime(recordCursor, fr);

  return [
    `<?xml version="1.0" encoding="UTF-8" standalone="no"?>`,
    `<!DOCTYPE fcpxml>`,
    `<fcpxml version="1.10">`,
    `  <resources>`,
    `    <format id="${formatId}" name="${xmlEscape(formatName)}" ` +
      `frameDuration="${fr.num}/${fr.den}s" width="${width}" height="${height}" />`,
    ...assets,
    ...effects,
    `  </resources>`,
    `  <library>`,
    `    <event name="${xmlEscape("GG Editor")}">`,
    `      <project name="${xmlEscape(title)}">`,
    `        <sequence format="${formatId}" duration="${seqDuration}" tcStart="0s" tcFormat="NDF">`,
    `          <spine>`,
    ...spineLines.map((l) => "  " + l),
    `          </spine>`,
    `        </sequence>`,
    `      </project>`,
    `    </event>`,
    `  </library>`,
    `</fcpxml>`,
    "",
  ].join("\n");
}

export function totalRecordFramesFcpxml(events: FcpxmlEvent[]): number {
  // Spine clips only (lanes don't extend the timeline by themselves).
  return events
    .filter((ev) => (ev.lane ?? 0) === 0)
    .reduce((sum, ev) => sum + (ev.sourceOutFrame - ev.sourceInFrame), 0);
}

// ── Inner-element rendering ─────────────────────────────────

/**
 * Render the inner XML of an <asset-clip> based on the optional
 * transform / opacity / volume fields. Returns a list of lines (no
 * indentation) to be inserted between open and close tags.
 */
function renderClipInner(ev: FcpxmlEvent, fr: FrameRational, durFrames: number): string[] {
  const lines: string[] = [];
  if (ev.transform) {
    lines.push(...renderAdjustTransform(ev.transform, fr));
  }
  if (ev.opacity !== undefined) {
    lines.push(...renderOpacityParam(ev.opacity, fr, durFrames));
  }
  if (ev.volumeDb !== undefined) {
    lines.push(...renderVolume(ev.volumeDb, fr));
  }
  return lines;
}

function renderAdjustTransform(t: TransformSpec, fr: FrameRational): string[] {
  // Static-only fast path: emit a single self-closing <adjust-transform> with
  // attribute-style position/scale/anchor. This is what every real-world
  // FCPXML in the wild does for non-animated transforms.
  if (
    !isAnimated(t.position) &&
    !isAnimated(t.scale) &&
    !isAnimated(t.rotation) &&
    !t.anchor &&
    t.position === undefined &&
    t.scale === undefined &&
    t.rotation === undefined
  ) {
    return [];
  }
  const allStatic = !isAnimated(t.position) && !isAnimated(t.scale) && !isAnimated(t.rotation);
  if (allStatic) {
    const attrs: string[] = [];
    if (t.position !== undefined) {
      const [x, y] = t.position as [number, number];
      attrs.push(`position="${fmtNum(x)} ${fmtNum(y)}"`);
    }
    if (t.scale !== undefined) {
      const [sx, sy] = t.scale as [number, number];
      attrs.push(`scale="${fmtNum(sx)} ${fmtNum(sy)}"`);
    }
    if (t.anchor !== undefined) {
      attrs.push(`anchor="${fmtNum(t.anchor[0])} ${fmtNum(t.anchor[1])}"`);
    }
    if (t.rotation !== undefined) {
      attrs.push(`rotation="${fmtNum(t.rotation as number)}"`);
    }
    return [`<adjust-transform ${attrs.join(" ")} />`];
  }

  // Animated path: open tag, then nested <param> elements with
  // <keyframeAnimation> / <keyframe> children. Anchor (always static) sits as
  // an attribute on the open tag; static scalars also stay as attributes.
  const openAttrs: string[] = [];
  if (t.anchor) {
    openAttrs.push(`anchor="${fmtNum(t.anchor[0])} ${fmtNum(t.anchor[1])}"`);
  }
  if (t.position !== undefined && !isAnimated(t.position)) {
    const [x, y] = t.position as [number, number];
    openAttrs.push(`position="${fmtNum(x)} ${fmtNum(y)}"`);
  }
  if (t.scale !== undefined && !isAnimated(t.scale)) {
    const [sx, sy] = t.scale as [number, number];
    openAttrs.push(`scale="${fmtNum(sx)} ${fmtNum(sy)}"`);
  }
  if (t.rotation !== undefined && !isAnimated(t.rotation)) {
    openAttrs.push(`rotation="${fmtNum(t.rotation as number)}"`);
  }
  const head =
    openAttrs.length > 0 ? `<adjust-transform ${openAttrs.join(" ")}>` : `<adjust-transform>`;
  const out: string[] = [head];
  if (isAnimated(t.position)) {
    out.push(...renderParamKeyframes("position", t.position, fr, { isPosition: true }));
  }
  if (isAnimated(t.scale)) {
    out.push(...renderParamKeyframes("scale", t.scale, fr, {}));
  }
  if (isAnimated(t.rotation)) {
    out.push(...renderParamKeyframes("rotation", t.rotation, fr, {}));
  }
  out.push(`</adjust-transform>`);
  return out;
}

function renderOpacityParam(
  op: number | KeyframedValue<number>,
  fr: FrameRational,
  durFrames: number,
): string[] {
  if (!isAnimated(op)) {
    // Static opacity: emit a single keyframe at frame 0 inside <param> for
    // round-trippability. Many importers also accept attribute-only opacity
    // on <adjust-transform>, but param-with-keyframe is the most portable.
    return [
      `<param name="opacity">`,
      `  <keyframeAnimation>`,
      `    <keyframe time="${framesToTime(0, fr)}" value="${fmtNum(op as number)}" interp="linear" />`,
      `    <keyframe time="${framesToTime(durFrames, fr)}" value="${fmtNum(op as number)}" interp="linear" />`,
      `  </keyframeAnimation>`,
      `</param>`,
    ];
  }
  return renderParamKeyframes("opacity", op, fr, {});
}

function renderVolume(v: number | KeyframedValue<number>, fr: FrameRational): string[] {
  if (!isAnimated(v)) {
    return [`<adjust-volume amount="${fmtNum(v as number)}dB" />`];
  }
  const kfs = (v as KeyframedValue<number>).keyframes;
  if (kfs.length < 2) {
    throw new Error("animated volumeDb requires >=2 keyframes");
  }
  const lines: string[] = [`<filter-audio name="Volume">`, `  <param name="gain">`];
  for (const kf of kfs) {
    const interp = kf.interp ?? "linear";
    lines.push(
      `    <keyframe time="${framesToTime(kf.frame, fr)}" value="${fmtNum(kf.value)}" interp="${interp}" />`,
    );
  }
  lines.push(`  </param>`, `</filter-audio>`);
  return lines;
}

/**
 * Render <param name="..."><keyframeAnimation>... for a vector or scalar
 * keyframed value.
 *
 * isPosition flag: per the FCPXML spec, position keyframes do NOT carry
 * interp/curve attrs — FCP ignores them and Resolve has been known to reject
 * the file if they're present.
 */
function renderParamKeyframes(
  paramName: string,
  v: unknown,
  fr: FrameRational,
  opts: { isPosition?: boolean },
): string[] {
  const kv = v as KeyframedValue<number | [number, number]>;
  if (!kv?.keyframes || kv.keyframes.length < 2) {
    throw new Error(`animated ${paramName} requires >=2 keyframes`);
  }
  const lines: string[] = [`<param name="${paramName}">`, `  <keyframeAnimation>`];
  for (const kf of kv.keyframes) {
    const value = Array.isArray(kf.value)
      ? `${fmtNum(kf.value[0])} ${fmtNum(kf.value[1])}`
      : fmtNum(kf.value as number);
    if (opts.isPosition) {
      // Position keyframes: no interp attribute (per FCPXML spec).
      lines.push(`    <keyframe time="${framesToTime(kf.frame, fr)}" value="${value}" />`);
    } else {
      const interp = kf.interp ?? "linear";
      lines.push(
        `    <keyframe time="${framesToTime(kf.frame, fr)}" value="${value}" interp="${interp}" />`,
      );
    }
  }
  lines.push(`  </keyframeAnimation>`, `</param>`);
  return lines;
}

function renderTitle(t: FcpxmlTitle, fr: FrameRational): string[] {
  const offset = framesToTime(t.startFrame, fr);
  const duration = framesToTime(t.durationFrames, fr);
  const start = framesToTime(0, fr);
  const laneAttr = t.lane && t.lane !== 0 ? ` lane="${t.lane}"` : "";
  const name = t.name ?? t.text.split(/\r?\n/)[0].slice(0, 32);
  const styleId = `ts-${slugify(name)}-${t.startFrame}`;
  const fontColor = hexToFcpColor(t.fontColor ?? "FFFFFF");
  const fontFace = "Regular";
  const align = t.alignment ?? "center";
  const fontSize = t.fontSize ?? 63;
  const fontName = t.fontName ?? "Helvetica";
  return [
    `        <title ref="${TITLE_EFFECT_ID}" name="${xmlEscape(name)}"${laneAttr} ` +
      `offset="${offset}" start="${start}" duration="${duration}">`,
    `          <text>`,
    `            <text-style ref="${styleId}">${xmlEscape(t.text).replace(/\r?\n/g, "&#10;")}</text-style>`,
    `          </text>`,
    `          <text-style-def id="${styleId}">`,
    `            <text-style font="${xmlEscape(fontName)}" fontSize="${fontSize}" ` +
      `fontFace="${fontFace}" fontColor="${fontColor}" alignment="${align}" />`,
    `          </text-style-def>`,
    `        </title>`,
  ];
}

// ── Helpers ─────────────────────────────────────────────────

function isAnimated(v: unknown): boolean {
  return !!v && typeof v === "object" && Array.isArray((v as { keyframes?: unknown[] }).keyframes);
}

function fmtNum(n: number): string {
  // Trim trailing zeros, keep up to 6 decimals — matches FCPXML / Resolve
  // serialization conventions and avoids "1" vs "1.0" diff churn.
  if (!Number.isFinite(n)) return "0";
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(6).replace(/\.?0+$/, "");
}

function pathToFileUrl(p: string): string {
  if (p.startsWith("file://")) return p;
  // Windows paths: C:\Users\... → file:///C:/Users/...
  const normalized = p.replace(/\\/g, "/");
  return normalized.startsWith("/") ? `file://${normalized}` : `file:///${normalized}`;
}

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function maxOutFrameForReel(events: FcpxmlEvent[], reel: string): number {
  let max = 0;
  for (const ev of events) {
    if (ev.reel === reel && ev.sourceOutFrame > max) max = ev.sourceOutFrame;
  }
  return max;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);
}

/**
 * Convert hex RRGGBB to FCPXML's space-separated 0..1 RGBA color literal.
 * "FFFFFF" → "1 1 1 1". "808080" → "0.501961 0.501961 0.501961 1".
 */
export function hexToFcpColor(hex: string): string {
  const clean = hex.replace(/^#/, "").trim();
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) {
    throw new Error(`bad fontColor: ${hex} (expected RRGGBB)`);
  }
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;
  return `${fmtNum(r)} ${fmtNum(g)} ${fmtNum(b)} 1`;
}
