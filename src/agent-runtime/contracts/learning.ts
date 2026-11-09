import type { AgentLearningAsset } from "@openbot/collaboration-core";

/** 单条可复述的经验。 */
export type LearningRecallEntry = {
  assetId: string;
  assetType: NonNullable<AgentLearningAsset["assetType"]>;
  /** 人类可读的一句话教训（已由晋升侧构造）。 */
  lesson: string;
  confidence: NonNullable<AgentLearningAsset["confidence"]>;
  /**
   * @deprecated W4: legacy exposure alias (= injectedCount ?? reuseCount).
   * Prompt copy should say 曝光, not 复用.
   */
  reuseCount: number;
  /** W4: prompt-injection exposure count. */
  injectedCount: number;
  /** W4: TaskOutcome-verified effective reuse count. */
  outcomeVerifiedCount: number;
  isAntiPattern: boolean;
};

export type LearningRecall = {
  capabilities: string[];
  lessons: LearningRecallEntry[];
};
