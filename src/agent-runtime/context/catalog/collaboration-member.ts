/** Existing collaboration material order; source reads and delivery authority stay in the host. */
export const COLLABORATION_MEMBER_CONTEXT_ORDER = [
  "operationalIdentity",
  "charter",
  "mission",
  "delivery",
  "phase",
  "groupContext",
  "groupIntro",
  "continuity",
  "capabilities",
  "groupSystemPrompt",
  "inboundMetadata",
] as const;

export type CollaborationMemberContextMaterial =
  (typeof COLLABORATION_MEMBER_CONTEXT_ORDER)[number];
