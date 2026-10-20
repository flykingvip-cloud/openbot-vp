import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  classifyDivergence,
  createGovernanceDecision,
  createLegacySkippedDecision,
  GovernanceDecisionInvariantError,
  type RunGovernanceSnapshot,
} from "./decision.js";
import { EXECUTION_ENTRY_REGISTRY } from "./execution-entry-registry.js";

const TS = "2026-09-27T00:00:00.000Z";

describe("governance decision envelope", () => {
  it("builds an envelope and drops undefined optional fields", () => {
    const decision = createGovernanceDecision({
      effect: "allow",
      decisionId: "gd-1",
      source: "model-entitlement",
      mode: "shadow",
      runId: "run-1",
      tenantId: undefined,
      decisionTrace: [{ stage: "model.allowlist", hit: true, effect: "allow" }],
      ts: TS,
    });
    expect(decision).toEqual({
      effect: "allow",
      decisionId: "gd-1",
      source: "model-entitlement",
      mode: "shadow",
      runId: "run-1",
      decisionTrace: [{ stage: "model.allowlist", hit: true, effect: "allow" }],
      ts: TS,
    });
    expect("tenantId" in decision).toBe(false);
  });

  it("accepts arbitrary trace stages (not the Fabric closed enum)", () => {
    const decision = createGovernanceDecision({
      effect: "deny",
      decisionId: "gd-2",
      source: "other",
      mode: "enforced",
      decisionTrace: [{ stage: "custom.stage.not-in-fabric", hit: true, effect: "deny" }],
      ts: TS,
    });
    expect(decision.decisionTrace?.[0]?.stage).toBe("custom.stage.not-in-fabric");
  });

  it("rejects legacy mode with a non-skipped effect", () => {
    expect(() =>
      createGovernanceDecision({
        effect: "allow",
        decisionId: "gd-3",
        source: "model-entitlement",
        mode: "legacy",
        ts: TS,
      }),
    ).toThrow(GovernanceDecisionInvariantError);
  });

  it("rejects missing decisionId or ts", () => {
    expect(() =>
      createGovernanceDecision({
        effect: "allow",
        decisionId: " ",
        source: "other",
        mode: "shadow",
        ts: TS,
      }),
    ).toThrow(/decisionId/);
    expect(() =>
      createGovernanceDecision({
        effect: "allow",
        decisionId: "gd-4",
        source: "other",
        mode: "shadow",
        ts: "",
      }),
    ).toThrow(/ts/);
  });

  it("legacy constructor always yields skipped + legacy", () => {
    const decision = createLegacySkippedDecision({
      decisionId: "gd-5",
      source: "model-entitlement",
      runId: "run-5",
      ts: TS,
    });
    expect(decision).toMatchObject({
      effect: "skipped",
      mode: "legacy",
      reason: "no-enterprise-scope",
      runId: "run-5",
    });
  });

  it("does not mutate caller-owned arrays", () => {
    const trace = [{ stage: "s", hit: true, effect: "allow" as const }];
    const decision = createGovernanceDecision({
      effect: "allow",
      decisionId: "gd-6",
      source: "other",
      mode: "shadow",
      decisionTrace: trace,
      ts: TS,
    });
    expect(decision.decisionTrace).not.toBe(trace);
    expect(decision.decisionTrace).toEqual(trace);
  });

  it("freezes the run snapshot type shape", () => {
    const snapshot: RunGovernanceSnapshot = {
      snapshotId: "auth-1",
      runId: "run-1",
      governanceMode: "shadow",
      decisions: [],
      effectiveModelSet: { allowlist: ["openai/gpt-5"] },
      commercialAuthorizationId: "auth-1",
      createdAt: TS,
    };
    expect(snapshot.governanceMode).toBe("shadow");
  });
});

describe("envelope entry (P3 entry stamp)", () => {
  it("keeps a stamped entry and drops an undefined one", () => {
    const base = {
      effect: "skipped" as const,
      decisionId: "gd-7",
      source: "capability" as const,
      mode: "shadow" as const,
      ts: TS,
    };
    expect(createGovernanceDecision({ ...base, entry: "E8" })).toMatchObject({ entry: "E8" });
    expect("entry" in createGovernanceDecision({ ...base, entry: undefined })).toBe(false);
  });

  it("stamped entries are registry ids; E6 is the E6a / E6b / E6c family", () => {
    const ids = new Set(EXECUTION_ENTRY_REGISTRY.map((row) => row.id));
    for (const id of ["E2", "E3", "E8", "E9", "E10", "E11", "E12"]) {
      expect(ids.has(id), id).toBe(true);
    }
    expect(["E6a", "E6b", "E6c"].every((id) => ids.has(id))).toBe(true);
    expect(ids.has("E6")).toBe(false);
  });
});

describe("classifyDivergence", () => {
  it.each([
    [{ existing: "allow", shadow: "allow" }, "D0"],
    [{ existing: "allow", shadow: "deny" }, "D1"],
    [{ existing: "allow", shadow: "deny", stricterCause: "missing-attribution" }, "D2"],
    [{ existing: "deny", shadow: "allow" }, "D3"],
    [{ existing: "allow", shadow: "deny", sameSubject: false }, "D4"],
    [{ existing: "skipped", shadow: "deny" }, "D5"],
    [{ existing: "allow", shadow: "skipped" }, "D5"],
    [{ existing: "allow", shadow: "allow", shadowThrew: true }, "D6"],
  ] as const)("%j → %s", (input, expected) => {
    expect(classifyDivergence(input)).toBe(expected);
  });
});

describe("governance module boundaries", () => {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  it.each(["decision.ts", "decision-id.ts", "mode.ts", "shadow-sink.ts", "shadow-failure.ts"])(
    "%s does not import Fabric, the security profile, or management audit",
    (file) => {
      const source = readFileSync(path.join(dir, file), "utf8");
      const imports = source
        .split("\n")
        .filter((line) => /^\s*(import|export)\b.*\bfrom\s+["']/.test(line))
        .join("\n");
      expect(imports).not.toMatch(/fabric/i);
      expect(imports).not.toMatch(/security-profile|resolveSecurityProfile/);
      expect(imports).not.toMatch(/management-governance-audit|auditManagementDecision/);
      expect(source).not.toMatch(/DecisionTraceEntry/);
    },
  );
});
