/**
 * Stage 1 evidence fixture for AUTH-01, AUTH-03, and cross-operator
 * store / plugin stateDir isolation (both security profiles).
 */
import { randomUUID } from "node:crypto";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, describe, expect, test } from "vitest";
import {
  CROSS_OPERATOR_STATE_DENIED,
  deriveOperatorIdFromGatewayClient,
  withOperatorStateScope,
} from "../../src/config/operator-state-scope.js";
import { STATE_DIR } from "../../src/config/paths.js";
import { loadSessionStore, resolveDefaultSessionStorePath } from "../../src/config/sessions.js";
import { assertSecurityProfileAllowsStartup } from "../../src/gateway/security-profile.js";
import { validateSecurityProfileStartup } from "../../src/gateway/security-profile/validate-startup.js";
import { resolveGatewayRuntimeConfig } from "../../src/gateway/server-runtime-config.js";
import {
  connectReq,
  createGatewaySuiteHarness,
  installGatewayTestHooks,
  testState,
} from "../../src/gateway/test-helpers.js";
import { loadOrCreateDeviceIdentity } from "../../src/infra/device-identity.js";
import { listDevicePairing } from "../../src/infra/device-pairing.js";
import { createEmptyPluginRegistry } from "../../src/plugins/registry.js";
import { startPluginServices } from "../../src/plugins/services.js";
import { GATEWAY_CLIENT_MODES, GATEWAY_CLIENT_NAMES } from "../../src/utils/message-channel.js";

installGatewayTestHooks({ scope: "suite" });

const PROFILES = ["personal_local", "managed_enterprise"] as const;
type ProfileName = (typeof PROFILES)[number];

const TOKEN = "stage1-evidence-token";
const PASSWORD = "stage1-evidence-password";
const MARKER = "operator-b-session-marker";

const LOCAL_CLI = {
  id: GATEWAY_CLIENT_NAMES.CLI,
  version: "1.0.0",
  platform: "test",
  mode: GATEWAY_CLIENT_MODES.CLI,
};

const CONTROL_UI = {
  id: GATEWAY_CLIENT_NAMES.CONTROL_UI,
  version: "1.0.0",
  platform: "test",
  mode: GATEWAY_CLIENT_MODES.UI,
};

let tenantsRoot = "";

function applyProfile(profile: ProfileName): void {
  process.env.OPENBOT_SECURITY_PROFILE = profile;
  delete process.env.OPENCLAW_SECURITY_PROFILE;
  delete process.env.OPENBOT_DATA_MODE;
  delete process.env.OPENCLAW_DATA_MODE;
  delete process.env.OPENBOT_MULTITENANT;
  delete process.env.OPENCLAW_MULTITENANT;
  delete process.env.OPENBOT_PLUGIN_TENANT_ACCESS;
  if (profile === "managed_enterprise") {
    process.env.OPENBOT_TENANT_EXECUTION_BOUNDARY = "dedicated";
    process.env.OPENBOT_TENANTS_ROOT = tenantsRoot;
  } else {
    delete process.env.OPENBOT_TENANT_EXECUTION_BOUNDARY;
    delete process.env.OPENBOT_TENANTS_ROOT;
  }
}

function assertProfileStartupOk(profile: ProfileName): void {
  applyProfile(profile);
  const cfg = {};
  const fileGate = assertSecurityProfileAllowsStartup(cfg, process.env);
  expect(fileGate.ok).toBe(true);
  expect(fileGate.profile).toBe(profile);
  const directoryGate = validateSecurityProfileStartup({ cfg, env: process.env });
  expect(directoryGate.profile.kind).toBe(
    profile === "managed_enterprise" ? "ManagedEnterprise" : "PersonalLocal",
  );
}

async function postToolsInvoke(port: number, authorization?: string): Promise<number> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (authorization) {
    headers.authorization = authorization;
  }
  const response = await fetch(`http://127.0.0.1:${port}/tools/invoke`, {
    method: "POST",
    headers,
    body: "{}",
  });
  return response.status;
}

describe("stage 1 auth and plugin evidence", () => {
  afterAll(async () => {
    if (tenantsRoot) {
      await fs.rm(tenantsRoot, { recursive: true, force: true });
    }
  });

  afterEach(() => {
    delete process.env.OPENBOT_SECURITY_PROFILE;
    delete process.env.OPENBOT_TENANT_EXECUTION_BOUNDARY;
    delete process.env.OPENBOT_TENANTS_ROOT;
    delete process.env.OPENBOT_OPERATOR_ID;
    delete process.env.OPENCLAW_OPERATOR_ID;
    delete process.env.OPENCLAW_GATEWAY_TOKEN;
    delete process.env.OPENCLAW_GATEWAY_PASSWORD;
  });

  test("prepares a tenants root outside the gateway state dir", async () => {
    tenantsRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-stage1-tenants-"));
    expect(tenantsRoot).not.toContain(STATE_DIR);
  });

  for (const profile of PROFILES) {
    test(`${profile}: missing and wrong token stay out of hello-ok; tools invoke returns 401`, async () => {
      assertProfileStartupOk(profile);
      testState.gatewayAuth = { mode: "token", token: TOKEN };
      process.env.OPENCLAW_GATEWAY_TOKEN = TOKEN;
      const harness = await createGatewaySuiteHarness();
      try {
        const missingWs = await harness.openWs({
          origin: `http://127.0.0.1:${harness.port}`,
        });
        try {
          const missing = await connectReq(missingWs, {
            skipDefaultAuth: true,
            client: CONTROL_UI,
          });
          expect(missing.ok).toBe(false);
          expect(missing.payload?.type).not.toBe("hello-ok");
          expect(missing.error?.message ?? "").toMatch(
            /Control UI settings|gateway token missing/i,
          );
        } finally {
          missingWs.close();
        }

        const wrongWs = await harness.openWs();
        try {
          const wrong = await connectReq(wrongWs, {
            token: "wrong-token",
            client: LOCAL_CLI,
          });
          expect(wrong.ok).toBe(false);
          expect(wrong.payload?.type).not.toBe("hello-ok");
          expect(wrong.error?.message ?? "").toContain("gateway token mismatch");
        } finally {
          wrongWs.close();
        }

        expect(await postToolsInvoke(harness.port)).toBe(401);
        expect(await postToolsInvoke(harness.port, "Bearer wrong-token")).toBe(401);
        expect(await postToolsInvoke(harness.port, `Bearer ${TOKEN}`)).not.toBe(401);
      } finally {
        await harness.close();
      }
    });

    test(`${profile}: wrong password stays out of hello-ok`, async () => {
      assertProfileStartupOk(profile);
      testState.gatewayAuth = { mode: "password", password: PASSWORD };
      delete process.env.OPENCLAW_GATEWAY_TOKEN;
      const harness = await createGatewaySuiteHarness();
      try {
        const ws = await harness.openWs();
        try {
          const res = await connectReq(ws, {
            password: "wrong-password",
            skipDefaultAuth: true,
            device: null,
            client: LOCAL_CLI,
          });
          expect(res.ok).toBe(false);
          expect(res.payload?.type).not.toBe("hello-ok");
          expect(res.error?.message ?? "").toContain("unauthorized");
        } finally {
          ws.close();
        }
      } finally {
        await harness.close();
      }
    });

    test(`${profile}: mode=none allows loopback hello-ok and refuses a non-loopback bind`, async () => {
      assertProfileStartupOk(profile);
      await expect(
        resolveGatewayRuntimeConfig({
          cfg: { gateway: { bind: "lan", auth: { mode: "none" } } },
          port: 18789,
        }),
      ).rejects.toThrow(/refusing to bind gateway/);

      testState.gatewayAuth = { mode: "none" };
      delete process.env.OPENCLAW_GATEWAY_TOKEN;
      const harness = await createGatewaySuiteHarness();
      try {
        const ws = await harness.openWs();
        try {
          const res = await connectReq(ws, {
            skipDefaultAuth: true,
            client: LOCAL_CLI,
          });
          expect(res.ok, res.error?.message ?? "mode=none connect failed").toBe(true);
          expect(res.payload?.type).toBe("hello-ok");
        } finally {
          ws.close();
        }
      } finally {
        await harness.close();
      }
    });

    test(`${profile}: local silent auto-approve reaches hello-ok`, async () => {
      assertProfileStartupOk(profile);
      testState.gatewayAuth = { mode: "token", token: TOKEN };
      process.env.OPENCLAW_GATEWAY_TOKEN = TOKEN;
      const identityPath = path.join(
        os.tmpdir(),
        `openbot-stage1-device-${profile}-${randomUUID()}.json`,
      );
      const harness = await createGatewaySuiteHarness();
      try {
        const ws = await harness.openWs();
        try {
          const res = await connectReq(ws, {
            token: TOKEN,
            client: LOCAL_CLI,
            deviceIdentityPath: identityPath,
          });
          expect(res.ok).toBe(true);
          expect(res.payload?.type).toBe("hello-ok");
          const identity = loadOrCreateDeviceIdentity(identityPath);
          const pairing = await listDevicePairing();
          const pending = pairing.pending.find((entry) => entry.deviceId === identity.deviceId);
          const paired = pairing.paired.find((entry) => entry.deviceId === identity.deviceId);
          expect(pending).toBeUndefined();
          expect(paired?.tokens?.operator?.token).toEqual(expect.any(String));
        } finally {
          ws.close();
        }
      } finally {
        await harness.close();
        await fs.rm(identityPath, { force: true });
      }
    });
  }

  for (const profile of PROFILES) {
    test(`${profile}: wired client identity scopes stores without OPENBOT_OPERATOR_ID`, async () => {
      assertProfileStartupOk(profile);
      delete process.env.OPENBOT_OPERATOR_ID;
      delete process.env.OPENCLAW_OPERATOR_ID;

      const operatorId = deriveOperatorIdFromGatewayClient({
        platformUserId: "operator-a",
        pairedDeviceId: "device-should-not-win",
      });
      expect(operatorId).toBe("operator-a");

      await withOperatorStateScope(operatorId!, async () => {
        const ownStorePath = resolveDefaultSessionStorePath("main");
        expect(ownStorePath).toContain(`${path.sep}operators${path.sep}operator-a${path.sep}`);

        const foreignOperatorStore = path.join(
          STATE_DIR,
          "operators",
          "operator-b",
          "agents",
          "main",
          "sessions",
          "sessions.json",
        );
        const legacySharedStore = path.join(
          STATE_DIR,
          "agents",
          "operator-b",
          "sessions",
          "sessions.json",
        );
        await fs.mkdir(path.dirname(foreignOperatorStore), { recursive: true });
        await fs.mkdir(path.dirname(legacySharedStore), { recursive: true });
        await fs.mkdir(path.dirname(ownStorePath), { recursive: true });
        await fs.writeFile(foreignOperatorStore, JSON.stringify({ marker: MARKER }), "utf8");
        await fs.writeFile(legacySharedStore, JSON.stringify({ marker: MARKER }), "utf8");
        await fs.writeFile(ownStorePath, JSON.stringify({ marker: "operator-a-own" }), "utf8");

        expect(() => loadSessionStore(foreignOperatorStore, { skipCache: true })).toThrow(
          CROSS_OPERATOR_STATE_DENIED,
        );
        expect(() => loadSessionStore(legacySharedStore, { skipCache: true })).toThrow(
          CROSS_OPERATOR_STATE_DENIED,
        );

        const own = loadSessionStore(ownStorePath, { skipCache: true });
        expect(JSON.stringify(own)).toContain("operator-a-own");
        expect(JSON.stringify(own)).not.toContain(MARKER);
      });
    });

    test(`${profile}: plugin stateDir follows request-scoped operator identity`, async () => {
      assertProfileStartupOk(profile);
      delete process.env.OPENBOT_OPERATOR_ID;
      delete process.env.OPENCLAW_OPERATOR_ID;

      const foreignOperatorStore = path.join(
        STATE_DIR,
        "operators",
        "operator-b",
        "agents",
        "main",
        "sessions",
        "sessions.json",
      );
      const legacySharedStore = path.join(
        STATE_DIR,
        "agents",
        "operator-b",
        "sessions",
        "sessions.json",
      );
      await fs.mkdir(path.dirname(foreignOperatorStore), { recursive: true });
      await fs.mkdir(path.dirname(legacySharedStore), { recursive: true });
      await fs.writeFile(foreignOperatorStore, JSON.stringify({ marker: MARKER }), "utf8");
      await fs.writeFile(legacySharedStore, JSON.stringify({ marker: MARKER }), "utf8");

      let pluginStateDir = "";
      let foreignViaStateDirExists = true;
      let legacyViaStateDirExists = true;
      let absoluteForeignRead = "";
      let absoluteForeignError = "";

      const registry = createEmptyPluginRegistry();
      registry.services.push({
        pluginId: "stage1-evidence",
        source: "test",
        service: {
          id: "stage1-state-read",
          start: (ctx) => {
            pluginStateDir = ctx.stateDir;
            foreignViaStateDirExists = fsSync.existsSync(
              path.join(
                ctx.stateDir,
                "operators",
                "operator-b",
                "agents",
                "main",
                "sessions",
                "sessions.json",
              ),
            );
            legacyViaStateDirExists = fsSync.existsSync(
              path.join(ctx.stateDir, "agents", "operator-b", "sessions", "sessions.json"),
            );
            try {
              absoluteForeignRead = JSON.stringify(
                loadSessionStore(foreignOperatorStore, { skipCache: true }),
              );
            } catch (err) {
              absoluteForeignError = String(err);
            }
          },
        },
      });

      await withOperatorStateScope("operator-a", async () => {
        const handle = await startPluginServices({
          registry,
          config: {},
        });
        await handle.stop();
      });

      expect(pluginStateDir).toContain(`${path.sep}operators${path.sep}operator-a`);
      expect(pluginStateDir).not.toBe(STATE_DIR);
      expect(foreignViaStateDirExists).toBe(false);
      expect(legacyViaStateDirExists).toBe(false);
      expect(absoluteForeignRead).not.toContain(MARKER);
      expect(absoluteForeignError).toContain(CROSS_OPERATOR_STATE_DENIED);
    });
  }
});
