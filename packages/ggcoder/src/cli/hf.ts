import chalk from "chalk";
import { ensureAppDirs } from "../config.js";
import { initLogger, log, closeLogger } from "../core/logger.js";
import { localStatePayload, scanLocalModels } from "../core/local-scan.js";
import { formatCount, isValidHfRepoId, type HfSearchRow, type PullPhase } from "../hf-pull.js";
import { createHfPullManager } from "../app-sidecar/hf-pull-manager.js";
import { mcpColors as C } from "../ui/mcp.js";
import { CLI_VERSION } from "./shared.js";

const dim = chalk.hex(C.dim);
const primary = chalk.hex(C.primary);
const good = chalk.hex(C.good);
const bad = chalk.hex(C.bad);

/** One `hf_pull` event from the shared pull manager. */
export interface HfPullEvent {
  repo: string;
  model: string;
  file: string;
  sizeBytes: number;
  phase: PullPhase;
  percent: number;
  detail?: string;
  error?: string;
}

/**
 * `ogcoder hf search|pull` — the terminal twin of the desktop app's "Add from
 * Hugging Face" modal: find a GGUF repo and pull it into Ollama, which then
 * serves it as a local model.
 */
export async function runHf(): Promise<void> {
  const paths = await ensureAppDirs();
  initLogger(paths.logFile, { version: CLI_VERSION });
  const sub = process.argv[3];
  const arg = process.argv.slice(4).join(" ").trim();

  let lastEvent: HfPullEvent | null = null;
  let onEvent: (event: HfPullEvent) => void = () => {};
  const manager = createHfPullManager({
    paths,
    broadcast: (type, data) => {
      if (type !== "hf_pull") return;
      lastEvent = data as HfPullEvent;
      onEvent(lastEvent);
    },
    broadcastAll: () => {},
    scanLocalModels: (force) => scanLocalModels(force),
    localStatePayload: () => undefined,
  });

  try {
    if (sub === "search") {
      if (!arg) fail("Usage: ogcoder hf search <query>");
      const rows = await manager.hfSearch(arg.slice(0, 100));
      if (rows.length === 0) {
        console.log(dim(`No GGUF models on Hugging Face match "${arg}".`));
        return;
      }
      for (const line of formatSearchRows(rows)) console.log(line);
      console.log();
      console.log(dim("Pull one with: ogcoder hf pull <org/model>"));
      return;
    }
    if (sub === "pull") {
      if (!isValidHfRepoId(arg)) fail('Expected a Hugging Face repo like "org/model".');
      const done = new Promise<HfPullEvent>((resolve) => {
        onEvent = (event) => {
          renderProgress(event);
          if (event.phase === "success" || event.phase === "error") resolve(event);
        };
      });
      // Ctrl+C cancels the download instead of orphaning ollama.
      const onSigint = (): void => {
        manager.cancelHfPull();
      };
      process.on("SIGINT", onSigint);
      try {
        await manager.startHfPull(arg);
      } catch (err) {
        fail(err instanceof Error ? err.message : String(err));
      }
      const final = await done;
      process.off("SIGINT", onSigint);
      if (process.stdout.isTTY) process.stdout.write("\n");
      if (final.phase === "error") {
        log("WARN", "hf", "pull failed", { repo: arg, error: final.error ?? "" });
        fail(final.error ?? "Download failed.");
      }
      log("INFO", "hf", "pull finished", { repo: arg, model: final.model });
      // The pull manager does not wait for its own rescan; this one is what
      // gives the Ollama endpoint a credential when it had none.
      const probes = await scanLocalModels(true);
      const local = localStatePayload(probes)
        .endpoints.flatMap((e) => e.models)
        .find((m) => m.rawId === final.model || m.rawId === `${final.model}:latest`);
      console.log(good(`Pulled ${final.model} into Ollama.`));
      console.log(
        dim(
          local
            ? `Pick ${local.id} with /model in ogcoder${local.supportsTools ? "" : " (it has no tool calling, so it cannot run the agent)"}.`
            : "Pick it with /model in ogcoder.",
        ),
      );
      return;
    }
    printHfHelp();
    if (sub && sub !== "help") process.exit(1);
  } finally {
    closeLogger();
  }
}

function fail(message: string): never {
  process.stderr.write(bad(message) + "\n");
  closeLogger();
  process.exit(1);
}

/** Plain-text search rows (no colors, so tests read them directly). */
export function formatSearchRows(rows: readonly HfSearchRow[]): string[] {
  const width = Math.max(...rows.map((r) => r.id.length));
  return rows.map(
    (r) =>
      `${r.id.padEnd(width)}  ${formatCount(r.downloads)} downloads · ${formatCount(r.likes)} likes`,
  );
}

const PHASE_LABEL: Record<PullPhase, string> = {
  preparing: "Contacting Ollama…",
  downloading: "Downloading",
  verifying: "Verifying…",
  success: "Done",
  error: "Failed",
};

/** One progress line for a pull event. */
export function formatPullProgress(event: HfPullEvent): string {
  if (event.phase === "downloading") {
    return `${PHASE_LABEL.downloading} ${event.file} ${Math.round(event.percent)}%${event.detail ? ` · ${event.detail}` : ""}`;
  }
  return PHASE_LABEL[event.phase];
}

let lastLoggedStep: number | string | null = null;

function renderProgress(event: HfPullEvent): void {
  if (event.phase === "error") return; // reported once, by the caller
  const line = formatPullProgress(event);
  if (process.stdout.isTTY) {
    const cols = process.stdout.columns || 80;
    process.stdout.write(`\r\x1b[2K${primary(line.slice(0, cols - 1))}`);
    return;
  }
  // Piped output gets one line per phase and per 10% of the download.
  const step = event.phase === "downloading" ? Math.floor(event.percent / 10) : event.phase;
  if (step === lastLoggedStep) return;
  lastLoggedStep = step;
  console.log(line);
}

function printHfHelp(): void {
  console.log(`ogcoder hf — pull Hugging Face GGUF models into Ollama

Usage:
  ogcoder hf search <query>     Find GGUF repos on Hugging Face
  ogcoder hf pull <org/model>   Download one into Ollama (needs Ollama installed)

The pull picks a sensible quantization from the repo's files. Ctrl+C cancels.
A Hugging Face token from "ogcoder login" is used for gated repos.`);
}
