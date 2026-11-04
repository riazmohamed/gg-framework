import { useState } from "react";
import { theme } from "./theme";
import type { InboxItem } from "./agent";

/**
 * Strip above the composer offering a message another local tool left for this
 * project (the app inbox, ggcoder `core/app-inbox.ts`), such as the autopilot
 * handing over a task. Nothing is sent until the user clicks Send, and Send
 * waits while a run is active, so a hand-off never steers work in progress.
 * Shows the oldest message; the rest wait their turn behind a count.
 *
 * Reuses the `.queued-bar*` classes so it looks like the other composer strips.
 */

interface Props {
  items: readonly InboxItem[] | undefined;
  running: boolean;
  onSend: (item: InboxItem) => Promise<void> | void;
  onDismiss: (item: InboxItem) => Promise<void> | void;
}

export function InboxBar({ items, running, onSend, onDismiss }: Props): React.ReactElement | null {
  const [busyId, setBusyId] = useState<string | null>(null);
  const item = items?.[0];
  if (!item) return null;
  const more = (items?.length ?? 1) - 1;
  const busy = busyId === item.id;

  const act = (fn: (i: InboxItem) => Promise<void> | void): void => {
    setBusyId(item.id);
    void Promise.resolve(fn(item)).finally(() => setBusyId(null));
  };

  return (
    <div
      className="queued-bar"
      role="status"
      aria-label={`Message from ${item.from}`}
      style={{ borderColor: theme.border, color: theme.textMuted }}
    >
      <div className="queued-bar-row">
        <span className="queued-bar-text" title={item.text}>
          {item.from}: {item.title}
          {more > 0 ? ` (${more} more waiting)` : ""}
        </span>
        <button
          type="button"
          className="queued-toggle"
          style={{ color: theme.secondary }}
          disabled={running || busy}
          title={running ? "Waits until GG finishes the current run" : `Send: ${item.text}`}
          onClick={() => act(onSend)}
        >
          Send
        </button>
        <button
          type="button"
          className="queued-toggle"
          style={{ color: theme.textDim }}
          disabled={busy}
          title="Remove this message without sending it"
          onClick={() => act(onDismiss)}
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
