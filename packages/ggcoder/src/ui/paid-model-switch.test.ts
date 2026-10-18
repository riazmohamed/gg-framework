import { describe, expect, it } from "vitest";
import { paidSwitchHint, unconfirmedPaidSwitch } from "./paid-model-switch.js";

const FAST = "anthropic:claude-opus-5-5-fast";

describe("unconfirmedPaidSwitch", () => {
  it("refuses a paid model without the user's yes", () => {
    const error = unconfirmedPaidSwitch(FAST, "claude-opus-5-5", false);
    expect(error?.name).toBe("PaidModelConfirmationError");
    expect(error?.message).toContain("spends real money");
    expect(paidSwitchHint(error!, FAST)).toContain(`/model ${FAST} --confirm-paid`);
  });

  it("lets a confirmed paid switch, a standard model, or the current model through", () => {
    expect(unconfirmedPaidSwitch(FAST, "claude-opus-5-5", true)).toBeNull();
    expect(unconfirmedPaidSwitch("anthropic:claude-opus-5-5", "x", false)).toBeNull();
    expect(unconfirmedPaidSwitch(FAST, "claude-opus-5-5-fast", false)).toBeNull();
  });
});
