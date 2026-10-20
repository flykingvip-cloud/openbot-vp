import type { OpenBotConfig } from "../config/config.js";
import {
  buildMentionDeepLink,
  enqueueEmployeePushForPlatformUser,
} from "../infra/employee-push.js";
import {
  upsertHumanMentionNotification,
  type HumanMentionNotification,
} from "./human-mention-notifications.js";
import type { AgentTaskDeliveryResult } from "./inter-agent-bus.js";
import { sendAgentMention } from "./inter-agent-bus.js";
import { mentionEventBus, type MentionEventBus } from "./mention-events.js";
import { classify as classifyMentionIntent } from "./mention-intent-classifier.js";
import { resolveMentionTarget } from "./mention-target.js";
import { convert as convertMentionTask } from "./mention-task-converter.js";
import type {
  DeliveryResult,
  IntentSuggestion,
  MentionContext,
  MentionMetadata,
} from "./mention-types.js";
import { validateMentions } from "./mention-validator.js";
import type { RuntimeOrganizationContext } from "./runtime.js";

export type MentionDeliveryMessage = {
  messageId: string;
  messageText: string;
  mentions: MentionMetadata[];
  mentionContext: MentionContext;
  sourceAgentId: string;
  targetAgentId: string;
  organizationId: string;
};

export type MentionInterAgentBus = {
  deliverMention(
    params: MentionDeliveryMessage,
  ): Promise<AgentTaskDeliveryResult | void> | AgentTaskDeliveryResult | void;
};

export type MentionStateCreation = {
  mention_id: string;
  source_message_id: string;
  source_agent_id: string;
  target_agent_id: string;
  organization_id: string;
  timestamp: string;
  payload?: Record<string, unknown>;
};

export type MentionDeliveryStateTracker = {
  createMentionState(params: MentionStateCreation): Promise<unknown> | void;
};

export type MentionDeliveryParams = {
  messageId: string;
  messageText: string;
  mentions: unknown;
  sourceAgentId: string;
  /** Human sender user id (for human mention notifications). */
  sourceUserId?: string;
  organizationId?: string;
  groupId?: string;
  sessionKey?: string;
  tenantId?: string;
  context: RuntimeOrganizationContext;
  eventBus?: MentionEventBus;
  interAgentBus?: MentionInterAgentBus;
  stateTracker?: MentionDeliveryStateTracker;
  /**
   * Optional override for human notification persistence (tests).
   * Defaults to tenant-scoped human-mention-notifications store.
   */
  notifyHuman?: (notification: {
    mentionId: string;
    targetUserId: string;
    sourceUserId: string;
    groupId: string;
    sessionKey: string;
    sourceMessageId: string;
    excerpt: string;
    displayName?: string;
  }) => Promise<HumanMentionNotification | void> | HumanMentionNotification | void;
  cfg?: OpenBotConfig;
  workspaceDir?: string;
  confirmedTaskMentionIds?: ReadonlySet<string>;
  now?: () => Date;
};

type AgentMentionTarget = {
  targetAgentId: string;
  mentionType: MentionContext["mentionType"];
  mentions: MentionMetadata[];
};

type HumanMentionTarget = {
  targetUserId: string;
  mentionType: MentionContext["mentionType"];
  mentions: MentionMetadata[];
  displayName: string;
};

function resolveOrganizationId(params: MentionDeliveryParams): string {
  return (
    params.organizationId ??
    params.context.organization?.id ??
    params.context.self.organizationId ??
    "unknown"
  );
}

function createDefaultInterAgentBus(): MentionInterAgentBus {
  return {
    deliverMention(params) {
      return sendAgentMention(params);
    },
  };
}

function addAgentTargetMention(
  targets: Map<string, AgentMentionTarget>,
  targetAgentId: string,
  mention: MentionMetadata,
  mentionType: MentionContext["mentionType"],
): void {
  const existing = targets.get(targetAgentId);
  if (!existing) {
    targets.set(targetAgentId, {
      targetAgentId,
      mentionType,
      mentions: [mention],
    });
    return;
  }

  existing.mentions.push(mention);
  if (mentionType === "direct") {
    existing.mentionType = "direct";
  }
}

function addHumanTargetMention(
  targets: Map<string, HumanMentionTarget>,
  targetUserId: string,
  displayName: string,
  mention: MentionMetadata,
  mentionType: MentionContext["mentionType"],
): void {
  const key = targetUserId.trim().toLowerCase();
  const existing = targets.get(key);
  if (!existing) {
    targets.set(key, {
      targetUserId,
      displayName,
      mentionType,
      mentions: [mention],
    });
    return;
  }
  existing.mentions.push(mention);
  if (mentionType === "direct") {
    existing.mentionType = "direct";
  }
}

function buildMentionTargets(
  validMentions: MentionMetadata[],
  context: RuntimeOrganizationContext,
): { agents: Map<string, AgentMentionTarget>; humans: Map<string, HumanMentionTarget> } {
  const agents = new Map<string, AgentMentionTarget>();
  const humans = new Map<string, HumanMentionTarget>();
  const activeMemberIds = new Set(context.members.map((member) => member.agentId));
  const activeHumans = new Map(
    (context.humans ?? [])
      .filter((human) => human.status === "active")
      .map((human) => [human.userId.trim().toLowerCase(), human]),
  );

  for (const mention of validMentions) {
    const target = resolveMentionTarget(mention);
    if (!target) {
      continue;
    }
    if (target.kind === "all") {
      for (const member of context.members) {
        addAgentTargetMention(agents, member.agentId, mention, "broadcast");
      }
      for (const human of activeHumans.values()) {
        addHumanTargetMention(humans, human.userId, human.displayName, mention, "broadcast");
      }
      continue;
    }
    if (target.kind === "agent") {
      if (activeMemberIds.has(target.agentId)) {
        addAgentTargetMention(agents, target.agentId, mention, "direct");
      }
      continue;
    }
    if (target.kind === "plugin") {
      continue;
    }
    const human = activeHumans.get(target.userId.trim().toLowerCase());
    if (human) {
      addHumanTargetMention(humans, human.userId, human.displayName, mention, "direct");
    }
  }

  return { agents, humans };
}

function buildMentionContext(params: {
  target: AgentMentionTarget;
  sourceAgentId: string;
  coordinatorVisible: boolean;
  requiresAck: boolean;
}): MentionContext {
  return {
    isMentioned: true,
    mentionType: params.target.mentionType,
    mentionSourceAgentId: params.sourceAgentId,
    coordinatorVisible: params.coordinatorVisible,
    ...(params.requiresAck ? { requiresAck: true } : {}),
    priority: "normal",
    mentionIds: params.target.mentions.map((mention) => mention.mention_id),
  };
}

function isUnknownTargetReason(reason: string): boolean {
  return (
    reason.includes("not found in organization members") ||
    reason.includes("not found in collaboration group roster") ||
    reason.includes("is not an active group member")
  );
}

function buildExcerpt(messageText: string, max = 160): string {
  const collapsed = messageText.replace(/\s+/g, " ").trim();
  if (collapsed.length <= max) {
    return collapsed;
  }
  return `${collapsed.slice(0, max - 1)}…`;
}

function readInvalidMentionField(mention: unknown, field: "mention_id" | "agentId"): string {
  if (typeof mention === "object" && mention !== null && field in mention) {
    return String((mention as Record<string, unknown>)[field]);
  }
  return "unknown";
}

export async function deliver(params: MentionDeliveryParams): Promise<DeliveryResult> {
  const organizationId = resolveOrganizationId(params);
  const eventBus = params.eventBus ?? mentionEventBus;
  const interAgentBus = params.interAgentBus ?? createDefaultInterAgentBus();
  const validation = validateMentions(params.mentions, params.messageText, params.context);
  const result: DeliveryResult = { delivered: [], errors: [] };

  for (const invalid of validation.invalid) {
    const mentionId = readInvalidMentionField(invalid.mention, "mention_id");
    const agentId = readInvalidMentionField(invalid.mention, "agentId");

    if (isUnknownTargetReason(invalid.reason)) {
      result.delivered.push({
        mention_id: mentionId,
        agentId,
        status: "skipped",
      });
      continue;
    }

    result.errors.push({
      mention_id: mentionId,
      agentId,
      reason: invalid.reason,
    });
  }

  // Plugin/MCP mentions are structured targets for the host agent (tool/connector
  // selection). They do not fan out to another agent or human inbox.
  for (const mention of validation.valid) {
    const target = resolveMentionTarget(mention);
    if (target?.kind !== "plugin") {
      continue;
    }
    result.delivered.push({
      mention_id: mention.mention_id,
      agentId: "",
      status: "notified",
      targetKind: "plugin",
    });
  }

  const { agents: agentTargets, humans: humanTargets } = buildMentionTargets(
    validation.valid,
    params.context,
  );
  const coordinatorVisible = Boolean(params.context.coordinator);
  const timestamp = (params.now ?? (() => new Date()))().toISOString();
  const intentSuggestions = new Map<string, IntentSuggestion>();
  for (const mention of validation.valid) {
    intentSuggestions.set(
      mention.mention_id,
      classifyMentionIntent({
        messageText: params.messageText,
        mention,
      }),
    );
  }

  // Human notifications — never block agent delivery; failures become errors entries.
  const sourceUserId = params.sourceUserId?.trim() ?? "";
  const groupId = params.groupId?.trim() ?? organizationId;
  const sessionKey = params.sessionKey?.trim() ?? "";
  const excerpt = buildExcerpt(params.messageText);
  const notifyHuman =
    params.notifyHuman ??
    (async (notification) => {
      if (!params.tenantId) {
        throw new Error("tenantId required for human mention notifications");
      }
      const { notification: stored } = await upsertHumanMentionNotification({
        tenantId: params.tenantId,
        notification,
        now: params.now,
      });
      return stored;
    });

  for (const humanTarget of humanTargets.values()) {
    if (!sourceUserId || !groupId || !sessionKey) {
      for (const mention of humanTarget.mentions) {
        result.errors.push({
          mention_id: mention.mention_id,
          agentId: "",
          targetKind: "human",
          reason: "Missing sourceUserId/groupId/sessionKey for human mention notification",
        });
      }
      continue;
    }
    for (const mention of humanTarget.mentions) {
      try {
        await notifyHuman({
          mentionId: mention.mention_id,
          targetUserId: humanTarget.targetUserId,
          sourceUserId,
          groupId,
          sessionKey,
          sourceMessageId: params.messageId,
          excerpt,
          displayName: humanTarget.displayName,
        });
        // Wave 2: best-effort employee remote push (skip if no token/creds).
        // Never blocks mention inbox delivery; isolated from node APNs.
        void enqueueEmployeePushForPlatformUser({
          platformUserId: humanTarget.targetUserId,
          payload: {
            deepLink: buildMentionDeepLink({ sessionKey, groupId }),
            title: "有人提到你",
            body: excerpt.slice(0, 80) || "你有一条新的 @提及",
            kind: "employee.mention",
          },
        }).catch(() => undefined);
        result.delivered.push({
          mention_id: mention.mention_id,
          agentId: "",
          targetKind: "human",
          status: "notified",
        });
      } catch (err) {
        result.errors.push({
          mention_id: mention.mention_id,
          agentId: "",
          targetKind: "human",
          reason: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  await Promise.all(
    [...agentTargets.values()].map(async (target) => {
      const mentionContext = buildMentionContext({
        target,
        sourceAgentId: params.sourceAgentId,
        coordinatorVisible,
        requiresAck: target.mentions.some((mention) => {
          const suggestion = intentSuggestions.get(mention.mention_id);
          return (
            params.confirmedTaskMentionIds?.has(mention.mention_id) === true &&
            suggestion !== undefined &&
            suggestion.confidence >= 0.6 &&
            (suggestion.intent === "approval_request" || suggestion.intent === "review_request")
          );
        }),
      });

      for (const mention of target.mentions) {
        const suggestion = intentSuggestions.get(mention.mention_id);
        let linkedTaskId: string | undefined;
        if (
          params.confirmedTaskMentionIds?.has(mention.mention_id) === true &&
          params.cfg &&
          params.workspaceDir &&
          suggestion?.intent === "task_assignment" &&
          suggestion.confidence >= 0.6
        ) {
          try {
            const conversion = await convertMentionTask({
              cfg: params.cfg,
              workspaceDir: params.workspaceDir,
              organizationId,
              mention,
              messageText: params.messageText,
              sourceAgentId: params.sourceAgentId,
              confirmedBy: "coordinator",
              now: timestamp,
            });
            linkedTaskId = conversion.linked_task_id;
          } catch (err) {
            result.errors.push({
              mention_id: mention.mention_id,
              agentId: target.targetAgentId,
              reason: err instanceof Error ? err.message : String(err),
            });
          }
        }
        const payload = {
          mentionType: mentionContext.mentionType,
          displayName: mention.displayName,
          messageId: params.messageId,
          messageText: params.messageText,
          mentionContext,
          mentionIds: mentionContext.mentionIds,
          ...(suggestion ? { intentSuggestion: suggestion } : {}),
          ...(linkedTaskId ? { linked_task_id: linkedTaskId } : {}),
        };
        if (params.stateTracker) {
          try {
            await params.stateTracker.createMentionState({
              mention_id: mention.mention_id,
              source_message_id: params.messageId,
              source_agent_id: params.sourceAgentId,
              target_agent_id: target.targetAgentId,
              organization_id: organizationId,
              timestamp,
              payload,
            });
          } catch (err) {
            result.errors.push({
              mention_id: mention.mention_id,
              agentId: target.targetAgentId,
              reason: err instanceof Error ? err.message : String(err),
            });
          }
        } else {
          eventBus.emit({
            type: "mention.created",
            mention_id: mention.mention_id,
            source_agent_id: params.sourceAgentId,
            target_agent_id: target.targetAgentId,
            organization_id: organizationId,
            timestamp,
            payload,
          });
        }
      }

      try {
        const delivery = await interAgentBus.deliverMention({
          messageId: params.messageId,
          messageText: params.messageText,
          mentions: target.mentions,
          mentionContext,
          sourceAgentId: params.sourceAgentId,
          targetAgentId: target.targetAgentId,
          organizationId,
        });

        if (delivery?.status === "error") {
          for (const mention of target.mentions) {
            result.errors.push({
              mention_id: mention.mention_id,
              agentId: target.targetAgentId,
              reason: delivery.error ?? "Mention delivery failed",
            });
          }
          return;
        }

        for (const mention of target.mentions) {
          result.delivered.push({
            mention_id: mention.mention_id,
            agentId: target.targetAgentId,
            status: delivery?.status === "skipped" ? "skipped" : "delivered",
          });
        }
      } catch (err) {
        for (const mention of target.mentions) {
          result.errors.push({
            mention_id: mention.mention_id,
            agentId: target.targetAgentId,
            reason: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }),
  );

  return result;
}

export const MentionDelivery = { deliver };
