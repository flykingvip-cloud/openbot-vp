import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CROSS_OPERATOR_STATE_DENIED,
  assertSessionStorePathReadable,
  deriveOperatorIdFromGatewayClient,
  getOperatorStateScope,
  isPathInsideRoot,
  normalizeOperatorId,
  resolveActiveOperatorId,
  resolveOperatorStateRoot,
  withOperatorStateScope,
} from "./operator-state-scope.js";
import { resolveDefaultSessionStorePath } from "./sessions/paths.js";
import { loadSessionStore } from "./sessions/store.js";

const ENV_KEYS = [
  "OPENBOT_OPERATOR_ID",
  "OPENCLAW_OPERATOR_ID",
  "OPENBOT_STATE_DIR",
  "OPENCLAW_STATE_DIR",
  "CLAWDBOT_STATE_DIR",
] as const;

describe("operator-state-scope", () => {
  const snapshot: Record<string, string | undefined> = {};

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (key in snapshot) {
        const value = snapshot[key];
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
        delete snapshot[key];
      } else if (process.env[key] !== undefined) {
        delete process.env[key];
      }
    }
  });

  function captureEnv(): void {
    for (const key of ENV_KEYS) {
      snapshot[key] = process.env[key];
    }
  }

  it("normalizes operator ids and treats empty as unset", () => {
    expect(normalizeOperatorId("")).toBeUndefined();
    expect(normalizeOperatorId("  ")).toBeUndefined();
    expect(normalizeOperatorId("Operator-A")).toBe("operator-a");
    expect(normalizeOperatorId("Op A!!")).toBe("op-a");
  });

  it("derives operator id from gateway client identity fields", () => {
    expect(
      deriveOperatorIdFromGatewayClient({
        platformUserId: "user-AAA",
        pairedDeviceId: "device-b",
      }),
    ).toBe("user-aaa");
    expect(
      deriveOperatorIdFromGatewayClient({
        pairedDeviceId: "Device-B",
        user: "ignored-when-device-present",
      }),
    ).toBe("device-b");
    expect(deriveOperatorIdFromGatewayClient({ user: "ops@corp.example" })).toBe(
      "ops-corp.example",
    );
    expect(deriveOperatorIdFromGatewayClient({ connect: { user: "cli-user" } })).toBe("cli-user");
    expect(deriveOperatorIdFromGatewayClient({})).toBeUndefined();
    expect(deriveOperatorIdFromGatewayClient(null)).toBeUndefined();
  });

  it("uses legacy STATE_DIR when operator id is unset", () => {
    captureEnv();
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-op-scope-"));
    process.env.OPENBOT_STATE_DIR = stateDir;
    delete process.env.OPENBOT_OPERATOR_ID;
    delete process.env.OPENCLAW_OPERATOR_ID;
    expect(resolveActiveOperatorId()).toBeUndefined();
    expect(resolveOperatorStateRoot()).toBe(path.resolve(stateDir));
    fs.rmSync(stateDir, { recursive: true, force: true });
  });

  it("request ALS scope beats env and isolates two operators without env", () => {
    captureEnv();
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-op-scope-"));
    process.env.OPENBOT_STATE_DIR = stateDir;
    delete process.env.OPENBOT_OPERATOR_ID;
    delete process.env.OPENCLAW_OPERATOR_ID;

    const foreign = path.join(
      stateDir,
      "operators",
      "operator-b",
      "agents",
      "main",
      "sessions",
      "sessions.json",
    );
    fs.mkdirSync(path.dirname(foreign), { recursive: true });
    fs.writeFileSync(foreign, JSON.stringify({ marker: "operator-b-session-marker" }), "utf8");

    withOperatorStateScope("operator-a", () => {
      expect(getOperatorStateScope()?.source).toBe("request");
      expect(resolveActiveOperatorId()).toBe("operator-a");
      expect(resolveOperatorStateRoot()).toBe(
        path.join(path.resolve(stateDir), "operators", "operator-a"),
      );
      expect(() => loadSessionStore(foreign, { skipCache: true })).toThrow(
        CROSS_OPERATOR_STATE_DENIED,
      );
      const own = resolveDefaultSessionStorePath("main");
      expect(own).toContain(`${path.sep}operators${path.sep}operator-a${path.sep}`);
      fs.mkdirSync(path.dirname(own), { recursive: true });
      fs.writeFileSync(own, JSON.stringify({ marker: "operator-a-own" }), "utf8");
      expect(JSON.stringify(loadSessionStore(own, { skipCache: true }))).toContain(
        "operator-a-own",
      );
    });

    // Outside ALS, and without env, foreign path is readable again (legacy unscoped).
    expect(resolveActiveOperatorId()).toBeUndefined();
    expect(JSON.stringify(loadSessionStore(foreign, { skipCache: true }))).toContain(
      "operator-b-session-marker",
    );

    fs.rmSync(stateDir, { recursive: true, force: true });
  });

  it("env remains a test/dev override when ALS is inactive", () => {
    captureEnv();
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-op-scope-"));
    process.env.OPENBOT_STATE_DIR = stateDir;
    process.env.OPENBOT_OPERATOR_ID = "operator-a";
    expect(resolveActiveOperatorId()).toBe("operator-a");
    expect(resolveOperatorStateRoot()).toBe(
      path.join(path.resolve(stateDir), "operators", "operator-a"),
    );
    fs.rmSync(stateDir, { recursive: true, force: true });
  });

  it("isPathInsideRoot rejects sibling operator roots", () => {
    const root = "/tmp/state/operators/operator-a";
    expect(
      isPathInsideRoot("/tmp/state/operators/operator-a/agents/main/sessions.json", root),
    ).toBe(true);
    expect(
      isPathInsideRoot("/tmp/state/operators/operator-b/agents/main/sessions.json", root),
    ).toBe(false);
    expect(isPathInsideRoot("/tmp/state/agents/operator-b/sessions/sessions.json", root)).toBe(
      false,
    );
  });

  it("assertSessionStorePathReadable fails closed for foreign paths when scoped", () => {
    captureEnv();
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-op-scope-"));
    process.env.OPENBOT_STATE_DIR = stateDir;
    delete process.env.OPENBOT_OPERATOR_ID;
    const own = path.join(stateDir, "operators", "operator-a", "agents", "main", "sessions.json");
    const foreign = path.join(
      stateDir,
      "operators",
      "operator-b",
      "agents",
      "main",
      "sessions.json",
    );
    withOperatorStateScope("operator-a", () => {
      expect(() => assertSessionStorePathReadable(own)).not.toThrow();
      expect(() => assertSessionStorePathReadable(foreign)).toThrow(/CROSS_OPERATOR_STATE_DENIED/);
    });
    fs.rmSync(stateDir, { recursive: true, force: true });
  });
});
