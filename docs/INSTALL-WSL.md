# Installing OG Coder on Windows (WSL)

OG Coder runs inside WSL (Windows Subsystem for Linux). This guide walks you through setting up WSL and installing OG Coder from scratch.

---

## Prerequisites

- Windows 10 (version 2004+) or Windows 11
- Admin access to install WSL

---

## Step 1: Install WSL

Open **PowerShell as Administrator** and run:

```powershell
wsl --install
```

This installs WSL 2 with Ubuntu. Restart your computer when prompted.

After restart, open the **Ubuntu** app from the Start menu. It will ask you to create a username and password.

---

## Step 2: Install Node.js via nvm

Inside the WSL terminal:

```bash
# Install nvm (Node Version Manager)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash

# Load nvm into your current shell
source ~/.bashrc

# Install Node.js 22 LTS (recommended — Node 24 has known issues with pnpm on WSL)
nvm install 22
nvm alias default 22
```

Verify the installation:

```bash
node -v   # Should print v22.x.x
npm -v    # Should print 10.x.x
```

---

## Step 3: Install OG Coder

```bash
npm install -g @abukhaled/ogcoder
```

Verify it works:

```bash
ogcoder --version
```

---

## Step 4: Log in

```bash
ogcoder login
```

Pick your provider (Anthropic, OpenAI, GLM, Moonshot, Xiaomi) and follow the prompts.

---

## Step 5: Start coding

```bash
cd /mnt/c/Users/YourName/path/to/your/project
ogcoder
```

> **Tip:** Your Windows files are accessible under `/mnt/c/` inside WSL. Navigate to your project directory there.

---

## Installing from source (for developers)

If you want to run the latest unreleased version from the repository:

```bash
# Install pnpm
npm install -g pnpm

# Clone the repo into your WSL home directory (NOT under /mnt/c — see note below)
cd ~
git clone https://github.com/abukhaled/gg-framework.git
cd gg-framework

# Install dependencies and build
pnpm install
pnpm build

# Pack and install globally
pnpm --filter @abukhaled/gg-ai pack --pack-destination /tmp/ogcoder-install/
pnpm --filter @abukhaled/gg-agent pack --pack-destination /tmp/ogcoder-install/
pnpm --filter @abukhaled/ogcoder pack --pack-destination /tmp/ogcoder-install/

# Install all three packages globally from the tarballs
npm install -g /tmp/ogcoder-install/abukhaled-gg-ai-*.tgz \
              /tmp/ogcoder-install/abukhaled-gg-agent-*.tgz \
              /tmp/ogcoder-install/abukhaled-ogcoder-*.tgz

# Clean up
rm -rf /tmp/ogcoder-install
```

---

## Important: WSL filesystem performance

**Do NOT clone or install packages under `/mnt/c/` (the Windows filesystem).** File I/O on the Windows mount is extremely slow from WSL and will cause multi-minute startup times.

Instead:

- Clone repos to your WSL home directory (`~/`)
- Let npm install packages to the default location (`~/.nvm/versions/node/...`)
- Only use `/mnt/c/` to navigate to your project files when running `ogcoder`

If you already installed globally from a `/mnt/c/` path and startup is slow, fix it:

```bash
# Uninstall the slow symlinked version
npm uninstall -g @abukhaled/ogcoder

# Reinstall from npm (installs to native Linux filesystem)
npm install -g @abukhaled/ogcoder
```

---

## Troubleshooting

### `ogcoder: command not found`

nvm needs to be loaded in each shell session. Add this to your `~/.bashrc` if it isn't already there:

```bash
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
```

Then restart your terminal or run `source ~/.bashrc`.

### `pnpm install` crashes with out-of-memory error

Use Node.js 22 LTS instead of Node 24:

```bash
nvm install 22
nvm alias default 22
```

### Startup takes minutes

You likely have a symlink pointing to `/mnt/c/`. See the [filesystem performance](#important-wsl-filesystem-performance) section above.

### OAuth login doesn't open the browser

WSL may not be able to open a Windows browser automatically. Copy the URL from the terminal and paste it into your browser manually.
