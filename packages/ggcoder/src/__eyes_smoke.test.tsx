import React from "react";
import { render } from "ink";
import { Writable } from "node:stream";
import { describe, it, expect } from "vitest";
import { EyesOverlay } from "./ui/components/EyesOverlay.js";
import { TaskOverlay } from "./ui/components/TaskOverlay.js";
import { ThemeContext } from "./ui/theme/theme.js";
import darkTheme from "./ui/theme/dark.json" with { type: "json" };

function makeSink() {
  const sink = new Writable({ write(_c, _e, cb) { cb(); } });
  (sink as unknown as { columns: number }).columns = 100;
  (sink as unknown as { rows: number }).rows = 30;
  (sink as unknown as { isTTY: boolean }).isTTY = true;
  return sink;
}

describe("overlay smoke", () => {
  it("EyesOverlay renders against test journal", () => {
    const cwd = "/tmp/eyes-smoke-test";
    const instance = render(
      React.createElement(
        ThemeContext.Provider,
        { value: darkTheme as never },
        React.createElement(EyesOverlay, {
          cwd,
          onClose: () => {},
          onQueueMessage: () => {},
        }),
      ),
      { stdout: makeSink() as never, debug: false, exitOnCtrlC: false, patchConsole: false },
    );
    instance.unmount();
    expect(true).toBe(true);
  });

  it("TaskOverlay renders", () => {
    const instance = render(
      React.createElement(
        ThemeContext.Provider,
        { value: darkTheme as never },
        React.createElement(TaskOverlay, {
          cwd: "/tmp/eyes-smoke-test",
          onClose: () => {},
          onWorkOnTask: () => {},
          onRunAllTasks: () => {},
          agentRunning: false,
        }),
      ),
      { stdout: makeSink() as never, debug: false, exitOnCtrlC: false, patchConsole: false },
    );
    instance.unmount();
    expect(true).toBe(true);
  });
});
