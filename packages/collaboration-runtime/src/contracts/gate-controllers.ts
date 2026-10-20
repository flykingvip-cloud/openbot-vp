import type { Decision, GroupProfile, Review } from "@openbot/collaboration-core";
import type { GateResult, RuntimeActor } from "./runtime-coordinator.js";

export interface ReviewGateController {
  canPublishDeliverable(params: { deliverableId: string; reviews: Review[] }): Promise<GateResult>;
}

export interface FinalGateController {
  canPublishFinalDecision(params: {
    decisionId: string;
    actor: RuntimeActor;
    decision: Decision;
    groupProfile?: GroupProfile;
  }): Promise<GateResult>;
}
