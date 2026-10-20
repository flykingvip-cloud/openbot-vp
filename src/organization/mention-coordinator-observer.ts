import { sendAgentMention, type AgentTaskDeliveryResult } from "./inter-agent-bus.js";
import { mentionEventBus, type MentionEventBus } from "./mention-events.js";
import type { InterventionDecision, MentionEvent } from "./mention-types.js";

export interface CoordinatorObserverNotification {
  coordinatorAgentId: string;
  event: MentionEvent;
  decision: InterventionDecision;
}

export interface CoordinatorObserver {
  stop(): void;
  evaluateIntervention(event: MentionEvent): Promise<InterventionDecision>;
}

export interface CoordinatorObserverParams {
  eventBus?: MentionEventBus;
  organizationId: string;
  coordinatorAgentId?: string;
  evaluateIntervention?: (
    event: MentionEvent,
  ) => Promise<InterventionDecision> | InterventionDecision;
  notifyCoordinator?: (
    notification: CoordinatorObserverNotification,
  ) => Promise<AgentTaskDeliveryResult | void> | AgentTaskDeliveryResult | void;
  onError?: (error: unknown) => void;
}

function defaultDecision(): InterventionDecision {
  return { action: "none" };
}

function readPayloadString(event: MentionEvent, key: string): string {
  const value = event.payload?.[key];
  return typeof value === "string" ? value : "";
}

async function defaultNotifyCoordinator(
  notification: CoordinatorObserverNotification,
): Promise<AgentTaskDeliveryResult> {
  return sendAgentMention({
    messageId: readPayloadString(notification.event, "messageId") || notification.event.mention_id,
    messageText:
      readPayloadString(notification.event, "messageText") ||
      `Mention event ${notification.event.mention_id}`,
    mentions: [],
    mentionContext: {
      isMentioned: true,
      mentionType: "direct",
      mentionSourceAgentId: notification.event.source_agent_id,
      coordinatorVisible: true,
      priority: "normal",
      mentionIds: [notification.event.mention_id],
    },
    sourceAgentId: notification.event.source_agent_id,
    targetAgentId: notification.coordinatorAgentId,
    organizationId: notification.event.organization_id,
  });
}

export function createCoordinatorObserver(params: CoordinatorObserverParams): CoordinatorObserver {
  const eventBus = params.eventBus ?? mentionEventBus;
  const evaluateIntervention = params.evaluateIntervention ?? defaultDecision;
  const notifyCoordinator = params.notifyCoordinator ?? defaultNotifyCoordinator;

  const unsubscribe = eventBus.subscribe(
    {
      type: "mention.created",
      organization_id: params.organizationId,
    },
    (event) => {
      if (!params.coordinatorAgentId) {
        return;
      }
      void Promise.resolve()
        .then(async () => {
          const decision = await evaluateIntervention(event);
          await notifyCoordinator({
            coordinatorAgentId: params.coordinatorAgentId ?? "",
            event,
            decision,
          });
        })
        .catch((error) => {
          params.onError?.(error);
        });
    },
  );

  return {
    stop() {
      unsubscribe();
    },
    async evaluateIntervention(event: MentionEvent) {
      return evaluateIntervention(event);
    },
  };
}

export const CoordinatorObserver = { create: createCoordinatorObserver };
