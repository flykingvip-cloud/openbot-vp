type WorkbenchPrimaryModule = "assistant" | "collaboration" | "knowledge" | "settings" | "tasks";

export type WorkbenchNavSelection = {
  module: WorkbenchPrimaryModule;
  selectionKey: string;
  sourceKey?: string | null;
  /**
   * Sibling session keys that share this nav entry's unread badge. The badge
   * is computed from `unreadCount` over the entire `sessionKeys` array (see
   * `workbench-home-model.ts:countUnreadSessions`), so the only way to clear
   * it after the user clicks the entry is to bump `sessionSeenAt` for every
   * sibling session — otherwise a single noisy session keeps the count > 0
   * even after the user opens the assistant/space.
   */
  siblingSessionKeys?: readonly string[];
};

export type WorkbenchNavSelectionHandlers = {
  onPrimaryModuleChange: (module: WorkbenchPrimaryModule) => void;
  onTeamSelectedKeyChange: (key: string) => void;
  onSelectSession: (sessionKey: string) => void;
  /**
   * Optional follow-up the shell uses to mark sibling sessions as seen so the
   * unread badge resets after the user opens the entry. Implemented in
   * `render-model-shell-actions.ts`; older boundaries that don't wire it up
   * will silently skip the additional acknowledgement.
   */
  onAcknowledgeSiblingSessions?: (sessionKeys: readonly string[]) => void;
};

export type WorkbenchModuleSelectionHandlers = {
  onPrimaryModuleChange: (
    module: Exclude<WorkbenchPrimaryModule, "assistant" | "collaboration">,
  ) => void;
};

function resolveNavHistorySessionKey(selection: WorkbenchNavSelection): string {
  const selectionKey = selection.selectionKey.trim();
  const sourceKey = selection.sourceKey?.trim() ?? "";
  if (selection.module === "collaboration" && /:space:/i.test(sourceKey)) {
    return sourceKey;
  }
  return selectionKey;
}

export function runWorkbenchNavSelection(
  selection: WorkbenchNavSelection,
  handlers: WorkbenchNavSelectionHandlers,
) {
  handlers.onPrimaryModuleChange(selection.module);
  const sessionKey = resolveNavHistorySessionKey(selection);
  // Switch the chat surface first with the real transcript key, then restore
  // the nav alias. Calling highlight-first used to start a slow `space:` history
  // load and immediately invalidate it with a second switch.
  handlers.onSelectSession(sessionKey);
  handlers.onTeamSelectedKeyChange(selection.selectionKey);
  // After the active session is switched, also mark every sibling session as
  // seen. Without this the badge stays stuck — selecting one agent session
  // only updates that key, but the nav badge counts unread updates across
  // all of that agent's sessions (cron jobs, group chats, dm sessions...).
  const siblingKeys = (selection.siblingSessionKeys ?? []).filter((key) => {
    if (typeof key !== "string") {
      return false;
    }
    const trimmed = key.trim();
    if (!trimmed) {
      return false;
    }
    return trimmed !== sessionKey && trimmed !== selection.selectionKey.trim();
  });
  if (siblingKeys.length > 0) {
    handlers.onAcknowledgeSiblingSessions?.(siblingKeys);
  }
}

export function runWorkbenchModuleSelection(
  module: Exclude<WorkbenchPrimaryModule, "assistant" | "collaboration">,
  handlers: WorkbenchModuleSelectionHandlers,
) {
  handlers.onPrimaryModuleChange(module);
}
