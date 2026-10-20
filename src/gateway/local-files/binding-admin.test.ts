import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NODE_LOCAL_FILES_READONLY_COMMANDS } from "../../infra/node-commands.js";
import {
  createFileBindingPersistence,
  parseStoredBinding,
  resolveLocalDeviceBindingsPath,
} from "../../local-files/device-binding-persistence.js";
import { LocalDeviceBindingStore } from "../../local-files/device-binding.js";
import { LOCAL_FILES_CAP } from "../../local-files/events.js";
import { LOCAL_FILES_READONLY_PROFILE } from "../../local-files/types.js";
import {
  createLocalDeviceBinding,
  revokeLocalDeviceBinding,
  summarizeBinding,
  type BindableNodeSession,
} from "./binding-admin.js";

const NODE_ID = "node-mac-1";
const DEVICE_KEY = "live-connection-device-key";

let tmpDir: string;

function session(overrides: Partial<BindableNodeSession> = {}): BindableNodeSession {
  return {
    nodeId: NODE_ID,
    caps: [LOCAL_FILES_CAP],
    commands: [...NODE_LOCAL_FILES_READONLY_COMMANDS],
    devicePublicKey: DEVICE_KEY,
    ...overrides,
  };
}

function nodes(s: BindableNodeSession | undefined) {
  return { get: (id: string) => (s && s.nodeId === id ? s : undefined) };
}

function makeStore(): LocalDeviceBindingStore {
  return new LocalDeviceBindingStore(createFileBindingPersistence(tmpDir));
}

const GRANT = {
  tenantId: "t1",
  userId: "u1",
  allowedAgentIds: ["bot-skill"],
};

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ldrg-binding-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("the device key comes from the live connection, not the request", () => {
  it("binds using the key the connection authenticated", async () => {
    const bindings = makeStore();
    const res = await createLocalDeviceBinding({
      ...GRANT,
      nodeId: NODE_ID,
      bindings,
      nodes: nodes(session()),
    });
    expect(res.ok).toBe(true);
    expect(res.ok && res.binding.devicePublicKey).toBe(DEVICE_KEY);
    expect(res.ok && res.binding.capabilityProfile).toBe(LOCAL_FILES_READONLY_PROFILE);
  });

  it("refuses when the node is not connected, so no key can be observed", async () => {
    const bindings = makeStore();
    const res = await createLocalDeviceBinding({
      ...GRANT,
      nodeId: NODE_ID,
      bindings,
      nodes: nodes(undefined),
    });
    expect(res.ok).toBe(false);
    expect(!res.ok && res.reason).toBe("node-not-connected");
  });

  it("refuses a connection that never proved key possession", async () => {
    const bindings = makeStore();
    const res = await createLocalDeviceBinding({
      ...GRANT,
      nodeId: NODE_ID,
      bindings,
      nodes: nodes(session({ devicePublicKey: undefined })),
    });
    expect(!res.ok && res.reason).toBe("node-connection-has-no-device-key");
  });
});

describe("a general-purpose node cannot be bound by accident", () => {
  it("refuses a node that does not advertise the local-files capability", async () => {
    const bindings = makeStore();
    const res = await createLocalDeviceBinding({
      ...GRANT,
      nodeId: NODE_ID,
      bindings,
      nodes: nodes(session({ caps: ["system", "browser"] })),
    });
    expect(!res.ok && res.reason).toBe("node-not-local-files-profile");
  });

  it("refuses a node whose command set includes system.run", async () => {
    const bindings = makeStore();
    const res = await createLocalDeviceBinding({
      ...GRANT,
      nodeId: NODE_ID,
      bindings,
      nodes: nodes(session({ commands: [...NODE_LOCAL_FILES_READONLY_COMMANDS, "system.run"] })),
    });
    expect(!res.ok && res.reason).toBe("node-command-set-mismatch");
    expect(!res.ok && res.detail).toContain("system.run");
  });

  it("refuses a node missing one of the profile commands", async () => {
    const bindings = makeStore();
    const res = await createLocalDeviceBinding({
      ...GRANT,
      nodeId: NODE_ID,
      bindings,
      nodes: nodes(
        session({ commands: NODE_LOCAL_FILES_READONLY_COMMANDS.filter((c) => c !== "fs.read") }),
      ),
    });
    expect(!res.ok && res.reason).toBe("node-command-set-mismatch");
  });
});

describe("a binding cannot be silently re-pointed", () => {
  it("refuses a second active binding for the same node", async () => {
    const bindings = makeStore();
    expect(
      (
        await createLocalDeviceBinding({
          ...GRANT,
          nodeId: NODE_ID,
          bindings,
          nodes: nodes(session()),
        })
      ).ok,
    ).toBe(true);

    // Attempting to hand the same machine to a different user must fail loudly.
    const res = await createLocalDeviceBinding({
      nodeId: NODE_ID,
      tenantId: "t1",
      userId: "someone-else",
      allowedAgentIds: ["bot-skill"],
      bindings,
      nodes: nodes(session()),
    });
    expect(!res.ok && res.reason).toBe("binding-already-active");
    expect(bindings.get(NODE_ID)?.userId).toBe("u1");
  });

  it("allows rebinding only after an explicit revoke", async () => {
    const bindings = makeStore();
    await createLocalDeviceBinding({
      ...GRANT,
      nodeId: NODE_ID,
      bindings,
      nodes: nodes(session()),
    });
    expect((await revokeLocalDeviceBinding({ nodeId: NODE_ID, bindings })).ok).toBe(true);

    const res = await createLocalDeviceBinding({
      nodeId: NODE_ID,
      tenantId: "t1",
      userId: "u2",
      allowedAgentIds: ["bot-skill"],
      bindings,
      nodes: nodes(session()),
    });
    expect(res.ok).toBe(true);
    expect(bindings.get(NODE_ID)?.userId).toBe("u2");
  });

  it("revoking an unknown node reports a failure rather than pretending", async () => {
    const bindings = makeStore();
    const res = await revokeLocalDeviceBinding({ nodeId: "nope", bindings });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("not-bound-or-already-revoked");
  });
});

describe("grant fields are validated rather than defaulted", () => {
  it("refuses an empty tenant, user or agent list", async () => {
    const bindings = makeStore();
    const base = { nodeId: NODE_ID, bindings, nodes: nodes(session()) };
    expect(
      (
        await createLocalDeviceBinding({
          ...base,
          tenantId: " ",
          userId: "u1",
          allowedAgentIds: ["a"],
        })
      ).ok,
    ).toBe(false);
    expect(
      (
        await createLocalDeviceBinding({
          ...base,
          tenantId: "t1",
          userId: "",
          allowedAgentIds: ["a"],
        })
      ).ok,
    ).toBe(false);
    const noAgents = await createLocalDeviceBinding({
      ...base,
      tenantId: "t1",
      userId: "u1",
      allowedAgentIds: [],
    });
    expect(!noAgents.ok && noAgents.reason).toBe("no-allowed-agents");
  });

  it("deduplicates and sorts the agent list", async () => {
    const bindings = makeStore();
    const res = await createLocalDeviceBinding({
      nodeId: NODE_ID,
      tenantId: "t1",
      userId: "u1",
      allowedAgentIds: ["bot-skill", "bot-skill", " bot-alpha "],
      bindings,
      nodes: nodes(session()),
    });
    expect(res.ok && res.binding.allowedAgentIds).toEqual(["bot-alpha", "bot-skill"]);
  });
});

describe("persistence survives a restart (design 4.3)", () => {
  it("reloads an active binding into a fresh store", async () => {
    const first = makeStore();
    await createLocalDeviceBinding({
      ...GRANT,
      nodeId: NODE_ID,
      bindings: first,
      nodes: nodes(session()),
    });

    const restarted = makeStore();
    expect(await restarted.hydrate()).toBe(1);
    const reloaded = restarted.get(NODE_ID);
    expect(reloaded?.status).toBe("active");
    expect(reloaded?.devicePublicKey).toBe(DEVICE_KEY);

    // And it authorizes, which is the point of persisting it.
    expect(
      restarted.authorize({
        nodeId: NODE_ID,
        tenantId: "t1",
        userId: "u1",
        agentId: "bot-skill",
        devicePublicKey: DEVICE_KEY,
      }).ok,
    ).toBe(true);
  });

  it("keeps a revocation across a restart", async () => {
    const first = makeStore();
    await createLocalDeviceBinding({
      ...GRANT,
      nodeId: NODE_ID,
      bindings: first,
      nodes: nodes(session()),
    });
    await revokeLocalDeviceBinding({ nodeId: NODE_ID, bindings: first });

    const restarted = makeStore();
    await restarted.hydrate();
    expect(restarted.get(NODE_ID)?.status).toBe("revoked");
    expect(
      restarted.authorize({
        nodeId: NODE_ID,
        tenantId: "t1",
        userId: "u1",
        agentId: "bot-skill",
        devicePublicKey: DEVICE_KEY,
      }).ok,
    ).toBe(false);
  });

  it("writes the store with owner-only permissions", async () => {
    const bindings = makeStore();
    await createLocalDeviceBinding({
      ...GRANT,
      nodeId: NODE_ID,
      bindings,
      nodes: nodes(session()),
    });
    const stat = await fs.stat(resolveLocalDeviceBindingsPath(tmpDir));
    expect(stat.mode & 0o777).toBe(0o600);
  });

  it("treats a missing or corrupt store as no bindings, not partial ones", async () => {
    const persistence = createFileBindingPersistence(tmpDir);
    expect(await persistence.load()).toEqual([]);

    await fs.writeFile(resolveLocalDeviceBindingsPath(tmpDir), "{ not json");
    expect(await persistence.load()).toEqual([]);

    await fs.writeFile(
      resolveLocalDeviceBindingsPath(tmpDir),
      JSON.stringify({ version: 2, bindings: [{ nodeId: "x" }] }),
    );
    expect(await persistence.load()).toEqual([]);
  });

  it("drops a malformed record rather than coercing it into an authorization", () => {
    // Each of these is missing something that would otherwise be defaulted.
    for (const broken of [
      {},
      { tenantId: "t", userId: "u", nodeId: "n" },
      { tenantId: "t", userId: "u", nodeId: "n", devicePublicKey: "k", status: "active" },
      {
        tenantId: "t",
        userId: "u",
        nodeId: "n",
        devicePublicKey: "k",
        status: "active",
        allowedAgentIds: ["a"],
        createdAtMs: 1,
        capabilityProfile: "something-else",
      },
    ]) {
      expect(parseStoredBinding(broken)).toBeNull();
    }
  });

  it("round-trips a well-formed record", () => {
    const parsed = parseStoredBinding({
      tenantId: "t1",
      userId: "u1",
      nodeId: NODE_ID,
      devicePublicKey: DEVICE_KEY,
      allowedAgentIds: ["bot-skill"],
      capabilityProfile: LOCAL_FILES_READONLY_PROFILE,
      status: "active",
      createdAtMs: 123,
    });
    expect(parsed?.nodeId).toBe(NODE_ID);
  });
});

describe("operator summary does not leak the device key", () => {
  it("reduces the key to a short fingerprint", async () => {
    const bindings = makeStore();
    const res = await createLocalDeviceBinding({
      ...GRANT,
      nodeId: NODE_ID,
      bindings,
      nodes: nodes(session()),
    });
    expect(res.ok).toBe(true);
    if (!res.ok) {
      return;
    }
    const summary = summarizeBinding(res.binding);
    expect(summary.devicePublicKeyFingerprint).not.toBe(DEVICE_KEY);
    expect(JSON.stringify(summary)).not.toContain(DEVICE_KEY);
    expect(summary.userId).toBe("u1");
    expect(summary.status).toBe("active");
  });
});
