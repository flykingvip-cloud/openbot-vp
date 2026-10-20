import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./docker.js", async () => {
  const actual = await vi.importActual<typeof import("./docker.js")>("./docker.js");
  return {
    ...actual,
    readDockerPort: vi.fn(async () => 17088),
    readDockerContainerEnvVar: vi.fn(async () => "reattach-secret"),
    dockerContainerLiveness: vi.fn(async () => "running"),
  };
});

describe("tryReattachAccountComputerFromRunningWorker", () => {
  afterEach(async () => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it("republishes observer slot from RUNNING worker without creating a container", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "ob-ac-cold-reattach-"));
    vi.stubEnv("OPENBOT_STATE_DIR", root);
    vi.resetModules();

    const tenantId = "tenant-reattach";
    const userId = "user-reattach";
    const containerName = "openbot-sb-browser-reattach";
    const journalDir = path.join(root, "sandbox", "account-worker", "workers", tenantId, userId);
    await fs.mkdir(journalDir, { recursive: true });
    await fs.writeFile(
      path.join(journalDir, "worker.json"),
      JSON.stringify({
        version: 1,
        phase: "RUNNING",
        tenantId,
        userId,
        browserContainerName: containerName,
      }),
      "utf8",
    );

    const docker = await import("./docker.js");
    const {
      peekAccountComputerBrowser,
      readAccountComputerPreview,
      resetAccountComputerSlotsForTests,
      tryReattachAccountComputerFromRunningWorker,
    } = await import("./account-computer-stream.js");
    const { resetNoVncObserverTokensForTests } = await import("./novnc-auth.js");

    resetAccountComputerSlotsForTests();
    resetNoVncObserverTokensForTests();
    vi.mocked(docker.dockerContainerLiveness).mockResolvedValue("running");
    expect(peekAccountComputerBrowser(tenantId, userId)).toBeNull();

    const ok = await tryReattachAccountComputerFromRunningWorker({ tenantId, userId });
    expect(ok).toBe(true);
    expect(peekAccountComputerBrowser(tenantId, userId)?.containerName).toBe(containerName);

    const preview = readAccountComputerPreview({ tenantId, userId, issueUrl: true });
    expect(preview.status).not.toBe("COLD");
    expect(typeof preview.streamUrl).toBe("string");
    expect(preview.streamUrl?.length).toBeGreaterThan(0);

    resetAccountComputerSlotsForTests();
    resetNoVncObserverTokensForTests();
    await fs.rm(root, { recursive: true, force: true });
  });

  it("returns false when worker journal is missing", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "ob-ac-cold-missing-"));
    vi.stubEnv("OPENBOT_STATE_DIR", root);
    vi.resetModules();

    const { resetAccountComputerSlotsForTests, tryReattachAccountComputerFromRunningWorker } =
      await import("./account-computer-stream.js");
    resetAccountComputerSlotsForTests();
    const ok = await tryReattachAccountComputerFromRunningWorker({
      tenantId: "t-missing",
      userId: "u-missing",
    });
    expect(ok).toBe(false);
    await fs.rm(root, { recursive: true, force: true });
  });

  it("clears a RUNNING journal when the browser container has exited", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "ob-ac-cold-dead-"));
    vi.stubEnv("OPENBOT_STATE_DIR", root);
    vi.resetModules();

    const tenantId = "tenant-dead";
    const userId = "user-dead";
    const containerName = "aw-browser-user-dead";
    const journalDir = path.join(root, "sandbox", "account-worker", "workers", tenantId, userId);
    const journalPath = path.join(journalDir, "worker.json");
    await fs.mkdir(journalDir, { recursive: true });
    await fs.writeFile(
      journalPath,
      JSON.stringify({
        version: 1,
        phase: "RUNNING",
        tenantId,
        userId,
        browserPid: 1,
        browserContainerName: containerName,
        execContainerName: "aw-exec-dead",
        lastFailure: null,
      }),
      "utf8",
    );

    const docker = await import("./docker.js");
    vi.mocked(docker.dockerContainerLiveness).mockResolvedValue("stopped");
    const {
      readAccountComputerPreview,
      resetAccountComputerSlotsForTests,
      tryReattachAccountComputerFromRunningWorker,
    } = await import("./account-computer-stream.js");
    resetAccountComputerSlotsForTests();
    vi.mocked(docker.dockerContainerLiveness).mockResolvedValue("stopped");

    const ok = await tryReattachAccountComputerFromRunningWorker({ tenantId, userId });
    expect(ok).toBe(false);
    const journal = JSON.parse(await fs.readFile(journalPath, "utf8")) as {
      phase: string;
      browserContainerName: string | null;
      browserPid: number | null;
      lastFailure: string | null;
    };
    expect(journal.phase).toBe("STOPPED");
    expect(journal.browserContainerName).toBeNull();
    expect(journal.browserPid).toBeNull();
    expect(journal.lastFailure).toContain("已退出");

    const preview = readAccountComputerPreview({ tenantId, userId, issueUrl: true });
    expect(preview.status).toBe("COLD");
    expect(preview.streamUrl).toBeUndefined();
    expect(preview.failure).toContain("已退出");

    resetAccountComputerSlotsForTests();
    await fs.rm(root, { recursive: true, force: true });
  });

  it("keeps RUNNING and explains when the engine cannot be asked", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "ob-ac-cold-unknown-"));
    vi.stubEnv("OPENBOT_STATE_DIR", root);
    vi.resetModules();

    const tenantId = "tenant-unknown";
    const userId = "user-unknown";
    const containerName = "aw-browser-user-unknown";
    const journalDir = path.join(root, "sandbox", "account-worker", "workers", tenantId, userId);
    const journalPath = path.join(journalDir, "worker.json");
    await fs.mkdir(journalDir, { recursive: true });
    await fs.writeFile(
      journalPath,
      JSON.stringify({
        version: 1,
        phase: "RUNNING",
        tenantId,
        userId,
        browserContainerName: containerName,
      }),
      "utf8",
    );

    const docker = await import("./docker.js");
    vi.mocked(docker.dockerContainerLiveness).mockResolvedValue("unknown");
    const {
      readAccountComputerPreview,
      resetAccountComputerSlotsForTests,
      tryReattachAccountComputerFromRunningWorker,
    } = await import("./account-computer-stream.js");
    resetAccountComputerSlotsForTests();

    const ok = await tryReattachAccountComputerFromRunningWorker({ tenantId, userId });
    expect(ok).toBe(false);
    const journal = JSON.parse(await fs.readFile(journalPath, "utf8")) as { phase: string };
    expect(journal.phase).toBe("RUNNING");
    const preview = readAccountComputerPreview({ tenantId, userId, issueUrl: true });
    expect(preview.status).toBe("COLD");
    expect(preview.streamUrl).toBeUndefined();
    expect(preview.failure).toContain("无法确认");

    resetAccountComputerSlotsForTests();
    await fs.rm(root, { recursive: true, force: true });
  });

  it("keeps RUNNING and explains when the live browser has no preview port", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "ob-ac-cold-noport-"));
    vi.stubEnv("OPENBOT_STATE_DIR", root);
    vi.resetModules();

    const tenantId = "tenant-noport";
    const userId = "user-noport";
    const containerName = "aw-browser-user-noport";
    const journalDir = path.join(root, "sandbox", "account-worker", "workers", tenantId, userId);
    const journalPath = path.join(journalDir, "worker.json");
    await fs.mkdir(journalDir, { recursive: true });
    await fs.writeFile(
      journalPath,
      JSON.stringify({
        version: 1,
        phase: "RUNNING",
        tenantId,
        userId,
        browserContainerName: containerName,
      }),
      "utf8",
    );

    const docker = await import("./docker.js");
    vi.mocked(docker.dockerContainerLiveness).mockResolvedValue("running");
    vi.mocked(docker.readDockerPort).mockResolvedValue(null);
    vi.mocked(docker.readDockerContainerEnvVar).mockResolvedValue(null);
    const {
      readAccountComputerPreview,
      resetAccountComputerSlotsForTests,
      tryReattachAccountComputerFromRunningWorker,
    } = await import("./account-computer-stream.js");
    resetAccountComputerSlotsForTests();

    const ok = await tryReattachAccountComputerFromRunningWorker({ tenantId, userId });
    expect(ok).toBe(false);
    const journal = JSON.parse(await fs.readFile(journalPath, "utf8")) as {
      phase: string;
      browserContainerName: string;
    };
    expect(journal.phase).toBe("RUNNING");
    expect(journal.browserContainerName).toBe(containerName);
    const preview = readAccountComputerPreview({ tenantId, userId, issueUrl: true });
    expect(preview.streamUrl).toBeUndefined();
    expect(preview.failure).toContain("没有接上画面端口");

    resetAccountComputerSlotsForTests();
    await fs.rm(root, { recursive: true, force: true });
  });
});
