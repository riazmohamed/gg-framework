/**
 * Tiny listener-set primitive for pure event signals (no stored state).
 *
 * Use this when subscribers only need to know "something happened",
 * not "what is the current value".
 *
 * Usage:
 *   const changed = createSignal()
 *   const unsub = changed.subscribe(() => console.log("changed"))
 *   changed.emit()
 */

export interface Signal<Args extends unknown[] = []> {
  /** Subscribe a listener. Returns an unsubscribe function. */
  subscribe: (listener: (...args: Args) => void) => () => void;
  /** Call all subscribed listeners with the given arguments. */
  emit: (...args: Args) => void;
  /** Remove all listeners. */
  clear: () => void;
}

export function createSignal<Args extends unknown[] = []>(): Signal<Args> {
  const listeners = new Set<(...args: Args) => void>();
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    emit(...args) {
      for (const listener of listeners) listener(...args);
    },
    clear() {
      listeners.clear();
    },
  };
}
