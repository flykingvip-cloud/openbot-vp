import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { listEnterpriseModelAuditEvents, recordEnterpriseModelAuditEvent } from "./audit.js";

describe("enterprise-model audit", () => {
  it("records runtime.invoked / runtime.budget_blocked without secret fields", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "em-audit-"));
    const storePath = path.join(dir, "openbot-enterprise-model-audit.json");

    await recordEnterpriseModelAuditEvent(
      {
        tenantId: "001",
        action: "runtime.invoked",
        targetType: "asset",
        targetId: "asset-1",
        result: "success",
        details: {
          runtimeModelId: "ent/abc/deepseek",
          apiKey: "sk-should-never-persist",
          connectionId: "conn-1",
        },
      },
      storePath,
    );
    await recordEnterpriseModelAuditEvent(
      {
        tenantId: "001",
        action: "runtime.budget_blocked",
        targetType: "asset",
        targetId: "asset-1",
        result: "failure",
        code: "ENTERPRISE_MODEL_FORBIDDEN",
        details: { monthlySpendCapCents: 0, spendCentsInCycle: 0 },
      },
      storePath,
    );

    const events = await listEnterpriseModelAuditEvents("001", storePath);
    expect(events.map((e) => e.action)).toEqual(["runtime.invoked", "runtime.budget_blocked"]);
    expect(events[0]?.details?.apiKey).toBe("[redacted]");
    expect(events[0]?.details?.runtimeModelId).toBe("ent/abc/deepseek");

    const raw = await readFile(storePath, "utf8");
    expect(raw).not.toMatch(/sk-should-never-persist/);
  });
});
