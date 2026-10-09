import { describe, expect, it } from "vitest";
import type { AskQuestion } from "../core/ask-user.js";
import { createAskPickerState, reduceAskPicker, type AskPickerKey } from "./ask-user-state.js";
import { createTuiAskUserHost } from "./ask-user-host.js";

const press = (questions: AskQuestion[], keys: AskPickerKey[]) =>
  keys.reduce(reduceAskPicker, createAskPickerState(questions));
const type = (text: string): AskPickerKey[] => [...text].map((char) => ({ type: "char", char }));

const choice: AskQuestion = {
  id: "db",
  question: "Which database?",
  kind: "choice",
  options: [{ label: "Postgres", value: "pg" }, { label: "SQLite" }],
};

describe("ask_user picker state", () => {
  it("picks with arrows + Enter, returning the option value or label", () => {
    expect(press([choice], [{ type: "enter" }]).answers).toEqual({ db: "pg" });
    const s = press([choice], [{ type: "down" }, { type: "enter" }]);
    expect(s.outcome).toBe("answer");
    expect(s.answers).toEqual({ db: "SQLite" });
  });

  it("picks outright with a number key", () => {
    expect(press([choice], [{ type: "char", char: "2" }]).answers).toEqual({ db: "SQLite" });
  });

  it("offers a free-text row unless allowOther is false", () => {
    const typed = press(
      [choice],
      [{ type: "char", char: "3" }, ...type("Mongo"), { type: "enter" }],
    );
    expect(typed.answers).toEqual({ db: "Mongo" });
    const closed = { ...choice, allowOther: false };
    expect(press([closed], [{ type: "up" }]).cursor).toBe(1);
    expect(press([closed], [{ type: "char", char: "3" }]).outcome).toBeUndefined();
  });

  it("checks several options on multi and confirms them in order", () => {
    const multi: AskQuestion = {
      id: "targets",
      question: "Where?",
      kind: "multi",
      options: [{ label: "web" }, { label: "ios" }, { label: "android" }],
    };
    const s = press(
      [multi],
      [
        { type: "down" },
        { type: "down" },
        { type: "space" },
        { type: "char", char: "1" },
        { type: "enter" },
      ],
    );
    expect(s.answers).toEqual({ targets: ["web", "android"] });
  });

  it("opens text questions straight into typing; empty Enter does nothing", () => {
    const text: AskQuestion = { id: "name", question: "Name?", kind: "text" };
    expect(press([text], [{ type: "enter" }]).outcome).toBeUndefined();
    const s = press(
      [text],
      [...type("acmx"), { type: "backspace" }, ...type("e"), { type: "enter" }],
    );
    expect(s.answers).toEqual({ name: "acme" });
    expect(press([text], [{ type: "escape" }]).outcome).toBe("dismiss");
  });

  it("walks through several questions, and Esc dismisses", () => {
    const confirm: AskQuestion = {
      id: "ok",
      question: "Proceed?",
      kind: "confirm",
      options: [
        { label: "Yes", value: "yes" },
        { label: "No", value: "no" },
      ],
    };
    const s = press([choice, confirm], [{ type: "enter" }, { type: "down" }, { type: "enter" }]);
    expect(s.answers).toEqual({ db: "pg", ok: "no" });
    expect(press([choice, confirm], [{ type: "enter" }, { type: "escape" }]).outcome).toBe(
      "dismiss",
    );
  });
});

describe("TUI ask_user host", () => {
  it("shows the parked question and settles it with the answer", async () => {
    const host = createTuiAskUserHost();
    const seen: Array<string | null> = [];
    host.subscribe(() => seen.push(host.current()?.prompt.id ?? null));
    const result = host.bridge.park({ questions: [choice] });
    expect(host.current()?.prompt.questions[0].id).toBe("db");
    host.answer({ db: "pg" });
    await expect(result).resolves.toEqual({ action: "answer", answers: { db: "pg" } });
    expect(host.current()).toBeNull();
    expect(seen).toEqual(["ask-1", null]);
  });

  it("dismiss and cancelAll release the turn", async () => {
    const host = createTuiAskUserHost();
    const a = host.bridge.park({ questions: [choice] });
    host.dismiss();
    await expect(a).resolves.toEqual({ action: "cancel" });
    const b = host.bridge.park({ questions: [choice] });
    host.cancelAll();
    await expect(b).resolves.toEqual({ action: "cancel" });
    expect(host.current()).toBeNull();
  });

  it("keeps a timed-out question open and sends a late answer as a message", async () => {
    const host = createTuiAskUserHost(5);
    const late: string[] = [];
    host.onLateAnswer = (text) => late.push(text);
    await expect(host.bridge.park({ questions: [choice] })).resolves.toEqual({
      action: "deferred",
    });
    expect(host.current()?.deferred).toBe(true);
    host.answer({ db: "pg" });
    expect(late[0]).toContain("Late answer to: Which database?");
    expect(late[0]).toContain("→ pg");
  });
});
