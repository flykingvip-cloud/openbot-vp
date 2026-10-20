/**
 * Collaboration gateway events — isolated subscription module.
 */

import type { CollaborationRoundPlanPayload } from "../../../../src/gateway/collaboration-dispatch/types.js";
import { sessionsCapability } from "../capability/sessions/index.ts";
import { spacesCapability } from "../capability/spaces/index.ts";
import {
  adaptSessionsLoadCapabilityState,
  adaptSpacesLoadCapabilityState,
} from "../capability/view-state.ts";
import {
  handleCollaborationOptionalSuggestionEvent,
  type CollaborationOptionalSuggestionsHost,
} from "../controllers/collaboration-optional-suggestions.ts";
import {
  handleCollaborationRoundPlanEvent,
  type CollaborationRoundPlanHost,
} from "../controllers/collaboration-round-plan.ts";
import type { GatewayHost } from "../gateway-host.ts";
import type { GatewayEventFrame } from "../gateway.ts";

export function handleCollaborationGatewayEvent(
  host: GatewayHost,
  evt: GatewayEventFrame,
): boolean {
  if (evt.event === "collaboration.round_plan") {
    handleCollaborationRoundPlanEvent(
      host as unknown as CollaborationRoundPlanHost,
      evt.payload as CollaborationRoundPlanPayload | undefined,
    );
    return true;
  }

  if (evt.event === "collaboration.optional_suggestion") {
    handleCollaborationOptionalSuggestionEvent(
      host as unknown as CollaborationOptionalSuggestionsHost,
      evt.payload as
        | {
            roundId?: string;
            sessionKey?: string;
            agentId?: string;
            agentName?: string;
            title?: string;
            body?: string;
            recordedAtMs?: number;
          }
        | undefined,
    );
    return true;
  }

  if (evt.event === "collaboration.space.dissolved") {
    const payload = evt.payload as
      | {
          groupId?: string;
          title?: string;
          message?: string;
          notifiedUserIds?: string[];
        }
      | undefined;
    const currentUser = host.platformAuthState?.session?.user?.trim().toLowerCase();
    const notified = (payload?.notifiedUserIds ?? [])
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean);
    if (currentUser && notified.includes(currentUser)) {
      host.workbenchSystemSettingsGroupNotice =
        payload?.message ?? `协作小组「${payload?.title ?? payload?.groupId ?? ""}」已被解散。`;
    }
    void spacesCapability.load(adaptSpacesLoadCapabilityState(host));
    void sessionsCapability.load(adaptSessionsLoadCapabilityState(host));
    return true;
  }

  return false;
}
