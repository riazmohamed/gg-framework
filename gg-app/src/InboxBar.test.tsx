// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { InboxItem } from "./agent";
import { InboxBar } from "./InboxBar";

const item = (id: string, title: string): InboxItem => ({
  id,
  from: "Autopilot",
  title,
  text: `/autopilot take ${id}`,
  createdAt: 1,
});

afterEach(() => cleanup());

describe("InboxBar", () => {
  it("shows nothing for an empty inbox", () => {
    const { container } = render(
      <InboxBar items={[]} running={false} onSend={vi.fn()} onDismiss={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("offers the oldest message and counts the rest", async () => {
    const onSend = vi.fn();
    render(
      <InboxBar
        items={[item("1", "Fix the export"), item("2", "Next")]}
        running={false}
        onSend={onSend}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.getByText("Autopilot: Fix the export (1 more waiting)")).toBeTruthy();
    // The button settles its busy state after the handler resolves.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Send" }));
    });
    expect(onSend).toHaveBeenCalledWith(item("1", "Fix the export"));
  });

  it("holds Send during a run but still allows Dismiss", async () => {
    const onSend = vi.fn();
    const onDismiss = vi.fn();
    render(<InboxBar items={[item("1", "Fix")]} running onSend={onSend} onDismiss={onDismiss} />);
    const send = screen.getByRole("button", { name: "Send" }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    });
    expect(onDismiss).toHaveBeenCalledOnce();
    expect(onSend).not.toHaveBeenCalled();
  });
});
