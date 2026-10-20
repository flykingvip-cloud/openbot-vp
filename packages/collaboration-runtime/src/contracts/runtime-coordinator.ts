import type {
  Decision,
  Deliverable,
  GroupProfile,
  Review,
  Task,
} from "@openbot/collaboration-core";

export type RuntimeRole = "owner" | "reviewer" | "support" | "participant";
export type RuntimePhase = "draft" | "review" | "final";

export type RuntimeActor = {
  id: string;
  type: "human" | "bot";
  role?: string;
};

export type ObjectSnapshots = {
  profile?: GroupProfile;
  tasks?: Task[];
  deliverables?: Deliverable[];
  reviews?: Review[];
  decisions?: Decision[];
};

export type SessionProjectionMetadata = {
  collaborationPhase?: RuntimePhase;
  collaborationReviewDispositionRecordedAt?: number;
  collaborationOwnerLastActiveAt?: number;
  collaborationOwnerAgentId?: string;
  collaborationDeliverableId?: string;
  [key: string]: unknown;
};

export interface RuntimeContext {
  groupId: string;
  message: string;
  actor: RuntimeActor;
  sessionId?: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export interface MessageRoute {
  target: "group" | "task" | "deliverable" | "review";
  targetId?: string;
  priority: number;
  reason: string;
}

export interface RuntimeProjection {
  groupId: string;
  sessionId: string;
  role: RuntimeRole;
  phase?: RuntimePhase;
  currentTask?: Task;
  currentDeliverable?: Deliverable;
  currentReview?: Review;
  ownerTimedOut: boolean;
  canPublishFinal: boolean;
  needsReview: boolean;
  reviewDispositioned: boolean;
  projectedAt: number;
  metadata?: SessionProjectionMetadata;
}

export interface RuntimeCoordinator {
  routeMessage(ctx: RuntimeContext): Promise<MessageRoute>;
  projectRuntime(ctx: RuntimeContext): Promise<RuntimeProjection>;
  controlReviewGate(ctx: RuntimeContext): Promise<GateResult>;
  controlFinalGate(ctx: RuntimeContext): Promise<GateResult>;
}

export interface GateResult {
  allowed: boolean;
  reason: string;
  details?: Record<string, unknown>;
}
