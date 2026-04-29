#!/usr/bin/env node
import chalk from "chalk";
import { getDefaultModel } from "@kenkaiiii/ggcoder/models";
import type { Message, Provider } from "@kenkaiiii/gg-ai";
import {
  AuthStorage,
  NotLoggedInError,
  runLogin,
  runLogout,
  runStatus,
  type SupportedAuthProvider,
} from "./core/auth/index.js";
import { createHost } from "./core/hosts/index.js";
import { discoverSkills } from "./core/skills-loader.js";
import { discoverStyles } from "./core/styles-loader.js";
import { SKILLS } from "./skills.js";
import { PremiereAdapter } from "./core/hosts/premiere/adapter.js";
import { ResolveAdapter } from "./core/hosts/resolve/adapter.js";
import { hasLastSession, loadLastSession } from "./core/sessions.js";
import { buildEditorSystemPrompt } from "./system-prompt.js";
import { createEditorTools } from "./tools/index.js";
import { renderEditorTui } from "./ui/render.js";

/** Auto-pick order — same priority ggcoder uses for default-provider selection. */
const PROVIDER_ORDER: SupportedAuthProvider[] = [
  "anthropic",
  "openai",
  "glm",
  "moonshot",
  "xiaomi",
  "minimax",
  "deepseek",
  "openrouter",
];

function parseProviderArg(arg: string | undefined): SupportedAuthProvider | undefined {
  if (!arg) return undefined;
  return (PROVIDER_ORDER as string[]).includes(arg) ? (arg as SupportedAuthProvider) : undefined;
}

function fail(msg: string): never {
  process.stderr.write(chalk.red(`error: ${msg}\n`));
  process.exit(1);
}

function printHelp(): void {
  process.stdout.write(`ggeditor — video editor agent for DaVinci Resolve and Premiere Pro

USAGE
  ggeditor          Launch the editor (auto-detects open NLE)
  ggeditor continue Resume the most recent session
  ggeditor login    Authenticate
  ggeditor logout   Clear credentials
  ggeditor auth     Show stored credentials

Auth lives in ~/.gg/auth.json — the SAME file ggcoder uses, so logging into
either CLI works for both.
`);
}

async function pickProvider(auth: AuthStorage): Promise<SupportedAuthProvider | undefined> {
  for (const p of PROVIDER_ORDER) {
    if (await auth.hasCredentials(p)) return p;
  }
  return undefined;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const sub = args[0];

  if (sub === "-h" || sub === "--help") {
    printHelp();
    return;
  }
  if (sub === "login") {
    await runLogin();
    return;
  }
  if (sub === "logout") {
    await runLogout(parseProviderArg(args[1]));
    return;
  }
  if (sub === "auth" || sub === "status") {
    await runStatus();
    return;
  }

  const isContinue = sub === "continue";
  if (sub && !isContinue) {
    fail(`unknown command: ${sub}\nrun: ggeditor --help`);
  }

  // ── Bare `ggeditor` (or `ggeditor continue`) — interactive TUI ────────

  if (!process.stdin.isTTY) {
    fail("ggeditor requires an interactive terminal");
  }

  const auth = new AuthStorage();
  await auth.load();
  const provider = await pickProvider(auth);
  if (!provider) {
    process.stderr.write(
      chalk.red("Not logged in.\n") +
        chalk.dim("Run: ggeditor login\n\n") +
        chalk.dim(
          "(Auth is shared with ggcoder via ~/.gg/auth.json — log in once, both CLIs work.)\n",
        ),
    );
    process.exit(1);
  }

  let token: string;
  try {
    token = await auth.resolveToken(provider);
  } catch (e) {
    if (e instanceof NotLoggedInError) {
      process.stderr.write(chalk.red(`${e.message}\n`));
      process.exit(1);
    }
    fail(`auth refresh failed: ${(e as Error).message}`);
  }
  const accountId = (await auth.getCredentials(provider))?.accountId;

  // Resume support — if `continue`, load prior messages.
  let priorMessages: Message[] = [];
  if (isContinue) {
    if (!(await hasLastSession())) {
      process.stderr.write(
        chalk.yellow("No previous session to continue.\n") +
          chalk.dim("Run `ggeditor` to start a new one.\n"),
      );
      process.exit(1);
    }
    const last = await loadLastSession();
    if (last) priorMessages = last.messages;
  }

  // Pick the right model for this provider via ggcoder's registry.
  const model = getDefaultModel(provider as Provider).id;

  // All providers the user has logged into — used by /model selector.
  // Same set ggcoder supports.
  const allProviders = await auth.listProviders();
  const loggedInProviders = allProviders.filter((p): p is Provider =>
    (PROVIDER_ORDER as string[]).includes(p),
  ) as Provider[];

  const host = createHost();
  const caps = await host.capabilities();
  const cwd = process.cwd();

  const skills = discoverSkills({ cwd, bundled: Object.values(SKILLS) });
  const styles = discoverStyles({ cwd });
  const system = await buildEditorSystemPrompt(host, cwd, { skills, styles });
  const reviewConfig =
    provider === "anthropic" ||
    provider === "openai" ||
    provider === "glm" ||
    provider === "moonshot"
      ? { provider, model, apiKey: token, maxTurns: 10 }
      : undefined;
  const tools = createEditorTools({ host, cwd, reviewConfig, skills });

  const cleanup = () => {
    if (host instanceof ResolveAdapter) host.shutdown();
    if (host instanceof PremiereAdapter) host.shutdown();
  };
  process.on("SIGINT", () => {
    cleanup();
    process.exit(130);
  });
  process.on("exit", cleanup);

  await renderEditorTui({
    provider: provider as Provider,
    model,
    apiKey: token,
    accountId,
    tools,
    systemPrompt: system,
    priorMessages,
    loggedInProviders,
    hostName: host.name,
    hostDisplayName: host.displayName,
    hostAvailable: caps.isAvailable,
    hostReason: caps.unavailableReason,
    cwd,
    version: "0.1.0",
    persistSessions: true,
    onShutdown: cleanup,
  });
  cleanup();
}

main().catch((e) => {
  process.stderr.write(chalk.red(`\nFatal: ${(e as Error).message}\n`));
  process.exit(1);
});
