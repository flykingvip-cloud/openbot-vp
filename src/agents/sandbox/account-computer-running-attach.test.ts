import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setAccountWorkerBrowserControlAttacherForTests } from "./account-worker-browser-bridge.js";
import { ACCOUNT_WORKER_DOCKER_DRIVER_FLAG } from "./account-worker-driver.js";

describe("account-computer-running-attach", () => {
  afterEach(() => {
    setAccountWorkerBrowserControlAttacherForTests(null);
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it("gates on Account Worker docker driver only (not LOCAL_PREVIEW alone)", async () => {
    const { isAccountComputerRunningAttachEnabled, ACCOUNT_WORKER_LOCAL_PREVIEW_FLAG } =
      await import("./account-computer-running-attach.js");
    expect(
      isAccountComputerRunningAttachEnabled({
        [ACCOUNT_WORKER_LOCAL_PREVIEW_FLAG]: "1",
        [ACCOUNT_WORKER_DOCKER_DRIVER_FLAG]: "0",
      }),
    ).toBe(false);
    expect(
      isAccountComputerRunningAttachEnabled({
        [ACCOUNT_WORKER_DOCKER_DRIVER_FLAG]: "1",
      }),
    ).toBe(true);
    // P6b: docker flag unset defaults ON (attach still needs a RUNNING journal).
    expect(isAccountComputerRunningAttachEnabled({})).toBe(true);
  });

  it("attaches control bridge when worker journal is RUNNING", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "ob-ac-running-attach-"));
    vi.stubEnv("OPENBOT_STATE_DIR", root);
    vi.stubEnv(ACCOUNT_WORKER_DOCKER_DRIVER_FLAG, "1");
    vi.resetModules();

    const tenantId = "tenant-ac";
    const userId = "user-ac";
    const containerName = "openbot-sb-browser-ac";
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

    const { setAccountWorkerBrowserControlAttacherForTests: setAttacher } =
      await import("./account-worker-browser-bridge.js");
    setAttacher(async (params) => {
      expect(params.tenantId).toBe(tenantId);
      expect(params.userId).toBe(userId);
      expect(params.containerName).toBe(containerName);
      return {
        bridgeUrl: "http://127.0.0.1:18792",
        noVncUrl: "http://127.0.0.1:18792/novnc/",
        containerName,
      };
    });

    const { tryAttachRunningAccountComputerBrowser } =
      await import("./account-computer-running-attach.js");
    const attached = await tryAttachRunningAccountComputerBrowser({
      tenantId,
      userId,
      env: process.env,
    });
    expect(attached).toMatchObject({
      bridgeUrl: "http://127.0.0.1:18792",
      containerName,
    });

    setAttacher(null);
    await fs.rm(root, { recursive: true, force: true });
  });

  it("returns null when journal is not RUNNING", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "ob-ac-running-attach-cold-"));
    vi.stubEnv("OPENBOT_STATE_DIR", root);
    vi.stubEnv(ACCOUNT_WORKER_DOCKER_DRIVER_FLAG, "1");
    vi.resetModules();

    const tenantId = "tenant-cold";
    const userId = "user-cold";
    const journalDir = path.join(root, "sandbox", "account-worker", "workers", tenantId, userId);
    await fs.mkdir(journalDir, { recursive: true });
    await fs.writeFile(
      path.join(journalDir, "worker.json"),
      JSON.stringify({
        version: 1,
        phase: "STOPPED",
        tenantId,
        userId,
        browserContainerName: "openbot-sb-browser-cold",
      }),
      "utf8",
    );

    const { tryAttachRunningAccountComputerBrowser } =
      await import("./account-computer-running-attach.js");
    const attached = await tryAttachRunningAccountComputerBrowser({
      tenantId,
      userId,
      env: process.env,
    });
    expect(attached).toBeNull();
    await fs.rm(root, { recursive: true, force: true });
  });
});
