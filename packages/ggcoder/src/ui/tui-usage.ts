import type { SubscriptionUsageProvider } from "@abukhaled/gg-core";
import type { UsageResult } from "../app-sidecar/usage.js";
import type { SlashCommand } from "../core/slash-commands.js";

export const USAGE_PROVIDERS: readonly SubscriptionUsageProvider[] = [
  "anthropic",
  "openai",
  "moonshot",
];

/** `2h 5m`, as the desktop meter's compact reset label. */
export function resetLabel(resetsAt: number | undefined, now: number): string {
  if (resetsAt === undefined) return "reset time unavailable";
  const minutes = Math.ceil((resetsAt - now) / 60_000);
  if (minutes <= 0) return "resetting now";
  if (minutes < 60) return `resets in ${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `resets in ${hours}h ${minutes % 60}m`;
  return `resets in ${Math.floor(hours / 24)}d ${hours % 24}h`;
}

function meter(percent: number): string {
  const filled = Math.round((Math.max(0, Math.min(100, percent)) / 100) * 10);
  return "█".repeat(filled) + "░".repeat(10 - filled);
}

/**
 * Plan usage per connected subscription, as text. Providers the user is not
 * logged in to are skipped unless named explicitly.
 */
export function formatUsage(
  results: readonly UsageResult[],
  now: number,
  explicit = false,
): string {
  const lines: string[] = [];
  for (const result of results) {
    if (!result.connected) {
      if (explicit) lines.push(`${result.displayName}: not logged in with a subscription.`);
      continue;
    }
    if (lines.length > 0) lines.push("");
    const stale = result.stale ? " (last known)" : "";
    lines.push(`${result.displayName}${stale}`);
    if (result.windows.length === 0) {
      lines.push(`  ${result.error ?? "No plan usage reported."}`);
      continue;
    }
    for (const window of result.windows) {
      const percent = Math.round(window.usedPercent);
      lines.push(
        `  ${window.label.padEnd(14)} ${meter(percent)} ${String(percent).padStart(3)}%  ${resetLabel(window.resetsAt, now)}`,
      );
    }
  }
  return lines.length > 0
    ? lines.join("\n")
    : "No subscription logins (Claude, ChatGPT or Kimi). Plan usage shows for OAuth logins only.";
}

/** `/usage [anthropic|openai|moonshot]` */
export function createUsageCommand(
  subscriptionUsage: () => ((provider: SubscriptionUsageProvider) => Promise<UsageResult>) | null,
): SlashCommand {
  return {
    name: "usage",
    aliases: [],
    description: "Subscription plan usage (Claude, ChatGPT, Kimi)",
    usage: "/usage [anthropic|openai|moonshot]",
    async execute(args) {
      const fetch = subscriptionUsage();
      if (!fetch) return "Plan usage needs a logged-in session.";
      const wanted = args.trim();
      if (wanted && !USAGE_PROVIDERS.includes(wanted as SubscriptionUsageProvider)) {
        return `Usage: /usage [${USAGE_PROVIDERS.join("|")}]`;
      }
      const providers = wanted ? [wanted as SubscriptionUsageProvider] : USAGE_PROVIDERS;
      const results = await Promise.all(providers.map((provider) => fetch(provider)));
      return formatUsage(results, Date.now(), Boolean(wanted));
    },
  };
}
