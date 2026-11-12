import { expect, it } from "vitest";
import { resolveSubagentToolPolicy } from "../pi-tools.policy.js";
import { isToolAllowed, resolveSandboxToolPolicyForAgent } from "./tool-policy.js";

it("retains the owner-checked individual conversation tool in the default sandbox", () => {
  expect(isToolAllowed(resolveSandboxToolPolicyForAgent(), "conversation_send")).toBe(true);
});
it("respects explicit operator restrictions instead of auto-granting messaging", () => {
  expect(
    isToolAllowed(
      resolveSandboxToolPolicyForAgent({ tools: { sandbox: { tools: { allow: ["read"] } } } }),
      "conversation_send",
    ),
  ).toBe(false);
  expect(
    isToolAllowed(
      resolveSandboxToolPolicyForAgent({
        tools: { sandbox: { tools: { deny: ["conversation_send"] } } },
      }),
      "conversation_send",
    ),
  ).toBe(false);
});
it("does not open a new direct messaging exit for spawned subagents", () => {
  expect(isToolAllowed(resolveSubagentToolPolicy(), "conversation_send")).toBe(false);
});
