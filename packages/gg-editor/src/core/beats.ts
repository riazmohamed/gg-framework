import { runPython } from "./python.js";
import { sidecarPath } from "./python/sidecar-path.js";

/**
 * Beat detection + cut-snapping primitive.
 *
 * `detectBeats` shells out to a librosa-backed sidecar; `snapCuts` is the
 * pure algorithm that clamps proposed cut points to the nearest detected
 * beat within a tolerance. The split keeps the algorithm fully unit-testable
 * (no Python required) and isolates the heavy import-path inside the sidecar.
 */

export interface DetectBeatsResult {
  /** Estimated tempo (BPM). */
  tempo: number;
  /** Beat times in seconds, sorted ascending. */
  beats: number[];
  /** Audio duration in seconds (post-load). */
  durationSec: number;
}

export interface DetectBeatsOptions {
  signal?: AbortSignal;
  /** Optional librosa target sample rate. Defaults to librosa's choice (22050). */
  sampleRate?: number;
}

/**
 * Spawn the beats sidecar, write `{audioPath, sr}` to stdin, return the
 * parsed JSON. Throws with a structured message on sidecar failure so the
 * tool wrapper can format it for the agent.
 */
export async function detectBeats(
  audioPath: string,
  opts: DetectBeatsOptions = {},
): Promise<DetectBeatsResult> {
  const script = sidecarPath("beats.py");
  const stdin = JSON.stringify({
    audioPath,
    sr: opts.sampleRate,
  });
  const { code, stdout, stderr } = await runPython(script, [], {
    signal: opts.signal,
    stdin,
  });

  // Parse stdout regardless of exit code — the sidecar reports errors as
  // structured JSON on stdout (with exit 1) so we can surface them cleanly.
  const trimmed = stdout.trim();
  if (!trimmed) {
    throw new Error(
      `beat sidecar returned empty stdout (exit ${code}): ${tail(stderr)}`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error(
      `beat sidecar returned malformed output: ${trimmed.slice(-200)} | stderr: ${tail(stderr)}`,
    );
  }
  if (parsed && typeof parsed === "object" && "error" in parsed) {
    const err = parsed as { error?: string };
    throw new Error(err.error ?? "unknown beat sidecar error");
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    !Array.isArray((parsed as DetectBeatsResult).beats)
  ) {
    throw new Error(`beat sidecar returned unexpected shape: ${trimmed.slice(-200)}`);
  }
  return parsed as DetectBeatsResult;
}

export interface SnappedCut {
  /** The cut point as supplied by the caller. */
  originalSec: number;
  /** The beat time it was snapped to. */
  snappedSec: number;
  /** Index into the beats array. */
  beatIdx: number;
  /** Signed offset (snappedSec - originalSec). Magnitude ≤ toleranceSec. */
  deltaSec: number;
}

export interface UnchangedCut {
  /** Cut point that fell beyond toleranceSec from any beat. */
  atSec: number;
  /** Distance to the closest beat (positive). undefined if no beats supplied. */
  nearestBeatDeltaSec?: number;
}

export interface SnapResult {
  snapped: SnappedCut[];
  unchanged: UnchangedCut[];
}

/**
 * Snap each cut point to the nearest beat within `toleranceSec`. Cuts beyond
 * the tolerance are returned in `unchanged` with their distance to the
 * closest beat (so the agent can decide whether to widen the tolerance).
 *
 * Tiebreak: when two beats are equidistant, the EARLIER beat wins. (Cuts
 * read more naturally on the upbeat than the downbeat that follows.)
 *
 * Pure function — no I/O. Beats list need not be sorted; we sort defensively.
 */
export function snapCuts(
  cutPoints: number[],
  beats: number[],
  toleranceSec: number,
): SnapResult {
  const snapped: SnappedCut[] = [];
  const unchanged: UnchangedCut[] = [];
  if (!Array.isArray(cutPoints) || cutPoints.length === 0) {
    return { snapped, unchanged };
  }
  if (!Array.isArray(beats) || beats.length === 0) {
    for (const c of cutPoints) unchanged.push({ atSec: c });
    return { snapped, unchanged };
  }
  const tol = Math.max(0, Number.isFinite(toleranceSec) ? toleranceSec : 0);
  // Defensive sort + dedupe: the sidecar already returns sorted beats, but a
  // pure function shouldn't trust its inputs.
  const sortedBeats = [...beats].filter((b) => Number.isFinite(b)).sort((a, b) => a - b);

  for (const cut of cutPoints) {
    if (!Number.isFinite(cut)) {
      unchanged.push({ atSec: cut });
      continue;
    }
    // Binary search for the first beat >= cut.
    let lo = 0;
    let hi = sortedBeats.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (sortedBeats[mid] < cut) lo = mid + 1;
      else hi = mid;
    }
    // Candidates: sortedBeats[lo-1] (left) and sortedBeats[lo] (right).
    const leftIdx = lo - 1;
    const rightIdx = lo < sortedBeats.length ? lo : -1;
    let bestIdx = -1;
    let bestDelta = Infinity; // signed: best - cut
    if (leftIdx >= 0) {
      const d = sortedBeats[leftIdx] - cut; // ≤ 0
      if (Math.abs(d) < Math.abs(bestDelta)) {
        bestIdx = leftIdx;
        bestDelta = d;
      }
    }
    if (rightIdx >= 0) {
      const d = sortedBeats[rightIdx] - cut; // ≥ 0
      // Strict <: ties go to the earlier (left) beat already chosen above.
      if (Math.abs(d) < Math.abs(bestDelta)) {
        bestIdx = rightIdx;
        bestDelta = d;
      }
    }

    if (bestIdx >= 0 && Math.abs(bestDelta) <= tol) {
      snapped.push({
        originalSec: cut,
        snappedSec: sortedBeats[bestIdx],
        beatIdx: bestIdx,
        deltaSec: bestDelta,
      });
    } else {
      unchanged.push({
        atSec: cut,
        nearestBeatDeltaSec: bestIdx >= 0 ? Math.abs(bestDelta) : undefined,
      });
    }
  }
  return { snapped, unchanged };
}

function tail(s: string): string {
  return s.split("\n").filter(Boolean).slice(-3).join(" | ").slice(-300);
}
