import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const resolveTenantContextMock = vi.hoisted(() => vi.fn());

vi.mock("../tenant-context.js", () => ({
  resolveTenantContext: (...args: unknown[]) => resolveTenantContextMock(...args),
}));

vi.mock("../security-profile.js", () => ({
  resolveSecurityProfile: () => ({ profile: "managed_enterprise" }),
}));

vi.mock("../../config/data-space.js", () => ({
  isSharedTenantAddressingEnabled: () => false,
}));

const { resolveChatInjectTranscriptGovernance } = await import("./chat-transcript-governance.js");

describe("resolveChatInjectTranscriptGovernance", () => {
  const dirs: string[] = [];

  afterEach(async () => {
    resolveTenantContextMock.mockReset();
    for (const dir of dirs.splice(0)) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("fills tenant ownership from cron job when operator client lacks tenant context", async () => {
    resolveTenantContextMock.mockRejectedValue(new Error("unresolved_tenant"));
    const cronDir = await fs.mkdtemp(path.join(os.tmpdir(), "cron-governance-"));
    dirs.push(cronDir);
    const cronStorePath = path.join(cronDir, "jobs.json");
    await fs.writeFile(
      cronStorePath,
      `${JSON.stringify(
        {
          version: 1,
          jobs: [
            {
              id: "job-1",
              name: "daily digest",
              enabled: true,
              createdAtMs: 1,
              updatedAtMs: 1,
              state: {},
              schedule: { kind: "cron", expr: "0 9 * * *" },
              sessionTarget: "isolated",
              wakeMode: "now",
              payload: { kind: "agentTurn", message: "run" },
              ownership: { tenantId: "001", ownerId: "90fed19a-1c8b-4420-87e0-bcc6165e32fa" },
            },
          ],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const governance = await resolveChatInjectTranscriptGovernance({
      client: { connect: {} as never },
      cfg: {},
      cronJobId: "job-1",
      cronStorePath,
    });

    expect(governance.tenantId).toBe("001");
    expect(governance.ownerUserId).toBe("90fed19a-1c8b-4420-87e0-bcc6165e32fa");
    expect(governance.failClosed).toBe(true);
  });

  it("keeps client tenant context when already present", async () => {
    resolveTenantContextMock.mockResolvedValue({
      tenantId: "001",
      userId: "from-client",
      domain: "employee",
    });
    const cronDir = await fs.mkdtemp(path.join(os.tmpdir(), "cron-governance-skip-"));
    dirs.push(cronDir);
    const cronStorePath = path.join(cronDir, "jobs.json");
    await fs.writeFile(
      cronStorePath,
      `${JSON.stringify(
        {
          version: 1,
          jobs: [
            {
              id: "job-2",
              name: "other",
              enabled: true,
              createdAtMs: 1,
              updatedAtMs: 1,
              state: {},
              schedule: { kind: "cron", expr: "0 9 * * *" },
              sessionTarget: "isolated",
              wakeMode: "now",
              payload: { kind: "agentTurn", message: "run" },
              ownership: { tenantId: "999", ownerId: "other-user" },
            },
          ],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const governance = await resolveChatInjectTranscriptGovernance({
      client: { connect: {} as never },
      cfg: {},
      cronJobId: "job-2",
      cronStorePath,
    });

    expect(governance.tenantId).toBe("001");
    expect(governance.ownerUserId).toBe("from-client");
  });
});
