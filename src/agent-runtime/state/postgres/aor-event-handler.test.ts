import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readBanditPersistedState } from "@openbot/aor-core";
import { expect, it, vi } from "vitest";
import { createAorEventHandler } from "./aor-event-handler.js";
import { resolveRuntimeEventHandler } from "./event-handlers.js";
import type { RuntimeOutboxEvent } from "./outbox-consumer.js";
import { drainRuntimeOutbox } from "./outbox-consumer.js";

it("replays a concrete AOR projection once after acknowledgement is lost", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "aor-consumer-"));
  const target = path.join(root, "bandit.json");
  const injected = path.join(root, "untrusted.json");
  const event = {
    event_id: "event",
    execution_id: "execution",
    claim_token: "first",
    payload: {
      type: "aor.feedback",
      feedback: {
        provider: "p",
        model: "m",
        taskTypeId: "research",
        score: 1,
        banditStatePath: injected,
      },
    },
  };
  const unsupported = async () => {
    throw new Error("unregistered projection");
  };
  const ports = {
    aor: createAorEventHandler(target),
    growth: unsupported,
    statistics: unsupported,
    recovery: unsupported,
  };
  const acknowledge = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  const fail = vi.fn(async () => true);
  const claim = vi
    .fn()
    .mockResolvedValueOnce(event)
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce({ ...event, claim_token: "second" })
    .mockResolvedValue(null);
  const input = {
    tenantId: "tenant",
    store: { claim, acknowledge, fail },
    resolveHandler: (e: RuntimeOutboxEvent) => resolveRuntimeEventHandler(ports, e),
  };
  try {
    expect(await drainRuntimeOutbox(input)).toMatchObject({ lost: 1, acknowledged: 0 });
    expect(await drainRuntimeOutbox(input)).toMatchObject({ acknowledged: 1 });
    expect(Object.values(readBanditPersistedState(target)!.arms)[0].trials).toBe(1);
    await expect(fs.stat(injected)).rejects.toMatchObject({ code: "ENOENT" });
    expect(fail).not.toHaveBeenCalled();
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
it("does not acknowledge invalid AOR payloads", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "aor-invalid-"));
  const handler = createAorEventHandler(path.join(root, "bandit.json"));
  try {
    await expect(
      handler("event", "execution", {
        provider: "p",
        model: "m",
        taskTypeId: "research",
        score: 2,
      }),
    ).rejects.toThrow("Invalid");
    expect(await fs.readdir(root)).toEqual([]);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
