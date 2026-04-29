import { framesToTimecode } from "./format.js";

/**
 * CMX 3600 EDL writer.
 *
 * One event per kept segment. The agent supplies a list of (source-in,
 * source-out) pairs in source order; we lay them out contiguously on the
 * record timeline, which is exactly the "rebuilt timeline after silence
 * removal" pattern.
 *
 * CMX 3600 is the lowest-common-denominator interchange format — both
 * DaVinci Resolve and Premiere Pro import it.
 */

export interface EdlEvent {
  /** Reel name (≤8 chars in strict CMX 3600; we'll truncate). Most NLEs map this to the source clip. */
  reel: string;
  /** Track type. "V" video only, "A" audio, "B" both, "A1"/"A2" individual audio tracks. */
  track: "V" | "A" | "B" | "A1" | "A2";
  /** Source IN (frames into the source clip). */
  sourceInFrame: number;
  /** Source OUT (exclusive). */
  sourceOutFrame: number;
  /** Optional human label, written as a "* FROM CLIP NAME:" comment. */
  clipName?: string;
}

export interface EdlOptions {
  title: string;
  frameRate: number;
  events: EdlEvent[];
  /** Drop-frame timecode? Default false. NDF is correct for 30/60 fps; DF only for 29.97/59.94. */
  dropFrame?: boolean;
}

/**
 * Build a CMX 3600 EDL string. Events are placed contiguously on the record
 * timeline (event N starts where event N-1 ended).
 */
export function buildEdl(opts: EdlOptions): string {
  const { title, frameRate, events, dropFrame = false } = opts;
  const fcm = dropFrame ? "DROP FRAME" : "NON-DROP FRAME";

  const lines: string[] = [];
  lines.push(`TITLE: ${sanitize(title, 70)}`);
  lines.push(`FCM: ${fcm}`);
  lines.push("");

  let recordCursor = 0;
  events.forEach((ev, i) => {
    const eventNum = String(i + 1).padStart(3, "0");
    const reel = padReel(ev.reel);
    const track = padTrack(ev.track);
    const dur = ev.sourceOutFrame - ev.sourceInFrame;
    if (dur <= 0) {
      throw new Error(`event ${i + 1}: sourceOutFrame must be > sourceInFrame`);
    }
    const srcIn = framesToTimecode(ev.sourceInFrame, frameRate);
    const srcOut = framesToTimecode(ev.sourceOutFrame, frameRate);
    const recIn = framesToTimecode(recordCursor, frameRate);
    const recOut = framesToTimecode(recordCursor + dur, frameRate);
    recordCursor += dur;

    lines.push(`${eventNum}  ${reel}  ${track}  C        ${srcIn} ${srcOut} ${recIn} ${recOut}`);
    if (ev.clipName) {
      lines.push(`* FROM CLIP NAME: ${sanitize(ev.clipName, 80)}`);
    }
  });

  // Trailing newline — some parsers require it.
  return lines.join("\n") + "\n";
}

/**
 * Total record-side duration of an EDL in frames. Useful for the agent to
 * verify the rebuild matches its plan.
 */
export function totalRecordFrames(events: EdlEvent[]): number {
  return events.reduce((sum, ev) => sum + (ev.sourceOutFrame - ev.sourceInFrame), 0);
}

// ── Helpers ─────────────────────────────────────────────────

function padReel(reel: string): string {
  // CMX 3600 reel field is 8 chars wide. Most modern NLEs accept longer reels
  // with a free-form column, but we stay strict for max compatibility.
  const r = reel.replace(/\s+/g, "_").slice(0, 8);
  return r.padEnd(8, " ");
}

function padTrack(track: EdlEvent["track"]): string {
  // 5-char column.
  return track.padEnd(5, " ");
}

function sanitize(s: string, max: number): string {
  return s.replace(/[\r\n]+/g, " ").slice(0, max);
}
