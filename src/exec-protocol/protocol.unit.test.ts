import { describe, expect, it } from "vitest";
import { ExecHttpClient } from "./client.js";
import { isolationProfile } from "./config.js";
import { ExecProtocolError } from "./errors.js";
import { createHostCommandProbe } from "./host-fallback.js";
import {
  MAX_REQUEST_BODY_BYTES,
  TEST_TENANT,
  baseSubmitBody,
  getFreePort,
  inlineJsonInput,
  startIsolatedPair,
  uniqueIdempotencyKey,
  waitFor,
} from "./test-helpers.js";

describe("exec protocol HTTP unit paths", () => {
  it("rejects missing, non-integer, or non-1 exec-api-version with EXEC_VERSION_UNSUPPORTED", async () => {
    const pair = await startIsolatedPair();
    try {
      for (const body of [
        { idempotencyKey: uniqueIdempotencyKey(), tenantId: TEST_TENANT },
        { "exec-api-version": "1", tenantId: TEST_TENANT },
        { "exec-api-version": 2, tenantId: TEST_TENANT },
      ]) {
        try {
          await pair.aClient.status({
            ...(body as { "exec-api-version": 1; tenantId: string }),
          });
          throw new Error("expected version error");
        } catch (error) {
          expect(error).toBeInstanceOf(ExecProtocolError);
          expect((error as ExecProtocolError).code).toBe("EXEC_VERSION_UNSUPPORTED");
          expect((error as ExecProtocolError).httpStatus).toBe(400);
        }
      }
    } finally {
      await pair.stop();
    }
  });

  it("rejects missing tokens as EXEC_UNAUTHORIZED and does not reveal whether a task exists", async () => {
    const pair = await startIsolatedPair();
    try {
      const submitted = await pair.aClient.submit(
        baseSubmitBody({ toolCallId: uniqueIdempotencyKey("tool") }) as never,
      );
      const anonymous = new ExecHttpClient({
        baseUrl: pair.a.baseUrl,
        config: pair.configA,
        leaseToken: "exec1_" + "0".repeat(64),
        maxRequestBodyBytes: MAX_REQUEST_BODY_BYTES,
      });
      try {
        await anonymous.status({
          "exec-api-version": 1,
          tenantId: TEST_TENANT,
          taskId: submitted.payload.taskId,
        });
        throw new Error("expected unauthorized");
      } catch (error) {
        expect((error as ExecProtocolError).code).toBe("EXEC_UNAUTHORIZED");
        expect((error as ExecProtocolError).httpStatus).toBe(401);
        expect((error as ExecProtocolError).taskId).toBeUndefined();
      }
    } finally {
      await pair.stop();
    }
  });

  it("query does not start execution", async () => {
    const pair = await startIsolatedPair({}, { autoStartExecution: false });
    try {
      const submitted = await pair.aClient.submit(baseSubmitBody({}) as never);
      for (let i = 0; i < 5; i += 1) {
        const status = await pair.aClient.status({
          "exec-api-version": 1,
          tenantId: TEST_TENANT,
          taskId: submitted.payload.taskId,
        });
        expect(["accepted", "queued"]).toContain(status.payload.state);
      }
      expect(pair.b.debug().executionsStarted).toBe(0);
      expect(pair.plane.debug().executionsStarted).toBe(0);
      expect(pair.aStore.data().executionJournal).toHaveLength(0);
    } finally {
      await pair.stop();
    }
  });

  it("cancels an in-flight sleep task and does not restart it", async () => {
    const pair = await startIsolatedPair();
    try {
      const submitted = await pair.aClient.submit(
        baseSubmitBody({
          kind: "sleep",
          sleepMs: 5000,
          input: inlineJsonInput({ wait: true }),
        }) as never,
      );
      await waitFor(
        () =>
          pair.aClient.status({
            "exec-api-version": 1,
            tenantId: TEST_TENANT,
            taskId: submitted.payload.taskId,
          }),
        (result) => result.payload.state === "running" || result.payload.state === "queued",
      );
      const cancelled = await pair.aClient.cancel({
        "exec-api-version": 1,
        tenantId: TEST_TENANT,
        taskId: submitted.payload.taskId,
      });
      expect(["cancel_requested", "cancelled"]).toContain(cancelled.payload.state);
      const finalState = await waitFor(
        () =>
          pair.aClient.status({
            "exec-api-version": 1,
            tenantId: TEST_TENANT,
            taskId: submitted.payload.taskId,
          }),
        (result) => result.payload.state === "cancelled",
      );
      expect(finalState.payload.state).toBe("cancelled");
      const again = await pair.aClient.cancel({
        "exec-api-version": 1,
        tenantId: TEST_TENANT,
        taskId: submitted.payload.taskId,
      });
      expect(again.payload.state).toBe("cancelled");
    } finally {
      await pair.stop();
    }
  });

  it("marks result_unconfirmed when an ignore-cancel task exceeds the cancel deadline", async () => {
    const pair = await startIsolatedPair({ cancelDeadlineMs: 80 });
    try {
      const submitted = await pair.aClient.submit(
        baseSubmitBody({
          kind: "ignore-cancel",
          sleepMs: 2000,
          input: inlineJsonInput({ hold: true }),
        }) as never,
      );
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
      const finalState = await waitFor(
        () =>
          pair.aClient.status({
            "exec-api-version": 1,
            tenantId: TEST_TENANT,
            taskId: submitted.payload.taskId,
          }),
        (result) => result.payload.state === "result_unconfirmed",
        4000,
      );
      expect(finalState.payload.state).toBe("result_unconfirmed");
    } finally {
      await pair.stop();
    }
  });

  it("revoke rejects new submits and treats in-flight work as cancelled or unconfirmed", async () => {
    const pair = await startIsolatedPair();
    try {
      const inFlight = await pair.aClient.submit(
        baseSubmitBody({ kind: "sleep", sleepMs: 4000, input: inlineJsonInput({ x: 1 }) }) as never,
      );
      await pair.aClient.revoke({
        "exec-api-version": 1,
        tenantId: TEST_TENANT,
      });
      try {
        await pair.aClient.submit(baseSubmitBody({ input: inlineJsonInput({ y: 2 }) }) as never);
        throw new Error("expected revoked");
      } catch (error) {
        expect((error as ExecProtocolError).code).toBe("EXEC_REVOKED");
        expect((error as ExecProtocolError).httpStatus).toBe(403);
      }
      const after = await waitFor(
        () =>
          pair.aClient.status({
            "exec-api-version": 1,
            tenantId: TEST_TENANT,
            taskId: inFlight.payload.taskId,
          }),
        (result) =>
          result.payload.state === "cancelled" ||
          result.payload.state === "cancel_requested" ||
          result.payload.state === "result_unconfirmed",
      );
      expect(["cancelled", "cancel_requested", "result_unconfirmed"]).toContain(
        after.payload.state,
      );
    } finally {
      await pair.stop();
    }
  });

  it("same idempotency key returns the original task; a different intent conflicts", async () => {
    const pair = await startIsolatedPair();
    try {
      const key = uniqueIdempotencyKey("same");
      const toolCallId = uniqueIdempotencyKey("tool");
      const first = await pair.aClient.submit(
        baseSubmitBody({
          idempotencyKey: key,
          toolCallId,
          input: inlineJsonInput({ n: 1 }),
        }) as never,
      );
      expect(first.httpStatus).toBe(201);
      const second = await pair.aClient.submit(
        baseSubmitBody({
          idempotencyKey: key,
          toolCallId,
          input: inlineJsonInput({ n: 1 }),
        }) as never,
      );
      expect(second.httpStatus).toBe(200);
      expect(second.payload.taskId).toBe(first.payload.taskId);
      try {
        await pair.aClient.submit(
          baseSubmitBody({
            idempotencyKey: key,
            toolCallId: uniqueIdempotencyKey("other-tool"),
            input: inlineJsonInput({ n: 1 }),
          }) as never,
        );
        throw new Error("expected conflict");
      } catch (error) {
        expect((error as ExecProtocolError).code).toBe("EXEC_CONFLICT");
        expect((error as ExecProtocolError).httpStatus).toBe(409);
        expect((error as ExecProtocolError).taskId).toBe(first.payload.taskId);
      }
    } finally {
      await pair.stop();
    }
  });

  it("checksum mismatch cannot enter succeeded or be delivered", async () => {
    const pair = await startIsolatedPair();
    try {
      const submitted = await pair.aClient.submit(
        baseSubmitBody({
          kind: "corrupt-checksum",
          input: inlineJsonInput({ body: "data" }),
        }) as never,
      );
      await waitFor(
        async () => {
          try {
            const status = await pair.aClient.status({
              "exec-api-version": 1,
              tenantId: TEST_TENANT,
              taskId: submitted.payload.taskId,
            });
            return status;
          } catch (error) {
            if (error instanceof ExecProtocolError && error.code === "EXEC_CHECKSUM_MISMATCH") {
              return { httpStatus: 422, payload: { state: "failed", artifacts: [] as never[] } };
            }
            throw error;
          }
        },
        (result) =>
          result.payload.state === "failed" || result.payload.state === "result_unconfirmed",
      );
      const status = await pair.aClient
        .status({
          "exec-api-version": 1,
          tenantId: TEST_TENANT,
          taskId: submitted.payload.taskId,
        })
        .catch((error: unknown) => error);
      if (status instanceof ExecProtocolError) {
        expect(status.code).toBe("EXEC_CHECKSUM_MISMATCH");
      } else {
        expect((status as { payload: { state: string } }).payload.state).not.toBe("succeeded");
      }
      const task = pair.plane.store.getTask(submitted.payload.taskId);
      expect(task?.state).not.toBe("succeeded");
    } finally {
      await pair.stop();
    }
  });

  it("classifies a client with no HTTP response as EXEC_UNREACHABLE and does not run a host command", async () => {
    const port = await getFreePort();
    const probe = createHostCommandProbe();
    const client = new ExecHttpClient({
      baseUrl: `http://127.0.0.1:${port}`,
      config: isolationProfile({ port, connectTimeoutMs: 200, requestTimeoutMs: 200 }),
      leaseToken: "exec1_" + "ab".repeat(32),
      maxRequestBodyBytes: MAX_REQUEST_BODY_BYTES,
    });
    try {
      await client.status({
        "exec-api-version": 1,
        tenantId: TEST_TENANT,
        taskId: "tsk_" + "a".repeat(32),
      });
      throw new Error("expected unreachable");
    } catch (error) {
      expect(error).toBeInstanceOf(ExecProtocolError);
      expect((error as ExecProtocolError).code).toBe("EXEC_UNREACHABLE");
      expect((error as ExecProtocolError).httpStatus).toBe(503);
    }
    expect(probe.calls).toHaveLength(0);
  });
});
