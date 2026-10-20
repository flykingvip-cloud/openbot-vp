import { describe, expect, it, vi } from "vitest";
import { CronService } from "./service.js";
import {
  createCronStoreHarness,
  createNoopLogger,
  installCronTestHooks,
} from "./service.test-harness.js";
import type { CronJobCreate } from "./types.js";

const logger = createNoopLogger();
const { makeStorePath } = createCronStoreHarness({ prefix: "openclaw-cron-ownership-" });
installCronTestHooks({ logger });

function createCronService(storePath: string) {
  return new CronService({
    storePath,
    cronEnabled: true,
    log: logger,
    enqueueSystemEvent: vi.fn(),
    requestHeartbeatNow: vi.fn(),
    runIsolatedAgentJob: vi.fn(async () => ({ status: "ok" as const })),
  });
}

function jobCreate(name: string, ownership?: CronJobCreate["ownership"]): CronJobCreate {
  return {
    name,
    enabled: true,
    schedule: { kind: "every", everyMs: 60_000 },
    sessionTarget: "main",
    wakeMode: "next-heartbeat",
    payload: { kind: "systemEvent", text: "ping" },
    ...(ownership ? { ownership } : {}),
  };
}

describe("cron ownership scoping (task 2.6)", () => {
  it("persists ownership and filters listPage by scope predicate", async () => {
    const { storePath } = await makeStorePath();
    const cron = createCronService(storePath);
    await cron.start();
    try {
      await cron.add(jobCreate("platform-global")); // unattributed
      await cron.add(jobCreate("tenant-a-job", { tenantId: "tenant-a" }));
      await cron.add(jobCreate("tenant-b-job", { tenantId: "tenant-b" }));
      await cron.add(jobCreate("user-1-job", { ownerId: "user-1" }));

      // Platform scope (no predicate): sees all 4.
      const all = await cron.listPage({ enabled: "all" });
      expect(all.jobs.map((j) => j.name).toSorted()).toEqual([
        "platform-global",
        "tenant-a-job",
        "tenant-b-job",
        "user-1-job",
      ]);

      // Tenant-a scope: only tenant-a job (no unattributed, no tenant-b).
      const tenantA = await cron.listPage({
        enabled: "all",
        scopeVisible: (o) => o?.tenantId === "tenant-a",
      });
      expect(tenantA.jobs.map((j) => j.name)).toEqual(["tenant-a-job"]);

      // Self scope user-1: only the owner's job.
      const self = await cron.listPage({
        enabled: "all",
        scopeVisible: (o) => o?.ownerId === "user-1",
      });
      expect(self.jobs.map((j) => j.name)).toEqual(["user-1-job"]);
    } finally {
      cron.stop();
    }
  });

  it("normalizes empty ownership to absent (platform-global)", async () => {
    const { storePath } = await makeStorePath();
    const cron = createCronService(storePath);
    await cron.start();
    try {
      const job = await cron.add(jobCreate("empty-ownership", { tenantId: "  ", ownerId: "" }));
      expect(cron.getJob(job.id)?.ownership).toBeUndefined();
    } finally {
      cron.stop();
    }
  });
});
