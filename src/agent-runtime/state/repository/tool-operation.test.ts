import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it, vi } from "vitest";
import {
  executeClaimedToolOperation,
  trustedToolAdmissionRefusal,
  withToolOperationAdmission,
  commitToolOperationWriteIntent,
  readToolOperation,
  listDueToolOperations,
  reconcileClaimedToolOperation,
  ToolOperationOutcomeUnknownError,
} from "./tool-operation.js";
const roots: string[] = [];
afterEach(() => {
  for (const dir of roots.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
function file() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "operation-"));
  roots.push(dir);
  return path.join(dir, "result.json");
}
it("persists the result before returning and replays without a second external write", async () => {
  const target = file();
  const run = vi.fn(async () => ({ receipt: "external-receipt" }));
  const params = { file: target, operationId: "logical-operation", run };
  expect(await executeClaimedToolOperation(params)).toEqual({ receipt: "external-receipt" });
  expect(await readToolOperation(target)).toMatchObject({
    state: "succeeded",
    result: { receipt: "external-receipt" },
  });
  expect(await executeClaimedToolOperation(params)).toEqual({ receipt: "external-receipt" });
  expect(run).toHaveBeenCalledTimes(1);
});
it("does not replay an interrupted external write with an unknown outcome", async () => {
  const target = file();
  const run = vi.fn(async () => {
    throw new Error("connection lost after send");
  });
  const params = { file: target, operationId: "logical-operation", run };
  await expect(executeClaimedToolOperation(params)).rejects.toThrow("connection lost");
  await expect(executeClaimedToolOperation(params)).rejects.toBeInstanceOf(
    ToolOperationOutcomeUnknownError,
  );
  expect(run).toHaveBeenCalledTimes(1);
});
it("fails closed on corrupt journals before invoking the tool", async () => {
  const target = file();
  fs.writeFileSync(target, "{");
  const run = vi.fn();
  await expect(
    executeClaimedToolOperation({ file: target, operationId: "op", run }),
  ).rejects.toThrow();
  expect(run).not.toHaveBeenCalled();
});

it("provides a standard reconciliation wait condition for uncertain writes", () => {
  const error = new ToolOperationOutcomeUnknownError("logical-op");
  expect(error.waitCondition).toEqual({
    waitId: "operation:logical-op",
    reason: "external_operation",
    wakeOn: ["operation:logical-op:reconciled"],
  });
});

it("settles uncertain operations only after a provider query supplies evidence", async () => {
  const target = file();
  await expect(
    executeClaimedToolOperation({
      file: target,
      operationId: "op",
      run: async () => {
        throw new Error("lost response");
      },
    }),
  ).rejects.toThrow();
  expect(
    await reconcileClaimedToolOperation({
      file: target,
      operationId: "op",
      query: async () => ({ kind: "unknown", reason: "provider unavailable" }),
    }),
  ).toMatchObject({ kind: "unknown" });
  expect((await readToolOperation(target))?.state).toBe("unknown");
  expect(
    await reconcileClaimedToolOperation({
      file: target,
      operationId: "op",
      query: async () => ({ kind: "confirmed", evidenceId: "provider-receipt", result: "sent" }),
    }),
  ).toEqual({ kind: "confirmed", result: "sent" });
  const run = vi.fn();
  expect(await executeClaimedToolOperation({ file: target, operationId: "op", run })).toBe("sent");
  expect(run).not.toHaveBeenCalled();
});

it("persists wait scheduling across scans and removes confirmed operations from the queue", async () => {
  const target = file() + ".result";
  await expect(
    executeClaimedToolOperation({
      file: target,
      operationId: "due-op",
      nowMs: 0,
      run: async () => {
        throw new Error("unknown");
      },
    }),
  ).rejects.toThrow();
  expect(await listDueToolOperations(path.dirname(target), 29_999)).toEqual([]);
  expect(await listDueToolOperations(path.dirname(target), 30_000)).toHaveLength(1);
  await reconcileClaimedToolOperation({
    file: target,
    operationId: "due-op",
    query: async () => ({ kind: "unknown", reason: "not yet known" }),
  });
  const waiting = await readToolOperation(target);
  expect(waiting?.wait?.attempts).toBe(1);
  expect(await listDueToolOperations(path.dirname(target), 30_000)).toEqual([]);
  await reconcileClaimedToolOperation({
    file: target,
    operationId: "due-op",
    query: async () => ({ kind: "confirmed", evidenceId: "receipt", result: "done" }),
  });
  expect(await listDueToolOperations(path.dirname(target), Number.MAX_SAFE_INTEGER)).toEqual([]);
});

it("isolates simultaneous operation intent ports and serializes same-operation attempts", async () => {
  const a = file();
  const b = file();
  let effects = 0;
  let release!: () => void;
  let entered!: () => void;
  const ready = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  const first = withToolOperationAdmission("tenant:a", () =>
    executeClaimedToolOperation({
      file: a,
      operationId: "a",
      run: async () => {
        entered();
        await hold;
        await commitToolOperationWriteIntent();
        effects++;
        return "receipt-a";
      },
    }),
  );
  await ready;
  expect((await readToolOperation(a))?.state).toBe("prepared");
  const duplicate = withToolOperationAdmission("tenant:a", () =>
    executeClaimedToolOperation({
      file: a,
      operationId: "a",
      run: async () => {
        effects++;
        return "duplicate";
      },
    }),
  );
  await withToolOperationAdmission("tenant:b", () =>
    executeClaimedToolOperation({
      file: b,
      operationId: "b",
      run: async () => {
        await commitToolOperationWriteIntent();
        expect((await readToolOperation(a))?.state).toBe("prepared");
        return "receipt-b";
      },
    }),
  );
  release();
  expect(await first).toBe("receipt-a");
  expect(await duplicate).toBe("receipt-a");
  expect(effects).toBe(1);
});

it.each(["started", "prepared", "intent"])(
  "never re-admits an orphan %s record from absence of a receipt",
  async (state) => {
    const target = file();
    const run = vi.fn();
    fs.writeFileSync(
      target,
      JSON.stringify({ version: 1, operationId: "op", state, startedAtMs: 0 }),
    );
    await expect(
      withToolOperationAdmission("scope", () =>
        executeClaimedToolOperation({ file: target, operationId: "op", run }),
      ),
    ).rejects.toBeInstanceOf(ToolOperationOutcomeUnknownError);
    expect(run).not.toHaveBeenCalled();
  },
);

it("does not re-admit a refused operation with another tenant or parameter identity", async () => {
  const target = file();
  await expect(
    withToolOperationAdmission("tenant:a/params:1", () =>
      executeClaimedToolOperation({
        file: target,
        operationId: "op",
        run: () => {
          throw trustedToolAdmissionRefusal("denied");
        },
      }),
    ),
  ).rejects.toThrow("denied");
  const audit = await readToolOperation(target);
  const run = vi.fn();
  for (const scope of ["tenant:b/params:1", "tenant:a/params:2"]) {
    await expect(
      withToolOperationAdmission(scope, () =>
        executeClaimedToolOperation({ file: target, operationId: "op", run }),
      ),
    ).rejects.toThrow("scope mismatch");
  }
  expect(await readToolOperation(target)).toEqual(audit);
  expect(run).not.toHaveBeenCalled();
});

it("retains unknown after SIGKILL following durable intent and one effect", async () => {
  const target = file();
  const effect = `${target}.effect`;
  const modulePath = fileURLToPath(new URL("./tool-operation.ts", import.meta.url));
  const source = `import fs from 'node:fs'; import {executeClaimedToolOperation} from ${JSON.stringify(modulePath)};
    await executeClaimedToolOperation({file:${JSON.stringify(target)},operationId:'op',run:async()=>{
      fs.appendFileSync(${JSON.stringify(effect)},'effect\\n'); process.stdout.write('READY'); await new Promise(()=>{});
    }});`;
  const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", source], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  let errors = "";
  child.stderr.on("data", (chunk) => {
    errors += String(chunk);
  });
  try {
    await new Promise<void>((resolve, reject) => {
      child.stdout.on("data", (chunk) => {
        if (String(chunk).includes("READY")) {
          resolve();
        }
      });
      child.once("error", reject);
      child.once("exit", () => reject(new Error(errors || "child exited before ready")));
    });
    const beforeKill = await readToolOperation(target);
    expect(beforeKill?.state).toBe("intent");
    expect(beforeKill?.result).toBeUndefined();
    expect(fs.readFileSync(effect, "utf8")).toBe("effect\n");
    const exited = once(child, "exit");
    child.kill("SIGKILL");
    expect((await exited)[1]).toBe("SIGKILL");
    const run = vi.fn();
    await expect(
      executeClaimedToolOperation({ file: target, operationId: "op", run }),
    ).rejects.toBeInstanceOf(ToolOperationOutcomeUnknownError);
    expect(run).not.toHaveBeenCalled();
    expect(fs.readFileSync(effect, "utf8")).toBe("effect\n");
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
    }
  }
}, 15_000);

it("checks tenant/parameter scope before replaying success", async () => {
  const target = file();
  const run = vi.fn();
  await withToolOperationAdmission("tenant:a/params:1", () =>
    executeClaimedToolOperation({
      file: target,
      operationId: "op",
      run: async () => {
        await commitToolOperationWriteIntent();
        return "receipt";
      },
    }),
  );
  for (const scope of ["tenant:b/params:1", "tenant:a/params:2"]) {
    await expect(
      withToolOperationAdmission(scope, () =>
        executeClaimedToolOperation({ file: target, operationId: "op", run }),
      ),
    ).rejects.toThrow("replay scope mismatch");
  }
  expect(run).not.toHaveBeenCalled();
});

it("does not infer not_issued from an arbitrary throw before intent", async () => {
  const target = file();
  await expect(
    withToolOperationAdmission("scope", () =>
      executeClaimedToolOperation({
        file: target,
        operationId: "op",
        run: () => {
          throw new Error("arbitrary wrapper failure");
        },
      }),
    ),
  ).rejects.toThrow("arbitrary wrapper failure");
  expect((await readToolOperation(target))?.state).toBe("unknown");
});

it("does not reuse a trusted refusal brand across operation attempts", async () => {
  const target = file();
  let original: Error | undefined;
  const first = () =>
    withToolOperationAdmission("scope", () =>
      executeClaimedToolOperation({
        file: target,
        operationId: "op",
        run: () => {
          original = trustedToolAdmissionRefusal("denied");
          throw original;
        },
      }),
    );
  await expect(first()).rejects.toThrow("denied");
  expect((await readToolOperation(target))?.state).toBe("not_issued");
  await expect(
    withToolOperationAdmission("scope", () =>
      executeClaimedToolOperation({
        file: target,
        operationId: "op",
        run: () => {
          throw original;
        },
      }),
    ),
  ).rejects.toThrow("denied");
  expect((await readToolOperation(target))?.state).toBe("unknown");
});

it("does not reuse another operation's completed-domain refusal", async () => {
  const a = file();
  const b = file();
  let original: Error | undefined;
  await expect(
    withToolOperationAdmission("same-scope", () =>
      executeClaimedToolOperation({
        file: a,
        operationId: "a",
        run: () => {
          original = trustedToolAdmissionRefusal("denied");
          throw original;
        },
      }),
    ),
  ).rejects.toThrow("denied");
  await expect(
    withToolOperationAdmission("same-scope", () =>
      executeClaimedToolOperation({
        file: b,
        operationId: "b",
        run: () => {
          throw original;
        },
      }),
    ),
  ).rejects.toThrow("denied");
  expect((await readToolOperation(b))?.state).toBe("unknown");
});
