// @vitest-environment node
/**
 * WP-B slice 3: observe credit reservation status through the chat admitted-turn
 * execution lifecycle (real acquire/release), using only an isolated state dir.
 */
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createExecutionLifecycle } from "../../agent-runtime/execution/runner/execution-lifecycle.js";
import { bindAdmittedTurnHost } from "../../agent-runtime/wiring/admitted-turn-host.js";
import { DEFAULT_OVERAGE_POLICY } from "../package-entitlement/normalize-entitlement.js";
import { upsertCreditWeight } from "../resource-catalog/credit-weights-store.js";
import { upsertResourceModelCatalogEntry } from "../resource-catalog/models-catalog-store.js";
import { listUsageLedgerEntriesByTaskId } from "./usage-ledger-store.js";

vi.mock("../platform-auth/resolve-tenant-lifecycle-access.js", () => ({
  resolveTenantLifecycleAccess: vi.fn(async () => ({ blocked: false })),
}));

const stateDir = process.env.OPENBOT_STATE_DIR?.trim() ?? "";
if (!stateDir || !stateDir.includes("wpb-slice3-state-")) {
  throw new Error(
    "Refusing to run chat-reply reservation tests without isolated OPENBOT_STATE_DIR (wpb-slice3-state-*).",
  );
}

const { CONFIG_DIR } = await import("../../utils.js");
if (path.resolve(CONFIG_DIR) !== path.resolve(stateDir)) {
  throw new Error(`CONFIG_DIR ${CONFIG_DIR} does not match isolated OPENBOT_STATE_DIR ${stateDir}`);
}

const { __resetAgentRunRegistryForTest } = await import("./agent-run-registry.js");
const { __resetSubscriptionRuntimeSnapshotsForTest } =
  await import("./subscription-runtime-snapshots-store.js");
const { __resetSubscriptionsForTest } = await import("./subscriptions-store.js");
const { createPlan } = await import("./plans-store.js");
const { createSubscription } = await import("./subscriptions-store.js");
const { upsertPlanEntitlementSnapshot } =
  await import("../package-entitlement/plan-version-entitlement-store.js");
const { ensureTenantCreditsAllocation } = await import("./tenant-credits-store.js");
const { materializeSubscriptionRuntimeSnapshot } =
  await import("./subscription-transition-engine.js");
const { getCreditReservation, settleCreditReservation, sumHeldReservationsForEnterprise } =
  await import("./credit-reservation-store.js");
const { recordCreditUsage, resolveTenantCreditsStatus } = await import("./record-credit-usage.js");
const { buildCommercialRunCreditUsageInput } =
  await import("../../auto-reply/reply/agent-run-credit-usage.js");

const ENTERPRISE_ID = "ent-slice3";
const BILLABLE_PROVIDER = "openai";
const BILLABLE_MODEL = "gpt-4o";
const BILLABLE_MODEL_ID = `${BILLABLE_PROVIDER}/${BILLABLE_MODEL}`;
const BILLABLE_POLICY = "balanced";
const BILLABLE_CREDIT_COST = 5;
const NONZERO_USAGE = { input: 800, output: 200 };

async function seedLimitedCredits(opts?: {
  monthlyCredits?: number;
  maxConcurrentRuns?: number;
  billableCatalog?: boolean;
}) {
  const monthlyCredits = opts?.monthlyCredits ?? 1;
  const maxConcurrentRuns = opts?.maxConcurrentRuns ?? 2;
  const plan = await createPlan({
    name: "Slice3 Plan",
    billingCycle: "monthly",
    basePriceCents: 1000,
    seatQuota: {},
    botQuota: 5,
    pricing: [{ type: "usage", key: "ai_credits", priceCents: 1 }],
    createdByUserId: "slice3-tester",
  });
  await upsertPlanEntitlementSnapshot({
    planVersionId: plan.currentVersionId,
    monthlyPriceCents: 1000,
    monthlyCredits,
    maxBots: 5,
    maxConcurrentRuns,
    allowedPolicies: [BILLABLE_POLICY],
    allowedTiers: ["tier_b"],
    overagePolicy: { ...DEFAULT_OVERAGE_POLICY, type: "block" },
  });
  const sub = await createSubscription({
    enterpriseId: ENTERPRISE_ID,
    planId: plan.id,
    planVersionId: plan.currentVersionId,
  });
  await materializeSubscriptionRuntimeSnapshot({
    enterpriseId: ENTERPRISE_ID,
    subscription: sub,
  });
  const { cycleStart } = (await import("./runtime.js")).resolveCycleWindow();
  await ensureTenantCreditsAllocation({
    enterpriseId: ENTERPRISE_ID,
    cycleStart,
    monthlyCredits,
  });
  if (opts?.billableCatalog) {
    await upsertResourceModelCatalogEntry({
      modelId: BILLABLE_MODEL_ID,
      tier: "tier_b",
      displayName: "GPT-4o",
    });
    await upsertCreditWeight({ tier: "tier_b", creditCost: BILLABLE_CREDIT_COST });
  }
  return { plan, sub };
}

function reservationPath() {
  return path.join(stateDir, "openbot-credit-reservations.json");
}

function isolatedStateFiles() {
  return [
    "openbot-credit-reservations.json",
    "openbot-billing-plans.json",
    "openbot-plan-entitlement-snapshot.json",
    "openbot-plan-model-binding.json",
    "openbot-tenant-credits.json",
    "openbot-resource-model-catalog.json",
    "openbot-resource-credit-weights.json",
    "openbot-usage-ledger.json",
    "openbot-billing-usage.json",
    "openbot-credit-usage-stages.json",
  ];
}

function createChatLifecycle(runId: string) {
  const host = bindAdmittedTurnHost();
  host.model.forgetRunModelSet = vi.fn(host.model.forgetRunModelSet);
  host.model.buildRunModelSetSnapshot = vi.fn(() => undefined);
  host.model.runWithModelFallback = vi.fn(async (input) => ({
    result: await input.run("test", "model"),
    provider: BILLABLE_PROVIDER,
    model: BILLABLE_MODEL,
    attempts: [],
  }));
  return { host, lifecycle: createExecutionLifecycle(runId, host) };
}

function inferenceRequest(run: () => Promise<unknown>, signal?: AbortSignal) {
  return {
    cfg: {} as never,
    provider: BILLABLE_PROVIDER,
    model: BILLABLE_MODEL,
    taskText: "task",
    ...(signal ? { signal } : {}),
    run,
  };
}

async function recordSuccessPathUsage(
  lifecycle: ReturnType<typeof createChatLifecycle>["lifecycle"],
  runId: string,
) {
  const viaLifecycle = await lifecycle.recordUsage({
    provider: BILLABLE_PROVIDER,
    model: BILLABLE_MODEL,
    usage: NONZERO_USAGE,
    toolCallCount: 0,
    toolClasses: [],
    fallbackAttemptsRaw: [],
  });
  if (viaLifecycle) {
    return { usage: viaLifecycle, path: "lifecycle.recordUsage" as const };
  }
  // If the authorized session has no creditReporting, still exercise the same
  // production payload builder used by that path, and report which path ran.
  const usage = await recordCreditUsage(
    buildCommercialRunCreditUsageInput({
      enterpriseId: ENTERPRISE_ID,
      policyId: BILLABLE_POLICY,
      runId,
      provider: BILLABLE_PROVIDER,
      model: BILLABLE_MODEL,
      toolCallCount: 0,
      toolClasses: [],
      fallbackAttemptsRaw: [],
      tokenUsage: NONZERO_USAGE,
    }),
  );
  return { usage, path: "buildCommercialRunCreditUsageInput" as const };
}

describe("chat admitted-turn credit reservation status", () => {
  beforeEach(async () => {
    await __resetAgentRunRegistryForTest(path.join(stateDir, "openbot-agent-run-registry.json"));
    await __resetSubscriptionsForTest(path.join(stateDir, "openbot-billing-subscriptions.json"));
    await __resetSubscriptionRuntimeSnapshotsForTest(
      path.join(stateDir, "openbot-subscription-runtime-snapshots.json"),
    );
    for (const name of isolatedStateFiles()) {
      const file = path.join(stateDir, name);
      if (fs.existsSync(file)) {
        fs.rmSync(file, { force: true });
      }
    }
    await seedLimitedCredits();
  });

  afterEach(() => {
    if (fs.existsSync(reservationPath())) {
      // keep the isolated file for the last test; directory is a unique temp dir
    }
  });

  it("concurrent prepares do not oversell the last credit", async () => {
    const a = createChatLifecycle("run-a");
    const b = createChatLifecycle("run-b");
    const [ra, rb] = await Promise.all([
      a.lifecycle.prepare({ config: {} as never, authorization: { enterpriseId: ENTERPRISE_ID } }),
      b.lifecycle.prepare({ config: {} as never, authorization: { enterpriseId: ENTERPRISE_ID } }),
    ]);
    const outcomes = [ra, rb];
    const ready = outcomes.filter((item) => item.kind === "ready");
    const denied = outcomes.filter((item) => item.kind === "denied");
    expect(ready).toHaveLength(1);
    expect(denied).toHaveLength(1);
    expect(await sumHeldReservationsForEnterprise(ENTERPRISE_ID)).toBe(1);
    await a.lifecycle.dispose();
    await b.lifecycle.dispose();
  });

  it("re-entering the same runId does not increase the held reservation", async () => {
    const first = createChatLifecycle("run-same").lifecycle;
    const prepared = await first.prepare({
      config: {} as never,
      authorization: { enterpriseId: ENTERPRISE_ID },
    });
    expect(prepared.kind).toBe("ready");
    expect((await getCreditReservation("run-same"))?.reservedCredits).toBe(1);
    expect(await sumHeldReservationsForEnterprise(ENTERPRISE_ID)).toBe(1);

    const second = createChatLifecycle("run-same").lifecycle;
    const again = await second.prepare({
      config: {} as never,
      authorization: { enterpriseId: ENTERPRISE_ID },
    });
    // Second acquire may be ready (idempotent hold) or denied (duplicate slot).
    // Either way the held total must stay 1.
    expect(["ready", "denied"]).toContain(again.kind);
    const held = await getCreditReservation("run-same");
    expect(held?.reservedCredits).toBe(1);
    expect(await sumHeldReservationsForEnterprise(ENTERPRISE_ID)).toBe(1);
    await first.dispose();
    await second.dispose();
  });

  it("dispose after a failed inference releases the hold and settle cannot revive it", async () => {
    const { host, lifecycle } = createChatLifecycle("run-fail");
    vi.mocked(host.model.runWithModelFallback).mockRejectedValueOnce(new Error("model failed"));
    expect(
      (
        await lifecycle.prepare({
          config: {} as never,
          authorization: { enterpriseId: ENTERPRISE_ID },
        })
      ).kind,
    ).toBe("ready");
    expect((await getCreditReservation("run-fail"))?.status).toBe("held");
    await expect(
      lifecycle.infer(
        inferenceRequest(async () => {
          throw new Error("should not run");
        }),
      ),
    ).rejects.toThrow(/model failed/);
    await lifecycle.dispose();
    expect((await getCreditReservation("run-fail"))?.status).toBe("released");
    const settled = await settleCreditReservation({ runId: "run-fail", actualCredits: 1 });
    expect(settled?.status).toBe("released");
  });

  it("cancel during admission releases a held reservation", async () => {
    const { host, lifecycle } = createChatLifecycle("run-cancel");
    const controller = new AbortController();
    const originalAcquire = host.admission.tryAcquireEnterpriseAgentRun;
    host.admission.tryAcquireEnterpriseAgentRun = async (input) => {
      const result = await originalAcquire(input);
      controller.abort();
      return result;
    };
    await expect(
      lifecycle.prepare({
        config: {} as never,
        authorization: { enterpriseId: ENTERPRISE_ID },
        signal: controller.signal,
      }),
    ).rejects.toThrow();
    await lifecycle.dispose();
    const reservation = await getCreditReservation("run-cancel");
    expect(reservation?.status).toBe("released");
    expect(await sumHeldReservationsForEnterprise(ENTERPRISE_ID)).toBe(0);
  });

  it("timeout after prepare releases the held reservation", async () => {
    const { lifecycle } = createChatLifecycle("run-timeout");
    expect(
      (
        await lifecycle.prepare({
          config: {} as never,
          authorization: { enterpriseId: ENTERPRISE_ID },
        })
      ).kind,
    ).toBe("ready");
    expect((await getCreditReservation("run-timeout"))?.status).toBe("held");
    const controller = new AbortController();
    controller.abort();
    let inferError: unknown;
    try {
      await Promise.resolve().then(() =>
        lifecycle.infer(inferenceRequest(async () => "ok", controller.signal)),
      );
    } catch (error) {
      inferError = error;
    }
    expect(inferError).toBeTruthy();
    await lifecycle.dispose();
    expect((await getCreditReservation("run-timeout"))?.status).toBe("released");
  });

  it("charges non-zero usage on the success path and records actual balances", async () => {
    for (const name of isolatedStateFiles()) {
      const file = path.join(stateDir, name);
      if (fs.existsSync(file)) {
        fs.rmSync(file, { force: true });
      }
    }
    await __resetSubscriptionsForTest(path.join(stateDir, "openbot-billing-subscriptions.json"));
    await __resetSubscriptionRuntimeSnapshotsForTest(
      path.join(stateDir, "openbot-subscription-runtime-snapshots.json"),
    );
    await __resetAgentRunRegistryForTest(path.join(stateDir, "openbot-agent-run-registry.json"));
    const monthlyCredits = 3;
    await seedLimitedCredits({ monthlyCredits, billableCatalog: true });

    const before = await resolveTenantCreditsStatus(ENTERPRISE_ID);
    expect(before?.monthlyCredits).toBe(monthlyCredits);
    expect(before?.creditsConsumed).toBe(0);
    expect(before?.creditsRemaining).toBe(monthlyCredits);

    const { lifecycle } = createChatLifecycle("run-success");
    expect(
      (
        await lifecycle.prepare({
          config: {} as never,
          authorization: { enterpriseId: ENTERPRISE_ID },
        })
      ).kind,
    ).toBe("ready");
    expect((await getCreditReservation("run-success"))?.status).toBe("held");
    await lifecycle.infer(inferenceRequest(async () => "ok"));
    const recorded = await recordSuccessPathUsage(lifecycle, "run-success");
    console.log(
      "SUCCESS_PATH_USAGE",
      recorded.path,
      recorded.usage.creditsCharged,
      recorded.usage.skippedConsumption,
    );
    expect(recorded.usage.recorded).toBe(true);
    expect(recorded.usage.skippedConsumption).toBe(false);
    expect(recorded.usage.creditsCharged).toBeGreaterThan(0);
    const charged = recorded.usage.creditsCharged;
    expect(recorded.usage.deduped).toBe(false);

    await lifecycle.dispose();
    const reservation = await getCreditReservation("run-success");
    const after = await resolveTenantCreditsStatus(ENTERPRISE_ID);
    const ledger = await listUsageLedgerEntriesByTaskId("run-success", {
      enterpriseId: ENTERPRISE_ID,
    });
    const ledgerCharged = ledger.reduce((sum, row) => sum + (row.creditsCharged ?? 0), 0);
    console.log(
      "SUCCESS_PATH_OBSERVED",
      JSON.stringify({
        usagePath: recorded.path,
        usageRecorded: recorded.usage.recorded,
        usageDeduped: recorded.usage.deduped,
        creditsCharged: recorded.usage.creditsCharged,
        skippedConsumption: recorded.usage.skippedConsumption,
        reservationStatus: reservation?.status ?? null,
        actualCredits: reservation?.actualCredits ?? null,
        creditsConsumed: after?.creditsConsumed ?? null,
        creditsRemaining: after?.creditsRemaining ?? null,
        ledgerCharged,
        ledgerEntries: ledger.length,
      }),
    );
    expect(after?.creditsConsumed).toBe(charged);
    expect(after?.creditsRemaining).toBe(monthlyCredits - charged);
    expect(ledgerCharged).toBe(charged);
    expect(["released", "settled"]).toContain(reservation?.status);
    expect(reservation?.status).not.toBe("held");
  });

  it("duplicate billing of the same event deducts the balance only once", async () => {
    for (const name of isolatedStateFiles()) {
      const file = path.join(stateDir, name);
      if (fs.existsSync(file)) {
        fs.rmSync(file, { force: true });
      }
    }
    await __resetSubscriptionsForTest(path.join(stateDir, "openbot-billing-subscriptions.json"));
    await __resetSubscriptionRuntimeSnapshotsForTest(
      path.join(stateDir, "openbot-subscription-runtime-snapshots.json"),
    );
    await __resetAgentRunRegistryForTest(path.join(stateDir, "openbot-agent-run-registry.json"));
    const monthlyCredits = 3;
    await seedLimitedCredits({ monthlyCredits, billableCatalog: true });

    const { lifecycle } = createChatLifecycle("run-dedup");
    expect(
      (
        await lifecycle.prepare({
          config: {} as never,
          authorization: { enterpriseId: ENTERPRISE_ID },
        })
      ).kind,
    ).toBe("ready");
    await lifecycle.infer(inferenceRequest(async () => "ok"));
    const first = await recordSuccessPathUsage(lifecycle, "run-dedup");
    console.log(
      "DEDUP_FIRST_USAGE",
      first.path,
      first.usage.creditsCharged,
      first.usage.skippedConsumption,
    );
    expect(first.usage.creditsCharged).toBeGreaterThan(0);
    expect(first.usage.skippedConsumption).toBe(false);
    const charged = first.usage.creditsCharged;

    const secondViaLifecycle = await lifecycle.recordUsage({
      provider: BILLABLE_PROVIDER,
      model: BILLABLE_MODEL,
      usage: { input: 8000, output: 2000 },
      toolCallCount: 0,
      toolClasses: [],
      fallbackAttemptsRaw: [],
    });
    const second =
      secondViaLifecycle ??
      (await recordCreditUsage(
        buildCommercialRunCreditUsageInput({
          enterpriseId: ENTERPRISE_ID,
          policyId: BILLABLE_POLICY,
          runId: "run-dedup",
          provider: BILLABLE_PROVIDER,
          model: BILLABLE_MODEL,
          toolCallCount: 0,
          toolClasses: [],
          fallbackAttemptsRaw: [],
          tokenUsage: { input: 8000, output: 2000 },
        }),
      ));

    await lifecycle.dispose();
    const after = await resolveTenantCreditsStatus(ENTERPRISE_ID);
    const ledger = await listUsageLedgerEntriesByTaskId("run-dedup", {
      enterpriseId: ENTERPRISE_ID,
    });
    const ledgerCharged = ledger.reduce((sum, row) => sum + (row.creditsCharged ?? 0), 0);
    const reservation = await getCreditReservation("run-dedup");
    console.log(
      "DEDUP_PATH_OBSERVED",
      JSON.stringify({
        firstPath: first.path,
        firstCharged: first.usage.creditsCharged,
        secondDeduped: second.deduped,
        secondCharged: second.creditsCharged,
        creditsConsumed: after?.creditsConsumed ?? null,
        creditsRemaining: after?.creditsRemaining ?? null,
        ledgerCharged,
        ledgerEntries: ledger.length,
        reservationStatus: reservation?.status ?? null,
      }),
    );
    expect(after?.creditsConsumed).toBe(charged);
    expect(after?.creditsRemaining).toBe(monthlyCredits - charged);
    expect(ledgerCharged).toBe(charged);
    expect(monthlyCredits - charged).toBe(0);

    const next = createChatLifecycle("run-after-consumed");
    const prepared = await next.lifecycle.prepare({
      config: {} as never,
      authorization: { enterpriseId: ENTERPRISE_ID },
    });
    expect(prepared.kind).toBe("denied");
    expect(await sumHeldReservationsForEnterprise(ENTERPRISE_ID)).toBe(0);
    await next.lifecycle.dispose();
  });
});
