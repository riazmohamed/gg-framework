// @vitest-environment jsdom
// Ready and installing render the same height in a real browser (36.5px; the
// percentage reserves the Install badge's box in App.css). jsdom has no
// layout, so that is checked in the browser, not here.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UpdateBanner } from "./UpdateBanner";
import type { UpdatePhase } from "./update";

const update = (phase: UpdatePhase, progress: number | null = null) => ({
  phase,
  version: "1.2.0",
  progress,
  install: vi.fn(async () => {}),
});

afterEach(cleanup);

describe("UpdateBanner", () => {
  it("renders nothing until an update is ready", () => {
    for (const phase of ["idle", "checking", "error"] as const) {
      const { container } = render(<UpdateBanner appUpdate={update(phase)} />);
      expect(container.innerHTML).toBe("");
      cleanup();
    }
  });

  it("installs when the bar is clicked; the critters are hidden from assistive tech", () => {
    const appUpdate = update("available");
    render(<UpdateBanner appUpdate={appUpdate} />);
    const button = screen.getByRole("button", { name: /Ken just updated GG Coder!/ });
    expect(button.getAttribute("title")).toContain("1.2.0");
    expect(button.querySelectorAll(".update-banner-critter")).toHaveLength(3);
    expect(button.querySelector(".update-banner-crew")?.getAttribute("aria-hidden")).toBe("true");
    fireEvent.click(button);
    expect(appUpdate.install).toHaveBeenCalledTimes(1);
  });

  it("keeps the same slot from ready to installing, so the entrance never replays", () => {
    const { rerender } = render(<UpdateBanner appUpdate={update("available")} />);
    const slot = document.querySelector(".update-banner-slot");
    rerender(<UpdateBanner appUpdate={update("installing", 42)} />);
    expect(document.querySelector(".update-banner-slot")).toBe(slot);
    const bar = screen.getByRole("progressbar", { name: "Downloading update" });
    expect(bar.getAttribute("aria-valuenow")).toBe("42");
    expect(bar.textContent).toBe("42%");
    // The crew marches at the front of the fill.
    expect((bar.querySelector(".update-banner-march") as HTMLElement).style.left).toBe("42%");
  });
});
