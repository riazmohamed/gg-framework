import { describe, expect, it } from "vitest";
import { answersToElicitContent, elicitationToQuestions } from "./mcp-elicit-form.js";
import { createTuiElicitHost } from "./mcp-elicit-host.js";
import { createAskPickerState, reduceAskPicker, type AskPickerKey } from "./ask-user-state.js";

const schema = {
  type: "object",
  properties: {
    name: { type: "string", title: "Project name", description: "Shown in the dashboard" },
    seats: { type: "integer", title: "Seats", minimum: 1, maximum: 50 },
    region: { type: "string", enum: ["eu", "us"], enumNames: ["Europe", "United States"] },
    public: { type: "boolean", title: "Public" },
    note: { type: "string" },
    tags: { type: "array", items: { enum: ["a", "b", "c"] } },
  },
  required: ["name", "seats", "region", "public"],
};

describe("MCP elicitation forms", () => {
  it("turns each field into a picker question", () => {
    const qs = elicitationToQuestions(schema);
    expect(qs.map((q) => [q.id, q.kind])).toEqual([
      ["name", "text"],
      ["seats", "text"],
      ["region", "choice"],
      ["public", "choice"],
      ["note", "choice"],
      ["tags", "multi"],
    ]);
    expect(qs[0]).toMatchObject({ question: "Project name", detail: "Shown in the dashboard" });
    expect(qs[1].question).toBe("Seats (1–50)");
    expect(qs[2].options?.map((o) => o.label)).toEqual(["Europe", "United States"]);
    expect(qs[4]).toMatchObject({ question: "note (optional)", allowOther: true });
    expect(qs[4].options?.[0].label).toBe("Leave empty");
  });

  it("converts answers back to typed content and validates numbers", () => {
    const answers = {
      name: "acme",
      seats: "12",
      region: "eu",
      public: "false",
      note: "\u0000skip",
      tags: ["a", "c"],
    };
    expect(answersToElicitContent(schema, answers)).toEqual({
      content: { name: "acme", seats: 12, region: "eu", public: false, tags: ["a", "c"] },
    });
    expect(answersToElicitContent(schema, { ...answers, seats: "1.5" })).toEqual({
      error: "Seats must be a whole number.",
    });
    expect(answersToElicitContent(schema, { ...answers, seats: "99" })).toEqual({
      error: "Seats must be at most 50.",
    });
  });
});

const keys = (...k: AskPickerKey[]) => k;
const typed = (text: string): AskPickerKey[] => [...text].map((char) => ({ type: "char", char }));

describe("TUI elicitation host", () => {
  const request = (requestedSchema: Record<string, unknown>) => ({
    server: "notion",
    message: "Which workspace?",
    requestedSchema,
  });

  it("queues forms, accepts typed content, and re-asks on a bad number", async () => {
    const host = createTuiElicitHost();
    const small = {
      type: "object",
      properties: { seats: { type: "integer", minimum: 1 } },
      required: ["seats"],
    };
    const first = host.bridge.onElicit(request(small));
    const second = host.bridge.onElicit(request({ type: "object", properties: {} }));
    expect(host.current()?.request.message).toBe("Which workspace?");

    host.submit({ seats: "0" });
    expect(host.current()?.error).toBe("seats must be at least 1.");
    host.submit({ seats: "3" });
    await expect(first).resolves.toEqual({ action: "accept", content: { seats: 3 } });

    // The second, field-less form is an Accept/Decline confirmation.
    const prompt = host.current()!.prompt;
    const state = [...keys({ type: "down" }, { type: "enter" })].reduce(
      reduceAskPicker,
      createAskPickerState(prompt.questions),
    );
    host.submit(state.answers);
    await expect(second).resolves.toEqual({ action: "decline" });
    expect(host.current()).toBeNull();
  });

  it("declines on dismiss and cancels everything on abort", async () => {
    const host = createTuiElicitHost();
    const a = host.bridge.onElicit(request(schema));
    host.decline();
    await expect(a).resolves.toEqual({ action: "decline" });
    const b = host.bridge.onElicit(request(schema));
    const c = host.bridge.onElicit(request(schema));
    host.cancelAll();
    await expect(b).resolves.toEqual({ action: "cancel" });
    await expect(c).resolves.toEqual({ action: "cancel" });
    expect(host.current()).toBeNull();
  });

  it("drives a real form through the picker keys", () => {
    const qs = elicitationToQuestions(schema);
    const s = [
      ...typed("acme"),
      { type: "enter" } as const,
      ...typed("4"),
      { type: "enter" } as const,
      { type: "char", char: "2" } as const,
      { type: "char", char: "1" } as const,
      { type: "char", char: "1" } as const,
      { type: "enter" } as const,
    ].reduce(reduceAskPicker, createAskPickerState(qs));
    expect(s.outcome).toBe("answer");
    expect(answersToElicitContent(schema, s.answers)).toEqual({
      content: { name: "acme", seats: 4, region: "us", public: true, tags: ["a"] },
    });
  });
});
