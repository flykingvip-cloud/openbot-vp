import { readFileSync } from "node:fs";
import { chmod, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  accountWorkerContainerName,
  createDockerAccountSandboxDriver,
} from "./account-worker-driver.js";
import { DEFAULT_SANDBOX_IMAGE } from "./constants.js";
import {
  decideAccountWorkerDockerFailure,
  DockerCliMissingError,
  DockerEngineUnreachableError,
  executeAccountWorkerDockerCommand,
  formatDockerCliMissingUserMessage,
  readDockerContainerLivenessViaEngine,
  readDockerPortViaEngine,
  resolveAccountWorkerDockerTransport,
  userFacingPreReplyFailure,
  type DockerEngineRequest,
} from "./docker-engine-client.js";
import {
  interpretDockerInspectLiveness,
  resolveContainerLivenessFromProbes,
  resolveDockerSpawnInvocation,
} from "./docker.js";
import type { RuntimeContainerSpec } from "./runtime-controller.js";

const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");

describe("resolveAccountWorkerDockerTransport", () => {
  it("reports missing when PATH has no docker binary and no engine socket", () => {
    expect(
      resolveAccountWorkerDockerTransport({
        env: { PATH: "/usr/bin" },
        pathExists: () => false,
        isSocket: () => false,
      }),
    ).toEqual({ kind: "missing" });
  });

  it("prefers a docker binary on PATH and still records a mounted socket", () => {
    const transport = resolveAccountWorkerDockerTransport({
      env: { PATH: "/usr/bin", DOCKER_HOST: "unix:///var/run/docker.sock" },
      pathExists: (file) => file === "/usr/bin/docker",
      isSocket: (file) => file === "/var/run/docker.sock",
    });
    expect(transport).toEqual({
      kind: "cli",
      bin: "/usr/bin/docker",
      socketPath: "/var/run/docker.sock",
    });
  });

  it("uses podman.sock when the CLI is absent", () => {
    const transport = resolveAccountWorkerDockerTransport({
      env: { PATH: "" },
      pathExists: () => false,
      isSocket: (file) => file === "/run/podman/podman.sock",
    });
    expect(transport).toEqual({ kind: "socket", socketPath: "/run/podman/podman.sock" });
  });

  it("honors OPENBOT_DOCKER_BIN", () => {
    const transport = resolveAccountWorkerDockerTransport({
      env: { PATH: "", OPENBOT_DOCKER_BIN: "/opt/bin/docker" },
      pathExists: (file) => file === "/opt/bin/docker",
      isSocket: () => false,
    });
    expect(transport.kind).toBe("cli");
  });
});

describe("executeAccountWorkerDockerCommand", () => {
  it("throws DockerCliMissingError before spawn when the CLI and socket are both absent", async () => {
    await expect(
      executeAccountWorkerDockerCommand(["version"], {
        env: { PATH: "" },
        pathExists: () => false,
        isSocket: () => false,
      }),
    ).rejects.toBeInstanceOf(DockerCliMissingError);
  });

  it("posts create argv to the engine socket and does not call the CLI", async () => {
    const calls: Array<{ method: string; path: string; body?: unknown }> = [];
    const request: DockerEngineRequest = async (params) => {
      calls.push({ method: params.method, path: params.path, body: params.body });
      return { status: 201, body: JSON.stringify({ Id: "abc" }) };
    };
    const result = await executeAccountWorkerDockerCommand(
      [
        "create",
        "--name",
        "aw-exec-1",
        "-v",
        "/data/workspace:/account/workspace:rw",
        "-e",
        "OPENCLAW_BROWSER_ENABLE_NOVNC=1",
        "-p",
        "127.0.0.1::6080",
        "openclaw-sandbox:bookworm-slim",
        "sleep",
        "infinity",
      ],
      {
        env: { PATH: "" },
        pathExists: () => false,
        isSocket: (file) => file === "/var/run/docker.sock",
        request,
      },
    );
    expect(result.code).toBe(0);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.path).toContain("/containers/create?name=aw-exec-1");
    const body = calls[0]?.body as {
      Image: string;
      Cmd: string[];
      Env: string[];
      HostConfig: { Binds: string[]; PortBindings: Record<string, Array<{ HostIp: string }>> };
    };
    expect(body.Image).toBe("openclaw-sandbox:bookworm-slim");
    expect(body.Cmd).toEqual(["sleep", "infinity"]);
    expect(body.Env).toEqual(["OPENCLAW_BROWSER_ENABLE_NOVNC=1"]);
    expect(body.HostConfig.Binds).toEqual(["/data/workspace:/account/workspace:rw"]);
    expect(body.HostConfig.PortBindings["6080/tcp"]?.[0]?.HostIp).toBe("127.0.0.1");
    expect(JSON.stringify(body)).not.toContain("docker.sock");
  });

  it("returns a name conflict from HTTP 409 so the driver can recreate", async () => {
    const request: DockerEngineRequest = async () => ({
      status: 409,
      body: 'Conflict. The container name "/aw-exec-1" is already in use',
    });
    const result = await executeAccountWorkerDockerCommand(
      ["create", "--name", "aw-exec-1", "alpine"],
      {
        allowFailure: true,
        env: { PATH: "" },
        pathExists: () => false,
        isSocket: () => true,
        request,
      },
    );
    expect(result.code).toBe(1);
    expect(result.stderr.toLowerCase()).toContain("already in use");
  });

  it("refuses a docker.sock bind before calling the engine", async () => {
    const request: DockerEngineRequest = async () => {
      throw new Error("engine should not be called");
    };
    await expect(
      executeAccountWorkerDockerCommand(
        [
          "create",
          "--name",
          "aw-exec-1",
          "-v",
          "/var/run/docker.sock:/var/run/docker.sock",
          "alpine",
        ],
        {
          env: { PATH: "" },
          pathExists: () => false,
          isSocket: () => true,
          request,
        },
      ),
    ).rejects.toThrow(/docker\.sock/);
  });

  it("reads a published noVNC port from inspect JSON", async () => {
    const request: DockerEngineRequest = async () => ({
      status: 200,
      body: JSON.stringify({
        State: { Running: true },
        NetworkSettings: {
          Ports: { "6080/tcp": [{ HostIp: "127.0.0.1", HostPort: "32768" }] },
        },
      }),
    });
    await expect(
      readDockerPortViaEngine({
        socketPath: "/var/run/docker.sock",
        containerName: "aw-browser-1",
        port: 6080,
        request,
      }),
    ).resolves.toBe(32768);
  });

  it("does not publish a noVNC port for an exited container", async () => {
    const request: DockerEngineRequest = async () => ({
      status: 200,
      body: JSON.stringify({
        State: { Running: false, ExitCode: 1 },
        NetworkSettings: {
          Ports: { "6080/tcp": [{ HostIp: "127.0.0.1", HostPort: "40795" }] },
        },
      }),
    });
    await expect(
      readDockerPortViaEngine({
        socketPath: "/var/run/docker.sock",
        containerName: "aw-browser-user-dead",
        port: 6080,
        request,
      }),
    ).resolves.toBeNull();
  });

  it("reads running, stopped, and unknown from the engine inspect", async () => {
    await expect(
      readDockerContainerLivenessViaEngine({
        socketPath: "/var/run/docker.sock",
        containerName: "aw-browser-user-live",
        request: async () => ({
          status: 200,
          body: JSON.stringify({ State: { Running: true } }),
        }),
      }),
    ).resolves.toBe("running");
    await expect(
      readDockerContainerLivenessViaEngine({
        socketPath: "/var/run/docker.sock",
        containerName: "aw-browser-user-dead",
        request: async () => ({
          status: 404,
          body: "No such container: aw-browser-user-dead",
        }),
      }),
    ).resolves.toBe("stopped");
    await expect(
      readDockerContainerLivenessViaEngine({
        socketPath: "/var/run/docker.sock",
        containerName: "aw-browser-user-live",
        request: async () => {
          throw new DockerEngineUnreachableError("/var/run/docker.sock", "EACCES: connect EACCES");
        },
      }),
    ).resolves.toBe("unknown");
  });

  it("returns null when the engine socket refuses the port lookup", async () => {
    await expect(
      readDockerPortViaEngine({
        socketPath: "/var/run/docker.sock",
        containerName: "aw-browser-1",
        port: 6080,
        request: async () => {
          throw new DockerEngineUnreachableError("/var/run/docker.sock", "EACCES: connect EACCES");
        },
      }),
    ).resolves.toBeNull();
  });

  it("propagates an unreachable socket instead of the missing-CLI error", async () => {
    await expect(
      executeAccountWorkerDockerCommand(["start", "aw-exec-1"], {
        env: { PATH: "" },
        pathExists: () => false,
        isSocket: () => true,
        request: async () => {
          throw new DockerEngineUnreachableError("/var/run/docker.sock", "EACCES: connect EACCES");
        },
      }),
    ).rejects.toBeInstanceOf(DockerEngineUnreachableError);
  });

  it("falls back to the socket when the CLI spawn reports ENOENT", async () => {
    let engineCalled = false;
    const request: DockerEngineRequest = async () => {
      engineCalled = true;
      return { status: 204, body: "" };
    };
    const result = await executeAccountWorkerDockerCommand(["start", "aw-exec-1"], {
      env: { PATH: "/usr/bin" },
      pathExists: (file) => file === "/usr/bin/docker",
      isSocket: (file) => file === "/var/run/docker.sock",
      request,
      runCli: async () => {
        throw Object.assign(new Error("spawn docker ENOENT"), { code: "ENOENT" });
      },
    });
    expect(result.code).toBe(0);
    expect(engineCalled).toBe(true);
  });

  it("inspects an image over the socket instead of throwing before a reply", async () => {
    const calls: string[] = [];
    const request: DockerEngineRequest = async (params) => {
      calls.push(`${params.method} ${params.path}`);
      return { status: 200, body: JSON.stringify({ Id: "sha256:abc" }) };
    };
    const result = await executeAccountWorkerDockerCommand(
      ["image", "inspect", "openbot-sandbox:bookworm-slim"],
      {
        allowFailure: true,
        env: { PATH: "" },
        pathExists: () => false,
        isSocket: () => true,
        request,
      },
    );
    expect(result.code).toBe(0);
    expect(calls).toEqual(["GET /v1.41/images/openbot-sandbox%3Abookworm-slim/json"]);
  });

  it("turns an image 404 into a non-zero result the alias check can read", async () => {
    const result = await executeAccountWorkerDockerCommand(
      ["image", "inspect", "openbot-sandbox:bookworm-slim"],
      {
        allowFailure: true,
        env: { PATH: "" },
        pathExists: () => false,
        isSocket: () => true,
        request: async () => ({ status: 404, body: "" }),
      },
    );
    expect(result.code).not.toBe(0);
    expect(result.stderr.toLowerCase()).toContain("no such image");
  });

  it("tags the legacy sandbox image onto the canonical name", async () => {
    const calls: string[] = [];
    const request: DockerEngineRequest = async (params) => {
      calls.push(`${params.method} ${params.path}`);
      return { status: 201, body: "" };
    };
    const result = await executeAccountWorkerDockerCommand(
      [
        "tag",
        "registry.example:5000/openclaw/sandbox:bookworm-slim",
        "registry.example:5000/openbot/sandbox:bookworm-slim",
      ],
      {
        allowFailure: true,
        env: { PATH: "" },
        pathExists: () => false,
        isSocket: () => true,
        request,
      },
    );
    expect(result.code).toBe(0);
    expect(calls[0]).toContain(
      "/images/registry.example%3A5000%2Fopenclaw%2Fsandbox%3Abookworm-slim/tag?",
    );
    expect(calls[0]).toContain("repo=registry.example%3A5000%2Fopenbot%2Fsandbox");
    expect(calls[0]).toContain("tag=bookworm-slim");
  });

  it("returns an unimplemented verb as stderr when the caller allowed failure", async () => {
    const result = await executeAccountWorkerDockerCommand(["exec", "-i", "aw-exec-1", "true"], {
      allowFailure: true,
      env: { PATH: "" },
      pathExists: () => false,
      isSocket: () => true,
      request: async () => {
        throw new Error("engine should not be called");
      },
    });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("docker engine client does not implement: exec");
  });

  it("still throws an unimplemented verb when failure is not allowed", async () => {
    await expect(
      executeAccountWorkerDockerCommand(["exec", "aw-exec-1", "true"], {
        env: { PATH: "" },
        pathExists: () => false,
        isSocket: () => true,
        request: async () => {
          throw new Error("engine should not be called");
        },
      }),
    ).rejects.toThrow("docker engine client does not implement: exec");
  });
});

describe("decideAccountWorkerDockerFailure", () => {
  it("degrades a missing CLI to host exec with a visible computer failure", () => {
    const decision = decideAccountWorkerDockerFailure(new DockerCliMissingError());
    expect(decision.action).toBe("host");
    if (decision.action === "host") {
      expect(decision.failure).toContain("OPENCLAW_INSTALL_DOCKER_CLI=1");
      expect(decision.failure).toContain("DOCKER_CLI_MISSING");
    }
  });

  it("does not move a revoked lease onto the gateway host", () => {
    expect(decideAccountWorkerDockerFailure(new Error("runtime lease is revoked")).action).toBe(
      "raise",
    );
  });

  it("keeps an unreachable mounted socket off the gateway host", () => {
    const decision = decideAccountWorkerDockerFailure(
      new DockerEngineUnreachableError("/var/run/docker.sock", "EACCES: connect EACCES"),
    );
    expect(decision.action).toBe("visible-error");
    if (decision.action === "visible-error") {
      expect(decision.failure).toContain("cannot connect to the docker daemon");
      expect(decision.failure).not.toContain("DOCKER_CLI_MISSING");
    }
  });

  it("does not treat a docker.sock ENOENT as a missing CLI", () => {
    const error = Object.assign(new Error("connect ENOENT /var/run/docker.sock"), {
      code: "ENOENT",
    });
    expect(decideAccountWorkerDockerFailure(error).action).not.toBe("host");
  });

  it("shows raw docker create and start stderr instead of aborting the turn", () => {
    expect(
      decideAccountWorkerDockerFailure(
        new Error("docker create failed: No such image: openclaw-sandbox:latest"),
      ).action,
    ).toBe("visible-error");
    expect(
      decideAccountWorkerDockerFailure(
        new Error("docker start failed: Error response from daemon: pull access denied"),
      ).action,
    ).toBe("visible-error");
  });

  it("turns the pre-reply English docker error into the operator sentence", () => {
    expect(
      userFacingPreReplyFailure(
        'Sandbox mode requires Docker, but the "docker" command was not found in PATH.',
      ),
    ).toBe(formatDockerCliMissingUserMessage());
  });

  it("keeps the docker-exec ENOENT wording on the same operator sentence", () => {
    expect(
      userFacingPreReplyFailure(
        'Sandbox mode requires Docker, but the "docker" command was not found in PATH. Workspace write and exec run as docker exec inside the account sandbox. Do not ask the user to set agents.defaults.sandbox.mode=off or to approve host exec.',
      ),
    ).toBe(formatDockerCliMissingUserMessage());
  });
});

describe("resolveDockerSpawnInvocation docker bin override", () => {
  it("spawns OPENBOT_DOCKER_BIN when that file is executable", async () => {
    const bin = path.join(os.tmpdir(), `openbot-docker-bin-${process.pid}`);
    await writeFile(bin, "#!/bin/sh\nexit 0\n", "utf8");
    await chmod(bin, 0o755);
    try {
      const resolved = resolveDockerSpawnInvocation(["version"], {
        platform: "linux",
        env: { PATH: "", OPENBOT_DOCKER_BIN: bin },
        execPath: "/usr/bin/node",
      });
      expect(resolved.command).toBe(bin);
      expect(resolved.args).toEqual(["version"]);
    } finally {
      await rm(bin, { force: true });
    }
  });

  it("ignores OPENBOT_DOCKER_BIN when that file is missing", () => {
    const resolved = resolveDockerSpawnInvocation(["version"], {
      platform: "linux",
      env: { PATH: "/usr/bin", OPENBOT_DOCKER_BIN: "/no/such/openbot-docker" },
      execPath: "/usr/bin/node",
    });
    expect(resolved.command).toBe("docker");
  });
});

describe("account worker docker packaging", () => {
  it("documents the CLI build arg for ACCOUNT_WORKER_DOCKER images", () => {
    const dockerfile = readFileSync(path.join(repoRoot, "Dockerfile"), "utf8");
    const setup = readFileSync(path.join(repoRoot, "docker-setup.sh"), "utf8");
    expect(dockerfile).toContain("OPENBOT_ACCOUNT_WORKER_DOCKER");
    expect(dockerfile).toContain("OPENCLAW_INSTALL_DOCKER_CLI");
    expect(setup).toContain("OPENCLAW_ACCOUNT_WORKER_DOCKER");
    expect(setup).toContain("OPENCLAW_INSTALL_DOCKER_CLI=1");
  });
});

describe("socket image alias on the account-worker start path", () => {
  function socketRunner(request: DockerEngineRequest) {
    return (args: string[], opts?: { allowFailure?: boolean }) =>
      executeAccountWorkerDockerCommand(args, {
        ...opts,
        env: { PATH: "" },
        pathExists: () => false,
        isSocket: () => true,
        request,
      });
  }

  function spec(root: string): RuntimeContainerSpec {
    return {
      runtimeLeaseId: "lease-socket-image",
      snapshotVersion: 1,
      image: DEFAULT_SANDBOX_IMAGE,
      browserImage: "openbot-sandbox-browser:bookworm-slim",
      execMounts: [
        {
          hostPath: path.join(root, "workspace"),
          containerPath: "/account/workspace",
          access: "rw",
        },
      ],
      browserMounts: [],
    };
  }

  it("starts the default image without throwing on image inspect", async () => {
    const root = path.join(os.tmpdir(), `aw-engine-image-${process.pid}`);
    await mkdir(path.join(root, "workspace"), { recursive: true });
    const calls: string[] = [];
    const request: DockerEngineRequest = async (params) => {
      calls.push(`${params.method} ${params.path}`);
      if (params.method === "GET" && params.path.includes("/images/")) {
        return params.path.includes("openclaw-sandbox")
          ? { status: 404, body: "No such image" }
          : { status: 200, body: JSON.stringify({ Id: "sha256:present" }) };
      }
      if (params.method === "POST" && params.path.includes("/containers/create")) {
        return { status: 201, body: JSON.stringify({ Id: "created" }) };
      }
      if (params.method === "POST" && params.path.endsWith("/start")) {
        return { status: 204, body: "" };
      }
      return { status: 500, body: `unexpected ${params.method} ${params.path}` };
    };
    try {
      const driver = createDockerAccountSandboxDriver({ runDocker: socketRunner(request) });
      const started = await driver.startExec(spec(root));
      expect(started.containerName).toBe(accountWorkerContainerName("exec", "lease-socket-image"));
      expect(calls.some((call) => call.startsWith("GET ") && call.includes("/images/"))).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("retags a legacy openclaw image and still starts", async () => {
    const root = path.join(os.tmpdir(), `aw-engine-retag-${process.pid}`);
    await mkdir(path.join(root, "workspace"), { recursive: true });
    const calls: string[] = [];
    const request: DockerEngineRequest = async (params) => {
      calls.push(`${params.method} ${params.path}`);
      if (params.method === "GET" && params.path.includes("/images/")) {
        return params.path.includes("openclaw-sandbox")
          ? { status: 200, body: JSON.stringify({ Id: "sha256:legacy" }) }
          : { status: 404, body: "No such image" };
      }
      if (params.method === "POST" && params.path.includes("/tag?")) {
        return { status: 201, body: "" };
      }
      if (params.method === "POST" && params.path.includes("/containers/create")) {
        return { status: 201, body: JSON.stringify({ Id: "created" }) };
      }
      if (params.method === "POST" && params.path.endsWith("/start")) {
        return { status: 204, body: "" };
      }
      return { status: 500, body: `unexpected ${params.method} ${params.path}` };
    };
    try {
      const driver = createDockerAccountSandboxDriver({ runDocker: socketRunner(request) });
      await driver.startExec(spec(root));
      expect(calls.some((call) => call.includes("/tag?"))).toBe(true);
      expect(driver.lastCreateArgs.at(-1)).toContain(DEFAULT_SANDBOX_IMAGE);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("container liveness probes", () => {
  it("treats a missing container as stopped and a failed inspect as unknown", () => {
    expect(
      interpretDockerInspectLiveness({
        code: 1,
        stdout: "",
        stderr: "Error: No such container: aw-browser-user-x",
      }),
    ).toBe("stopped");
    expect(
      interpretDockerInspectLiveness({
        code: 1,
        stdout: "",
        stderr: "Cannot connect to the Docker daemon",
      }),
    ).toBe("unknown");
    expect(interpretDockerInspectLiveness({ code: 0, stdout: "true\n", stderr: "" })).toBe(
      "running",
    );
    expect(interpretDockerInspectLiveness({ code: 0, stdout: "false\n", stderr: "" })).toBe(
      "stopped",
    );
  });

  it("asks the engine socket when the CLI is missing", async () => {
    const inspectCli = vi.fn(async () => {
      throw new DockerCliMissingError();
    });
    const inspectEngine = vi.fn(async () => "running" as const);
    await expect(
      resolveContainerLivenessFromProbes({
        transportKind: "cli",
        socketPath: "/run/podman/podman.sock",
        inspectCli,
        inspectEngine,
      }),
    ).resolves.toBe("running");
    expect(inspectEngine).toHaveBeenCalledWith("/run/podman/podman.sock");
  });

  it("asks the engine socket when the CLI cannot answer", async () => {
    const inspectCli = vi.fn(async () => ({
      code: 1,
      stdout: "",
      stderr: "Cannot connect to the Docker daemon",
    }));
    const inspectEngine = vi.fn(async () => "running" as const);
    await expect(
      resolveContainerLivenessFromProbes({
        transportKind: "cli",
        socketPath: "/var/run/docker.sock",
        inspectCli,
        inspectEngine,
      }),
    ).resolves.toBe("running");
    expect(inspectEngine).toHaveBeenCalledTimes(1);
  });

  it("does not second-guess a CLI that says the container is gone", async () => {
    const inspectEngine = vi.fn(async () => "running" as const);
    await expect(
      resolveContainerLivenessFromProbes({
        transportKind: "cli",
        socketPath: "/var/run/docker.sock",
        inspectCli: async () => ({
          code: 1,
          stdout: "",
          stderr: "No such container: aw-browser-user-x",
        }),
        inspectEngine,
      }),
    ).resolves.toBe("stopped");
    expect(inspectEngine).not.toHaveBeenCalled();
  });

  it("uses only the engine socket when no CLI is on PATH", async () => {
    const inspectCli = vi.fn(async () => ({ code: 0, stdout: "false", stderr: "" }));
    const inspectEngine = vi.fn(async () => "running" as const);
    await expect(
      resolveContainerLivenessFromProbes({
        transportKind: "socket",
        socketPath: "/var/run/docker.sock",
        inspectCli,
        inspectEngine,
      }),
    ).resolves.toBe("running");
    expect(inspectCli).not.toHaveBeenCalled();
  });
});
