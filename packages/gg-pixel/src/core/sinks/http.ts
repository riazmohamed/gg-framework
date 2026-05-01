import type { Sink, WireEvent } from "../types.js";

export class HttpSink implements Sink {
  private readonly fetchFn: typeof fetch;

  constructor(
    private readonly ingestUrl: string,
    fetchFn?: typeof fetch,
  ) {
    // CRITICAL: in browsers `fetch` is `window.fetch` and requires `this === window`.
    // Storing it as a property and calling via `this.fetchFn(...)` strips that
    // binding and throws "Illegal invocation". Bind to globalThis on assignment.
    // Tests can still inject a custom fetchFn (no binding needed for plain fns).
    this.fetchFn = fetchFn ?? globalThis.fetch.bind(globalThis);
  }

  async emit(event: WireEvent): Promise<void> {
    const body = JSON.stringify(event);
    // `keepalive: true` lets the request survive page unload (browser).
    // `mode: "cors"` is the explicit default but stating it makes the
    // intent clear and avoids surprises on stricter contexts.
    const res = await this.fetchFn(this.ingestUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-pixel-key": event.project_key,
      },
      body,
      keepalive: typeof window !== "undefined",
      mode: typeof window !== "undefined" ? "cors" : undefined,
    });
    if (!res.ok) {
      throw new Error(`pixel ingest failed: ${res.status}`);
    }
  }
}
