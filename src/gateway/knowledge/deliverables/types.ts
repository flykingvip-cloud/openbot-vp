import type { DeliverableStatus } from "@openbot/collaboration-core";

export type WorkspaceDeliverableKind =
  | "report"
  | "ppt"
  | "proposal"
  | "analysis"
  | "meeting"
  | "other";

export type WorkspaceDeliverableSource = "chat" | "agent" | "group" | "task";

/** Canonical artifact source — prefer over legacy `source` in UI and governance. */
export type WorkspaceArtifactSourceType =
  | "agent"
  | "collaboration"
  | "task"
  | "enterprise"
  | "personal"
  | "external";

export type WorkspaceArtifactKind =
  | "document"
  | "report"
  | "agent_result"
  | "workflow_output"
  | "knowledge"
  | "note";

export type WorkspaceArtifactGovernanceStatus = "verified" | "pending" | "conflict";

export type WorkspaceDeliverable = {
  deliverableId: string;
  title: string;
  kind: WorkspaceDeliverableKind;
  /** @deprecated Prefer `sourceType` — kept for RPC filters and back-compat. */
  source: WorkspaceDeliverableSource;
  sourceType: WorkspaceArtifactSourceType;
  artifactKind: WorkspaceArtifactKind;
  governanceStatus: WorkspaceArtifactGovernanceStatus;
  creators: string[];
  /** Resolved human-readable owner — prefer over raw `creators` ids in UI. */
  primaryCreatorName?: string;
  groupId?: string;
  groupTitle?: string;
  taskId?: string;
  sourceLineageId?: string;
  relatedKnowledgeBaseId?: string;
  relatedProjectId?: string;
  status: DeliverableStatus;
  updatedAtMs: number;
  contentType?: string;
  pinned?: boolean;
  /** Runtime staleness signal: a KB `stale` governance task overlaps this deliverable's chunks. */
  stale?: boolean;
  /**
   * How 成果中心 should open this deliverable for a faithful preview:
   * - "file": open/render the real produced workspace file (see `artifactFilename`).
   * - "published": open the published/external link (see `openUrl`).
   * - "text"/undefined: fall back to the captured text/trace preview.
   */
  previewKind?: "file" | "published" | "text";
  /** Declared workspace file basename backing this deliverable (previewKind "file"). */
  artifactFilename?: string;
  /** Declared published/external URL backing this deliverable (previewKind "published"). */
  openUrl?: string;
};

export type ListWorkspaceDeliverablesParams = {
  userId: string;
  limit?: number;
  source?: WorkspaceDeliverableSource;
  /** Free string so an unknown filter still matches nothing inside the limit window. */
  status?: string;
  /** When set, only scan these collaboration group ids (employee seat scope). */
  groupIds?: string[];
  /**
   * When set, only include agent skill-asset deliverables whose `sourceRobot.id`
   * is in this set (the agents the caller owns / can see). Omit to disable agent
   * scoping entirely (local / admin / platform views that legitimately see all
   * assets). The caller MUST exclude the universal builtin steward id from this
   * set: its id collides with the legacy `main` agent, so leaving it in would
   * surface other users' steward/`main`-attributed assets to a brand-new member.
   */
  visibleAgentIds?: string[];
};

export type ListWorkspaceDeliverablesResult = {
  deliverables: WorkspaceDeliverable[];
};

export type WorkspaceDeliverableTraceStepKind =
  | "trigger"
  | "agent"
  | "knowledge"
  | "collaboration"
  | "task"
  | "review"
  | "output";

export type WorkspaceDeliverableTraceStep = {
  id: string;
  kind: WorkspaceDeliverableTraceStepKind;
  title: string;
  description: string;
  actorName?: string;
  atMs?: number;
};

export type WorkspaceDeliverableCitedKnowledge = {
  kbId: string;
  kbTitle?: string;
  docId?: string;
  docTitle?: string;
  chunkText?: string;
  score?: number;
};

export type WorkspaceDeliverableModelUsage = {
  model?: string;
  provider?: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
};

/**
 * A downstream deliverable that consumed this deliverable's archived knowledge — the
 * 成果→成果 edge of the Work Memory Network (e.g. 客户画像 → 跟进策略). `title` / `agentName`
 * are best-effort decorations (resolved for skill assets; may be absent for collaboration
 * deliverables), while `deliverableId` is always navigable via `onViewDeliverable`.
 */
export type WorkspaceDeliverableDownstreamLink = {
  deliverableId: string;
  title?: string;
  agentName?: string;
  atMs?: number;
};

export type WorkspaceDeliverableTrace = {
  deliverableId: string;
  deliverable: WorkspaceDeliverable;
  steps: WorkspaceDeliverableTraceStep[];
  citedKnowledge: WorkspaceDeliverableCitedKnowledge[];
  /** Downstream 成果 generated from this one's archived knowledge (Work Memory Network edges). */
  downstreamDeliverables?: WorkspaceDeliverableDownstreamLink[];
  modelUsage?: WorkspaceDeliverableModelUsage | null;
  previewText?: string;
  dataSource: "lineage" | "live" | "reconstructed";
};

export type GetWorkspaceDeliverableTraceParams = {
  userId: string;
  deliverableId: string;
  groupIds?: string[];
};

export type GetWorkspaceDeliverableTraceResult = {
  trace: WorkspaceDeliverableTrace;
};
