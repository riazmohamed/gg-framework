import fs from "node:fs";
import path from "node:path";
import type { LanguageId } from "../language-detector.js";
import { languagesToSortedArray } from "../language-detector.js";
import { PACKS } from "./packs.js";

/**
 * Load the style-pack content for a given language. Checks for a per-project
 * override at `<cwd>/.gg/styles/<id>.md` first, falling back to the bundled
 * pack. Returns `null` if neither exists (defensive — should not happen for
 * any LanguageId in PACKS).
 */
export function loadPack(id: LanguageId, cwd: string): string | null {
  const overridePath = path.join(cwd, ".gg", "styles", `${id}.md`);
  try {
    const stat = fs.statSync(overridePath);
    if (stat.isFile()) {
      return fs.readFileSync(overridePath, "utf-8").trim();
    }
  } catch {
    /* no override — fall through to bundled */
  }
  return PACKS[id] ?? null;
}

/**
 * Render the full "Language Style Packs" section that gets spliced into the
 * system prompt. Returns an empty string when the active set is empty so the
 * caller can skip the section entirely.
 *
 * The output is intentionally compact: a single header followed by each pack
 * separated by a blank line. Packs already include their own \`### <Language>\`
 * sub-headers.
 */
export function renderStylePacksSection(active: Set<LanguageId>, cwd: string): string {
  if (active.size === 0) return "";
  const ids = languagesToSortedArray(active);
  const parts: string[] = [];
  for (const id of ids) {
    const pack = loadPack(id, cwd);
    if (pack) parts.push(pack);
  }
  if (parts.length === 0) return "";
  return (
    `## Language Style Packs\n\n` +
    `Conventions for new code in each active language. Library names below are ` +
    `illustrative — use whatever the project already imports.\n\n` +
    `${AGENT_WRITTEN_CODE_PREAMBLE}\n\n` +
    parts.join("\n\n")
  );
}

/**
 * Cross-cutting rules that apply to every language pack. These are agent-native
 * concerns (determinism, observability, no hidden state, output stability) that
 * matter more for code written *by* and *read by* agents than for human-only
 * codebases. Kept terse — every line is a load-bearing constraint, not advice.
 *
 * Lives in the system prompt above the per-language packs so the model reads
 * universal rules first, then specializes per language.
 */
const AGENT_WRITTEN_CODE_PREAMBLE = `### Agent-Written Code (cross-cutting)

Universal rules — apply to every language below.

- **Observability at boundaries.** Structured logging (key/value pairs, not string interpolation) at every external I/O — HTTP calls, DB queries, file reads, subprocess runs. Log inputs, outcome, and elapsed time. Use the language's stdlib or canonical structured logger (\`log/slog\`, \`tracing\`, \`structlog\`, Pino, \`Microsoft.Extensions.Logging\`, etc.). Never leave \`console.log\`/\`print\`/\`fmt.Println\` debugging in committed code.
- **Determinism by default.** Sort before iterating maps/sets where output order is observable. Stable IDs (UUIDv7, ULID, or content hash) — never \`random + timestamp\`. Never read wall-clock time inside pure logic; inject a clock at the boundary. Use canonical-form serialization (sorted keys) for anything that gets compared, hashed, persisted, or diffed.
- **No hidden state.** No module-level mutables, no global singletons as the primary state container, no implicit DI through container magic. Pass dependencies explicitly through function signatures or constructors. State that escapes the signature is invisible at the call site, which means invisible to the agent reading it later.
- **Local verifiability.** A function should be small enough that its correctness is confirmable by reading it plus its direct callers — not by tracing through four layers of indirection. Prefer composing small pure functions over deep class hierarchies. The agent will re-read this code; optimize for that.
- **Tests pin behavior, not implementation.** Arrange-Act-Assert with each phase visible. No shared mutable fixtures across tests. Each test runnable independently in any order. Table-driven when there's a clear input→output mapping. A test that breaks on a refactor without a behavior change is a bad test.
- **Fail loudly at boundaries, handle locally inside.** Validate untrusted input the moment it crosses into your code (per the per-language Data rules). Once validated, interior code trusts the types. Errors as values for the local-handling half — see each pack's Errors rule.`;
