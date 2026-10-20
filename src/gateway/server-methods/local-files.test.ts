import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NODE_LOCAL_FILES_READONLY_COMMANDS } from "../../infra/node-commands.js";
import { deriveInvocationCapability, issueTurnAuthorization } from "../../local-files/issue.js";
import {
  generateCapabilitySigningKey,
  type CapabilitySigningKey,
} from "../../local-files/keyset.js";
import {
  CAPABILITY_CLOCK_SKEW_MS,
  LOCAL_FILES_READONLY_PROFILE,
  type CapabilityBinding,
  type SignedCapability,
} from "../../local-files/types.js";
import {
  configureLocalFilesRuntime,
  getLocalFilesRuntime,
  resetLocalFilesRuntime,
  type LocalFilesRuntime,
} from "../local-files/runtime.js";
import { handleLocalFilesRedeem } from "./local-files.js";
import type { GatewayRequestHandlerOptions } from "./types.js";

const NODE_ID = "node-device-id";
const DEVICE_KEY = "device-pub-key";
const CONN_ID = "conn-1";
const CANONICAL = "/Users/demo/Desktop/pack.zip";

let runtime: LocalFilesRuntime;
let signingKey: CapabilitySigningKey;

function binding(overrides: Partial<CapabilityBinding> = {}): CapabilityBinding {
  return {
    tenantId: "t1",
    userId: "u1",
    agentId: "bot-skill",
    sessionKey: "s1",
    turnId: "turn-1",
    nodeId: NODE_ID,
    devicePublicKey: DEVICE_KEY,
    ...overrides,
  };
}

beforeEach(() => {
  resetLocalFilesRuntime();
  signingKey = generateCapabilitySigningKey();
  runtime = configureLocalFilesRuntime({
    signingKey,
    // Never touch the real state directory from a test.
    bindingPersistence: null,
    node: { invoke: async () => ({ ok: true, payload: {} }) },
    approvals: { requestLocalFileApproval: async () => "deny" },
  });
  runtime.bindings.put({
    tenantId: "t1",
    userId: "u1",
    nodeId: NODE_ID,
    devicePublicKey: DEVICE_KEY,
    allowedAgentIds: ["bot-skill"],
    capabilityProfile: LOCAL_FILES_READONLY_PROFILE,
    status: "active",
    createdAtMs: Date.now() - 1000,
  });
});

afterEach(() => {
  resetLocalFilesRuntime();
});

function makeCapability(overrides?: { binding?: CapabilityBinding }): SignedCapability {
  const issued = issueTurnAuthorization({
    binding: overrides?.binding ?? binding(),
    canonicalPath: CANONICAL,
    fileId: { dev: "1", ino: "2" },
    targetKind: "file",
    operations: ["fs.read"],
    grantSource: "user-directed",
    signingKey,
    store: runtime.turnAuthorizations,
    nowMs: Date.now(),
    expiresAtMs: Date.now() + 120_000,
  });
  if (!issued.ok) {
    throw new Error(`fixture: ${issued.reason}`);
  }
  const derived = deriveInvocationCapability({
    authorizationId: issued.claims.authorizationId,
    operation: "fs.read",
    signingKey,
    store: runtime.turnAuthorizations,
    nowMs: Date.now(),
    clockSkewMs: CAPABILITY_CLOCK_SKEW_MS,
  });
  if (!derived.ok) {
    throw new Error(`fixture: ${derived.reason}`);
  }
  return derived.signed;
}

type Responded = { ok: boolean; payload?: unknown; error?: unknown };

function invoke(opts: {
  capability: SignedCapability;
  operation?: string;
  connectRole?: string;
  deviceId?: string;
  devicePublicKey?: string;
  /** Simulate a token-authenticated connection that never proved key possession. */
  omitDeviceKey?: boolean;
  connId?: string;
  sessionConnId?: string;
  sessionPresent?: boolean;
  /** Profile the live session advertised. Absent means the node did not present one. */
  sessionProfile?: string;
  /** Commands the live session declared, for drift cases. */
  sessionCommands?: string[];
}): Responded {
  let responded: Responded = { ok: false };
  const respond = (ok: boolean, payload?: unknown, error?: unknown) => {
    responded = { ok, payload, error };
  };

  const nodeRegistry = {
    get: vi.fn(() =>
      opts.sessionPresent === false
        ? undefined
        : {
            nodeId: opts.deviceId ?? NODE_ID,
            connId: opts.sessionConnId ?? CONN_ID,
            // The session is where the five-way connection identity of design 9.5
            // gets its last two facts, so a session that does not look like a
            // profiled node is refused. `sessionCommands` lets a test drift it.
            capabilityProfile: opts.sessionProfile ?? LOCAL_FILES_READONLY_PROFILE,
            commands: opts.sessionCommands ?? [...NODE_LOCAL_FILES_READONLY_COMMANDS],
          },
    ),
  };

  // Synchronous by design; `void` only satisfies the handler's `Promise|void` type.
  void handleLocalFilesRedeem({
    req: { type: "req", id: "r1", method: "localFiles.redeem" },
    params: { capability: opts.capability, operation: opts.operation ?? "fs.read" },
    client: {
      connId: opts.connId ?? CONN_ID,
      ...(opts.omitDeviceKey ? {} : { devicePublicKey: opts.devicePublicKey ?? DEVICE_KEY }),
      connect: {
        role: opts.connectRole ?? "node",
        device: { id: opts.deviceId ?? NODE_ID },
        client: { id: "node-host" },
      },
    },
    respond,
    context: { nodeRegistry, logGateway: { debug: vi.fn(), warn: vi.fn() } },
    isWebchatConnect: () => false,
  } as unknown as GatewayRequestHandlerOptions);

  return responded;
}

describe("localFiles.redeem binds redemption to the live connection", () => {
  it("redeems a valid capability from the bound node", () => {
    const res = invoke({ capability: makeCapability() });
    expect(res.ok).toBe(true);
    expect(res.payload).toEqual({ ok: true });
  });

  it("refuses the same capability a second time", () => {
    const capability = makeCapability();
    expect(invoke({ capability }).payload).toEqual({ ok: true });
    const replay = invoke({ capability });
    expect(replay.ok).toBe(true);
    expect(replay.payload).toEqual({ ok: false, reason: "nonce-already-consumed" });
  });

  it("refuses when the connection never proved key possession", () => {
    // A token-authenticated connection has no devicePublicKey; it must not redeem.
    const res = invoke({ capability: makeCapability(), omitDeviceKey: true });
    expect(res.payload).toEqual({ ok: false, reason: "connection-not-authenticated" });
  });

  it("refuses when the registry session belongs to a different socket", () => {
    const res = invoke({ capability: makeCapability(), sessionConnId: "conn-other" });
    expect(res.payload).toEqual({ ok: false, reason: "connection-not-authenticated" });
  });

  it("refuses when the node has no live registry session", () => {
    const res = invoke({ capability: makeCapability(), sessionPresent: false });
    expect(res.payload).toEqual({ ok: false, reason: "connection-not-authenticated" });
  });

  it("refuses a capability issued for a different node", () => {
    const foreign = makeCapability({ binding: binding({ nodeId: "node-other" }) });
    const res = invoke({ capability: foreign });
    expect(res.payload).toEqual({ ok: false, reason: "node-mismatch" });
  });

  it("refuses when the connection's device key differs from the capability binding", () => {
    const res = invoke({ capability: makeCapability(), devicePublicKey: "some-other-key" });
    expect(res.ok).toBe(true);
    expect(res.payload).toMatchObject({ ok: false });
  });

  it("refuses an operation that disagrees with the capability", () => {
    const res = invoke({ capability: makeCapability(), operation: "fs.list" });
    expect(res.payload).toEqual({ ok: false, reason: "operation-mismatch" });
  });

  it("refuses a session that presents no capability profile", () => {
    // A connection that dropped the capability from its handshake skips the
    // connect-time command check, so redemption has to catch it (design 9.5).
    const res = invoke({ capability: makeCapability(), sessionProfile: "" });
    expect(res.payload).toEqual({ ok: false, reason: "connection-identity-mismatch" });
  });

  it("refuses a session whose declared commands drifted from the profile", () => {
    for (const commands of [
      [...NODE_LOCAL_FILES_READONLY_COMMANDS, "system.run"],
      NODE_LOCAL_FILES_READONLY_COMMANDS.slice(1),
      [],
    ]) {
      const res = invoke({ capability: makeCapability(), sessionCommands: [...commands] });
      expect(res.payload).toEqual({ ok: false, reason: "connection-identity-mismatch" });
    }
  });

  it("refuses a non-node connection role", () => {
    const res = invoke({ capability: makeCapability(), connectRole: "operator" });
    expect(res.ok).toBe(false);
    expect(res.payload).toMatchObject({ reason: "not-a-node-connection" });
  });

  it("takes the node id from the connection, not the request body", () => {
    // The params schema has no nodeId field at all, so there is nothing to spoof.
    const res = invoke({ capability: makeCapability(), deviceId: "node-other" });
    expect(res.payload).toEqual({ ok: false, reason: "node-mismatch" });
  });
});

describe("localFiles.redeem input validation and fail-closed default", () => {
  it("rejects malformed params", () => {
    let responded: Responded = { ok: true };
    void handleLocalFilesRedeem({
      req: { type: "req", id: "r1", method: "localFiles.redeem" },
      params: { capability: { alg: "RSA" }, operation: "fs.read" },
      client: {
        connId: CONN_ID,
        devicePublicKey: DEVICE_KEY,
        connect: { role: "node", device: { id: NODE_ID }, client: { id: "n" } },
      },
      respond: (ok: boolean, payload?: unknown, error?: unknown) => {
        responded = { ok, payload, error };
      },
      context: { nodeRegistry: { get: vi.fn() }, logGateway: { debug: vi.fn() } },
      isWebchatConnect: () => false,
    } as unknown as GatewayRequestHandlerOptions);
    expect(responded.ok).toBe(false);
  });

  it("rejects an unknown operation value", () => {
    const res = invoke({ capability: makeCapability(), operation: "fs.write" });
    expect(res.ok).toBe(false);
  });

  it("refuses when no runtime has been configured", () => {
    const capability = makeCapability();
    resetLocalFilesRuntime();
    expect(getLocalFilesRuntime()).toBeNull();
    const res = invoke({ capability });
    expect(res.ok).toBe(false);
    expect(res.payload).toMatchObject({ reason: "runtime-not-configured" });
  });
});

describe("keyset publication", () => {
  it("signs a document the node can verify, and includes the root for first pairing", () => {
    const published = runtime.publishKeyset();
    expect(published.alg).toBe("Ed25519");
    expect(published.trustRootKeyId).toBe(runtime.trustRoot.keyId);
    expect(published.trustRootPublicKey).toBeTruthy();
    const doc = JSON.parse(published.documentJSON) as { keys: Array<{ keyId: string }> };
    expect(doc.keys.map((k) => k.keyId)).toEqual([signingKey.keyId]);
  });

  it("does not leak the signing private key", () => {
    const serialized = JSON.stringify(runtime.publishKeyset());
    expect(serialized).not.toContain("PRIVATE KEY");
    expect(serialized).not.toContain(signingKey.privateKeyPem);
  });
});

describe("the handler is synchronous", () => {
  it("returns no promise, so redemption cannot interleave with another redemption", () => {
    // Atomicity of the four-step transaction depends on there being no suspension
    // point between verification and the two writes (design 9.3).
    const returned = handleLocalFilesRedeem({
      req: { type: "req", id: "r1", method: "localFiles.redeem" },
      params: { capability: makeCapability(), operation: "fs.read" },
      client: {
        connId: CONN_ID,
        devicePublicKey: DEVICE_KEY,
        connect: { role: "node", device: { id: NODE_ID }, client: { id: "n" } },
      },
      respond: () => {},
      context: {
        nodeRegistry: { get: () => ({ nodeId: NODE_ID, connId: CONN_ID }) },
        logGateway: { debug: () => {} },
      },
      isWebchatConnect: () => false,
    } as unknown as GatewayRequestHandlerOptions);
    expect(returned).toBeUndefined();
  });
});
