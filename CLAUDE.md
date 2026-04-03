# CLAUDE.md

## Project

**gg-framework** — Modular TypeScript monorepo for building LLM-powered apps, from raw streaming to a full CLI coding agent.

| Package | npm | Description |
|---|---|---|
| `packages/gg-ai` | `@abukhaled/gg-ai` | Unified LLM streaming API (Anthropic, OpenAI) |
| `packages/gg-agent` | `@abukhaled/gg-agent` | Agent loop with tool execution |
| `packages/ggcoder` | `@abukhaled/ogcoder` | CLI coding agent (`ogcoder` binary) |

**Dependency chain**: `gg-ai` → `gg-agent` → `ogcoder`

## Project Structure

```
packages/
├── gg-ai/src/              # Streaming API
│   ├── types.ts            # StreamOptions, ContentBlock, events
│   ├── stream.ts           # Main stream() dispatch
│   ├── providers/          # anthropic, openai, openai-codex, palsu (mock)
│   └── utils/              # EventStream, Zod-to-JSON-Schema
├── gg-agent/src/           # Agent engine
│   ├── types.ts            # AgentTool, AgentEvent, AgentOptions
│   ├── agent.ts            # Agent class + AgentStream
│   └── agent-loop.ts       # Pure async generator loop
└── ggcoder/src/            # CLI app (~100 files)
    ├── cli.ts              # Entry point
    ├── core/               # OAuth, MCP, compaction, model registry, extensions, agents
    ├── tools/              # 27 tool files (bash, read, write, edit, grep, find, etc.)
    ├── ui/components/      # 35 React/Ink components (one per file)
    ├── ui/hooks/           # 8 hooks (useAgentLoop, useSessionManager, etc.)
    ├── modes/              # Execution modes (interactive, rpc, serve, agent-home)
    └── utils/              # Git, shell, formatting, image, sound
```

## Tech Stack

- **TypeScript** 5.9 (strict, ES2022, ESM) · **pnpm** workspaces
- **Build**: tsup (gg-ai, gg-agent) / tsc (ogcoder)
- **Test**: Vitest 4.1 · **Lint**: ESLint 10 + typescript-eslint · **Format**: Prettier 3.8
- **UI**: Ink 6 + React 19
- **Key deps**: `@anthropic-ai/sdk`, `openai`, `zod` v4, `@modelcontextprotocol/sdk`, `sharp`

## Commands

```bash
pnpm build            # Build all packages
pnpm check            # tsc --noEmit (all packages)
pnpm lint             # ESLint
pnpm lint:fix         # ESLint --fix
pnpm format           # Prettier write
pnpm format:check     # Prettier check
pnpm test             # Vitest (all packages)
```

## Code Quality — Zero Tolerance

After editing ANY file, run:

```bash
pnpm check && pnpm lint && pnpm format:check
```

Fix ALL errors before continuing. Quick fixes: `pnpm lint:fix` and `pnpm format`.

## Organization Rules

- Types → `types.ts` in each package
- Providers → `providers/` in gg-ai, one file per provider
- Tools → `tools/` in ggcoder, one file per tool
- UI components → `ui/components/`, one component per file
- OAuth flows → `core/oauth/`, one file per provider
- Tests → co-located with source files

## Key Patterns

- **StreamResult/AgentStream**: async iterable (`for await`) + thenable (`await`)
- **agentLoop**: async generator — call LLM, yield deltas, execute tools, loop on tool_use
- **Model Router**: per-turn model switching (vision/plan-execute/hybrid) in `core/model-router.ts`
- **OAuth-only auth**: PKCE flows, tokens in `~/.gg/auth.json` — no raw API keys
- **Zod schemas**: tool params defined with Zod, converted to JSON Schema at provider boundary
- **Debug log**: `~/.gg/debug.log` — singleton logger in `core/logger.ts`

## Publishing

Publish in dependency order with `pnpm publish`:

```bash
pnpm build
pnpm --filter @abukhaled/gg-ai publish --no-git-checks
pnpm --filter @abukhaled/gg-agent publish --no-git-checks
pnpm --filter @abukhaled/ogcoder publish --no-git-checks
```

## Slash Commands

- **UI-handled** (`App.tsx`): `/model`, `/compact`, `/quit`, `/clear` — direct React state
- **Registry** (`core/slash-commands.ts`): `/help`, `/settings`, `/session`, `/new`, `/router`
