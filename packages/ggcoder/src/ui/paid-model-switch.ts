import { PaidModelConfirmationError } from "../core/agent-session.js";
import { getModel } from "../core/model-registry.js";
import { CONFIRM_PAID_FLAG } from "../core/slash-commands.js";

/**
 * The TUI switches models itself rather than through
 * `AgentSession.switchModel`, so it applies the same rule here: a model that
 * spends real money (Claude fast mode, MiMo UltraSpeed) needs the user's
 * explicit yes. Returns the refusal, or null when the switch may go ahead.
 *
 * `value` is `provider:model` as `resolveModelTarget` returns it. Staying on
 * the model already in use is never refused.
 */
export function unconfirmedPaidSwitch(
  value: string,
  currentModel: string,
  confirmPaid: boolean,
): PaidModelConfirmationError | null {
  if (confirmPaid) return null;
  const id = value.slice(value.indexOf(":") + 1);
  if (id === currentModel) return null;
  const target = getModel(id);
  if (!target?.billing?.paid) return null;
  return new PaidModelConfirmationError(target.name, target.billing.detail);
}

/** The `/model <target>` reply when the confirmation flag is missing. */
export function paidSwitchHint(error: PaidModelConfirmationError, target: string): string {
  return `${error.message}\nIt stays on for this session only. To use it, run: /model ${target} ${CONFIRM_PAID_FLAG}, or pick it in /model and confirm.`;
}
