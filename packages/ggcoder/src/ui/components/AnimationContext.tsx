import os from "node:os";
import React, {
  createContext,
  useContext,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  useSyncExternalStore,
} from "react";

/**
 * Global animation tick context.
 *
 * Provides a single `tick` counter (incremented every TICK_INTERVAL ms)
 * that all animated components derive their frames from via modular
 * arithmetic.  This replaces per-component setIntervals that each caused
 * independent React re-renders — N spinners no longer means N timers.
 *
 * The tick only runs while at least one component has registered via
 * `useAnimationActive()`, avoiding 10 re-renders/sec during idle streaming
 * when no spinners or animations are visible.
 */

const TICK_INTERVAL = 100; // ms — base clock; consumers can derive slower frames.
const ENABLE_FOCUS_REPORTING = "\x1b[?1004h";
const DISABLE_FOCUS_REPORTING = "\x1b[?1004l";

interface AnimationStore {
  register: () => () => void;
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => number;
  isFocused: () => boolean;
}

const noopStore: AnimationStore = {
  register: () => () => {},
  subscribe: () => () => {},
  getSnapshot: () => 0,
  isFocused: () => true,
};

const AnimationStoreContext = createContext<AnimationStore>(noopStore);

export function AnimationProvider({ children }: { children: React.ReactNode }) {
  const tickRef = useRef(0);
  const subscriberCountRef = useRef(0);
  const focusedRef = useRef(true);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const listenersRef = useRef(new Set<() => void>());

  const notify = useCallback(() => {
    tickRef.current += 1;
    for (const listener of listenersRef.current) {
      listener();
    }
  }, []);

  const startTimer = useCallback(() => {
    if (timerRef.current) return;
    timerRef.current = setInterval(notify, TICK_INTERVAL);
  }, [notify]);

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => stopTimer();
  }, [stopTimer]);

  useEffect(() => {
    if (!process.stdin.isTTY) return undefined;

    const setFocused = (focused: boolean): void => {
      if (focusedRef.current === focused) return;
      focusedRef.current = focused;
      for (const listener of listenersRef.current) {
        listener();
      }
    };

    const onData = (chunk: Buffer | string): void => {
      const data = chunk.toString("utf8");
      const lastFocusIn = data.lastIndexOf("\x1b[I");
      const lastFocusOut = data.lastIndexOf("\x1b[O");

      if (lastFocusIn > lastFocusOut) setFocused(true);
      else if (lastFocusOut > lastFocusIn) setFocused(false);
    };

    process.stdin.on("data", onData);

    let enableTimer: ReturnType<typeof setTimeout> | null = null;
    const enableWhenRaw = (): void => {
      if (process.stdin.isRaw === false) {
        enableTimer = setTimeout(enableWhenRaw, 10);
        return;
      }
      process.stdout.write(ENABLE_FOCUS_REPORTING);
    };
    enableTimer = setTimeout(enableWhenRaw, 0);

    return () => {
      if (enableTimer) clearTimeout(enableTimer);
      process.stdin.off("data", onData);
      process.stdout.write(DISABLE_FOCUS_REPORTING);
      focusedRef.current = true;
    };
  }, []);

  const register = useCallback(() => {
    subscriberCountRef.current++;
    if (subscriberCountRef.current === 1) startTimer();

    return () => {
      subscriberCountRef.current--;
      if (subscriberCountRef.current <= 0) {
        subscriberCountRef.current = 0;
        stopTimer();
      }
    };
  }, [startTimer, stopTimer]);

  const subscribe = useCallback((listener: () => void) => {
    listenersRef.current.add(listener);
    return () => {
      listenersRef.current.delete(listener);
    };
  }, []);

  const getSnapshot = useCallback(() => tickRef.current, []);
  const isFocused = useCallback(() => focusedRef.current, []);

  const store = useMemo<AnimationStore>(
    () => ({ register, subscribe, getSnapshot, isFocused }),
    [getSnapshot, isFocused, register, subscribe],
  );

  return <AnimationStoreContext value={store}>{children}</AnimationStoreContext>;
}

/** Returns the current global animation tick counter. */
export function useAnimationTick(enabled = true): number {
  const store = useContext(AnimationStoreContext);
  const subscribe = useCallback(
    (listener: () => void) => (enabled ? store.subscribe(listener) : () => {}),
    [enabled, store],
  );
  const getSnapshot = useCallback(() => (enabled ? store.getSnapshot() : 0), [enabled, store]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Returns whether the terminal currently has focus when focus reporting is supported. */
export function useTerminalFocus(enabled = true): boolean {
  const store = useContext(AnimationStoreContext);
  const subscribe = useCallback(
    (listener: () => void) => (enabled ? store.subscribe(listener) : () => {}),
    [enabled, store],
  );
  const getSnapshot = useCallback(() => !enabled || store.isFocused(), [enabled, store]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * Register this component as needing animation ticks.
 * The global timer only runs while at least one component is registered.
 * Call this in any component that uses animation frames (spinners, shimmer, etc).
 *
 * On Windows (reduced motion), the timer is not started — the elapsed-time
 * counter still updates via its own 1s interval, but the 100ms animation
 * tick that causes scroll-jumping is suppressed.
 */
export function useAnimationActive(enabled = true): void {
  const { register } = useContext(AnimationStoreContext);
  const skip = useReducedMotion();
  useEffect(() => {
    if (!enabled || skip) return undefined;
    return register();
  }, [enabled, register, skip]);
}

export function useFocusedAnimation(enabled = true): { active: boolean; tick: number } {
  const focused = useTerminalFocus(enabled);
  const skip = useReducedMotion();
  const active = enabled && focused && !skip;
  useAnimationActive(active);
  const tick = useAnimationTick(active);
  return { active, tick };
}

/** Derive a frame index from the global tick for a given interval and frame count. */
export function deriveFrame(tick: number, intervalMs: number, frameCount: number): number {
  return Math.floor((tick * TICK_INTERVAL) / intervalMs) % frameCount;
}

/** Detect WSL by checking for "microsoft" or "WSL" in the kernel release string. */
let _isWSL: boolean | undefined;
function isWSL(): boolean {
  if (_isWSL !== undefined) return _isWSL;
  if (process.platform === "win32") {
    _isWSL = true;
    return true;
  }
  try {
    _isWSL = /microsoft|WSL/i.test(os.release());
  } catch {
    _isWSL = false;
  }
  return _isWSL;
}

/**
 * Check if reduced-motion is requested.
 * Respects NO_MOTION and REDUCE_MOTION env vars.
 *
 * On Windows and WSL, reduced motion is enabled by default because Ink's
 * live-area re-renders (driven by the 100ms animation tick) cause the
 * terminal viewport to force-scroll to the cursor — making it impossible
 * to scroll up while the agent is running. Users can override with
 * REDUCE_MOTION=0.
 */
export function useReducedMotion(): boolean {
  if (process.env.NO_MOTION || process.env.REDUCE_MOTION === "1") return true;
  if (process.env.REDUCE_MOTION === "0") return false;
  return isWSL();
}

export { TICK_INTERVAL };
