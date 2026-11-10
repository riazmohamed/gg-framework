import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { reportPhone, subscribe, type SidecarEvent } from "./agent";

/** How long the composer must sit still before a hand edit is reported. */
export const PHONE_DRAFT_DEBOUNCE_MS = 100;

export interface PhoneControlOptions {
  /** The composer's current text. */
  input: string;
  /** Put text in the composer, caret at the end. */
  setDraft: (text: string) => void;
  /** The composer's Enter: always the latest render's submit. */
  submitRef: { current: () => void };
  /** The stop button. */
  cancel: () => void;
  /** The window's own plan review buttons (Accept / Feedback / Reject). */
  plan: PhonePlanActions;
  subscribeEvents?: (onEvent: (e: SidecarEvent) => void) => () => void;
  report?: (report: { draft?: string; focused?: boolean }) => void;
}

export interface PhonePlanActions {
  accept: () => void;
  feedback: (feedback: string) => void;
  reject: () => void;
}

/** Run the phone's plan decision through the window's own button logic. */
export function applyPhonePlan(data: unknown, actions: PhonePlanActions): void {
  if (!data || typeof data !== "object") return;
  const { decision, feedback } = data as { decision?: unknown; feedback?: unknown };
  if (decision === "accept") actions.accept();
  else if (decision === "reject") actions.reject();
  else if (decision === "feedback" && typeof feedback === "string" && feedback.trim()) {
    actions.feedback(feedback);
  }
}

function textOf(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const text = (data as { text?: unknown }).text;
  return typeof text === "string" ? text : null;
}

/**
 * The window's side of phone control (pew2): applies the phone's draft, send
 * and stop to this window, and reports hand edits of the composer and window
 * focus back to the sidecar. Text the phone put in the composer is not
 * reported back to it.
 */
export function usePhoneControl({
  input,
  setDraft,
  submitRef,
  cancel,
  plan,
  subscribeEvents = subscribe,
  report = reportPhone,
}: PhoneControlOptions): void {
  // Composer text that came from the phone, so it is not echoed back.
  const remoteRef = useRef<string | null>(null);
  const lastSeenRef = useRef(input);
  const pendingSendRef = useRef<string | null>(null);
  const [sendNonce, setSendNonce] = useState(0);
  const cancelRef = useRef(cancel);
  const setDraftRef = useRef(setDraft);
  const reportRef = useRef(report);
  const planRef = useRef(plan);
  useLayoutEffect(() => {
    planRef.current = plan;
    cancelRef.current = cancel;
    setDraftRef.current = setDraft;
    reportRef.current = report;
  });

  useEffect(
    () =>
      subscribeEvents((e) => {
        if (e.type === "phone_draft" || e.type === "phone_send") {
          const text = textOf(e.data);
          if (text === null) return;
          remoteRef.current = text;
          setDraftRef.current(text);
          if (e.type === "phone_send") {
            pendingSendRef.current = text;
            setSendNonce((n) => n + 1);
          }
        } else if (e.type === "phone_abort") {
          cancelRef.current();
        } else if (e.type === "phone_plan") {
          applyPhonePlan(e.data, planRef.current);
        }
      }),
    [subscribeEvents],
  );

  useEffect(() => {
    if (input === lastSeenRef.current) return;
    lastSeenRef.current = input;
    if (remoteRef.current !== null && input === remoteRef.current) {
      remoteRef.current = null;
      return;
    }
    remoteRef.current = null;
    const timer = setTimeout(() => reportRef.current({ draft: input }), PHONE_DRAFT_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [input]);

  // Declared after the draft report so the phone text is already marked seen.
  // Send after the render that put the phone's text in the composer, so the
  // submit that runs is exactly the one Enter would run.
  useEffect(() => {
    if (pendingSendRef.current === null) return;
    pendingSendRef.current = null;
    // The composer clears on send; that clear came from the phone too.
    remoteRef.current = "";
    submitRef.current();
  }, [sendNonce, submitRef]);

  useEffect(() => {
    const onFocus = (): void => reportRef.current({ focused: true });
    const onBlur = (): void => reportRef.current({ focused: false });
    window.addEventListener("focus", onFocus);
    window.addEventListener("blur", onBlur);
    if (document.hasFocus()) onFocus();
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("blur", onBlur);
    };
  }, []);
}
