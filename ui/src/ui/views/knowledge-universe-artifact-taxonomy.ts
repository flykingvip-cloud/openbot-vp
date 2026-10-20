import { t } from "../../i18n/index.ts";
import type { WorkspaceDeliverableDto } from "../capability/knowledge-universe/workspace-endpoints.ts";

/** Canonical artifact source type — trust / governance context, not UI decoration. */
export type ArtifactSourceType =
  | "agent"
  | "collaboration"
  | "task"
  | "enterprise"
  | "personal"
  | "external";

/** Object shape — separate from where it came from. */
export type ArtifactKind =
  | "document"
  | "report"
  | "agent_result"
  | "workflow_output"
  | "knowledge"
  | "note";

export type ArtifactGovernanceStatus = "verified" | "pending" | "conflict";

const TRUST_SCORE_BY_SOURCE: Record<ArtifactSourceType, number> = {
  enterprise: 0.95,
  collaboration: 0.75,
  task: 0.75,
  personal: 0.7,
  agent: 0.65,
  external: 0.55,
};

type LegacyDeliverableSource = WorkspaceDeliverableDto["source"];

export function normalizeArtifactSourceType(
  item: Pick<WorkspaceDeliverableDto, "source" | "sourceType" | "title" | "kind" | "contentType">,
): ArtifactSourceType {
  if (item.sourceType) {
    return item.sourceType;
  }
  const legacy = item.source as string;
  switch (legacy) {
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
  const haystack = `${item.title} ${item.kind} ${item.contentType ?? ""}`.toLowerCase();
  if (/(pdf|网页|url|import|external|第三方)/i.test(haystack)) {
    return "external";
  }
  return "personal";
}

export function normalizeArtifactKind(
  item: Pick<WorkspaceDeliverableDto, "kind" | "artifactKind" | "source" | "sourceType" | "title">,
): ArtifactKind {
  if (item.artifactKind) {
    return item.artifactKind;
  }
  const sourceType = normalizeArtifactSourceType(item);
  const kind = item.kind.trim().toLowerCase();
  if (kind === "report" || kind === "analysis") {
    return "report";
  }
  if (kind === "note") {
    return "note";
  }
  if (sourceType === "agent") {
    return "agent_result";
  }
  if (sourceType === "task") {
    return "workflow_output";
  }
  if (sourceType === "enterprise") {
    return "knowledge";
  }
  return "document";
}

export function resolveArtifactGovernanceStatus(
  item: Pick<
    WorkspaceDeliverableDto,
    "governanceStatus" | "relatedKnowledgeBaseId" | "source" | "sourceType" | "title" | "kind"
  >,
): ArtifactGovernanceStatus {
  if (item.governanceStatus) {
    return item.governanceStatus;
  }
  if (item.relatedKnowledgeBaseId) {
    return "verified";
  }
  const sourceType = normalizeArtifactSourceType(item);
  if (sourceType === "enterprise") {
    return "verified";
  }
  return "pending";
}

export function artifactSourceTrustScore(sourceType: ArtifactSourceType): number {
  return TRUST_SCORE_BY_SOURCE[sourceType];
}

export function artifactSourceTypePillClass(sourceType: ArtifactSourceType): string {
  return `knowledge-universe__artifact-source-pill knowledge-universe__artifact-source-pill--${sourceType}`;
}

export function labelArtifactSourceType(sourceType: ArtifactSourceType): string {
  return t(`frontstage.workbench.knowledgeUniverse.workspace.artifactSourceType.${sourceType}`);
}

export function labelArtifactSourceTypeShort(sourceType: ArtifactSourceType): string {
  return t(
    `frontstage.workbench.knowledgeUniverse.workspace.artifactSourceTypeShort.${sourceType}`,
  );
}

export function labelArtifactGovernanceStatus(status: ArtifactGovernanceStatus): string {
  return t(`frontstage.workbench.knowledgeUniverse.workspace.artifactGovernance.${status}`);
}

export function titleArtifactGovernanceStatus(status: ArtifactGovernanceStatus): string {
  const hintKey = `frontstage.workbench.knowledgeUniverse.workspace.artifactGovernance.${status}Hint`;
  const hint = t(hintKey);
  return hint === hintKey ? labelArtifactGovernanceStatus(status) : hint;
}

export function artifactGovernanceStatusClass(status: ArtifactGovernanceStatus): string {
  return `knowledge-universe__artifact-governance knowledge-universe__artifact-governance--${status}`;
}

/** Map legacy API filter values to canonical source types. */
export function legacySourceToArtifactSourceType(source: string): ArtifactSourceType {
  return normalizeArtifactSourceType({
    source: source as LegacyDeliverableSource,
    kind: "",
    title: "",
  });
}
