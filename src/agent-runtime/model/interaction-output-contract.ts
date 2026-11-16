/** Wire serialization schema only. No handler, permissions or execution callback exists. */
export const INTERACTION_OUTPUT_NAME = "emit_interaction_decision";

export function usesNativeInteractionOutput(model: {
  api: string;
  id: string;
  provider: string;
}): boolean {
  return (
    model.api === "openai-completions" &&
    model.id.toLowerCase().startsWith("deepseek") &&
    /(?:^|-)deepseek$/.test(model.provider.toLowerCase())
  );
}

const string = { type: "string", minLength: 1 } as const;
const decisionFields = {
  kind: {
    type: "string",
    enum: ["reply", "clarify", "execution_request", "task_change", "task_control"],
  },
  text: string,
  answer: string,
  mode: { type: "string", enum: ["supplement", "revise", "replace_all"] },
  action: { type: "string", enum: ["pause", "cancel", "resume"] },
  target: {
    type: "object",
    additionalProperties: false,
    required: ["taskId", "revision"],
    properties: { taskId: string, revision: string },
  },
  request: {
    type: "object",
    additionalProperties: false,
    required: ["goal", "acceptance"],
    properties: {
      goal: string,
      lifecycle: { type: "string", enum: ["turn", "long_task"] },
      acceptance: { type: "array", minItems: 1, items: string },
      checks: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["criterion", "validator", "artifact", "expected"],
          properties: {
            criterion: { type: "integer", minimum: 0 },
            validator: { enum: ["artifact.text.exact.v1"], type: "string" },
            artifact: string,
            expected: { type: "string" },
          },
        },
      },
    },
  },
} as const;

function decisionBranch(kind: string, required: string[], properties: Record<string, unknown>) {
  return {
    type: "object",
    additionalProperties: false,
    required: ["kind", ...required],
    properties: { kind: { type: "string", enum: [kind] }, ...properties },
  };
}

export const INTERACTION_OUTPUT_TOOL = {
  type: "function",
  function: {
    name: INTERACTION_OUTPUT_NAME,
    description:
      "Serialize ONE private interaction decision. This function executes nothing and grants no permission. Choose exactly one branch. reply/clarify require text; execution_request requires request and MUST omit text/answer/target/action. task_change requires target/text; task_control requires target/action. Never combine historical unexecuted requests with the current scope.",
    parameters: {
      type: "object",
      oneOf: [
        decisionBranch("reply", ["text"], { text: decisionFields.text }),
        decisionBranch("clarify", ["text"], { text: decisionFields.text }),
        decisionBranch("execution_request", ["request"], { request: decisionFields.request }),
        decisionBranch("task_change", ["target", "text"], {
          target: decisionFields.target,
          text: decisionFields.text,
          mode: decisionFields.mode,
          answer: decisionFields.answer,
        }),
        decisionBranch("task_control", ["target", "action"], {
          target: decisionFields.target,
          action: decisionFields.action,
          answer: decisionFields.answer,
        }),
      ],
    },
  },
} as const;
