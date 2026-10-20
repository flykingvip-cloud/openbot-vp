import { t } from "../../i18n/index.ts";
import type {
  WorkbenchSidebarItem,
  WorkbenchTeamEntry,
} from "../ports/employee/views/workbench-home-model.ts";

export type WorkbenchCommandActionId =
  | "openFullChat"
  | "requestNewSession"
  | "openAssistantSettings"
  | "openChannelSettings"
  | "openControl"
  | "openOverview"
  | "openCron"
  | "selectSession"
  | "openDashboardCoach";

export type WorkbenchCommandSectionId = "team" | "recommendations" | "actions" | "assistants";

export type WorkbenchCommand = {
  id: string;
  title: string;
  subtitle: string;
  shortcut?: string;
  tone?: "default" | "warn" | "ok";
  actionId: WorkbenchCommandActionId;
  sessionKey?: string;
};

export type WorkbenchCommandSection = {
  id: WorkbenchCommandSectionId;
  title: string;
  items: WorkbenchCommand[];
};

export type WorkbenchCommandModelInput = {
  agents: WorkbenchSidebarItem[];
  contacts: WorkbenchSidebarItem[];
  groups: WorkbenchSidebarItem[];
  teamAssistants: WorkbenchTeamEntry[];
  teamMembers: WorkbenchTeamEntry[];
  teamSpaces: WorkbenchTeamEntry[];
};

export function buildWorkbenchCommandSections(
  input: WorkbenchCommandModelInput,
): WorkbenchCommandSection[] {
  const recommended: WorkbenchCommand[] = [
    {
      id: "recommend-followup",
      title: t("frontstage.workbench.remote.recommendations.followup"),
      subtitle: t("frontstage.workbench.remote.recommendations.followupBody", {
        count: String(input.contacts.length),
      }),
      tone: input.contacts.length > 0 ? "ok" : "default",
      actionId: "selectSession",
      sessionKey: input.contacts[0]?.key ?? "main",
    },
    {
      id: "recommend-meeting",
      title: t("frontstage.workbench.remote.recommendations.meeting"),
      subtitle: t("frontstage.workbench.remote.recommendations.meetingBody", {
        count: String(input.groups.length),
      }),
      tone: input.groups.length > 0 ? "warn" : "default",
      actionId: "openChannelSettings",
    },
    {
      id: "recommend-coach",
      title: t("frontstage.workbench.remote.recommendations.coach"),
      subtitle: t("frontstage.workbench.remote.recommendations.coachBody"),
      actionId: "openDashboardCoach",
    },
  ];

  const quickActions: WorkbenchCommand[] = [
    {
      id: "quick-chat",
      title: t("frontstage.workbench.remote.actions.chat"),
      subtitle: t("frontstage.workbench.remote.actions.chatBody"),
      shortcut: "C",
      actionId: "openFullChat",
    },
    {
      id: "quick-session",
      title: t("frontstage.workbench.remote.actions.newSession"),
      subtitle: t("frontstage.workbench.remote.actions.newSessionBody"),
      shortcut: "N",
      actionId: "requestNewSession",
    },
    {
      id: "quick-agents",
      title: t("frontstage.workbench.remote.actions.agents"),
      subtitle: t("frontstage.workbench.remote.actions.agentsBody"),
      shortcut: "A",
      actionId: "openAssistantSettings",
    },
    {
      id: "quick-channels",
      title: t("frontstage.workbench.remote.actions.channels"),
      subtitle: t("frontstage.workbench.remote.actions.channelsBody"),
      shortcut: "L",
      actionId: "openChannelSettings",
    },
    {
      id: "quick-control",
      title: t("frontstage.workbench.remote.actions.control"),
      subtitle: t("frontstage.workbench.remote.actions.controlBody"),
      shortcut: "O",
      actionId: "openControl",
    },
    {
      id: "quick-overview",
      title: t("frontstage.workbench.remote.actions.overview"),
      subtitle: t("frontstage.workbench.remote.actions.overviewBody"),
      shortcut: "V",
      actionId: "openOverview",
    },
  ];

  const assistantShortcuts: WorkbenchCommand[] = input.agents.slice(0, 4).map((agent) => ({
    id: `agent:${agent.key}`,
    title: agent.title,
    subtitle: agent.meta,
    actionId: "selectSession",
    sessionKey: agent.key,
  }));

  return [
    {
      id: "team",
      title: t("frontstage.workbench.remote.sections.team"),
      items: [
        {
          id: "team-setup-assistants",
          title: t("frontstage.workbench.team.setupAssistants"),
          subtitle: t("frontstage.workbench.remote.team.setupAssistants"),
          actionId: "openAssistantSettings",
        },
        {
          id: "team-start-member",
          title: t("frontstage.workbench.team.startMemberLane"),
          subtitle: t("frontstage.workbench.remote.team.startMemberLane"),
          actionId: "openFullChat",
        },
        {
          id: "team-setup-spaces",
          title: t("frontstage.workbench.team.setupSpaces"),
          subtitle: t("frontstage.workbench.remote.team.setupSpaces"),
          actionId: "openChannelSettings",
        },
        ...input.teamAssistants.slice(0, 2).map(
          (entry) =>
            ({
              id: `team-assistant:${entry.id}`,
              title: entry.title,
              subtitle: `${t("frontstage.workbench.team.assistantsTitle")} · ${entry.detail}`,
              actionId: "selectSession",
              sessionKey: entry.key,
            }) satisfies WorkbenchCommand,
        ),
        ...input.teamMembers.slice(0, 2).map(
          (entry) =>
            ({
              id: `team-member:${entry.id}`,
              title: entry.title,
              subtitle: `${t("frontstage.workbench.team.membersTitle")} · ${entry.detail}`,
              actionId: "selectSession",
              sessionKey: entry.key,
            }) satisfies WorkbenchCommand,
        ),
        ...input.teamSpaces.slice(0, 2).map(
          (entry) =>
            ({
              id: `team-space:${entry.id}`,
              title: entry.title,
              subtitle: `${t("frontstage.workbench.team.teamsTitle")} · ${entry.detail}`,
              actionId: "selectSession",
              sessionKey: entry.key,
            }) satisfies WorkbenchCommand,
        ),
      ],
    },
    {
      id: "recommendations",
      title: t("frontstage.workbench.remote.sections.recommendations"),
      items: recommended,
    },
    {
      id: "actions",
      title: t("frontstage.workbench.remote.sections.actions"),
      items: quickActions,
    },
    {
      id: "assistants",
      title: t("frontstage.workbench.remote.sections.assistants"),
      items: assistantShortcuts,
    },
  ];
}

export function findWorkbenchCommand(
  sections: WorkbenchCommandSection[],
  id: string,
): WorkbenchCommand | null {
  for (const section of sections) {
    const found = section.items.find((item) => item.id === id);
    if (found) {
      return found;
    }
  }
  return null;
}
