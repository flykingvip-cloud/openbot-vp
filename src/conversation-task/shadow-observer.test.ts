import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ConversationTaskConfigStore, TenantAllowlistCache } from "./config-store.js";
import { ConversationTaskFlagCache } from "./flag-cache.js";
import {
  createShadowRuntime,
  ShadowObserver,
  type ShadowMetricEvent,
  type ShadowServerContext,
  type ShadowTurn,
} from "./shadow-observer.js";
import type { TenantHmacKey } from "./shadow.js";

const KEY: TenantHmacKey = { keyId: "k1", secret: "secret-one", issuedAtMs: 0 };
const NOW = () => 1_000;

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "ct-observer-"));
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function makeRuntime(opts: { detection?: boolean; allow?: string[] } = {}) {
  const store = new ConversationTaskConfigStore({ storeRoot: root, now: NOW });
  if (opts.detection ?? true) {
    store.setFlag("detection", true, "ops", "canary");
  }
  for (const t of opts.allow ?? ["t-int"]) {
    store.setTenantAllow({ tenantId: t, enabled: true, actor: "ops", reason: "internal" });
  }
  const flagCache = new ConversationTaskFlagCache({ reader: store.flagReader(), now: NOW });
  const allowCache = new TenantAllowlistCache({ reader: store.allowReader(), now: NOW });
  const metrics: ShadowMetricEvent[] = [];
  const rt = createShadowRuntime({
    isDetectionEnabled: () => flagCache.isEnabled("detection"),
    isTenantAllowed: (t) => allowCache.isAllowed(t),
    keyProvider: () => KEY,
    storeRoot: root,
    now: NOW,
    onMetric: (e) => metrics.push(e),
  });
  return { store, rt, metrics };
}

function ctx(over: Partial<ShadowServerContext> = {}): ShadowServerContext {
  return {
    tenantId: "t-int",
    requesterId: "user-1",
    conversationId: "conv-1",
    authorizedConversationIds: new Set(["conv-1"]),
    employeeScopeAllowed: true,
    ...over,
  };
}

function turn(over: Partial<ShadowTurn> = {}): ShadowTurn {
  return { messageId: "msg-1", text: "帮我把季度报告发给全部销售", ...over };
}

describe("ShadowObserver — fail-closed gating (AC2)", () => {
  it("skips when there is no trusted tenant (channel inbound without a resolved tenant)", async () => {
    const { rt } = makeRuntime();
    expect(rt.observer.observe(ctx({ tenantId: null }), turn())).toBe("skipped_no_trusted_tenant");
    await rt.shutdown(500);
  });

  it("skips when the tenant is not allow-listed", async () => {
    const { rt } = makeRuntime({ allow: [] });
    expect(rt.observer.observe(ctx(), turn())).toBe("skipped_not_allowlisted");
    await rt.shutdown(500);
  });

  it("skips (zero behavior) when the detection flag is OFF", async () => {
    const { rt } = makeRuntime({ detection: false });
    expect(rt.observer.observe(ctx(), turn())).toBe("skipped_flag_off");
    await rt.shutdown(500);
  });

  it("rejects an unauthorized conversation (ACL fail-closed)", async () => {
    const { rt } = makeRuntime();
    expect(rt.observer.observe(ctx({ authorizedConversationIds: new Set() }), turn())).toBe(
      "skipped_scope_rejected",
    );
    await rt.shutdown(500);
  });
});

describe("ShadowObserver — observed path writes exactly one shadow log (AC2/AC4)", () => {
  it("writes a shadow log for an allow-listed, in-scope turn; idempotent on repeat", async () => {
    const { rt, metrics } = makeRuntime();
    expect(rt.observer.observe(ctx(), turn())).toBe("observed");
    expect(rt.observer.observe(ctx(), turn())).toBe("observed"); // duplicate delivery
    await rt.runner.shutdown(2_000);
    const book = rt.registry.book("t-int");
    expect(book.size()).toBe(1); // composite UNIQUE => one row
    const writes = metrics.filter((m) => m.type === "write");
    expect(writes).toContainEqual({ type: "write", outcome: "inserted" });
    expect(writes).toContainEqual({ type: "write", outcome: "duplicate" });
    await rt.shutdown();
  });

  it("persists no plaintext ids or raw text on disk (AC3/AC4)", async () => {
    const { rt } = makeRuntime();
    rt.observer.observe(
      ctx({ conversationId: "conv-SECRET", authorizedConversationIds: new Set(["conv-SECRET"]) }),
      turn({ messageId: "msg-SECRET", text: "机密文本SECRET" }),
    );
    await rt.runner.shutdown(2_000);
    await rt.shutdown();
    // Walk the store root and assert no secret bytes landed anywhere.
    const walk = (dir: string): string[] =>
      fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const p = path.join(dir, e.name);
        return e.isDirectory() ? walk(p) : [p];
      });
    for (const file of walk(root)) {
      const bytes = fs.readFileSync(file);
      expect(bytes.includes(Buffer.from("conv-SECRET"))).toBe(false);
      expect(bytes.includes(Buffer.from("msg-SECRET"))).toBe(false);
      expect(bytes.includes(Buffer.from("机密文本SECRET"))).toBe(false);
      expect(bytes.includes(Buffer.from("fp_"))).toBe(false); // no unkeyed fingerprint
    }
  });
});

describe("ShadowObserver — never throws into the caller (AC2, failure isolation)", () => {
  it("returns 'error' (not throw) if submit throws", () => {
    const observer = new ShadowObserver({
      isDetectionEnabled: () => true,
      isTenantAllowed: () => true,
      submitShadow: () => {
        throw new Error("runner exploded");
      },
    });
    expect(observer.observe(ctx(), turn())).toBe("error");
  });

  it("a failing write is captured by the runner (chat path unaffected)", async () => {
    // Key provider throws (missing key) => append throws => runner failure, observe still 'observed'.
    const store = new ConversationTaskConfigStore({ storeRoot: root, now: NOW });
    store.setFlag("detection", true, "ops", "x");
    store.setTenantAllow({ tenantId: "t-int", enabled: true, actor: "ops", reason: "x" });
    const flagCache = new ConversationTaskFlagCache({ reader: store.flagReader(), now: NOW });
    const allowCache = new TenantAllowlistCache({ reader: store.allowReader(), now: NOW });
    const metrics: ShadowMetricEvent[] = [];
    const rt = createShadowRuntime({
      isDetectionEnabled: () => flagCache.isEnabled("detection"),
      isTenantAllowed: (t) => allowCache.isAllowed(t),
      keyProvider: () => {
        throw new Error("no key");
      },
      storeRoot: root,
      now: NOW,
      onMetric: (e) => metrics.push(e),
    });
    expect(rt.observer.observe(ctx(), turn())).toBe("observed"); // enqueued; write fails async
    await rt.runner.shutdown(2_000);
    expect(metrics.some((m) => m.type === "runner" && m.event.type === "failure")).toBe(true);
    await rt.shutdown();
  });
});
