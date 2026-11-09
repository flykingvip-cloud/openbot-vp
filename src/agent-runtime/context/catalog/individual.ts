/** Fixed material order for individual turns. Data only; never reads sources or runs policy. */
export const INDIVIDUAL_CONTEXT_ORDER = [
  "inboundMetadata",
  "replyLanguage",
  "timezone",
  "environment",
  "userProfile",
  "seatRules",
  "conversationFocus",
  "taskBoard",
  "primaryObjective",
  "dataPreflight",
  "continuity",
  "knowledge",
  "operationalIdentity",
  "mentionHints",
  "birth",
  "scheduledReply",
] as const;

export type IndividualContextMaterial = (typeof INDIVIDUAL_CONTEXT_ORDER)[number];
