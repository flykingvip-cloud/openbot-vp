import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it, expect, vi } from "vitest";
import type { OpenBotConfig } from "../config/config.js";
import { createMetricCompareQuery } from "./metric-compare-query.js";
const roots: string[] = [];
const at = Date.parse("2026-11-06T00:00:00Z");
afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "metric-compare-query-"));
  roots.push(root);
  const cfg: OpenBotConfig = { agents: { list: [{ id: "bot", agentDir: root }] } };
  fs.mkdirSync(path.join(root, "task-outcomes/tips"), { recursive: true });
  fs.mkdirSync(path.join(root, "task-outcomes/versions"));
  for (const [taskId, decidedAt] of [
    ["base", at],
    ["candidate", at + 10],
  ] as const) {
    const record = {
      taskId,
      outcomeVersion: 1,
      scope: {
        kind: "enterprise",
        tenantId: "t",
        enterpriseDomainId: "d",
        subjectRef: "subject:alice",
        authzScopeRef: "grant",
      },
      taskJudgement: "success",
      lifecycle: "closed",
      decidedAt: new Date(decidedAt).toISOString(),
      acceptance: { status: "passed" },
      delivery: { status: "delivery_unknown" },
      runs: [],
      attempts: [],
    };
    for (const location of ["tips/" + taskId + ".json", "versions/" + taskId + "__v1.json"]) {
      fs.writeFileSync(path.join(root, "task-outcomes", location), JSON.stringify(record));
    }
  }
  const authorize = vi.fn(async () => ({ subjectRef: "subject:alice", tenantId: "t" }));
  const query = createMetricCompareQuery({ cfg, authorize, now: () => at + 20 });
  const request = {
    baseline: {
      refs: [{ agentId: "bot", taskId: "base", outcomeVersion: 1 }],
      window: { from: at, to: at + 10 },
    },
    candidate: {
      refs: [{ agentId: "bot", taskId: "candidate", outcomeVersion: 1 }],
      window: { from: at + 10, to: at + 20 },
    },
  };
  return { root, cfg, authorize, query, request };
}
describe("server-owned metric comparison query", () => {
  it("reads actual immutable versions and blocks unknown P1 improvement eligibility", async () => {
    const { query, request } = setup();
    const result = await query(request);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("failed");
    }
    expect(result.comparison.status).toBe("blocked");
    expect(result.comparison.reasons).toContain("ineligible_sample");
    expect(result.comparison.reasons).toContain("provenance_gate");
    expect(result.comparison.promotionAllowed).toBe(false);
    expect(result.evidence.baseline[0].result).toMatchObject({
      ok: true,
      samples: [{ qualification: "outcome_only", improvementEligible: false }],
    });
    expect(JSON.stringify(result)).not.toContain("authzScopeRef");
  });
  it("rejects client aggregates, eligibility and provenance fields", async () => {
    const { query, request } = setup();
    for (const patch of [{ numerator: 99 }, { eligibility: "eligible" }, { provenance: "live" }]) {
      expect(await query({ ...request, ...patch })).toEqual({ ok: false, code: "invalid_request" });
    }
    expect(await query({ ...request, baseline: { ...request.baseline, numerator: 1 } })).toEqual({
      ok: false,
      code: "invalid_request",
    });
  });
  it("deduplicates exact immutable version refs", async () => {
    const { query, request } = setup();
    request.baseline.refs.push({ ...request.baseline.refs[0] });
    const r = await query(request);
    if (!r.ok) {
      throw new Error("failed");
    }
    expect(r.evidence.baseline).toHaveLength(1);
    expect(r.comparison.evidence.baseline.denominator).toBe(1);
  });
  it("discards all evidence after permission revocation during asynchronous reads", async () => {
    const { cfg, request } = setup();
    let calls = 0;
    const query = createMetricCompareQuery({
      cfg,
      now: () => at + 20,
      authorize: async () => (++calls < 3 ? { subjectRef: "subject:alice", tenantId: "t" } : null),
    });
    expect(await query(request)).toEqual({ ok: false, code: "unauthorized" });
  });
  it("checks task ownership instead of trusting comparison references", async () => {
    const { cfg, request } = setup();
    const query = createMetricCompareQuery({
      cfg,
      now: () => at + 20,
      authorize: async () => ({ subjectRef: "subject:bob", tenantId: "t" }),
    });
    expect(await query(request)).toEqual({ ok: false, code: "unauthorized" });
  });
  it("bounds samples and windows and rejects agent cohort mismatch", async () => {
    const { query, request } = setup();
    expect(
      await query({
        ...request,
        baseline: {
          ...request.baseline,
          refs: Array.from({ length: 51 }, () => request.baseline.refs[0]),
        },
      }),
    ).toMatchObject({ ok: false });
    expect(
      await query({
        ...request,
        baseline: { ...request.baseline, window: { from: at - 31 * 86400000, to: at } },
      }),
    ).toMatchObject({ ok: false });
    expect(
      await query({
        ...request,
        candidate: {
          ...request.candidate,
          refs: [{ ...request.candidate.refs[0], agentId: "other" }],
        },
      }),
    ).toEqual({ ok: false, code: "agent_cohort_mismatch" });
  });
  it("rejects requested versions outside their cohort window instead of shrinking denominator", async () => {
    const { query, request } = setup();
    expect(
      await query({
        ...request,
        baseline: { ...request.baseline, window: { from: at - 10, to: at } },
      }),
    ).toEqual({ ok: false, code: "evidence_unavailable" });
  });
  it("reports cohort identity as unproven even for the same agent", async () => {
    const { query, request } = setup();
    const r = await query(request);
    if (!r.ok) {
      throw new Error("failed");
    }
    expect(r.comparison.reasons).toContain("cohort_identity_unknown");
  });
  it("matches only server-read authoritative contract dimensions and keeps source gates", async () => {
    const { root, query, request } = setup();
    const add = (taskId: string, kind = "document", version = "v1") => {
      for (const location of ["tips/" + taskId + ".json", "versions/" + taskId + "__v1.json"]) {
        const file = path.join(root, "task-outcomes", location);
        const row = JSON.parse(fs.readFileSync(file, "utf8"));
        fs.writeFileSync(
          file,
          JSON.stringify({
            ...row,
            taskContract: { id: "contract", kind, version, requiredValidators: ["b", "a"] },
            taskContractVersion: "v1",
            judgementPolicyVersion: "p1",
            entrypoint: "chat",
          }),
        );
      }
    };
    add("base");
    add("candidate");
    const matched = await query(request);
    if (!matched.ok) {
      throw new Error("failed");
    }
    expect(matched.cohort?.state).toBe("matched");
    expect(matched.comparison.status).toBe("blocked");
    expect(matched.comparison.reasons).toContain("ineligible_sample");
    expect(matched.comparison.reasons).not.toContain("cohort_identity_unknown");
    add("candidate", "code");
    const mismatch = await query(request);
    if (!mismatch.ok) {
      throw new Error("failed");
    }
    expect(mismatch.comparison.reasons).toContain("cohort_dimensions_mismatch");
  });
  it("rejects a baseline cohort changing while candidate reads are awaited", async () => {
    const { root, cfg, request } = setup();
    let calls = 0;
    const query = createMetricCompareQuery({
      cfg,
      now: () => at + 20,
      authorize: async () => {
        calls++;
        if (calls === 6) {
          for (const location of ["tips/base.json", "versions/base__v1.json"]) {
            const file = path.join(root, "task-outcomes", location);
            const row = JSON.parse(fs.readFileSync(file, "utf8"));
            fs.writeFileSync(
              file,
              JSON.stringify({
                ...row,
                taskContract: {
                  id: "changed",
                  version: "v1",
                  kind: "document",
                  requiredValidators: [],
                },
                taskContractVersion: "v1",
                judgementPolicyVersion: "p1",
                entrypoint: "chat",
              }),
            );
          }
        }
        return { subjectRef: "subject:alice", tenantId: "t" };
      },
    });
    expect(await query(request)).toEqual({ ok: false, code: "evidence_unavailable" });
  });
});
