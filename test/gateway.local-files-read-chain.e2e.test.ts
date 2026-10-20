/**
 * The read chain over a real connection: a real gateway process, a real node host,
 * and a real websocket between them.
 *
 * The companion `gateway.local-files-handshake.e2e.test.ts` covers getting the
 * connection up. This one covers what happens on it afterwards, which until now was
 * only ever exercised by `activation.test.ts` bridging the hop in process:
 *
 * - the keyset event reaching the node and being pinned
 * - binding create / list / revoke through the real admin RPCs
 * - a `node.invoke` frame reaching the node, being guarded, and refusing
 * - a forged capability refused at the node without contacting redemption
 *
 * The node side here is not a stand-in. `onEvent` forwards `node.invoke.request`
 * into the real `handleInvoke` and the keyset event into the real
 * `applyLocalFilesKeysetEvent`, which is exactly how `src/node-host/runner.ts`
 * wires a production node. Only the process boundary differs: the node logic runs
 * in the test process, and everything it says to the gateway crosses a real socket.
 *
 * What this still does NOT cover, stated plainly: a *successful* read. A read needs
 * a gateway-signed Invocation capability, and the only thing that mints one is
 * `LocalFilesService.requestAccess`, reached from the `local_file.*` model tools.
 * There is deliberately no operator RPC that starts a read, so driving one end to
 * end needs a real agent turn with a model, which belongs in a live test rather
 * than here. The orchestration itself is covered in process by `activation.test.ts`.
 *
 * Runs under `pnpm test:e2e`, and needs `dist/` built.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { GatewayClient } from "../src/gateway/client.js";
import { connectGatewayClient } from "../src/gateway/test-helpers.e2e.js";
import { loadOrCreateDeviceIdentity } from "../src/infra/device-identity.js";
import { NODE_LOCAL_FILES_READONLY_COMMANDS } from "../src/infra/node-commands.js";
import { LOCAL_FILES_CAP, LOCAL_FILES_KEYSET_EVENT } from "../src/local-files/events.js";
import { issueResolveTicket } from "../src/local-files/issue.js";
import { generateCapabilitySigningKey } from "../src/local-files/keyset.js";
import {
  LOCAL_FILES_OPAQUE_DENIAL,
  LOCAL_FILES_READONLY_PROFILE,
} from "../src/local-files/types.js";
import { coerceNodeInvokePayload, handleInvoke } from "../src/node-host/invoke.js";
import {
  configureLocalFilesRuntime as configureNodeLocalFiles,
  createGatewayRedemptionClient,
} from "../src/node-host/local-files/dispatch.js";
import {
  applyLocalFilesKeysetEvent,
  PersistentNodeCapabilityKeyset,
} from "../src/node-host/local-files/keyset-store.js";
import { GATEWAY_CLIENT_MODES, GATEWAY_CLIENT_NAMES } from "../src/utils/message-channel.js";
import {
  type GatewayInstance,
  postJson,
  spawnGatewayInstance,
  stopGatewayInstance,
} from "./helpers/gateway-e2e-harness.js";

const E2E_TIMEOUT_MS = 120_000;
const TENANT = "acme";
const USER = "u-1042";
const AGENT = "bot-skill";

/**
 * Run a request expected to be refused, and return the message.
 *
 * A node refusal surfaces as an RPC error, so it arrives as a rejection rather
 * than a negative payload. Asserting the message keeps the test about the refusal
 * itself rather than about the absence of a throw.
 */
async function captureRefusal(run: () => Promise<unknown>): Promise<string> {
  try {
    const value = await run();
    throw new Error(`expected a refusal, got ${JSON.stringify(value)}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.startsWith("expected a refusal")) {
      throw err;
    }
    return message;
  }
}

let instance: GatewayInstance | null = null;
let tmpHome: string | null = null;
const clients: GatewayClient[] = [];

afterEach(async () => {
  for (const client of clients) {
    client.stop();
  }
  clients.length = 0;
  if (instance) {
    await stopGatewayInstance(instance);
    instance = null;
  }
  if (tmpHome) {
    await fs.rm(tmpHome, { recursive: true, force: true });
    tmpHome = null;
  }
});

/**
 * A real node host on a real socket.
 *
 * The `onEvent` body mirrors `src/node-host/runner.ts`: keyset events go to the
 * keyset store, invoke requests go to `handleInvoke` with the profile set, and the
 * same `client` is what `handleInvoke` uses both to reply and to call
 * `localFiles.redeem`. Nothing about the local-files path is stubbed.
 */
async function startNodeHost(inst: GatewayInstance, label: string) {
  const home = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "ldrg-rc-")));
  tmpHome = home;
  await fs.mkdir(path.join(home, "Desktop"), { recursive: true });
  const target = path.join(home, "Desktop", "notes.txt");
  await fs.writeFile(target, "hello from a real node\n", "utf8");

  const keyset = new PersistentNodeCapabilityKeyset(path.join(home, "keyset.json"));
  const keysetEvents: Array<{ ok: boolean; reason?: string }> = [];
  const invokeCommands: string[] = [];

  const identity = loadOrCreateDeviceIdentity(path.join(home, `${label}-device.json`));
  let client: GatewayClient | null = null;

  client = await connectGatewayClient({
    url: `ws://127.0.0.1:${inst.port}`,
    token: inst.gatewayToken,
    clientName: GATEWAY_CLIENT_NAMES.NODE_HOST,
    clientDisplayName: label,
    clientVersion: "1.0.0",
    platform: "darwin",
    deviceFamily: "Mac",
    mode: GATEWAY_CLIENT_MODES.NODE,
    role: "node",
    scopes: [],
    caps: [LOCAL_FILES_CAP],
    commands: [...NODE_LOCAL_FILES_READONLY_COMMANDS],
    deviceIdentity: identity,
    onEvent: (evt) => {
      if (evt.event === LOCAL_FILES_KEYSET_EVENT) {
        keysetEvents.push(applyLocalFilesKeysetEvent(evt.payload, keyset));
        return;
      }
      if (evt.event !== "node.invoke.request") {
        return;
      }
      const payload = coerceNodeInvokePayload(evt.payload);
      if (!payload) {
        return;
      }
      invokeCommands.push(String(payload.command ?? ""));
      void handleInvoke(payload, client as GatewayClient, { bins: async () => [] } as never, {
        capabilityProfile: LOCAL_FILES_READONLY_PROFILE,
      });
    },
    timeoutMessage: `timeout waiting for ${label} to connect`,
  });
  clients.push(client);

  // Same runtime a production node installs at startup, with its redemption client
  // pointed at the real gateway RPC over this connection.
  configureNodeLocalFiles({
    keyset,
    configuredProfile: LOCAL_FILES_READONLY_PROFILE,
    policy: { homeDir: home, caseInsensitive: true },
    redemption: createGatewayRedemptionClient(client),
  });

  return { client, nodeId: identity.deviceId, home, target, keyset, keysetEvents, invokeCommands };
}

async function connectAdmin(inst: GatewayInstance): Promise<GatewayClient> {
  const client = await connectGatewayClient({
    url: `ws://127.0.0.1:${inst.port}`,
    token: inst.gatewayToken,
    clientName: GATEWAY_CLIENT_NAMES.CLI,
    clientDisplayName: "admin",
    clientVersion: "1.0.0",
    platform: "test",
    mode: GATEWAY_CLIENT_MODES.CLI,
    scopes: ["operator.admin", "operator.read", "operator.approvals"],
    timeoutMessage: "timeout waiting for admin to connect",
  });
  clients.push(client);
  return client;
}

describe("local-files read chain over a real connection", () => {
  it(
    "delivers the keyset to the node over the connection it authenticated on",
    { timeout: E2E_TIMEOUT_MS },
    async () => {
      instance = await spawnGatewayInstance("ldrg-rc-keyset");
      const node = await startNodeHost(instance, "readonly-node");

      // The gateway pushes the keyset when a node advertising the capability
      // registers. Poll briefly: the event is fired right after registration.
      for (let i = 0; i < 100 && node.keysetEvents.length === 0; i += 1) {
        await new Promise((r) => setTimeout(r, 20));
      }
      expect(node.keysetEvents.length, "no keyset event arrived").toBeGreaterThan(0);
      expect(node.keysetEvents[0]?.ok, node.keysetEvents[0]?.reason).toBe(true);
      // First pairing pins a trust root, which is what later updates are checked
      // against. Without it the node fails closed on every read.
      expect(node.keyset.hasTrustRoot()).toBe(true);
    },
  );

  it(
    "creates, lists and revokes a binding through the real admin RPCs",
    { timeout: E2E_TIMEOUT_MS },
    async () => {
      instance = await spawnGatewayInstance("ldrg-rc-binding");
      const node = await startNodeHost(instance, "readonly-node");
      const admin = await connectAdmin(instance);

      // A refusal comes back as an RPC error, so success is simply a payload.
      const created = await admin.request<{ binding?: Record<string, unknown> }>(
        "localFiles.binding.create",
        {
          nodeId: node.nodeId,
          tenantId: TENANT,
          userId: USER,
          allowedAgentIds: [AGENT],
        },
      );
      expect(created.binding?.nodeId).toBe(node.nodeId);
      expect(created.binding?.allowedAgentIds).toEqual([AGENT]);

      const listed = await admin.request<{ bindings?: Array<Record<string, unknown>> }>(
        "localFiles.binding.list",
        {},
      );
      const row = listed.bindings?.find((b) => b.nodeId === node.nodeId);
      expect(row).toBeDefined();
      expect(row?.status).toBe("active");
      expect(row?.tenantId).toBe(TENANT);
      // The operator summary carries a fingerprint, never the key itself.
      expect(row?.devicePublicKeyFingerprint).toMatch(/…/);
      expect(Object.keys(row ?? {})).not.toContain("devicePublicKey");

      const revoked = await admin.request<{ ok?: boolean }>("localFiles.binding.revoke", {
        nodeId: node.nodeId,
      });
      expect(revoked.ok).toBe(true);
      const afterRevoke = await admin.request<{ bindings?: Array<Record<string, unknown>> }>(
        "localFiles.binding.list",
        {},
      );
      expect(afterRevoke.bindings?.find((b) => b.nodeId === node.nodeId)?.status).toBe("revoked");
    },
  );

  it(
    "refuses an operator-initiated fs.read at the node, for want of a capability",
    { timeout: E2E_TIMEOUT_MS },
    async () => {
      instance = await spawnGatewayInstance("ldrg-rc-second-door");
      const node = await startNodeHost(instance, "readonly-node");
      const admin = await connectAdmin(instance);

      // The second door, on the wire. The gateway allowlist admits fs.read for this
      // profile, so the frame really does reach the node; the node then refuses it
      // because the params carry no Invocation capability. An operator cannot mint
      // one, which is the whole point of design 4.6.
      const refusal = await captureRefusal(() =>
        admin.request("node.invoke", {
          nodeId: node.nodeId,
          command: "fs.read",
          params: { path: node.target },
          idempotencyKey: `ldrg-read-${Date.now()}`,
        }),
      );

      // The frame really did reach the node, and the node is what refused it.
      expect(node.invokeCommands, "the frame should have reached the node").toContain("fs.read");
      expect(refusal).toContain(LOCAL_FILES_OPAQUE_DENIAL);
      // The file is still there and was never opened for this call.
      expect(await fs.readFile(node.target, "utf8")).toContain("hello from a real node");
    },
  );

  it(
    "refuses a forged capability at the node without contacting redemption",
    { timeout: E2E_TIMEOUT_MS },
    async () => {
      instance = await spawnGatewayInstance("ldrg-rc-forged");
      const node = await startNodeHost(instance, "readonly-node");
      const admin = await connectAdmin(instance);

      // Signed by a key the gateway never published, so the node's pinned keyset
      // rejects it. Verification is local and comes first, so this never becomes a
      // redemption request on the wire.
      const foreign = generateCapabilitySigningKey("evil");
      const forged = issueResolveTicket({
        binding: {
          tenantId: TENANT,
          userId: USER,
          agentId: AGENT,
          sessionKey: "s-1",
          turnId: "turn-1",
          nodeId: node.nodeId,
          devicePublicKey: "whatever",
        },
        rawPath: node.target,
        intendedOperation: "fs.stat",
        signingKey: foreign,
        nowMs: Date.now(),
      }).signed;

      const refusal = await captureRefusal(() =>
        admin.request("node.invoke", {
          nodeId: node.nodeId,
          command: "fs.stat",
          params: { capabilityType: "resolve-ticket", capability: forged },
          idempotencyKey: `ldrg-stat-${Date.now()}`,
        }),
      );

      expect(node.invokeCommands).toContain("fs.stat");
      // Uniform denial: a forged token must not read differently from a denied path.
      expect(refusal).toContain(LOCAL_FILES_OPAQUE_DENIAL);
    },
  );
});

describe("the generic HTTP tool route cannot reach the user's disk", () => {
  it(
    "does not offer local_file.read to an operator token",
    { timeout: E2E_TIMEOUT_MS },
    async () => {
      instance = await spawnGatewayInstance("ldrg-rc-http");
      const node = await startNodeHost(instance, "readonly-node");
      const admin = await connectAdmin(instance);
      // Fully set up: a real node, a real binding. The only thing missing is a
      // turn identity, and that is the point.
      await admin.request("localFiles.binding.create", {
        nodeId: node.nodeId,
        tenantId: TENANT,
        userId: USER,
        allowedAgentIds: [AGENT],
      });

      const res = await postJson(
        `http://127.0.0.1:${instance.port}/tools/invoke`,
        { tool: "local_file.read", args: { path: node.target } },
        { Authorization: `Bearer ${instance.gatewayToken}` },
      );

      // 404, not 403 and not a read. The tools are omitted from this surface
      // entirely rather than offered and then refused, which is the registration
      // gate in local-file-tool-registration.ts doing its job: no trusted turn
      // identity means no tools. A gateway token is an operator credential and
      // must not become disk access through a generic route (design 4.6).
      expect(res.status).toBe(404);
      expect(JSON.stringify(res.json)).toContain("Tool not available");
      // Nothing reached the node.
      expect(node.invokeCommands).toHaveLength(0);
    },
  );
});
