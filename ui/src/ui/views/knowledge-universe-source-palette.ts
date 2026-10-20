import { t } from "../../i18n/index.ts";
import type { KnowledgeSource } from "../capability/knowledge-universe/types.ts";
import {
  artifactSourceTypePillClass,
  legacySourceToArtifactSourceType,
} from "./knowledge-universe-artifact-taxonomy.ts";

export type KnowledgeUniverseSourcePalette = KnowledgeSource | "deliverable";

export function resolveKnowledgeUniverseSourcePalette(
  sourceKind: string,
): KnowledgeUniverseSourcePalette {
  const normalized = sourceKind.trim().toLowerCase();
  if (normalized.includes("enterprise")) {
    return "enterprise";
  }
  if (normalized.includes("memory") || normalized.includes("personal") || normalized === "chat") {
    return "personal";
  }
  if (
    normalized.includes("capability") ||
    normalized.includes("data") ||
    normalized === "agent" ||
    normalized.includes("database")
  ) {
    return "data";
  }
  if (normalized.includes("artifact") || normalized === "task" || normalized === "group") {
    return "deliverable";
  }
  return "personal";
}

export function resolveDeliverableSourcePalette(source: string): KnowledgeUniverseSourcePalette {
  switch (source) {
    case "enterprise":
      return "enterprise";
    case "agent":
      return "data";
    case "group":
    case "task":
      return "deliverable";
    case "chat":
    default:
      return "personal";
  }
}

export function renderDeliverableSourcePillClass(source: string): string {
  return artifactSourceTypePillClass(legacySourceToArtifactSourceType(source));
}

export function renderDeliverableStatusPillClass(
  bucket: "archived" | "draft" | "in_progress" | "done" | "all",
): string {
  return `knowledge-universe__deliverable-status-pill knowledge-universe__deliverable-status-pill--${bucket}`;
}

export function renderKnowledgeUniverseSourcePaletteClass(
  palette: KnowledgeUniverseSourcePalette,
  prefix: string,
): string {
  return `${prefix} ${prefix}--${palette}`;
}

export function labelKnowledgeUniverseEvidenceSource(sourceKind: string): string {
  const palette = resolveKnowledgeUniverseSourcePalette(sourceKind);
  switch (palette) {
    case "enterprise":
      return t("frontstage.workbench.knowledgeUniverse.sources.enterprise");
    case "data":
      return t("frontstage.workbench.knowledgeUniverse.sources.data");
    case "deliverable":
      return t("frontstage.workbench.knowledgeUniverse.workspace.evidenceSource.deliverable");
    case "personal":
    default:
      return t("frontstage.workbench.knowledgeUniverse.workspace.evidenceSource.library");
  }
}
