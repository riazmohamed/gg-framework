# @abukhaled/gg-core

<p align="center">
  <strong>Model registry, auth storage and local-model discovery. No UI, no agent loop.</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@abukhaled/gg-core"><img src="https://img.shields.io/npm/v/@abukhaled/gg-core?style=for-the-badge" alt="npm version"></a>
  <a href="../../LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge" alt="MIT License"></a>
</p>

The shared foundation under OG Coder's app and CLI. It depends only on [`@abukhaled/gg-ai`](../gg-ai/README.md), never on React, Ink or the agent loop.

Part of the [GG Framework](../../README.md) monorepo.

---

## Install

```bash
npm i @abukhaled/gg-core
```

---

## What's inside

| Area | Main exports |
|---|---|
| Model registry | `getModel`, `getAllModels`, `getModelsForProvider`, `getDefaultModel`, `getContextWindow` |
| Thinking levels | `getSupportedThinkingLevels`, `getMaxThinkingLevel`, `getDefaultThinkingLevel` |
| Auth storage | `AuthStorage` (reads and writes `~/.gg/auth.json`, refreshes OAuth tokens) |
| OAuth | Anthropic, OpenAI, Gemini, Kimi and xAI login flows |
| Local models | `discoverLocalModels` (Ollama, LM Studio, llama.cpp, vLLM, custom endpoints) |
| Paths | `getAppPaths` (every file under `~/.gg/`) |
| Other | Logger, file lock, usage limits, Telegram, voice transcription, auto-update |

Two lighter subpath entries skip the rest of the package:

```ts
import { getModel } from "@abukhaled/gg-core/models";
import { getAppPaths } from "@abukhaled/gg-core/paths";
```

---

## Example

```ts
import { AuthStorage, discoverLocalModels, getModel } from "@abukhaled/gg-core";

const model = getModel("claude-sonnet-5-5");
console.log(model?.contextWindow);

const auth = new AuthStorage();
const token = await auth.resolveToken("anthropic");

const { models } = await discoverLocalModels();
console.log(models.map((m) => m.id));
```

`AuthStorage` throws `NotLoggedInError` when a provider has no stored credentials.

---

## License

MIT
