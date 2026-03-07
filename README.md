# GG Coder

<p align="center">
  <strong>The fast, lean coding agent. Four providers. Zero bloat.</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@kenkaiiii/ggcoder"><img src="https://img.shields.io/npm/v/@kenkaiiii/ggcoder?style=for-the-badge" alt="npm version"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge" alt="MIT License"></a>
  <a href="https://youtube.com/@kenkaidoesai"><img src="https://img.shields.io/badge/YouTube-FF0000?style=for-the-badge&logo=youtube&logoColor=white" alt="YouTube"></a>
  <a href="https://skool.com/kenkai"><img src="https://img.shields.io/badge/Skool-Community-7C3AED?style=for-the-badge" alt="Skool"></a>
</p>

I built GG Coder because I got tired of waiting.

Claude Code is great. I use it daily. But after spending enough time with it, you start to notice how much overhead it carries. Every single request ships with a massive system prompt, roughly ~15,000 tokens of instructions that the model re-reads on every turn. The Claude Agent SDK has the same issue since it's essentially Claude Code under the hood.

So I asked myself: what if we just... didn't do that?

---

## The system prompt problem

This is the thing nobody talks about. Every token in the system prompt gets processed on **every single turn**. It's not a one-time cost. It's a tax on every request you make.

| | **Claude Code / Agent SDK** | **GG Coder** |
|---|---|---|
| System prompt size | ~15,000 tokens | **~1,100 tokens** |
| Ratio | baseline | **~13x smaller** |

### Why you should care

**It's slower.** More input tokens means longer time-to-first-token. You're sitting there waiting for the model to process instructions it already knows. Every turn. Every request. In a 30-turn coding session, that wait time adds up to minutes of your life you're not getting back.

**The model follows instructions worse.** This one's counterintuitive but well-documented. The more stuff you cram into a system prompt, the worse the model follows any single instruction. Researchers call it "lost in the middle." Models pay attention to the start and end of their context, and everything in between gets fuzzy. A 15,000 token system prompt is a wall of rules competing for attention. A 1,100 token prompt is focused and clear. The model actually reads it.

**You hit context limits way sooner.** That ~15,000 tokens of system prompt lives in your context window permanently. On a 200K context model, you've burned ~7.5% before you've even said hello. In a long session with file reads, tool calls, and back-and-forth, that overhead compounds. You hit compaction earlier, lose conversation history faster, and the agent forgets what it was doing mid-task.

**It costs more.** Input tokens aren't free. Even with prompt caching, you pay for the bloat on every cache miss. And cache misses happen more than you'd think (new files read, tool results change, context shifts). Smaller prompt = smaller bill. Simple math.

GG Coder keeps only what the model actually needs: how to approach work, what tools are available, and your project's context. That's it. No walls of edge-case rules. No formatting instructions the model ignores anyway. Just the stuff that matters.

---

## Four providers, one agent

Most coding agents lock you into one provider. GG Coder doesn't. You pick what works and switch mid-conversation with a slash command.

| Provider | Models | Auth |
|---|---|---|
| **Anthropic** | Claude Opus 4.6, Sonnet 4.6, Haiku 4.5 | OAuth |
| **OpenAI** | GPT-4.1, o3, o4-mini | OAuth |
| **Z.AI (GLM)** | GLM-5, GLM-4.7 | API key |
| **Moonshot** | Kimi K2.5 | API key |

Anthropic and OpenAI use OAuth. Log in once, tokens refresh on their own. GLM and Moonshot take API keys. Either way you're up and running in seconds.

---

## Slash commands and custom workflows

GG Coder runs on slash commands, not CLI flags. Everything happens inside the session.

```bash
# Switch models on the fly
/model claude-opus-4-6
/model kimi-k2.5

# Compact context when things get long
/compact

# Built-in workflows
/scan          # Find dead code, bugs, security issues (spawns 5 parallel agents)
/verify        # Verify code against docs and best practices (8 parallel agents)
/research      # Research best tools and patterns for your project
/init          # Generate or update CLAUDE.md for your project
/setup-lint    # Generate a /fix command tailored to your stack
/setup-commit  # Generate a /commit command with quality checks
/setup-tests   # Set up testing infrastructure and generate /test
/setup-update  # Generate an /update command for dependency management
```

### Custom commands per project

This is where it gets fun. Drop a markdown file in `.gg/commands/` and it becomes a slash command. Frontmatter sets the name, the body becomes the prompt.

```markdown
---
name: deploy
description: Build, test, and deploy to production
---

1. Run the test suite
2. Build for production
3. Deploy using the project's deploy script
4. Verify the deployment is healthy
```

Now `/deploy` works in that project. Different projects get different commands. Your React app might have `/deploy` and `/storybook`. Your API might have `/migrate` and `/seed`. The agent adapts to how you actually work.

### Skills

Same concept but for reusable behaviors across projects. Drop `.md` files in `~/.gg/skills/` (global) or `.gg/skills/` (per-project) and they get loaded into the system prompt. The agent just knows what it can do without you having to explain it every time.

### Project guidelines with CLAUDE.md and AGENTS.md

Want the agent to follow specific rules for your project? Drop a `CLAUDE.md` or `AGENTS.md` in your repo root (or any parent directory) and GG Coder picks it up automatically. Things like "always use pnpm", "run tests before committing", "never modify the database schema directly". Your rules, your project, the agent follows them.

---

## Getting started

```bash
npm i -g @kenkaiiii/ggcoder
```

1. Run `ggcoder login`
2. Pick your provider
3. Authenticate
4. Start coding with `ggcoder`

That's it.

---

## Usage

```bash
# Interactive mode
ggcoder

# Pass a prompt directly
ggcoder "fix the failing tests in src/utils"

# Start with a different provider
ggcoder -p moonshot
```

Everything else happens inside the session. Type `/help` to see what's available.

---

## The packages

The whole stack is open source and composable. Three npm packages, each usable on its own.

| Package | What it does |
|---|---|
| [`@kenkaiiii/gg-ai`](https://www.npmjs.com/package/@kenkaiiii/gg-ai) | Unified streaming API across all four providers. One interface, differences handled internally. |
| [`@kenkaiiii/gg-agent`](https://www.npmjs.com/package/@kenkaiiii/gg-agent) | Agent loop with multi-turn tool execution, Zod-validated parameters, error recovery. |
| [`@kenkaiiii/ggcoder`](https://www.npmjs.com/package/@kenkaiiii/ggcoder) | The full CLI. Tools, sessions, UI, OAuth, everything. |

### Quick example: streaming API

```typescript
import { stream } from "@kenkaiiii/gg-ai";

for await (const event of stream({
  provider: "anthropic",
  model: "claude-sonnet-4-6",
  messages: [{ role: "user", content: "Hello!" }],
})) {
  if (event.type === "text_delta") process.stdout.write(event.text);
}
```

### Quick example: agent loop

```typescript
import { Agent } from "@kenkaiiii/gg-agent";
import { z } from "zod";

const agent = new Agent({
  provider: "moonshot",
  model: "kimi-k2.5",
  system: "You are a helpful assistant.",
  tools: [{
    name: "get_weather",
    description: "Get the weather for a city",
    parameters: z.object({ city: z.string() }),
    async execute({ city }) {
      return { temperature: 72, condition: "sunny" };
    },
  }],
});

for await (const event of agent.prompt("What's the weather in Tokyo?")) {
  // text_delta, tool_call_start, tool_call_end, agent_done, etc.
}
```

---

## For developers

```bash
git clone https://github.com/KenKaiii/gg-framework.git
cd gg-framework
pnpm install
pnpm build
```

Stack: TypeScript 5.9 + pnpm workspaces + Ink 6 + React 19 + Vitest 4 + Zod v4

---

## Community

- [YouTube @kenkaidoesai](https://youtube.com/@kenkaidoesai) - tutorials and demos
- [Skool community](https://skool.com/kenkai) - come hang out

---

## License

MIT

---

<p align="center">
  <strong>Less bloat. More coding. Four providers. One agent.</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@kenkaiiii/ggcoder"><img src="https://img.shields.io/badge/Install-npm%20i%20--g%20%40kenkaiiii%2Fggcoder-blue?style=for-the-badge" alt="Install"></a>
</p>
