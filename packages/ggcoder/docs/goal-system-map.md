# /goal system end-to-end map

Audit date: 2026-05-23. Refreshed from source in `packages/ggcoder` on the current working tree. Existing user code changes were preserved; this task only updates this map artifact.

Scope: slash-command invocation (`/goal`, `/g`), setup/coordinator prompts, `goals` tool actions, goal-store persistence, prerequisite checks, controller decisions, UI overlay/status/start/continue flow, worker lifecycle, synthetic events, verifier behavior, pause/resume/recovery, completion/final audit, and tests.

## A. Invocation and runtime modes

- **Slash command registration.** `/goal` is registered as prompt command `goal` with alias `/g`, description `Create a programmatic goal loop`, and a short setup-only prompt (`packages/ggcoder/src/core/prompt-commands.ts:13-21`). The comments intentionally anchor that setup defines success criteria, evidence plan, verifier, and Goal metadata, then stops (`prompt-commands.ts:18-19`).
- **Prompt command expansion.** `routePromptCommandInput` in App expands slash commands and appends arguments under `## User Instructions`; `/goal ...` therefore becomes the short Goal setup prompt plus the user objective (`packages/ggcoder/src/ui/App.tsx:229-248`).
- **App mode switch for `/goal`.** When the submitted command is `goal`, App disables plan mode if needed, sets `goalMode` to `setup`, rebuilds the system prompt, runs the expanded prompt, and restores `goalMode` to `off` afterward (`App.tsx:3137-3210`).
- **Goal mode plumbing.** `GoalMode` flows from CLI/App into tool construction and `buildSystemPrompt` (`packages/ggcoder/src/cli.ts:634-708`, `App.tsx:1139-1158`, `App.tsx:1495-1554`, `packages/ggcoder/src/system-prompt.ts:183-220`).
- **Goal pane entry.** `/goals` opens the Goal pane directly (`App.tsx:3101-3102`), and the CLI help lists `/goal`, `/goals`, and `Ctrl+G` for Goal workflows (`packages/ggcoder/src/cli.ts:215-232`).

## B. Setup and coordinator system prompts

- **Setup identity.** In setup mode the system prompt says the agent is a `Goal setup orchestrator`, not an implementation worker; it creates durable Goal runs, prerequisites, evidence plans, and worker tasks, and does not edit project files or start implementation (`system-prompt.ts:14-20`).
- **Setup protocol.** `renderGoalSetupSection` requires: clarify absent/vague objectives, model intended experience, imagine failures, choose required senses/signals, run only cheap local prerequisite checks, call `goals create`, add `goals task` plus evidence/harness/verifier plans, align evidence labels/commands/paths with future proof, optionally record setup evidence, answer briefly, then stop (`system-prompt.ts:65-71`).
- **Setup restrictions.** Setup allows read/search/list tools, cheap foreground non-mutating bash checks, and `goals` metadata actions; it forbids `edit`, `write`, `subagent`, normal `tasks`, verifier execution, background processes, `goals resume`, implementation/refactor/file generation outside Goal state, and plan mode (`system-prompt.ts:69-70`).
- **Coordinator identity.** Coordinator mode says the agent is a durable Goal coordinator that inspects Goal state, persists decisions/evidence, schedules the next worker/verifier step, and stops only when durable proof satisfies the Goal (`system-prompt.ts:21-25`).
- **Coordinator protocol.** `renderGoalCoordinatorSection` requires `goals status` first, durable-state inspection, persistence of evidence/decisions/task status/blockers/verifier definitions, exactly the next needed worker/verifier/control action, and concise progress (`system-prompt.ts:74-79`).
- **Coordinator completion rule.** Completion requires verifier evidence satisfying original criteria and evidence plan plus a final completion audit comparing durable files/logs/results against the latest verifier pass; if evidence-plan bookkeeping or audit is stale/missing, the coordinator must reconcile or create/resume worker work rather than complete (`system-prompt.ts:77-79`).
- **Goal-specific proof guidance.** The general research section also instructs Goal drivers to model intended experience, imagine goal-specific failures, choose required senses/signals, and plan proportional local/free instruments rather than default generic proof artifacts (`system-prompt.ts:101-108`).

## C. Goals tool A-Z

- **Tool contract.** `createGoalsTool` exposes durable Goal management for `/goal` and `Ctrl+G`; its description requires success criteria first, prerequisite checks before workers, persisted harness/evidence, standalone worker tasks, final completion audits, and no completion until verifier plus final-audit evidence proves the objective (`packages/ggcoder/src/tools/goals.ts:297-303`).
- **Actions.** The schema supports `create`, `prerequisite`, `task`, `evidence`, `evidence_plan`, `verify`, `audit`, `status`, `pause`, `resume`, and `complete` (`tools/goals.ts:76-149`).
- **Create/update.** `create` requires title and goal, optionally updates an existing run, normalizes prerequisites (including running `check_command` when needed), maps harness/evidence-plan/verifier fields, sets blocked status when prerequisites block, persists with `upsertGoalRun`, and appends a create/update decision (`tools/goals.ts:306-374`).
- **Status.** `status` returns a compact status line for one run or all runs, including prerequisite count, task count, verifier state, audit state, and blocking prerequisite text (`tools/goals.ts:258-279`, `tools/goals.ts:376-384`).
- **Prerequisite.** `prerequisite` updates/adds a prerequisite by id or label, requires evidence when marking met, recomputes blocked/ready status, clears blockers when all prerequisites are complete, and records a decision (`tools/goals.ts:386-443`).
- **Task.** `task` adds or patches Goal tasks, including status, worker id, attempts, and summary; if a failed/passed run receives a recoverable pending/failed task patch it can recover to ready/blocked (`tools/goals.ts:281-290`, `tools/goals.ts:445-481`).
- **Evidence and evidence plan.** `evidence` appends durable evidence (`tools/goals.ts:483-498`). `evidence_plan` updates a planned proof path’s status/instructions/evidence/path, records a decision, and can recover a blocked run to ready when prerequisites no longer block (`tools/goals.ts:500-536`).
- **Verify.** `verify` records a verifier result manually/tool-side, appends `Verifier result` command evidence, initializes a pending final audit for pass results, applies `canCompleteGoalRun`, and sets status to `passed` only when all gates including audit are satisfied (`tools/goals.ts:538-601`).
- **Audit.** `audit` requires an existing passing verifier result, records `completionAudit`, appends `Final completion audit ...` evidence, appends a `completion_audit` decision, and only sets `passed` if `hasFreshGoalCompletionAudit` and `canCompleteGoalRun` both pass (`tools/goals.ts:603-651`).
- **Pause/resume/complete.** `pause` sets paused (`tools/goals.ts:653-659`, `tools/goals.ts:725-726`). `resume` refuses blocking prerequisites, otherwise sets/keeps ready/running/verifying, records `continueRequestedAt`, appends resume evidence, asks the controller for the next action, and records a resume decision (`tools/goals.ts:660-720`). `complete` calls `canCompleteGoalRun` and errors unless all gates pass (`tools/goals.ts:721-726`).

## D. Goal-store persistence and recovery

- **State model.** `GoalRun` stores id/title/goal/status/timestamps/project path, success criteria, prerequisites, harness, evidence plan, tasks, durable evidence, verifier, optional completion audit, blockers, active worker id, and continuation request timestamp (`packages/ggcoder/src/core/goal-store.ts:7-130`).
- **Statuses and evidence types.** Run statuses are `draft`, `blocked`, `ready`, `running`, `verifying`, `passed`, `failed`, `paused`; task statuses are `pending`, `running`, `verifying`, `done`, `failed`, `blocked`; evidence kinds are `log`, `command`, `screenshot`, `file`, `summary` (`goal-store.ts:7-23`).
- **Storage location.** Goal files live under `~/.gg/goals/projects` unless `GG_GOALS_BASE` overrides it; project paths are normalized and hashed (`goal-store.ts:191-201`, `goal-store.ts:601-607`). Each project directory stores `goals.json`, `meta.json`, and per-run journals under `journals/<runId>.md` (`goal-store.ts:542-577`, `goal-store.ts:1016-1076`).
- **Normalization.** Reads tolerate malformed/missing fields and normalize verifier results, prerequisites, harness entries, evidence-plan items, tasks, evidence, completion audits, and runs (`goal-store.ts:321-495`).
- **Write safety.** Writes are serialized through a module-level queue and use temp-file atomic rename (`goal-store.ts:194`, `goal-store.ts:533-583`, `goal-store.ts:700-832`). A guard refuses an empty overwrite while active work exists, preserves active runs, and appends `Goal store write rejected` evidence (`goal-store.ts:501-568`).
- **Mutation helpers.** `upsertGoalRun` merges with existing runs while preserving created time and merging tasks/evidence (`goal-store.ts:800-832`). `appendGoalDecision`, `appendGoalEvidence`, and `updateGoalTask` provide durable decision/evidence/task mutations, including run-id prefix/discovery support (`goal-store.ts:852-948`).
- **Prerequisite semantics.** A prerequisite blocks unless `status === "met"` and non-empty evidence is recorded (`goal-store.ts:950-959`). Missing instructions are formatted from explicit instructions, unevidenced met state, unknown state, or generic user requirement (`goal-store.ts:962-986`).
- **Startup/runtime reconciliation.** `reconcileActiveGoalRuns` clears stale `activeWorkerId`, resets stale running/verifying tasks to pending, resets interrupted verifier state to ready with a blocker, and records repair evidence (`goal-store.ts:704-798`).
- **Journals.** `writeGoalProgressJournalFromRun` mirrors status, criteria, prerequisites, tasks, verifier, final audit, blockers, and recent evidence into markdown for durable human/debug inspection (`goal-store.ts:1016-1076`).

## E. Prerequisite checks

- **Command runner.** `runGoalPrerequisiteCheckCommand` runs a shell command in the project cwd, captures up to 500 trailing characters, times out after 15 seconds by default, and returns `met` for exit 0 or `missing` otherwise with non-secret evidence text (`packages/ggcoder/src/core/goal-prerequisites.ts:4-72`).
- **When checks run.** Setup/tool normalization runs a `check_command` when status is unknown or marked met without evidence (`tools/goals.ts:156-197`). App’s `startGoalRun` reruns needed checks before launching any worker/verifier (`App.tsx:4275-4290`).
- **Blocking behavior.** If checks leave prerequisites blocking, App marks the run `blocked`, records the blocker, shows terminal Goal progress, and does not start workers (`App.tsx:4290-4310`). `goals resume` likewise refuses to continue while prerequisites block (`tools/goals.ts:660-679`).

## F. Controller decision engine

- **Decision types.** `GoalControllerDecision` covers `blocked`, `create_task`, `terminal`, `wait`, `start_worker`, `pause`, `run_verifier`, and `complete` (`packages/ggcoder/src/core/goal-controller.ts:16-57`).
- **Completion gate.** `canCompleteGoalRun` rejects blocking prerequisites, incomplete tasks, unsatisfied evidence plan, missing verifier evidence, non-pass verifier, and missing/stale/failing final completion audit; only all-done + verifier pass + final audit pass returns ok (`goal-controller.ts:318-349`).
- **Evidence-plan matching.** Evidence-plan items are satisfied by explicit `ready` plus evidence text, item evidence text, exact passing-verifier command/output path matches, exact durable evidence path matches, or durable evidence content that references the expected command/path. Generic label/description substring matches are no longer part of the source-backed satisfaction path (`goal-controller.ts:108-172`).
- **Final audit freshness.** `hasFreshGoalCompletionAudit` requires a passing latest verifier, no later non-audit worker evidence after that verifier, a pass audit tied to the same verifier `checkedAt`, audit time not older than verifier time, and no later completion-relevant evidence after the audit (`goal-controller.ts:239-282`).
- **Next-action order.** `decideGoalNextAction` checks completion, blocking prerequisites, terminal/paused state, active worker/task wait states, pending/failed worker tasks, blocked evidence plan, missing evidence instrumentation, missing harness instrumentation, verifier failures, stale/pass verifier audit needs, configured verifier command, and finally creates a verifier-definition task (`goal-controller.ts:447-615`).
- **Attempt bounds.** Worker tasks pause after `DEFAULT_GOAL_TASK_ATTEMPT_LIMIT` (5) attempts (`goal-controller.ts:8`, `goal-controller.ts:486-504`). Verifier failures create bounded `Fix verifier failure` tasks up to `DEFAULT_GOAL_VERIFIER_FIX_LIMIT` (5), with repeated identical failure detection (`goal-controller.ts:355-374`, `goal-controller.ts:547-576`). Evidence reconciliation and final audit tasks are also bounded (`goal-controller.ts:10-14`, `goal-controller.ts:511-528`, `goal-controller.ts:578-599`).
- **Auto-created tasks.** The controller can create tasks to build evidence paths, build harness instrumentation, define a verifier, fix verifier failures, reconcile evidence-plan bookkeeping after a verifier pass, and perform read-only final completion audit (`goal-controller.ts:70-84`, `goal-controller.ts:141-164`, `goal-controller.ts:284-304`, `goal-controller.ts:376-424`, `goal-controller.ts:511-614`).

## G. UI overlay, status bar, start and continue flow

- **Goal overlay model.** `GoalOverlay` loads `loadGoalRuns(cwd)` every second, sorts newest first, and preserves local state instead of saving an empty list while active work exists (`packages/ggcoder/src/ui/components/GoalOverlay.tsx:857-900`). It displays counts, prerequisite/task/verifier summaries, evidence plan, harness, blockers, recent evidence, and detailed run state (`GoalOverlay.tsx:50-108`, `GoalOverlay.tsx:610-829`).
- **Overlay controls.** In the pane: `r` runs/continues the selected Goal, `v` runs verifier, `p` pauses, `x` archives with confirmation, `Enter/d` toggles details, navigation keys scroll/select, and `Esc` closes (`GoalOverlay.tsx:939-1029`, `GoalOverlay.tsx:1173-1199`). App wires these to `startGoalRun`, `verifyGoalRun`, and `pauseGoalRun` (`App.tsx:4893-4911`).
- **Status bar.** `GoalStatusBar` displays up to three active/failed Goal entries with phases `worker`, `verifier`, `reviewing`, `orchestrating`, and `failed`, elapsed time, shimmer animation for active work, and reconciliation helpers that remove stale entries when no active run/process remains (`packages/ggcoder/src/ui/components/GoalStatusBar.tsx:8-191`).
- **Start flow.** `startGoalRun` enters coordinator mode, reloads the run, runs prerequisite checks, blocks if prerequisites remain missing, asks `decideGoalNextAction`, appends the decision, and handles each decision: terminal/complete/wait, run verifier, auto-create task then continue, block/pause, or start a worker (`App.tsx:4275-4477`).
- **Continue flow.** `continueGoalRun` reconciles active state, gets a fresh controller decision, stops on terminal/blocked/pause with durable state and progress, consumes `continueRequestedAt` when no worker/verifier is active, records `continuation_consumed`, posts progress, and delegates back to `startGoalRun` (`App.tsx:4105-4197`).
- **Pause from UI.** `pauseGoalRun` stops an active worker if present, marks the run paused, clears active worker state, updates counts/progress/status entries, and leaves continuation stopped until resumed (`App.tsx:4649-4675`).

## H. Worker lifecycle

- **Worker prompt.** `buildGoalWorkerSystemPrompt` injects cwd/run/task context, instructs workers to follow only the assigned task, keep changes focused, use local/free proof, build needed instruments, record durable evidence/task status with `goals`, clean up worker-owned background processes, and never complete the whole Goal (`packages/ggcoder/src/core/goal-worker.ts:85-95`). Worker child execution is also bounded by a wall-clock timeout that terminates the process tree and records timeout evidence (`goal-worker.ts:297-356`).
- **Spawn.** `startGoalWorker` prevents duplicate running workers for the same run, spawns the same CLI in JSON mode with provider/model/max-turns/system prompt, passes the task prompt, writes logs under `<goal project>/workers/<workerId>.ndjson`, marks the task running, and sets `activeWorkerId` (`goal-worker.ts:179-243`).
- **Streaming evidence.** Worker stdout JSON is logged. Text deltas/errors are summarized; tool-call starts update current activity and append durable log evidence pointing at the worker log; tool-call ends record tool-use success/failure for the synthetic event (`goal-worker.ts:244-291`).
- **Close/error.** On process close, the worker marks the task done/failed, appends `Worker <id> done|failed` log evidence, clears active worker state, emits completion, and notifies subscribers (`goal-worker.ts:293-341`). Spawn errors mark task failed and append spawn-failure evidence (`goal-worker.ts:343-375`).
- **Stop/shutdown.** `stopGoalWorker` kills the process tree, marks the task blocked, appends stopped evidence, and clears active worker (`goal-worker.ts:390-415`). `shutdownGoalWorkers` kills worker child processes for project/session cleanup (`goal-worker.ts:418-426`).

## I. Synthetic Goal events and session recovery

- **Event format.** Worker and verifier completions become synthetic user messages prefixed by `[event:goal_worker_complete]` or `[event:goal_verifier_complete]` plus a `goal_event_payload` JSON line (`packages/ggcoder/src/ui/goal-events.ts:9-14`, `goal-events.ts:246-315`).
- **Payload.** Payloads include version, kind, run id, goal title, status, exit code, summary, current Goal state snapshot, and worker/verifier-specific fields such as task id, worker log file/tools used, verifier command/output path, fix attempts, and completion guidance (`goal-events.ts:67-99`, `goal-events.ts:222-294`).
- **Coordinator instructions.** Every synthetic event carries instructions to call `goals status`, inspect durable tasks/verifier/blockers/evidence, and take exactly one next control-loop action without merely narrating or asking the user to open the pane (`goal-events.ts:120-125`).
- **Parsing.** `parseGoalSyntheticEvent` validates JSON payloads and falls back to header parsing if payload is absent/invalid (`goal-events.ts:317-461`).
- **Routing.** App’s `runGoalSyntheticEvent` queues the event if another agent turn is running or otherwise enters coordinator mode and runs the event through the agent loop (`App.tsx:4062-4102`). Worker completion subscriptions load the latest run and feed the formatted event into this path (`App.tsx:4208-4273`).
- **History restore.** CLI/session restore parses synthetic user messages into durable Goal progress cards so restarted sessions show worker/verifier/terminal Goal progress rather than raw event text (`packages/ggcoder/src/cli.ts:1893-1951`, `cli.ts:2008-2015`).
- **Continuation eligibility.** `shouldContinueGoalRun` only continues non-terminal, non-blocked, non-paused runs with no active worker/running task (`goal-events.ts:463-474`).

## J. Verifier behavior and final completion

- **Verifier command runner.** `runGoalVerifierCommand` runs the configured shell command in cwd, captures up to 20k trailing output chars, writes a log under `<goal project>/verifiers/<runId>-<startedAt>.log`, times out after 10 minutes by default, kills the verifier process tree on timeout, and classifies pass/failure/spawn-error/timeout (`packages/ggcoder/src/core/goal-verifier.ts:1-112`).
- **UI verifier orchestration.** `verifyGoalRun` enters coordinator mode, blocks if no verifier command exists, marks the run `verifying`, records status/progress entries, runs the verifier command with `GG_GOAL_VERIFIER_TIMEOUT_MS` override support, persists last result, appends verifier command evidence and decision, updates counts/status, emits a synthetic verifier event, and schedules continuation after pass/fail (`App.tsx:4497-4627`).
- **Pass does not equal completion.** A passing verifier initializes `completionAudit` to unknown/pending and only sets status `passed` if `canCompleteGoalRun` already passes; otherwise the run returns to `ready` for final audit/reconciliation (`App.tsx:4561-4586`, `tools/goals.ts:561-599`).
- **Final audit task.** After a verifier pass, the controller creates `Audit Goal completion evidence` unless a fresh passing audit already exists. The audit prompt is read-only and requires comparing original criteria against actual durable artifacts after the latest verifier pass, then recording `goals action=audit` with `FINAL_AUDIT_PASS` on success (`goal-controller.ts:376-399`, `goal-controller.ts:578-599`).
- **Completion.** `complete` decisions and `goals complete` require no blocking prerequisites, all tasks done, evidence plan satisfied, passing latest verifier, and fresh passing final audit. UI sets status `passed` only on that controller completion decision (`goal-controller.ts:318-349`, `tools/goals.ts:721-726`, `App.tsx:4348-4361`).

## K. Pause, resume, and recovery

- **Controller pauses.** Attempts beyond task limit return a `pause` decision; repeated/bounded verifier failures also block or pause (`goal-controller.ts:486-504`, `goal-controller.ts:547-576`). App persists pause evidence, blocks the task, clears continuation, and shows terminal paused progress (`App.tsx:4398-4428`).
- **Manual pause.** UI pause stops any active worker and marks paused (`App.tsx:4649-4675`). Tool pause simply sets status paused when invoked through `goals` (`tools/goals.ts:653-659`, `tools/goals.ts:725-726`).
- **Resume.** Tool resume records `continueRequestedAt`, appends `Goal resume requested`, keeps active running/verifying runs active or otherwise sets ready, asks the controller for next action, and records `Goal decision: resume` (`tools/goals.ts:660-720`). App continuation consumes the request when no worker/verifier is active (`App.tsx:4160-4174`).
- **Crash/stale recovery.** Store reconciliation repairs stale workers/tasks/verifiers and writes repair evidence (`goal-store.ts:704-798`). Status-bar reconciliation hides entries whose underlying run/process is no longer active (`GoalStatusBar.tsx:99-136`). Goal overlay refuses dangerous empty saves during active work (`GoalOverlay.tsx:347-360`, `GoalOverlay.tsx:857-900`).

## L. Test coverage map

- **Slash-command contract:** `packages/ggcoder/src/core/prompt-commands.test.ts` verifies `/goal` and `/g` plus the short setup prompt contract.
- **System prompts:** `packages/ggcoder/src/system-prompt.test.ts` covers setup/coordinator identities, restrictions, tool filtering, no plan-mode leakage, and prompt size bounds.
- **Store:** `packages/ggcoder/src/core/goal-store.test.ts` covers normalization, persistence, summaries, active-run preservation, and reconciliation.
- **Prerequisites:** `packages/ggcoder/src/core/goal-prerequisites.test.ts` covers command check outcomes/timeouts and check selection.
- **Controller:** `packages/ggcoder/src/core/goal-controller.test.ts` covers completion gates, decision order, active worker waits, attempt limits, evidence-plan satisfaction/reconciliation, verifier-fix bounds, final audit freshness, and continuation clearing.
- **Goals tool:** `packages/ggcoder/src/tools/goals.test.ts` covers create/status/prerequisite/task/evidence/evidence_plan/verify/audit/resume/complete behavior and blocking guards.
- **Lifecycle smoke:** `packages/ggcoder/src/core/goal-lifecycle-smoke.test.ts` exercises a local end-to-end Goal lifecycle through tool actions/controller state.
- **Worker/verifier:** `packages/ggcoder/src/core/goal-worker.test.ts`, `goal-worker-dev-server-lifecycle.test.ts`, and `goal-verifier.test.ts` cover process lifecycle, log/evidence behavior, dev-server cleanup ownership, verifier output/logging/timeouts/failures.
- **Synthetic events:** `packages/ggcoder/src/ui/goal-events.test.ts` covers payload formatting/parsing/snapshots/continuation semantics.
- **UI:** `packages/ggcoder/src/ui/goal-overlay.test.ts`, `goal-status-bar.test.ts`, `goal-lifecycle-orchestration.test.ts`, and `footer-status-layout.test.ts` cover pane rendering/navigation/persistence guards, status entries, lifecycle transitions, and footer layout.
- **Tool restrictions:** `packages/ggcoder/src/tools/goal-mode.test.ts` covers Goal-mode restrictions for normal editing/process tools.

## M. End-to-end sequence summary

1. User invokes `/goal <objective>` or `/g <objective>`.
2. App expands the prompt and temporarily enters Goal setup mode.
3. Setup-mode agent creates/updates durable Goal state through `goals create`/`task`/plans only, with success criteria, prerequisite checks, evidence plan, harness, and verifier metadata.
4. User opens Goal pane (`/goals` or `Ctrl+G`) and presses `r`, or a resume/continuation event drives the run.
5. App enters coordinator mode, reruns cheap prerequisite checks, and asks the controller for exactly one next action.
6. Controller starts a worker, creates a missing instrumentation/verifier/audit/reconciliation/fix task, runs the verifier, waits, blocks, pauses, or completes.
7. Workers perform scoped implementation/proof work, update durable Goal evidence/task status, and emit synthetic completion events.
8. Verifier command writes command/log evidence and emits a synthetic verifier event; pass still requires evidence-plan satisfaction and a final completion audit.
9. Synthetic events route back into coordinator mode, which inspects `goals status` and schedules the next step.
10. Completion is durable only when prerequisites are met with evidence, all tasks are done, evidence plan is satisfied, verifier passed, and a fresh final audit passed after that verifier.
