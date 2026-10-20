import { afterEach, describe, expect, it } from "vitest";
import {
  CONVERSATION_PRODUCTION_DEFAULTS,
  evaluateConversationRollout,
  resolveConversationFlags,
  tenantRolloutBucket,
} from "./flags.js";

describe("conversation flags + rollout", () => {
  const envKeys = [
    "OPENBOT_CONVERSATION_ROLLOUT_TENANT_IDS",
    "OPENBOT_CONVERSATION_ROLLOUT_TENANT_BLOCKLIST",
    "OPENBOT_CONVERSATION_ROLLOUT_PRINCIPAL_IDS",
    "OPENBOT_CONVERSATION_ROLLOUT_SEAT_IDS",
    "OPENBOT_CONVERSATION_ROLLOUT_PERCENT",
    "OPENBOT_CONVERSATION_SEMANTIC_SEARCH",
    "OPENBOT_CONVERSATION_RETENTION_ENFORCE",
    "OPENBOT_CONVERSATION_PROJECTION",
    "OPENBOT_CONVERSATION_CONTEXT_PLANNER",
    "OPENBOT_CONVERSATION_HISTORY_CURSOR",
  ];
  const prev: Record<string, string | undefined> = {};

  afterEach(() => {
    for (const key of envKeys) {
      if (prev[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = prev[key];
      }
      delete prev[key];
    }
  });

  function stashEnv() {
    for (const key of envKeys) {
      prev[key] = process.env[key];
      delete process.env[key];
    }
  }

  it("defaults: catalog on, ui/enforce/semantic off", () => {
    stashEnv();
    const flags = resolveConversationFlags(undefined);
    expect(flags.catalogEnabled).toBe(true);
    expect(flags.uiEnabled).toBe(false);
    expect(flags.retentionEnforceEnabled).toBe(false);
    expect(flags.searchSemanticEnabled).toBe(false);
    expect(flags.rolloutActive).toBe(true);
  });

  it("tenant allowlist gates product surface", () => {
    stashEnv();
    const cfg = {
      conversation: {
        ui: { enabled: true },
        search: { semanticEnabled: true },
        retention: { enforceEnabled: true },
        rollout: { tenantAllowlist: ["pilot-a"] },
      },
    };
    const inPilot = resolveConversationFlags(cfg as never, { tenantId: "pilot-a" });
    expect(inPilot.rolloutActive).toBe(true);
    expect(inPilot.uiEnabled).toBe(true);
    expect(inPilot.searchSemanticEnabled).toBe(true);
    expect(inPilot.retentionEnforceEnabled).toBe(true);

    const out = resolveConversationFlags(cfg as never, { tenantId: "other" });
    expect(out.rolloutActive).toBe(false);
    expect(out.uiEnabled).toBe(false);
    expect(out.searchSemanticEnabled).toBe(false);
    expect(out.retentionEnforceEnabled).toBe(false);
    // Catalog remains for compatibility mapping
    expect(out.catalogEnabled).toBe(true);
  });

  it("tenant blocklist always excludes", () => {
    stashEnv();
    const r = evaluateConversationRollout({
      rollout: { tenantBlocklist: ["blocked"] },
      subject: { tenantId: "blocked" },
    });
    expect(r.active).toBe(false);
    expect(r.reason).toBe("tenant_blocklist");
  });

  it("tenant percent is stable per tenant", () => {
    stashEnv();
    const a = tenantRolloutBucket("tenant-stable-1");
    const b = tenantRolloutBucket("tenant-stable-1");
    expect(a).toBe(b);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(100);

    const r0 = evaluateConversationRollout({
      rollout: { tenantPercent: 0 },
      subject: { tenantId: "any" },
    });
    expect(r0.active).toBe(false);

    const r100 = evaluateConversationRollout({
      rollout: { tenantPercent: 100 },
      subject: { tenantId: "any" },
    });
    expect(r100.active).toBe(true);
  });

  it("env OPENBOT_CONVERSATION_ROLLOUT_TENANT_IDS works", () => {
    stashEnv();
    process.env.OPENBOT_CONVERSATION_ROLLOUT_TENANT_IDS = "t1,t2";
    const ok = resolveConversationFlags({ conversation: { ui: { enabled: true } } } as never, {
      tenantId: "t1",
    });
    expect(ok.rolloutActive).toBe(true);
    expect(ok.uiEnabled).toBe(true);
    const no = resolveConversationFlags({ conversation: { ui: { enabled: true } } } as never, {
      tenantId: "t9",
    });
    expect(no.rolloutActive).toBe(false);
    expect(no.uiEnabled).toBe(false);
  });

  it("production defaults keep enforce and ui off", () => {
    expect(CONVERSATION_PRODUCTION_DEFAULTS.ui?.enabled).toBe(false);
    expect(CONVERSATION_PRODUCTION_DEFAULTS.retention?.enforceEnabled).toBe(false);
    expect(CONVERSATION_PRODUCTION_DEFAULTS.rollout?.tenantPercent).toBe(0);
  });
});
