/**
 * Protocol contract: AgentsListResult accepts runtimeStatus / controlPlaneId / runtimeId.
 */
import { Type } from "@sinclair/typebox";
import { TypeCompiler } from "@sinclair/typebox/compiler";
import { describe, expect, it } from "vitest";
import { AgentsListResultSchema, AgentSummarySchema } from "./schema/agents-models-skills.js";

const validateAgentsList = TypeCompiler.Compile(AgentsListResultSchema);
const validateSummary = TypeCompiler.Compile(AgentSummarySchema);

describe("AgentsListResultSchema runtimeStatus contract", () => {
  it("accepts agent rows with runtimeStatus ready|provisioning|unavailable", () => {
    for (const runtimeStatus of ["ready", "provisioning", "unavailable"] as const) {
      expect(
        validateSummary.Check({
          id: "main",
          name: "大白管家",
          runtimeStatus,
        }),
      ).toBe(true);
    }
  });

  it("rejects invalid runtimeStatus values", () => {
    expect(
      validateSummary.Check({
        id: "main",
        runtimeStatus: "online",
      }),
    ).toBe(false);
  });

  it("accepts full agents.list result with controlPlaneId and runtimeId", () => {
    const payload = {
      defaultId: "main",
      mainKey: "main",
      scope: "per-sender" as const,
      controlPlaneId: "remote:shared-selfhost",
      runtimeId: "gw-a",
      agents: [
        { id: "main", name: "大白管家", runtimeStatus: "ready" as const },
        { id: "panda", name: "熊猫学习", runtimeStatus: "unavailable" as const },
      ],
    };
    expect(validateAgentsList.Check(payload)).toBe(true);
  });

  it("still accepts legacy agents without runtimeStatus (optional field)", () => {
    expect(
      validateAgentsList.Check({
        defaultId: "main",
        mainKey: "main",
        scope: "global",
        agents: [{ id: "main" }],
      }),
    ).toBe(true);
  });
});

// Keep Type import used if tree-shaken tooling complains
void Type;
