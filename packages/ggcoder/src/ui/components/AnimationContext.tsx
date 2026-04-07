import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";

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

const TICK_INTERVAL = 100; // ms — fast enough for the spinner (100ms frames)

const AnimationContext = createContext(0);
const AnimationControlContext = createContext<{
  register: () => () => void;
}>({ register: () => () => {} });

export function AnimationProvider({ children }: { children: React.ReactNode }) {
  const [tick, setTick] = useState(0);
  const subscriberCountRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startTimer = useCallback(() => {
    if (timerRef.current) return;
    timerRef.current = setInterval(() => {
      setTick((t) => t + 1);
    }, TICK_INTERVAL);
  }, []);

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

  const control = React.useMemo(() => ({ register }), [register]);

  return (
    <AnimationControlContext value={control}>
      <AnimationContext value={tick}>{children}</AnimationContext>
    </AnimationControlContext>
  );
}

/** Returns the current global animation tick counter. */
export function useAnimationTick(): number {
  return useContext(AnimationContext);
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
export function useAnimationActive(): void {
  const { register } = useContext(AnimationControlContext);
  const skip = useReducedMotion();
  useEffect(() => {
    if (skip) return;
    return register();
  }, [register, skip]);
}

/** Derive a frame index from the global tick for a given interval and frame count. */
export function deriveFrame(tick: number, intervalMs: number, frameCount: number): number {
  return Math.floor((tick * TICK_INTERVAL) / intervalMs) % frameCount;
}

/**
 * Check if reduced-motion is requested.
 * Respects NO_MOTION and REDUCE_MOTION env vars.
 *
 * On Windows, reduced motion is enabled by default because Ink's live-area
 * re-renders (driven by the 100ms animation tick) cause Windows Terminal to
 * force-scroll the viewport to the cursor — making it impossible to scroll
 * up while the agent is running. Users can override with REDUCE_MOTION=0.
 */
export function useReducedMotion(): boolean {
  if (process.env.NO_MOTION || process.env.REDUCE_MOTION === "1") return true;
  if (process.env.REDUCE_MOTION === "0") return false;
  return process.platform === "win32";
}

export { TICK_INTERVAL };
