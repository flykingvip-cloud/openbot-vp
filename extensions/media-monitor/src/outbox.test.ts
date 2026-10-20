import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/media-monitor";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EMPTY_STORE, resolveMonitorStorePath, writeMonitorStore } from "./monitor-store.js";
import { flushOutbox } from "./outbox-flusher.js";
import { claimDueOutbox } from "./outbox.js";
import type { NotificationOutboxRow } from "./types.js";

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length) {
    const dir = tempDirs.pop();
    if (dir) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }
  vi.restoreAllMocks();
});

function sampleRow(overrides: Partial<NotificationOutboxRow> = {}): NotificationOutboxRow {
  return {
    id: "out_1",
    eventId: "evt_1",
    targetId: "tgt_1",
    tenantId: "t1",
    agentId: "a1",
    channel: "telegram",
    destination: "chat-1",
    status: "pending",
    attempts: 0,
    nextAttemptAt: new Date(0).toISOString(),
    createdAt: new Date(0).toISOString(),
    body: "hello",
    ...overrides,
  };
}

describe("media-monitor outbox claim", () => {
  it("claims due rows as sending with owner lease", () => {
    const data = structuredClone(EMPTY_STORE);
    data.outbox.push(sampleRow());
    const claimed = claimDueOutbox(data, { owner: "flush-a", limit: 10, now: Date.now() });
    expect(claimed).toHaveLength(1);
    expect(data.outbox[0]?.status).toBe("sending");
    expect(data.outbox[0]?.claimOwner).toBe("flush-a");
    expect(data.outbox[0]?.claimUntil).toBeTruthy();

    const again = claimDueOutbox(data, { owner: "flush-b", limit: 10, now: Date.now() });
    expect(again).toHaveLength(0);
  });

  it("allows reclaim only after claimUntil expires", () => {
    const data = structuredClone(EMPTY_STORE);
    data.outbox.push(
      sampleRow({
        status: "sending",
        claimOwner: "stale",
        claimUntil: new Date(Date.now() - 1_000).toISOString(),
      }),
    );
    const claimed = claimDueOutbox(data, { owner: "fresh", now: Date.now() });
    expect(claimed).toHaveLength(1);
    expect(data.outbox[0]?.claimOwner).toBe("fresh");
  });

  it("concurrent flushOutbox sends only once", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "media-monitor-outbox-"));
    tempDirs.push(stateDir);
    const storePath = resolveMonitorStorePath(stateDir);
    const data = structuredClone(EMPTY_STORE);
    data.outbox.push(sampleRow());
    await fs.mkdir(path.dirname(storePath), { recursive: true });
    await writeMonitorStore(storePath, data);

    let sends = 0;
    const api = {
      id: "media-monitor",
      runtime: {
        channel: {
          telegram: {
            sendMessageTelegram: async () => {
              sends += 1;
              await new Promise((r) => setTimeout(r, 80));
              return {};
            },
          },
        },
      },
      logger: { info() {}, warn() {}, error() {}, debug() {} },
    } as unknown as OpenClawPluginApi;

    const [a, b] = await Promise.all([
      flushOutbox({ api, storePath, owner: "worker-a" }),
      flushOutbox({ api, storePath, owner: "worker-b" }),
    ]);

    expect(sends).toBe(1);
    expect(a.sent + b.sent).toBe(1);
    expect(a.failed + b.failed + a.deadLetter + b.deadLetter).toBe(0);

    const { readMonitorStore } = await import("./monitor-store.js");
    const after = await readMonitorStore(storePath);
    expect(after.outbox[0]?.status).toBe("sent");
  });
});
