/**
 * Module-level scroll pause state.
 *
 * When the user scrolls up in the terminal, Ink's live-area re-renders
 * (cursor repositioning + content rewrite) garble the display because Ink
 * assumes the viewport is at the bottom.  This module lets InputArea signal
 * "user is scrolling" so high-frequency updaters (streaming text flush) can
 * defer their setState calls until scrolling stops.
 */

let paused = false;
let resumeListeners: (() => void)[] = [];

export function isScrollPaused(): boolean {
  return paused;
}

export function setScrollPaused(value: boolean): void {
  if (paused === value) return;
  paused = value;
  if (!value) {
    for (const fn of resumeListeners) fn();
  }
}

/** Register a callback that fires when scroll pause ends (user stopped scrolling). */
export function onScrollResume(fn: () => void): () => void {
  resumeListeners.push(fn);
  return () => {
    resumeListeners = resumeListeners.filter((l) => l !== fn);
  };
}
