// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SidecarEvent } from "./agent";
import { PHONE_DRAFT_DEBOUNCE_MS, usePhoneControl } from "./usePhoneControl";

vi.mock("./agent", () => ({ subscribe: () => () => {}, reportPhone: () => {} }));

function setup() {
  let emit: (e: SidecarEvent) => void = () => {};
  const subscribeEvents = (fn: (e: SidecarEvent) => void) => {
    emit = fn;
    return () => {};
  };
  const report = vi.fn();
  const cancel = vi.fn();
  const sent: string[] = [];
  const plan = { accept: vi.fn(), feedback: vi.fn(), reject: vi.fn() };
  const hook = renderHook(() => {
    const [input, setInput] = useState("");
    // Like App's submit: reads the rendered input, clears the composer.
    const submitRef = {
      current: () => {
        sent.push(input);
        setInput("");
      },
    };
    usePhoneControl({
      input,
      setDraft: setInput,
      submitRef,
      cancel,
      plan,
      subscribeEvents,
      report,
    });
    return { input, setInput };
  });
  return { hook, emit: (e: SidecarEvent) => act(() => emit(e)), report, cancel, sent, plan };
}

afterEach(() => vi.useRealTimers());

describe("usePhoneControl", () => {
  it("shows a phone draft without echoing it back", () => {
    vi.useFakeTimers();
    const t = setup();
    t.emit({ type: "phone_draft", data: { text: "from phone" } });
    expect(t.hook.result.current.input).toBe("from phone");
    act(() => vi.advanceTimersByTime(PHONE_DRAFT_DEBOUNCE_MS * 2));
    expect(t.report).not.toHaveBeenCalledWith({ draft: "from phone" });
  });

  it("reports hand edits, debounced", () => {
    vi.useFakeTimers();
    const t = setup();
    act(() => t.hook.result.current.setInput("h"));
    act(() => t.hook.result.current.setInput("hi"));
    expect(t.report).not.toHaveBeenCalledWith({ draft: "hi" });
    act(() => vi.advanceTimersByTime(PHONE_DRAFT_DEBOUNCE_MS));
    expect(t.report).toHaveBeenCalledWith({ draft: "hi" });
    expect(t.report).not.toHaveBeenCalledWith({ draft: "h" });
  });

  it("sends exactly as Enter does, without echoing the clear", () => {
    vi.useFakeTimers();
    const t = setup();
    t.emit({ type: "phone_send", data: { text: "run it" } });
    expect(t.sent).toEqual(["run it"]);
    expect(t.hook.result.current.input).toBe("");
    act(() => vi.advanceTimersByTime(PHONE_DRAFT_DEBOUNCE_MS * 2));
    expect(t.report.mock.calls.filter(([r]) => "draft" in r)).toEqual([]);
  });

  it("stops the run on abort", () => {
    const t = setup();
    t.emit({ type: "phone_abort", data: {} });
    expect(t.cancel).toHaveBeenCalledOnce();
  });

  it("runs the phone's plan decision through the window's buttons", () => {
    const t = setup();
    t.emit({ type: "phone_plan", data: { decision: "accept" } });
    t.emit({ type: "phone_plan", data: { decision: "feedback", feedback: "fewer steps" } });
    t.emit({ type: "phone_plan", data: { decision: "feedback", feedback: "" } });
    t.emit({ type: "phone_plan", data: { decision: "reject" } });
    expect(t.plan.accept).toHaveBeenCalledOnce();
    expect(t.plan.feedback.mock.calls).toEqual([["fewer steps"]]);
    expect(t.plan.reject).toHaveBeenCalledOnce();
  });
});
