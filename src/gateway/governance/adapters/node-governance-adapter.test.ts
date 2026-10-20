// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { adaptNodeGovernanceDecision } from "./node-governance-adapter.js";

const TS = "2026-09-28T06:00:00.000Z";
const UUID = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff";

describe("NodeGovernanceAdapter mapping", () => {
  it("maps allowed → allow with a fresh gd- id and D0 vs live node path", () => {
    const decision = adaptNodeGovernanceDecision({
      decision: {
        allowed: true,
        nodeId: "node-1",
        command: "system.run",
        requestId: "req-1",
        tenantId: "tenant-a",
        ownerId: "user-a",
      },
      ts: TS,
      uuid: () => UUID,
    });
    expect(decision).toMatchObject({
      effect: "allow",
      mode: "shadow",
      source: "node",
      decisionId: `gd-${UUID}`,
      reason: "system.run",
      requestId: "req-1",
      tenantId: "tenant-a",
      actorId: "owner:user-a",
      subject: { kind: "node", id: "node-1" },
      shadow: {
        existing: { effect: "allow", source: "node", reason: "not-enforced" },
        divergence: "D0",
      },
      ts: TS,
    });
    expect(decision.decisionId).toMatch(/^gd-/);
  });

  it("maps !allowed → deny with D1 (known bypass)", () => {
    const decision = adaptNodeGovernanceDecision({
      decision: {
        allowed: false,
        reason: "outside-governance-scope",
        nodeId: "node-1",
        command: "system.run",
        ownerId: "user-b",
      },
      ts: TS,
      uuid: () => UUID,
    });
    expect(decision).toMatchObject({
      effect: "deny",
      mode: "shadow",
      source: "node",
      reason: "outside-governance-scope",
      actorId: "owner:user-b",
      shadow: {
        existing: { effect: "allow", source: "node", reason: "not-enforced" },
        divergence: "D1",
      },
    });
  });

  it("maps unattributed ownership deny → D2 (missing attribution)", () => {
    const decision = adaptNodeGovernanceDecision({
      decision: {
        allowed: false,
        reason: "node-ownership-unattributed",
        nodeId: "node-2",
        command: "system.run",
      },
      ts: TS,
      uuid: () => UUID,
    });
    expect(decision).toMatchObject({
      effect: "deny",
      reason: "node-ownership-unattributed",
      shadow: { divergence: "D2" },
    });
  });

  it("does not put auth logic imports in the adapter source", () => {
    const source = fs.readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), "node-governance-adapter.ts"),
      "utf8",
    );
    expect(source).not.toMatch(
      /authorizeNodeGovernance|authorizeAgentInvocation|auditManagementDecision|resolveSecurityProfile|evaluateAgentInvocation/,
    );
    expect(source).not.toMatch(/fabric|constitutional-contracts|aor-core/i);
  });
});

describe("NodeGovernanceAdapter properties", () => {
  it("source allow→allow, deny→deny; never skipped→allow", () => {
    fc.assert(
      fc.property(
        fc.boolean(),
        fc.option(fc.constantFrom("outside-governance-scope", "node-ownership-unattributed"), {
          nil: undefined,
        }),
        fc.string({ minLength: 1, maxLength: 24 }),
        fc.string({ minLength: 1, maxLength: 24 }),
        (allowed, reason, nodeId, command) => {
          const decision = adaptNodeGovernanceDecision({
            decision: {
              allowed,
              ...(allowed ? {} : { reason: reason ?? "outside-governance-scope" }),
              nodeId,
              command,
            },
            ts: TS,
            uuid: () => UUID,
          });
          if (allowed) {
            expect(decision.effect).toBe("allow");
            expect(decision.shadow?.divergence).toBe("D0");
          } else {
            expect(decision.effect).toBe("deny");
            const expectedDiv =
              (reason ?? "outside-governance-scope") === "node-ownership-unattributed"
                ? "D2"
                : "D1";
            expect(decision.shadow?.divergence).toBe(expectedDiv);
          }
          expect(decision.effect).not.toBe("skipped");
          expect(decision.source).toBe("node");
          expect(decision.mode).toBe("shadow");
          expect(decision.decisionId).toMatch(/^gd-/);
        },
      ),
      { numRuns: 100 },
    );
  });
});
