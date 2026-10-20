import type { KnowledgeUniverseBrowseSubTab } from "../ports/employee/views/home-page-contracts.ts";

export const KNOWLEDGE_UNIVERSE_ANCHORS = {
  workspace: "ku-workspace",
  deliverables: "ku-deliverables",
  relations: "ku-relations",
  personal: "ku-personal",
  private: "ku-supply-private",
  team: "ku-supply-team",
  enterprise: "ku-enterprise",
  capabilityCenter: "ku-capability-center",
  supplyAccordion: "ku-supply-accordion",
  /** Scroll target for workspace search → evidence card highlight */
  kbSearchFocus: "ku-kb-search-focus",
  /** Scroll target for workspace search → deliverable row highlight */
  deliverableFocus: "ku-deliverable-focus",
  libraryCreateTitle: "ku-library-create-title",
} as const;

export type KnowledgeUniverseSupplySection = KnowledgeUniverseBrowseSubTab;

/** Maps anchor DOM ids to supply accordion sub-panels (null = visible on first screen). */
export const KNOWLEDGE_UNIVERSE_ANCHOR_SUPPLY_MAP: Record<
  string,
  KnowledgeUniverseSupplySection | null
> = {
  [KNOWLEDGE_UNIVERSE_ANCHORS.workspace]: null,
  [KNOWLEDGE_UNIVERSE_ANCHORS.deliverables]: null,
  [KNOWLEDGE_UNIVERSE_ANCHORS.relations]: null,
  [KNOWLEDGE_UNIVERSE_ANCHORS.personal]: "private",
  [KNOWLEDGE_UNIVERSE_ANCHORS.private]: "private",
  [KNOWLEDGE_UNIVERSE_ANCHORS.team]: "team",
  [KNOWLEDGE_UNIVERSE_ANCHORS.enterprise]: "enterprise",
  [KNOWLEDGE_UNIVERSE_ANCHORS.capabilityCenter]: "capabilities",
};
