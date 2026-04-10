import { useCallback, useEffect, useRef } from "react";

export const DOUBLE_PRESS_TIMEOUT_MS = 800;

/**
 * Returns a callback that requires two presses within 800ms to confirm.
 * First press calls `onFirstPress` and sets pending state; second press
 * within the timeout calls `onConfirm`.
 */
export function useDoublePress(
  setPending: (pending: boolean) => void,
  onConfirm: () => void,
  onFirstPress?: () => void,
): () => void {
  const lastPressTime = useRef<number>(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const clearTimeoutSafe = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = undefined;
    }
  }, []);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      clearTimeoutSafe();
    };
  }, [clearTimeoutSafe]);

  return useCallback(() => {
    const now = Date.now();
    const timeSinceLastPress = now - lastPressTime.current;
    const isDoublePress =
      timeSinceLastPress <= DOUBLE_PRESS_TIMEOUT_MS && timer.current !== undefined;

    if (isDoublePress) {
      clearTimeoutSafe();
      setPending(false);
      onConfirm();
    } else {
      onFirstPress?.();
      setPending(true);
      clearTimeoutSafe();
      timer.current = setTimeout(() => {
        setPending(false);
        timer.current = undefined;
      }, DOUBLE_PRESS_TIMEOUT_MS);
    }

    lastPressTime.current = now;
  }, [setPending, onConfirm, onFirstPress, clearTimeoutSafe]);
}
