import AjvPkg from "ajv";
import { expect, it } from "vitest";
import { INTERACTION_OUTPUT_TOOL } from "./interaction-output-contract.js";
const Ajv = AjvPkg.default ?? AjvPkg;
const validate = new Ajv({ strict: false }).compile(INTERACTION_OUTPUT_TOOL.function.parameters);
it("native schema rejects mixed reply text on an execution request, just like the host parser", () => {
  expect(
    validate({
      kind: "execution_request",
      text: "现在执行",
      request: { lifecycle: "long_task", goal: "报告", acceptance: ["可核对"] },
    }),
  ).toBe(false);
});
it.each([{ kind: "reply" }, { kind: "execution_request" }, { kind: "task_control", text: "停了" }])(
  "native schema requires the fields of the chosen decision branch: %j",
  (value) => {
    expect(validate(value)).toBe(false);
  },
);
it.each([
  { kind: "reply", text: "你好" },
  {
    kind: "execution_request",
    request: { lifecycle: "long_task", goal: "报告", acceptance: ["核验"] },
  },
  { kind: "task_control", target: { taskId: "t", revision: "1" }, action: "cancel" },
])("native schema allows valid branch %j", (value) => expect(validate(value)).toBe(true));
