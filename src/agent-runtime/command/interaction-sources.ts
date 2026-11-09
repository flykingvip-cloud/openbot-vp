import type {
  InteractionAvailability,
  InteractionRestriction,
} from "../contracts/interaction-availability.js";
import { isRecoverableInteractionSourceError } from "../policy/index.js";

/** One-turn source boundary; never starts inference, retries, writes tasks or changes authority. */
export function createInteractionSourceBoundary() {
  const reasons = new Set<InteractionRestriction>();
  return {
    get availability(): InteractionAvailability | undefined {
      return reasons.size ? { mode: "restricted", reasons: [...reasons] } : undefined;
    },
    restrict(reason: InteractionRestriction) {
      reasons.add(reason);
    },
    read<T>(reason: InteractionRestriction, source: () => T, fallback: T): T {
      try {
        return source();
      } catch (error) {
        if (!isRecoverableInteractionSourceError(error)) {
          throw error;
        }
        reasons.add(reason);
        return fallback;
      }
    },
    async readAsync<T>(
      reason: InteractionRestriction,
      source: () => Promise<T>,
      fallback: T,
    ): Promise<T> {
      try {
        return await source();
      } catch (error) {
        if (!isRecoverableInteractionSourceError(error)) {
          throw error;
        }
        reasons.add(reason);
        return fallback;
      }
    },
  };
}

export function formatRestrictedInteractionNotice(availability: InteractionAvailability): string {
  if (availability.reasons.includes("task_mutation_unconfirmed")) {
    return "刚才任务操作的结果暂时无法确认，未自动重试。你可以继续对话；再次执行前需要核对任务状态。";
  }
  return availability.reasons.includes("task_state_unavailable")
    ? "当前可以继续对话，但任务状态暂时无法可靠确认；本条消息不会启动、修改、暂停或恢复任务。"
    : "当前可以继续对话，但部分对话记录或上下文暂时不可用；本条消息不会启动或变更任务。";
}
