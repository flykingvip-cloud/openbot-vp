/**
 * Scene catalog selection. Chat type is recorded so callers can pass it,
 * and it never chooses the collaboration catalog.
 */
export type ContextCatalogName = "individual" | "collaboration-member";

export function selectContextCatalog(params: {
  chatType?: string | null;
  collaborationAssembly: boolean;
}): ContextCatalogName {
  if (params.chatType === "group" && !params.collaborationAssembly) {
    return "individual";
  }
  return params.collaborationAssembly ? "collaboration-member" : "individual";
}

/** Group-layer ids. Individual assembly must fail if any of these are supplied. */
export const INDIVIDUAL_FORBIDDEN_GROUP_MATERIALS = [
  "groupContext",
  "groupIntro",
  "groupSystemPrompt",
  "charter",
  "mission",
  "phase",
  "delivery",
  "capabilities",
] as const;
