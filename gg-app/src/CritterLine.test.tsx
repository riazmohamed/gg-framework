// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CritterLine, CRITTER_TONE_COLOR, type CritterTone } from "./CritterLine";
import { CRITTERS } from "./critter-sprites";
import { theme } from "./theme";

const critter = CRITTERS[0];
if (!critter) throw new Error("critter roster is empty");

describe("CritterLine", () => {
  it.each([
    ["working", theme.critter, true],
    ["done", theme.success, false],
    ["failed", theme.error, false],
    ["stopped", theme.warning, false],
  ] as const)("%s: colours the text and shimmers only while working", (tone, color, shimmers) => {
    const { container } = render(<CritterLine critter={critter} tone={tone} text="A critter" />);
    const text = container.querySelector<HTMLElement>(".subagents-compact-text");
    const img = container.querySelector(".subagents-critter-img");
    expect(CRITTER_TONE_COLOR[tone satisfies CritterTone]).toBe(color);
    expect(text?.style.color).toBe(color);
    expect(container.querySelector(".shimmer-text") !== null).toBe(shimmers);
    expect(img?.classList.contains(`subagents-critter-${tone}`)).toBe(true);
    expect(text?.textContent).toBe("A critter");
  });
});
