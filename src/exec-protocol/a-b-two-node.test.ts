import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { AControlPlane } from "./a-control-plane.js";
import { AControlServer } from "./a-server.js";
import { ExecHttpClient } from "./client.js";
import { isolationConfigToEnv, isolationProfile } from "./config.js";
import { ExecProtocolError } from "./errors.js";
import { createHostCommandProbe } from "./host-fallback.js";
import { mintLease } from "./lease.js";
import { FileExecStore } from "./store.js";
import {
  MAX_REQUEST_BODY_BYTES,
  TEST_SUBJECT,
  TEST_TENANT,
  baseSubmitBody,
  getFreePort,
  inlineJsonInput,
  startIsolatedPair,
  uniqueIdempotencyKey,
  waitFor,
} from "./test-helpers.js";

const here = dirname(fileURLToPath(import.meta.url));
const aMain = join(here, "a-prime-main.ts");
const bMain = join(here, "b-prime-main.ts");
type ChildNode = {
  process: ChildProcess;
  baseUrl: string;
  port: number;
  dir: string;
  role: "a" | "b";
};

const children: ChildProcess[] = [];

afterAll(async () => {
  for (const child of children) {
    if (!child.killed) {
      child.kill("SIGTERM");
    }
  }
});

async function spawnNode(params: {
  role: "a" | "b";
  port: number;
  dir: string;
  env: Record<string, string>;
}): Promise<ChildNode> {
  const child = spawn(process.execPath, ["--import", "tsx", params.role === "a" ? aMain : bMain], {
    env: { ...process.env, ...params.env },
    cwd: join(here, "../.."),
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(child);
  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (chunk: Buffer) => {
    stdout += chunk.toString("utf8");
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8");
  });
  try {
    await waitFor(
      () => stdout,
      (text) => text.includes("EXEC_PROTOCOL_READY"),
      15000,
      50,
    );
  } catch (error) {
    child.kill("SIGTERM");
    throw new Error(
      `failed to start ${params.role}' process: ${String(error)}\nstdout=${stdout}\nstderr=${stderr}`,
      { cause: error },
    );
  }
  const ready = JSON.parse(await readFile(join(params.dir, "ready.json"), "utf8")) as {
    port: number;
    baseUrl: string;
  };
  return {
    process: child,
    baseUrl: ready.baseUrl,
    port: ready.port,
    dir: params.dir,
    role: params.role,
  };
}

async function stopChild(child: ChildNode): Promise<void> {
  if (child.process.exitCode !== null || child.process.killed) {
    return;
  }
  child.process.kill("SIGTERM");
  await waitFor(
    () => child.process.exitCode ?? (child.process.killed ? 0 : null),
    (code) => code !== null,
    5000,
    25,
  );
}

describe("A'/B' two HTTP listeners with separate stores", () => {
  it("runs a normal task only on B', links ids, and does not execute on A'", async () => {
    const pair = await startIsolatedPair();
    try {
      const toolCallId = uniqueIdempotencyKey("tool");
      const submitted = await pair.aClient.submit(
        baseSubmitBody({ toolCallId, input: inlineJsonInput({ message: "from-a" }) }) as never,
      );
      expect(submitted.httpStatus).toBe(201);
      expect(submitted.payload.taskId).toMatch(/^tsk_[a-f0-9]{32}$/);
      expect(submitted.payload.toolCallId).toBe(toolCallId);
      const done = await waitFor(
        () =>
          pair.aClient.status({
            "exec-api-version": 1,
            tenantId: TEST_TENANT,
            taskId: submitted.payload.taskId,
          }),
        (result) => result.payload.state === "succeeded",
      );
      expect(done.payload.state).toBe("succeeded");
      expect(done.payload.artifacts).toHaveLength(1);
      const artifact = done.payload.artifacts[0];
      expect(artifact.taskId).toBe(done.payload.taskId);
      expect(artifact.toolCallId).toBe(toolCallId);
      expect(artifact.artifactId).toMatch(/^art_[a-f0-9]{32}$/);
      const delivered = await pair.aClient.artifact({
        "exec-api-version": 1,
        tenantId: TEST_TENANT,
        taskId: done.payload.taskId,
        artifactId: artifact.artifactId,
        includeBytes: true,
      });
      expect(delivered.payload.delivered).toBe(true);
      expect(delivered.payload.taskId).toBe(done.payload.taskId);
      expect(delivered.payload.toolCallId).toBe(toolCallId);
      expect(pair.b.debug().executionsStarted).toBe(1);
      expect(pair.plane.debug().executionsStarted).toBe(0);
      expect(pair.probe.calls).toHaveLength(0);
      expect(
        pair.aStore.data().executionJournal.filter((entry) => entry.role === "control-plane"),
      ).toHaveLength(0);
      expect(
        pair.bStore.data().executionJournal.some((entry) => entry.event === "execution-started"),
      ).toBe(true);
    } finally {
      await pair.stop();
    }
  });

  it("does not start a second task for the same idempotency key", async () => {
    const pair = await startIsolatedPair();
    try {
      const key = uniqueIdempotencyKey("repeat");
      const toolCallId = uniqueIdempotencyKey("tool");
      const first = await pair.aClient.submit(
        baseSubmitBody({ idempotencyKey: key, toolCallId }) as never,
      );
      const second = await pair.aClient.submit(
        baseSubmitBody({ idempotencyKey: key, toolCallId }) as never,
      );
      expect(second.payload.taskId).toBe(first.payload.taskId);
      const tasks = pair.aStore.listTasks().filter((task) => task.idempotencyKey === key);
      expect(tasks).toHaveLength(1);
      await waitFor(
        () =>
          pair.aClient.status({
            "exec-api-version": 1,
            tenantId: TEST_TENANT,
            taskId: first.payload.taskId,
          }),
        (result) => result.payload.state === "succeeded",
      );
      expect(pair.b.debug().executionsStarted).toBe(1);
    } finally {
      await pair.stop();
    }
  });

  it("returns EXEC_UNREACHABLE or stays pending when B' is down, and never runs on A'", async () => {
    const pair = await startIsolatedPair({ connectTimeoutMs: 200, requestTimeoutMs: 5000 });
    try {
      await pair.b.stop();
      const probeBefore = pair.probe.calls.length;
      try {
        await pair.aClient.submit(baseSubmitBody({ input: inlineJsonInput({ n: 9 }) }) as never);
        throw new Error("expected unreachable");
      } catch (error) {
        expect(error).toBeInstanceOf(ExecProtocolError);
        expect((error as ExecProtocolError).code).toBe("EXEC_UNREACHABLE");
        const taskId = (error as ExecProtocolError).taskId;
        expect(taskId).toBeTruthy();
        const local = pair.aStore.getTask(taskId as string);
        expect(local).toBeTruthy();
        expect(["accepted", "queued", "result_unconfirmed"]).toContain(local?.state);
        expect(local?.state).not.toBe("succeeded");
      }
      expect(pair.plane.debug().executionsStarted).toBe(0);
      expect(pair.probe.calls.length).toBe(probeBefore);
      expect(pair.aStore.data().executionJournal).toHaveLength(0);
    } finally {
      await pair.stop();
    }
  });

  it("does not increment the synthetic side-effect probe again after disconnect and reconnect", async () => {
    const pair = await startIsolatedPair();
    const probeId = uniqueIdempotencyKey("probe");
    try {
      const submitted = await pair.aClient.submit(
        baseSubmitBody({
          kind: "side-effect-probe",
          probeId,
          sleepMs: 3000,
          input: inlineJsonInput({ probe: true }),
        }) as never,
      );
      await waitFor(
        () => pair.bStore.getProbe(probeId),
        (count) => count === 1,
        4000,
      );
      expect(pair.b.debug().executionsStarted).toBe(1);
      const bDir = pair.bDir;
      const leaseRecord = pair.leaseRecord;
      const configB = pair.configB;
      await pair.b.stop();

      const statusAfterDrop = await pair.aClient.status({
        "exec-api-version": 1,
        tenantId: TEST_TENANT,
        taskId: submitted.payload.taskId,
      });
      expect(statusAfterDrop.payload.state).not.toBe("succeeded");

      const restartedStore = new FileExecStore(bDir);
      const restarted = new (await import("./b-server.js")).BExecutionServer({
        config: configB,
        store: restartedStore,
        maxRequestBodyBytes: MAX_REQUEST_BODY_BYTES,
      });
      await restarted.start();
      await restarted.registerLease(leaseRecord);
      try {
        expect(restartedStore.getProbe(probeId)).toBe(1);
        const afterReconnect = await pair.aClient.status({
          "exec-api-version": 1,
          tenantId: TEST_TENANT,
          taskId: submitted.payload.taskId,
        });
        expect(afterReconnect.payload.state).not.toBe("succeeded");
        expect(["result_unconfirmed", "failed", "running", "queued", "cancel_requested"]).toContain(
          afterReconnect.payload.state,
        );
        expect(restartedStore.getProbe(probeId)).toBe(1);
        expect(restarted.debug().executionsStarted).toBe(0);
      } finally {
        await restarted.stop();
      }
    } finally {
      await pair.stop();
    }
  });

  it("recovers A' control-plane records after a process-equivalent restart", async () => {
    const pair = await startIsolatedPair();
    try {
      const toolCallId = uniqueIdempotencyKey("tool");
      const submitted = await pair.aClient.submit(
        baseSubmitBody({ toolCallId, input: inlineJsonInput({ restart: true }) }) as never,
      );
      const done = await waitFor(
        () =>
          pair.aClient.status({
            "exec-api-version": 1,
            tenantId: TEST_TENANT,
            taskId: submitted.payload.taskId,
          }),
        (result) => result.payload.state === "succeeded",
      );
      await pair.a.stop();
      const aStore = new FileExecStore(pair.aDir);
      const plane = new AControlPlane({
        config: pair.configA,
        store: aStore,
        client: new ExecHttpClient({
          baseUrl: pair.b.baseUrl,
          config: pair.configA,
          leaseToken: pair.leaseToken,
          maxRequestBodyBytes: MAX_REQUEST_BODY_BYTES,
        }),
        maxRequestBodyBytes: MAX_REQUEST_BODY_BYTES,
        hostCommandProbe: createHostCommandProbe(),
        subject: TEST_SUBJECT,
      });
      const restartedA = new AControlServer({
        config: pair.configA,
        store: aStore,
        plane,
        maxRequestBodyBytes: MAX_REQUEST_BODY_BYTES,
      });
      await restartedA.start();
      await restartedA.registerLease(pair.leaseRecord);
      try {
        const client = new ExecHttpClient({
          baseUrl: restartedA.baseUrl,
          config: pair.configA,
          leaseToken: pair.leaseToken,
          maxRequestBodyBytes: MAX_REQUEST_BODY_BYTES,
        });
        const recovered = await client.status({
          "exec-api-version": 1,
          tenantId: TEST_TENANT,
          taskId: submitted.payload.taskId,
        });
        expect(recovered.payload.state).toBe("succeeded");
        expect(recovered.payload.taskId).toBe(done.payload.taskId);
        expect(recovered.payload.toolCallId).toBe(toolCallId);
        expect(recovered.payload.artifacts[0]?.artifactId).toBe(
          done.payload.artifacts[0]?.artifactId,
        );
        expect(plane.debug().executionsStarted).toBe(0);
      } finally {
        await restartedA.stop();
      }
    } finally {
      await pair.stop();
    }
  });
});

describe("A'/B' two child processes", () => {
  it("executes only on B' and recovers A' after the control-plane process restarts", async () => {
    const aDir = await mkdtemp(join(tmpdir(), "exec-protocol-proc-a-"));
    const bDir = await mkdtemp(join(tmpdir(), "exec-protocol-proc-b-"));
    const aPort = await getFreePort();
    const bPort = await getFreePort();
    const configA = isolationProfile({
      port: aPort,
      connectTimeoutMs: 1000,
      requestTimeoutMs: 2000,
    });
    const configB = isolationProfile({
      port: bPort,
      connectTimeoutMs: 1000,
      requestTimeoutMs: 2000,
    });
    const minted = mintLease({
      subject: TEST_SUBJECT,
      nowMs: Date.now(),
      ttlMs: configA.leaseTtlMs,
      tenantId: TEST_TENANT,
    });
    const sharedEnv = {
      ...isolationConfigToEnv(configA),
      OPENBOT_EXEC_PROTOCOL_MAX_REQUEST_BODY_BYTES: String(MAX_REQUEST_BODY_BYTES),
      OPENBOT_EXEC_PROTOCOL_SUBJECT: TEST_SUBJECT,
      OPENBOT_EXEC_PROTOCOL_SEED_LEASE: minted.token,
      OPENBOT_EXEC_PROTOCOL_SEED_LEASE_TENANT: TEST_TENANT,
    };
    let bNode: ChildNode | undefined;
    let aNode: ChildNode | undefined;
    try {
      bNode = await spawnNode({
        role: "b",
        port: bPort,
        dir: bDir,
        env: {
          ...sharedEnv,
          ...isolationConfigToEnv(configB),
          OPENBOT_EXEC_PROTOCOL_STORE_DIR: bDir,
        },
      });
      aNode = await spawnNode({
        role: "a",
        port: aPort,
        dir: aDir,
        env: {
          ...sharedEnv,
          OPENBOT_EXEC_PROTOCOL_STORE_DIR: aDir,
          OPENBOT_EXEC_PROTOCOL_B_URL: bNode.baseUrl,
          OPENBOT_EXEC_PROTOCOL_CLIENT_LEASE: minted.token,
        },
      });
      const client = new ExecHttpClient({
        baseUrl: aNode.baseUrl,
        config: configA,
        leaseToken: minted.token,
        maxRequestBodyBytes: MAX_REQUEST_BODY_BYTES,
      });
      const bClient = new ExecHttpClient({
        baseUrl: bNode.baseUrl,
        config: configB,
        leaseToken: minted.token,
        maxRequestBodyBytes: MAX_REQUEST_BODY_BYTES,
      });
      const toolCallId = uniqueIdempotencyKey("tool");
      const submitted = await client.submit(
        baseSubmitBody({ toolCallId, input: inlineJsonInput({ process: true }) }) as never,
      );
      const done = await waitFor(
        () =>
          client.status({
            "exec-api-version": 1,
            tenantId: TEST_TENANT,
            taskId: submitted.payload.taskId,
          }),
        (result) => result.payload.state === "succeeded",
        10000,
      );
      expect(done.payload.toolCallId).toBe(toolCallId);
      expect(done.payload.artifacts[0]?.taskId).toBe(done.payload.taskId);
      const aDebug = await client.debug();
      const bDebug = await bClient.debug();
      expect(aDebug.payload.role).toBe("control-plane");
      expect(bDebug.payload.role).toBe("execution-site");
      expect(aDebug.payload.executionsStarted).toBe(0);
      expect(bDebug.payload.executionsStarted).toBe(1);
      expect(aDebug.payload.hostCommands).toBe(0);

      await stopChild(aNode);
      aNode = await spawnNode({
        role: "a",
        port: aPort,
        dir: aDir,
        env: {
          ...sharedEnv,
          OPENBOT_EXEC_PROTOCOL_STORE_DIR: aDir,
          OPENBOT_EXEC_PROTOCOL_B_URL: bNode.baseUrl,
          OPENBOT_EXEC_PROTOCOL_CLIENT_LEASE: minted.token,
        },
      });
      const restartedClient = new ExecHttpClient({
        baseUrl: aNode.baseUrl,
        config: configA,
        leaseToken: minted.token,
        maxRequestBodyBytes: MAX_REQUEST_BODY_BYTES,
      });
      const recovered = await restartedClient.status({
        "exec-api-version": 1,
        tenantId: TEST_TENANT,
        taskId: submitted.payload.taskId,
      });
      expect(recovered.payload.state).toBe("succeeded");
      expect(recovered.payload.taskId).toBe(done.payload.taskId);
      expect(recovered.payload.artifacts[0]?.artifactId).toBe(
        done.payload.artifacts[0]?.artifactId,
      );
    } finally {
      if (aNode) {
        await stopChild(aNode);
      }
      if (bNode) {
        await stopChild(bNode);
      }
      await rm(aDir, { recursive: true, force: true });
      await rm(bDir, { recursive: true, force: true });
    }
  });
});
