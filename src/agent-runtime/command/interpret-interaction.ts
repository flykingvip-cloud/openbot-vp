import {
  INTERACTION_PROSE_PROTOCOL_DOWNGRADE,
  type InteractionModelDecision,
  type InteractionModelInput,
} from "../contracts/interaction.js";
import { parseTaskAcceptanceChecks } from "../policy/index.js";
import { UNBOUND_TASK_TARGET_CLARIFY } from "./host-task-target.js";

export type InteractionInferencePort = {
  /** Fixed host supplies governed inference; no tools or task-state effects are exposed. */
  infer: (input: InteractionModelInput) => Promise<unknown>;
};

/** Diagnostics contain schema facts only, never model text, targets or arbitrary keys. */
export class InteractionDecisionValidationError extends Error {
  readonly shape: Record<string, unknown>;
  constructor(message: string, value: unknown) {
    super(message);
    const row =
      value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};
    const known = [
      "kind",
      "text",
      "target",
      "mode",
      "action",
      "answer",
      "request",
      "goal",
      "acceptance",
    ];
    const kinds = ["reply", "clarify", "execution_request", "task_change", "task_control"];
    const type = (v: unknown) => (v === null ? "null" : Array.isArray(v) ? "array" : typeof v);
    this.shape = {
      valueType: type(value),
      kind: kinds.includes(String(row.kind)) ? row.kind : "unsupported",
      fields: Object.fromEntries(
        known.filter((k) => Object.hasOwn(row, k)).map((k) => [k, type(row[k])]),
      ),
      unknownFieldCount: Object.keys(row).filter((k) => !known.includes(k)).length,
      mode: ["supplement", "revise", "replace_all"].includes(String(row.mode))
        ? row.mode
        : type(row.mode),
    };
  }
}

function parseDecision(value: unknown): InteractionModelDecision {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid interaction decision");
  }
  const row = value as Record<string, unknown>;
  if (row.kind === "task_change" || row.kind === "task_control") {
    if (row.answer !== undefined && (typeof row.answer !== "string" || !row.answer.trim())) {
      throw new Error("Invalid interaction answer");
    }
    const answer = typeof row.answer === "string" ? { answer: row.answer } : {};
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
      (row.mode === undefined ||
        row.mode === "supplement" ||
        row.mode === "revise" ||
        row.mode === "replace_all") &&
      Object.keys(row).every((key) => ["kind", "target", "text", "mode", "answer"].includes(key))
    ) {
      return {
        kind: "task_change",
        target: checkedTarget,
        text: row.text,
        ...(row.mode ? { mode: row.mode } : {}),
        ...answer,
      };
    }
    if (
      row.kind === "task_control" &&
      (row.action === "pause" || row.action === "cancel" || row.action === "resume") &&
      Object.keys(row).every((key) => ["kind", "target", "action", "answer"].includes(key))
    ) {
      return { kind: "task_control", target: checkedTarget, action: row.action, ...answer };
    }
    throw new Error("Invalid interaction task decision");
  }
  if (row.kind === "reply" || row.kind === "clarify") {
    const protocolDowngrade = row.protocolDowngrade === INTERACTION_PROSE_PROTOCOL_DOWNGRADE;
    const allowed = new Set(["kind", "text", ...(protocolDowngrade ? ["protocolDowngrade"] : [])]);
    if (
      Object.keys(row).some((key) => !allowed.has(key)) ||
      typeof row.text !== "string" ||
      !row.text.trim()
    ) {
      throw new Error("Invalid interaction reply");
    }
    return {
      kind: row.kind,
      text: row.text,
      ...(row.kind === "reply" && protocolDowngrade
        ? { protocolDowngrade: INTERACTION_PROSE_PROTOCOL_DOWNGRADE }
        : {}),
    };
  }
  if (
    row.kind === "execution_request" &&
    Object.keys(row).every((key) => key === "kind" || key === "request")
  ) {
    const request = row.request;
    if (request && typeof request === "object" && !Array.isArray(request)) {
      const item = request as Record<string, unknown>;
      if (
        Object.keys(item).every(
          (key) =>
            key === "goal" || key === "acceptance" || key === "checks" || key === "lifecycle",
        ) &&
        (item.lifecycle === undefined ||
          item.lifecycle === "turn" ||
          item.lifecycle === "long_task") &&
        typeof item.goal === "string" &&
        item.goal.trim() &&
        Array.isArray(item.acceptance) &&
        item.acceptance.length > 0 &&
        item.acceptance.every((criterion) => typeof criterion === "string" && criterion.trim())
      ) {
        const parsedChecks = parseTaskAcceptanceChecks(item.checks, item.acceptance.length);
        if (!parsedChecks.ok) {
          throw new Error("Invalid interaction acceptance checks");
        }
        return {
          kind: "execution_request",
          request: {
            goal: item.goal,
            acceptance: [...item.acceptance] as string[],
            ...(item.lifecycle !== undefined ? { lifecycle: item.lifecycle } : {}),
            ...(item.checks !== undefined ? { checks: parsedChecks.checks } : {}),
          },
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
  let decision: InteractionModelDecision;
  try {
    decision = parseDecision(proposal);
  } catch (error) {
    if (!(error instanceof Error) || !error.message.startsWith("Invalid interaction")) {
      throw error;
    }
    throw new InteractionDecisionValidationError(error.message, proposal);
  }
  if (decision.kind === "task_change" || decision.kind === "task_control") {
    if (!input.taskTarget) {
      return { kind: "clarify", text: UNBOUND_TASK_TARGET_CLARIFY };
    }
    if (
      input.taskTarget.taskId !== decision.target.taskId ||
      input.taskTarget.revision !== decision.target.revision
    ) {
      throw new Error("Interaction target is not bound to this request");
    }
  }
  return decision;
}
