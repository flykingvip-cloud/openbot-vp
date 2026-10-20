/**
 * Real two-process handshake for the read-only file profile.
 *
 * `activation.test.ts` bridges the websocket hop in process. That proves the logic
 * composes, and it is deliberately not enough: it never runs a handshake, and a
 * defect lived in exactly that gap. A correctly configured read-only node could
 * not connect at all, because the connect-time command filter resolved the macOS
 * defaults and stripped all five profile commands, after which the profile check
 * closed the connection for a command set mismatch (fixed in 4c44c555e).
 *
 * So this test spawns a real gateway process and connects a real websocket. The
 * assertions are about what only a real handshake can show: that the five commands
 * survive it, and that the profile check still refuses a drifted set over the wire.
 *
 * Runs under `pnpm test:e2e`, not the default suite, and needs `dist/` built.
 *
 * Lives under `test/` rather than beside the feature because `tsconfig.json`
 * typechecks only `src`, `ui` and `extensions`. Importing the harness from a file
 * under `src/` would pull `test/helpers/**` into the typecheck graph and surface
 * pre-existing type errors there, which is why `test/gateway.multi.e2e.test.ts`
 * sits here too.
 */

import { afterEach, describe, expect, it } from "vitest";
import type { GatewayClient } from "../src/gateway/client.js";
import { connectGatewayClient } from "../src/gateway/test-helpers.e2e.js";
import { NODE_LOCAL_FILES_READONLY_COMMANDS } from "../src/infra/node-commands.js";
import { LOCAL_FILES_CAP } from "../src/local-files/events.js";
import { GATEWAY_CLIENT_MODES, GATEWAY_CLIENT_NAMES } from "../src/utils/message-channel.js";
import {
  type GatewayInstance,
  spawnGatewayInstance,
  stopGatewayInstance,
} from "./helpers/gateway-e2e-harness.js";

const E2E_TIMEOUT_MS = 120_000;

type NodeRow = { nodeId?: string; commands?: string[]; caps?: string[]; connected?: boolean };

let instance: GatewayInstance | null = null;
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
});

/** Connect as a node host, advertising whatever profile and commands the test wants. */
async function connectProfiledNode(
  inst: GatewayInstance,
  label: string,
  params: { caps: string[]; commands: string[] },
): Promise<GatewayClient> {
  const client = await connectGatewayClient({
    url: `ws://127.0.0.1:${inst.port}`,
    token: inst.gatewayToken,
    clientName: GATEWAY_CLIENT_NAMES.NODE_HOST,
    clientDisplayName: label,
    clientVersion: "1.0.0",
    // The profile is a macOS concern: the defaults for this platform are exactly
    // the ones that used to swallow the five commands.
    platform: "darwin",
    deviceFamily: "Mac",
    mode: GATEWAY_CLIENT_MODES.NODE,
    role: "node",
    scopes: [],
    caps: params.caps,
    commands: params.commands,
    timeoutMessage: `timeout waiting for ${label} to connect`,
  });
  clients.push(client);
  return client;
}

/** An operator connection, for reading `node.list` back. */
async function connectOperator(inst: GatewayInstance): Promise<GatewayClient> {
  const client = await connectGatewayClient({
    url: `ws://127.0.0.1:${inst.port}`,
    token: inst.gatewayToken,
    clientName: GATEWAY_CLIENT_NAMES.CLI,
    clientDisplayName: "operator",
    clientVersion: "1.0.0",
    platform: "test",
    mode: GATEWAY_CLIENT_MODES.CLI,
    timeoutMessage: "timeout waiting for operator to connect",
  });
  clients.push(client);
  return client;
}

describe("local-files node handshake over a real connection", () => {
  it(
    "keeps all five profile commands through the connect-time filter",
    { timeout: E2E_TIMEOUT_MS },
    async () => {
      instance = await spawnGatewayInstance("ldrg-handshake");
      const node = await connectProfiledNode(instance, "readonly-node", {
        caps: [LOCAL_FILES_CAP],
        commands: [...NODE_LOCAL_FILES_READONLY_COMMANDS],
      });
      // Reaching here is already the regression: before the fix the gateway closed
      // this connection with 1008 for a command set mismatch.
      expect(node).toBeTruthy();

      const operator = await connectOperator(instance);
      const list = await operator.request<{ nodes?: NodeRow[] }>("node.list", {});
      const row = list.nodes?.find((n) => n.caps?.includes(LOCAL_FILES_CAP));
      expect(row, "the profiled node should appear in node.list").toBeDefined();
      expect(row?.connected).toBe(true);
      // The commands the gateway kept, read back over the wire. Any missing entry
      // means the allowlist filter used the wrong profile.
      expect(row?.commands?.toSorted()).toEqual([...NODE_LOCAL_FILES_READONLY_COMMANDS].toSorted());
      expect(row?.commands).not.toContain("system.run");
    },
  );

  it(
    "refuses a node that declares system.run alongside the profile",
    { timeout: E2E_TIMEOUT_MS },
    async () => {
      instance = await spawnGatewayInstance("ldrg-handshake-extra");
      await expect(
        connectProfiledNode(instance, "greedy-node", {
          caps: [LOCAL_FILES_CAP],
          commands: [...NODE_LOCAL_FILES_READONLY_COMMANDS, "system.run"],
        }),
      ).rejects.toThrow();
    },
  );

  it(
    "refuses a node missing one of the profile commands",
    { timeout: E2E_TIMEOUT_MS },
    async () => {
      instance = await spawnGatewayInstance("ldrg-handshake-short");
      await expect(
        connectProfiledNode(instance, "short-node", {
          caps: [LOCAL_FILES_CAP],
          commands: NODE_LOCAL_FILES_READONLY_COMMANDS.slice(1),
        }),
      ).rejects.toThrow();
    },
  );

  it("leaves an ordinary node's handshake alone", { timeout: E2E_TIMEOUT_MS }, async () => {
    instance = await spawnGatewayInstance("ldrg-handshake-plain");
    // No local-files capability, so the profile check does not apply and the
    // macOS defaults are the right allowlist.
    await connectProfiledNode(instance, "plain-node", {
      caps: ["system"],
      commands: ["system.run"],
    });
    const operator = await connectOperator(instance);
    const list = await operator.request<{ nodes?: NodeRow[] }>("node.list", {});
    const row = list.nodes?.find((n) => n.connected);
    expect(row?.commands).toContain("system.run");
  });
});
