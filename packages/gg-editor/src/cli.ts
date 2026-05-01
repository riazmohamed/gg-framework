#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import chalk from "chalk";
import { getDefaultModel } from "@abukhaled/ogcoder/models";
import type { Message, Provider } from "@abukhaled/gg-ai";
import {
  AuthStorage,
  NotLoggedInError,
  runLogin,
  runLogout,
  runStatus,
  type SupportedAuthProvider,
} from "./core/auth/index.js";
import { isOnboarded, onboardedMarkerPath } from "./core/doctor.js";
import { runDoctorInteractive } from "./core/doctor-runner.js";
import { getPackageVersion } from "./core/version.js";
import { discoverSkills } from "./core/skills-loader.js";
import { discoverStyles } from "./core/styles-loader.js";
import { SKILLS } from "./skills.js";
import { createLazyHost } from "./core/hosts/lazy.js";
import { hasLastSession, loadLastSession } from "./core/sessions.js";
import { buildEditorStaticBody, buildEditorSystemPrompt } from "./system-prompt.js";
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
  ggeditor           Launch the editor (auto-detects open NLE)
  ggeditor continue  Resume the most recent session
  ggeditor login     Authenticate
  ggeditor logout    Clear credentials
  ggeditor auth      Show stored credentials
  ggeditor doctor    Walk through environment fixes (--all to view inventory)

Auth lives in ~/.gg/auth.json — the SAME file ggcoder uses, so logging into
either CLI works for both.
`);
}

/**
 * Mark the current home as onboarded so we don't re-run the doctor on
 * subsequent launches. Called after a first-run doctor pass succeeds.
 */
function markOnboarded(): void {
  const path = onboardedMarkerPath();
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, new Date().toISOString() + "\n", "utf8");
  } catch {
    // Non-fatal — we'll just re-run onboarding next time.
  }
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
  if (sub === "doctor") {
    const all = args.includes("--all") || args.includes("-a");
    const yes = args.includes("--yes") || args.includes("-y");
    await runDoctorInteractive({ all, nonInteractive: yes });
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

  // First-run onboarding — only when the marker doesn't exist. Walks
  // the user through every actionable item, offering Y/N confirms for
  // anything we know how to install via a package manager.
  if (!isOnboarded()) {
    await runDoctorInteractive({ onboarding: true });
    markOnboarded();
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

  // Lazy host: re-detects on every tool call (cached for 2s) so opening
  // Resolve / Premiere mid-session is picked up without restarting.
  const host = createLazyHost();
  const caps = await host.capabilities();
  const cwd = process.cwd();

  const skills = discoverSkills({ cwd, bundled: Object.values(SKILLS) });
  const styles = discoverStyles({ cwd });
  // Static body is host-independent and cached for the session. The host
  // block is spliced in at startup and re-spliced by App.tsx whenever the
  // user opens / closes their NLE.
  const staticPromptBody = buildEditorStaticBody(cwd, { skills, styles });
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
    host.shutdown();
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
    staticPromptBody,
    host,
    priorMessages,
    loggedInProviders,
    hostName: host.name,
    hostDisplayName: host.displayName,
    hostAvailable: caps.isAvailable,
    hostReason: caps.unavailableReason,
    cwd,
    version: getPackageVersion(),
    persistSessions: true,
    onShutdown: cleanup,
  });
  cleanup();
}

main().catch((e) => {
  process.stderr.write(chalk.red(`\nFatal: ${(e as Error).message}\n`));
  process.exit(1);
});
