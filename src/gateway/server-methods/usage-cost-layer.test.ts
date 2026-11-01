import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { UsageCostLayerView } from "../../shared/usage-cost-layer.js";
import { upsertCreditUsageStage } from "../billing/credit-usage-stage-store.js";
import { responseHasCommercialCost } from "../billing/usage-cost-layer.js";
import { appendUsageLedgerEntry } from "../billing/usage-ledger-store.js";
import { usageCostLayerHandlers } from "./usage-cost-layer.js";

async function invoke(client: Record<string, unknown> | null, params: Record<string, unknown>) {
  const respond = vi.fn();
  await usageCostLayerHandlers["usage.cost.layer"]({
    respond,
    params,
    client,
    context: {},
  } as unknown as Parameters<(typeof usageCostLayerHandlers)["usage.cost.layer"]>[0]);
  const [ok, payload, error] = respond.mock.calls[0] ?? [];
  return { ok: ok as boolean, payload: payload as UsageCostLayerView | undefined, error };
}

describe("usage.cost.layer handler", () => {
  let dir: string | undefined;
  const previousLedger = process.env.OPENBOT_USAGE_LEDGER_PATH;
  const previousStage = process.env.OPENBOT_CREDIT_USAGE_STAGE_PATH;

  afterEach(async () => {
    if (previousLedger === undefined) {
      delete process.env.OPENBOT_USAGE_LEDGER_PATH;
    } else {
      process.env.OPENBOT_USAGE_LEDGER_PATH = previousLedger;
    }
    if (previousStage === undefined) {
      delete process.env.OPENBOT_CREDIT_USAGE_STAGE_PATH;
    } else {
      process.env.OPENBOT_CREDIT_USAGE_STAGE_PATH = previousStage;
    }
    if (dir) {
      await fs.rm(dir, { recursive: true, force: true });
      dir = undefined;
    }
  });

  it("reads the ledger through the handler and hides procurement cost from the user", async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "usage-cost-layer-"));
    const ledgerPath = path.join(dir, "ledger.json");
    const stagePath = path.join(dir, "stages.json");
    process.env.OPENBOT_USAGE_LEDGER_PATH = ledgerPath;
    process.env.OPENBOT_CREDIT_USAGE_STAGE_PATH = stagePath;
    await appendUsageLedgerEntry(
      {
        enterpriseId: "ent-a",
        taskId: "task-mine",
        userId: "user-a",
        modelId: "openai/gpt-test",
        tier: "standard",
        policyId: "included",
        creditsCharged: 9,
        providerCostCents: 80,
        tenantRevenueCents: 120,
        inputTokens: 30,
        outputTokens: 8,
      },
      ledgerPath,
    );
    await appendUsageLedgerEntry(
      {
        enterpriseId: "ent-b",
        taskId: "task-foreign",
        userId: "user-a",
        modelId: "secret/other-enterprise",
        tier: "standard",
        policyId: "included",
        creditsCharged: 4,
        providerCostCents: 15,
        tenantRevenueCents: 20,
        inputTokens: 3,
        outputTokens: 1,
      },
      ledgerPath,
    );
    await upsertCreditUsageStage(
      { enterpriseId: "ent-a", taskId: "task-mine", stage: "done", creditsCharged: 9 },
      stagePath,
    );

    const userResult = await invoke(
      {
        sessionDomain: "employee",
        platformUserId: "user-a",
        sessionEnterpriseId: "ent-a",
      },
      { surface: "user", taskId: "task-mine" },
    );
    expect(userResult.ok).toBe(true);
    expect(userResult.payload?.input.known).toBe(30);
    expect(userResult.payload?.charges.some((line) => line.label.includes("已扣 9 Credits"))).toBe(
      true,
    );
    expect(responseHasCommercialCost(userResult.payload)).toBe(false);
    expect(JSON.stringify(userResult.payload)).not.toContain("secret/other-enterprise");

    const foreign = await invoke(
      {
        sessionDomain: "employee",
        platformUserId: "user-a",
        sessionEnterpriseId: "ent-a",
      },
      { surface: "user", taskId: "task-foreign" },
    );
    expect(foreign.ok).toBe(true);
    expect(foreign.payload?.empty).toBe(true);
    expect(JSON.stringify(foreign.payload)).not.toContain("secret/other-enterprise");

    const platformResult = await invoke(
      {
        sessionDomain: "platform",
        sessionKind: "platform-admin",
        platformUserId: "ops",
        connect: { scopes: ["operator.platform"] },
      },
      { surface: "platform", taskId: "task-mine" },
    );
    expect(platformResult.ok).toBe(true);
    expect(platformResult.payload?.procurementCents).toBe(80);
    expect(platformResult.payload?.commercialMarginCents).toBe(40);
    expect(platformResult.payload?.reconciliation.aligned).toBe(true);

    const escalated = await invoke(
      {
        sessionDomain: "employee",
        platformUserId: "user-a",
        sessionEnterpriseId: "ent-a",
      },
      { surface: "platform", taskId: "task-mine" },
    );
    expect(escalated.ok).toBe(false);
    expect(JSON.stringify(escalated)).not.toContain("procurementCents");
  });
});
