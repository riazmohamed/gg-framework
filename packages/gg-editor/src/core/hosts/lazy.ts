/**
 * Lazy / re-detecting host adapter.
 *
 * The original architecture bound a single VideoHost instance at startup —
 * if the user opened DaVinci Resolve *after* launching ggeditor, every
 * subsequent tool call still went into the NoneAdapter even though the
 * footer's polling loop could see Resolve was now alive.
 *
 * createLazyHost() returns a VideoHost that re-detects the running NLE on
 * demand. Detection is cached for `redetectIntervalMs` (default 2s) so we
 * don't spawn `ps -axo` on every tool call. When the detected host *name*
 * changes, the previous adapter (Resolve / Premiere bridges) is shut down
 * cleanly before the new one is instantiated.
 *
 * The proxy preserves the VideoHost contract:
 *   - `name` / `displayName` are getters returning the live adapter's value.
 *   - Optional methods (`openPage`, `smartReframe`, `setClipVolume`,
 *     `executeCode`) are exposed via getters that return either a bound
 *     function or `undefined`, so existing existence checks
 *     (`if (host.openPage)`, `typeof host.openPage === 'function'`) remain
 *     authoritative against the live adapter at the moment of the check.
 *   - `shutdown()` (not part of VideoHost) cleans up the underlying adapter
 *     for the CLI's exit handler.
 *
 * The agent's startup-baked system prompt should treat host identity as
 * informational, not contractual. Workflow rule #1 already says
 * "host_info first" — host_info reads the live adapter, so the agent always
 * gets fresh ground truth.
 */
import type { HostName } from "../../types.js";
import { detectHost } from "./detect.js";
import { NoneAdapter } from "./none/adapter.js";
import { PremiereAdapter } from "./premiere/adapter.js";
import { ResolveAdapter } from "./resolve/adapter.js";
import type { VideoHost } from "./types.js";

export interface LazyHostOptions {
  /**
   * Force a specific host instead of auto-detecting. When set, the proxy
   * still acts as a normal adapter but never re-detects.
   */
  forced?: HostName;
  /**
   * Min ms between detection probes. Detection is a `ps` spawn (~5-15ms),
   * cheap individually but death by a thousand cuts if we ran it on every
   * tool call. Default 2000ms — fast enough that opening Resolve mid-session
   * lights up within 2s of the next agent tool call.
   */
  redetectIntervalMs?: number;
}

export interface LazyHost extends VideoHost {
  /** Shut down the underlying adapter (closes Resolve/Premiere bridges). */
  shutdown(): void;
  /** Force a re-detection on the next call (bypasses the cache). */
  invalidate(): void;
}

function instantiate(name: HostName): VideoHost {
  switch (name) {
    case "resolve":
      return new ResolveAdapter();
    case "premiere":
      return new PremiereAdapter();
    default:
      return new NoneAdapter();
  }
}

function shutdownAdapter(adapter: VideoHost | null): void {
  if (!adapter) return;
  if (adapter instanceof ResolveAdapter) adapter.shutdown();
  if (adapter instanceof PremiereAdapter) adapter.shutdown();
}

export function createLazyHost(opts: LazyHostOptions = {}): LazyHost {
  const interval = opts.redetectIntervalMs ?? 2000;
  let current: VideoHost | null = null;
  let lastDetectAt = 0;

  function resolve(): VideoHost {
    if (opts.forced) {
      if (!current || current.name !== opts.forced) {
        shutdownAdapter(current);
        current = instantiate(opts.forced);
      }
      return current;
    }

    const now = Date.now();
    if (current && now - lastDetectAt < interval) {
      return current;
    }
    lastDetectAt = now;

    const detected = detectHost().name;
    if (!current || current.name !== detected) {
      shutdownAdapter(current);
      current = instantiate(detected);
    }
    return current;
  }

  // Eagerly resolve once so `name` / `displayName` are correct immediately
  // after construction (before the first method call).
  resolve();

  // Optional methods are exposed via getters so `if (host.openPage)` reads
  // the live adapter's support at check time. Required methods are
  // straight delegations — re-resolves on every call so the user opening
  // their NLE mid-session is picked up within `redetectIntervalMs`.
  const lazy: LazyHost = {
    get name(): HostName {
      return resolve().name;
    },
    get displayName(): string {
      return resolve().displayName;
    },

    capabilities: () => resolve().capabilities(),
    getTimeline: () => resolve().getTimeline(),
    addMarker: (m) => resolve().addMarker(m),
    cutAt: (track, frame) => resolve().cutAt(track, frame),
    rippleDelete: (track, range) => resolve().rippleDelete(track, range),
    appendClip: (track, mediaPath) => resolve().appendClip(track, mediaPath),
    importTimeline: (filePath) => resolve().importTimeline(filePath),
    render: (renderOpts) => resolve().render(renderOpts),
    listRenderPresets: () => resolve().listRenderPresets(),
    replaceClip: (clipId, mediaPath) => resolve().replaceClip(clipId, mediaPath),
    cloneTimeline: (newName) => resolve().cloneTimeline(newName),
    saveProject: () => resolve().saveProject(),
    addTrack: (kind) => resolve().addTrack(kind),
    insertClipOnTrack: (insOpts) => resolve().insertClipOnTrack(insOpts),
    getMarkers: () => resolve().getMarkers(),
    createTimeline: (createOpts) => resolve().createTimeline(createOpts),
    importToMediaPool: (paths, bin) => resolve().importToMediaPool(paths, bin),
    setClipSpeed: (clipId, speed) => resolve().setClipSpeed(clipId, speed),
    applyLut: (clipId, lutPath, nodeIndex) => resolve().applyLut(clipId, lutPath, nodeIndex),
    setPrimaryCorrection: (clipId, cdl) => resolve().setPrimaryCorrection(clipId, cdl),
    copyGrade: (sourceClipId, targetClipIds) => resolve().copyGrade(sourceClipId, targetClipIds),
    importSubtitles: (srtPath) => resolve().importSubtitles(srtPath),

    shutdown(): void {
      shutdownAdapter(current);
      current = null;
    },
    invalidate(): void {
      // Set sentinel that's always older than `now - interval` so the next
      // resolve() re-detects regardless of cache window.
      lastDetectAt = Number.NEGATIVE_INFINITY;
    },
  };

  // Optional methods: defineProperty getters return either the bound
  // function from the live adapter or `undefined`. This preserves the
  // semantics existing tools rely on:
  //   open-page.ts:    `if (typeof host.openPage !== "function") return err(...)`
  //   smart-reframe.ts: `if (!host.smartReframe)       return err(...)`
  //   set-clip-volume.ts: same pattern.
  Object.defineProperty(lazy, "openPage", {
    enumerable: true,
    configurable: false,
    get() {
      const live = resolve();
      return live.openPage ? live.openPage.bind(live) : undefined;
    },
  });
  Object.defineProperty(lazy, "smartReframe", {
    enumerable: true,
    configurable: false,
    get() {
      const live = resolve();
      return live.smartReframe ? live.smartReframe.bind(live) : undefined;
    },
  });
  Object.defineProperty(lazy, "setClipVolume", {
    enumerable: true,
    configurable: false,
    get() {
      const live = resolve();
      return live.setClipVolume ? live.setClipVolume.bind(live) : undefined;
    },
  });
  Object.defineProperty(lazy, "executeCode", {
    enumerable: true,
    configurable: false,
    get() {
      const live = resolve();
      return live.executeCode ? live.executeCode.bind(live) : undefined;
    },
  });
  Object.defineProperty(lazy, "executeFusionComp", {
    enumerable: true,
    configurable: false,
    get() {
      const live = resolve();
      return live.executeFusionComp ? live.executeFusionComp.bind(live) : undefined;
    },
  });

  return lazy;
}
