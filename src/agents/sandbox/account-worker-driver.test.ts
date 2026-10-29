/**
 * Account Worker sandbox drivers: memory prototype + true Docker cutover prep.
 *
 * Docker tests mock the CLI. Real-daemon e2e is gated
 * (`OPENBOT_ACCOUNT_WORKER_DOCKER_E2E=1`). Default suites stay green without a
 * daemon. When the gate is explicitly on, an unreachable daemon must fail loud
 * (not soft-pass). Vitest isolates HOME; Docker Desktop sock may need
 * DOCKER_HOST — see ensureDockerHostForE2E below. Memory ≠ production complete.
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ACCOUNT_WORKER_BROWSER_IMAGE_ENV,
  ACCOUNT_WORKER_DOCKER_DRIVER_FLAG,
  ACCOUNT_WORKER_DOCKER_IMAGE_ENV,
  ACCOUNT_WORKER_EXEC_IMAGE_ENV,
  accountSharedBrowserContainerName,
  accountWorkerContainerName,
  buildAccountWorkerContainerArgs,
  createDockerAccountSandboxDriver,
  createMemoryAccountSandboxDriver,
  isAccountWorkerDockerDriverEnabled,
  readAccountWorkerBrowserNoVncPassword,
  resolveAccountWorkerImages,
  resolveDefaultAccountWorkerSandboxDriver,
  type AccountWorkerDockerRunner,
} from "./account-worker-driver.js";
import {
  DEFAULT_SANDBOX_BROWSER_CDP_PORT,
  DEFAULT_SANDBOX_BROWSER_IMAGE,
  DEFAULT_SANDBOX_BROWSER_NOVNC_PORT,
  DEFAULT_SANDBOX_IMAGE,
  LEGACY_SANDBOX_BROWSER_IMAGE_ALIAS,
} from "./constants.js";
import { decideAccountWorkerDockerFailure } from "./docker-engine-client.js";
import type { RuntimeContainerSpec } from "./runtime-controller.js";

const DOCKER_ENV_KEYS = [
  ACCOUNT_WORKER_DOCKER_DRIVER_FLAG,
  ACCOUNT_WORKER_EXEC_IMAGE_ENV,
  ACCOUNT_WORKER_BROWSER_IMAGE_ENV,
  ACCOUNT_WORKER_DOCKER_IMAGE_ENV,
] as const;

function saveDockerEnv(): Record<string, string | undefined> {
  const prev: Record<string, string | undefined> = {};
  for (const key of DOCKER_ENV_KEYS) {
    prev[key] = process.env[key];
  }
  return prev;
}

function restoreDockerEnv(prev: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(prev)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

function sampleSpec(root: string): RuntimeContainerSpec {
  return {
    runtimeLeaseId: "lease-docker-1",
    snapshotVersion: 1,
    image: "openbot-account-sandbox:docker-cutover",
    browserImage: "openclaw-sandbox-browser:trixie",
    execMounts: [
      {
        hostPath: path.join(root, "workspace"),
        containerPath: "/account/workspace",
        access: "rw",
      },
      {
        hostPath: path.join(root, "artifacts"),
        containerPath: "/account/artifacts",
        access: "rw",
      },
    ],
    browserMounts: [
      {
        hostPath: path.join(root, "browser"),
        containerPath: "/account/browser",
        access: "rw",
      },
    ],
  };
}

function createMockDockerCli(): {
  runDocker: AccountWorkerDockerRunner;
  calls: string[][];
  markBrowserStopped(name: string): void;
  running: Set<string>;
} {
  const calls: string[][] = [];
  const created = new Set<string>();
  const running = new Set<string>();
  const mounts = new Map<string, Array<{ source: string; dest: string }>>();
  const startedAt = new Map<string, string>();
  let startedSeq = 0;
  const runDocker: AccountWorkerDockerRunner = async (args, opts) => {
    calls.push([...args]);
    const verb = args[0];
    if (verb === "create") {
      const nameIdx = args.indexOf("--name");
      const name = nameIdx >= 0 ? args[nameIdx + 1] : "";
      if (!name) {
        return { stdout: "", stderr: "missing name", code: 1 };
      }
      if (args.some((arg) => arg.includes("docker.sock"))) {
        return { stdout: "", stderr: "docker.sock refused", code: 1 };
      }
      if (created.has(name)) {
        return {
          stdout: "",
          stderr: `Conflict. The container name "/${name}" is already in use`,
          code: 1,
        };
      }
      created.add(name);
      const binds: Array<{ source: string; dest: string }> = [];
      for (let i = 0; i < args.length; i += 1) {
        if (args[i] !== "-v" && args[i] !== "--volume") {
          continue;
        }
        const bind = args[i + 1] ?? "";
        const parts = bind.split(":");
        const mode = parts[parts.length - 1];
        if ((mode === "ro" || mode === "rw") && parts.length >= 3) {
          binds.push({
            source: parts.slice(0, -2).join(":"),
            dest: parts[parts.length - 2] ?? "",
          });
        }
      }
      mounts.set(name, binds);
      return { stdout: name, stderr: "", code: 0 };
    }
    if (verb === "start") {
      const name = args[1] ?? "";
      if (!created.has(name) && !opts?.allowFailure) {
        return { stdout: "", stderr: `No such container: ${name}`, code: 1 };
      }
      running.add(name);
      startedSeq += 1;
      startedAt.set(name, new Date(Date.UTC(2026, 0, 1, 0, 0, startedSeq)).toISOString());
      return { stdout: name, stderr: "", code: 0 };
    }
    if (verb === "stop") {
      const name = args[1] ?? "";
      running.delete(name);
      return { stdout: name, stderr: "", code: 0 };
    }
    if (verb === "rm") {
      const name = args[args.length - 1] ?? "";
      created.delete(name);
      running.delete(name);
      mounts.delete(name);
      startedAt.delete(name);
      return { stdout: name, stderr: "", code: 0 };
    }
    if (verb === "ps") {
      const filterIndex = args.indexOf("--filter");
      const filter = filterIndex >= 0 ? (args[filterIndex + 1] ?? "") : "";
      const nameQuery = filter.startsWith("name=") ? filter.slice("name=".length) : "";
      const names = [...running].filter((name) => (nameQuery ? name.includes(nameQuery) : true));
      return { stdout: names.length > 0 ? `${names.join("\n")}\n` : "", stderr: "", code: 0 };
    }
    if (verb === "inspect") {
      const name = args[args.length - 1] ?? "";
      if (!created.has(name) && !running.has(name)) {
        return { stdout: "", stderr: `Error: No such object: ${name}`, code: 1 };
      }
      const formatIndex = args.indexOf("-f");
      const format = formatIndex >= 0 ? (args[formatIndex + 1] ?? "") : "";
      if (format.includes(".Mounts")) {
        const rows = mounts.get(name) ?? [];
        const mountText = rows.map((row) => `${row.dest}=${row.source}`).join("\n");
        const run = running.has(name) ? "true" : "false";
        const started = startedAt.get(name) ?? "1970-01-01T00:00:00.000Z";
        return {
          stdout: `${run}\t${started}\t${mountText}\n`,
          stderr: "",
          code: 0,
        };
      }
      return { stdout: running.has(name) ? "true\n" : "false\n", stderr: "", code: 0 };
    }
    return { stdout: "", stderr: `unexpected docker args: ${args.join(" ")}`, code: 1 };
  };
  return {
    runDocker,
    calls,
    running,
    markBrowserStopped(name: string) {
      running.delete(name);
    },
  };
}

describe("account worker docker driver (mocked CLI)", () => {
  const temps: string[] = [];
  const envSnapshots: Array<Record<string, string | undefined>> = [];

  afterEach(async () => {
    while (envSnapshots.length > 0) {
      restoreDockerEnv(envSnapshots.pop()!);
    }
    while (temps.length > 0) {
      const dir = temps.pop();
      if (dir) {
        await fsp.rm(dir, { recursive: true, force: true });
      }
    }
  });

  it("P6b: docker driver defaults on when unset; explicit 0 keeps memory", () => {
    envSnapshots.push(saveDockerEnv());
    delete process.env[ACCOUNT_WORKER_DOCKER_DRIVER_FLAG];
    expect(isAccountWorkerDockerDriverEnabled()).toBe(true);
    process.env[ACCOUNT_WORKER_DOCKER_DRIVER_FLAG] = "0";
    expect(isAccountWorkerDockerDriverEnabled()).toBe(false);
    const driver = resolveDefaultAccountWorkerSandboxDriver();
    expect("crashBrowser" in driver).toBe(true);
  });

  it("selects the docker driver when OPENBOT_ACCOUNT_WORKER_DOCKER is on or unset", () => {
    envSnapshots.push(saveDockerEnv());
    process.env[ACCOUNT_WORKER_DOCKER_DRIVER_FLAG] = "1";
    expect(isAccountWorkerDockerDriverEnabled()).toBe(true);
    const mock = createMockDockerCli();
    const driver = resolveDefaultAccountWorkerSandboxDriver(process.env, {
      runDocker: mock.runDocker,
    });
    expect("lastCreateArgs" in driver).toBe(true);
    delete process.env[ACCOUNT_WORKER_DOCKER_DRIVER_FLAG];
    expect(isAccountWorkerDockerDriverEnabled()).toBe(true);
  });

  it("creates, starts, stops, and inspects from controller-built argv only", async () => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), "aw-docker-driver-"));
    temps.push(root);
    await fsp.mkdir(path.join(root, "workspace"));
    await fsp.mkdir(path.join(root, "artifacts"));
    await fsp.mkdir(path.join(root, "browser"));
    const spec = sampleSpec(root);
    const mock = createMockDockerCli();
    const driver = createDockerAccountSandboxDriver({ runDocker: mock.runDocker });

    const exec = await driver.startExec(spec);
    expect(exec.containerName).toBe(accountWorkerContainerName("exec", spec.runtimeLeaseId));
    expect(driver.lastCreateArgs[0]?.[0]).toBe("create");
    expect(driver.lastCreateArgs[0]).toEqual(
      buildAccountWorkerContainerArgs({
        spec,
        kind: "exec",
        name: exec.containerName,
      }),
    );
    expect(driver.lastCreateArgs[0]?.some((arg) => arg.includes("docker.sock"))).toBe(false);
    expect(driver.lastCreateArgs[0]?.[1]).toBe("--pull=never");
    expect(
      buildAccountWorkerContainerArgs({
        spec,
        kind: "browser",
        name: "aw-browser-test",
      }).slice(0, 2),
    ).toEqual(["create", "--pull=never"]);
    expect(mock.calls.some((args) => args[0] === "start" && args[1] === exec.containerName)).toBe(
      true,
    );

    const failing = createDockerAccountSandboxDriver({
      runDocker: async () => ({
        stdout: "",
        stderr: "No such image: openclaw-sandbox:latest",
        code: 1,
      }),
    });
    let createError: unknown;
    try {
      await failing.startExec(spec);
    } catch (error) {
      createError = error;
    }
    expect(createError).toBeInstanceOf(Error);
    expect((createError as Error).message).toBe(
      "docker create failed: No such image: openclaw-sandbox:latest",
    );
    expect(decideAccountWorkerDockerFailure(createError).action).toBe("visible-error");

    const browser = await driver.startBrowser(spec);
    expect(browser.containerName).toBe(
      accountSharedBrowserContainerName(path.join(root, "browser")),
    );
    const browserCreate = driver.lastCreateArgs[1] ?? [];
    expect(browserCreate).toContain("OPENCLAW_BROWSER_ENABLE_NOVNC=1");
    expect(browserCreate).toContain("OPENCLAW_BROWSER_HEADLESS=0");
    expect(browserCreate).toContain(`127.0.0.1::${DEFAULT_SANDBOX_BROWSER_NOVNC_PORT}`);
    expect(
      browserCreate.some(
        (arg) =>
          arg.startsWith("OPENCLAW_BROWSER_NOVNC_PASSWORD=") &&
          arg.slice("OPENCLAW_BROWSER_NOVNC_PASSWORD=".length).length === 8,
      ),
    ).toBe(true);
    expect(browserCreate.some((arg) => arg.includes("docker.sock"))).toBe(false);
    expect(await driver.browserAlive(browser.pid)).toBe(true);
    const rememberedPassword = readAccountWorkerBrowserNoVncPassword(browser.containerName);
    expect(rememberedPassword).toMatch(/^[A-Za-z0-9]{8}$/);
    expect(JSON.stringify(browser)).not.toContain(rememberedPassword ?? "missing-password");
    expect(browser).not.toHaveProperty("noVncPassword");

    mock.markBrowserStopped(browser.containerName);
    expect(await driver.browserAlive(browser.pid)).toBe(false);

    await driver.stopBrowser(browser.pid);
    expect(readAccountWorkerBrowserNoVncPassword(browser.containerName)).toBeNull();
    expect(await driver.browserAlive(browser.pid)).toBe(false);
    expect(
      mock.calls.some((args) => args[0] === "rm" && args.includes(browser.containerName)),
    ).toBe(true);

    await driver.stopExec(exec.containerName);
    expect(mock.calls.some((args) => args[0] === "stop" && args[1] === exec.containerName)).toBe(
      true,
    );
  });

  it("recreates when the container name already exists (crash relaunch path)", async () => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), "aw-docker-recreate-"));
    temps.push(root);
    await fsp.mkdir(path.join(root, "workspace"));
    await fsp.mkdir(path.join(root, "artifacts"));
    await fsp.mkdir(path.join(root, "browser"));
    const spec = sampleSpec(root);
    const mock = createMockDockerCli();
    const driver = createDockerAccountSandboxDriver({ runDocker: mock.runDocker });

    const first = await driver.startBrowser(spec);
    // Leave the name registered without going through stopBrowser so create conflicts.
    mock.running.delete(first.containerName);
    // Simulate a stale name still present for the next create:
    // createMockDockerCli keeps `created` until rm. Force conflict by not removing.
    const second = await driver.startBrowser(spec);
    expect(second.pid).not.toBe(first.pid);
    expect(second.containerName).toBe(first.containerName);
    const rmCalls = mock.calls.filter(
      (args) => args[0] === "rm" && args.includes(first.containerName),
    );
    expect(rmCalls.length).toBeGreaterThanOrEqual(1);
    expect(await driver.browserAlive(second.pid)).toBe(true);
  });

  it("reuses a running browser on the same profile and does not start a second Chromium", async () => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), "aw-docker-reuse-"));
    temps.push(root);
    await fsp.mkdir(path.join(root, "workspace"));
    await fsp.mkdir(path.join(root, "artifacts"));
    await fsp.mkdir(path.join(root, "browser"));
    const firstSpec = sampleSpec(root);
    const secondSpec: RuntimeContainerSpec = {
      ...firstSpec,
      runtimeLeaseId: "lease-docker-2",
    };
    const otherRoot = path.join(root, "other-user");
    await fsp.mkdir(path.join(otherRoot, "browser"), { recursive: true });
    const otherSpec: RuntimeContainerSpec = {
      ...firstSpec,
      runtimeLeaseId: "lease-docker-other",
      browserMounts: [
        {
          hostPath: path.join(otherRoot, "browser"),
          containerPath: "/account/browser",
          access: "rw",
        },
      ],
    };
    const mock = createMockDockerCli();
    const driver = createDockerAccountSandboxDriver({ runDocker: mock.runDocker });
    const first = await driver.startBrowser(firstSpec);
    const second = await driver.startBrowser(secondSpec);
    const other = await driver.startBrowser(otherSpec);
    expect(second).toEqual(first);
    expect(other.containerName).not.toBe(first.containerName);
    expect(other.pid).not.toBe(first.pid);
    expect(new Set([...mock.running].filter((name) => name.startsWith("aw-browser-")))).toEqual(
      new Set([first.containerName, other.containerName]),
    );
    const removedFirst = mock.calls.filter(
      (args) => args[0] === "rm" && args.includes(first.containerName),
    );
    expect(removedFirst).toEqual([]);
    expect(await driver.browserAlive(first.pid)).toBe(true);
    const browserCreates = mock.calls.filter(
      (args) => args[0] === "create" && args.includes(first.containerName),
    );
    expect(browserCreates).toHaveLength(1);
    expect(browserCreates[0]).toEqual(
      expect.arrayContaining([`127.0.0.1::${DEFAULT_SANDBOX_BROWSER_CDP_PORT}`]),
    );
  });

  it("never puts docker.sock into built argv and refuses such mounts if injected", async () => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), "aw-docker-sock-"));
    temps.push(root);
    const evil: RuntimeContainerSpec = {
      ...sampleSpec(root),
      execMounts: [
        {
          hostPath: "/var/run/docker.sock",
          containerPath: "/var/run/docker.sock",
          access: "rw",
        },
      ],
    };
    const args = buildAccountWorkerContainerArgs({
      spec: evil,
      kind: "exec",
      name: "aw-exec-evil",
    });
    expect(args.some((arg) => arg.includes("docker.sock"))).toBe(true);
    const mock = createMockDockerCli();
    const driver = createDockerAccountSandboxDriver({ runDocker: mock.runDocker });
    await expect(driver.startExec(evil)).rejects.toThrow(/docker\.sock/);
  });

  it("binds the host tenants tree and chowns the container-visible profile", async () => {
    const containerProfile = "/root/openbot-tenants/001/users/user-a/state/browser";
    const hostProfile = "/var/lib/openbot/tenants/001/users/user-a/state/browser";
    const spec: RuntimeContainerSpec = {
      runtimeLeaseId: "lease-path-b",
      snapshotVersion: 1,
      image: "openbot-sandbox:bookworm-slim",
      browserImage: "openbot-sandbox-browser:trixie",
      execMounts: [],
      browserMounts: [
        { hostPath: containerProfile, containerPath: "/account/browser", access: "rw" },
      ],
    };
    const chowned: string[][] = [];
    const mock = createMockDockerCli();
    const driver = createDockerAccountSandboxDriver({
      runDocker: mock.runDocker,
      prepareVisibleMounts: async (directories) => {
        chowned.push([...directories]);
      },
      bindTranslation: {
        env: { OPENBOT_TENANTS_ROOT: "/root/openbot-tenants" },
        mountinfo:
          "36 22 8:1 /var/lib/openbot/tenants /root/openbot-tenants rw - ext4 /dev/vda1 rw\n",
      },
    });
    const browser = await driver.startBrowser(spec);
    expect(chowned).toEqual([[containerProfile]]);
    const create = driver.lastCreateArgs.at(-1) ?? [];
    expect(create).toContain(`${hostProfile}:/account/browser:rw`);
    expect(create.some((arg) => arg.startsWith("/root/openbot-tenants/"))).toBe(false);
    expect(browser.containerName).toBe(accountSharedBrowserContainerName(containerProfile));
  });

  it("binds the host state tree for an operator browser profile", async () => {
    const containerProfile = "/root/.openbot/operators/user-a/state/browser";
    const hostProfile = "/var/lib/openbot/state/operators/user-a/state/browser";
    const spec: RuntimeContainerSpec = {
      runtimeLeaseId: "lease-operator",
      snapshotVersion: 1,
      image: "openbot-sandbox:bookworm-slim",
      browserImage: "openbot-sandbox-browser:trixie",
      execMounts: [],
      browserMounts: [
        { hostPath: containerProfile, containerPath: "/account/browser", access: "rw" },
      ],
    };
    const chowned: string[][] = [];
    const mock = createMockDockerCli();
    const driver = createDockerAccountSandboxDriver({
      runDocker: mock.runDocker,
      prepareVisibleMounts: async (directories) => {
        chowned.push([...directories]);
      },
      bindTranslation: {
        env: { OPENBOT_TENANTS_ROOT: "/root/openbot-tenants" },
        stateDir: "/root/.openbot",
        mountinfo: [
          "36 22 8:1 /var/lib/openbot/tenants /root/openbot-tenants rw - ext4 /dev/vda1 rw",
          "37 22 8:1 /var/lib/openbot/state /root/.openbot rw - ext4 /dev/vda1 rw",
        ].join("\n"),
      },
    });
    await driver.startBrowser(spec);
    expect(chowned).toEqual([[containerProfile]]);
    const create = driver.lastCreateArgs.at(-1) ?? [];
    expect(create).toContain(`${hostProfile}:/account/browser:rw`);
    expect(create.some((arg) => arg.startsWith("/root/.openbot/"))).toBe(false);
  });
});

describe("account worker real sandbox image resolution", () => {
  const envSnapshots: Array<Record<string, string | undefined>> = [];

  afterEach(() => {
    while (envSnapshots.length > 0) {
      restoreDockerEnv(envSnapshots.pop()!);
    }
  });

  it("defaults to openbot-sandbox and openbot-sandbox-browser images", () => {
    envSnapshots.push(saveDockerEnv());
    delete process.env[ACCOUNT_WORKER_EXEC_IMAGE_ENV];
    delete process.env[ACCOUNT_WORKER_BROWSER_IMAGE_ENV];
    delete process.env[ACCOUNT_WORKER_DOCKER_IMAGE_ENV];
    const images = resolveAccountWorkerImages();
    expect(images.execImage).toBe(DEFAULT_SANDBOX_IMAGE);
    expect(images.browserImage).toBe(DEFAULT_SANDBOX_BROWSER_IMAGE);
  });

  it("honors operator env overrides and never reads a client-supplied image field", () => {
    envSnapshots.push(saveDockerEnv());
    process.env[ACCOUNT_WORKER_EXEC_IMAGE_ENV] = "registry.example/openbot-exec:v1";
    process.env[ACCOUNT_WORKER_BROWSER_IMAGE_ENV] = "registry.example/openbot-browser:v1";
    const images = resolveAccountWorkerImages({
      configExecImage: "cfg-exec:ignored-when-env-set",
      configBrowserImage: "cfg-browser:ignored-when-env-set",
    });
    expect(images.execImage).toBe("registry.example/openbot-exec:v1");
    expect(images.browserImage).toBe("registry.example/openbot-browser:v1");
  });

  it("uses config images when env is unset; legacy docker image only overrides exec", () => {
    envSnapshots.push(saveDockerEnv());
    delete process.env[ACCOUNT_WORKER_EXEC_IMAGE_ENV];
    delete process.env[ACCOUNT_WORKER_BROWSER_IMAGE_ENV];
    process.env[ACCOUNT_WORKER_DOCKER_IMAGE_ENV] = "alpine:3.20";
    const withLegacy = resolveAccountWorkerImages();
    expect(withLegacy.execImage).toBe("alpine:3.20");
    expect(withLegacy.browserImage).toBe(DEFAULT_SANDBOX_BROWSER_IMAGE);

    delete process.env[ACCOUNT_WORKER_DOCKER_IMAGE_ENV];
    const withConfig = resolveAccountWorkerImages({
      configExecImage: "cfg-exec:1",
      configBrowserImage: "cfg-browser:1",
    });
    expect(withConfig.execImage).toBe("cfg-exec:1");
    expect(withConfig.browserImage).toBe("cfg-browser:1");
  });

  it("builds distinct exec vs browser create argv with profile env and CDP publish", async () => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), "aw-dual-image-"));
    const spec = sampleSpec(root);
    const execArgs = buildAccountWorkerContainerArgs({
      spec,
      kind: "exec",
      name: "aw-exec-dual",
    });
    const browserArgs = buildAccountWorkerContainerArgs({
      spec,
      kind: "browser",
      name: "aw-browser-dual",
    });
    expect(execArgs.at(-3)).toBe(spec.image);
    expect(execArgs.slice(-2)).toEqual(["sleep", "infinity"]);
    expect(browserArgs).toContain(spec.browserImage);
    expect(browserArgs).not.toContain(spec.image);
    expect(browserArgs.some((a) => a === "OPENBOT_BROWSER_USER_DATA_DIR=/account/browser")).toBe(
      true,
    );
    expect(browserArgs.some((a) => a.includes("OPENCLAW_BROWSER_NO_SANDBOX=1"))).toBe(true);
    expect(browserArgs).toContain("OPENCLAW_BROWSER_HEADLESS=0");
    expect(browserArgs).toContain("OPENCLAW_BROWSER_ENABLE_NOVNC=1");
    expect(browserArgs).toContain(`127.0.0.1::${DEFAULT_SANDBOX_BROWSER_CDP_PORT}`);
    expect(browserArgs).toContain(`127.0.0.1::${DEFAULT_SANDBOX_BROWSER_NOVNC_PORT}`);
    expect(browserArgs.slice(-2)).not.toEqual(["sleep", "infinity"]);
    await fsp.rm(root, { recursive: true, force: true });
  });

  it("retags the browser image when only the previous tag is present", async () => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), "aw-docker-browser-alias-"));
    await fsp.mkdir(path.join(root, "browser"));
    const present = new Set([LEGACY_SANDBOX_BROWSER_IMAGE_ALIAS]);
    const calls: string[][] = [];
    const runDocker: AccountWorkerDockerRunner = async (args) => {
      calls.push([...args]);
      if (args[0] === "image" && args[1] === "inspect") {
        const image = args[2] ?? "";
        if (present.has(image)) {
          return { stdout: image, stderr: "", code: 0 };
        }
        return { stdout: "", stderr: `Error: No such image: ${image}`, code: 1 };
      }
      if (args[0] === "tag") {
        const from = args[1] ?? "";
        const to = args[2] ?? "";
        if (!present.has(from)) {
          return { stdout: "", stderr: "tag failed", code: 1 };
        }
        present.add(to);
        return { stdout: "", stderr: "", code: 0 };
      }
      if (args[0] === "ps" || args[0] === "create" || args[0] === "start") {
        return { stdout: "ok", stderr: "", code: 0 };
      }
      return { stdout: "", stderr: `unexpected docker args: ${args.join(" ")}`, code: 1 };
    };
    const driver = createDockerAccountSandboxDriver({ runDocker });
    try {
      await driver.startBrowser({
        ...sampleSpec(root),
        browserImage: DEFAULT_SANDBOX_BROWSER_IMAGE,
      });
      const create = calls.find((args) => args[0] === "create");
      expect(create).toContain(DEFAULT_SANDBOX_BROWSER_IMAGE);
      expect(calls).toContainEqual([
        "tag",
        LEGACY_SANDBOX_BROWSER_IMAGE_ALIAS,
        DEFAULT_SANDBOX_BROWSER_IMAGE,
      ]);
    } finally {
      await fsp.rm(root, { recursive: true, force: true });
    }
  });
});

describe("account worker docker driver lifecycle cutover (mocked CLI)", () => {
  /**
   * Device-bound + cookie survival through the docker driver path. Uses the
   * same lifecycle APIs as the memory tests; only the sandbox driver differs.
   */
  const temps: string[] = [];
  const envKeys = [
    "OPENBOT_DATA_MODE",
    "OPENBOT_MULTITENANT",
    "OPENBOT_TENANTS_ROOT",
    "OPENBOT_STATE_DIR",
    "OPENBOT_ACCOUNT_WORKER",
    "OPENBOT_SECURITY_PROFILE",
  ] as const;
  let envPrev: Record<string, string | undefined> = {};

  afterEach(async () => {
    for (const key of envKeys) {
      const value = envPrev[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    while (temps.length > 0) {
      const dir = temps.pop();
      if (dir) {
        await fsp.rm(dir, { recursive: true, force: true });
      }
    }
  });

  it("cold start, idle reclaim, crash relaunch, and device-bound REAUTH via docker driver", async () => {
    const { AccountRuntimeSnapshotStore } =
      await import("../../gateway/governance/account-runtime-snapshot.js");
    const { createAccountWorkerControlPlane } = await import("./account-worker-gateway.js");
    const { ACCOUNT_BROWSER_DEVICE_BOUND_FILE, AccountWorkerLifecycle } =
      await import("./account-worker-lifecycle.js");

    envPrev = {};
    for (const key of envKeys) {
      envPrev[key] = process.env[key];
    }
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), "aw-docker-life-"));
    temps.push(root);
    process.env.OPENBOT_DATA_MODE = "managed";
    process.env.OPENBOT_MULTITENANT = "1";
    process.env.OPENBOT_TENANTS_ROOT = root;
    process.env.OPENBOT_STATE_DIR = path.join(root, "operator-state");
    process.env.OPENBOT_ACCOUNT_WORKER = "1";
    process.env.OPENBOT_SECURITY_PROFILE = "managed_enterprise";

    const issuedAt = "2026-10-06T00:00:00.000Z";
    const expiresAt = "2026-10-06T00:30:00.000Z";
    const nowMs = Date.parse("2026-10-06T00:05:00.000Z");
    const mock = createMockDockerCli();
    const driver = createDockerAccountSandboxDriver({ runDocker: mock.runDocker });
    let leaseSerial = 0;
    const store = new AccountRuntimeSnapshotStore(path.join(root, "snapshots.json"), () => {
      leaseSerial += 1;
      return `lease-docker-${leaseSerial}`;
    });
    const lifecycle = new AccountWorkerLifecycle({
      cfg: {
        data: { mode: "managed" },
        agents: {
          defaults: {
            sandbox: {
              mode: "all",
              docker: { image: "openbot-account-sandbox:docker-cutover" },
            },
          },
        },
      },
      operatorImage: "openbot-account-sandbox:docker-cutover",
      browserImage: "openclaw-sandbox-browser:trixie",
      runtimeDir: path.join(root, "runtime"),
      controlPlane: createAccountWorkerControlPlane(store),
      driver,
      now: () => nowMs,
      idleAfterMs: 1_000,
      env: process.env,
      maxRunningWorkers: 4,
    });

    const issued = await store.issue({
      tenantId: "tenant-a",
      userId: "user-a",
      agentId: "bot",
      executionId: "exec-1",
      decisionId: "gd-test-decision",
      authorizationVersion: "authz-v1",
      dataSpaceRef: "tenants/tenant-a/users/user-a/OpenBot",
      browserNamespaceRef: "tenants/tenant-a/users/user-a/state/browser",
      modelEntitlement: { allowlist: ["openai/gpt"] },
      capabilityDecision: { effect: "allow" },
      commercialLimits: { creditsRemaining: 5 },
      concurrencyLimits: { maxConcurrentRuns: 2, activeCount: 1 },
      policyVersion: "policy-1",
      issuedAt,
      expiresAt,
    });
    const request = {
      action: "start" as const,
      runtimeLeaseId: issued.lease.runtimeLeaseId,
      tenantId: "tenant-a",
      userId: "user-a",
      agentId: "bot",
      snapshotVersion: issued.snapshot.snapshotVersion,
    };

    const cold = await lifecycle.acquire(request);
    expect(cold.mode).toBe("cold");
    expect(cold.status.phase).toBe("RUNNING");
    expect(cold.status.execContainerName).toContain("aw-exec-");

    const warm = await lifecycle.acquire(request);
    expect(warm.mode).toBe("warm");
    expect(warm.attachedExistingLease).toBe(true);

    const profileDir = cold.status.browserProfileDir!;
    await fsp.writeFile(path.join(profileDir, "Cookies"), "login-a");
    await fsp.writeFile(path.join(cold.status.workspaceDir!, "note.txt"), "workspace");
    await fsp.writeFile(path.join(cold.status.artifactsDir!, "file.txt"), "artifact");

    const browsed = await lifecycle.browse({ tenantId: "tenant-a", userId: "user-a" });
    expect(browsed.pid).toBeGreaterThan(0);
    expect(await driver.browserAlive(browsed.pid)).toBe(true);

    const idle = await lifecycle.reclaimIdle(nowMs + 5_000);
    expect(idle.reclaimed).toHaveLength(1);
    expect(await fsp.readFile(path.join(profileDir, "Cookies"), "utf8")).toBe("login-a");
    expect(await fsp.readFile(path.join(cold.status.artifactsDir!, "file.txt"), "utf8")).toBe(
      "artifact",
    );

    const again = await lifecycle.acquire(request);
    expect(again.mode).toBe("cold");
    const againBrowse = await lifecycle.browse({ tenantId: "tenant-a", userId: "user-a" });
    mock.markBrowserStopped(againBrowse.containerName);
    expect(await driver.browserAlive(againBrowse.pid)).toBe(false);

    const resumed = await lifecycle.recoverBrowserCrash({
      tenantId: "tenant-a",
      userId: "user-a",
    });
    expect(resumed.disposition).toBe("resume");
    expect(resumed.cookiesPreserved).toBe(true);
    expect(resumed.login).toBe("READY");

    await fsp.writeFile(path.join(profileDir, ACCOUNT_BROWSER_DEVICE_BOUND_FILE), "webauthn");
    mock.markBrowserStopped(
      driver.browserNames.get(resumed.pid ?? -1) ?? againBrowse.containerName,
    );
    // After relaunch, map may point at a new pid's container; mark that one stopped too.
    if (resumed.pid !== null) {
      const name = driver.browserNames.get(resumed.pid);
      if (name) {
        mock.markBrowserStopped(name);
      }
    }
    const reauth = await lifecycle.recoverBrowserCrash({
      tenantId: "tenant-a",
      userId: "user-a",
    });
    expect(reauth.disposition).toBe("resume");
    expect(reauth.login).toBe("REAUTH_REQUIRED");
    expect(reauth.reason).toBe("reauth-required");
    expect(reauth.cookiesPreserved).toBe(true);
    expect(await fsp.readFile(path.join(profileDir, "Cookies"), "utf8")).toBe("login-a");
  });
});

describe("account worker docker driver optional real CLI smoke", () => {
  const enabled =
    process.env.OPENBOT_ACCOUNT_WORKER_DOCKER_E2E === "1" ||
    process.env.OPENBOT_ACCOUNT_WORKER_DOCKER_E2E === "true";

  /**
   * Vitest `test/setup.ts` isolates HOME via withIsolatedTestHome(). Docker
   * Desktop on macOS listens at `$REAL_HOME/.docker/run/docker.sock`, not
   * `/var/run/docker.sock`. Under an isolated HOME the CLI cannot resolve its
   * context and `docker info` fails — the previous gate soft-passed and hid a
   * live daemon. When E2E=1: honor existing DOCKER_HOST; else auto-point at the
   * Desktop sock when default socks are missing; else leave unset (reachability
   * check below fails loud).
   */
  function ensureDockerHostForE2E(): { restore: () => void } {
    const prev = process.env.DOCKER_HOST;
    const restore = () => {
      if (prev === undefined) {
        delete process.env.DOCKER_HOST;
      } else {
        process.env.DOCKER_HOST = prev;
      }
    };
    if (process.env.DOCKER_HOST?.trim()) {
      return { restore };
    }
    const defaultSocks = ["/var/run/docker.sock", "/run/docker.sock"];
    if (
      defaultSocks.some((sock) => {
        try {
          return fs.statSync(sock).isSocket();
        } catch {
          return false;
        }
      })
    ) {
      return { restore };
    }
    const homes: string[] = [];
    const realHome = process.env.OPENCLAW_REAL_HOME?.trim();
    if (realHome) {
      homes.push(realHome);
    }
    try {
      // passwd homedir ignores the isolated $HOME from test setup
      const passwdHome = os.userInfo().homedir;
      if (passwdHome && !homes.includes(passwdHome)) {
        homes.push(passwdHome);
      }
    } catch {
      // ignore userInfo failures (rare in sandboxes)
    }
    for (const home of homes) {
      const sock = path.join(home, ".docker", "run", "docker.sock");
      try {
        if (fs.statSync(sock).isSocket()) {
          process.env.DOCKER_HOST = `unix://${sock}`;
          return { restore };
        }
      } catch {
        // try next
      }
    }
    return { restore };
  }

  async function dockerDaemonReachable(): Promise<boolean> {
    try {
      const { execDocker } = await import("./docker.js");
      const result = await execDocker(["info"], { allowFailure: true });
      return result.code === 0;
    } catch {
      return false;
    }
  }

  async function dockerImagePresent(image: string): Promise<boolean> {
    try {
      const { execDocker } = await import("./docker.js");
      const result = await execDocker(["image", "inspect", image], { allowFailure: true });
      return result.code === 0;
    } catch {
      return false;
    }
  }

  async function resolveE2EImages(): Promise<{
    execImage: string;
    browserImage: string;
    mode: "real" | "alpine-smoke";
  }> {
    const envImages = resolveAccountWorkerImages();
    const execOverride = process.env[ACCOUNT_WORKER_EXEC_IMAGE_ENV]?.trim();
    const browserOverride = process.env[ACCOUNT_WORKER_BROWSER_IMAGE_ENV]?.trim();
    const legacy = process.env[ACCOUNT_WORKER_DOCKER_IMAGE_ENV]?.trim();
    if (execOverride || browserOverride) {
      return {
        execImage: envImages.execImage,
        browserImage: envImages.browserImage,
        mode: "real",
      };
    }
    if (
      (await dockerImagePresent(DEFAULT_SANDBOX_IMAGE)) &&
      (await dockerImagePresent(DEFAULT_SANDBOX_BROWSER_IMAGE))
    ) {
      return {
        execImage: DEFAULT_SANDBOX_IMAGE,
        browserImage: DEFAULT_SANDBOX_BROWSER_IMAGE,
        mode: "real",
      };
    }
    return {
      execImage: legacy || "alpine:3.20",
      browserImage: legacy || "alpine:3.20",
      mode: "alpine-smoke",
    };
  }

  it.skipIf(!enabled)(
    "create/start/stop against a live docker daemon (prefers real sandbox images)",
    async () => {
      const dockerHost = ensureDockerHostForE2E();
      try {
        if (!(await dockerDaemonReachable())) {
          // Explicit E2E gate: soft-pass hid Desktop-sock misses under isolated HOME.
          throw new Error(
            [
              "OPENBOT_ACCOUNT_WORKER_DOCKER_E2E=1 but the docker daemon is unreachable.",
              "Honor an existing DOCKER_HOST, or set DOCKER_HOST=unix://$HOME/.docker/run/docker.sock",
              "for Docker Desktop, then re-run. Ungated suites stay green without a daemon.",
              `DOCKER_HOST=${JSON.stringify(process.env.DOCKER_HOST ?? "")}`,
            ].join(" "),
          );
        }
        const root = await fsp.mkdtemp(path.join(os.tmpdir(), "aw-docker-e2e-"));
        try {
          await fsp.mkdir(path.join(root, "workspace"));
          await fsp.mkdir(path.join(root, "artifacts"));
          await fsp.mkdir(path.join(root, "browser"));
          const images = await resolveE2EImages();
          const spec: RuntimeContainerSpec = {
            runtimeLeaseId: `e2e-${Date.now()}`,
            snapshotVersion: 1,
            image: images.execImage,
            browserImage: images.browserImage,
            execMounts: [
              {
                hostPath: path.join(root, "workspace"),
                containerPath: "/account/workspace",
                access: "rw",
              },
              {
                hostPath: path.join(root, "artifacts"),
                containerPath: "/account/artifacts",
                access: "rw",
              },
            ],
            browserMounts: [
              {
                hostPath: path.join(root, "browser"),
                containerPath: "/account/browser",
                access: "rw",
              },
            ],
          };
          const driver = createDockerAccountSandboxDriver();
          const exec = await driver.startExec(spec);
          expect(exec.containerName).toContain("aw-exec-");

          const browser = await driver.startBrowser(spec);
          expect(browser.containerName).toContain("aw-browser-");
          if (images.mode === "real") {
            // Real browser image keeps Chromium/entrypoint alive.
            expect(await driver.browserAlive(browser.pid)).toBe(true);
            // Give entrypoint a moment; still expect running.
            await new Promise((r) => setTimeout(r, 1500));
            expect(await driver.browserAlive(browser.pid)).toBe(true);
          }
          await driver.stopBrowser(browser.pid);
          await driver.stopExec(exec.containerName);
          expect(await driver.browserAlive(browser.pid)).toBe(false);
        } finally {
          await fsp.rm(root, { recursive: true, force: true });
        }
      } finally {
        dockerHost.restore();
      }
    },
  );

  it("documents that ungated suites stay green without a daemon", () => {
    // Default CI/local runs skip the live-daemon case above when the gate is off.
    expect(typeof enabled).toBe("boolean");
    expect(createDockerAccountSandboxDriver).toEqual(expect.any(Function));
    expect(createMemoryAccountSandboxDriver).toEqual(expect.any(Function));
    expect(resolveAccountWorkerImages().browserImage).toBe(DEFAULT_SANDBOX_BROWSER_IMAGE);
  });
});
