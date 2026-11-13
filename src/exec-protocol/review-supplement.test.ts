import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, request as httpRequest, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AControlPlane } from "./a-control-plane.js";
import { AControlServer } from "./a-server.js";
import { BExecutionServer } from "./b-server.js";
import { sha256Of } from "./checksum.js";
import { ExecHttpClient } from "./client.js";
import { isolationProfile } from "./config.js";
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
import { isTerminalState } from "./types.js";

function inlineBytesInput(bytes: Buffer) {
  return {
    kind: "inline-bytes" as const,
    bytesBase64: bytes.toString("base64"),
    sha256: sha256Of(bytes),
    byteCount: bytes.length,
  };
}

async function waitForBArtifact(
  pair: Awaited<ReturnType<typeof startIsolatedPair>>,
  taskId: string,
) {
  const artifact = await waitFor(
    () => {
      const task = pair.bStore.getTask(taskId);
      return task?.artifacts[0];
    },
    (artifact) => Boolean(artifact?.artifactId),
    4000,
  );
  if (!artifact) {
    throw new Error("Expected B artifact after waitFor");
  }
  return artifact;
}

describe("PR #272 review supplement: races, artifacts, and unconfirmed handling", () => {
  it("concurrent duplicate submits share one task and start B' execution only once", async () => {
    const pair = await startIsolatedPair();
    const key = uniqueIdempotencyKey("concurrent");
    const toolCallId = uniqueIdempotencyKey("tool");
    const body = baseSubmitBody({
      idempotencyKey: key,
      toolCallId,
      input: inlineJsonInput({ concurrent: true }),
    });
    try {
      const results = await Promise.allSettled([
        pair.aClient.submit(body as never),
        pair.aClient.submit(body as never),
        pair.aClient.submit(body as never),
      ]);
      const accepted = results
        .filter((result) => result.status === "fulfilled")
        .map((result) => result.value);
      expect(accepted.length).toBeGreaterThan(0);
      const taskIds = new Set(accepted.map((item) => item.payload.taskId));
      expect(taskIds.size).toBe(1);
      const tasks = pair.aStore.listTasks().filter((task) => task.idempotencyKey === key);
      expect(tasks).toHaveLength(1);
      const done = await waitFor(
        () =>
          pair.aClient.status({
            "exec-api-version": 1,
            tenantId: TEST_TENANT,
            taskId: accepted[0].payload.taskId,
          }),
        (result) =>
          isTerminalState(result.payload.state) || result.payload.state === "result_unconfirmed",
      );
      expect(done.payload.state).toBe("succeeded");
      expect(pair.b.debug().executionsStarted).toBe(1);
      expect(pair.plane.debug().executionsStarted).toBe(0);
      expect(pair.probe.calls).toHaveLength(0);
    } finally {
      await pair.stop();
    }
  });

  it("cancel versus completion settles to cancelled or succeeded, never both over time", async () => {
    const pair = await startIsolatedPair();
    const seen: string[] = [];
    try {
      const submitted = await pair.aClient.submit(
        baseSubmitBody({
          kind: "sleep",
          sleepMs: 80,
          input: inlineJsonInput({ race: true }),
        }) as never,
      );
      await waitFor(
        () =>
          pair.aClient.status({
            "exec-api-version": 1,
            tenantId: TEST_TENANT,
            taskId: submitted.payload.taskId,
          }),
        (result) =>
          result.payload.state === "running" ||
          result.payload.state === "queued" ||
          result.payload.state === "succeeded",
        2000,
      );
      const cancelled = await pair.aClient.cancel({
        "exec-api-version": 1,
        tenantId: TEST_TENANT,
        taskId: submitted.payload.taskId,
      });
      seen.push(cancelled.payload.state);
      const finalState = await waitFor(
        () =>
          pair.aClient.status({
            "exec-api-version": 1,
            tenantId: TEST_TENANT,
            taskId: submitted.payload.taskId,
          }),
        (result) =>
          result.payload.state === "cancelled" ||
          result.payload.state === "succeeded" ||
          result.payload.state === "result_unconfirmed" ||
          result.payload.state === "failed",
        3000,
      );
      seen.push(finalState.payload.state);
      expect(["cancelled", "succeeded", "result_unconfirmed"]).toContain(finalState.payload.state);
      if (seen.includes("cancelled") && finalState.payload.state === "succeeded") {
        throw new Error("task observed as cancelled later became succeeded");
      }
      if (seen.includes("succeeded") && finalState.payload.state === "cancelled") {
        throw new Error("task observed as succeeded later became cancelled");
      }
      expect(pair.plane.debug().executionsStarted).toBe(0);
      expect(pair.probe.calls).toHaveLength(0);
    } finally {
      await pair.stop();
    }
  });

  it("result_unconfirmed has no protocol path to a terminal rewrite, and cannot be auto-replayed", async () => {
    const pair = await startIsolatedPair({ cancelDeadlineMs: 80 });
    try {
      const key = uniqueIdempotencyKey("unconfirmed");
      const toolCallId = uniqueIdempotencyKey("tool");
      const submitBody = baseSubmitBody({
        idempotencyKey: key,
        toolCallId,
        kind: "ignore-cancel",
        sleepMs: 2000,
        input: inlineJsonInput({ hold: true }),
      });
      const submitted = await pair.aClient.submit(submitBody as never);
      await waitFor(
        () =>
          pair.aClient.status({
            "exec-api-version": 1,
            tenantId: TEST_TENANT,
            taskId: submitted.payload.taskId,
          }),
        (result) => result.payload.state === "running",
      );
      await pair.aClient.cancel({
        "exec-api-version": 1,
        tenantId: TEST_TENANT,
        taskId: submitted.payload.taskId,
      });
      const unconfirmed = await waitFor(
        () =>
          pair.aClient.status({
            "exec-api-version": 1,
            tenantId: TEST_TENANT,
            taskId: submitted.payload.taskId,
          }),
        (result) => result.payload.state === "result_unconfirmed",
        4000,
      );
      expect(unconfirmed.payload.state).toBe("result_unconfirmed");
      const cancelAgain = await pair.aClient.cancel({
        "exec-api-version": 1,
        tenantId: TEST_TENANT,
        taskId: submitted.payload.taskId,
      });
      expect(cancelAgain.payload.state).toBe("result_unconfirmed");
      const replay = await pair.aClient.submit(submitBody as never);
      expect(replay.httpStatus).toBe(200);
      expect(replay.payload.taskId).toBe(submitted.payload.taskId);
      expect(replay.payload.state).toBe("result_unconfirmed");
      expect(pair.b.debug().executionsStarted).toBe(1);
      expect(pair.plane.debug().executionsStarted).toBe(0);
    } finally {
      await pair.stop();
    }
  });

  it("recovers the original idempotency key after A' and B' store reload", async () => {
    const pair = await startIsolatedPair();
    const key = uniqueIdempotencyKey("restart");
    const toolCallId = uniqueIdempotencyKey("tool");
    try {
      const first = await pair.aClient.submit(
        baseSubmitBody({
          idempotencyKey: key,
          toolCallId,
          input: inlineJsonInput({ restart: true }),
        }) as never,
      );
      await waitFor(
        () =>
          pair.aClient.status({
            "exec-api-version": 1,
            tenantId: TEST_TENANT,
            taskId: first.payload.taskId,
          }),
        (result) => result.payload.state === "succeeded",
      );
      const persistedA = JSON.parse(await readFile(join(pair.aDir, "control.json"), "utf8")) as {
        tasks: Record<string, { state: string }>;
        idempotency: Record<string, { taskId: string }>;
      };
      const persistedB = JSON.parse(await readFile(join(pair.bDir, "control.json"), "utf8")) as {
        tasks: Record<string, { idempotencyKey: string }>;
      };
      expect(persistedA.idempotency[`${TEST_TENANT} ${key}`]?.taskId).toBe(first.payload.taskId);
      expect(persistedA.tasks[first.payload.taskId]?.state).toBe("succeeded");
      expect(persistedB.tasks[first.payload.taskId]?.idempotencyKey).toBe(key);
      const second = await pair.aClient.submit(
        baseSubmitBody({
          idempotencyKey: key,
          toolCallId,
          input: inlineJsonInput({ restart: true }),
        }) as never,
      );
      expect(second.payload.taskId).toBe(first.payload.taskId);
      expect(pair.b.debug().executionsStarted).toBe(1);
    } finally {
      await pair.stop();
    }
  });

  it("hash or byte-count mismatch is not delivered as success", async () => {
    const pair = await startIsolatedPair();
    try {
      const submitted = await pair.aClient.submit(
        baseSubmitBody({ kind: "echo", input: inlineJsonInput({ body: "ok" }) }) as never,
      );
      const artifact = await waitForBArtifact(pair, submitted.payload.taskId);
      const path = join(pair.bDir, "artifacts", `${artifact.artifactId}.bin`);
      await writeFile(path, Buffer.from("tampered-bytes"));
      let delivered = false;
      let artifactError: unknown;
      try {
        const result = await pair.aClient.artifact({
          "exec-api-version": 1,
          tenantId: TEST_TENANT,
          taskId: submitted.payload.taskId,
          artifactId: artifact.artifactId,
          includeBytes: true,
        });
        delivered = Boolean(result.payload.delivered);
      } catch (error) {
        artifactError = error;
      }
      expect(delivered).toBe(false);
      expect(artifactError).toBeInstanceOf(ExecProtocolError);
      expect((artifactError as ExecProtocolError).code).toBe("EXEC_CHECKSUM_MISMATCH");
      const task = pair.aStore.getTask(submitted.payload.taskId);
      expect(task?.state).not.toBe("succeeded");
      expect(pair.plane.debug().executionsStarted).toBe(0);
    } finally {
      await pair.stop();
    }
  });

  it("duplicate artifact retrieval does not start a second execution and stays consistent", async () => {
    const pair = await startIsolatedPair();
    try {
      const submitted = await pair.aClient.submit(
        baseSubmitBody({ input: inlineJsonInput({ once: true }) }) as never,
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
      const artifactId = done.payload.artifacts[0].artifactId;
      const first = await pair.aClient.artifact({
        "exec-api-version": 1,
        tenantId: TEST_TENANT,
        taskId: submitted.payload.taskId,
        artifactId,
        includeBytes: true,
      });
      const second = await pair.aClient.artifact({
        "exec-api-version": 1,
        tenantId: TEST_TENANT,
        taskId: submitted.payload.taskId,
        artifactId,
        includeBytes: true,
      });
      expect(first.payload.delivered).toBe(true);
      expect(second.payload.delivered).toBe(true);
      expect(second.payload.sha256).toBe(first.payload.sha256);
      expect(second.payload.byteCount).toBe(first.payload.byteCount);
      expect(second.payload.bytesBase64).toBe(first.payload.bytesBase64);
      expect(pair.b.debug().executionsStarted).toBe(1);
      expect(pair.plane.debug().executionsStarted).toBe(0);
    } finally {
      await pair.stop();
    }
  });
});

describe("PR #272 review supplement: interrupted artifact transfer", () => {
  it("a mid-transfer disconnect does not report delivered success", async () => {
    const aPort = await getFreePort();
    const bPort = await getFreePort();
    const proxyPort = await getFreePort();
    const aDir = await mkdtemp(join(tmpdir(), "exec-protocol-a-"));
    const bDir = await mkdtemp(join(tmpdir(), "exec-protocol-b-"));
    const configA = isolationProfile({
      port: aPort,
      connectTimeoutMs: 200,
      requestTimeoutMs: 400,
      maxTransportRetries: 3,
      transportBackoffMs: [20, 20],
    });
    const configB = isolationProfile({ port: bPort });
    const minted = mintLease({
      subject: TEST_SUBJECT,
      nowMs: Date.now(),
      ttlMs: configA.leaseTtlMs,
      tenantId: TEST_TENANT,
    });
    const aStore = new FileExecStore(aDir);
    const bStore = new FileExecStore(bDir);
    await aStore.load();
    await bStore.load();
    const probe = createHostCommandProbe();
    const b = new BExecutionServer({
      config: configB,
      store: bStore,
      maxRequestBodyBytes: MAX_REQUEST_BODY_BYTES,
      hostCommandProbe: probe,
    });
    await b.start();
    await b.registerLease(minted.record);

    const proxy: Server = createServer((req, res) => {
      const isArtifact = (req.url ?? "").includes("/v1/tasks/artifact");
      const proxyReq = httpRequest(
        {
          hostname: "127.0.0.1",
          port: bPort,
          path: req.url,
          method: req.method,
          headers: req.headers,
        },
        (proxyRes) => {
          if (!isArtifact) {
            res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
            proxyRes.pipe(res);
            return;
          }
          res.writeHead(proxyRes.statusCode ?? 200, proxyRes.headers);
          let sent = 0;
          const cutAfterBytes = 64;
          proxyRes.on("data", (chunk: Buffer) => {
            if (sent >= cutAfterBytes) {
              res.destroy();
              proxyRes.destroy();
              return;
            }
            const piece = chunk.subarray(0, cutAfterBytes - sent);
            sent += piece.length;
            res.write(piece);
            res.destroy();
            proxyRes.destroy();
          });
        },
      );
      proxyReq.on("error", () => {
        res.destroy();
      });
      req.pipe(proxyReq);
    });
    await new Promise<void>((resolve) => proxy.listen(proxyPort, "127.0.0.1", resolve));

    const bClient = new ExecHttpClient({
      baseUrl: `http://127.0.0.1:${proxyPort}`,
      config: configA,
      leaseToken: minted.token,
      maxRequestBodyBytes: MAX_REQUEST_BODY_BYTES,
    });
    const plane = new AControlPlane({
      config: configA,
      store: aStore,
      client: bClient,
      maxRequestBodyBytes: MAX_REQUEST_BODY_BYTES,
      hostCommandProbe: probe,
      subject: TEST_SUBJECT,
    });
    const a = new AControlServer({
      config: configA,
      store: aStore,
      plane,
      maxRequestBodyBytes: MAX_REQUEST_BODY_BYTES,
      hostCommandProbe: probe,
    });
    await a.start();
    await a.registerLease(minted.record);
    const aClient = new ExecHttpClient({
      baseUrl: a.baseUrl,
      config: configA,
      leaseToken: minted.token,
      maxRequestBodyBytes: MAX_REQUEST_BODY_BYTES,
    });

    try {
      const bytes = Buffer.alloc(32_000, 7);
      const submitted = await aClient.submit(
        baseSubmitBody({ input: inlineBytesInput(bytes) }) as never,
      );
      const artifact = await waitFor(
        () => bStore.getTask(submitted.payload.taskId)?.artifacts[0],
        (item) => Boolean(item?.artifactId),
        4000,
      );
      if (!artifact) {
        throw new Error("Expected artifact after waitFor");
      }
      let delivered = false;
      let error: unknown;
      try {
        const result = await aClient.artifact({
          "exec-api-version": 1,
          tenantId: TEST_TENANT,
          taskId: submitted.payload.taskId,
          artifactId: artifact.artifactId,
          includeBytes: true,
        });
        delivered = Boolean(result.payload.delivered);
      } catch (caught) {
        error = caught;
      }
      expect(delivered).toBe(false);
      expect(error).toBeInstanceOf(ExecProtocolError);
      expect((error as ExecProtocolError).code).toBe("EXEC_UNREACHABLE");
      const task = aStore.getTask(submitted.payload.taskId);
      expect(task?.state).not.toBe("succeeded");
      expect(plane.debug().executionsStarted).toBe(0);
      expect(probe.calls).toHaveLength(0);
    } finally {
      await a.stop();
      await b.stop();
      await new Promise<void>((resolve) => proxy.close(() => resolve()));
      await rm(aDir, { recursive: true, force: true });
      await rm(bDir, { recursive: true, force: true });
    }
  });
});
