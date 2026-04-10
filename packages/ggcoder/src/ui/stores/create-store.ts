import { useSyncExternalStore } from "react";
import { createSignal } from "../utils/signal.js";

export interface Store<T> {
  subscribe(cb: () => void): () => void;
  getSnapshot(): T;
  setState(update: Partial<T> | ((prev: T) => Partial<T>)): void;
}

/**
 * Create a lightweight external store compatible with React's useSyncExternalStore.
 * Uses createSignal for pub/sub and Object.freeze for snapshot immutability.
 */
export function createStore<T extends object>(initialState: T): Store<T> {
  const signal = createSignal();
  let state: T = Object.freeze({ ...initialState }) as T;

  return {
    subscribe(cb: () => void) {
      return signal.subscribe(cb);
    },
    getSnapshot() {
      return state;
    },
    setState(update: Partial<T> | ((prev: T) => Partial<T>)) {
      const partial = typeof update === "function" ? update(state) : update;
      state = Object.freeze({ ...state, ...partial }) as T;
      signal.emit();
    },
  };
}

/**
 * React hook for consuming a store. Triggers re-render when any state changes.
 */
export function useStore<T extends object>(store: Store<T>): T {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}
