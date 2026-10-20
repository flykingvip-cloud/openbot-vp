import type { GroupCapabilityProfile } from "@openbot/collaboration-core";
import type { GroupMemory } from "@openbot/collaboration-core";
import type { CapabilitySet } from "./capability-composer.js";
import type { ParticipationOverlay } from "./participation-overlay.js";
import type { ObjectSnapshots } from "./runtime-coordinator.js";

export interface ObjectSummary {
  type: "task" | "deliverable" | "review" | "decision";
  id: string;
  summary: string;
  relevance?: number;
}

export interface MemorySummary {
  id: string;
  content: string;
  timestamp: number;
  relevance?: number;
}

export interface CapabilityContext {
  capabilitySet: CapabilitySet;
  groupProfile?: GroupCapabilityProfile | null;
  participationOverlay?: ParticipationOverlay | null;
  policyFilters: string[];
  systemInstructions: string[];
  confidentialityTier?: string;
}

export interface ContextBuilder {
  buildObjectSummary(
    objects: ObjectSnapshots,
    options?: {
      maxObjects?: number;
      relevanceThreshold?: number;
    },
  ): ObjectSummary[];
  buildMemorySummary(
    memories: GroupMemory[],
    options?: {
      maxMemories?: number;
      relevanceThreshold?: number;
    },
  ): MemorySummary[];
  injectTaskMemory(taskId: string, memories: GroupMemory[]): MemorySummary[];
  buildCapabilityContext(params: {
    botId: string;
    groupId: string;
    personalCapabilities: string[];
    groupProfile?: GroupCapabilityProfile | null;
    overlay?: ParticipationOverlay | null;
    policyFilters?: string[];
  }): Promise<CapabilityContext>;
}
