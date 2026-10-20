/**
 * parity-matrix.test.ts — zero-regression matrix (Phase B 11.4, R13.2/13.4).
 *
 * The acceptance review flagged that the original parity test only covered
 * exec-approval independence. This matrix proves, across representative inputs,
 * that every existing enforcement surface (exec-approval, session-domain, scope,
 * role, sandbox/fs constraint mapping) yields IDENTICAL verdicts with the Fabric
 * feature flag OFF vs ON — i.e. enabling Fabric does not relax any existing
 * denial. It also guards that Fabric's own `decide` never turns a DENY into a
 * non-DENY and `toTolControls` is tightening-only.
 */
import { afterEach, describe, expect, it } from "vitest";
import { authorizeOperatorScopesForMethod } from "../gateway/method-scopes.js";
import { guardSessionDomain } from "../gateway/platform-auth/session-domain.js";
import { isRoleAuthorizedForMethod } from "../gateway/role-policy.js";
import { requiresExecApproval, type ExecAsk, type ExecSecurity } from "../infra/exec-approvals.js";
import { toTolControls } from "./constraints.js";
import type { ExecutionConstraints } from "./contract.js";
import { FABRIC_ENABLED_ENV } from "./feature.js";
import { decide } from "./policy-runtime.js";

afterEach(() => delete process.env[FABRIC_ENABLED_ENV]);

/** Run `fn` with the flag OFF then ON; assert both produce deep-equal results. */
function flagIndependent<T>(fn: () => T): void {
  delete process.env[FABRIC_ENABLED_ENV];
  const off = fn();
  process.env[FABRIC_ENABLED_ENV] = "1";
  const on = fn();
  expect(on).toEqual(off);
}

describe("parity matrix — exec-approval verdicts flag-independent", () => {
  it("identical across ask × security × analysis × allowlist", () => {
    const asks: ExecAsk[] = ["off", "on-miss", "always"];
    const secs: ExecSecurity[] = ["deny", "allowlist", "full"];
    flagIndependent(() =>
      asks.flatMap((ask) =>
        secs.flatMap((security) =>
          [true, false].flatMap((analysisOk) =>
            [true, false].map((allowlistSatisfied) =>
              requiresExecApproval({ ask, security, analysisOk, allowlistSatisfied }),
            ),
          ),
        ),
      ),
    );
  });
});

describe("parity matrix — session-domain verdicts flag-independent", () => {
  it("identical across method × domain", () => {
    const methods = ["fabric.tool.execute", "fabric.policy.check", "health", "agents.create"];
    const domains = ["platform", "enterprise", "employee", null] as const;
    flagIndependent(() => methods.flatMap((m) => domains.map((d) => guardSessionDomain(m, d))));
  });
});

describe("parity matrix — operator scope verdicts flag-independent", () => {
  it("identical across method × scope-set, and write methods reject read-only", () => {
    const read = ["operator.read"];
    const write = ["operator.write"];
    flagIndependent(() => [
      authorizeOperatorScopesForMethod("fabric.tool.execute", read),
      authorizeOperatorScopesForMethod("fabric.tool.execute", write),
      authorizeOperatorScopesForMethod("fabric.policy.check", read),
      authorizeOperatorScopesForMethod("fabric.adapter.register", read),
    ]);
    // write-only method denies a read-only scope set (real gate, not relaxed).
    expect(authorizeOperatorScopesForMethod("fabric.tool.execute", read).allowed).toBe(false);
    expect(authorizeOperatorScopesForMethod("fabric.tool.execute", write).allowed).toBe(true);
  });
});

describe("parity matrix — role authorization flag-independent", () => {
  it("identical across role × method", () => {
    const roles = ["operator", "node"] as const;
    const methods = ["fabric.tool.execute", "fabric.policy.check", "health"];
    flagIndependent(() =>
      roles.flatMap((r) => methods.map((m) => isRoleAuthorizedForMethod(r, m))),
    );
  });
});

describe("parity matrix — sandbox/fs constraint mapping is tightening-only", () => {
  it("never emits workspaceOnly:false; strict forces network off; flag-independent", () => {
    const modes: Array<ExecutionConstraints["sandboxMode"]> = [
      undefined,
      "none",
      "restricted",
      "strict",
    ];
    const nets: Array<boolean | undefined> = [undefined, true, false];
    for (const sandboxMode of modes) {
      for (const allowNetwork of nets) {
        const c = toTolControls({ sandboxMode, allowNetwork });
        expect(c.fs.workspaceOnly).not.toBe(false);
        if (sandboxMode === "strict") {
          expect(c.sandbox?.network).toBe(false);
          expect(c.fs.workspaceOnly).toBe(true);
        }
      }
    }
    flagIndependent(() => toTolControls({ sandboxMode: "strict", allowNetwork: true }));
  });
});

describe("parity matrix — Fabric decide never relaxes a DENY", () => {
  it("a denied scope stays DENY regardless of the feature flag", () => {
    const req = {
      id: "r",
      source: { type: "cursor" as const },
      tool: { name: "exec" },
      input: {},
      context: {},
      trace: { sessionId: "s", correlationId: "c" },
    };
    flagIndependent(
      () => decide(req, { scope: { allowed: false, missingScope: "operator.write" } }).decision,
    );
    expect(decide(req, { scope: { allowed: false } }).decision).toBe("DENY");
  });
});
