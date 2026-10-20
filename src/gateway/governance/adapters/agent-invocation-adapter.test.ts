// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { adaptAgentInvocationDecision } from "./agent-invocation-adapter.js";

const TS = "2026-09-28T06:00:00.000Z";
const UUID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

describe("AgentInvocationAdapter mapping", () => {
  it("maps allowed → allow with a fresh gd- id and D0 vs session", () => {
    const decision = adaptAgentInvocationDecision({
      decision: { allowed: true, agentId: "sales", runId: "run-1" },
      ts: TS,
      uuid: () => UUID,
    });
    expect(decision).toMatchObject({
      effect: "allow",
      mode: "shadow",
      source: "agent-invocation",
      decisionId: `gd-${UUID}`,
      runId: "run-1",
      subject: { kind: "agent", id: "sales" },
      shadow: {
        existing: { effect: "allow", source: "session", reason: "not-enforced" },
        divergence: "D0",
      },
      ts: TS,
    });
    expect(decision.reason).toBeUndefined();
    expect(decision.decisionId).toMatch(/^gd-/);
  });

  it("maps !allowed → deny with reason and D1 vs session", () => {
    const decision = adaptAgentInvocationDecision({
      decision: {
        allowed: false,
        reason: "outside-governance-scope",
        agentId: "sales",
        runId: "run-2",
      },
      ts: TS,
      uuid: () => UUID,
    });
    expect(decision).toMatchObject({
      effect: "deny",
      mode: "shadow",
      source: "agent-invocation",
      reason: "outside-governance-scope",
      decisionId: `gd-${UUID}`,
      runId: "run-2",
      subject: { kind: "agent", id: "sales" },
      shadow: {
        existing: { effect: "allow", source: "session", reason: "not-enforced" },
        divergence: "D1",
      },
    });
  });

  it("does not put auth logic imports in the adapter source", () => {
    const source = fs.readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), "agent-invocation-adapter.ts"),
      "utf8",
    );
    expect(source).not.toMatch(
      /authorizeAgentInvocation|auditManagementDecision|evaluateAgentInvocation|resolveSecurityProfile|authorizeNodeGovernance/,
    );
    expect(source).not.toMatch(/fabric|constitutional-contracts|aor-core/i);
  });
});

describe("AgentInvocationAdapter properties", () => {
  it("source allow→allow, deny→deny; never skipped→allow", () => {
    fc.assert(
      fc.property(
        fc.boolean(),
        fc.option(fc.constantFrom("outside-governance-scope", "unknown-agent"), {
          nil: undefined,
        }),
        fc.string({ minLength: 1, maxLength: 24 }),
        fc.option(fc.string({ minLength: 1, maxLength: 24 }), { nil: undefined }),
        (allowed, reason, agentId, runId) => {
          const decision = adaptAgentInvocationDecision({
            decision: {
              allowed,
              ...(allowed ? {} : { reason: reason ?? "outside-governance-scope" }),
              agentId,
              ...(runId ? { runId } : {}),
            },
            ts: TS,
            uuid: () => UUID,
          });
          if (allowed) {
            expect(decision.effect).toBe("allow");
            expect(decision.shadow?.divergence).toBe("D0");
          } else {
            expect(decision.effect).toBe("deny");
            expect(decision.shadow?.divergence).toBe("D1");
          }
          expect(decision.effect).not.toBe("skipped");
          expect(decision.source).toBe("agent-invocation");
          expect(decision.mode).toBe("shadow");
          expect(decision.decisionId).toMatch(/^gd-/);
        },
      ),
      { numRuns: 100 },
    );
  });
});
