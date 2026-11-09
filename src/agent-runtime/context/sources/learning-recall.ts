import type { LearningRecall, LearningRecallEntry } from "../../contracts/learning.js";

const ASSET_TYPE_LABEL: Record<LearningRecallEntry["assetType"], string> = {
  lesson: "经验教训",
  pattern: "有效模式",
  decision_rule: "决策规则",
  playbook: "操作手册",
  skill_delta: "能力增量",
};

function formatEntry(entry: LearningRecallEntry): string {
  const label = entry.isAntiPattern ? "负面模式" : ASSET_TYPE_LABEL[entry.assetType];
  const exposure = entry.injectedCount > 0 ? entry.injectedCount : entry.reuseCount;
  const exposureNote = exposure > 0 ? `，已曝光 ${exposure} 次` : "";
  const verifiedNote =
    entry.outcomeVerifiedCount > 0 ? `，已验证有效 ${entry.outcomeVerifiedCount} 次` : "";
  return `- [${label}｜置信度 ${entry.confidence}${exposureNote}${verifiedNote}] ${entry.lesson}`;
}

/** 渲染提示词片段（纯函数，便于单测）。 */
export function renderLearningRecallPrompt(recall: LearningRecall): string | undefined {
  if (recall.lessons.length === 0) {
    return undefined;
  }
  return [
    "## 已沉淀的经验（来自过往任务的复盘，已通过审批）",
    "在动手前先对照下面的经验；标为「负面模式」的做法不要重复。",
    "（提示：出现在本段只表示曝光，不表示本回合已采用或已验证有效。）",
    ...recall.lessons.map(formatEntry),
  ].join("\n");
}

export function mergeRecall(entries: LearningRecall[], limit: number): LearningRecall {
  const capabilities = [...new Set(entries.flatMap((entry) => entry.capabilities))];
  const seen = new Set<string>();
  const lessons: LearningRecallEntry[] = [];
  for (const entry of entries) {
    for (const lesson of entry.lessons) {
      if (seen.has(lesson.lesson)) {
        continue;
      }
      seen.add(lesson.lesson);
      lessons.push(lesson);
      if (lessons.length >= limit) {
        return { capabilities, lessons };
      }
    }
  }
  return { capabilities, lessons };
}
