interface UiSlashCommandActions {
  openModelSelector: () => void;
  /** `/model <provider:model | model>`; returns an error message, or null. */
  switchModel: (target: string) => string | null;
  showInfo: (text: string) => void;
  compactConversation: (focus?: string) => Promise<void>;
  quit: () => void;
  clearSession: () => void;
  openThemeSelector: () => void;
  toggleMarkdown: () => void;
  clearApprovedPlan: () => void;
}

export async function handleUiSlashCommand(
  trimmed: string,
  actions: UiSlashCommandActions,
): Promise<boolean> {
  const model = /^\/(?:model|models|m)(?:\s+(\S+))?$/.exec(trimmed);
  if (model) {
    if (!model[1]) {
      actions.openModelSelector();
      return true;
    }
    const error = actions.switchModel(model[1]);
    if (error) actions.showInfo(error);
    return true;
  }

  const compact = /^\/(?:compact|c)(?:\s+([\s\S]*))?$/.exec(trimmed);
  if (compact) {
    await actions.compactConversation(compact[1]?.trim() || undefined);
    return true;
  }

  if (trimmed === "/quit" || trimmed === "/q" || trimmed === "/exit") {
    actions.quit();
    return true;
  }

  if (trimmed === "/clear") {
    actions.clearSession();
    return true;
  }

  if (trimmed === "/theme" || trimmed === "/t") {
    actions.openThemeSelector();
    return true;
  }

  if (trimmed === "/markdown" || trimmed === "/md") {
    actions.toggleMarkdown();
    return true;
  }

  if (trimmed === "/clearplan") {
    actions.clearApprovedPlan();
    return true;
  }

  return false;
}
