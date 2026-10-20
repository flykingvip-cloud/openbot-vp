import { isCronSessionKey } from "../../../../../../src/sessions/session-key-utils.ts";
import { t } from "../../../../i18n/index.ts";
import {
  isBuiltinStewardEntry,
  sessionKeyMatchesBuiltinSteward,
  type StewardSessionDefaults,
} from "../../../builtin-steward-selection.ts";
import { isBareUuidLabel } from "../employee-workbench-agent-scope.ts";
import { formatWorkbenchSidebarDisplayName } from "./workbench-display-name.ts";
import type { WorkbenchTeamEntry } from "./workbench-home-model.ts";
import type { WorkbenchPrimaryModule } from "./workbench-types.ts";

export type WorkbenchNavTone = "violet" | "indigo" | "blue" | "cyan" | "teal" | "green" | "amber";
export type WorkbenchNavIconKey =
  | "sparkles"
  | "brain"
  | "messageSquare"
  | "zap"
  | "star"
  | "radio"
  | "mic"
  | "users"
  | "messagesSquare"
  | "calendar"
  | "clipboardCheck"
  | "book"
  | "settings";

export type WorkbenchNavItem = {
  id: string;
  selectionKey: string;
  title: string;
  rawTitle?: string;
  subtitle?: string;
  iconKey: WorkbenchNavIconKey;
  tone: WorkbenchNavTone;
  module: WorkbenchPrimaryModule;
  active?: boolean;
  count?: number | null;
  expandable?: boolean;
  sourceKey?: string | null;
  directoryChannelId?: string | null;
  directoryGroupId?: string | null;
  /**
   * All sessions that contribute to this nav item's unread badge. The shell
   * uses these to acknowledge "read" across every sibling session when the
   * user opens the entry, otherwise the badge stays stuck because clicking
   * only marks the primary `selectionKey` as seen. See
   * `workbench-actions.ts:runWorkbenchNavSelection`.
   */
  sessionKeys?: readonly string[];
};

export type WorkbenchAssistantNavItem = WorkbenchNavItem & {
  module: "assistant";
};

export type WorkbenchSpaceNavItem = WorkbenchNavItem & {
  module: "collaboration";
};

export type WorkbenchModuleItem = {
  id: "tasks" | "knowledge" | "settings";
  title: string;
  active: boolean;
  iconKey: WorkbenchNavIconKey;
  tone: WorkbenchNavTone;
};

export type WorkbenchNavModel = {
  assistantItems: WorkbenchAssistantNavItem[];
  spaceItems: WorkbenchSpaceNavItem[];
  moduleItems: WorkbenchModuleItem[];
};

const DAIBAI_NAV_ITEM = {
  iconKey: "brain" as const,
  tone: "violet" as const,
};
const ASSISTANT_NAV_ICON_CYCLE: Array<Pick<WorkbenchNavItem, "iconKey" | "tone">> = [
  { iconKey: "sparkles", tone: "violet" },
  { iconKey: "messageSquare", tone: "indigo" },
  { iconKey: "zap", tone: "indigo" },
  { iconKey: "star", tone: "blue" },
  { iconKey: "radio", tone: "cyan" },
  { iconKey: "mic", tone: "cyan" },
];

function entryIsActive(entry: WorkbenchTeamEntry | null | undefined, activeSessionKey: string) {
  if (!entry) {
    return false;
  }
  return entry.key === activeSessionKey || entry.sessionKeys.includes(activeSessionKey);
}

/**
 * Space-active check (Q2 根因修复）。内置大白（大白管家，agent "main"）被复用在「1:1 会话」
 * 和它参与的每一个协作小组里，所以它的 1:1 会话键可能被 collectSpaceSessionKeys 折叠进某个
 * 协作空间的 sessionKeys。打开大白 1:1 时，绝不能因此把某个协作空间标记为 active —— 否则
 * stage 头部/模块会解析成「TO: <协作组>」盖在大白对话之上（这正是反复复发的 bug 根源）。
 * 协作空间仅对「非大白入口」的 activeSessionKey 判定为 active。
 */
function spaceEntryIsActive(
  entry: WorkbenchTeamEntry | null | undefined,
  activeSessionKey: string,
  sessionDefaults: StewardSessionDefaults,
) {
  if (!entry) {
    return false;
  }
  if (sessionKeyMatchesBuiltinSteward(activeSessionKey, sessionDefaults)) {
    return false;
  }
  return entry.key === activeSessionKey || entry.sessionKeys.includes(activeSessionKey);
}

function filterNonCronSessionKeys(sessionKeys: string[]) {
  const nonCronSessionKeys = sessionKeys.filter((key) => !isCronSessionKey(key));
  return nonCronSessionKeys.length > 0 ? nonCronSessionKeys : sessionKeys;
}

function isSpaceScopedSessionKey(key: string) {
  return key.startsWith("space:") || key.includes(":space:");
}

function resolveAssistantSourceKey(entry: WorkbenchTeamEntry) {
  const assistantSessionKeys = filterNonCronSessionKeys(entry.sessionKeys);
  return (
    assistantSessionKeys.find((key) => key === entry.key) ??
    assistantSessionKeys.find((key) => !isSpaceScopedSessionKey(key)) ??
    assistantSessionKeys.find((key) => !key.startsWith("space:")) ??
    assistantSessionKeys[0] ??
    null
  );
}

function buildSeededAssistants(
  assistants: WorkbenchTeamEntry[],
  activeSessionKey: string,
  sessionDefaults: StewardSessionDefaults = {},
): WorkbenchAssistantNavItem[] {
  const orderedAssistants = assistants
    .filter((entry) => !isBareUuidLabel(entry.title))
    .toSorted((left, right) => {
      const leftIsDaibai = isBuiltinStewardEntry(left, sessionDefaults);
      const rightIsDaibai = isBuiltinStewardEntry(right, sessionDefaults);
      if (leftIsDaibai !== rightIsDaibai) {
        return leftIsDaibai ? -1 : 1;
      }
      return 0;
    });

  let nonDaibaiIndex = 0;
  return orderedAssistants.map((entry) => {
    const visual = isBuiltinStewardEntry(entry, sessionDefaults)
      ? DAIBAI_NAV_ITEM
      : ASSISTANT_NAV_ICON_CYCLE[nonDaibaiIndex++ % ASSISTANT_NAV_ICON_CYCLE.length];
    return {
      id: isBuiltinStewardEntry(entry, sessionDefaults)
        ? "daibai"
        : `assistant:${entry.id || entry.key}`,
      selectionKey: entry.key,
      title: formatWorkbenchSidebarDisplayName(entry.title),
      rawTitle: entry.title,
      subtitle: entry.saved
        ? `${entry.subtitle} · ${t("frontstage.workbench.team.saved")}`
        : entry.subtitle,
      iconKey: visual.iconKey,
      tone: visual.tone,
      module: "assistant",
      active: entryIsActive(entry, activeSessionKey),
      count: entry.unreadCount > 0 ? entry.unreadCount : null,
      sourceKey: resolveAssistantSourceKey(entry),
      // Carry every session key so the shell can mark all of them as seen
      // when the user opens this assistant — otherwise the unread badge
      // would be stuck on noise from cron/dm/group sessions the user never
      // explicitly visited.
      sessionKeys: entry.sessionKeys,
    };
  });
}

function buildSeededSpaces(
  spaces: WorkbenchTeamEntry[],
  activeSessionKey: string,
  sessionDefaults: StewardSessionDefaults = {},
): WorkbenchSpaceNavItem[] {
  const iconCycle: Array<Pick<WorkbenchNavItem, "iconKey" | "tone">> = [
    { iconKey: "users", tone: "teal" },
    { iconKey: "messagesSquare", tone: "teal" },
    { iconKey: "calendar", tone: "green" },
    { iconKey: "clipboardCheck", tone: "amber" },
  ];
  const seenTitles = new Map<string, WorkbenchTeamEntry>();
  const uniqueSpaces: WorkbenchTeamEntry[] = [];

  for (const entry of spaces) {
    const normalizedTitle = entry.title.trim().toLowerCase();
    if (!seenTitles.has(normalizedTitle)) {
      seenTitles.set(normalizedTitle, entry);
      uniqueSpaces.push(entry);
    }
  }

  const resolvePreferredSourceKey = (entry: WorkbenchTeamEntry) =>
    filterNonCronSessionKeys(entry.sessionKeys).find((key) => !key.startsWith("space:")) ??
    filterNonCronSessionKeys(entry.sessionKeys).find((key) => key !== entry.key) ??
    filterNonCronSessionKeys(entry.sessionKeys)[0] ??
    null;

  return uniqueSpaces.map((entry, index) => {
    const icon = iconCycle[index % iconCycle.length];
    return {
      id: entry.id || entry.key,
      selectionKey: entry.key,
      title: formatWorkbenchSidebarDisplayName(entry.title),
      rawTitle: entry.title,
      subtitle: entry.saved
        ? `${entry.subtitle} · ${t("frontstage.workbench.team.saved")}`
        : entry.subtitle,
      iconKey: icon.iconKey,
      tone: icon.tone,
      module: "collaboration",
      active: spaceEntryIsActive(entry, activeSessionKey, sessionDefaults),
      count: entry.unreadCount > 0 ? entry.unreadCount : null,
      expandable: true,
      sourceKey: resolvePreferredSourceKey(entry),
      directoryChannelId: entry.channelId ?? null,
      directoryGroupId: entry.directoryGroupId ?? null,
      // See `buildSeededAssistants` — pass the full session list so the
      // shell can clear the unread badge across every session bound to this
      // collaboration space when the user opens it.
      sessionKeys: entry.sessionKeys,
    };
  });
}

function buildModuleItems(primaryModule: WorkbenchPrimaryModule): WorkbenchModuleItem[] {
  return [
    {
      id: "tasks",
      title: t("frontstage.workbench.nav.myTasks"),
      active: primaryModule === "tasks",
      iconKey: "clipboardCheck",
      tone: "teal",
    },
    {
      id: "knowledge",
      title: t("frontstage.workbench.nav.knowledgeVerse"),
      active: primaryModule === "knowledge",
      iconKey: "book",
      tone: "blue",
    },
    {
      id: "settings",
      title: t("frontstage.workbench.nav.systemSettings"),
      active: primaryModule === "settings",
      iconKey: "settings",
      tone: "indigo",
    },
  ];
}

export function buildWorkbenchNavModel(params: {
  assistants: WorkbenchTeamEntry[];
  spaces: WorkbenchTeamEntry[];
  activeSessionKey: string;
  primaryModule: WorkbenchPrimaryModule;
  sessionDefaults?: StewardSessionDefaults;
}): WorkbenchNavModel {
  const sessionDefaults = params.sessionDefaults ?? {};
  return {
    assistantItems: buildSeededAssistants(
      params.assistants,
      params.activeSessionKey,
      sessionDefaults,
    ),
    spaceItems: buildSeededSpaces(params.spaces, params.activeSessionKey, sessionDefaults),
    moduleItems: buildModuleItems(params.primaryModule),
  };
}
