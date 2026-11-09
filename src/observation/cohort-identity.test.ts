import { describe, it, expect } from "vitest";
import { buildCohortIdentity, readOutcomeCohort } from "./cohort-identity.js";
const scope = {
  kind: "personal",
  personalDomainId: "d",
  subjectRef: "s",
  authzScopeRef: "a",
} as const;
const raw = {
  taskContract: { id: "doc", version: "v1", kind: "document", requiredValidators: ["a", "b"] },
  taskContractVersion: "v1",
  judgementPolicyVersion: "p1",
  entrypoint: "chat",
};
const identity = (record = raw) =>
  buildCohortIdentity({
    scope,
    agentId: "bot",
    dimensions: readOutcomeCohort(record),
    metricDictVersion: 1,
    metricId: "eval.link_coverage",
  });
describe("authoritative cohort identity", () => {
  it("canonicalizes validator order and duplicates", () => {
    expect(
      identity({
        ...raw,
        taskContract: { ...raw.taskContract, requiredValidators: ["b", "a", "a"] },
      }),
    ).toEqual(identity());
    expect(identity().cohortRef).toMatch(/^[a-f0-9]{64}$/);
  });
  it("separates contract type, version, policy, validators and entrypoint", () => {
    for (const record of [
      { ...raw, taskContract: { ...raw.taskContract, kind: "code" } },
      { ...raw, taskContract: { ...raw.taskContract, version: "v2" } },
      { ...raw, taskContract: { ...raw.taskContract, requiredValidators: ["a"] } },
      { ...raw, judgementPolicyVersion: "p2" },
      { ...raw, entrypoint: "cron" },
    ]) {
      expect(identity(record).cohortRef).not.toBe(identity().cohortRef);
    }
  });
  it("leaves missing and unknown business dimensions blocked", () => {
    expect(readOutcomeCohort({})).toBeUndefined();
    expect(
      buildCohortIdentity({
        scope,
        agentId: "bot",
        metricDictVersion: 1,
        metricId: "eval.link_coverage",
      }).state,
    ).toBe("unknown");
    expect(identity({ ...raw, taskContract: { ...raw.taskContract, kind: "unknown" } }).state).toBe(
      "unknown",
    );
  });
  it("binds scope agent and metric without exposing scope in the digest", () => {
    const args = {
      scope,
      agentId: "bot",
      dimensions: readOutcomeCohort(raw),
      metricDictVersion: 1,
      metricId: "eval.link_coverage",
    };
    for (const patch of [
      { agentId: "other" },
      { metricDictVersion: 2 },
      { metricId: "business.task_closed_success_rate" },
      { scope: { ...scope, authzScopeRef: "other" } },
    ]) {
      expect(buildCohortIdentity({ ...args, ...patch }).cohortRef).not.toBe(identity().cohortRef);
    }
    expect(JSON.stringify(identity())).not.toContain("authzScopeRef");
  });
});
