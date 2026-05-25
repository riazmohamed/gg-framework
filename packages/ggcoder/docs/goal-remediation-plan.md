# /goal Remediation Plan

Date: 2026-05-23  
Scope: remediation planning for findings `GQA-001` through `GQA-018` from `packages/ggcoder/docs/goal-quality-audit.md`. This artifact is documentation-only: no implementation changes are made here.

## Current status

This plan is retained as the source-backed remediation ledger. The current implementation has already addressed the P0/P1 production-readiness gaps identified below except for the deliberately deferred hard first-tool-call coordinator enforcement (GQA-002). Keep this file as the implementation-order record, and use `goal-remediation-report.md` for the current completion status and residual risks.

## Planning principles

- Preserve the core `/goal` invariant: a run can pass only after durable task state, required evidence, verifier result, and final audit all agree with the original objective.
- Prioritize false-positive completion risks before polish, because they can incorrectly mark goals as done.
- Prefer local/free, deterministic verification paths: unit tests for pure gates, integration tests with temporary `GG_GOALS_BASE`, and process-lifecycle tests with short-lived child processes.
- Keep changes narrowly scoped and backwards-compatible where possible; introduce warnings or draft/blocked state before hard-breaking existing minimal calls.

## Priority legend

- **P0:** Can incorrectly complete, lose state, or keep mutating after an explicit stop/pause.
- **P1:** Reliability/control-loop gaps that can hang, race, or produce stale orchestration decisions.
- **P2:** Consistency, observability, or bounded-safety improvements.
- **P3:** Low-risk polish or documentation-only gaps.

## Remediation matrix

| ID | Decision | Risk priority | Dependencies | Implementation files | Required tests / proof |
| --- | --- | --- | --- | --- | --- |
| GQA-001 | **Fix**: add setup-quality enforcement for new/updated runs. Start with a compatibility-safe `draft` or blocked/warning path for missing success criteria plus proof plan/verifier, then tighten if callers are updated. | P1 | None; should land before E2E gate work so setup expectations are explicit. | `packages/ggcoder/src/tools/goals.ts`, `packages/ggcoder/src/core/goal-store.ts` if new metadata is needed, `packages/ggcoder/src/system-prompt.ts` for aligned wording, possibly `packages/ggcoder/src/ui/components/GoalOverlay.tsx` for draft display. | `packages/ggcoder/src/tools/goals.test.ts`: minimal create records draft/blocked-or-warning and rich create remains ready. `packages/ggcoder/src/core/goal-controller.test.ts`: draft/minimal runs cannot complete and create verifier/evidence tasks predictably. |
| GQA-002 | **Defer with guardrail test**: do not build a complex first-tool-call enforcer immediately; add fresh-state preflight or test coverage when coordinator single-flight is touched. | P3 | Related to GQA-013 single-flight/event orchestration. | Preferred future files: `packages/ggcoder/src/ui/App.tsx`, `packages/ggcoder/src/ui/goal-events.ts`; optional goal-mode guard in tool layer if a first-call tracker is introduced. | `packages/ggcoder/src/ui/goal-lifecycle-orchestration.test.ts` or a focused event test proving synthetic-event continuation reloads durable state before acting. Add a negative stale-snapshot fixture if enforcement is implemented. |
| GQA-003 | **Fix first**: replace fuzzy evidence-plan satisfaction with explicit/strong matching. Require explicit `evidence_plan` ready/evidence, exact path equality, exact command equality, or high-signal evidence references; remove generic substring satisfaction for short labels/descriptions. | P0 | None. This is the highest-risk false-positive completion gate. | `packages/ggcoder/src/core/goal-controller.ts`; potentially `packages/ggcoder/src/tools/goals.ts` to make evidence-plan updates easier/stricter; docs/prompts in `packages/ggcoder/src/system-prompt.ts` and `goal-worker.ts` only if wording needs alignment. | `packages/ggcoder/src/core/goal-controller.test.ts`: generic label like `UI` must not satisfy unrelated evidence; exact path/command and explicit ready/evidence must satisfy; `canCompleteGoalRun` remains blocked until required item is concretely proven. |
| GQA-004 | **Fix**: enforce a concrete final audit contract for pass audits. Passing audit summaries must start with `FINAL_AUDIT_PASS`, include the latest verifier timestamp, and include output/artifact references. | P0 | Should follow or land with GQA-003 so completion false positives are closed together. | `packages/ggcoder/src/tools/goals.ts`, optionally helper in `packages/ggcoder/src/core/goal-controller.ts` for shared audit validation. | `packages/ggcoder/src/tools/goals.test.ts`: vague pass audit rejected; wrong/missing `verifier_checked_at` rejected; valid `FINAL_AUDIT_PASS verifier_checked_at=<latest>` accepted. `goal-controller.test.ts`: completion gate stays blocked for invalid audit objects if helper is shared. |
| GQA-005 | **Fix**: add wall-clock worker timeout and process-tree termination, recording timeout evidence and failed/blocked task state. | P1 | Can share process cleanup approach with GQA-006. | `packages/ggcoder/src/core/goal-worker.ts`; maybe CLI/App option plumbing if configurable timeout is exposed (`packages/ggcoder/src/ui/App.tsx`, `packages/ggcoder/src/cli.ts`). | `packages/ggcoder/src/core/goal-worker.test.ts`: worker stub that hangs is killed after a small timeout, task becomes failed/blocked, evidence label includes timeout, completion reason is `timeout`. |
| GQA-006 | **Partially fixed / verify and harden**: current source already imports and calls `killProcessTree` on verifier timeout. Confirm child/grandchild cleanup semantics and remove redundant shell-only kill assumptions. | P1 | Coordinate with GQA-005 for shared process-tree helper behavior. | `packages/ggcoder/src/core/goal-verifier.ts`, `packages/ggcoder/src/utils/process.ts` if process-tree behavior needs improvement. | `packages/ggcoder/src/core/goal-verifier.test.ts`: shell command spawns a child/grandchild and sleeps; timeout kills descendants and records `verifier_timeout` with exit code 124/log path. |
| GQA-007 | **Fix low-risk consistency**: normalize verifier evidence labeling across tool and UI paths. Prefer `Verifier result` with status/content, or document a single accepted compatibility set. | P3 | None; avoid breaking repeated-failure detection while migrating. | `packages/ggcoder/src/tools/goals.ts`, `packages/ggcoder/src/ui/App.tsx`, `packages/ggcoder/src/core/goal-controller.ts` if label filters are adjusted, `packages/ggcoder/src/ui/goal-events.ts` only if display snapshots change. | `packages/ggcoder/src/tools/goals.test.ts` and `packages/ggcoder/src/ui/goal-lifecycle-orchestration.test.ts`: manual/tool verifier and UI verifier append the same canonical label/content shape; repeated-failure detection still works. |
| GQA-008 | **Fix**: add cross-process write protection with an inter-process lock or optimistic compare/retry. | P0 | Should precede large-scale E2E/concurrency confidence claims. Must preserve atomic rename and current merge semantics. | `packages/ggcoder/src/core/goal-store.ts`; possibly a small lock helper under `packages/ggcoder/src/utils/` or `src/core/`. | `packages/ggcoder/src/core/goal-store.test.ts`: spawn multiple Node processes or worker threads with temporary `GG_GOALS_BASE`, append distinct evidence concurrently, assert no evidence loss and valid JSON. |
| GQA-009 | **Fix with GQA-008**: broaden active-run overwrite guard to reject removal of any active run id, not only empty-list overwrites. | P1 | Best bundled with store write hardening in GQA-008. | `packages/ggcoder/src/core/goal-store.ts`. | `packages/ggcoder/src/core/goal-store.test.ts`: multi-run file with one active run; attempted save omitting that active run is rejected/preserved and records write-rejected evidence. |
| GQA-010 | **Fix**: make tool pause safe. Either reject pause while `activeWorkerId` exists with explicit UI/stop instructions, or add a stop callback/capability so tool pause stops the worker consistently. | P0 | If adding stop capability to tool, depends on avoiding circular imports between `tools/goals.ts` and `core/goal-worker.ts`; a rejection path is lower risk. | `packages/ggcoder/src/tools/goals.ts`; if integrated stop is chosen, `packages/ggcoder/src/core/goal-worker.ts` and tool factory wiring. | `packages/ggcoder/src/tools/goals.test.ts`: pause on active worker does not silently leave mutable work running; either returns an error/instructions without changing status, or stops/clears active worker and records evidence. UI lifecycle test remains green. |
| GQA-011 | **Fix**: persist blocked status/blocker when resume’s controller decision is blocked for non-prerequisite reasons. Clear or avoid stale `continueRequestedAt`. | P2 | None; small tool semantics change. | `packages/ggcoder/src/tools/goals.ts`. | `packages/ggcoder/src/tools/goals.test.ts`: paused/ready run with blocked evidence-plan item resumes to durable `blocked`, blocker contains controller reason, `continueRequestedAt` is not left as a misleading queued continuation. |
| GQA-012 | **Defer or fix opportunistically**: normal JSON payload path is robust; fallback parsing is non-critical. If touched, implement quoted-string unescape and truncation-safe behavior. | P3 | None. | `packages/ggcoder/src/ui/goal-events.ts`. | `packages/ggcoder/src/ui/goal-events.test.ts`: corrupt/missing payload with quotes/backslashes in run/task fields parses correctly, or fallback is explicitly documented as best-effort and not used for critical decisions. |
| GQA-013 | **Fix**: add per-run single-flight continuation lock around worker/verifier synthetic events and direct `continueGoalRun` scheduling. | P1 | Related to GQA-002; should land before claiming local E2E reliability. | `packages/ggcoder/src/ui/App.tsx`; possibly a small orchestration helper extracted for testability. | `packages/ggcoder/src/ui/goal-lifecycle-orchestration.test.ts`: verifier pass/fail event plus scheduled continuation creates exactly one follow-up task/verifier/audit decision. Include rapid duplicate event fixture. |
| GQA-014 | **Fix as CI/documented quality gate**: add a canonical goal-related test command/script that runs all goal-mode, prompt, store, worker, verifier, UI lifecycle, and overlay tests. | P2 | Useful before and after all implementation fixes; no runtime dependency. | `packages/ggcoder/package.json` scripts and/or `packages/ggcoder/scripts/verify-goal-system-audit.ts`; docs in `packages/ggcoder/docs/goal-remediation-plan.md` or quality docs. | Run `npm --prefix packages/ggcoder test -- src/**/*goal*.test.ts src/tools/goal-mode.test.ts src/system-prompt.test.ts` or scripted equivalent. Store command output as audit evidence. |
| GQA-015 | **Fix**: update and require the local end-to-end `/goal` verifier harness. It should run against temporary project state and `GG_GOALS_BASE`, exercise setup/control loop enough to prove durable completion gates, and avoid paid services. | P1 | Should follow P0 gate fixes (GQA-003/004/008/010) so E2E validates the intended hardened behavior. | `packages/ggcoder/scripts/verify-goal-e2e.ts`, possibly `packages/ggcoder/scripts/verify-goal-system-audit.ts`; test fixtures under `packages/ggcoder/scripts/` if needed. | Local command such as `npm --prefix packages/ggcoder exec tsx scripts/verify-goal-e2e.ts` must assert durable store contents, worker/verifier logs, final audit, and pass/fail gate behavior in a temp directory. |
| GQA-016 | **Fix**: add safety guardrails for prerequisite `check_command`. Reject or mark missing for clearly mutating/destructive commands; keep timeout and captured evidence. | P2 | Needs careful false-positive tuning; avoid overblocking benign checks. | `packages/ggcoder/src/tools/goals.ts`, possibly `packages/ggcoder/src/core/goal-prerequisites.ts` for shared classifier/helper. | `packages/ggcoder/src/tools/goals.test.ts` or `goal-prerequisites.test.ts`: destructive tokens like `rm -rf`, redirection writes, package install, or background server commands are rejected/not executed; safe commands still run and record evidence. |
| GQA-017 | **Fix after worker timeout**: distinguish process exit from verified task completion. At minimum, successful exit with no worker-recorded evidence/summary should not be treated as fully done without coordinator validation; consider `finished` semantics via existing `done` plus audit evidence requirements if schema change is too large. | P1 | Depends on GQA-005 for worker lifecycle changes and on GQA-003/004 for final gates. | `packages/ggcoder/src/core/goal-worker.ts`, `packages/ggcoder/src/core/goal-controller.ts`, possibly `packages/ggcoder/src/core/goal-store.ts` if adding a task status/field. | `packages/ggcoder/src/core/goal-worker.test.ts`: exit 0 without durable proof is recorded distinctly or causes follow-up validation. `goal-controller.test.ts`: controller does not proceed to verifier/completion solely from empty successful worker output when task proof is required. |
| GQA-018 | **Fix**: centralize blocker append/dedupe helper and use it in App/tool/store paths. | P3 | None; easy cleanup. | `packages/ggcoder/src/core/goal-store.ts` for exported helper, then `packages/ggcoder/src/ui/App.tsx` and `packages/ggcoder/src/tools/goals.ts`. | `packages/ggcoder/src/tools/goals.test.ts` and/or `packages/ggcoder/src/ui/goal-lifecycle-orchestration.test.ts`: repeated block/resume/verify attempts keep one copy of each blocker string. |

## Recommended implementation order

1. **Close false-positive completion gaps:** GQA-003, GQA-004.
2. **Protect durable state and pause semantics:** GQA-008, GQA-009, GQA-010.
3. **Harden process lifecycle:** GQA-005, GQA-006, then GQA-017.
4. **Stabilize orchestration/control-loop races:** GQA-013, then revisit GQA-002 if a first-call guard is still needed.
5. **Strengthen setup and command safety:** GQA-001, GQA-016, GQA-011.
6. **Normalize and polish:** GQA-007, GQA-012, GQA-018.
7. **Institutionalize verification:** GQA-014 and GQA-015 should run after each major cluster and become the documented regression gate.

## Cross-cutting test command target

After remediation, the default local quality proof should include at least:

```bash
npm --prefix packages/ggcoder test -- \
  src/core/goal-controller.test.ts \
  src/core/goal-store.test.ts \
  src/core/goal-prerequisites.test.ts \
  src/core/goal-verifier.test.ts \
  src/core/goal-worker.test.ts \
  src/core/goal-worker-dev-server-lifecycle.test.ts \
  src/core/goal-lifecycle-smoke.test.ts \
  src/tools/goals.test.ts \
  src/tools/goal-mode.test.ts \
  src/ui/goal-events.test.ts \
  src/ui/goal-lifecycle-orchestration.test.ts \
  src/ui/goal-overlay.test.ts \
  src/ui/goal-status-bar.test.ts \
  src/system-prompt.test.ts
```

The final end-to-end proof should additionally run the maintained local verifier script once GQA-015 is updated:

```bash
npm --prefix packages/ggcoder exec tsx scripts/verify-goal-e2e.ts
```
