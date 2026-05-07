# Nuclear Commit

Wipe all git history and republish the working tree as a single commit on a brand-new GitHub repo, under a freshly chosen identity. Old author, old SHAs, old PR refs, forks of the old repo — none of them can resolve to the new repo. One shot, no remnants.

## Usage
```
/nuclear-commit
```

> ⚠️ **Destructive and irreversible.** This deletes the existing GitHub repo and rewrites all local git history. There is no undo.

---

## HARD RULE — Repo / account / identity non-contamination

This command **MUST NOT** execute any destructive or remote-mutating step until the following are explicitly confirmed by the user in this turn (or in a prior turn of the same session, with no ambiguity):

1. **Local path** — exactly which working directory is being nuked (`pwd`).
2. **Target GitHub account** — which `gh` account owns the new repo (`riazmohamed`, `riaztmc`, `rinaztecinfo`, or other). A prior `gh auth switch` is **not** sufficient permission to act under that account — the user must name it for *this* operation.
3. **New repo name + visibility** — `owner/name` and public/private.
4. **Old repo to delete** — full `owner/name` of the GitHub repo to delete. If there is no old remote, confirm "no old repo to delete".
5. **Commit identity** — `git user.name` and `user.email` to use for the single new commit. Must match the target account's identity convention (see `/identify-github` mapping).
6. **Single-commit message** — what the one commit should say.

If **any** of the above is unconfirmed, ambiguous, or inferred, **STOP** and ask. Do not proceed on assumptions. Do not auto-pick based on `gh auth status` or current `git config` — those describe state, not intent.

If the active `gh` account, `git config user.email`, the remote URL owner, and the user's stated target account do not all agree, **STOP** and surface the mismatch before doing anything destructive.

---

## Phase 1 — Discover & confirm (read-only)

Run in parallel:

```bash
pwd
gh auth status 2>&1
git config user.name 2>/dev/null; git config user.email 2>/dev/null
git remote -v 2>/dev/null
git rev-parse --is-inside-work-tree 2>/dev/null
git log --oneline -5 2>/dev/null
ls -la
```

Then present a confirmation block to the user in **this exact form** and wait for explicit "yes, proceed" before continuing:

```
☢️  NUCLEAR COMMIT — confirm before execution

📂 Local path:        <pwd>
🗑️  Old GitHub repo:   <owner/name>  (will be DELETED)
🆕 New GitHub repo:   <owner/name>   (<public|private>)
👤 GitHub account:    <gh account to use>     (currently active: <active>)
✍️  Commit identity:   <name> <<email>>
💬 Commit message:    "<message>"

This will:
  1. rm -rf .git  (destroy all local history)
  2. git init + single commit under the new identity
  3. gh repo delete <old>     ← irreversible
  4. gh repo create <new>     ← under <account>
  5. git push -u origin main

Reply "yes, nuke it" to proceed. Anything else aborts.
```

Do **not** continue past this point without that exact-intent confirmation.

---

## Phase 2 — Pre-flight (still reversible)

After confirmation:

1. **Switch gh account if needed:**
   ```bash
   gh auth switch --user <target-account>
   gh auth status
   ```
   Verify active account now equals the target.

2. **Sanity check working tree is what the user wants published:**
   ```bash
   git status --short 2>/dev/null || echo "(no git repo yet)"
   ```
   If there are uncommitted changes the user did not mention, **STOP** and confirm they should be included in the single commit.

3. **Confirm the old repo exists and is the one named:**
   ```bash
   gh repo view <old-owner/old-name> --json name,owner,url
   ```

---

## Phase 3 — Nuke & republish (destructive, in order)

Run sequentially. Stop on any failure and report — do not attempt cleanup with destructive commands.

```bash
# 1. Wipe all local history
rm -rf .git

# 2. Fresh repo with new identity
git init -b main
git config user.name  "<new name>"
git config user.email "<new email>"

# 3. Stage everything currently in the working tree
git add -A

# 4. Single commit
git commit -m "<message>"

# 5. Delete the old GitHub repo (irreversible)
gh repo delete <old-owner/old-name> --yes

# 6. Create the new repo under the target account
gh repo create <new-owner/new-name> --<public|private> --source=. --remote=origin --push
```

If `gh repo create --push` is not used, fall back to:
```bash
git remote add origin git@<host>:<new-owner>/<new-name>.git
git push -u origin main
```

Use the correct SSH host alias for the target account if the user has per-account aliases configured (`github.com`, `github.com-work`, `github.com-ai`).

---

## Phase 4 — Verify

```bash
gh repo view <new-owner/new-name> --json url,owner,defaultBranchRef
git log --oneline
git remote -v
```

Output a tight summary:
```
✅ Nuked.
   Old:  <old-owner/old-name>  (deleted)
   New:  <new-owner/new-name>  → <url>
   Commits: 1   Author: <name> <<email>>
```

---

## Refusal conditions

Refuse to proceed (and say why) if any of these hold:

- The user has not explicitly named the target account for *this* operation.
- The active `gh` account does not match the named target and the user has not authorized switching.
- The old repo owner and the new repo owner are different accounts and the user has not explicitly acknowledged that.
- `pwd` is `$HOME`, `/`, or any path that doesn't look like a project directory.
- The working tree contains files that look unintended (e.g., `.env` with secrets, large unexpected binaries) — surface them and reconfirm.
- `gh auth status` shows the target account is not logged in.

When refusing, state which condition tripped and what the user needs to confirm or fix to proceed.
