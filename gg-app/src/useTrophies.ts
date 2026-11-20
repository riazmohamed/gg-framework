// Trophies for one window: the initial GET /trophies paint, then live
// `trophies` frames (the sidecar sends one to every window whenever a counter
// moves). A frame that earned trophies carries their ids and a nonce; the
// window whose action earned them (`origin`) queues them to celebrate, once.
import { useCallback, useEffect, useRef, useState } from "react";
import {
  getTrophies,
  subscribe,
  type SidecarEvent,
  type Trophy,
  type TrophySnapshot,
} from "./agent";

export interface TrophiesState {
  snapshot: TrophySnapshot | null;
  /** Earned trophies waiting to be celebrated, oldest first. */
  queue: Trophy[];
  /** The front of the queue has been shown; move on to the next. */
  shift: () => void;
}

/** The newly earned trophies a frame should celebrate here, or none. */
export function trophiesToCelebrate(snap: TrophySnapshot, seen: Set<string>): Trophy[] {
  const nonce = snap.eventNonce;
  if (!nonce || snap.unlocked.length === 0 || seen.has(nonce)) return [];
  seen.add(nonce);
  if (snap.origin !== true) return [];
  const ids = new Set(snap.unlocked);
  return snap.trophies.filter((t) => ids.has(t.id));
}

export function useTrophies(): TrophiesState {
  const [snapshot, setSnapshot] = useState<TrophySnapshot | null>(null);
  const [queue, setQueue] = useState<Trophy[]>([]);
  const seen = useRef<Set<string>>(new Set());

  useEffect(() => {
    let disposed = false;
    void getTrophies()
      .then((snap) => {
        if (disposed) return;
        if (snap.eventNonce) seen.current.add(snap.eventNonce);
        // A live frame may already have landed; keep whichever is newer.
        setSnapshot((current) => current ?? snap);
      })
      .catch(() => {
        // Sidecar unavailable: the key stays hidden until the first frame.
      });
    const unsubscribe = subscribe((e: SidecarEvent) => {
      if (e.type !== "trophies") return;
      const snap = e.data as TrophySnapshot;
      setSnapshot(snap);
      const fresh = trophiesToCelebrate(snap, seen.current);
      if (fresh.length > 0) setQueue((q) => [...q, ...fresh]);
    });
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, []);

  const shift = useCallback(() => setQueue((q) => q.slice(1)), []);
  return { snapshot, queue, shift };
}
