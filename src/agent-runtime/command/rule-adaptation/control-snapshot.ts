import type { ShadowControlSnapshot } from "../../contracts/rule-adaptation-shadow.js";

const EMPTY_BOARD: ShadowControlSnapshot = {
  task: { liveTasks: [], status: "idle" },
  claim: { claims: [] },
  plan: { steps: [] },
  todo: { items: [] },
  taskControl: { requests: [] },
};

export function cloneControlSnapshot(value: ShadowControlSnapshot): ShadowControlSnapshot {
  return {
    task: structuredClone(value.task),
    claim: structuredClone(value.claim),
    plan: structuredClone(value.plan),
    todo: structuredClone(value.todo),
    taskControl: structuredClone(value.taskControl),
  };
}

export function emptyControlSnapshot(): ShadowControlSnapshot {
  return cloneControlSnapshot(EMPTY_BOARD);
}

export function stableControlHash(value: ShadowControlSnapshot): string {
  return JSON.stringify(value);
}

export function controlSnapshotsEqual(
  left: ShadowControlSnapshot,
  right: ShadowControlSnapshot,
): boolean {
  return stableControlHash(left) === stableControlHash(right);
}
