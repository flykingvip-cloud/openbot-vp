import {
  Orchestrator,
  RuleBasedTaskParser,
  createBuiltinCapabilityRegistry,
  createBuiltinEvaluators,
  createBuiltinTaskTypeRegistry,
  defaultModelCatalog,
} from "@openbot/aor-core";
import { describe, expect, it } from "vitest";
import { StubExecutionBackend } from "./stub-backend.js";

describe("cross-backend orchestration", () => {
  it("routes coding.review to best-quality model with stub backend", async () => {
    const stub = new StubExecutionBackend(() => "- finding: example\n- suggest: add tests");
    const taskTypes = createBuiltinTaskTypeRegistry();
    const orchestrator = new Orchestrator({
      parser: new RuleBasedTaskParser(taskTypes, "coding.review"),
      taskTypes,
      capabilities: createBuiltinCapabilityRegistry(),
      backend: stub,
      modelCatalog: defaultModelCatalog(),
      evaluators: createBuiltinEvaluators(),
      defaultStrategy: "best_quality",
    });

    const result = await orchestrator.run({
      goal: "review this module",
      type: "coding.review",
    });

    expect(result.taskType).toBe("coding.review");
    expect(result.selection.model.id).toBe("claude-opus-4-6");
    expect(result.runId.length).toBeGreaterThan(0);
    expect(result.output.text).toContain("finding");
  });
});
