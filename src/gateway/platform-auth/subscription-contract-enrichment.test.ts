import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createSubscription,
  setSubscriptionCommercialContract,
  __resetSubscriptionsForTest,
} from "../billing/subscriptions-store.js";
import { attachActiveSubscriptionContracts } from "./subscription-contract-enrichment.js";

describe("attachActiveSubscriptionContracts", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await __resetSubscriptionsForTest();
    await Promise.all(
      tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })),
    );
  });

  async function tempStorePath() {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-contract-enrich-"));
    tempDirs.push(dir);
    return path.join(dir, "subscriptions.json");
  }

  it("attaches contractEnd from active subscription without changing status fields", async () => {
    const storePath = await tempStorePath();
    const sub = await createSubscription(
      {
        enterpriseId: "001",
        planId: "plan-flagship",
        planVersionId: "pv-1",
      },
      storePath,
    );
    await setSubscriptionCommercialContract(
      "001",
      sub.id,
      {
        billingCycle: "monthly",
        contractStart: "2026-06-22T05:33:21.511Z",
        contractEnd: "2026-07-22T05:33:21.511Z",
      },
      storePath,
    );

    const enriched = await attachActiveSubscriptionContracts(
      [
        {
          id: "001",
          name: "upbeyond",
          status: "paid",
          plan: "旗舰版",
          billingStatus: "active",
          createdSource: "platform-created",
          seatQuota: 5,
          seatUsed: 3,
          seatsRemaining: 2,
        },
      ],
      storePath,
    );

    expect(enriched[0]?.status).toBe("paid");
    expect(enriched[0]?.billingStatus).toBe("active");
    expect(enriched[0]?.contractStart).toBe("2026-06-22T05:33:21.511Z");
    expect(enriched[0]?.contractEnd).toBe("2026-07-22T05:33:21.511Z");
  });

  it("leaves enterprises without active contract untouched", async () => {
    const storePath = await tempStorePath();
    const enriched = await attachActiveSubscriptionContracts(
      [
        {
          id: "002",
          name: "trial-co",
          status: "trial",
          plan: "trial",
          billingStatus: "trialing",
          createdSource: "self-service",
          seatQuota: 3,
          seatUsed: 1,
          seatsRemaining: 2,
          trialEndsAt: "2026-08-01T00:00:00.000Z",
        },
      ],
      storePath,
    );
    expect(enriched[0]?.contractEnd).toBeUndefined();
    expect(enriched[0]?.trialEndsAt).toBe("2026-08-01T00:00:00.000Z");
  });
});
