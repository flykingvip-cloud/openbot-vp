// @vitest-environment node
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { ModelCandidate } from "../../../agents/model-fallback.types.js";
import { adaptModelEntitlement, CLI_BACKEND_MODEL_MARKER } from "./model-entitlement-adapter.js";

const TS = "2026-09-28T06:00:00.000Z";
const UUID = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff";

const PRIMARY: ModelCandidate = { provider: "openai", model: "gpt-4.1-mini" };
const FALLBACK: ModelCandidate = { provider: "anthropic", model: "claude-haiku-3-5" };

describe("ModelEntitlementAdapter mapping", () => {
  it("no enterprise scope (legacy) → skipped + legacy", () => {
    const decision = adaptModelEntitlement({
      mode: "legacy",
      before: [PRIMARY, FALLBACK],
      after: [],
      ts: TS,
      uuid: () => UUID,
    });
    expect(decision).toMatchObject({
      effect: "skipped",
      mode: "legacy",
      source: "model-entitlement",
      decisionId: `gd-${UUID}`,
      reason: "no-enterprise-scope",
    });
    expect(decision.effect).not.toBe("allow");
  });

  it("empty after set → deny with a new gd- id and commercialAuthorizationId", () => {
    const decision = adaptModelEntitlement({
      mode: "shadow",
      before: [PRIMARY, FALLBACK],
      after: [],
      context: { commercialAuthorizationId: "auth-1", tenantId: "t1" },
      ts: TS,
      uuid: () => UUID,
    });
    expect(decision).toMatchObject({
      effect: "deny",
      mode: "shadow",
      reason: "entitlement-empty",
      decisionId: `gd-${UUID}`,
      commercialAuthorizationId: "auth-1",
      tenantId: "t1",
    });
    expect(decision.decisionId).not.toBe("auth-1");
  });

  it("candidate still present → allow", () => {
    const decision = adaptModelEntitlement({
      mode: "shadow",
      before: [PRIMARY, FALLBACK],
      after: [PRIMARY, FALLBACK],
      context: { commercialAuthorizationId: "auth-2" },
      ts: TS,
      uuid: () => UUID,
    });
    expect(decision).toMatchObject({
      effect: "allow",
      reason: "within-allowlist",
      commercialAuthorizationId: "auth-2",
      decisionId: `gd-${UUID}`,
    });
  });

  it("enterprise scope without allowlist stays skipped (never allow)", () => {
    const decision = adaptModelEntitlement({
      mode: "shadow",
      before: [PRIMARY],
      after: undefined,
      ts: TS,
      uuid: () => UUID,
    });
    expect(decision.effect).toBe("skipped");
    expect(decision.effect).not.toBe("allow");
    expect(decision.reason).toBe("enterprise-scope-without-allowlist");
  });

  it("does not import auth or fabric into the adapter", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const source = fs.readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), "model-entitlement-adapter.ts"),
      "utf8",
    );
    expect(source).not.toMatch(
      /authorizeCommercialRun|authorizeAgentInvocation|auditManagementDecision|resolveSecurityProfile|employee-model-gate/,
    );
    expect(source).not.toMatch(/fabric|constitutional-contracts|aor-core/i);
  });
});

describe("ModelEntitlementAdapter properties", () => {
  const candidateArb: fc.Arbitrary<ModelCandidate> = fc.record({
    provider: fc.constantFrom("openai", "anthropic", "claude-cli"),
    model: fc.constantFrom("gpt-4.1-mini", "claude-haiku-3-5", "opus"),
  });

  it("source allow→allow, deny→deny; skipped never becomes allow", () => {
    fc.assert(
      fc.property(
        fc.constantFrom<"legacy" | "shadow" | "enforced">("legacy", "shadow", "enforced"),
        fc.array(candidateArb, { minLength: 1, maxLength: 3 }),
        fc.boolean(),
        fc.boolean(),
        (mode, before, supplyAfter, emptyAfter) => {
          const after = !supplyAfter
            ? undefined
            : emptyAfter
              ? []
              : before.slice(0, Math.max(1, before.length - 1));
          const decision = adaptModelEntitlement({
            mode,
            before,
            after,
            context: { commercialAuthorizationId: "auth-p" },
            ts: TS,
            uuid: () => UUID,
            isCliBackend: (c) => c.provider === "claude-cli",
          });
          if (mode === "legacy") {
            expect(decision.effect).toBe("skipped");
            expect(decision.mode).toBe("legacy");
            expect(decision.effect).not.toBe("allow");
            return;
          }
          if (after === undefined) {
            expect(decision.effect).toBe("skipped");
            expect(decision.effect).not.toBe("allow");
            return;
          }
          if (after.length === 0) {
            expect(decision.effect).toBe("deny");
          } else {
            expect(decision.effect).toBe("allow");
          }
          expect(decision.decisionId.startsWith("gd-")).toBe(true);
          expect(decision.commercialAuthorizationId).toBe("auth-p");
          expect(decision.decisionId).not.toBe("auth-p");
          // CLI marker only when relevant; never invent allow from skipped.
          if (decision.effect === "skipped") {
            expect(decision.reason).not.toBe(CLI_BACKEND_MODEL_MARKER);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
