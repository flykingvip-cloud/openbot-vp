import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, expect, it, vi } from "vitest";
import type { AnyAgentTool } from "../../../agents/tools/common.js";
import {
  executeClaimedToolOperation,
  readToolOperation,
  withToolOperationAdmission,
} from "../../state/repository/tool-operation.js";
import { assertToolResultReplayAllowed, wrapToolWithBeforeToolCallHook } from "../index.js";

const state = vi.hoisted(() => ({
  failOpaque: false,
  refusal: undefined as string | undefined,
  afterIntent: undefined as undefined | (() => void),
  hook: undefined as undefined | (() => Promise<{ block: boolean; blockReason: string }>),
}));
vi.mock("../../state/task-action.js", () => ({
  checkTaskActionBoundary: () => state.refusal,
}));
vi.mock("../../../plugins/hook-runner-global.js", () => ({
  getGlobalHookRunner: () =>
    state.hook ? { hasHooks: () => true, runBeforeToolCall: state.hook } : null,
}));
beforeEach(() => {
  state.failOpaque = false;
  state.refusal = undefined;
  state.afterIntent = undefined;
  state.hook = undefined;
});

function fixture(
  beforeEffect: () => Promise<void>,
  authorizeStoredResultRead?: () => "allowed" | "denied" | "unverifiable",
) {
  const execute = vi.fn().mockResolvedValue({ content: [], details: { status: "ok" } });
  const tool = wrapToolWithBeforeToolCallHook(
    { name: "write", execute } as unknown as AnyAgentTool,
    {
      // The boundary reader is controlled to model an owner update during authority I/O.
      taskBoundary: {} as never,
      beforeEffect,
      authorizeStoredResultRead,
    },
  );
  return { tool, execute };
}

it("refuses a late task boundary changed during awaited authority lookup", async () => {
  const { tool, execute } = fixture(async () => {
    await Promise.resolve();
    state.refusal = "owner cancelled";
  });
  await expect(tool.execute("late-boundary", {})).rejects.toThrow("owner cancelled");
  expect(execute).not.toHaveBeenCalled();
});

it("honors abort arriving during awaited authority lookup", async () => {
  const controller = new AbortController();
  const { tool, execute } = fixture(async () => {
    await Promise.resolve();
    controller.abort();
  });
  await expect(tool.execute("late-abort", {}, controller.signal)).rejects.toMatchObject({
    name: "AbortError",
  });
  expect(execute).not.toHaveBeenCalled();
});

it("checks current authority and task boundary on a stored-result replay without executing", async () => {
  let allowed = true;
  const { tool, execute } = fixture(
    async () => {
      if (!allowed) {
        throw new Error("authority_revoked");
      }
    },
    () => (allowed ? "allowed" : "denied"),
  );
  // Tool wrappers use spread: the replay guard must survive that production pattern.
  const copied = { ...tool };
  await expect(assertToolResultReplayAllowed(copied, {})).resolves.toBeUndefined();
  allowed = false;
  await expect(assertToolResultReplayAllowed(copied, {})).rejects.toThrow("denied");
  allowed = true;
  state.refusal = "owner paused";
  await expect(assertToolResultReplayAllowed(copied, {})).rejects.toThrow("owner paused");
  expect(execute).not.toHaveBeenCalled();
});

vi.mock("../../../infra/json-files.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../infra/json-files.js")>();
  return {
    ...actual,
    writeJsonAtomic: async (...args: Parameters<typeof actual.writeJsonAtomic>) => {
      if (state.failOpaque && (args[1] as { state?: string }).state === "unknown") {
        throw new Error("opaque persistence failed");
      }
      await actual.writeJsonAtomic(...args);
      if ((args[1] as { state?: string }).state === "intent") {
        state.afterIntent?.();
      }
    },
  };
});

it.each(["permission", "late_abort", "late_boundary"])(
  "records %s admission refusal as not_issued, preserving audit on a new attempt",
  async (reason) => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rj1-admission-"));
    try {
      const file = path.join(dir, "operation.result");
      const controller = new AbortController();
      let allowed = false;
      if (reason === "hook") {
        state.hook = async () => ({ block: true, blockReason: "hook_denied" });
      }
      const { tool, execute } = fixture(async () => {
        if (!allowed && reason === "permission") {
          throw new Error("authority_revoked");
        }
        if (!allowed && reason === "late_abort") {
          controller.abort();
        }
        if (!allowed && reason === "late_boundary") {
          state.refusal = "owner cancelled";
        }
      });
      const run = (signal?: AbortSignal) =>
        withToolOperationAdmission("tenant:a/params:a", () =>
          executeClaimedToolOperation({
            file,
            operationId: "op",
            run: () => tool.execute("call", {}, signal),
          }),
        );
      await expect(run(controller.signal)).rejects.toBeDefined();
      expect(execute).not.toHaveBeenCalled();
      const refused = await readToolOperation(file);
      expect(refused?.state).toBe("not_issued");
      expect(refused?.refusals).toHaveLength(1);
      allowed = true;
      state.refusal = undefined;
      state.hook = undefined;
      await run();
      const completed = await readToolOperation(file);
      expect(completed?.state).toBe("succeeded");
      expect(completed?.attemptId).not.toBe(refused?.attemptId);
      expect(completed?.refusals).toEqual(refused?.refusals);
      expect(execute).toHaveBeenCalledTimes(1);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  },
);

it.each(["abort", "boundary"])(
  "keeps intent-commit await followed by %s as unknown, with zero dispatch and no retry",
  async (reason) => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rj1-intent-window-"));
    try {
      const file = path.join(dir, "operation.result");
      const controller = new AbortController();
      state.afterIntent = () => {
        if (reason === "abort") {
          controller.abort();
        } else {
          state.refusal = "owner cancelled after intent";
        }
      };
      const { tool, execute } = fixture(async () => {});
      const run = () =>
        withToolOperationAdmission("tenant:a", () =>
          executeClaimedToolOperation({
            file,
            operationId: "op",
            run: () => tool.execute("call", {}, controller.signal),
          }),
        );
      await expect(run()).rejects.toBeDefined();
      expect((await readToolOperation(file))?.state).toBe("unknown");
      expect(execute).not.toHaveBeenCalled();
      state.afterIntent = undefined;
      state.refusal = undefined;
      await expect(run()).rejects.toMatchObject({ name: "ToolOperationOutcomeUnknownError" });
      expect(execute).not.toHaveBeenCalled();
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  },
);

it.each(["throw", "blocked"])(
  "keeps an opaque hook's effect followed by %s unknown and never repeats it",
  async (mode) => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "opaque-hook-"));
    try {
      let hookEffects = 0;
      state.hook = async () => {
        hookEffects++;
        if (mode === "throw") {
          throw new Error("hook failed after effect");
        }
        return { block: true, blockReason: "hook blocked after effect" };
      };
      const { tool, execute } = fixture(async () => {
        throw new Error("authority_revoked");
      });
      const file = path.join(dir, "op.result");
      const run = () =>
        withToolOperationAdmission("scope", () =>
          executeClaimedToolOperation({
            file,
            operationId: "op",
            run: () => tool.execute("call", {}),
          }),
        );
      await expect(run()).rejects.toBeDefined();
      expect((await readToolOperation(file))?.state).toBe("unknown");
      await expect(run()).rejects.toMatchObject({ name: "ToolOperationOutcomeUnknownError" });
      expect(hookEffects).toBe(1);
      expect(execute).not.toHaveBeenCalled();
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  },
);

it.each(["allowed", "denied", "unverifiable", "missing"] as const)(
  "requires explicit host read authority: %s",
  async (decision) => {
    const { tool, execute } = fixture(
      async () => {},
      decision === "missing" ? undefined : () => decision,
    );
    let hookEffects = 0;
    state.hook = async () => {
      hookEffects++;
      return { block: false, blockReason: "" };
    };
    const read = assertToolResultReplayAllowed(tool, { allow: true });
    if (decision === "allowed") {
      await expect(read).resolves.toBeUndefined();
    } else {
      await expect(read).rejects.toThrow("Stored result read authorization");
    }
    expect(hookEffects).toBe(0);
    expect(execute).not.toHaveBeenCalled();
  },
);

it("fails closed before hook dispatch when opaque-boundary persistence fails", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "opaque-write-failure-"));
  try {
    let hookEffects = 0;
    state.hook = async () => {
      hookEffects++;
      return { block: false, blockReason: "" };
    };
    const { tool, execute } = fixture(async () => {});
    const file = path.join(dir, "op.result");
    state.failOpaque = true;
    await expect(
      withToolOperationAdmission("scope", () =>
        executeClaimedToolOperation({
          file,
          operationId: "op",
          run: () => tool.execute("call", {}),
        }),
      ),
    ).rejects.toThrow("opaque persistence failed");
    expect(hookEffects).toBe(0);
    expect(execute).not.toHaveBeenCalled();
    state.failOpaque = false;
    expect((await readToolOperation(file))?.state).toBe("prepared");
    await expect(
      withToolOperationAdmission("scope", () =>
        executeClaimedToolOperation({
          file,
          operationId: "op",
          run: () => tool.execute("retry", {}),
        }),
      ),
    ).rejects.toMatchObject({ name: "ToolOperationOutcomeUnknownError" });
    expect(hookEffects).toBe(0);
  } finally {
    state.failOpaque = false;
    await fs.rm(dir, { recursive: true, force: true });
  }
});

it("preserves ordinary unjournaled hook-error continuation without opaque persistence", async () => {
  let hookEffects = 0;
  state.failOpaque = true;
  state.hook = async () => {
    hookEffects++;
    throw new Error("ordinary hook error");
  };
  const { tool, execute } = fixture(async () => {});
  await expect(tool.execute("ordinary", {})).resolves.toBeDefined();
  expect(hookEffects).toBe(1);
  expect(execute).toHaveBeenCalledTimes(1);
});
