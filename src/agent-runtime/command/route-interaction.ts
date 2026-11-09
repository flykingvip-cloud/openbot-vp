import type { InteractionModelDecision, InteractionModelInput } from "../contracts/interaction.js";
import {
  admitExecutionRequest,
  type ExecutionAdmissionInput,
  type ExecutionAdmissionPorts,
  type ExecutionAdmissionResult,
} from "./execution-admission.js";
import { formatRestrictedInteractionNotice } from "./interaction-sources.js";
import { interpretInteraction, type InteractionInferencePort } from "./interpret-interaction.js";

export type RoutedInteraction =
  | { kind: "respond"; text: string; clarification: boolean }
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
    case "clarify":
      return { kind: "respond", text: decision.text, clarification: decision.kind === "clarify" };
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
