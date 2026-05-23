import { describe, expect, it } from "vitest";
import { getFooterStatusLayoutDecision } from "./components/BackgroundTasksBar.js";

describe("footer status layout decisions", () => {
  it("keeps a single wide row when all footer status indicators are present", () => {
    expect(
      getFooterStatusLayoutDecision({
        columns: 140,
        backgroundTaskCount: 2,
        eyesCount: 3,
        updatePending: true,
      }),
    ).toEqual({
      hasBackgroundTasks: true,
      hasEyesSignals: true,
      hasUpdateNotice: true,
      stack: false,
      compactBackgroundTasks: false,
    });
  });

  it("uses compact background task copy before stacking is needed", () => {
    expect(
      getFooterStatusLayoutDecision({
        columns: 110,
        backgroundTaskCount: 1,
        eyesCount: 1,
        updatePending: true,
      }),
    ).toMatchObject({
      stack: false,
      compactBackgroundTasks: true,
    });
  });

  it("stacks crowded status indicators on narrow terminals to avoid collisions", () => {
    expect(
      getFooterStatusLayoutDecision({
        columns: 80,
        backgroundTaskCount: 1,
        eyesCount: 2,
        updatePending: true,
      }),
    ).toEqual({
      hasBackgroundTasks: true,
      hasEyesSignals: true,
      hasUpdateNotice: true,
      stack: true,
      compactBackgroundTasks: true,
    });
  });

  it("does not stack a lone update notice", () => {
    expect(
      getFooterStatusLayoutDecision({
        columns: 60,
        backgroundTaskCount: 0,
        updatePending: true,
      }),
    ).toMatchObject({
      hasBackgroundTasks: false,
      hasEyesSignals: false,
      hasUpdateNotice: true,
      stack: false,
    });
  });
});
