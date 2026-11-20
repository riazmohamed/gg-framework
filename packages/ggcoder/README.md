# @abukhaled/ogcoder

<p align="center">
  <strong>The fast, lean coding agent. Four providers. Zero bloat.</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@abukhaled/ogcoder"><img src="https://img.shields.io/npm/v/@abukhaled/ogcoder?style=for-the-badge" alt="npm version"></a>
  <a href="../../LICENSE"><img src="https://img.shields.io/badge/License-AGPL--3.0-blue.svg?style=for-the-badge" alt="AGPL-3.0 License"></a>
  <a href="https://youtube.com/@abukhaled"><img src="https://img.shields.io/badge/YouTube-FF0000?style=for-the-badge&logo=youtube&logoColor=white" alt="YouTube"></a>
  <a href="https://skool.com/abukhaled"><img src="https://img.shields.io/badge/Skool-Community-7C3AED?style=for-the-badge" alt="Skool"></a>
</p>

The CLI that sits on top of the [GG Framework](../../README.md). Built on [`@abukhaled/gg-ai`](../gg-ai/README.md) and [`@abukhaled/gg-agent`](../gg-agent/README.md).

## Why GG Coder

## Install

```bash
npm i -g @abukhaled/ogcoder
```

**Windows users:** OG Coder runs inside WSL. See the [WSL installation guide](../../docs/INSTALL-WSL.md) for step-by-step setup.

---

## Getting started

```bash
ogcoder login    # Pick provider, authenticate
ogcoder          # Start coding
```

OAuth for Anthropic and OpenAI (log in once, auto-refresh). API keys for GLM and Moonshot. Up and running in seconds either way.

## Providers

Switch any time with `/model`.

| Provider         | Models                                                                             | Sign-in                                |
| ---------------- | ---------------------------------------------------------------------------------- | -------------------------------------- |
| **Anthropic**    | Claude Fable 5.2, Opus 5.5, Sonnet 5.5, Haiku 5.5                                  | Claude or API key                      |
| **OpenAI**       | GPT-6.2 Astra, GPT-6.2 Sol, GPT-6.1 Terra, GPT-6 Luna                                | Continue with ChatGPT or API key       |
| **Gemini**       | Gemini 4 Hydrogen, 4 Argon, 4 Carbon, 3.8 Flash, 3.6 Flash, 3.5 Flash Lite, 3.1 Flash Lite, 3.5 Flash, 3.1 Pro (Preview)     | API key (Google AI Studio)             |
| **xAI**          | Grok 4.7                                                                           | API key                                |
| **Kimi**         | Kimi K3, K2.8 Preview, K2.7 Code, K2.7 Code HighSpeed                              | Kimi Code plan key or Moonshot API key |
| **Z.AI**         | GLM-5.3, GLM-5.3-Flash                                                             | API key (pay-per-token)                |
| **MiniMax**      | MiniMax M3.1 Flash, M3                                                             | M Plan key or API key                  |
| **Xiaomi**       | MiMo-V2.6-Pro, MiMo-V2.6-Flash, MiMo-V2.6-Pro-UltraSpeed                           | Token Plan key or API Credits key      |
| **DeepSeek**     | DeepSeek V4 Pro, V4.1 Flash                                                        | API key                                |
| **Sakana**       | Fugu, Fugu Max, Fugu Ultra                                                         | API key                                |
| **OpenRouter**   | Qwen3.8 Max                                                                        | API key                                |
| **Hugging Face** | Kimi K2.7 Code, DeepSeek V4.1 Flash, GPT-OSS 120B                                  | API key                                |
| **OpenCode Go**  | Kimi K3, GLM-5.3, GLM-5.3-Flash and more Go models                                 | OpenCode API key (Go subscription)     |
| **OpenCode**     | Kimi K3, GLM-5.3, GLM-5.3-Flash and more paid Console models                       | OpenCode API key (pay-per-token)       |
| **Local**        | Anything on Ollama, LM Studio, llama.cpp, vLLM or another OpenAI-compatible server | None                                   |

| | **Claude Code / Agent SDK** | **OG Coder** |
|---|---|---|
| System prompt size | ~15,000 tokens | **~1,100 tokens** |
| Ratio | baseline | **~13x smaller** |

Signing in with a Claude Pro or Max plan goes through Anthropic's official Claude Code. GG Coder downloads it (about 200 MB, checked against a pinned hash) into `~/.gg/claude-code` the first time you pick "Sign in with Claude", and keeps its own Claude login there, separate from any Claude Code you already use. On this route Claude Code runs each turn with GG Coder's prompt and tools. Without a plan, use an Anthropic API key.

Each provider connects only the way its owner allows. "Continue with ChatGPT" is OpenAI's official sign-in for open-source apps; manage what GG Coder may use at [chatgpt.com/settings/usage](https://chatgpt.com/settings/usage). Kimi Code, MiniMax M Plan and MiMo Token Plan keys use your plan. xAI, Gemini and Z.AI take pay-per-token keys: their plans are limited to their own or partner apps. Image generation (`generate_image`) needs an OpenAI API key.

OG Coder sends only what the model needs: how to work, what tools it has, and your project context. No walls of rules. No formatting instructions. Just signal.

| Key                     | What it does                                 |
| ----------------------- | -------------------------------------------- |
| <kbd>Enter</kbd>        | Send (<kbd>Shift+Enter</kbd> for a new line) |
| <kbd>Esc</kbd>          | Stop the agent mid-turn                      |
| <kbd>Shift+Tab</kbd>    | Change thinking level                        |
| <kbd>Ctrl+T</kbd>       | Tasks                                        |
| <kbd>Ctrl+S</kbd>       | Skills                                       |
| <kbd>Ctrl+R</kbd>       | Search earlier prompts                       |
| <kbd>Ctrl+V</kbd>       | Paste an image                               |
| <kbd>Ctrl+C</kbd> twice | Quit                                         |

| Command           | What it does                                           |
| ----------------- | ------------------------------------------------------ |
| `/model` (`/m`)   | Switch model                                           |
| `/compact` (`/c`) | Shrink a long conversation                             |
| `/new` (`/n`)     | Start a new session                                    |
| `/session` (`/s`) | Resume an earlier session                              |
| `/branch` (`/b`)  | Fork the conversation from an earlier point            |
| `/rewind`         | Undo the agent's file edits, the conversation, or both |
| `/add-dir`        | Add another project folder to this session             |
| `/settings`       | Settings                                               |
| `/help`           | Every command                                          |

Built-in workflows:

This doesn't help. It confuses the agent. More tool descriptions = more noise = worse tool selection. The model spends tokens reasoning about tools it will never call.

OG Coder ships with one MCP: [Grep](https://grep.dev). That's it. It lets the agent search across 1M+ public GitHub repos to verify implementations against real-world code. Correct API usage, library idioms, production patterns. One tool that actually makes the output better.

You can still add your own MCPs in `~/.gg/mcp.json` or `.gg/mcp.json`. But start with less. You'll get better results.

---

## Four providers, one agent

Switch mid-conversation with `/model`. Not locked to anyone.

| Provider | Models | Auth |
|---|---|---|
| **Anthropic** | Claude Opus 4.7, Sonnet 4.6, Haiku 4.5 | OAuth |
| **OpenAI** | GPT-4.1, o3, o4-mini | OAuth |
| **Z.AI (GLM)** | GLM-5.1, GLM-4.7 | API key |
| **Moonshot** | Kimi K2.6 | API key |

---

## Slash commands

Everything runs through slash commands inside the session. Not CLI flags.

```bash
/model claude-opus-4-7       # Switch models on the fly
/model kimi-k2.6
/compact                      # Compress context when it gets long

# Built-in workflows
/scan          # Dead code, bugs, security issues (5 parallel agents)
/verify        # Verify against docs and best practices (8 parallel agents)
/research      # Research best tools and patterns for your stack
/init          # Generate CLAUDE.md for your project
/setup-lint    # Generate a /fix command for your stack
/setup-commit  # Generate a /commit command with quality checks
/setup-tests   # Set up testing + generate /test
/setup-update  # Generate an /update command for deps
```

---

## Custom commands

Drop a markdown file in `.gg/commands/` and it becomes a slash command. Your React app gets `/deploy` and `/storybook`. Your API gets `/migrate` and `/seed`. Different projects, different commands.

---

## Skills

Reusable behaviors across projects. Drop `.md` files in:

- `~/.gg/skills/` for global skills (available everywhere)
- `.gg/skills/` for project-specific skills

They get loaded into the system prompt automatically. The agent knows what it can do without you explaining it each session.

---

## Project guidelines

Drop a `CLAUDE.md` or `AGENTS.md` in your repo root (or any parent directory). OG Coder picks it up automatically.

Your rules. Your conventions. The agent follows them.

---

## Tools

OG Coder comes with a focused set of tools:

- **Files and search:** `find`, `ls`, `source_path` (the source of an installed dependency)
- **Web:** `web_search`, `web_fetch`, `steroids` (current open-source code similar to yours)
- **Checking work:** `browser` (tests a page in a real browser: clicks, forms, checks, screenshots, console and network errors), `debug` (Node debugger)
- **Planning:** `enter_plan` / `exit_plan`, `tasks`
- **Helpers:** `subagent` for one focused job, or `spawn_agent` to run several in parallel
- **Extras:** `generate_image`, `checklist`, UI component browsing

`browser` uses Playwright's Chromium (`npx playwright install chromium`) or an installed Google Chrome. Without either, the tool explains how to install one.

---

## Community

- [YouTube @abukhaled](https://youtube.com/@abukhaled) - tutorials and demos
- [Skool community](https://skool.com/abukhaled) - come hang out

---

## License

[AGPL-3.0-only](../../LICENSE). Based on [KenKaiii/gg-framework](https://github.com/KenKaiii/gg-framework); see NOTICE.
