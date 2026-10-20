/**
 * templates.ts — DeliveryLane attach templates (Tip A + Tip F library).
 *
 * Tip F adds JSON-backed 「云电脑体验轨」「协作双门禁」with hosted-CI→local must-green.
 * attach still via lane.attach — tip-prompt must NOT replace attach.
 */

import cloudComputerExperienceJson from "./template-library/cloud-computer-experience.json" with { type: "json" };
import collabDualGateJson from "./template-library/collab-dual-gate.json" with { type: "json" };
import type { DeliveryLaneTemplate } from "./types.js";

export const DELIVERY_LANE_DEFAULT_TEMPLATE_ID = "default";

type LibraryJson = {
  id: string;
  label: string;
  description: string;
  initialMode: "implement" | "review" | "accept" | "merge";
  ciPolicy?: {
    hostedCiBillingBlocked: boolean;
    mustGreenLocally: boolean;
    strategy: string;
  };
  gates?: string[];
  cutoverNote?: string;
};

function fromLibrary(json: LibraryJson): DeliveryLaneTemplate {
  return {
    id: json.id,
    label: json.label,
    description: json.description,
    initialMode: json.initialMode === "merge" ? "implement" : json.initialMode,
    ...(json.ciPolicy ? { ciPolicy: { ...json.ciPolicy } } : {}),
    ...(json.gates ? { gates: [...json.gates] } : {}),
    ...(json.cutoverNote ? { cutoverNote: json.cutoverNote } : {}),
  };
}

const BUILTIN: DeliveryLaneTemplate[] = [
  {
    id: "default",
    label: "默认交付轨",
    description: "tip → seal → merge_ready 守卫（不合 GitHub）。",
    initialMode: "implement",
  },
  {
    id: "cloud-computer-tip",
    label: "云电脑体验轨",
    description: "云电脑 tip 交付模板；合入≠切流。（legacy id；prefer cloud-computer-experience）",
    initialMode: "implement",
  },
  fromLibrary(cloudComputerExperienceJson as LibraryJson),
  fromLibrary(collabDualGateJson as LibraryJson),
];

export function listDeliveryLaneTemplates(): DeliveryLaneTemplate[] {
  return BUILTIN.map((t) => ({
    ...t,
    ...(t.ciPolicy ? { ciPolicy: { ...t.ciPolicy } } : {}),
    ...(t.gates ? { gates: [...t.gates] } : {}),
  }));
}

export function getDeliveryLaneTemplate(templateId: string): DeliveryLaneTemplate | null {
  const id = templateId.trim();
  if (!id) {
    return null;
  }
  const found = BUILTIN.find((t) => t.id === id);
  if (!found) {
    return null;
  }
  return {
    ...found,
    ...(found.ciPolicy ? { ciPolicy: { ...found.ciPolicy } } : {}),
    ...(found.gates ? { gates: [...found.gates] } : {}),
  };
}
