import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it, expect } from "vitest";
import type { OpenBotConfig } from "../config/config.js";
import type { GatewayClient } from "../gateway/server-methods/types.js";
import { createMetricCompareGatewayHelper } from "./metric-compare-gateway.js";
const roots: string[] = [];
const at = Date.parse("2026-11-06T00:00:00Z");
afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "compare-gateway-"));
  roots.push(root);
  const cfg: OpenBotConfig = { agents: { list: [{ id: "bot", agentDir: root }] } };
  fs.mkdirSync(path.join(root, "task-outcomes/tips"), { recursive: true });
  fs.mkdirSync(path.join(root, "task-outcomes/versions"));
  for (const [taskId, time] of [
    ["a", at],
    ["b", at + 10],
  ] as const) {
    const row = {
      taskId,
      outcomeVersion: 1,
      scope: {
        kind: "enterprise",
        enterpriseDomainId: "domain",
        tenantId: "tenant",
        subjectRef: "subject:alice",
        authzScopeRef: "auth",
      },
      taskJudgement: "success",
      lifecycle: "closed",
      decidedAt: new Date(time).toISOString(),
      acceptance: { status: "passed" },
      delivery: { status: "delivery_unknown" },
      runs: [],
      attempts: [],
    };
    for (const location of ["tips/" + taskId + ".json", "versions/" + taskId + "__v1.json"]) {
      fs.writeFileSync(path.join(root, "task-outcomes", location), JSON.stringify(row));
    }
  }
  const request = {
    baseline: {
      refs: [{ agentId: "bot", taskId: "a", outcomeVersion: 1 }],
      window: { from: at, to: at + 10 },
    },
    candidate: {
      refs: [{ agentId: "bot", taskId: "b", outcomeVersion: 1 }],
      window: { from: at + 10, to: at + 20 },
    },
  };
  const client = {
    platformUserId: "alice",
    sessionDomain: "enterprise",
    connect: { scopes: ["operator.read"] },
  } as GatewayClient;
  const helper = createMetricCompareGatewayHelper({
    cfg,
    now: () => at + 20,
    authDeps: { resolveMembership: async () => ({ tenantId: "tenant", userId: "alice" }) },
  });
  return { cfg, request, client, helper };
}
describe("optional metric comparison gateway helper", () => {
  it("authenticates actual sample reads and never returns promotion permission", async () => {
    const { helper, client, request } = fixture();
    const r = await helper(client, request);
    expect(r.ok).toBe(true);
    if (!r.ok) {
      throw new Error("failed");
    }
    expect(r.comparison.status).toBe("blocked");
    expect(r.comparison.promotionAllowed).toBe(false);
    expect(r.comparison.reasons).toContain("provenance_gate");
  });
  it("rejects client aggregates and forged cohorts", async () => {
    const { helper, client, request } = fixture();
    expect(await helper(client, { ...request, numerator: 100 })).toEqual({
      ok: false,
      code: "invalid_request",
    });
    expect(
      await helper(client, { ...request, baseline: { ...request.baseline, cohortRef: "forged" } }),
    ).toEqual({ ok: false, code: "invalid_request" });
    expect(
      await helper(client, {
        ...request,
        candidate: {
          ...request.candidate,
          refs: [{ ...request.candidate.refs[0], agentId: "other" }],
        },
      }),
    ).toEqual({ ok: false, code: "agent_cohort_mismatch" });
  });
  it("does not shrink the denominator when requested evidence is missing", async () => {
    const { helper, client, request } = fixture();
    expect(
      await helper(client, {
        ...request,
        candidate: {
          ...request.candidate,
          refs: [{ ...request.candidate.refs[0], taskId: "missing" }],
        },
      }),
    ).toEqual({ ok: false, code: "evidence_unavailable" });
  });
  it("rejects missing read scopes and revoked membership", async () => {
    const { helper, client, request, cfg } = fixture();
    client.connect.scopes = ["operator.write"];
    expect(await helper(client, request)).toEqual({ ok: false, code: "unauthorized" });
    client.connect.scopes = ["operator.read"];
    let calls = 0;
    const revoked = createMetricCompareGatewayHelper({
      cfg,
      now: () => at + 20,
      authDeps: {
        resolveMembership: async () => {
          if (++calls > 1) {
            throw new Error("revoked");
          }
          return { tenantId: "tenant", userId: "alice" };
        },
      },
    });
    expect(await revoked(client, request)).toEqual({ ok: false, code: "unauthorized" });
  });
});
