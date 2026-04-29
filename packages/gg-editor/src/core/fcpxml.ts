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
 * v1 scope:
 *   - One or more source assets (each unique `reel` becomes an asset)
 *   - Single video sequence (V-track only — audio rides along via asset
 *     hasAudio="1")
 *   - Integer or rational frame rates (24, 25, 29.97, 30, 50, 59.94, 60)
 */

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
}

export interface FcpxmlOptions {
  title: string;
  /** Frame rate as a number. 29.97 / 23.976 are auto-mapped to NTSC fractions. */
  frameRate: number;
  width?: number;
  height?: number;
  events: FcpxmlEvent[];
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

/**
 * Build an FCPXML 1.10 string. Lays events out contiguously on the spine
 * (event N starts where N-1 ended) — matches our EDL emitter's contract.
 */
export function buildFcpxml(opts: FcpxmlOptions): string {
  const { title, frameRate, width = 1920, height = 1080, events } = opts;
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

  const spineLines: string[] = [];
  let recordCursor = 0;
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    const dur = ev.sourceOutFrame - ev.sourceInFrame;
    if (dur <= 0) {
      throw new Error(`event ${i + 1}: sourceOutFrame must be > sourceInFrame`);
    }
    const ref = assetIds.get(ev.reel)!;
    const offset = framesToTime(recordCursor, fr);
    const duration = framesToTime(dur, fr);
    const start = framesToTime(ev.sourceInFrame, fr);
    const name = ev.clipName ?? `${ev.reel} ${i + 1}`;
    spineLines.push(
      `        <asset-clip ref="${ref}" name="${xmlEscape(name)}" ` +
        `offset="${offset}" start="${start}" duration="${duration}" />`,
    );
    recordCursor += dur;
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
  return events.reduce((sum, ev) => sum + (ev.sourceOutFrame - ev.sourceInFrame), 0);
}

// ── Helpers ─────────────────────────────────────────────────

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
