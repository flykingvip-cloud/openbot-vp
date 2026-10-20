import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DIAGNOSIS_DAIBAI_DELIVERY_ENABLED } from "../../diagnosis/production-cutover.js";
import { createDiagnoseTool } from "./diagnose-tool.js";

const toolSource = readFileSync(
  fileURLToPath(new URL("./diagnose-tool.ts", import.meta.url)),
  "utf8",
);

describe("diagnose conversation tool", () => {
  it("does not open the production gate or call ask/execute", () => {
    expect(DIAGNOSIS_DAIBAI_DELIVERY_ENABLED).toBe(true);
    expect(toolSource).not.toContain("user.daibai.ask");
    expect(toolSource).not.toContain("user.daibai.execute");
    expect(toolSource).not.toContain("chat.send");
  });

  it("returns the report in-session for an admin steward", async () => {
    const tool = createDiagnoseTool({
      agentSessionKey: "agent:main:main",
      senderIsOwner: true,
      tenantId: "tenant-tool-a",
      gatewayClientSessionDomain: "enterprise",
    });
    const result = await tool.execute("t1", {
      agentId: "missing-bot",
      sessionKey: "agent:missing-bot:main",
      window: "7d",
      mode: "FULL",
    });
    const text = result.content.map((part) => ("text" in part ? part.text : "")).join("\n");
    expect(text).toContain("【诊断报告】");
    expect(text).toContain("窗口：7d");
    expect(text).toContain("模式：FULL");
    expect(JSON.stringify(result)).not.toContain("evidenceId");
  });

  it("diagnoses another digital human from agentId alone", async () => {
    const tool = createDiagnoseTool({
      agentSessionKey: "agent:main:main",
      senderIsOwner: true,
      tenantId: "tenant-tool-a",
      gatewayClientSessionDomain: "enterprise",
    });
    const result = await tool.execute("t1b", { agentId: "bot-2" });
    const text = result.content.map((part) => ("text" in part ? part.text : "")).join("\n");
    expect(text).toContain("【诊断报告】");
    expect(text).toContain("对象：bot-2");
  });

  it("refuses scope=all for a user steward", async () => {
    const tool = createDiagnoseTool({
      agentSessionKey: "agent:main:employee:alice",
      senderIsOwner: false,
      gatewayClientSessionDomain: "employee",
    });
    const result = await tool.execute("t2", { scope: "all" });
    const details = result.details as { ok?: boolean; reason?: string };
    expect(details.ok).toBe(false);
    expect(details.reason).toBe("scope_all_forbidden");
  });

  it("wires group expand deps and keeps delivery gate closed", () => {
    expect(toolSource).toContain("createDiagnoseGroupExpandDeps");
    expect(toolSource).toContain("loadGroupMembers: expandDeps.loadGroupMembers");
    expect(toolSource).toContain("allowConversationDelivery: false");
    expect(toolSource).not.toContain("allowSelfEvolutionConfirm: true");
  });

  it("returns a user-visible artifact and does not call cron.add", () => {
    const tool = createDiagnoseTool();
    expect(tool.description).toContain("userVisibleArtifact");
    expect(tool.description).toContain("diagnosis_professional_report");
    expect(toolSource).not.toContain("cron.add");
    expect(toolSource).not.toContain("persistSchedule");
  });
});
