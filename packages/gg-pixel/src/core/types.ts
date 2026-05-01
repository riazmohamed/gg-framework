export type Level = "error" | "warning" | "fatal";

export interface StackFrame {
  file: string;
  line: number;
  col: number;
  fn: string;
  in_app: boolean;
}

export interface CodeContext {
  file: string;
  error_line: number;
  lines: string[];
}

export interface WireEvent {
  event_id: string;
  project_key: string;
  fingerprint: string;
  type: string;
  message: string;
  stack: StackFrame[];
  code_context: CodeContext | null;
  runtime: string;
  manual_report: boolean;
  level: Level;
  occurred_at: string;
}

export interface Sink {
  emit(event: WireEvent): Promise<void>;
  emitSync?(event: WireEvent): void;
  close?(): Promise<void>;
}

export interface PixelOptions {
  projectKey: string;
  sink: SinkConfig;
  runtime?: string;
  captureConsoleErrors?: boolean;
  captureConsoleWarnings?: boolean;
  captureUnhandledRejections?: boolean;
  captureUncaughtExceptions?: boolean;
}

export type SinkConfig =
  | { kind: "http"; ingestUrl: string; fetchFn?: typeof fetch }
  | { kind: "local"; path?: string }
  | { kind: "custom"; sink: Sink };

export interface ReportInput {
  message: string;
  error?: unknown;
  level?: Level;
  context?: Record<string, unknown>;
}
