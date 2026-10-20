import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ExecApprovalDecision } from "../infra/exec-approvals.js";
import { resolveSystemRunApprovalPresence, type SystemRunApprovalPresence } from "./exec-policy.js";

/**
 * Track D / Mode A P1 lock: three vocabularies, one authority each.
 * Not dual SoT — distinct type boundaries that must not collapse.
 */
describe("exec approval vocabulary boundaries", () => {
  it("keeps infra ExecApprovalDecision as allow-once|allow-always|deny", () => {
    const allowed: ExecApprovalDecision[] = ["allow-once", "allow-always", "deny"];
    expect(allowed).toContain("deny");
    // Presence type must not be assignable from deny without mapping.
    const presence: SystemRunApprovalPresence = resolveSystemRunApprovalPresence("deny");
    expect(presence).toBeNull();
  });

  it("maps infra deny → null presence at the system-run boundary", () => {
    expect(resolveSystemRunApprovalPresence("deny")).toBeNull();
    expect(resolveSystemRunApprovalPresence("allow-once")).toBe("allow-once");
  });

  it("does not reintroduce a colliding ExecApprovalDecision type export in node-host", () => {
    const src = fs.readFileSync(path.join(__dirname, "exec-policy.ts"), "utf8");
    expect(src).toMatch(/export type SystemRunApprovalPresence/);
    expect(src).not.toMatch(/export type ExecApprovalDecision\s*=/);
  });

  it("documents host-decision allowed|pending separately from approval-decision", () => {
    const hostGateway = fs.readFileSync(
      path.join(__dirname, "../agents/bash-tools.exec-host-gateway.ts"),
      "utf8",
    );
    expect(hostGateway).toMatch(/decision:\s*"allowed"\s*\|\s*"pending"/);
    const infra = fs.readFileSync(path.join(__dirname, "../infra/exec-approvals.ts"), "utf8");
    expect(infra).toMatch(
      /export type ExecApprovalDecision = "allow-once" \| "allow-always" \| "deny"/,
    );
  });
});
