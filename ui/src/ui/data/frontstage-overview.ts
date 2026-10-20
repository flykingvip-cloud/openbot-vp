import {
  deriveSessionChatType,
  parseAgentSessionKey,
} from "../../../../src/sessions/session-key-utils.js";
import { t } from "../../i18n/index.ts";
import type {
  AgentsListResult,
  ChannelAccountSnapshot,
  ChannelsStatusSnapshot,
  SessionsListResult,
} from "../types.ts";

export type FrontstagePersonaCard = {
  id: string;
  title: string;
  emoji: string;
  subtitle: string;
  sessionsCount: number;
  relationshipCount: number;
};

export type FrontstageConnectedAccount = {
  channelId: string;
  channelLabel: string;
  account: ChannelAccountSnapshot;
};

function countSessionsByAgent(sessionsResult: SessionsListResult | null): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of sessionsResult?.sessions ?? []) {
    const agentId = parseAgentSessionKey(row.key)?.agentId ?? "main";
    counts.set(agentId, (counts.get(agentId) ?? 0) + 1);
  }
  return counts;
}

function countRelationshipsByAgent(
  sessionsResult: SessionsListResult | null,
): Map<string, { contacts: number; groups: number }> {
  const summary = new Map<string, { contacts: number; groups: number }>();
  for (const row of sessionsResult?.sessions ?? []) {
    const agentId = parseAgentSessionKey(row.key)?.agentId ?? "main";
    const chatType =
      row.kind === "direct" || row.kind === "group" ? row.kind : deriveSessionChatType(row.key);
    const current = summary.get(agentId) ?? { contacts: 0, groups: 0 };
    if (chatType === "direct") {
      current.contacts += 1;
    } else if (chatType === "group" || chatType === "channel") {
      current.groups += 1;
    }
    summary.set(agentId, current);
  }
  return summary;
}

export function flattenChannelAccounts(
  snapshot: ChannelsStatusSnapshot | null,
): FrontstageConnectedAccount[] {
  if (!snapshot) {
    return [];
  }
  return snapshot.channelOrder.flatMap((channelId) => {
    const channelLabel = snapshot.channelLabels[channelId] ?? channelId;
    const accounts = snapshot.channelAccounts[channelId] ?? [];
    return accounts.map((account) => ({ channelId, channelLabel, account }));
  });
}

export function buildFrontstagePersonaCards(input: {
  agentsList: AgentsListResult | null;
  sessionsResult: SessionsListResult | null;
}): FrontstagePersonaCard[] {
  const agents = input.agentsList?.agents ?? [];
  const sessionsByAgent = countSessionsByAgent(input.sessionsResult);
  const relationshipsByAgent = countRelationshipsByAgent(input.sessionsResult);
  return agents.map((agent) => {
    const relationships = relationshipsByAgent.get(agent.id) ?? { contacts: 0, groups: 0 };
    const title = agent.name?.trim() || agent.identity?.name?.trim() || agent.id;
    return {
      id: agent.id,
      title,
      emoji:
        agent.identity?.emoji?.trim() || (agent.id === input.agentsList?.defaultId ? "🙂" : "🤖"),
      subtitle:
        agent.id === input.agentsList?.defaultId
          ? t("frontstage.me.primaryPersona")
          : t("frontstage.personas.secondaryPersona"),
      sessionsCount: sessionsByAgent.get(agent.id) ?? 0,
      relationshipCount: relationships.contacts + relationships.groups,
    } satisfies FrontstagePersonaCard;
  });
}
