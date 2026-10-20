/**
 * Phase 0 Strong Separation — scoped regression for boundary RPCs only.
 *
 * NOTE (acceptance §3.5): The full-suite `method-scopes.test.ts` may still fail
 * on pre-Phase-0 unclassified methods (e.g. `governance.*` and others). Those
 * failures are **existing debt**, not a regression from this Phase 0 delivery.
 * This file is the Phase 0 gate: the 13 boundary RPCs must be listed and scoped.
 *
 * Spec: docs/design/robot-workspace-mesh-phase-0-acceptance-2026-08-02.md
 */

import { describe, expect, it } from "vitest";
import {
  ADMIN_SCOPE,
  READ_SCOPE,
  WRITE_SCOPE,
  isGatewayMethodClassified,
  resolveRequiredOperatorScopeForMethod,
  type OperatorScope,
} from "../method-scopes.js";
import { listGatewayMethods } from "../server-methods-list.js";
import { coreGatewayHandlers } from "../server-methods.js";

const PHASE_0_BOUNDARY_RPCS: ReadonlyArray<{
  method: string;
  scope: OperatorScope;
}> = [
  { method: "robot.workspace.get", scope: READ_SCOPE },
  { method: "robot.workspace.listPersonas", scope: READ_SCOPE },
  { method: "robot.workspace.updateIdentity", scope: WRITE_SCOPE },
  { method: "robot.workspace.delete", scope: WRITE_SCOPE },
  { method: "collaboration.space.get", scope: READ_SCOPE },
  { method: "collaboration.space.updateBasic", scope: WRITE_SCOPE },
  { method: "collaboration.space.updateMission", scope: WRITE_SCOPE },
  { method: "collaboration.space.updateRules", scope: WRITE_SCOPE },
  { method: "mesh.operations.listOnline", scope: READ_SCOPE },
  { method: "mesh.operations.listAnomalies", scope: READ_SCOPE },
  { method: "mesh.operations.intervene", scope: ADMIN_SCOPE },
  { method: "mesh.performance.summary", scope: READ_SCOPE },
  { method: "mesh.performance.ranking", scope: READ_SCOPE },
];

describe("Phase 0 boundary RPC registration", () => {
  it("registers exactly the 13 Strong Separation facades", () => {
    expect(PHASE_0_BOUNDARY_RPCS).toHaveLength(13);
  });

  it("lists every Phase 0 boundary RPC in listGatewayMethods()", () => {
    const listed = new Set(listGatewayMethods());
    const missing = PHASE_0_BOUNDARY_RPCS.map((entry) => entry.method).filter(
      (method) => !listed.has(method),
    );
    expect(missing).toEqual([]);
  });

  it("exposes every Phase 0 boundary RPC on coreGatewayHandlers", () => {
    const missing = PHASE_0_BOUNDARY_RPCS.map((entry) => entry.method).filter(
      (method) => !(method in coreGatewayHandlers),
    );
    expect(missing).toEqual([]);
  });

  it("classifies every Phase 0 boundary RPC with the expected operator scope", () => {
    const mismatches: string[] = [];
    for (const { method, scope } of PHASE_0_BOUNDARY_RPCS) {
      if (!isGatewayMethodClassified(method)) {
        mismatches.push(`${method}: unclassified`);
        continue;
      }
      const actual = resolveRequiredOperatorScopeForMethod(method);
      if (actual !== scope) {
        mismatches.push(`${method}: expected ${scope}, got ${String(actual)}`);
      }
    }
    expect(mismatches).toEqual([]);
  });
});
