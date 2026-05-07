# Identify GitHub

Shows the currently active GitHub account (via `gh`), the current working directory, and recommends which account to switch to based on folder-to-identity mapping.

## Usage
```
/identify-github
```

## Folder → Identity Mapping

| Folder (prefix match) | Expected GitHub account | Git email |
|---|---|---|
| `~/Desktop/projects/tmc-work/` | `riaztmc` | `riaz.mohamed@tmc.co.uk` |
| `~/Desktop/projects/abukhaleddoe_ai/` | `rinaztecinfo` | `info.rinaztec@gmail.com` |
| anything else under `~/Desktop/projects/` | `riazmohamed` | `railsdevriaz@gmail.com` |

## Instructions

Perform these steps and output a single concise report. Do NOT create files.

### 1. Gather state

Run in parallel:

```bash
pwd
gh auth status 2>&1
git config user.name 2>/dev/null; git config user.email 2>/dev/null; git remote -v 2>/dev/null
```

### 2. Determine expected account from CWD

Match the current working directory against the folder mapping above (longest prefix wins):

- If CWD starts with `~/Desktop/projects/tmc-work/` (or equals it) → **expected = `riaztmc`**
- Else if CWD starts with `~/Desktop/projects/abukhaleddoe_ai/` → **expected = `rinaztecinfo`**
- Else if CWD is under `~/Desktop/projects/` → **expected = `riazmohamed`**
- Else → **expected = unknown** (outside the managed projects root)

### 3. Parse `gh auth status`

Identify the **active** account (the one marked `Active account: true`). Also list all other logged-in accounts.

### 4. Output — print exactly this format

```
🔍 GitHub Identity Check

📂 Folder:        <cwd>
🎯 Expected:      <expected account> (<expected email>)
🟢 gh active:     <active gh account>
✍️  Git commits:   <git user.name> <<git user.email>>
🔗 Remote:        <first remote url or "no git remote">

<status line — one of:>
✅ All aligned — you're good to push.
⚠️  Mismatch: gh is <active>, but this folder expects <expected>.
    → Run:  gh auth switch --user <expected>

⚠️  Git email mismatch for this folder.
    → Expected: <expected email>
    → Actual:   <actual email>
    → (Usually auto-fixes via ~/.gitconfig includeIf; if not, check ~/.gitconfig)

⚠️  Remote uses wrong SSH host alias for this folder.
    → Current: <current host>
    → Expected host alias: github.com-work  (for tmc-work)
                           github.com-ai    (for abukhaleddoe_ai)
                           github.com       (for personal)
    → Fix:  git remote set-url origin git@<expected-host>:<owner>/<repo>.git
```

### 5. Checks to run

For each issue, emit the matching warning block above. If zero issues, emit only the ✅ line.

- **gh mismatch**: `active gh account` != `expected`.
- **git email mismatch**: inside a git repo, `git config user.email` != `expected email`.
- **remote host mismatch**: inside a git repo, `git remote get-url origin` doesn't use the expected host alias:
  - `tmc-work/` → should be `git@github.com-work:...`
  - `abukhaleddoe_ai/` → should be `git@github.com-ai:...`
  - personal → `https://github.com/...` OR `git@github.com:...` both OK

### 6. Keep output tight

Max ~15 lines of output. No explanations unless there's a mismatch — then include the exact fix command.
