import type { EventLoopYielder } from "../event-loop-yield.js";
import type { KnowledgeObject } from "../types.js";

export const RELATIONSHIP_CONFLICT_YIELD_EVERY = 256;

const CONFLICT_MARKERS = [
  ["增长", "下降"],
  ["上升", "下滑"],
  ["通过", "否决"],
  ["允许", "禁止"],
  ["fresh", "stale"],
  ["fresh", "expired"],
];

/** Tags too broad to infer a factual conflict (e.g. every uploaded PDF shares them). */
const GENERIC_TOPIC_TAGS = new Set([
  "pdf",
  "doc",
  "document",
  "上传文档",
  "uploaded",
  "uploaded-doc",
  "upload",
  "file",
  "文档",
  "知识",
]);

function normalizeTag(value: string): string {
  return value.trim().toLowerCase();
}

function sharedTags(left: KnowledgeObject, right: KnowledgeObject): string[] {
  const rightTags = new Set(right.tags.map(normalizeTag));
  return left.tags.map(normalizeTag).filter((tag) => tag && rightTags.has(tag));
}

function substantiveSharedTags(left: KnowledgeObject, right: KnowledgeObject): string[] {
  return sharedTags(left, right).filter((tag) => !GENERIC_TOPIC_TAGS.has(tag));
}

function hasConflictSignal(left: KnowledgeObject, right: KnowledgeObject): string | null {
  const leftText = `${left.title} ${left.summary}`.toLowerCase();
  const rightText = `${right.title} ${right.summary}`.toLowerCase();
  for (const [a, b] of CONFLICT_MARKERS) {
    if (
      (leftText.includes(a) && rightText.includes(b)) ||
      (leftText.includes(b) && rightText.includes(a))
    ) {
      return `${a}/${b}`;
    }
  }
  if (
    left.kind === right.kind &&
    left.source === right.source &&
    substantiveSharedTags(left, right).length >= 2 &&
    left.summary !== right.summary
  ) {
    return "same-topic-divergent-summary";
  }
  return null;
}

export function detectRelationshipConflicts(objects: KnowledgeObject[]): Array<{
  leftId: string;
  rightId: string;
  reason: string;
}> {
  const conflicts: Array<{ leftId: string; rightId: string; reason: string }> = [];
  for (let index = 0; index < objects.length; index += 1) {
    for (let inner = index + 1; inner < objects.length; inner += 1) {
      const left = objects[index];
      const right = objects[inner];
      const reason = hasConflictSignal(left, right);
      if (!reason) {
        continue;
      }
      conflicts.push({ leftId: left.id, rightId: right.id, reason });
    }
  }
  return conflicts;
}

export async function detectRelationshipConflictsAsync(
  objects: KnowledgeObject[],
  options?: { yieldFn?: EventLoopYielder; yieldEvery?: number },
): Promise<Array<{ leftId: string; rightId: string; reason: string }>> {
  const yieldEvery = Math.max(1, options?.yieldEvery ?? RELATIONSHIP_CONFLICT_YIELD_EVERY);
  const yieldFn = options?.yieldFn;
  const conflicts: Array<{ leftId: string; rightId: string; reason: string }> = [];
  let steps = 0;
  for (let index = 0; index < objects.length; index += 1) {
    for (let inner = index + 1; inner < objects.length; inner += 1) {
      const left = objects[index];
      const right = objects[inner];
      const reason = hasConflictSignal(left, right);
      if (reason) {
        conflicts.push({ leftId: left.id, rightId: right.id, reason });
      }
      steps += 1;
      if (yieldFn && steps % yieldEvery === 0) {
        await yieldFn();
      }
    }
  }
  return conflicts;
}
