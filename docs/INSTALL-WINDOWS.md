# Installing OG Coder on Windows (Native)

OG Coder can run natively on Windows without WSL. It uses Git Bash under the hood for shell command execution.

---

## Prerequisites

- Windows 10 (version 1809+) or Windows 11
- Admin access to install software

---

## Step 1: Install Git for Windows

Download and install from [gitforwindows.org](https://gitforwindows.org/).

Use the default install location (`C:\Program Files\Git`). OG Coder auto-detects Git Bash from standard paths.

If you install to a custom location, set the environment variable:

```powershell
# PowerShell — add to your profile for persistence
$env:GG_GIT_BASH_PATH = "C:\your\custom\path\Git\bin\bash.exe"
```

```cmd
:: CMD — set permanently via System Properties > Environment Variables
set GG_GIT_BASH_PATH=C:\your\custom\path\Git\bin\bash.exe
```

Verify Git Bash is working:

```powershell
& "C:\Program Files\Git\bin\bash.exe" -c "echo hello"
# Should print: hello
```

---

## Step 2: Install Node.js

Download and install from [nodejs.org](https://nodejs.org/) (LTS recommended).

Verify:

```powershell
node -v   # Should print v22.x.x or newer
npm -v    # Should print 10.x.x or newer
```

---

## Step 3: Install OG Coder

```powershell
npm install -g @abukhaled/ogcoder
```

Verify:

```powershell
ogcoder --version
```

---

## Step 4: Log in

```powershell
ogcoder login
```

Pick your provider (Anthropic, OpenAI, GLM, Moonshot, Xiaomi) and follow the prompts.

---

## Step 5: Start coding

```powershell
cd C:\Users\YourName\path\to\your\project
ogcoder
```

---

## Installing from source (for developers)

```powershell
# Install pnpm
npm install -g pnpm

# Clone the repo
git clone https://github.com/abukhaled/gg-framework.git
cd gg-framework

# Install dependencies and build
pnpm install
pnpm build

# Link globally
cd packages\ggcoder
npm link
```

After linking, `ogcoder` is available globally from any terminal.

To rebuild after pulling changes:

```powershell
cd C:\path\to\gg-framework
pnpm build
```

No need to re-link — the symlink points to the built dist folder.

---

## How it works

OG Coder detects Windows and uses **Git Bash** (`bash.exe` from Git for Windows) for all shell command execution. This means:

- All commands run through bash, same as on macOS/Linux
- Standard Unix commands (`ls`, `grep`, `cat`, `git`, etc.) work out of the box
- No PowerShell command translation issues
- Process cleanup uses `taskkill` instead of Unix signals

The shell is resolved in this order:

1. `GG_GIT_BASH_PATH` environment variable (if set)
2. `C:\Program Files\Git\bin\bash.exe`
3. `C:\Program Files (x86)\Git\bin\bash.exe`
4. `C:\Git\bin\bash.exe`

---

## Known limitations

- **Clipboard image paste**: Not supported on Windows (macOS only). You can still attach images by file path.
- **Sound notifications**: Not available on Windows. The agent completes silently.
- **Reduced motion**: Animations are automatically reduced on Windows to prevent terminal scroll-jumping. Override with `REDUCE_MOTION=0` if your terminal handles it well.

---

## Troubleshooting

### `Git Bash not found` error

OG Coder couldn't find `bash.exe`. Either:

1. Install Git for Windows from [gitforwindows.org](https://gitforwindows.org/)
2. Or set `GG_GIT_BASH_PATH` to your `bash.exe` location

### `ogcoder: command not found`

Make sure Node.js bin directory is in your PATH. After `npm install -g`, npm prints the install location. Verify it's in your PATH:

```powershell
npm config get prefix
# Add the output path + \bin to your system PATH if missing
```

### OAuth login doesn't open the browser

If the browser doesn't open automatically, copy the URL from the terminal and paste it into your browser manually.

### Terminal display issues

OG Coder works best with **Windows Terminal** (default on Windows 11, available from the Microsoft Store on Windows 10). The legacy CMD and PowerShell consoles may have rendering quirks.

### Scrolling issues

If the terminal keeps jumping to the bottom while the agent is running, this is handled automatically by reduced motion mode. If you've disabled it (`REDUCE_MOTION=0`), re-enable it or use Windows Terminal which handles this better.
