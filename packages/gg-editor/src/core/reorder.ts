/**
 * Timeline reordering — turn a current TimelineState + an agent-supplied
 * permutation into a list of FCPXML events that the host can re-import.
 *
 * Why this exists: neither Resolve nor Premiere expose a scriptable "move
 * clip from index N to index M" call. The portable workaround is to rebuild
 * the timeline as FCPXML and import it. This module is the pure, testable
 * core of that workaround.
 *
 * Ordering rules:
 *   - Only video clips are reorderable (audio rides along with each video
 *     clip's underlying asset). Audio-only timelines are out of scope here.
 *   - `newOrder` is a list of clip IDs in the desired new order. Clips not
 *     listed keep their original relative order and stack at the end.
 *   - Throws if newOrder references a clipId that doesn't exist on the
 *     current timeline (typo guard — silently dropping is worse).
 */

import type { ClipInfo, TimelineState } from "../types.js";
import type { FcpxmlEvent } from "./fcpxml.js";

export interface ReorderInput {
  /** Current timeline state from host.getTimeline(). */
  current: TimelineState;
  /**
   * Desired new order, as a list of clipIds. IDs not present here keep their
   * original relative order and append at the end.
   */
  newOrder: string[];
  /**
   * Map from clipId to absolute source media path. Required because
   * TimelineState's ClipInfo has an OPTIONAL sourcePath — when the host
   * adapter can't resolve it (e.g. CEP fallback), the agent supplies it.
   * If a ClipInfo already has sourcePath, the map entry is optional.
   */
  sourcePathByClipId?: Record<string, string>;
}

/**
 * Build the FcpxmlEvent[] list for the reordered timeline. Each event maps
 * to one video clip in the new order. Sequential record offsets are computed
 * by the FCPXML emitter (we don't pre-compute them here — that's its job).
 */
export function reorderToEvents(input: ReorderInput): FcpxmlEvent[] {
  const { current, newOrder, sourcePathByClipId = {} } = input;

  // Filter to video-track clips only; audio-only timelines aren't supported
  // by this rebuild path. Order by track then start so the input is stable.
  const videoClips = current.clips
    .filter((c) => c.trackKind === "video")
    .sort((a, b) => a.track - b.track || a.startFrame - b.startFrame);

  const byId = new Map<string, ClipInfo>();
  for (const c of videoClips) byId.set(c.id, c);

  // Validate newOrder
  for (const id of newOrder) {
    if (!byId.has(id)) {
      throw new Error(`reorder: clipId not found on current timeline: ${id}`);
    }
  }

  const seen = new Set<string>();
  const ordered: ClipInfo[] = [];
  // First the explicitly-listed IDs, in the supplied order.
  for (const id of newOrder) {
    if (seen.has(id)) continue;
    seen.add(id);
    ordered.push(byId.get(id)!);
  }
  // Then anything not mentioned, preserving its original position relative
  // to other unmentioned clips.
  for (const c of videoClips) {
    if (!seen.has(c.id)) {
      seen.add(c.id);
      ordered.push(c);
    }
  }

  // Map each clip to an FcpxmlEvent. The reel = the source path so multiple
  // clips from the same source share an asset in the emitted FCPXML.
  return ordered.map((c, i) => {
    const sourcePath = sourcePathByClipId[c.id] ?? c.sourcePath;
    if (!sourcePath) {
      throw new Error(
        `reorder: missing sourcePath for clip ${c.id}; pass sourcePathByClipId or ensure host returns it`,
      );
    }
    const dur = c.endFrame - c.startFrame;
    if (dur <= 0) {
      throw new Error(`reorder: clip ${c.id} has non-positive duration`);
    }
    return {
      reel: sourcePath,
      sourcePath,
      // Record-time start/end on the OLD timeline. We treat the original
      // record start as the source-in for the rebuilt timeline so the clip
      // body stays identical; offset on the spine is recomputed by the
      // FCPXML emitter.
      sourceInFrame: c.startFrame,
      sourceOutFrame: c.endFrame,
      clipName: c.name || `clip ${i + 1}`,
    };
  });
}
