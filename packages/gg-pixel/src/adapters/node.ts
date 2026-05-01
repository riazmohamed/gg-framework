import { randomUUID } from "node:crypto";
import { parseStack } from "../core/stack.js";
import { fingerprint } from "../core/fingerprint.js";
import { captureCodeContext } from "../code-context.js";
import { EventQueue } from "../core/queue.js";
import type { Level, ReportInput, Sink, WireEvent } from "../core/types.js";

export interface NodeAdapterOptions {
  projectKey: string;
  runtime: string;
  sink: Sink;
  captureConsoleErrors: boolean;
  captureConsoleWarnings: boolean;
  captureUnhandledRejections: boolean;
  captureUncaughtExceptions: boolean;
}

export interface NodeAdapter {
  report(input: ReportInput): void;
  flush(): Promise<void>;
  close(): Promise<void>;
}

export function installNodeAdapter(opts: NodeAdapterOptions): NodeAdapter {
  const queue = new EventQueue(opts.sink);
  const detach: Array<() => void> = [];

  const enqueueError = (err: unknown, level: Level, manual: boolean) => {
    try {
      const event = buildEvent(err, level, manual, opts.projectKey, opts.runtime);
      queue.enqueue(event);
    } catch {
      // never let pixel break the host program
    }
  };

  const enqueueErrorSync = (err: unknown, level: Level, manual: boolean) => {
    try {
      const event = buildEvent(err, level, manual, opts.projectKey, opts.runtime);
      queue.enqueueSync(event);
    } catch {
      // never let pixel break the host program
    }
  };

  if (opts.captureUncaughtExceptions) {
    const handler = (err: Error) => enqueueErrorSync(err, "fatal", false);
    process.on("uncaughtExceptionMonitor", handler);
    detach.push(() => process.off("uncaughtExceptionMonitor", handler));
  }

  if (opts.captureUnhandledRejections) {
    const handler = (reason: unknown) => enqueueErrorSync(reason, "error", false);
    process.on("unhandledRejection", handler);
    detach.push(() => process.off("unhandledRejection", handler));
  }

  if (opts.captureConsoleErrors) {
    detach.push(patchConsole("error", (args) => enqueueError(consoleError(args), "error", false)));
  }

  if (opts.captureConsoleWarnings) {
    detach.push(patchConsole("warn", (args) => enqueueError(consoleError(args), "warning", false)));
  }

  const onBeforeExit = () => {
    void queue.flush();
  };
  process.on("beforeExit", onBeforeExit);
  detach.push(() => process.off("beforeExit", onBeforeExit));

  return {
    report(input: ReportInput) {
      const level = input.level ?? "error";
      if (input.error !== undefined) {
        try {
          const event = buildEvent(input.error, level, true, opts.projectKey, opts.runtime);
          if (input.message) event.message = input.message;
          queue.enqueue(event);
        } catch {
          // never let pixel break the host program
        }
        return;
      }
      const err = new Error(input.message);
      err.name = "ManualReport";
      enqueueError(err, level, true);
    },
    flush: () => queue.flush(),
    close: async () => {
      for (const fn of detach) fn();
      await queue.close();
    },
  };
}

function buildEvent(
  err: unknown,
  level: Level,
  manual: boolean,
  projectKey: string,
  runtime: string,
): WireEvent {
  const { type, message, stackString } = normalize(err);
  const stack = parseStack(stackString);
  return {
    event_id: randomUUID(),
    project_key: projectKey,
    fingerprint: fingerprint(type, stack),
    type,
    message,
    stack,
    code_context: captureCodeContext(stack),
    runtime,
    manual_report: manual,
    level,
    occurred_at: new Date().toISOString(),
  };
}

function normalize(err: unknown): { type: string; message: string; stackString?: string } {
  if (err instanceof Error) {
    return { type: err.name || "Error", message: err.message, stackString: err.stack };
  }
  if (typeof err === "string") {
    return { type: "StringError", message: err };
  }
  try {
    return { type: "UnknownError", message: JSON.stringify(err) };
  } catch {
    return { type: "UnknownError", message: String(err) };
  }
}

function consoleError(args: unknown[]): unknown {
  for (const a of args) if (a instanceof Error) return a;
  return new Error(args.map(stringify).join(" "));
}

function stringify(x: unknown): string {
  if (typeof x === "string") return x;
  try {
    return JSON.stringify(x);
  } catch {
    return String(x);
  }
}

type ConsoleMethod = "error" | "warn";

function patchConsole(method: ConsoleMethod, onCall: (args: unknown[]) => void): () => void {
  const original = console[method];
  console[method] = (...args: unknown[]) => {
    try {
      onCall(args);
    } catch {
      // never let pixel break the host program
    }
    original.apply(console, args);
  };
  return () => {
    console[method] = original;
  };
}
