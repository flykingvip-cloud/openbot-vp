import {
  KNOWLEDGE_UNIVERSE_ANCHOR_SUPPLY_MAP,
  KNOWLEDGE_UNIVERSE_ANCHORS,
  type KnowledgeUniverseSupplySection,
} from "./knowledge-universe-anchors.ts";

const SUPPLY_SUB_PANEL_IDS: Record<string, string> = {
  private: "ku-supply-private",
  personal: "ku-supply-private",
  team: "ku-supply-team",
  enterprise: "ku-supply-enterprise",
  capabilities: "ku-supply-capabilities",
};

export type KnowledgeUniverseAnchorNavigateOptions = {
  /** Scroll to this element id instead of the section anchor (still expands supply panels). */
  focusId?: string;
  block?: ScrollLogicalPosition;
};

function openDetailsElement(id: string) {
  if (typeof document === "undefined") {
    return;
  }
  const element = document.getElementById(id);
  if (element instanceof HTMLDetailsElement) {
    element.open = true;
  }
}

function scrollSupplySectionIntoView(section: KnowledgeUniverseSupplySection) {
  if (typeof document === "undefined") {
    return;
  }
  requestAnimationFrame(() => {
    document.getElementById(SUPPLY_SUB_PANEL_IDS[section])?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
    });
  });
}

export function expandKnowledgeUniverseSupplySection(section: KnowledgeUniverseSupplySection) {
  openDetailsElement(KNOWLEDGE_UNIVERSE_ANCHORS.supplyAccordion);
  scrollSupplySectionIntoView(section);
}

export function navigateKnowledgeUniverseAnchor(
  anchorId: string,
  options?: KnowledgeUniverseAnchorNavigateOptions,
) {
  if (typeof document === "undefined") {
    return;
  }
  const supplySection = KNOWLEDGE_UNIVERSE_ANCHOR_SUPPLY_MAP[anchorId];
  if (supplySection) {
    expandKnowledgeUniverseSupplySection(supplySection);
  }
  const scrollTargetId = options?.focusId ?? anchorId;
  requestAnimationFrame(() => {
    document.getElementById(scrollTargetId)?.scrollIntoView({
      behavior: "smooth",
      block: options?.block ?? "start",
    });
  });
}

export function focusKnowledgeUniverseField(fieldId: string) {
  if (typeof document === "undefined") {
    return;
  }
  requestAnimationFrame(() => {
    const element = document.getElementById(fieldId);
    if (element instanceof HTMLElement) {
      element.focus();
    }
  });
}
