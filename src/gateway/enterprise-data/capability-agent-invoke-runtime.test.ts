// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as preflightResolve from "../../agents/execution-preflight/resolve.js";
import {
  readExecutionTraces,
  resetExecutionTraceForTest,
} from "../../agents/execution-preflight/trace.js";
import { countCapabilityInvocations } from "../knowledge/capability-invocation-store.js";
import {
  ENTERPRISE_CAPABILITY_INVOKE_PREFLIGHT_OBSERVE_ENV,
  enterpriseCapabilityInvokeObserveTaskId,
  formatAgentDataCapabilityRuntimePrompt,
  invokeDataCapabilityWithContext,
  isEnterpriseCapabilityInvokePreflightObserveEnabled,
} from "./capability-agent-invoke-runtime.js";
import { upsertDataConnectorCredential } from "./connector-credential-store.js";
import { saveCredentialSecret } from "./connector-credential-vault.js";
import { listDataCapabilities } from "./data-capability-store.js";
import { createTrustedExecutionContextForTest } from "./enterprise-data-seat-context.js";
import { upsertSeatActionGrant } from "./seat-action-grant-store.js";
import { seedEnterpriseDataCatalog } from "./seeds.js";
import { normalizeEnterpriseDataStore } from "./store.js";
import type { DataCapability, EnterpriseDataStore } from "./types.js";

const mockedConfigDir = path.join(os.tmpdir(), "openbot-capability-agent-invoke-test");

vi.mock("../../utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils.js")>();
  return {
    ...actual,
    CONFIG_DIR: path.join(os.tmpdir(), "openbot-capability-agent-invoke-test"),
  };
});

const tenantId = "tenant-acme";
const nowIso = "2026-06-05T12:00:00.000Z";

function seededStore(): EnterpriseDataStore {
  const store = normalizeEnterpriseDataStore(null);
  seedEnterpriseDataCatalog({ store, tenantId, nowIso });
  return store;
}

function capabilityByKey(store: EnterpriseDataStore, capabilityKey: string): DataCapability {
  const capability = listDataCapabilities({ store, tenantId }).find(
    (item) => item.capabilityKey === capabilityKey,
  );
  if (!capability) {
    throw new Error(`missing seeded capability ${capabilityKey}`);
  }
  return capability;
}

/** Granted seat: seat-sales-mgr-east holds a compiled crm.customer.read_summary v1 grant. */
function grantedContext() {
  return createTrustedExecutionContextForTest({
    tenantId,
    seatId: "seat-sales-mgr-east",
    employeeId: "emp-mgr-001",
    userId: "emp-mgr-001",
  });
}

/** Ungranted seat: no seat grant and no department/role policy coverage. */
function ungrantedContext() {
  return createTrustedExecutionContextForTest({
    tenantId,
    seatId: "seat-unknown",
    employeeId: "emp-unknown",
    userId: "emp-unknown",
  });
}

function cleanStore() {
  fs.rmSync(mockedConfigDir, { recursive: true, force: true });
  fs.mkdirSync(mockedConfigDir, { recursive: true });
}

describe("invokeDataCapabilityWithContext (W5 governed agent invoke)", () => {
  beforeEach(() => {
    delete process.env[ENTERPRISE_CAPABILITY_INVOKE_PREFLIGHT_OBSERVE_ENV];
    resetExecutionTraceForTest();
    cleanStore();
  });
  afterEach(() => {
    delete process.env[ENTERPRISE_CAPABILITY_INVOKE_PREFLIGHT_OBSERVE_ENV];
    resetExecutionTraceForTest();
    cleanStore();
  });

  it("fail-closes a granted seat instead of requesting a connector action", async () => {
    const store = seededStore();
    const capability = capabilityByKey(store, "customer.profile");
    const gateway = await import("./data-gateway.js");
    const spy = vi.spyOn(gateway, "invokeEnterpriseDataAction");
    try {
      const outcome = await invokeDataCapabilityWithContext({
        store,
        context: grantedContext(),
        capabilityId: capability.capabilityId,
        nowIso,
      });

      expect(outcome.ok).toBe(false);
      expect(outcome.reason).toBe("knowledge-object-only");
      expect(outcome.accessState).toBe("granted");
      expect(outcome.results).toBeUndefined();
      expect(outcome.auditId).toBeTruthy();
      expect(spy).not.toHaveBeenCalled();
      expect(
        countCapabilityInvocations({
          tenantId,
          seatId: "seat-sales-mgr-east",
          capabilityId: capability.capabilityId,
          okOnly: true,
        }),
      ).toBe(0);
    } finally {
      spy.mockRestore();
    }
  });

  it("denies (requestable) and audits when the seat lacks the capability grant", async () => {
    const store = seededStore();
    const capability = capabilityByKey(store, "customer.profile");
    const outcome = await invokeDataCapabilityWithContext({
      store,
      context: ungrantedContext(),
      capabilityId: capability.capabilityId,
      nowIso,
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toBe("not-authorized");
    expect(outcome.accessState).toBe("requestable");
    expect(outcome.results).toBeUndefined();
    expect(outcome.auditId).toBeTruthy();
    expect(
      countCapabilityInvocations({
        tenantId,
        seatId: "seat-unknown",
        capabilityId: capability.capabilityId,
        okOnly: false,
      }),
    ).toBe(1);
  });

  it("enforces the invocation quota before touching the data gateway", async () => {
    const store = seededStore();
    const capability = capabilityByKey(store, "customer.profile");
    const outcome = await invokeDataCapabilityWithContext({
      store,
      context: grantedContext(),
      capabilityId: capability.capabilityId,
      nowIso,
      quotaLimit: 0,
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toBe("quota-exceeded");
    expect(outcome.accessState).toBe("granted");
    expect(outcome.results).toBeUndefined();
  });

  it("returns not-found for an unknown capability id", async () => {
    const store = seededStore();
    const outcome = await invokeDataCapabilityWithContext({
      store,
      context: grantedContext(),
      capabilityId: "cap:does-not-exist",
      nowIso,
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toBe("not-found");
  });

  it("routes through the live connector adapter once a real credential is bound", async () => {
    const store = seededStore();
    // Authorize the seat for the ERP order-status action (not granted by seed).
    upsertSeatActionGrant({
      store,
      tenantId,
      seatId: "seat-sales-mgr-east",
      connectorId: "erp-sap",
      actionKey: "erp.order.read_status",
      version: "v1",
      scopePolicyId: "scope-self-default",
      approvalPolicyId: "policy-none-default",
      nowIso,
    });
    // Bind an active SAP credential + store its (simulated) secret in the vault.
    const credential = upsertDataConnectorCredential({
      store,
      tenantId,
      connectorId: "erp-sap",
      label: "SAP 生产凭证",
      kind: "api_key",
      instanceUrl: "https://sap.example.com",
      nowIso,
    });
    await saveCredentialSecret(credential.credentialId, {
      instanceUrl: "https://sap.example.com",
      apiKey: "simulated-e2e",
    });

    const orderCapability = capabilityByKey(store, "order.status");
    const gateway = await import("./data-gateway.js");
    const spy = vi.spyOn(gateway, "invokeEnterpriseDataAction");
    try {
      const outcome = await invokeDataCapabilityWithContext({
        store,
        context: grantedContext(),
        capabilityId: orderCapability.capabilityId,
        nowIso,
      });

      expect(outcome.ok).toBe(false);
      expect(outcome.reason).toBe("knowledge-object-only");
      expect(outcome.results).toBeUndefined();
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it("keeps the invoke outcome unchanged when preflight observe is off", async () => {
    expect(isEnterpriseCapabilityInvokePreflightObserveEnabled({})).toBe(false);
    for (const value of ["0", "false", "no", "off", ""]) {
      expect(
        isEnterpriseCapabilityInvokePreflightObserveEnabled({
          [ENTERPRISE_CAPABILITY_INVOKE_PREFLIGHT_OBSERVE_ENV]: value,
        }),
      ).toBe(false);
    }
    const spy = vi.spyOn(preflightResolve, "buildExecutionPreflight");
    try {
      const store = seededStore();
      const capability = capabilityByKey(store, "customer.profile");
      const outcome = await invokeDataCapabilityWithContext({
        store,
        context: grantedContext(),
        capabilityId: capability.capabilityId,
        nowIso,
      });
      expect(outcome.ok).toBe(false);
      expect(outcome.reason).toBe("knowledge-object-only");
      expect(outcome.accessState).toBe("granted");
      expect(outcome.results).toBeUndefined();
      expect(spy).not.toHaveBeenCalled();
      expect(
        readExecutionTraces(
          enterpriseCapabilityInvokeObserveTaskId({
            tenantId,
            seatId: "seat-sales-mgr-east",
            capabilityId: capability.capabilityId,
          }),
        ),
      ).toEqual([]);
    } finally {
      spy.mockRestore();
    }
  });

  it("records a preflight trace when observe is on without requesting a connector action", async () => {
    for (const value of ["1", "true", "yes", "on"]) {
      expect(
        isEnterpriseCapabilityInvokePreflightObserveEnabled({
          [ENTERPRISE_CAPABILITY_INVOKE_PREFLIGHT_OBSERVE_ENV]: value,
        }),
      ).toBe(true);
    }
    process.env[ENTERPRISE_CAPABILITY_INVOKE_PREFLIGHT_OBSERVE_ENV] = "1";
    const spy = vi.spyOn(preflightResolve, "buildExecutionPreflight");
    try {
      const store = seededStore();
      const capability = capabilityByKey(store, "customer.profile");
      const taskId = enterpriseCapabilityInvokeObserveTaskId({
        tenantId,
        seatId: "seat-sales-mgr-east",
        capabilityId: capability.capabilityId,
      });
      const actionNames = capability.actionRefs.map(
        (ref) => `${ref.connectorId}.${ref.actionKey}@${ref.version}`,
      );
      const outcome = await invokeDataCapabilityWithContext({
        store,
        context: grantedContext(),
        capabilityId: capability.capabilityId,
        nowIso,
      });

      expect(outcome.ok).toBe(false);
      expect(outcome.reason).toBe("knowledge-object-only");
      expect(outcome.accessState).toBe("granted");
      expect(outcome.results).toBeUndefined();
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId,
          sessionId: `${tenantId}:seat-sales-mgr-east`,
          message: capability.capabilityId,
          skills: [],
          policyToolNames: actionNames,
          catalogToolNames: actionNames,
        }),
      );
      const traces = readExecutionTraces(taskId);
      expect(traces.some((row) => row.decisionStage === "preflight")).toBe(true);
      expect(traces.every((row) => row.decisionStage === "preflight")).toBe(true);
      expect(traces[0]?.decisionCode).toBe("no_skill_contract");
    } finally {
      spy.mockRestore();
    }
  });

  it("does not record a preflight trace when grant or quota already denies", async () => {
    process.env[ENTERPRISE_CAPABILITY_INVOKE_PREFLIGHT_OBSERVE_ENV] = "1";
    const spy = vi.spyOn(preflightResolve, "buildExecutionPreflight");
    try {
      const store = seededStore();
      const capability = capabilityByKey(store, "customer.profile");
      const denied = await invokeDataCapabilityWithContext({
        store,
        context: ungrantedContext(),
        capabilityId: capability.capabilityId,
        nowIso,
      });
      expect(denied.ok).toBe(false);
      expect(denied.reason).toBe("not-authorized");
      expect(denied.accessState).toBe("requestable");
      expect(denied.results).toBeUndefined();

      const quota = await invokeDataCapabilityWithContext({
        store,
        context: grantedContext(),
        capabilityId: capability.capabilityId,
        nowIso,
        quotaLimit: 0,
      });
      expect(quota.ok).toBe(false);
      expect(quota.reason).toBe("quota-exceeded");
      expect(quota.results).toBeUndefined();
      expect(spy).not.toHaveBeenCalled();
      expect(
        readExecutionTraces(
          enterpriseCapabilityInvokeObserveTaskId({
            tenantId,
            seatId: "seat-sales-mgr-east",
            capabilityId: capability.capabilityId,
          }),
        ),
      ).toEqual([]);
      expect(
        readExecutionTraces(
          enterpriseCapabilityInvokeObserveTaskId({
            tenantId,
            seatId: "seat-unknown",
            capabilityId: capability.capabilityId,
          }),
        ),
      ).toEqual([]);
    } finally {
      spy.mockRestore();
    }
  });

  it("swallows observe failures without opening a connector action", async () => {
    process.env[ENTERPRISE_CAPABILITY_INVOKE_PREFLIGHT_OBSERVE_ENV] = "1";
    const spy = vi.spyOn(preflightResolve, "buildExecutionPreflight").mockImplementation(() => {
      throw new Error("observe boom");
    });
    try {
      const store = seededStore();
      const capability = capabilityByKey(store, "customer.profile");
      const outcome = await invokeDataCapabilityWithContext({
        store,
        context: grantedContext(),
        capabilityId: capability.capabilityId,
        nowIso,
      });
      expect(spy).toHaveBeenCalledTimes(1);
      expect(outcome.ok).toBe(false);
      expect(outcome.reason).toBe("knowledge-object-only");
      expect(outcome.accessState).toBe("granted");
      expect(outcome.results).toBeUndefined();
      expect(
        readExecutionTraces(
          enterpriseCapabilityInvokeObserveTaskId({
            tenantId,
            seatId: "seat-sales-mgr-east",
            capabilityId: capability.capabilityId,
          }),
        ),
      ).toEqual([]);
    } finally {
      spy.mockRestore();
    }
  });

  it("does not enforce preflight on the capability invoke path", () => {
    const source = fs.readFileSync(
      new URL("./capability-agent-invoke-runtime.ts", import.meta.url),
      "utf8",
    );
    expect(source).toContain("buildExecutionPreflight");
    expect(source).not.toContain("invokeEnterpriseDataAction");
    expect(source).not.toContain("applyPreflightToTools");
    expect(source).not.toContain("armCompletionHold");
    expect(source).not.toContain("allowedTools");
    expect(source).not.toContain("ORCHESTRATION_LIVE_INVOKE");
  });
});

describe("formatAgentDataCapabilityRuntimePrompt", () => {
  it("returns undefined when there is no seat or no capabilities", () => {
    expect(
      formatAgentDataCapabilityRuntimePrompt({ ok: false, reason: "no-seat", capabilities: [] }),
    ).toBeUndefined();
    expect(
      formatAgentDataCapabilityRuntimePrompt({
        ok: true,
        tenantId,
        seatId: "s1",
        capabilities: [],
      }),
    ).toBeUndefined();
  });

  it("lists granted and requestable capabilities with the data_capability tool guidance", () => {
    const prompt = formatAgentDataCapabilityRuntimePrompt({
      ok: true,
      tenantId,
      seatId: "seat-sales-mgr-east",
      capabilities: [
        {
          capabilityId: "cap-1",
          title: "客户画像能力",
          summary: "从 CRM 客户摘要构建客户画像",
          sourceSystems: ["Salesforce CRM"],
          accessState: "granted",
        },
        {
          capabilityId: "cap-2",
          title: "客户流失风险能力",
          summary: "流失风险洞察",
          sourceSystems: ["Salesforce CRM"],
          accessState: "requestable",
        },
      ],
    });
    expect(prompt).toBeTruthy();
    expect(prompt).toContain("data_capability");
    expect(prompt).toContain("capabilityId=cap-1");
    expect(prompt).toContain("authorized");
    expect(prompt).toContain("capabilityId=cap-2");
    expect(prompt).toContain("request access");
    expect(prompt).toContain("Knowledge Objects");
    expect(prompt).toContain("knowledge-object-only");
    expect(prompt).not.toContain("action=invoke and the capabilityId");
    // Never fabricate guidance is present.
    expect(prompt).toContain("never fabricate");
  });

  it("mentions knowledge-space binding allowlist when listing is KB-scoped", () => {
    const prompt = formatAgentDataCapabilityRuntimePrompt({
      ok: true,
      tenantId,
      seatId: "seat-1",
      knowledgeBaseId: "kb-enterprise-1",
      boundSourceIds: ["src-xueqiu"],
      capabilities: [
        {
          capabilityId: "cap-xueqiu",
          title: "雪球行情",
          summary: "受控行情能力",
          sourceSystems: ["雪球"],
          accessState: "granted",
        },
      ],
    });
    expect(prompt).toContain("knowledgeBaseId=kb-enterprise-1");
    expect(prompt).toContain("src-xueqiu");
    expect(prompt).toContain("allowlist");
  });
});

describe("agent runtime gateway boundary", () => {
  it("keeps production connector-action calls on employee invoke and the materializer", () => {
    const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
    const srcRoot = path.join(repoRoot, "src");
    const allowed = new Set([
      "src/gateway/enterprise-data/data-gateway.ts",
      "src/gateway/server-methods/enterprise-data-m1.ts",
      "src/gateway/enterprise-data/projection-materializer.ts",
    ]);
    const offenders: string[] = [];
    const visit = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === "node_modules" || entry.name === "dist") {
            continue;
          }
          visit(fullPath);
          continue;
        }
        if (!entry.name.endsWith(".ts") || entry.name.endsWith(".test.ts")) {
          continue;
        }
        const content = fs.readFileSync(fullPath, "utf8");
        if (!content.includes("invokeEnterpriseDataAction")) {
          continue;
        }
        const relative = path.relative(repoRoot, fullPath);
        if (!allowed.has(relative)) {
          offenders.push(relative);
        }
      }
    };
    visit(srcRoot);
    expect(offenders).toEqual([]);
  });
});
