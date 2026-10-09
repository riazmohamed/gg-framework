import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { error as logError } from "@tauri-apps/plugin-log";
import { XIcon } from "@phosphor-icons/react";
import { theme } from "./theme";
import { recentChangelog } from "./changelog";
import type { WhatsNewMode } from "./whatsnew-content";
import { WhatsNewCampfire } from "./WhatsNewCampfire";
import "./WhatsNew.css";

/**
 * Body of the dedicated, screen-centered "What's new" window (the borderless
 * Tauri window built by Rust `open_whatsnew_window`, reached via the
 * `?whatsnew=1` flag in main.tsx). Two moods share one window:
 *   - `hype`: the one-time show right after an update relaunch.
 *   - `calm`: the same campfire, settled, for the home screen's button.
 * The window owns opening and closing (Escape, ×, the footer button); the
 * campfire design owns the banner, the new features and the history.
 *
 * Opening: Rust builds the window hidden. Once this has rendered, it asks Rust
 * to show it, then fades the card in, so there's never an empty or
 * half-styled frame. Closing fades the card out before the window goes.
 */
type Phase = "hidden" | "open" | "closing";

/** Matches `.whatsnew-window[data-phase="closing"]` in WhatsNew.css. */
const CLOSE_MS = 160;

function prefersReducedMotion(): boolean {
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function closeWindow(): void {
  void getCurrentWebviewWindow()
    .close()
    .catch(() => {});
}

export function WhatsNewWindow({
  mode = "calm",
  random = Math.random,
}: {
  mode?: WhatsNewMode;
  /** Picks this opening's critters; injectable for tests. */
  random?: () => number;
}): React.ReactElement | null {
  const [phase, setPhase] = useState<Phase>("hidden");
  const closing = useRef(false);

  // Effects run once React has committed the first frame, so the window is
  // shown with that frame already in it; then the card fades in. No timer:
  // a hidden window's timers can be throttled to once a second.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await invoke("reveal_whatsnew_window");
      } catch (e) {
        await logError(`reveal_whatsnew_window failed: ${String(e)}`);
      }
      if (!cancelled) setPhase((current) => (current === "hidden" ? "open" : current));
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const close = useCallback((): void => {
    if (closing.current) return;
    closing.current = true;
    if (prefersReducedMotion()) {
      closeWindow();
      return;
    }
    setPhase("closing");
    window.setTimeout(closeWindow, CLOSE_MS);
  }, []);

  // Escape closes the window (the borderless window has no native chrome).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [close]);

  const [latest, ...earlier] = recentChangelog(50);
  if (!latest) return null;

  return (
    <div
      className="whatsnew-window"
      data-mode={mode}
      data-phase={phase}
      style={{ background: theme.surface2 }}
    >
      <WhatsNewCampfire
        latest={latest}
        earlier={earlier}
        mode={mode}
        random={random}
        onClose={close}
      />
      <button
        className="modal-close wn-close"
        type="button"
        aria-label="Close"
        title="Close"
        onClick={close}
      >
        <XIcon size={14} weight="bold" aria-hidden="true" />
      </button>
    </div>
  );
}
