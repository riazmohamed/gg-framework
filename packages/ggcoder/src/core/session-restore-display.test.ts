import { describe, expect, it } from "vitest";
import type { Message } from "@abukhaled/gg-ai";
import { messagesToHistoryItems } from "../cli.js";
import { PROMPT_COMMANDS } from "./prompt-commands.js";
import { DISPLAY_ITEM_CUSTOM_KIND, SessionManager, type SessionEntry } from "./session-manager.js";
import { getRestoredMessagesForDisplay } from "./session-compaction.js";
import {
  GOAL_EVENT_PAYLOAD_PREFIX,
  GOAL_VERIFIER_EVENT_PREFIX,
  GOAL_WORKER_EVENT_PREFIX,
} from "../ui/goal-events.js";

function extractText(content: Message["content"]): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter(
      (block): block is { type: "text"; text: string } => block.type === "text" && "text" in block,
    )
    .map((block) => block.text)
    .join("\n");
}

function replayTexts(messages: readonly Message[]): string[] {
  return getRestoredMessagesForDisplay(messages).map((message) => extractText(message.content));
}

function replayHistory(messages: Message[]) {
  return messagesToHistoryItems(getRestoredMessagesForDisplay(messages));
}

describe("continued session replay display filtering", () => {
  it("prefers persisted display items for exact continued-session replay", () => {
    const sessionManager = new SessionManager("/tmp/unused");
    const persisted: SessionEntry[] = [
      {
        type: "message",
        id: "msg-1",
        parentId: null,
        timestamp: "2026-01-01T00:00:00.000Z",
        message: { role: "assistant", content: "message fallback" },
      },
      {
        type: "custom",
        kind: DISPLAY_ITEM_CUSTOM_KIND,
        data: {
          version: 1,
          item: {
            kind: "goal_agent_transition",
            text: "Planning Goal setup",
            id: "display-goal-stage",
          },
        },
        id: "display-1",
        parentId: null,
        timestamp: "2026-01-01T00:00:01.000Z",
      },
    ];

    expect(sessionManager.getDisplayItems(persisted, "msg-1")).toEqual([
      { kind: "goal_agent_transition", text: "Planning Goal setup", id: "display-goal-stage" },
    ]);
  });

  it("replays the typed /goal display row instead of persisted internal goal prompts", () => {
    const sessionManager = new SessionManager("/tmp/unused");
    const goalCommand = PROMPT_COMMANDS.find((command) => command.name === "goal");
    if (!goalCommand) throw new Error("missing /goal command");
    const persisted: SessionEntry[] = [
      {
        type: "custom",
        kind: DISPLAY_ITEM_CUSTOM_KIND,
        data: { version: 1, item: { kind: "user", text: "/goal hey", id: "display-user" } },
        id: "display-user-entry",
        parentId: null,
        timestamp: "2026-01-01T00:00:00.000Z",
      },
      {
        type: "message",
        id: "msg-1",
        parentId: null,
        timestamp: "2026-01-01T00:00:01.000Z",
        message: {
          role: "user",
          content: `${goalCommand.prompt}\n\n## User Instructions\n\nhey\n\n## Goal References (MANDATORY)\n\n- [original-goal-prompt] kind=prompt`,
        },
      },
      {
        type: "message",
        id: "msg-2",
        parentId: "msg-1",
        timestamp: "2026-01-01T00:00:02.000Z",
        message: {
          role: "user",
          content:
            "## Original Goal Objective\n\nhey\n\n## Goal Planner Output\n\nGOAL_PLAN\nresearch=none\nEND_GOAL_PLAN",
        },
      },
    ];

    expect(sessionManager.getDisplayItems(persisted, "msg-2")).toEqual([
      { kind: "user", text: "/goal hey", id: "display-user" },
    ]);
  });

  it("does not replay raw persisted goal worker synthetic events as chat", () => {
    const persisted: Message[] = [
      { role: "user", content: "please keep this normal user prompt" },
      {
        role: "user",
        content: `${GOAL_WORKER_EVENT_PREFIX} run_id="run-a" goal="Fix replay" task_id="task-a" task="Repro" worker="worker-a" status=done exit_code=0\n${GOAL_EVENT_PAYLOAD_PREFIX}{"version":1,"kind":"worker","runId":"run-a","goal":"Fix replay","status":"done","exitCode":0,"summary":"done","goalState":{"status":"running","userPrerequisites":"(none)","verifier":null,"blockers":[],"prerequisites":[],"evidencePlan":[],"tasks":[],"evidenceCount":0},"taskId":"task-a","task":"Repro","worker":"worker-a","workerLogFile":"/tmp/worker.log","toolsUsed":[]}\nsummary:\ndone`,
      },
    ];

    const history = replayHistory(persisted);
    const replayedText = JSON.stringify(history);

    expect(history).toMatchObject([
      { kind: "user", text: "please keep this normal user prompt" },
      {
        kind: "goal_progress",
        phase: "worker_finished",
        title: "Done: Repro",
        detail: "done",
        workerId: "worker-a",
        status: "done",
      },
    ]);
    expect(replayedText).not.toContain(GOAL_WORKER_EVENT_PREFIX);
    expect(replayedText).not.toContain(GOAL_EVENT_PAYLOAD_PREFIX);
  });

  it("does not replay raw persisted goal verifier synthetic events as chat", () => {
    const persisted: Message[] = [
      {
        role: "user",
        content: `${GOAL_VERIFIER_EVENT_PREFIX} run_id="run-a" goal="Fix replay" status=fail exit_code=1\n${GOAL_EVENT_PAYLOAD_PREFIX}{"version":1,"kind":"verifier","runId":"run-a","goal":"Fix replay","status":"fail","exitCode":1,"summary":"failed","goalState":{"status":"verifying","userPrerequisites":"(none)","verifier":null,"blockers":[],"prerequisites":[],"evidencePlan":[],"tasks":[],"evidenceCount":0},"command":"pnpm test","fixAttempts":0,"fixLimit":3,"completionGuidance":"fix"}\nsummary:\nfailed`,
      },
    ];

    const history = replayHistory(persisted);
    const replayedText = JSON.stringify(history);

    expect(history).toMatchObject([
      {
        kind: "goal_progress",
        phase: "verifier_finished",
        title: "Verifier fail: Fix replay",
        detail: "failed",
        status: "fail",
      },
    ]);
    expect(replayedText).not.toContain(GOAL_VERIFIER_EVENT_PREFIX);
    expect(replayedText).not.toContain(GOAL_EVENT_PAYLOAD_PREFIX);
  });

  it("restores terminal goal state as a compact goal progress row", () => {
    const persisted: Message[] = [
      {
        role: "user",
        content: `${GOAL_VERIFIER_EVENT_PREFIX} run_id="run-a" goal="Fix replay" status=pass exit_code=0\n${GOAL_EVENT_PAYLOAD_PREFIX}{"version":1,"kind":"verifier","runId":"run-a","goal":"Fix replay","status":"pass","exitCode":0,"summary":"Verifier passed","goalState":{"status":"passed","userPrerequisites":"(none)","verifier":{"description":"Replay verifier","lastStatus":"pass"},"blockers":[],"prerequisites":[],"evidencePlan":[],"tasks":[{"id":"task-a","title":"Repro","status":"done","attempts":1}],"evidenceCount":3},"command":"pnpm test","fixAttempts":0,"fixLimit":3,"completionGuidance":"complete"}\nsummary:\nVerifier passed`,
      },
    ];

    const history = replayHistory(persisted);
    const replayedText = JSON.stringify(history);

    expect(history).toMatchObject([
      {
        kind: "goal_progress",
        phase: "terminal",
        title: "Goal passed: Fix replay",
        detail: "Verifier passed",
        status: "passed",
      },
    ]);
    expect(replayedText).not.toContain(GOAL_VERIFIER_EVENT_PREFIX);
    expect(replayedText).not.toContain(GOAL_EVENT_PAYLOAD_PREFIX);
  });

  it("restores every built-in prompt-template slash command as typed command text", () => {
    for (const command of PROMPT_COMMANDS) {
      const persisted: Message[] = [
        {
          role: "user",
          content: `${command.prompt}\n\n## User Instructions\n\nship the feature`,
        },
      ];

      expect(replayHistory(persisted)).toMatchObject([
        { kind: "user", text: `/${command.name} ship the feature` },
      ]);
    }
  });

  it("keeps compact restore/system control out of display but preserves normal slash-command text", () => {
    const persisted: Message[] = [
      { role: "system", content: "internal system control should remain hidden" },
      { role: "user", content: "/help" },
      { role: "assistant", content: "Here are the available commands." },
    ];

    const replayedText = replayTexts(persisted).join("\n");

    expect(replayedText).not.toContain("internal system control");
    expect(replayedText).toContain("/help");
    expect(replayedText).toContain("Here are the available commands.");
  });
});
