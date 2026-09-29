---
"@kenkaiiii/gg-ai": minor
"@kenkaiiii/gg-core": minor
"@kenkaiiii/ggcoder": minor
---

Replace GPT-6 Sol with GPT-6.1 Sol (`gpt-6.1-sol`, released 2026-09-29). It keeps Sol's shape — 1.05M context on the public Responses API, 272K on the ChatGPT OAuth/Codex route, 128K output, text+image input, $2/$10 per MTok (cached input $0.10) — but now starts at `low` effort, matching OpenAI's Codex catalog. It runs the full ladder up to `ultra`, where it gets the proactive async-subagent orchestration prompt.

GPT-6.1 Sol is the new OpenAI default (registry, CLI, benchmarks), and GPT-6 Luna stays the fast subagent model. The login hub, footer names, README, and the "not in catalog" error hint now say GPT-6.1 Sol. `gpt-6-sol` is retired: a saved session still on it falls back to the provider default on next start. GPT-6 ids with a point release (`gpt-6.1-*`) now get the Codex responses-lite transport and the six-rung effort ladder; a bare `gpt-6-` prefix check would have missed them.
