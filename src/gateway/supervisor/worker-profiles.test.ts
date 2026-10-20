import { describe, expect, it } from "vitest";
import { resolveWorkerExecutionProfile } from "./worker-profiles.js";

describe("resolveWorkerExecutionProfile", () => {
  it("maps cursor/devin/grok to local_ide_login + node_agent", () => {
    expect(resolveWorkerExecutionProfile("cursor-cli")).toEqual({
      credentialPolicy: "local_ide_login",
      executionPlacement: "node_agent",
    });
    expect(resolveWorkerExecutionProfile("devin-cli")).toEqual({
      credentialPolicy: "local_ide_login",
      executionPlacement: "node_agent",
    });
    expect(resolveWorkerExecutionProfile("grok-cli")).toEqual({
      credentialPolicy: "local_ide_login",
      executionPlacement: "node_agent",
    });
  });

  it("maps codex to enterprise_shared + gateway", () => {
    expect(resolveWorkerExecutionProfile("codex-cli")).toEqual({
      credentialPolicy: "enterprise_shared",
      executionPlacement: "gateway",
    });
  });

  it("maps kiro-cli to local_ide_login + node_agent", () => {
    expect(resolveWorkerExecutionProfile("kiro-cli")).toEqual({
      credentialPolicy: "local_ide_login",
      executionPlacement: "node_agent",
    });
  });

  it("maps trae-cli to local_ide_login + node_agent", () => {
    expect(resolveWorkerExecutionProfile("trae-cli")).toEqual({
      credentialPolicy: "local_ide_login",
      executionPlacement: "node_agent",
    });
  });
});
