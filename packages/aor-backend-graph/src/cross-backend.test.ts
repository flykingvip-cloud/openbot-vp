import {
  Orchestrator,
  RuleBasedTaskParser,
  createBuiltinCapabilityRegistry,
  createBuiltinEvaluators,
  createBuiltinTaskTypeRegistry,
  defaultModelCatalog,
} from "@openbot/aor-core";
import { describe, expect, it } from "vitest";
import { createGraphExecutionBackend } from "./graph-backend.js";

describe("cross-backend graph orchestration", () => {
  it("routes coding.review through graph nodes to formatted output", async () => {
    const backend = createGraphExecutionBackend();
    const taskTypes = createBuiltinTaskTypeRegistry();
    const orchestrator = new Orchestrator({
      parser: new RuleBasedTaskParser(taskTypes, "coding.review"),
      taskTypes,
      capabilities: createBuiltinCapabilityRegistry(),
      backend,
      modelCatalog: defaultModelCatalog(),
      evaluators: createBuiltinEvaluators(),
      defaultStrategy: "best_quality",
    });

    const result = await orchestrator.run({
      goal: "review this module",
      type: "coding.review",
    });

    expect(result.taskType).toBe("coding.review");
    expect(result.output.text).toContain("finding:");
    expect(result.runId.length).toBeGreaterThan(0);
  });
});
