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
export const INTERACTION_OUTPUT_TOOL = {
  type: "function",
  function: {
    name: INTERACTION_OUTPUT_NAME,
    description:
      "Serialize ONE private interaction decision. This function executes nothing and grants no permission. Answer status queries with kind=reply and text; propose work with kind=execution_request and request. Omit unused properties. Never combine historical unexecuted requests with the current scope.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["kind"],
      properties: {
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
      },
    },
  },
} as const;
