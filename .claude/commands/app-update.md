Perform a full branch sync with main, rebuild, update docs, and push.

## Steps

Execute the following steps in order, stopping and reporting any errors:

### 1. Capture current branch
```bash
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
echo "Current branch: $CURRENT_BRANCH"
```

### 2. Switch to main and pull latest
```bash
git checkout main
git pull origin main
```

### 3. Switch back to the original branch
```bash
git checkout "$CURRENT_BRANCH"
```

### 4. Merge main into current branch (preserving extra features)
Run a merge from main, using `ours` strategy for any conflict where the current branch's feature should win:
```bash
git merge main --no-edit
```

If there are merge conflicts, resolve them as follows:
- Read each conflicted file carefully
- Preserve all code, features, and logic from the current branch (`$CURRENT_BRANCH`) that does not exist in main
- Accept changes from main where they don't conflict with current-branch-specific work
- After resolving, stage resolved files with `git add <file>` and run `git merge --continue`
- Never lose current-branch features — when in doubt, keep both and merge them manually

### 5. Rebuild globally
Detect and run the appropriate global install command based on what's present in the repo:

- If `package.json` has a `build` script → run `npm run build` first
- If the project uses npm → `npm install -g .`
- If the project uses yarn → `yarn global add file:.`
- If the project uses pnpm → `pnpm install -g .`
- If there is a `Makefile` with an `install` target → `make install`
- If there is a `setup.py` or `pyproject.toml` → `pip install -e . --upgrade`
- If none of the above apply, report what you found and ask the user how to rebuild

### 6. Update CLAUDE.md
Update the project's `CLAUDE.md` (or create it if missing) to reflect:
- The current date of this update (use today's date)
- Any new commands, scripts, or dependencies that were added since the last update
- Any architecture or workflow changes visible from the merge

Keep existing content — only append or revise sections that are outdated or incomplete.

### 7. Stage and commit the CLAUDE.md update (if changed)
```bash
git add CLAUDE.md
git diff --cached --quiet || git commit -m "docs: update CLAUDE.md after app-update sync"
```

### 8. Push to remote
```bash
git push origin "$CURRENT_BRANCH"
```

### 9. Report summary
Print a summary:
- Branch synced from main
- Conflicts resolved (list files if any)
- Rebuild result
- CLAUDE.md updated (yes/no)
- Push status
