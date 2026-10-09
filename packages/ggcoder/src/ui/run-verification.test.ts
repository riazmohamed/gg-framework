import { describe, expect, it } from "vitest";
import type { Message } from "@abukhaled/gg-ai";
import { summarizeRunVerification } from "./run-verification.js";

let seq = 0;
function call(name: string, args: Record<string, unknown>, result: string): Message[] {
  const id = `t${++seq}`;
  return [
    { role: "assistant", content: [{ type: "tool_call", id, name, args }] },
    { role: "tool", content: [{ type: "tool_result", toolCallId: id, content: result }] },
  ];
}
const edit = () => call("edit", { file_path: "src/a.ts" }, "Edited src/a.ts");
const bash = (command: string, exit: number) =>
  call("bash", { command }, `Exit code: ${exit}\n${exit === 0 ? "ok" : "1 failed"}`);
const user: Message = { role: "user", content: "do it" };

describe("summarizeRunVerification", () => {
  it("says nothing for a run that neither edited nor checked", () => {
    expect(summarizeRunVerification([user, { role: "assistant", content: "Answer." }])).toBeNull();
    expect(summarizeRunVerification([user, ...bash("ls -la", 0)])).toBeNull();
  });

  it("credits checks that ran after the last edit", () => {
    expect(
      summarizeRunVerification([user, ...edit(), ...bash("pnpm test", 0), ...bash("pnpm lint", 0)]),
    ).toEqual({ text: "✓ 2 checks passed after the last edit", tone: "passed" });
  });

  it("does not credit a check that ran before the last edit", () => {
    expect(summarizeRunVerification([user, ...bash("pnpm test", 0), ...edit()])).toEqual({
      text: "! Files changed, but no check ran after the last edit",
      tone: "warning",
    });
  });

  it("reports a failing check with its command", () => {
    expect(summarizeRunVerification([user, ...edit(), ...bash("pnpm test", 1)])).toEqual({
      text: "✗ 1 check failed: pnpm test",
      tone: "failed",
    });
  });

  it("reports checks run without edits, and ignores background runs", () => {
    expect(summarizeRunVerification([user, ...bash("pnpm test", 0)])?.text).toBe(
      "✓ 1 check passed",
    );
    const background = call(
      "bash",
      { command: "pnpm test", run_in_background: true },
      "Started background task",
    );
    expect(summarizeRunVerification([user, ...edit(), ...background])?.tone).toBe("warning");
  });
});
