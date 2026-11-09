import { createSubsystemLogger } from "../../logging/subsystem.js";
import {
  INTERACTION_PROSE_PROTOCOL_DOWNGRADE,
  type InteractionModelDecision,
  type InteractionModelInput,
} from "../contracts/interaction.js";
import {
  admitExecutionRequest,
  type ExecutionAdmissionInput,
  type ExecutionAdmissionPorts,
  type ExecutionAdmissionResult,
} from "./execution-admission.js";
import { formatRestrictedInteractionNotice } from "./interaction-sources.js";
import { interpretInteraction, type InteractionInferencePort } from "./interpret-interaction.js";

const interactionLog = createSubsystemLogger("agent-runtime/interaction");

export type RoutedInteraction =
  | {
      kind: "respond";
      text: string;
      clarification: boolean;
      /** Set only when the host adapted plain text. Not an admission fact. */
      protocolDowngrade?: typeof INTERACTION_PROSE_PROTOCOL_DOWNGRADE;
    }
  | {
      kind: "task_proposal";
      decision: Extract<InteractionModelDecision, { kind: "task_change" | "task_control" }>;
    }
  | { kind: "execution_admission"; result: ExecutionAdmissionResult };

/** One interaction decision; only explicit execution requests reach task admission.
 * This function never runs tools, schedules retries or dispatches execution. */
export async function routeInteraction(
  input: InteractionModelInput,
  captured: Omit<ExecutionAdmissionInput, "proposal" | "abortSignal">,
  ports: { inference: InteractionInferencePort; admission: ExecutionAdmissionPorts },
): Promise<RoutedInteraction> {
  const decision = await interpretInteraction(input, ports.inference);
  if (
    input.availability?.mode === "restricted" &&
    decision.kind !== "reply" &&
    decision.kind !== "clarify"
  ) {
    return {
      kind: "respond",
      text: formatRestrictedInteractionNotice(input.availability),
      clarification: false,
    };
  }
  switch (decision.kind) {
    case "reply":
    case "clarify": {
      const protocolDowngrade = decision.kind === "reply" ? decision.protocolDowngrade : undefined;
      if (protocolDowngrade) {
        interactionLog.info(
          `interaction protocol downgrade=${protocolDowngrade} admitted=false chars=${decision.text.length}`,
        );
      }
      return {
        kind: "respond",
        text: decision.text,
        clarification: decision.kind === "clarify",
        ...(protocolDowngrade ? { protocolDowngrade } : {}),
      };
    }
    case "task_change":
    case "task_control":
      return { kind: "task_proposal", decision };
    case "execution_request":
      return {
        kind: "execution_admission",
        result: await admitExecutionRequest(
          { ...captured, proposal: decision.request, abortSignal: input.abortSignal },
          ports.admission,
        ),
      };
  }
}

/**
 * Admission facts come only from an accepted execution admission.
 * Reply text, including “已接纳” or “已开始”, is not a fact.
 */
export function interactionAdmissionFact(routed: RoutedInteraction): {
  admitted: boolean;
  taskId?: string;
  protocolDowngrade?: typeof INTERACTION_PROSE_PROTOCOL_DOWNGRADE;
} {
  if (routed.kind === "execution_admission" && routed.result.kind === "accepted") {
    return { admitted: true, taskId: routed.result.binding.taskId };
  }
  if (routed.kind === "respond" && routed.protocolDowngrade) {
    return { admitted: false, protocolDowngrade: routed.protocolDowngrade };
  }
  return { admitted: false };
}
