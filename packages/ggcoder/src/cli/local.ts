import chalk from "chalk";
import { parseLocalModelId } from "@abukhaled/gg-core";
import { ensureAppDirs } from "../config.js";
import { initLogger, log, closeLogger } from "../core/logger.js";
import {
  LocalEndpointError,
  addCustomEndpoint,
  removeCustomEndpoint,
} from "../core/local-endpoint-store.js";
import { localStatePayload, scanLocalModels, type LocalStatePayload } from "../core/local-scan.js";
import { clearRuntimeModels } from "../core/model-registry.js";
import { mcpColors as C } from "../ui/mcp.js";
import { CLI_VERSION } from "./shared.js";

const dim = chalk.hex(C.dim);
const primary = chalk.hex(C.primary);
const good = chalk.hex(C.good);
const bad = chalk.hex(C.bad);

/** `ogcoder local` — the terminal twin of the desktop app's Local models modal. */
export async function runLocal(): Promise<void> {
  const paths = await ensureAppDirs();
  initLogger(paths.logFile, { version: CLI_VERSION });
  const sub = process.argv[3];
  const rest = process.argv.slice(4);
  try {
    if (!sub || sub === "list" || sub === "scan") {
      printState(localStatePayload(await scanLocalModels(true)));
      return;
    }
    if (sub === "add") {
      const input = parseLocalAddArgs(rest);
      const endpoint = await addCustomEndpoint(input);
      log("INFO", "local", "endpoint added", { id: endpoint.id });
      console.log(good(`Added ${endpoint.label} (${endpoint.id}) at ${endpoint.baseUrl}`));
      printState(localStatePayload(await scanLocalModels(true)));
      return;
    }
    if (sub === "remove" || sub === "rm") {
      const id = rest[0];
      if (!id) throw new LocalEndpointError("Usage: ogcoder local remove <id>");
      await removeCustomEndpoint(id);
      clearRuntimeModels(
        (m) => m.provider === "local" && parseLocalModelId(m.id)?.endpointId === id,
      );
      console.log(good(`Removed ${id}.`));
      return;
    }
    if (sub === "help") {
      printLocalHelp();
      return;
    }
    process.stderr.write(`Unknown local subcommand: ${sub}\n`);
    printLocalHelp();
    process.exit(1);
  } catch (err) {
    // A bad URL or id is the user's typo: say exactly why, no stack.
    if (err instanceof LocalEndpointError) {
      process.stderr.write(bad(err.message) + "\n");
      process.exit(1);
    }
    throw err;
  } finally {
    closeLogger();
  }
}

/** `add <url> [--label <name>] [--api-key <key>]`. */
export function parseLocalAddArgs(args: readonly string[]): {
  baseUrl: string;
  label?: string;
  apiKey?: string;
} {
  let baseUrl: string | undefined;
  let label: string | undefined;
  let apiKey: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--label" || arg === "--api-key") {
      const value = args[i + 1];
      if (value === undefined) throw new LocalEndpointError(`${arg} needs a value.`);
      if (arg === "--label") label = value;
      else apiKey = value;
      i++;
    } else if (arg.startsWith("--")) {
      throw new LocalEndpointError(`Unknown option ${arg}.`);
    } else if (baseUrl === undefined) {
      baseUrl = arg;
    } else {
      throw new LocalEndpointError(`Unexpected argument "${arg}".`);
    }
  }
  if (!baseUrl) {
    throw new LocalEndpointError(
      "Usage: ogcoder local add <url> [--label <name>] [--api-key <key>]",
    );
  }
  return { baseUrl, ...(label ? { label } : {}), ...(apiKey ? { apiKey } : {}) };
}

function contextLabel(tokens: number, known: boolean): string {
  const k = tokens >= 1000 ? `${Math.round(tokens / 1000)}K` : String(tokens);
  return known ? k : `${k} assumed`;
}

/** Plain-text rows for the scan result (no colors, so tests read them directly). */
export function formatLocalState(state: LocalStatePayload): string[] {
  const lines: string[] = [];
  for (const endpoint of state.endpoints) {
    const tag = endpoint.custom ? `${endpoint.id}, added` : endpoint.id;
    const status = endpoint.reachable
      ? `${endpoint.models.length} model${endpoint.models.length === 1 ? "" : "s"}`
      : `not running${endpoint.reason ? ` (${endpoint.reason})` : ""}`;
    lines.push(
      `${endpoint.reachable ? "●" : "○"} ${endpoint.label} [${tag}] ${endpoint.baseUrl} — ${status}`,
    );
    for (const model of endpoint.models) {
      const caps = [
        contextLabel(model.contextWindow, model.contextWindowKnown),
        model.supportsTools ? "tools" : "no tools",
        ...(model.supportsImages ? ["images"] : []),
        ...(model.supportsThinking ? ["thinking"] : []),
        ...(model.loaded ? ["loaded"] : []),
      ];
      lines.push(`    ${model.id}  ${caps.join(" · ")}`);
    }
  }
  return lines;
}

function printState(state: LocalStatePayload): void {
  console.log(primary("Local model servers"));
  for (const line of formatLocalState(state)) {
    if (line.startsWith("●")) console.log(good("●") + line.slice(1));
    else if (line.startsWith("○")) console.log(dim(line));
    else console.log(line.includes("no tools") ? dim(line) : line);
  }
  const usable = state.endpoints.some((e) => e.models.some((m) => m.supportsTools));
  console.log();
  console.log(
    dim(
      usable
        ? "Pick one with /model in ogcoder. Models without tool calling can't run the agent."
        : "No tool-capable local model found. Start Ollama or LM Studio, or pull one with: ogcoder hf pull <org/model>",
    ),
  );
}

function printLocalHelp(): void {
  console.log(`ogcoder local — local model servers (Ollama, LM Studio, llama.cpp, vLLM, …)

Usage:
  ogcoder local                                        Scan and list servers and their models
  ogcoder local add <url> [--label n] [--api-key k]    Add an OpenAI-compatible server
  ogcoder local remove <id>                            Remove a server you added

Ollama, LM Studio, llama.cpp and vLLM on their default ports are found automatically.
Shared with the desktop app (endpoints live in ~/.gg/settings.json).`);
}
