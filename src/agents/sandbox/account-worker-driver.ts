/**
 * Worker-owned sandbox driver seam (v4.1 §10).
 *
 * Container argv is built from the controller spec. A Gateway request never
 * supplies the image(s) or the mounts. Exec and browser use distinct operator
 * images (see resolveAccountWorkerImages). The memory driver is the prototype
 * stand-in: it does not call the docker CLI. The docker driver executes only
 * argv from buildAccountWorkerContainerArgs plus start/stop/inspect/rm.
 *
 * Memory ≠ production complete. Real-daemon e2e still required before any
 * production-complete claim.
 */
import { createHash } from "node:crypto";
import path from "node:path";
import { ACCOUNT_BROWSER_CONTAINER_DIR } from "./account-mounts.js";
import { isAccountWorkerEnvFlagOn } from "./account-worker-flags.js";
import {
  DEFAULT_SANDBOX_BROWSER_CDP_PORT,
  DEFAULT_SANDBOX_BROWSER_IMAGE,
  DEFAULT_SANDBOX_BROWSER_NOVNC_PORT,
  DEFAULT_SANDBOX_BROWSER_VNC_PORT,
  DEFAULT_SANDBOX_IMAGE,
  planSandboxImageAlias,
  sandboxImageCompatPeer,
} from "./constants.js";
import {
  formatHostEngineDockerBind,
  translateAccountDockerBindSource,
  type HostEngineBindOptions,
} from "./host-engine-bind-path.js";
import { generateNoVncPassword, NOVNC_PASSWORD_ENV_KEY } from "./novnc-auth.js";
import type { RuntimeContainerSpec } from "./runtime-controller.js";
import { ensureSandboxRuntimeOwnership } from "./sandbox-runtime-ownership.js";

export type AccountWorkerSandboxDriver = {
  startExec(spec: RuntimeContainerSpec): Promise<{ containerName: string }>;
  stopExec(containerName: string): Promise<void>;
  startBrowser(spec: RuntimeContainerSpec): Promise<{ pid: number; containerName: string }>;
  stopBrowser(pid: number): Promise<void>;
  /** False after a crash or stop. The profile directory is not involved. */
  browserAlive(pid: number): Promise<boolean>;
};

export type AccountWorkerDockerRunResult = {
  stdout: string;
  stderr: string;
  code: number;
};

/** Injectable docker CLI. Production wires the real CLI; unit tests mock it. */
/**
 * noVNC passwords for browser containers this process started.
 * Kept off worker status, journals, and model context. Publish reads it back
 * so a failed docker inspect does not drop the observer slot.
 */
const browserNoVncPasswords = new Map<string, string>();

export function readAccountWorkerBrowserNoVncPassword(containerName: string): string | null {
  const value = browserNoVncPasswords.get(containerName.trim());
  const trimmed = value?.trim() ?? "";
  return trimmed || null;
}

export function resetAccountWorkerBrowserNoVncPasswordsForTests(): void {
  browserNoVncPasswords.clear();
}

export type AccountWorkerDockerRunner = (
  args: string[],
  opts?: { allowFailure?: boolean },
) => Promise<AccountWorkerDockerRunResult>;

export const ACCOUNT_WORKER_DOCKER_DRIVER_FLAG = "OPENBOT_ACCOUNT_WORKER_DOCKER";

/** Operator override for the exec/sleep image. Never taken from a Gateway body. */
export const ACCOUNT_WORKER_EXEC_IMAGE_ENV = "OPENBOT_ACCOUNT_WORKER_EXEC_IMAGE";
/** Operator override for the browser sandbox image. Never taken from a Gateway body. */
export const ACCOUNT_WORKER_BROWSER_IMAGE_ENV = "OPENBOT_ACCOUNT_WORKER_BROWSER_IMAGE";
/**
 * Legacy single-image override (alpine smoke / early cutover). Applies to the
 * exec image only; browser stays on DEFAULT_SANDBOX_BROWSER_IMAGE unless
 * OPENBOT_ACCOUNT_WORKER_BROWSER_IMAGE is set.
 */
export const ACCOUNT_WORKER_DOCKER_IMAGE_ENV = "OPENBOT_ACCOUNT_WORKER_DOCKER_IMAGE";

export type AccountWorkerImages = {
  execImage: string;
  browserImage: string;
};

function trimImage(value: string | undefined): string {
  return value?.trim() ?? "";
}

/**
 * Resolve operator-controlled Account Worker images.
 * Priority: dedicated env → operator config → legacy docker image env (exec only)
 * → repo defaults (`openbot-sandbox:bookworm-slim` and
 * `openbot-sandbox-browser:bookworm-slim`, each with a temporary
 * `openclaw-sandbox*` alias).
 * Gateway clients cannot supply these values.
 */
export function resolveAccountWorkerImages(params?: {
  env?: NodeJS.ProcessEnv;
  /** Operator config docker/exec image. */
  configExecImage?: string;
  /** Operator config browser image. */
  configBrowserImage?: string;
}): AccountWorkerImages {
  const env = params?.env ?? process.env;
  const legacy = trimImage(env[ACCOUNT_WORKER_DOCKER_IMAGE_ENV]);
  const execImage =
    trimImage(env[ACCOUNT_WORKER_EXEC_IMAGE_ENV]) ||
    trimImage(params?.configExecImage) ||
    legacy ||
    DEFAULT_SANDBOX_IMAGE;
  const browserImage =
    trimImage(env[ACCOUNT_WORKER_BROWSER_IMAGE_ENV]) ||
    trimImage(params?.configBrowserImage) ||
    DEFAULT_SANDBOX_BROWSER_IMAGE;
  if (!execImage || !browserImage) {
    throw new Error("account worker images are required");
  }
  return { execImage, browserImage };
}

/** Docker create argv built only from the controller spec. */
export function buildAccountWorkerContainerArgs(params: {
  spec: RuntimeContainerSpec;
  kind: "exec" | "browser";
  name: string;
  /**
   * VNC password for the browser container. Alphanumeric, operator-generated.
   * Never taken from a Gateway body or written into model context.
   */
  noVncPassword?: string;
  /**
   * Path B: rewrite container-visible tenants paths to the host engine source
   * before they are passed as bind mounts. Omitted in unit tests that are
   * not exercising that translation.
   */
  bindTranslation?: HostEngineBindOptions;
}): string[] {
  const mounts = params.kind === "exec" ? params.spec.execMounts : params.spec.browserMounts;
  const image = params.kind === "exec" ? params.spec.image : params.spec.browserImage;
  // Never registry-pull operator sandbox images on create miss (LIVE: denied
  // pull of openbot-sandbox-browser:*). Local short-name / localhost only.
  const args = ["create", "--pull=never", "--name", params.name];
  for (const mount of mounts) {
    args.push("-v", formatHostEngineDockerBind(mount, params.bindTranslation));
  }
  if (params.kind === "browser") {
    // Desktop + noVNC so Control UI can attach one live iframe.
    // The entrypoint starts websockify only when noVNC is on and headless is off.
    // Profile mount is /account/browser; entrypoint also auto-detects that path.
    const noVncPassword = params.noVncPassword?.trim() ?? "";
    args.push("-e", `OPENBOT_BROWSER_USER_DATA_DIR=${ACCOUNT_BROWSER_CONTAINER_DIR}`);
    args.push("-e", `OPENCLAW_BROWSER_USER_DATA_DIR=${ACCOUNT_BROWSER_CONTAINER_DIR}`);
    args.push("-e", "OPENCLAW_BROWSER_NO_SANDBOX=1");
    args.push("-e", "OPENBOT_BROWSER_NO_SANDBOX=1");
    args.push("-e", "OPENCLAW_BROWSER_HEADLESS=0");
    args.push("-e", "OPENCLAW_BROWSER_ENABLE_NOVNC=1");
    args.push("-e", `OPENCLAW_BROWSER_CDP_PORT=${DEFAULT_SANDBOX_BROWSER_CDP_PORT}`);
    args.push("-e", `OPENCLAW_BROWSER_VNC_PORT=${DEFAULT_SANDBOX_BROWSER_VNC_PORT}`);
    args.push("-e", `OPENCLAW_BROWSER_NOVNC_PORT=${DEFAULT_SANDBOX_BROWSER_NOVNC_PORT}`);
    if (noVncPassword) {
      args.push("-e", `${NOVNC_PASSWORD_ENV_KEY}=${noVncPassword}`);
    }
    // Loopback publish. Host ports are dynamic; the observer slot records them.
    args.push("-p", `127.0.0.1::${DEFAULT_SANDBOX_BROWSER_CDP_PORT}`);
    args.push("-p", `127.0.0.1::${DEFAULT_SANDBOX_BROWSER_NOVNC_PORT}`);
  }
  args.push(image);
  if (params.kind === "exec") {
    args.push("sleep", "infinity");
  }
  return args;
}

export function accountWorkerContainerName(
  kind: "exec" | "browser",
  runtimeLeaseId: string,
): string {
  return `aw-${kind}-${runtimeLeaseId}`.slice(0, 63);
}

/** Legacy per-lease browser containers. Startup keeps one of these per profile. */
export const ACCOUNT_BROWSER_LEASE_NAME_PREFIX = "aw-browser-lease-";
/** Stable per-user browser container. Used when no browser is already running. */
export const ACCOUNT_BROWSER_USER_NAME_PREFIX = "aw-browser-user-";

const ACCOUNT_BROWSER_INSPECT_FORMAT =
  "{{.State.Running}}\t{{.State.StartedAt}}\t{{range .Mounts}}{{.Destination}}={{.Source}}\n{{end}}";

/**
 * One browser container name per user-data directory.
 * The hash is the resolved profile path, which is already one directory per tenant and user.
 */
export function accountSharedBrowserContainerName(profileHostPath: string): string {
  const digest = createHash("sha256")
    .update(path.resolve(profileHostPath))
    .digest("hex")
    .slice(0, 20);
  return `${ACCOUNT_BROWSER_USER_NAME_PREFIX}${digest}`;
}

export type AccountBrowserContainerRecord = {
  name: string;
  running: boolean;
  startedAtMs: number;
  profileHostPath: string;
};

/**
 * Keep the most recently started running browser on one profile.
 * Every other running container in the group is stopped.
 */
export function chooseSharedAccountBrowser(records: readonly AccountBrowserContainerRecord[]): {
  keep: string | null;
  stop: string[];
} {
  const running = records.filter(
    (record) => record.running && record.name.startsWith("aw-browser-"),
  );
  if (running.length === 0) {
    return { keep: null, stop: [] };
  }
  const ranked = [...running].toSorted((left, right) => {
    if (left.startedAtMs !== right.startedAtMs) {
      return right.startedAtMs - left.startedAtMs;
    }
    if (left.name === right.name) {
      return 0;
    }
    return left.name < right.name ? -1 : 1;
  });
  const keep = ranked[0]?.name ?? null;
  return {
    keep,
    stop: ranked.slice(1).map((record) => record.name),
  };
}

export function planAccountBrowserReconciliation(
  records: readonly AccountBrowserContainerRecord[],
): {
  kept: string[];
  stop: string[];
} {
  const groups = new Map<string, AccountBrowserContainerRecord[]>();
  for (const record of records) {
    if (!record.running || !record.profileHostPath.trim()) {
      continue;
    }
    const key = path.resolve(record.profileHostPath);
    const group = groups.get(key) ?? [];
    group.push(record);
    groups.set(key, group);
  }
  const kept: string[] = [];
  const stop: string[] = [];
  for (const group of groups.values()) {
    const choice = chooseSharedAccountBrowser(group);
    if (choice.keep) {
      kept.push(choice.keep);
    }
    stop.push(...choice.stop);
  }
  return { kept, stop };
}

export function parseAccountBrowserInspect(stdout: string): {
  running: boolean;
  startedAtMs: number;
  profileHostPath: string | null;
} {
  const lines = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const first = lines[0] ?? "";
  const tab = first.split("\t");
  const running = tab[0] === "true";
  const startedAtMs = Date.parse(tab[1] ?? "");
  const mounts = [tab.slice(2).join("\t"), ...lines.slice(1)].filter((line) => line.length > 0);
  let profileHostPath: string | null = null;
  for (const mount of mounts) {
    const eq = mount.indexOf("=");
    if (eq <= 0) {
      continue;
    }
    const destination = mount.slice(0, eq);
    const source = mount.slice(eq + 1);
    if (destination === ACCOUNT_BROWSER_CONTAINER_DIR && source.trim()) {
      profileHostPath = source.trim();
    }
  }
  return {
    running,
    startedAtMs: Number.isFinite(startedAtMs) ? startedAtMs : 0,
    profileHostPath,
  };
}

export async function listRunningAccountBrowserContainers(
  runDocker: AccountWorkerDockerRunner,
): Promise<AccountBrowserContainerRecord[]> {
  const listed = await runDocker(["ps", "--filter", "name=aw-browser-", "--format", "{{.Names}}"], {
    allowFailure: true,
  });
  if (listed.code !== 0) {
    return [];
  }
  const names = listed.stdout
    .split("\n")
    .map((line) => line.trim().replace(/^\//, ""))
    .filter((name) => name.startsWith("aw-browser-"));
  const records: AccountBrowserContainerRecord[] = [];
  for (const name of names) {
    const inspected = await runDocker(["inspect", "-f", ACCOUNT_BROWSER_INSPECT_FORMAT, name], {
      allowFailure: true,
    });
    if (inspected.code !== 0) {
      continue;
    }
    const parsed = parseAccountBrowserInspect(inspected.stdout);
    if (!parsed.running || !parsed.profileHostPath) {
      continue;
    }
    records.push({
      name,
      running: true,
      startedAtMs: parsed.startedAtMs,
      profileHostPath: parsed.profileHostPath,
    });
  }
  return records;
}

/**
 * Startup migration. Running `aw-browser-*` containers that mount the same
 * profile are reduced to the most recently started one. Stopped containers
 * are left for the next create to replace.
 */
export async function reconcileRunningAccountBrowsers(
  runDocker: AccountWorkerDockerRunner = defaultDockerRunner,
): Promise<{ kept: string[]; stopped: string[] }> {
  const records = await listRunningAccountBrowserContainers(runDocker);
  const plan = planAccountBrowserReconciliation(records);
  for (const name of plan.stop) {
    browserNoVncPasswords.delete(name);
    await runDocker(["stop", name], { allowFailure: true });
    await runDocker(["rm", "-f", name], { allowFailure: true });
  }
  return { kept: plan.kept, stopped: plan.stop };
}

function browserProfileHostPath(spec: RuntimeContainerSpec): string | null {
  const mount = spec.browserMounts.find(
    (entry) => entry.containerPath === ACCOUNT_BROWSER_CONTAINER_DIR,
  );
  const hostPath = mount?.hostPath.trim() ?? "";
  return hostPath ? path.resolve(hostPath) : null;
}

function sameProfile(
  containerVisible: string,
  inspectSource: string,
  options?: HostEngineBindOptions,
): boolean {
  const observed = path.resolve(inspectSource);
  if (path.resolve(containerVisible) === observed) {
    return true;
  }
  return path.resolve(translateAccountDockerBindSource(containerVisible, options)) === observed;
}

async function defaultPrepareVisibleMounts(directories: readonly string[]): Promise<void> {
  // Chown the process-visible directories. On Path B those inodes are the
  // tenants volume and `$STATE_DIR/operators/...`. `formatHostEngineDockerBind`
  // must emit that same inode's host source. A relocated operators path that
  // is not translated becomes a second root:root directory and the browser
  // cannot mkdir Default.
  await ensureSandboxRuntimeOwnership(directories);
}

/** P6b: unset defaults ON; set `0`/`false`/`off`/`no` to keep memory / roll back. */
export function isAccountWorkerDockerDriverEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return isAccountWorkerEnvFlagOn(env[ACCOUNT_WORKER_DOCKER_DRIVER_FLAG]);
}

/**
 * Default driver selection. P6b: Docker when the docker flag is unset or on.
 * Explicit `OPENBOT_ACCOUNT_WORKER_DOCKER=0` keeps the memory driver (tests / rollback).
 */
export function resolveDefaultAccountWorkerSandboxDriver(
  env: NodeJS.ProcessEnv = process.env,
  options?: { runDocker?: AccountWorkerDockerRunner },
): AccountWorkerSandboxDriver {
  if (isAccountWorkerDockerDriverEnabled(env)) {
    return createDockerAccountSandboxDriver(options);
  }
  return createMemoryAccountSandboxDriver();
}

export function createMemoryAccountSandboxDriver(): AccountWorkerSandboxDriver & {
  execStarts: RuntimeContainerSpec[];
  browserStarts: RuntimeContainerSpec[];
  stoppedExec: string[];
  stoppedBrowsers: number[];
  crashedBrowsers: number[];
  crashBrowser(pid: number): void;
} {
  let nextPid = 1;
  const execStarts: RuntimeContainerSpec[] = [];
  const browserStarts: RuntimeContainerSpec[] = [];
  const stoppedExec: string[] = [];
  const stoppedBrowsers: number[] = [];
  const crashedBrowsers: number[] = [];
  const liveBrowsers = new Set<number>();
  const browsersByProfile = new Map<string, { pid: number; containerName: string }>();
  return {
    execStarts,
    browserStarts,
    stoppedExec,
    stoppedBrowsers,
    crashedBrowsers,
    crashBrowser(pid) {
      if (liveBrowsers.delete(pid)) {
        crashedBrowsers.push(pid);
      }
    },
    async startExec(spec) {
      execStarts.push(spec);
      return { containerName: accountWorkerContainerName("exec", spec.runtimeLeaseId) };
    },
    async stopExec(containerName) {
      stoppedExec.push(containerName);
    },
    async startBrowser(spec) {
      const profile = browserProfileHostPath(spec);
      const containerName = profile
        ? accountSharedBrowserContainerName(profile)
        : accountWorkerContainerName("browser", spec.runtimeLeaseId);
      if (profile) {
        const existing = browsersByProfile.get(profile);
        if (existing && liveBrowsers.has(existing.pid)) {
          return { pid: existing.pid, containerName: existing.containerName };
        }
      }
      browserStarts.push(spec);
      const pid = nextPid;
      nextPid += 1;
      liveBrowsers.add(pid);
      if (profile) {
        browsersByProfile.set(profile, { pid, containerName });
      }
      return { pid, containerName };
    },
    async stopBrowser(pid) {
      liveBrowsers.delete(pid);
      stoppedBrowsers.push(pid);
      for (const [profile, entry] of browsersByProfile) {
        if (entry.pid === pid) {
          browsersByProfile.delete(profile);
        }
      }
    },
    async browserAlive(pid) {
      return liveBrowsers.has(pid);
    },
  };
}

async function defaultDockerRunner(
  args: string[],
  opts?: { allowFailure?: boolean },
): Promise<AccountWorkerDockerRunResult> {
  // CLI when it is on PATH. A mounted docker.sock / podman.sock uses the engine
  // API instead of failing the turn with ENOENT. No client and no socket throws
  // DockerCliMissingError before spawn.
  const { executeAccountWorkerDockerCommand } = await import("./docker-engine-client.js");
  return executeAccountWorkerDockerCommand(args, opts);
}

/**
 * True Docker Account Worker driver. Executes only controller-built create
 * argv, then start / stop / inspect / rm. Never accepts Gateway-supplied
 * image, mounts, hostPath, or docker params.
 */
export function createDockerAccountSandboxDriver(options?: {
  runDocker?: AccountWorkerDockerRunner;
  /** Test seam. Production chowns the container-visible mount sources. */
  prepareVisibleMounts?: (directories: readonly string[]) => Promise<void>;
  bindTranslation?: HostEngineBindOptions;
}): AccountWorkerSandboxDriver & {
  /** Test/observability: create argv passed to the CLI (excluding the verb). */
  lastCreateArgs: string[][];
  browserNames: Map<number, string>;
} {
  const runDocker = options?.runDocker ?? defaultDockerRunner;
  const prepareVisibleMounts = options?.prepareVisibleMounts ?? defaultPrepareVisibleMounts;
  const bindTranslation = options?.bindTranslation;
  let nextPid = 1;
  const browserNames = new Map<number, string>();
  const lastCreateArgs: string[][] = [];
  const profileTails = new Map<string, Promise<void>>();

  function lockProfile<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = profileTails.get(key) ?? Promise.resolve();
    const run = previous.then(fn, fn);
    profileTails.set(
      key,
      run.then(
        () => undefined,
        () => undefined,
      ),
    );
    return run;
  }

  async function imagePresent(image: string): Promise<"yes" | "no" | "unknown"> {
    const result = await runDocker(["image", "inspect", image], { allowFailure: true });
    if (result.code === 0) {
      return "yes";
    }
    const text = `${result.stderr}\n${result.stdout}`.toLowerCase();
    if (text.includes("no such image") || text.includes("no such object")) {
      return "no";
    }
    return "unknown";
  }

  async function resolveAliasedImage(image: string): Promise<string> {
    const trimmed = image.trim();
    if (!trimmed) {
      return image;
    }
    // Prefer an already-local name. Podman often stores builds as localhost/<name>.
    const localhostVariant = trimmed.startsWith("localhost/")
      ? trimmed
      : trimmed.includes("/")
        ? null
        : `localhost/${trimmed}`;
    const shortVariant =
      trimmed.startsWith("localhost/") && trimmed.split("/").length === 2
        ? trimmed.slice("localhost/".length)
        : null;
    for (const candidate of [trimmed, localhostVariant, shortVariant]) {
      if (!candidate) {
        continue;
      }
      if ((await imagePresent(candidate)) === "yes") {
        return candidate;
      }
    }
    const peer = sandboxImageCompatPeer(trimmed);
    if (!peer) {
      return trimmed;
    }
    const peerLocalhost = peer.includes("/") ? null : `localhost/${peer}`;
    for (const candidate of [peer, peerLocalhost]) {
      if (!candidate) {
        continue;
      }
      if ((await imagePresent(candidate)) === "yes") {
        const plan = planSandboxImageAlias({
          requested: trimmed,
          requestedPresent: false,
          peerPresent: true,
        });
        if (plan.kind === "retag") {
          const tagged = await runDocker(["tag", candidate, plan.to], { allowFailure: true });
          return tagged.code === 0 ? plan.to : candidate;
        }
        return candidate;
      }
    }
    return trimmed;
  }

  async function ensureCreatedAndStarted(params: {
    kind: "exec" | "browser";
    spec: RuntimeContainerSpec;
    name: string;
    noVncPassword?: string;
  }): Promise<void> {
    const spec =
      params.kind === "exec"
        ? { ...params.spec, image: await resolveAliasedImage(params.spec.image) }
        : {
            ...params.spec,
            browserImage: await resolveAliasedImage(params.spec.browserImage),
          };
    const mounts = params.kind === "exec" ? spec.execMounts : spec.browserMounts;
    await prepareVisibleMounts(mounts.map((mount) => mount.hostPath));
    const createArgs = buildAccountWorkerContainerArgs({
      ...params,
      spec,
      bindTranslation,
    });
    lastCreateArgs.push(createArgs);
    if (createArgs.some((arg) => arg.includes("docker.sock"))) {
      throw new Error("Account worker docker driver refuses a docker.sock mount.");
    }
    const created = await runDocker(createArgs, { allowFailure: true });
    if (created.code !== 0) {
      const detail = `${created.stderr}\n${created.stdout}`.toLowerCase();
      const nameConflict =
        detail.includes("is already in use") ||
        detail.includes("already exists") ||
        detail.includes("conflict");
      if (!nameConflict) {
        const failureDetail = created.stderr.trim() || created.stdout.trim() || params.name;
        throw new Error(`docker create failed: ${failureDetail}`);
      }
      await runDocker(["rm", "-f", params.name], { allowFailure: true });
      await runDocker(createArgs);
    }
    try {
      await runDocker(["start", params.name]);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      // Missing CLI stays a DockerCliMissingError so the turn can continue on
      // the host. Other start failures must keep a prefix the visible-error
      // classifier recognizes; raw daemon stderr does not.
      if (
        /docker create failed|docker start failed|DOCKER_CLI_MISSING|cannot connect to the docker daemon/i.test(
          detail,
        )
      ) {
        throw error;
      }
      throw new Error(`docker start failed: ${detail}`, { cause: error });
    }
  }

  async function stopAndRemove(containerName: string): Promise<void> {
    browserNoVncPasswords.delete(containerName);
    await runDocker(["stop", containerName], { allowFailure: true });
    await runDocker(["rm", "-f", containerName], { allowFailure: true });
  }

  async function containerRunning(containerName: string): Promise<boolean> {
    const result = await runDocker(["inspect", "-f", "{{.State.Running}}", containerName], {
      allowFailure: true,
    });
    if (result.code !== 0) {
      return false;
    }
    return result.stdout.trim() === "true";
  }

  return {
    lastCreateArgs,
    browserNames,
    async startExec(spec) {
      const containerName = accountWorkerContainerName("exec", spec.runtimeLeaseId);
      await ensureCreatedAndStarted({ kind: "exec", spec, name: containerName });
      return { containerName };
    },
    async stopExec(containerName) {
      await stopAndRemove(containerName);
    },
    async startBrowser(spec) {
      const profile = browserProfileHostPath(spec);
      const canonical = profile
        ? accountSharedBrowserContainerName(profile)
        : accountWorkerContainerName("browser", spec.runtimeLeaseId);
      const lockKey = profile ?? canonical;
      return lockProfile(lockKey, async () => {
        if (profile) {
          const running = (await listRunningAccountBrowserContainers(runDocker)).filter((record) =>
            sameProfile(profile, record.profileHostPath, bindTranslation),
          );
          const choice = chooseSharedAccountBrowser(running);
          for (const name of choice.stop) {
            await stopAndRemove(name);
          }
          if (choice.keep) {
            return adoptBrowser(choice.keep, false);
          }
        }
        const noVncPassword = generateNoVncPassword();
        await ensureCreatedAndStarted({
          kind: "browser",
          spec,
          name: canonical,
          noVncPassword,
        });
        browserNoVncPasswords.set(canonical, noVncPassword);
        return adoptBrowser(canonical, true);
      });

      function adoptBrowser(
        containerName: string,
        recreated: boolean,
      ): { pid: number; containerName: string } {
        if (!recreated) {
          for (const [pid, name] of browserNames) {
            if (name === containerName) {
              return { pid, containerName };
            }
          }
        } else {
          const stale: number[] = [];
          for (const [pid, name] of browserNames) {
            if (name === containerName) {
              stale.push(pid);
            }
          }
          for (const pid of stale) {
            browserNames.delete(pid);
          }
        }
        const pid = nextPid;
        nextPid += 1;
        browserNames.set(pid, containerName);
        return { pid, containerName };
      }
    },
    async stopBrowser(pid) {
      const containerName = browserNames.get(pid);
      browserNames.delete(pid);
      if (!containerName) {
        return;
      }
      await stopAndRemove(containerName);
    },
    async browserAlive(pid) {
      const containerName = browserNames.get(pid);
      if (!containerName) {
        return false;
      }
      return containerRunning(containerName);
    },
  };
}
