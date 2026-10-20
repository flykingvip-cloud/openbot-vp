// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";
import { getOwnershipRecord, upsertOwnershipRecord } from "../ownership-store.js";
import { ErrorCodes, type ErrorShape } from "../protocol/index.js";
import {
  _getAuditLog,
  _getIgnoredIssues,
  _resetMeshGovernanceState,
  meshGovernanceHandlers,
} from "./mesh-governance.js";
import type { GatewayRequestHandler, GatewayRequestHandlerOptions } from "./types.js";

function call(handlerName: string, params: Record<string, unknown> = {}) {
  let result: { ok: boolean; payload?: unknown; error?: ErrorShape } = { ok: false };
  const respond = (ok: boolean, payload?: unknown, error?: ErrorShape) => {
    result = { ok, payload, error };
  };
  const handler = meshGovernanceHandlers[handlerName] as GatewayRequestHandler | undefined;
  if (!handler) {
    throw new Error(`Unknown handler: ${handlerName}`);
  }
  const options = {
    req: { jsonrpc: "2.0", method: handlerName, params, id: "1" },
    params,
    client: null,
    isWebchatConnect: () => false,
    respond,
    context: {} as GatewayRequestHandlerOptions["context"],
  } as unknown as GatewayRequestHandlerOptions;
  void handler(options);
  return result;
}

describe("mesh.governance gateway handlers", () => {
  beforeEach(() => {
    _resetMeshGovernanceState();
  });

  describe("mesh.governance.getConfig", () => {
    it("returns default config", () => {
      const result = call("mesh.governance.getConfig");
      expect(result.ok).toBe(true);
      const payload = result.payload as { config: Record<string, number> };
      expect(payload.config.consecutiveErrorThreshold).toBe(5);
      expect(payload.config.errorRateThreshold).toBe(0.3);
      expect(payload.config.zombieDays).toBe(30);
    });
  });

  describe("mesh.governance.updateConfig", () => {
    it("updates config when values are valid", () => {
      const result = call("mesh.governance.updateConfig", {
        consecutiveErrorThreshold: 10,
        errorRateThreshold: 0.5,
      });
      expect(result.ok).toBe(true);
      const payload = result.payload as { config: Record<string, number> };
      expect(payload.config.consecutiveErrorThreshold).toBe(10);
      expect(payload.config.errorRateThreshold).toBe(0.5);
      // Other values should remain at defaults
      expect(payload.config.zombieDays).toBe(30);
    });

    it("rejects out-of-range consecutiveErrorThreshold", () => {
      const result = call("mesh.governance.updateConfig", {
        consecutiveErrorThreshold: 200,
      });
      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe(ErrorCodes.INVALID_REQUEST);
      expect(result.error?.message).toContain("consecutiveErrorThreshold");
    });

    it("rejects out-of-range errorRateThreshold", () => {
      const result = call("mesh.governance.updateConfig", {
        errorRateThreshold: 1.5,
      });
      expect(result.ok).toBe(false);
      expect(result.error?.message).toContain("errorRateThreshold");
    });

    it("persists config across calls", () => {
      call("mesh.governance.updateConfig", { zombieDays: 45 });
      const result = call("mesh.governance.getConfig");
      const payload = result.payload as { config: Record<string, number> };
      expect(payload.config.zombieDays).toBe(45);
    });
  });

  describe("mesh.governance.executeAction", () => {
    const validParams = {
      issueId: "consecutive_errors:agent:agent-1",
      actionType: "pause",
      targetId: "agent-1",
      targetKind: "agent",
      operatorUserId: "admin@example.com",
      operatorPositionId: "pos-admin",
      reason: "连续错误过多",
    };

    it("records audit log on success", () => {
      const result = call("mesh.governance.executeAction", validParams);
      expect(result.ok).toBe(true);

      const payload = result.payload as { ok: boolean; removedIssueId: string };
      expect(payload.ok).toBe(true);
      expect(payload.removedIssueId).toBe("consecutive_errors:agent:agent-1");

      const log = _getAuditLog();
      expect(log).toHaveLength(1);
      expect(log[0].actionType).toBe("pause");
      expect(log[0].targetId).toBe("agent-1");
      expect(log[0].operatorUserId).toBe("admin@example.com");
      expect(log[0].reason).toBe("连续错误过多");
    });

    it("adds to ignored set when actionType is ignore", () => {
      call("mesh.governance.executeAction", { ...validParams, actionType: "ignore" });
      expect(_getIgnoredIssues()).toContain(validParams.issueId);
    });

    it("adds to ignored set when actionType is mark_known", () => {
      call("mesh.governance.executeAction", { ...validParams, actionType: "mark_known" });
      expect(_getIgnoredIssues()).toContain(validParams.issueId);
    });

    it("does NOT add to ignored set for pause action", () => {
      call("mesh.governance.executeAction", validParams);
      expect(_getIgnoredIssues()).not.toContain(validParams.issueId);
    });

    it("rejects when issueId is missing", () => {
      const { issueId, ...rest } = validParams;
      void issueId;
      const result = call("mesh.governance.executeAction", rest);
      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe(ErrorCodes.INVALID_REQUEST);
    });

    it("rejects when operatorUserId is missing", () => {
      const { operatorUserId, ...rest } = validParams;
      void operatorUserId;
      const result = call("mesh.governance.executeAction", rest);
      expect(result.ok).toBe(false);
    });

    it("does NOT record audit log when validation fails", () => {
      call("mesh.governance.executeAction", { issueId: "x" }); // missing other required fields
      expect(_getAuditLog()).toHaveLength(0);
    });
  });

  describe("mesh.governance.listQueue", () => {
    it("returns empty initial state", () => {
      const result = call("mesh.governance.listQueue");
      expect(result.ok).toBe(true);
      const payload = result.payload as { ignoredIssues: string[]; auditLogCount: number };
      expect(payload.ignoredIssues).toEqual([]);
      expect(payload.auditLogCount).toBe(0);
    });

    it("reflects ignored issues after ignore actions", () => {
      call("mesh.governance.executeAction", {
        issueId: "issue-1",
        actionType: "ignore",
        targetId: "agent-1",
        targetKind: "agent",
        operatorUserId: "admin",
        operatorPositionId: "pos-admin",
      });
      call("mesh.governance.executeAction", {
        issueId: "issue-2",
        actionType: "pause",
        targetId: "agent-2",
        targetKind: "agent",
        operatorUserId: "admin",
        operatorPositionId: "pos-admin",
      });

      const result = call("mesh.governance.listQueue");
      const payload = result.payload as { ignoredIssues: string[]; auditLogCount: number };
      expect(payload.ignoredIssues).toEqual(["issue-1"]);
      expect(payload.auditLogCount).toBe(2);
    });
  });

  describe("mesh.ownership.transfer", () => {
    const validParams = {
      positionId: "pos-eng",
      previousUserId: "alice@example.com",
      newUserId: "bob@example.com",
      newUserLabel: "Bob",
    };

    it("returns transfer log on success", () => {
      const result = call("mesh.ownership.transfer", validParams);
      expect(result.ok).toBe(true);
      const payload = result.payload as {
        ok: boolean;
        transferLog: Record<string, string>;
      };
      expect(payload.ok).toBe(true);
      expect(payload.transferLog.positionId).toBe("pos-eng");
      expect(payload.transferLog.previousUserId).toBe("alice@example.com");
      expect(payload.transferLog.newUserId).toBe("bob@example.com");
      expect(payload.transferLog.newUserLabel).toBe("Bob");
      expect(payload.transferLog.transferredAt).toBeTruthy();
    });

    it("rejects when positionId is missing", () => {
      const { positionId, ...rest } = validParams;
      void positionId;
      const result = call("mesh.ownership.transfer", rest);
      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe(ErrorCodes.INVALID_REQUEST);
    });

    it("uses newUserId as label when newUserLabel is missing", () => {
      const { newUserLabel, ...rest } = validParams;
      void newUserLabel;
      const result = call("mesh.ownership.transfer", rest);
      expect(result.ok).toBe(true);
      const payload = result.payload as { transferLog: Record<string, string> };
      expect(payload.transferLog.newUserLabel).toBe("bob@example.com");
    });

    it("updates a concrete ownership record when subject coordinates are provided", () => {
      upsertOwnershipRecord({
        tenantId: "001",
        subjectKind: "agent",
        subjectId: "agent-1",
        positionId: "pos-sales",
        positionLabel: "销售经理",
        createdByUserId: "alice@example.com",
        createdByUserLabel: "Alice",
        currentManagerUserId: "alice@example.com",
        currentManagerLabel: "Alice",
      });

      const result = call("mesh.ownership.transfer", {
        tenantId: "001",
        subjectKind: "agent",
        subjectId: "agent-1",
        positionId: "pos-marketing",
        previousUserId: "alice@example.com",
        newUserId: "bob@example.com",
        newUserLabel: "Bob",
      });
      expect(result.ok).toBe(true);

      const record = getOwnershipRecord({
        tenantId: "001",
        subjectKind: "agent",
        subjectId: "agent-1",
      });
      expect(record).toMatchObject({
        positionId: "pos-marketing",
        currentManagerUserId: "bob@example.com",
        currentManagerLabel: "Bob",
        bindingStatus: "transferred",
      });
    });
  });

  describe("mesh.ownership.revoke", () => {
    it("revokes a concrete ownership record", () => {
      upsertOwnershipRecord({
        tenantId: "001",
        subjectKind: "group",
        subjectId: "group-1",
        positionId: "pos-sales",
        positionLabel: "销售经理",
        createdByUserId: "alice@example.com",
        createdByUserLabel: "Alice",
        currentManagerUserId: "alice@example.com",
        currentManagerLabel: "Alice",
      });

      const result = call("mesh.ownership.revoke", {
        tenantId: "001",
        subjectKind: "group",
        subjectId: "group-1",
        revokedByUserId: "admin@example.com",
        revokedByUserLabel: "Admin",
        reason: "业务调整",
      });
      expect(result.ok).toBe(true);
      const record = getOwnershipRecord({
        tenantId: "001",
        subjectKind: "group",
        subjectId: "group-1",
      });
      expect(record).toMatchObject({
        bindingStatus: "revoked",
        revokedByUserId: "admin@example.com",
        revokedByUserLabel: "Admin",
      });
    });
  });
});
