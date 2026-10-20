import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tmpDir = path.join(os.tmpdir(), `openbot-pattern-task-${Date.now()}`);
vi.mock("../../utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils.js")>();
  return { ...actual, CONFIG_DIR: path.join(tmpDir, "config") };
});

const { resolveRunPatternTaskId } = await import("./resolve-run-task-id.js");

describe("resolveRunPatternTaskId", () => {
  beforeEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(tmpDir, { recursive: true });
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("uses cron provenance", () => {
    expect(
      resolveRunPatternTaskId({
        runId: "r1",
        inputProvenance: { kind: "cron", cronJobId: "job-1", cronRunId: "cr-1" },
      }),
    ).toBe("cron:job-1:cr-1");
  });

  it("reads shared-task taskRefs from data root", () => {
    const dataRoot = path.join(tmpDir, "data");
    const file = path.join(dataRoot, ".meta/conversations/shared-task", "grp_a", "conv_b.json");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      JSON.stringify({
        taskRefs: ["task_shared_1"],
        deliverableRefs: ["deliv_x"],
      }),
      "utf-8",
    );
    expect(
      resolveRunPatternTaskId({
        runId: "r1",
        sessionKey: "agent:bot:main",
        groupId: "grp_a",
        conversationId: "conv_b",
        dataRoot,
      }),
    ).toBe("collab:task_shared_1");
  });

  it("falls back to collab-conv when shared task has no refs", () => {
    expect(
      resolveRunPatternTaskId({
        runId: "r1",
        sessionKey: "agent:bot:main",
        groupId: "grp_z",
        conversationId: "conv_z",
        dataRoot: path.join(tmpDir, "empty"),
      }),
    ).toBe("collab-conv:grp_z:conv_z");
  });
});
