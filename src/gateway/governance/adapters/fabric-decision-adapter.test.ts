// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  adaptFabricDecision,
  type FabricDecisionInput,
  type FabricDecisionKind,
} from "./fabric-decision-adapter.js";

const TS = "2026-09-28T06:00:00.000Z";
const UUID = "ffffffff-eeee-4ddd-8ccc-bbbbbbbbbbbb";

const TRACE_STAGE = "cost.threshold";

describe("FabricDecisionAdapter mapping", () => {
  it("maps ALLOW → allow with a fresh gd- id", () => {
    const decision = adaptFabricDecision({
      decision: {
        decision: "ALLOW",
        matchedRules: ["rule.a"],
        decisionTrace: [{ stage: TRACE_STAGE, hit: true, effect: "allow" }],
        runId: "run-1",
        subjectId: "run-1",
      },
      ts: TS,
      uuid: () => UUID,
    });
    expect(decision).toMatchObject({
      effect: "allow",
      mode: "shadow",
      source: "fabric",
      decisionId: `gd-${UUID}`,
      matchedRules: ["rule.a"],
      runId: "run-1",
      subject: { kind: "run", id: "run-1" },
      decisionTrace: [{ stage: TRACE_STAGE, hit: true, effect: "allow" }],
      ts: TS,
    });
    expect(decision.reason).toBeUndefined();
    expect(decision.decisionId).toMatch(/^gd-/);
  });

  it("maps DENY → deny with reason", () => {
    const decision = adaptFabricDecision({
      decision: {
        decision: "DENY",
        reason: "cost.threshold-exceeded",
        decisionTrace: [{ stage: TRACE_STAGE, hit: true, effect: "deny", detail: "over budget" }],
        runId: "run-2",
      },
      ts: TS,
      uuid: () => UUID,
    });
    expect(decision).toMatchObject({
      effect: "deny",
      mode: "shadow",
      source: "fabric",
      reason: "cost.threshold-exceeded",
      decisionId: `gd-${UUID}`,
      runId: "run-2",
      decisionTrace: [{ stage: TRACE_STAGE, hit: true, effect: "deny", detail: "over budget" }],
    });
  });

  it("maps MODIFY → allow with trace effect modify (envelope allow)", () => {
    const decision = adaptFabricDecision({
      decision: {
        decision: "MODIFY",
        matchedRules: ["sandbox.constraint"],
        decisionTrace: [
          { stage: "sandbox.constraint", hit: true, effect: "modify", detail: "network off" },
        ],
        runId: "run-3",
      },
      ts: TS,
      uuid: () => UUID,
    });
    expect(decision.effect).toBe("allow");
    expect(decision.source).toBe("fabric");
    expect(decision.mode).toBe("shadow");
    expect(decision.decisionId).toBe(`gd-${UUID}`);
    expect(decision.decisionTrace?.some((entry) => entry.effect === "modify")).toBe(true);
    expect(decision.decisionTrace?.[0]).toMatchObject({
      stage: "sandbox.constraint",
      hit: true,
      effect: "modify",
      detail: "network off",
    });
  });

  it("injects a modify trace row when MODIFY arrives without one", () => {
    const decision = adaptFabricDecision({
      decision: { decision: "MODIFY" },
      ts: TS,
      uuid: () => UUID,
    });
    expect(decision.effect).toBe("allow");
    expect(decision.decisionTrace).toEqual([
      { stage: "fabric.modify", hit: true, effect: "modify" },
    ]);
  });

  it("copies stage as a plain string (GovernanceTraceEntry, not Fabric enum)", () => {
    const decision = adaptFabricDecision({
      decision: {
        decision: "ALLOW",
        decisionTrace: [{ stage: "custom.not-in-fabric-enum", hit: false, effect: "neutral" }],
      },
      ts: TS,
      uuid: () => UUID,
    });
    expect(decision.decisionTrace?.[0]?.stage).toBe("custom.not-in-fabric-enum");
    expect(typeof decision.decisionTrace?.[0]?.stage).toBe("string");
  });

  it("defaults DENY reason when the source omitted one", () => {
    const decision = adaptFabricDecision({
      decision: { decision: "DENY" },
      ts: TS,
      uuid: () => UUID,
    });
    expect(decision.effect).toBe("deny");
    expect(decision.reason).toBe("denied");
  });

  it("does not import Fabric modules, DecisionTraceEntry, or Fabric flags", () => {
    const source = fs.readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), "fabric-decision-adapter.ts"),
      "utf8",
    );
    const importLines = source
      .split("\n")
      .filter((line) => /^\s*import\b/.test(line) || /^\s*from\s+["']/.test(line))
      .join("\n");
    expect(importLines).not.toMatch(/fabric/i);
    expect(importLines).not.toMatch(
      /DecisionTraceEntry|PolicyDecision|isFabricEnabled|OPENBOT_FABRIC_ENABLED|FABRIC_ENABLED_ENV/,
    );
    expect(importLines).not.toMatch(/constitutional-contracts|aor-core/);
    expect(source).not.toMatch(
      /authorizeAgentInvocation|auditManagementDecision|resolveSecurityProfile/,
    );
    // Flag must not be read anywhere in the adapter body.
    expect(source).not.toMatch(/OPENBOT_FABRIC_ENABLED|isFabricEnabled|FABRIC_ENABLED_ENV/);
  });

  it("is not imported from production governance paths", () => {
    const governanceDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const productionFiles = fs
      .readdirSync(governanceDir, { withFileTypes: true })
      .filter(
        (entry) => entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts"),
      )
      .map((entry) => path.join(governanceDir, entry.name));
    for (const file of productionFiles) {
      const source = fs.readFileSync(file, "utf8");
      expect(source, file).not.toMatch(/fabric-decision-adapter/);
      expect(source, file).not.toMatch(/adaptFabricDecision/);
    }
  });
});

describe("FabricDecisionAdapter properties", () => {
  it("ALLOW→allow, DENY→deny, MODIFY→allow+modify-trace; skipped never allow", () => {
    const kindArb = fc.constantFrom<FabricDecisionKind>("ALLOW", "DENY", "MODIFY");
    const traceArb = fc.option(
      fc.array(
        fc.record({
          stage: fc.string({ minLength: 1, maxLength: 32 }),
          hit: fc.boolean(),
          detail: fc.option(fc.string({ minLength: 1, maxLength: 48 }), { nil: undefined }),
          effect: fc.constantFrom(
            "allow" as const,
            "deny" as const,
            "modify" as const,
            "neutral" as const,
          ),
        }),
        { maxLength: 4 },
      ),
      { nil: undefined },
    );

    fc.assert(
      fc.property(
        kindArb,
        fc.option(fc.string({ minLength: 1, maxLength: 48 }), { nil: undefined }),
        traceArb,
        fc.option(fc.string({ minLength: 1, maxLength: 24 }), { nil: undefined }),
        (kind, reason, decisionTrace, runId) => {
          const input: FabricDecisionInput = {
            decision: kind,
            ...(reason ? { reason } : {}),
            ...(decisionTrace ? { decisionTrace } : {}),
            ...(runId ? { runId } : {}),
          };
          const decision = adaptFabricDecision({
            decision: input,
            ts: TS,
            uuid: () => UUID,
          });

          if (kind === "ALLOW") {
            expect(decision.effect).toBe("allow");
          } else if (kind === "DENY") {
            expect(decision.effect).toBe("deny");
            expect(decision.effect).not.toBe("allow");
          } else {
            expect(decision.effect).toBe("allow");
            expect(decision.decisionTrace?.some((entry) => entry.effect === "modify")).toBe(true);
          }

          // skipped must never become allow (fabric has no skipped source; envelope stays non-skipped)
          expect(decision.effect).not.toBe("skipped");
          if (decision.effect === "skipped") {
            expect(decision.effect).not.toBe("allow");
          }

          expect(decision.source).toBe("fabric");
          expect(decision.mode).toBe("shadow");
          expect(decision.decisionId).toMatch(/^gd-/);
          for (const entry of decision.decisionTrace ?? []) {
            expect(typeof entry.stage).toBe("string");
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
