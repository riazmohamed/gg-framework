import { useEffect, useState } from "react";
import { DeviceMobileIcon } from "@phosphor-icons/react";
import { theme } from "./theme";
import { Badge } from "./Badge";
import { getPhoneControl, setPhoneControl } from "./agent";
import { toast } from "./toast";
import { useSettingsPageReady } from "./settings-ready";

/**
 * Settings switch for phone control (pew2), shaped like Keep awake. Off by
 * default. Saved by the sidecar, which writes or removes the discovery file at once.
 */
export function PhoneControlButton(): React.ReactElement {
  // null until the sidecar answers; the setting defaults to off.
  const [on, setOn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [read, setRead] = useState(false);
  // The switch is disabled (and assumes Off) until the sidecar answers.
  useSettingsPageReady(read);

  useEffect(() => {
    let cancelled = false;
    void getPhoneControl()
      .then((enabled) => {
        if (!cancelled) setOn(enabled);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setRead(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function toggle(): Promise<void> {
    if (on === null || busy) return;
    setBusy(true);
    try {
      setOn(await setPhoneControl(!on));
    } catch (e) {
      toast(`Couldn't save: ${e instanceof Error ? e.message : String(e)}`, "error");
    } finally {
      setBusy(false);
    }
  }

  const checked = on ?? false;
  return (
    <>
      <button
        className="modal-btn"
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={on === null || busy}
        title={
          checked
            ? "On. The pew2 phone app can open chats here and type into them."
            : "Off. The pew2 phone app can't reach this app."
        }
        style={checked ? undefined : { color: theme.textMuted }}
        onClick={() => void toggle()}
      >
        <DeviceMobileIcon size={16} aria-hidden="true" />
        Phone control
      </button>
      <Badge color={checked ? theme.success : theme.textMuted}>{checked ? "On" : "Off"}</Badge>
    </>
  );
}
