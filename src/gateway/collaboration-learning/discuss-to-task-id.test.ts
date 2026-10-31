import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  canonicalSerializeFields,
  DISCUSS_TO_TASK_ID_VERSION,
  DISCUSS_TO_TASK_OPERATION_SLOT,
  mintDiscussToTaskId,
} from "./discuss-to-task-id.js";

describe("discuss-to-task-id (pure)", () => {
  it("mints stable taskId from canonical fields without delimiter join", () => {
    const a = mintDiscussToTaskId({
      tenantId: "ten-a",
      groupId: "grp-1",
      sourceMessageId: "msg-1",
    });
    const b = mintDiscussToTaskId({
      tenantId: "ten-a",
      groupId: "grp-1",
      sourceMessageId: "msg-1",
    });
    expect(a).toBe(b);
    expect(a.startsWith("d2t-")).toBe(true);
    const payload = canonicalSerializeFields([
      DISCUSS_TO_TASK_ID_VERSION,
      "ten-a",
      "grp-1",
      "msg-1",
      DISCUSS_TO_TASK_OPERATION_SLOT,
    ]);
    const expectId = `d2t-${createHash("sha256").update(payload).digest("hex").slice(0, 24)}`;
    expect(a).toBe(expectId);
  });

  it("does not collide when a field contains pipe-like content", () => {
    const a = mintDiscussToTaskId({
      tenantId: "a|b",
      groupId: "c",
      sourceMessageId: "d",
    });
    const b = mintDiscussToTaskId({
      tenantId: "a",
      groupId: "b|c",
      sourceMessageId: "d",
    });
    expect(a).not.toBe(b);
  });

  it("new sourceMessageId yields new taskId (same body irrelevant)", () => {
    const a = mintDiscussToTaskId({
      tenantId: "t",
      groupId: "g",
      sourceMessageId: "m1",
    });
    const b = mintDiscussToTaskId({
      tenantId: "t",
      groupId: "g",
      sourceMessageId: "m2",
    });
    expect(a).not.toBe(b);
  });

  it("excludes intentFingerprint — only fixed slot fields", () => {
    expect(DISCUSS_TO_TASK_OPERATION_SLOT).toBe("explicit_task:0");
    const id = mintDiscussToTaskId({
      tenantId: "t",
      groupId: "g",
      sourceMessageId: "m",
      operationSlot: DISCUSS_TO_TASK_OPERATION_SLOT,
    });
    expect(id).toMatch(/^d2t-[a-f0-9]{24}$/);
  });
});
