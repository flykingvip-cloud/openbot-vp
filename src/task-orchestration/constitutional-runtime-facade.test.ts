import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CONSTITUTIONAL_SHADOW_ENV,
  sampleSourceSnapshot,
} from "../../packages/constitutional-contracts/src/index.js";
import { observeOrchestrationRuntimeFacade } from "./constitutional-runtime-facade.js";
import { considerDispatch } from "./dispatch.js";
import { emptyOrchestrationFlags } from "./types.js";
import { ORCHESTRATION_LIVE_INVOKE } from "./types.js";

describe("orchestration runtime façade call site", () => {
  it("is not imported by dispatch or the chat choke-point", () => {
    const dispatch = readFileSync(new URL("./dispatch.ts", import.meta.url), "utf8");
    const hook = readFileSync(new URL("./gateway-hook.ts", import.meta.url), "utf8");
    expect(dispatch).not.toContain("constitutional-runtime-facade");
    expect(dispatch).not.toContain("constitutional-contracts");
    expect(hook).not.toContain("constitutional-runtime-facade");
    expect(hook).not.toContain("constitutional-contracts");
    expect(dispatch).not.toContain("process.env.OPENBOT_CONSTITUTIONAL_SHADOW");
  });

  it("leaves considerDispatch unchanged and stays inert unless opted in", () => {
    const previous = process.env[CONSTITUTIONAL_SHADOW_ENV];
    process.env[CONSTITUTIONAL_SHADOW_ENV] = "true";
    try {
      const dispatchResult = considerDispatch({
        intent: "read_web",
        flags: emptyOrchestrationFlags(),
        ctrActivationEnabled: false,
      });
      expect(dispatchResult.invokedTool).toBe(false);
      expect(dispatchResult.wroteLedger).toBe(false);
      expect(dispatchResult.decision.invoke).toBe(false);
      expect("constitutionalShadow" in dispatchResult).toBe(false);

      const inert = observeOrchestrationRuntimeFacade({
        sources: sampleSourceSnapshot,
        enforce: true,
        candidatePath: "web_read",
      });
      expect(ORCHESTRATION_LIVE_INVOKE).toBe(false);
      expect(inert.invoked).toBe(false);
      expect(inert.report).toBeNull();
      expect(inert.surface).toBe("task-orchestration");
      expect(inert.orchestrationLiveInvoke).toBe(false);
      expect(inert.dispatchInvoked).toBe(false);
      expect(inert.enqueued).toBe(false);
      expect(inert.selectedPath).toBeNull();
      expect(inert.enforce).toBe(false);
      expect(inert.liveInvoke).toBe(false);
      expect(inert.fabricDefaultOn).toBe(false);
    } finally {
      if (previous === undefined) {
        delete process.env[CONSTITUTIONAL_SHADOW_ENV];
      } else {
        process.env[CONSTITUTIONAL_SHADOW_ENV] = previous;
      }
    }
  });

  it("opts in to a shadow report without selecting a path or dispatching", () => {
    const result = observeOrchestrationRuntimeFacade({
      sources: sampleSourceSnapshot,
      env: { [CONSTITUTIONAL_SHADOW_ENV]: "on" },
      enforce: true,
      workflowRef: "lobster",
    });
    expect(result.invoked).toBe(true);
    expect(result.mode).toBe("shadow");
    expect(result.report?.enforce).toBe(false);
    expect(result.report?.enforced).toBe(false);
    expect(result.report?.findings.map((item) => item.code)).toEqual(["enforce_requested_ignored"]);
    expect(result.selectedPath).toBeNull();
    expect(result.candidatePathDiscarded).toBe(true);
    expect(result.legalPathSelectable).toBe(false);
    expect(result.shadowCompared).toBe(false);
    expect(result.executed).toBe(false);
    expect(result.blocked).toBe(false);
    expect(result.wroteLedger).toBe(false);
    expect(result.dispatchInvoked).toBe(false);
    expect(result.orchestrationLiveInvoke).toBe(false);
    expect(result.fabricDefaultOn).toBe(false);
  });
});
