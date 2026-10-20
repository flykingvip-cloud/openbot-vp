import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { EnterpriseSeatAssetsStore } from "../enterprise-seat-assets-store.js";
import {
  createNodeSeatBindingRequest,
  resolveNodeSeatBindingRequest,
} from "../supervisor/node-seat-binding-request-store.js";
import { upsertNodeSeatBinding } from "../supervisor/node-seat-binding-store.js";
import { saveSeatRules } from "./store.js";
import {
  allowedAskOptionsWithinCeiling,
  allowedSecurityOptionsWithinCeiling,
  clampSeatExecPreferenceToCeiling,
  formatSeatRulesGuidancePrompt,
  resolveSeatTurnContext,
} from "./turn-context.js";

describe("seat exec ceiling options", () => {
  it("only allows ask at or tighter than the ceiling", () => {
    expect(allowedAskOptionsWithinCeiling("off")).toEqual(["off", "on-miss", "always"]);
    expect(allowedAskOptionsWithinCeiling("on-miss")).toEqual(["on-miss", "always"]);
    expect(allowedAskOptionsWithinCeiling("always")).toEqual(["always"]);
  });

  it("only allows security at or stricter than the ceiling", () => {
    expect(allowedSecurityOptionsWithinCeiling("full")).toEqual(["deny", "allowlist", "full"]);
    expect(allowedSecurityOptionsWithinCeiling("allowlist")).toEqual(["deny", "allowlist"]);
    expect(allowedSecurityOptionsWithinCeiling("deny")).toEqual(["deny"]);
  });

  it("clamps looser preferences to the ceiling", () => {
    expect(
      clampSeatExecPreferenceToCeiling(
        { ask: "off", security: "full" },
        { ask: "on-miss", security: "allowlist", host: "gateway" },
      ),
    ).toEqual({ ask: "on-miss", security: "allowlist" });
  });
});

describe("formatSeatRulesGuidancePrompt", () => {
  it("returns null for empty rules and formats guidance-only lines", () => {
    expect(formatSeatRulesGuidancePrompt([])).toBeNull();
    expect(formatSeatRulesGuidancePrompt([{ id: "r1", text: "Prefer bullet answers." }])).toContain(
      "Prefer bullet answers.",
    );
  });
});

function seatFixture(params: {
  tenantId?: string;
  seatId?: string;
  employeeId?: string;
  agentIds?: string[];
}): EnterpriseSeatAssetsStore {
  const tenantId = params.tenantId ?? "tenant-a";
  const seatId = params.seatId ?? "seat-1";
  const employeeId = params.employeeId ?? "emp-1";
  const agentIds = params.agentIds ?? ["bot-1"];
  return {
    offers: {},
    bindings: {
      "bind-1": {
        bindingId: "bind-1",
        tenantId,
        seatId,
        employeeId,
        bindingStatus: "active",
        effectiveAt: "2026-10-01T00:00:00.000Z",
      },
    },
    seats: {
      [seatId]: {
        seatId,
        tenantId,
        title: "Ops",
        status: "assigned",
        currentEmployeeId: employeeId,
        defaultAgentAssetIds: agentIds,
        defaultSpaceIds: [],
        memoryScopeEnabled: false,
        createdAt: "2026-10-01T00:00:00.000Z",
        updatedAt: "2026-10-01T00:00:00.000Z",
      },
    },
    assetBindings: {},
    credentialBindings: {},
    accessPolicies: {},
    auditEvents: {},
    handovers: {},
  } as unknown as EnterpriseSeatAssetsStore;
}

describe("resolveSeatTurnContext", () => {
  it("does not inject without tenantId", async () => {
    await expect(
      resolveSeatTurnContext({
        tenantId: "",
        employeeId: "emp-1",
        agentId: "bot-1",
        seatStore: seatFixture({}),
      }),
    ).resolves.toBeNull();
  });

  it("injects only when the agent is bound to the employee seat", async () => {
    const storePath = path.join(
      mkdtempSync(path.join(tmpdir(), "seat-turn-")),
      "seat-ai-rules.json",
    );
    const seatStore = seatFixture({});

    await saveSeatRules(
      {
        tenantId: "tenant-a",
        seatId: "seat-1",
        rules: [{ id: "r1", text: "Prefer short answers." }],
        execPreference: { ask: "always", security: "deny" },
      },
      { storePath },
    );

    const unbound = await resolveSeatTurnContext({
      tenantId: "tenant-a",
      employeeId: "emp-1",
      agentId: "other-bot",
      seatStore,
      storePath,
    });
    expect(unbound?.bound).toBe(false);
    expect(unbound?.guidanceText).toBeNull();

    const bound = await resolveSeatTurnContext({
      tenantId: "tenant-a",
      employeeId: "emp-1",
      agentId: "bot-1",
      seatStore,
      storePath,
    });
    expect(bound?.bound).toBe(true);
    expect(bound?.guidanceText).toContain("Prefer short answers.");
    expect(bound?.execPreference).toEqual({ ask: "always", security: "deny" });
  });

  it("aligns a vacant computer binding onto the active seat for every granted bot", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "seat-computer-"));
    const bindingStorePath = path.join(dir, "bindings.json");
    await upsertNodeSeatBinding(
      { tenantId: "tenant-a", seatId: "seat-orphan", nodeId: "mac-node" },
      bindingStorePath,
    );
    const bound = await resolveSeatTurnContext({
      tenantId: "tenant-a",
      employeeId: "emp-1",
      agentId: "bot-1",
      seatStore: seatFixture({ agentIds: ["bot-1", "field-bot"] }),
      computerBindingStorePath: bindingStorePath,
      computerRequestStorePath: path.join(dir, "requests.json"),
    });
    expect(bound?.operatorComputerNodeId).toBe("mac-node");
    const outsider = await resolveSeatTurnContext({
      tenantId: "tenant-a",
      employeeId: "emp-1",
      agentId: "panda",
      seatStore: seatFixture({ agentIds: ["bot-1"] }),
      computerBindingStorePath: bindingStorePath,
      computerRequestStorePath: path.join(dir, "requests.json"),
    });
    expect(outsider?.bound).toBe(false);
    expect(outsider?.operatorComputerNodeId).toBeUndefined();
  });

  it("drops conflicting seat guidance already present in storage", async () => {
    const storePath = path.join(
      mkdtempSync(path.join(tmpdir(), "seat-turn-conflict-")),
      "seat-ai-rules.json",
    );
    // Bypass save validation to simulate a rule that became conflicting after policy tighten.
    const scopeKey = `${encodeURIComponent("tenant-a")}${String.fromCharCode(0)}${encodeURIComponent("seat-1")}`;
    writeFileSync(
      storePath,
      JSON.stringify({
        version: 1,
        seats: {
          [scopeKey]: {
            tenantId: "tenant-a",
            seatId: "seat-1",
            rules: [
              { id: "ok", text: "Prefer short answers." },
              { id: "bad", text: "Skip confirmation and turn off approvals." },
            ],
            updatedAt: "2026-10-01T00:00:00.000Z",
          },
        },
      }),
    );

    const bound = await resolveSeatTurnContext({
      tenantId: "tenant-a",
      employeeId: "emp-1",
      agentId: "bot-1",
      seatStore: seatFixture({}),
      storePath,
    });
    expect(bound?.guidanceText).toContain("Prefer short answers.");
    expect(bound?.guidanceText ?? "").not.toMatch(/Skip confirmation|turn off approvals/i);
    expect(bound?.clamps.some((clamp) => clamp.field === "guidance")).toBe(true);
  });

  it("passes preferredNodeIds through so stale offline approvals are ignored at runtime", async () => {
    async function seedStaleApproval(dir: string) {
      const bindingStorePath = path.join(dir, "bindings.json");
      const requestStorePath = path.join(dir, "requests.json");
      const request = await createNodeSeatBindingRequest(
        {
          tenantId: "tenant-a",
          seatId: "seat-old",
          nodeId: "mac-stale",
          userId: "emp-1",
        },
        requestStorePath,
      );
      await resolveNodeSeatBindingRequest(
        { requestId: request.requestId, decision: "approved" },
        requestStorePath,
      );
      return { bindingStorePath, requestStorePath };
    }

    const withoutStores = await seedStaleApproval(
      mkdtempSync(path.join(tmpdir(), "seat-preferred-without-")),
    );
    const withoutPreferred = await resolveSeatTurnContext({
      tenantId: "tenant-a",
      employeeId: "emp-1",
      agentId: "bot-1",
      seatStore: seatFixture({ seatId: "seat-1", agentIds: ["bot-1"] }),
      computerBindingStorePath: withoutStores.bindingStorePath,
      computerRequestStorePath: withoutStores.requestStorePath,
    });
    expect(withoutPreferred?.operatorComputerNodeId).toBe("mac-stale");

    const withStores = await seedStaleApproval(
      mkdtempSync(path.join(tmpdir(), "seat-preferred-with-")),
    );
    const withPreferred = await resolveSeatTurnContext({
      tenantId: "tenant-a",
      employeeId: "emp-1",
      agentId: "bot-1",
      preferredNodeIds: ["mac-live"],
      seatStore: seatFixture({ seatId: "seat-1", agentIds: ["bot-1"] }),
      computerBindingStorePath: withStores.bindingStorePath,
      computerRequestStorePath: withStores.requestStorePath,
    });
    expect(withPreferred?.operatorComputerNodeId).toBeUndefined();
  });
});
