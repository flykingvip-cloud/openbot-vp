import { t } from "../../../../i18n/index.ts";
import type { FrontstageSessionCard } from "../../../data/frontstage-session-cards.ts";
import type { WorkbenchSidebarItem, WorkbenchTeamEntry } from "./workbench-home-model.ts";

export type WorkbenchModuleTone = "default" | "ok" | "warn";

export type WorkbenchTaskEntry = {
  id: string;
  title: string;
  detail: string;
  meta: string;
  badge: string;
  tone: WorkbenchModuleTone;
  sessionKey: string;
};

export type WorkbenchFavoriteEntry = {
  id: string;
  key: string;
  sessionKey: string;
  title: string;
  detail: string;
  meta: string;
  badge: string;
  kind: WorkbenchTeamEntry["kind"];
  saved: boolean;
};

export type WorkbenchTaskModule = {
  followupCount: number;
  delegationCount: number;
  backlogCount: number;
  followups: WorkbenchTaskEntry[];
  delegations: WorkbenchTaskEntry[];
  backlog: WorkbenchTaskEntry[];
};

export type WorkbenchFavoritesModule = {
  savedCount: number;
  assistantCount: number;
  memberCount: number;
  spaceCount: number;
  saved: WorkbenchFavoriteEntry[];
  suggestions: WorkbenchFavoriteEntry[];
};

export type WorkbenchModuleBundle = {
  tasks: WorkbenchTaskModule;
  favorites: WorkbenchFavoritesModule;
};

export type WorkbenchModuleBundleInput = {
  agents: WorkbenchSidebarItem[];
  contacts: WorkbenchSidebarItem[];
  groups: WorkbenchSidebarItem[];
  recentSessions: FrontstageSessionCard[];
  teamAssistants: WorkbenchTeamEntry[];
  teamMembers: WorkbenchTeamEntry[];
  teamSpaces: WorkbenchTeamEntry[];
};

function favoriteEntryFromTeam(entry: WorkbenchTeamEntry): WorkbenchFavoriteEntry {
  return {
    id: entry.id,
    key: entry.key,
    sessionKey: entry.key,
    title: entry.title,
    detail: entry.detail,
    meta: entry.meta,
    badge: entry.badge,
    kind: entry.kind,
    saved: entry.saved,
  };
}

function taskEntryFromSidebar(
  item: WorkbenchSidebarItem,
  tone: WorkbenchModuleTone,
): WorkbenchTaskEntry {
  return {
    id: item.key,
    title: item.title,
    detail: item.preview,
    meta: item.meta,
    badge: item.badge,
    tone,
    sessionKey: item.key,
  };
}

function taskEntryFromSession(session: FrontstageSessionCard): WorkbenchTaskEntry {
  return {
    id: session.key,
    title: session.title,
    detail: session.subtitle || session.chatType,
    meta: t("frontstage.workbench.dashboard.taskLabels.sessionBacklog"),
    badge: session.title.slice(0, 2).toUpperCase(),
    tone: "default",
    sessionKey: session.key,
  };
}

export function buildWorkbenchModuleBundle(
  input: WorkbenchModuleBundleInput,
): WorkbenchModuleBundle {
  const followups = input.contacts
    .filter((item) => item.unreadCount > 0 || item.activity !== "idle")
    .toSorted((left, right) => {
      if (left.unreadCount !== right.unreadCount) {
        return right.unreadCount - left.unreadCount;
      }
      return (right.updatedAt ?? 0) - (left.updatedAt ?? 0);
    })
    .slice(0, 4)
    .map((item) => taskEntryFromSidebar(item, item.unreadCount > 0 ? "warn" : "ok"));

  const delegations =
    input.teamAssistants.length > 0
      ? input.teamAssistants.slice(0, 4).map((entry) => ({
          id: entry.id,
          title: entry.title,
          detail: entry.detail,
          meta: `${t("frontstage.workbench.dashboard.taskLabels.delegate")} · ${entry.meta}`,
          badge: entry.badge,
          tone: "ok" as const,
          sessionKey: entry.key,
        }))
      : input.agents
          .filter((item) => item.key !== "main")
          .slice(0, 4)
          .map((item) => taskEntryFromSidebar(item, "ok"));

  const backlog = input.recentSessions
    .filter((session) => !followups.some((item) => item.sessionKey === session.key))
    .slice(0, 4)
    .map((session) => taskEntryFromSession(session));

  const allFavorites = [...input.teamAssistants, ...input.teamMembers, ...input.teamSpaces]
    .map((entry) => favoriteEntryFromTeam(entry))
    .toSorted((left, right) => {
      if (left.saved !== right.saved) {
        return left.saved ? -1 : 1;
      }
      return left.title.localeCompare(right.title);
    });

  const saved = allFavorites.filter((entry) => entry.saved).slice(0, 6);
  const suggestions = allFavorites.filter((entry) => !entry.saved).slice(0, 6);

  return {
    tasks: {
      followupCount: input.contacts.filter((item) => item.unreadCount > 0).length,
      delegationCount: input.teamAssistants.length,
      backlogCount: input.recentSessions.length,
      followups,
      delegations,
      backlog,
    },
    favorites: {
      savedCount: saved.length,
      assistantCount: input.teamAssistants.filter((entry) => entry.saved).length,
      memberCount: input.teamMembers.filter((entry) => entry.saved).length,
      spaceCount: input.teamSpaces.filter((entry) => entry.saved).length,
      saved,
      suggestions,
    },
  };
}
