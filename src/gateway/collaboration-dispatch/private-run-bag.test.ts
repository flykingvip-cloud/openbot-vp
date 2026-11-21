import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertNoPrivateRunBagInPublicPayload,
  containsPrivateRunBagMarker,
  createCollaborationPrivateRunBag,
  durableToolSideEffectKey,
  isCollaborationPrivateRunBagEnabled,
  recordPrivateRunBagToolSideEffect,
  scheduleDurableToolSideEffect,
  setPrivateRunBagScratch,
} from "./private-run-bag.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("private-run-bag", () => {
  it("flag defaults off", () => {
    expect(isCollaborationPrivateRunBagEnabled(undefined)).toBe(false);
    expect(isCollaborationPrivateRunBagEnabled({} as never)).toBe(false);
    expect(
      isCollaborationPrivateRunBagEnabled({ collaboration: { privateRunBag: true } } as never),
    ).toBe(true);
  });

  it("creates ephemeral bag with marker and isolates scratch/side-effects", () => {
    const bag = createCollaborationPrivateRunBag({
      agentId: "bot-a",
      roundId: "round-1",
      participationOverlay: {
        botId: "bot-a",
        groupId: "g1",
        overlayCapabilities: ["cap-a"],
      },
      capabilitySet: { participation: ["cap-a"], final: ["cap-a"] },
    });
    expect(bag.__privateRunBag).toBe(true);
    expect(bag.agentId).toBe("bot-a");
    setPrivateRunBagScratch(bag, "note", "private-only");
    recordPrivateRunBagToolSideEffect(bag, {
      toolName: "read",
      atMs: 10,
      summary: "scratch",
    });
    expect(bag.privateScratch.note).toBe("private-only");
    expect(bag.toolSideEffectIndex).toHaveLength(1);
  });

  it("refuses private bag content for GROUP_PUBLIC payloads", () => {
    const bag = createCollaborationPrivateRunBag({ agentId: "bot-a" });
    expect(containsPrivateRunBagMarker(bag)).toBe(true);
    expect(containsPrivateRunBagMarker({ text: "ok" })).toBe(false);
    expect(() => assertNoPrivateRunBagInPublicPayload(bag)).toThrow(/GROUP_PUBLIC/);
    expect(() => assertNoPrivateRunBagInPublicPayload({ CollaborationPrivateRunBag: bag })).toThrow(
      /private/,
    );
  });

  it("multi-bot bags do not share scratch or overlays", () => {
    const a = createCollaborationPrivateRunBag({
      agentId: "bot-a",
      participationOverlay: { botId: "bot-a", groupId: "g", overlayCapabilities: ["a"] },
    });
    const b = createCollaborationPrivateRunBag({
      agentId: "bot-b",
      participationOverlay: { botId: "bot-b", groupId: "g", overlayCapabilities: ["b"] },
    });
    setPrivateRunBagScratch(a, "secret", "from-a");
    expect(b.privateScratch.secret).toBeUndefined();
    expect(a.participationOverlay?.overlayCapabilities).toEqual(["a"]);
    expect(b.participationOverlay?.overlayCapabilities).toEqual(["b"]);
  });

  it("second schedule does not re-fire the same side-effect fingerprint", async () => {
    const ledgerDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-side-effect-"));
    tempDirs.push(ledgerDir);
    const fingerprint = {
      taskId: "task-1",
      boardItemId: "item-1",
      stepId: "step-1",
      toolName: "message",
    };
    const calls: string[] = [];
    const firstBag = createCollaborationPrivateRunBag({ agentId: "bot-a" });
    const first = await scheduleDurableToolSideEffect({
      ledgerDir,
      fingerprint,
      bag: firstBag,
      summary: "sent",
      nowMs: 10,
      run: () => {
        calls.push("fired");
        return "ok";
      },
    });
    expect(first.skipped).toBe(false);
    expect(first.value).toBe("ok");
    expect(calls).toEqual(["fired"]);
    expect(firstBag.toolSideEffectIndex).toHaveLength(1);

    const restartedBag = createCollaborationPrivateRunBag({ agentId: "bot-a" });
    const second = await scheduleDurableToolSideEffect({
      ledgerDir,
      fingerprint,
      bag: restartedBag,
      nowMs: 20,
      run: () => {
        calls.push("duplicate");
        return "again";
      },
    });
    expect(second.skipped).toBe(true);
    expect(second.value).toBeUndefined();
    expect(calls).toEqual(["fired"]);
    expect(restartedBag.toolSideEffectIndex).toHaveLength(0);

    const other = await scheduleDurableToolSideEffect({
      ledgerDir,
      fingerprint: { ...fingerprint, stepId: "step-2" },
      run: () => {
        calls.push("other-step");
      },
    });
    expect(other.skipped).toBe(false);
    expect(calls).toEqual(["fired", "other-step"]);
  });

  it("detects private bag marker in serialized transcript body strings", () => {
    const bag = createCollaborationPrivateRunBag({ agentId: "bot-a" });
    const body = JSON.stringify({ type: "message", message: { role: "assistant", meta: bag } });
    expect(containsPrivateRunBagMarker(body)).toBe(true);
    expect(() =>
      assertNoPrivateRunBagInPublicPayload(body, "GROUP_PUBLIC transcript write"),
    ).toThrow(/transcript write/);
    expect(containsPrivateRunBagMarker('{"role":"assistant","text":"ok"}')).toBe(false);
  });

  it("concurrency: overlapping scheduleDurableToolSideEffect cannot duplicate side effects", async () => {
    const ledgerDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-side-effect-race-"));
    tempDirs.push(ledgerDir);
    const fingerprint = {
      taskId: "task-race",
      boardItemId: "item-1",
      stepId: "step-1",
      toolName: "message",
    };
    let fires = 0;
    const workers = 12;
    const results = await Promise.all(
      Array.from({ length: workers }, () =>
        scheduleDurableToolSideEffect({
          ledgerDir,
          fingerprint,
          run: async () => {
            fires += 1;
            return "sent";
          },
        }),
      ),
    );
    const ran = results.filter((row) => !row.skipped);
    const skipped = results.filter((row) => row.skipped);
    expect(fires).toBe(1);
    expect(ran).toHaveLength(1);
    expect(skipped).toHaveLength(workers - 1);
  });

  it("unknown outcome after claim: failed run stays claimed — no blind rematerialize", async () => {
    const ledgerDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-side-effect-unknown-"));
    tempDirs.push(ledgerDir);
    const fingerprint = {
      taskId: "task-unknown",
      boardItemId: "item-1",
      stepId: "step-write",
      toolName: "exec",
    };
    const fires: string[] = [];
    await expect(
      scheduleDurableToolSideEffect({
        ledgerDir,
        fingerprint,
        run: async () => {
          fires.push("first");
          // Simulate result-unknown after write already claimed: throw without
          // trusted receipt. Slot must remain claimed.
          throw new Error("result unknown after write");
        },
      }),
    ).rejects.toThrow(/result unknown/);
    expect(fires).toEqual(["first"]);

    await expect(
      scheduleDurableToolSideEffect({
        ledgerDir,
        fingerprint,
        run: async () => {
          fires.push("blind-retry");
          return "should-not-run";
        },
      }),
    ).rejects.toMatchObject({
      name: "ToolOperationOutcomeUnknownError",
      waitCondition: { reason: "external_operation" },
    });
    expect(fires).toEqual(["first"]);
  });
});

it("requires reconciliation for an orphaned claim without a result journal", async () => {
  const ledgerDir = await fs.mkdtemp(path.join(os.tmpdir(), "orphan-side-effect-"));
  tempDirs.push(ledgerDir);
  const fingerprint = {
    taskId: "orphan-task",
    boardItemId: "item",
    stepId: "step",
    toolName: "message",
  };
  await expect(
    scheduleDurableToolSideEffect({
      ledgerDir,
      fingerprint,
      run: async () => {
        throw new Error("interrupted");
      },
    }),
  ).rejects.toThrow("interrupted");
  for (const name of await fs.readdir(ledgerDir)) {
    const file = path.join(ledgerDir, name);
    if (name.endsWith(".result")) {
      await fs.unlink(file);
    } else if (name.endsWith(".json")) {
      const claim = JSON.parse(await fs.readFile(file, "utf8"));
      expect(claim.ownerToken).toBeTruthy();
      claim.ownerPid = 2147483647;
      await fs.writeFile(file, JSON.stringify(claim));
    }
  }
  let retried = false;
  await expect(
    scheduleDurableToolSideEffect({
      ledgerDir,
      fingerprint,
      run: async () => {
        retried = true;
      },
    }),
  ).rejects.toMatchObject({ name: "ToolOperationOutcomeUnknownError" });
  expect(retried).toBe(false);
});

it("isolates canonical tool operations and rejects task identity mismatches", () => {
  const fingerprint = {
    taskId: "task",
    boardItemId: "item",
    stepId: "step",
    toolName: "message",
    operationIdentity: {
      tenantId: "tenant",
      taskId: "task",
      executionId: "execution",
      stepId: "step",
      operationId: "operation",
    },
  };
  expect(durableToolSideEffectKey(fingerprint)).not.toBe(
    durableToolSideEffectKey({ ...fingerprint, toolName: "exec" }),
  );
  expect(() => durableToolSideEffectKey({ ...fingerprint, taskId: "other" })).toThrow("conflicts");
});
