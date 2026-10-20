import type {
  WorkspaceArtifactGovernanceStatus,
  WorkspaceArtifactKind,
  WorkspaceArtifactSourceType,
  WorkspaceDeliverable,
} from "./types.js";

export function resolveWorkspaceArtifactSourceType(input: {
  legacySource: string;
  title?: string;
  kind?: string;
  contentType?: string;
  sourceType?: WorkspaceArtifactSourceType;
}): WorkspaceArtifactSourceType {
  if (input.sourceType) {
    return input.sourceType;
  }
  switch (input.legacySource) {
    case "agent":
      return "agent";
    case "group":
      return "collaboration";
    case "task":
      return "task";
    case "enterprise":
      return "enterprise";
    case "external":
      return "external";
    case "chat":
      return "personal";
    default:
      break;
  }
  const haystack =
    `${input.title ?? ""} ${input.kind ?? ""} ${input.contentType ?? ""}`.toLowerCase();
  if (/(pdf|url|import|external|webpage|第三方)/i.test(haystack)) {
    return "external";
  }
  return "personal";
}

export function resolveWorkspaceArtifactKind(input: {
  kind: string;
  sourceType: WorkspaceArtifactSourceType;
  artifactKind?: WorkspaceArtifactKind;
}): WorkspaceArtifactKind {
  if (input.artifactKind) {
    return input.artifactKind;
  }
  const kind = input.kind.trim().toLowerCase();
  if (kind === "report" || kind === "analysis") {
    return "report";
  }
  if (kind === "note") {
    return "note";
  }
  if (input.sourceType === "agent") {
    return "agent_result";
  }
  if (input.sourceType === "task") {
    return "workflow_output";
  }
  if (input.sourceType === "enterprise") {
    return "knowledge";
  }
  return "document";
}

export function resolveWorkspaceArtifactGovernanceStatus(input: {
  governanceStatus?: WorkspaceArtifactGovernanceStatus;
  relatedKnowledgeBaseId?: string;
  sourceType: WorkspaceArtifactSourceType;
}): WorkspaceArtifactGovernanceStatus {
  if (input.governanceStatus) {
    return input.governanceStatus;
  }
  if (input.sourceType === "enterprise") {
    return "verified";
  }
  return "pending";
}

export function enrichWorkspaceDeliverableArtifactFields(
  item: Omit<WorkspaceDeliverable, "sourceType" | "artifactKind" | "governanceStatus"> &
    Partial<Pick<WorkspaceDeliverable, "sourceType" | "artifactKind" | "governanceStatus">>,
): WorkspaceDeliverable {
  const sourceType = resolveWorkspaceArtifactSourceType({
    legacySource: item.source,
    title: item.title,
    kind: item.kind,
    contentType: item.contentType,
    sourceType: item.sourceType,
  });
  const artifactKind = resolveWorkspaceArtifactKind({
    kind: item.kind,
    sourceType,
    artifactKind: item.artifactKind,
  });
  const governanceStatus = resolveWorkspaceArtifactGovernanceStatus({
    governanceStatus: item.governanceStatus,
    relatedKnowledgeBaseId: item.relatedKnowledgeBaseId,
    sourceType,
  });
  return {
    ...item,
    sourceType,
    artifactKind,
    governanceStatus,
  };
}
