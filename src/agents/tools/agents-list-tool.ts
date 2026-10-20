import { Type } from "@sinclair/typebox";
import { loadConfig } from "../../config/config.js";
import { resolveRuntimeOrganizationContext } from "../../organization/runtime.js";
import {
  DEFAULT_AGENT_ID,
  normalizeAgentId,
  parseAgentSessionKey,
} from "../../routing/session-key.js";
import { resolveAgentConfig, resolveAgentWorkspaceDir } from "../agent-scope.js";
import type { AnyAgentTool } from "./common.js";
import { jsonResult } from "./common.js";
import { resolveInternalSessionKey, resolveMainSessionAlias } from "./sessions-helpers.js";

const AgentsListToolSchema = Type.Object({});

type AgentListEntry = {
  id: string;
  name?: string;
  displayName: string;
  roleName?: string;
  organization?: {
    id: string;
    name: string;
  };
  coordinator?: boolean;
  reachable?: boolean;
  configured: boolean;
};

export function createAgentsListTool(opts?: {
  agentSessionKey?: string;
  /** Explicit agent ID override for cron/hook sessions. */
  requesterAgentIdOverride?: string;
}): AnyAgentTool {
  return {
    label: "Agents",
    name: "agents_list",
    description:
      "列出本租户注册表里的数字人，和 conversation_send 用同一份名单。sessionExists 为假表示已注册但还没有主会话，发不出去。交给对方请用 conversation_send 或 @名字。sessions_spawn 仍只看 spawnAllowlist，不要拿 agents 当子代理白名单。",
    parameters: AgentsListToolSchema,
    execute: async () => {
      const cfg = loadConfig();
      const { mainKey, alias } = resolveMainSessionAlias(cfg);
      const requesterInternalKey =
        typeof opts?.agentSessionKey === "string" && opts.agentSessionKey.trim()
          ? resolveInternalSessionKey({
              key: opts.agentSessionKey,
              alias,
              mainKey,
            })
          : alias;
      const requesterAgentId = normalizeAgentId(
        opts?.requesterAgentIdOverride ??
          parseAgentSessionKey(requesterInternalKey)?.agentId ??
          DEFAULT_AGENT_ID,
      );

      const allowAgents = resolveAgentConfig(cfg, requesterAgentId)?.subagents?.allowAgents ?? [];
      const allowAny = allowAgents.some((value) => value.trim() === "*");
      const allowSet = new Set(
        allowAgents
          .filter((value) => value.trim() && value.trim() !== "*")
          .map((value) => normalizeAgentId(value)),
      );

      const configuredAgents = Array.isArray(cfg.agents?.list) ? cfg.agents?.list : [];
      const configuredIds = configuredAgents.map((entry) => normalizeAgentId(entry.id));
      const configuredNameMap = new Map<string, string>();
      for (const entry of configuredAgents) {
        const name = entry?.identity?.name?.trim() || entry?.name?.trim() || "";
        if (!name) {
          continue;
        }
        configuredNameMap.set(normalizeAgentId(entry.id), name);
      }
      const requesterWorkspace = resolveAgentWorkspaceDir(cfg, requesterAgentId);
      const organizationContext = await resolveRuntimeOrganizationContext({
        cfg,
        agentId: requesterAgentId,
        workspaceDir: requesterWorkspace,
        sessionKey: requesterInternalKey,
      });
      const orgMembersById = new Map(
        organizationContext.members.map((member) => [member.agentId, member] as const),
      );

      const allowed = new Set<string>();
      allowed.add(requesterAgentId);
      if (allowAny) {
        for (const id of configuredIds) {
          allowed.add(id);
        }
      } else {
        for (const id of allowSet) {
          allowed.add(id);
        }
      }

      const all = Array.from(allowed);
      const rest = all
        .filter((id) => id !== requesterAgentId)
        .toSorted((a, b) => a.localeCompare(b));
      const ordered = [requesterAgentId, ...rest];
      const agents: Array<
        AgentListEntry & {
          sessionKey?: string;
          channel?: "diagnosed_agent_session";
        }
      > = ordered.map((id) => ({
        id,
        name: configuredNameMap.get(id),
        displayName: orgMembersById.get(id)?.displayName ?? configuredNameMap.get(id) ?? id,
        roleName: orgMembersById.get(id)?.roleName,
        organization: organizationContext.organization,
        coordinator: organizationContext.coordinator?.agentId === id,
        reachable:
          id === requesterAgentId ||
          organizationContext.self.reachableAgents.some((agent) => agent.agentId === id),
        configured: configuredIds.includes(id),
      }));

      const request = opts as
        | {
            agentSessionKey?: string;
            tenantId?: string;
            gatewayClientUser?: string;
            gatewayClientPlatformUserId?: string;
            gatewayClientSessionDomain?: "enterprise" | "personal";
            gatewayClientSessionKind?: string;
          }
        | undefined;
      const { listConversationPeers } =
        await import("../../conversation-task/conversation-handoff.js");
      const { extractEmployeeStewardUserId } =
        await import("../../diagnosis/diagnose-conversation.js");
      const { loadPlatformAuthStoreForDiagnosis, resolveDiagnoseGrowthActor } =
        await import("../../diagnosis/diagnose-growth-locator.js");
      const actorUserId =
        request?.gatewayClientPlatformUserId ||
        request?.gatewayClientUser ||
        extractEmployeeStewardUserId(request?.agentSessionKey);
      const actor = actorUserId
        ? resolveDiagnoseGrowthActor({
            tenantId: request?.tenantId,
            actorUserId,
            sessionDomain: request?.gatewayClientSessionDomain,
            sessionKind: request?.gatewayClientSessionKind,
            store: await loadPlatformAuthStoreForDiagnosis(),
          })
        : null;
      const conversationPeers = actor
        ? await listConversationPeers({
            tenantId: actor.tenantId,
            requesterUserId: actor.actorUserId,
            tenantAdmin: actor.tenantAdmin,
            includeMissingSessions: true,
          })
        : [];
      const spawnAllowlist = agents.map((row) => ({
        id: row.id,
        displayName: row.displayName,
        configured: row.configured,
      }));
      const registryAgents =
        conversationPeers.length > 0
          ? conversationPeers.map((peer) => ({
              id: peer.agentId,
              name: peer.displayName,
              displayName: peer.displayName,
              reachable: peer.sessionExists,
              configured: true,
              registered: true,
              sessionExists: peer.sessionExists,
              sessionKey: peer.sessionKey,
              channel: "diagnosed_agent_session" as const,
            }))
          : agents;
      const reachableAgents = conversationPeers
        .filter((peer) => peer.sessionExists)
        .map((peer) => ({
          agentId: peer.agentId,
          displayName: peer.displayName,
        }));

      return jsonResult({
        requester: requesterAgentId,
        requesterIdentity: {
          ...organizationContext.self,
          reachableAgents:
            reachableAgents.length > 0 ? reachableAgents : organizationContext.self.reachableAgents,
        },
        allowAny,
        registrySource: conversationPeers.length > 0 ? "agent_registry" : "config_allowlist",
        conversationChannel: "diagnosed_agent_session",
        spawnAllowlist,
        agents: registryAgents,
      });
    },
  };
}
