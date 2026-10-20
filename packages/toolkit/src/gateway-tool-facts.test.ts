import { describe, expect, it } from "vitest";
import { inferPolicyFactsFromGatewayTool } from "./gateway-tool-facts.js";

describe("inferPolicyFactsFromGatewayTool", () => {
  it("maps exec to high-risk shell", () => {
    const facts = inferPolicyFactsFromGatewayTool({ toolName: "exec" });
    expect(facts).toMatchObject({
      toolId: "shell",
      operation: "exec",
      risk: "high",
      sideEffects: true,
    });
  });

  it("maps web_search to low-risk web", () => {
    const facts = inferPolicyFactsFromGatewayTool({ toolName: "web_search" });
    expect(facts).toMatchObject({
      toolId: "web",
      risk: "low",
      sideEffects: false,
    });
  });

  it("maps write to workspace write within workspace", () => {
    const facts = inferPolicyFactsFromGatewayTool({ toolName: "write" });
    expect(facts).toMatchObject({
      toolId: "workspace",
      operation: "write",
      sideEffects: true,
      withinWorkspace: true,
    });
  });
});
