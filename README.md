# GG Framework

<p align="center">
  <strong>Modular TypeScript framework for building LLM-powered apps. From raw streaming to full coding agent.</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@abukhaled/ogcoder"><img src="https://img.shields.io/npm/v/@abukhaled/ogcoder?style=for-the-badge&label=ogcoder" alt="ogcoder npm version"></a>
  <a href="https://www.npmjs.com/package/@kenkaiiii/gg-boss"><img src="https://img.shields.io/npm/v/@kenkaiiii/gg-boss?style=for-the-badge&label=gg-boss" alt="gg-boss npm version"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge" alt="MIT License"></a>
  <a href="https://youtube.com/@abukhaled"><img src="https://img.shields.io/badge/YouTube-FF0000?style=for-the-badge&logo=youtube&logoColor=white" alt="YouTube"></a>
  <a href="https://skool.com/abukhaled"><img src="https://img.shields.io/badge/Skool-Community-7C3AED?style=for-the-badge" alt="Skool"></a>
</p>

Four packages. Each one works on its own. Stack them together and you get a full coding agent — or an orchestrator that drives many of them at once.

| Package | What it does | README |
|---|---|---|
| [`@abukhaled/gg-ai`](https://www.npmjs.com/package/@abukhaled/gg-ai) | Unified LLM streaming API across four providers | [packages/gg-ai](packages/gg-ai/README.md) |
| [`@abukhaled/gg-agent`](https://www.npmjs.com/package/@abukhaled/gg-agent) | Agent loop with multi-turn tool execution | [packages/gg-agent](packages/gg-agent/README.md) |
| [`@abukhaled/ogcoder`](https://www.npmjs.com/package/@abukhaled/ogcoder) | CLI coding agent with OAuth, tools, and TUI | [packages/ggcoder](packages/ggcoder/README.md) |
| [`@kenkaiiii/gg-boss`](https://www.npmjs.com/package/@kenkaiiii/gg-boss) | Orchestrator that drives many ogcoder workers from one chat | [packages/gg-boss](packages/gg-boss/README.md) |

```
@abukhaled/gg-ai (standalone)
  └─► @abukhaled/gg-agent (depends on gg-ai)
        └─► @abukhaled/ogcoder (depends on both)
              └─► @kenkaiiii/gg-boss (orchestrates many ogcoder workers)
```

---

## Which package do I need?

| You want to... | Use |
|---|---|
| Stream LLM responses across providers with one API | [`@abukhaled/gg-ai`](packages/gg-ai/README.md) |
| Build an agent that calls tools and loops autonomously | [`@abukhaled/gg-agent`](packages/gg-agent/README.md) |
| Use a ready-made CLI coding agent | [`@abukhaled/ogcoder`](packages/ggcoder/README.md) |
| Drive many coding agents across multiple projects from one chat | [`@kenkaiiii/gg-boss`](packages/gg-boss/README.md) |

Each package works on its own. Install only what you need.

```bash
npm i @abukhaled/gg-ai          # Just the streaming layer
npm i @abukhaled/gg-agent       # Streaming + agent loop
npm i -g @abukhaled/ogcoder     # The full CLI coding agent
npm i -g @kenkaiiii/gg-boss     # Multi-project orchestrator
```

**Windows users:** OG Coder runs inside WSL. See the [WSL installation guide](docs/INSTALL-WSL.md) for step-by-step setup.

---

## For developers

```bash
git clone https://github.com/KenKaiii/gg-framework.git
cd gg-framework
pnpm install
pnpm build
```

TypeScript 5.9 + pnpm workspaces + Ink 6 + React 19 + Vitest 4 + Zod v4

---

## Community

- [YouTube @abukhaled](https://youtube.com/@abukhaled) - tutorials and demos
- [Skool community](https://skool.com/abukhaled) - come hang out

---

## License

MIT

---

<p align="center">
  <strong>Less bloat. More coding. Four providers. Four packages. One framework.</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@abukhaled/ogcoder"><img src="https://img.shields.io/badge/Install-npm%20i%20--g%20%40abukhaled%2Fogcoder-blue?style=for-the-badge" alt="Install ogcoder"></a>
  <a href="https://www.npmjs.com/package/@kenkaiiii/gg-boss"><img src="https://img.shields.io/badge/Orchestrate-npm%20i%20--g%20%40kenkaiiii%2Fgg--boss-7C3AED?style=for-the-badge" alt="Install gg-boss"></a>
</p>
