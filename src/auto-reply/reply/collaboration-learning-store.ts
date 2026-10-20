import type { AgentLearningAsset } from "@openbot/collaboration-core";
import { OpenBotLearningStorage } from "@openbot/collaboration-openbot-adapter";
import { loadConfig, type OpenBotConfig } from "../../config/config.js";
import { createWorkspaceCollaborationStoresForDir } from "../../gateway/collaboration-learning/shared.js";

function readSkills(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : [];
}

function toUnique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

/** @deprecated Prefer `createWorkspaceCollaborationStoresForDir(cfg, workspaceDir).learningStorage`. */
export function createWorkspaceLearningStorage(workspaceDir: string): OpenBotLearningStorage {
  return createWorkspaceCollaborationStoresForDir(loadConfig(), workspaceDir).learningStorage;
}

export function extractCapabilitiesFromLearningAsset(asset: AgentLearningAsset): string[] {
  return toUnique([
    ...readSkills(asset.abstractedContent?.capabilities),
    ...readSkills(asset.metadata?.skills),
  ]);
}

export async function readPromotedCapabilitiesForBot(params: {
  workspaceDir: string;
  groupId: string;
  botId: string;
  cfg?: OpenBotConfig;
}): Promise<string[]> {
  const { learningStorage } = createWorkspaceCollaborationStoresForDir(
    params.cfg ?? loadConfig(),
    params.workspaceDir,
  );
  const assets = await learningStorage.readLearningAssets(params.groupId, params.botId);
  const activeAssets = assets.filter(
    (asset) => asset.status === undefined || asset.status === "active",
  );
  return toUnique(activeAssets.flatMap(extractCapabilitiesFromLearningAsset));
}

function readAbstractedText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

/** Render one learning asset as a short prompt instruction (title + summary). */
export function formatLearningAssetInstruction(asset: AgentLearningAsset): string | undefined {
  const title = readAbstractedText(asset.abstractedContent?.title);
  const summary = readAbstractedText(asset.abstractedContent?.summary);
  if (!title && !summary) {
    return undefined;
  }
  const label =
    asset.assetType === "pattern"
      ? "Pattern"
      : asset.sourceCapsuleId && asset.assetType === "lesson"
        ? "Lesson"
        : asset.assetType === "playbook"
          ? "Playbook"
          : asset.assetType === "decision_rule"
            ? "Rule"
            : "Learning";
  const body = [title, summary && title !== summary ? summary : undefined]
    .filter(Boolean)
    .join(": ");
  return `[${label}] ${body}`.slice(0, 600);
}

export async function readPromotedLearningInstructionsForBot(params: {
  workspaceDir: string;
  groupId: string;
  botId: string;
  cfg?: OpenBotConfig;
  limit?: number;
}): Promise<string[]> {
  const limit = params.limit ?? 8;
  const { learningStorage } = createWorkspaceCollaborationStoresForDir(
    params.cfg ?? loadConfig(),
    params.workspaceDir,
  );
  const assets = await learningStorage.readLearningAssets(params.groupId, params.botId);
  const activeAssets = assets.filter(
    (asset) => asset.status === undefined || asset.status === "active",
  );
  const instructions: string[] = [];
  for (const asset of activeAssets) {
    const line = formatLearningAssetInstruction(asset);
    if (line) {
      instructions.push(line);
    }
    if (instructions.length >= limit) {
      break;
    }
  }
  return instructions;
}
