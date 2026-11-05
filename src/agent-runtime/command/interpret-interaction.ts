import type { InteractionModelDecision, InteractionModelInput } from "../contracts/interaction.js";

export type InteractionInferencePort = {
  /** Fixed host supplies governed inference; no tools or task-state effects are exposed. */
  infer: (input: InteractionModelInput) => Promise<unknown>;
};

function parseDecision(value: unknown): InteractionModelDecision {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid interaction decision");
  }
  const row = value as Record<string, unknown>;
  if (row.kind === "task_change" || row.kind === "task_control") {
    const target = row.target;
    if (!target || typeof target !== "object" || Array.isArray(target)) {
      throw new Error("Invalid interaction target");
    }
    const binding = target as Record<string, unknown>;
    if (
      Object.keys(binding).some((key) => key !== "taskId" && key !== "revision") ||
      typeof binding.taskId !== "string" ||
      !binding.taskId.trim() ||
      typeof binding.revision !== "string" ||
      !binding.revision.trim()
    ) {
      throw new Error("Invalid interaction target");
    }
    const checkedTarget = { taskId: binding.taskId, revision: binding.revision };
    if (
      row.kind === "task_change" &&
      typeof row.text === "string" &&
      row.text.trim() &&
      Object.keys(row).every((key) => ["kind", "target", "text"].includes(key))
    ) {
      return { kind: "task_change", target: checkedTarget, text: row.text };
    }
    if (
      row.kind === "task_control" &&
      (row.action === "pause" || row.action === "cancel" || row.action === "resume") &&
      Object.keys(row).every((key) => ["kind", "target", "action"].includes(key))
    ) {
      return { kind: "task_control", target: checkedTarget, action: row.action };
    }
    throw new Error("Invalid interaction task decision");
  }
  if (row.kind === "reply" || row.kind === "clarify") {
    if (
      Object.keys(row).some((key) => key !== "kind" && key !== "text") ||
      typeof row.text !== "string" ||
      !row.text.trim()
    ) {
      throw new Error("Invalid interaction reply");
    }
    return { kind: row.kind, text: row.text };
  }
  if (
    row.kind === "execution_request" &&
    Object.keys(row).every((key) => key === "kind" || key === "request")
  ) {
    const request = row.request;
    if (request && typeof request === "object" && !Array.isArray(request)) {
      const item = request as Record<string, unknown>;
      if (
        Object.keys(item).every((key) => key === "goal" || key === "acceptance") &&
        typeof item.goal === "string" &&
        item.goal.trim() &&
        Array.isArray(item.acceptance) &&
        item.acceptance.length > 0 &&
        item.acceptance.every((criterion) => typeof criterion === "string" && criterion.trim())
      ) {
        return {
          kind: "execution_request",
          request: { goal: item.goal, acceptance: [...item.acceptance] as string[] },
        };
      }
    }
  }
  throw new Error("Invalid interaction decision");
}

/** One inference answers or proposes work. It cannot authorize, create or execute that work. */
export async function interpretInteraction(
  input: InteractionModelInput,
  port: InteractionInferencePort,
): Promise<InteractionModelDecision> {
  input.abortSignal?.throwIfAborted();
  const proposal = await port.infer(input);
  input.abortSignal?.throwIfAborted();
  const decision = parseDecision(proposal);
  if (decision.kind === "task_change" || decision.kind === "task_control") {
    if (
      !input.taskTarget ||
      input.taskTarget.taskId !== decision.target.taskId ||
      input.taskTarget.revision !== decision.target.revision
    ) {
      throw new Error("Interaction target is not bound to this request");
    }
  }
  return decision;
}
