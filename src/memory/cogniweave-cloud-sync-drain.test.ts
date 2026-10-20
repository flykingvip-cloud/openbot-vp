import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  FileSyncOutbox,
  InMemoryCloudIntelligenceClient,
} from "../../packages/cogniweave-sdk/src/index.js";
import {
  drainCogniWeaveCloudSync,
  readCogniWeaveCloudSyncStatus,
  startCogniWeaveCloudSyncLoop,
} from "./cogniweave-cloud-sync-drain.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

async function makeStateDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cw-cloud-sync-"));
  tempDirs.push(dir);
  return dir;
}

describe("drainCogniWeaveCloudSync", () => {
  it("drains empty outbox and marks mirror pull attempt", async () => {
    const stateDir = await makeStateDir();
    const client = new InMemoryCloudIntelligenceClient({
      validCredentials: ["local-stub"],
    });
    const auth = {
      tenantId: "tenant_a",
      deviceId: "device_a",
      credential: "local-stub",
    };

    const result = await drainCogniWeaveCloudSync({ stateDir, client, auth });
    expect(result.drain).toEqual({ processed: 0, succeeded: 0, failed: 0 });
    expect(result.pull.ok).toBe(true);

    const status = await readCogniWeaveCloudSyncStatus({ stateDir, enabled: true });
    expect(status.enabled).toBe(true);
    expect(status.outboxPending).toBe(0);
    expect(status.mirrorFreshness).toBe("fresh");
  });

  it("counts pending outbox entries in status without leaking envelopes", async () => {
    const stateDir = await makeStateDir();
    const outbox = new FileSyncOutbox(stateDir);
    await outbox.enqueue({
      atomId: "atom_1",
      operation: "delete_tombstone",
      tenantId: "tenant_a",
      deviceId: "device_a",
      atomVersion: 1,
    });

    const status = await readCogniWeaveCloudSyncStatus({ stateDir, enabled: true });
    expect(status.outboxPending).toBe(1);
    expect(JSON.stringify(status)).not.toMatch(/envelope|snippet|provenance/i);
  });

  it("startCogniWeaveCloudSyncLoop stops cleanly", async () => {
    const stateDir = await makeStateDir();
    const client = new InMemoryCloudIntelligenceClient({
      validCredentials: ["local-stub"],
    });
    const handle = startCogniWeaveCloudSyncLoop({
      stateDir,
      client,
      auth: {
        tenantId: "tenant_a",
        deviceId: "device_a",
        credential: "local-stub",
      },
      intervalMs: 60_000,
    });
    handle.stop();
  });
});
