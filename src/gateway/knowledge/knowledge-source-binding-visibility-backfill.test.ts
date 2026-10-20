// @vitest-environment node
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tmpDir = path.join(os.tmpdir(), `openbot-kb-backfill-${randomUUID()}`);

vi.mock("../../utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils.js")>();
  return {
    ...actual,
    CONFIG_DIR: tmpDir,
  };
});

const { createKnowledgeBase } = await import("./knowledge-base-store.js");
const { bindKnowledgeSource, listKnowledgeSourceBindings } =
  await import("./sources/source-binding-store.js");
const { backfillSourceBindingVisibilities } =
  await import("./knowledge-source-binding-visibility-backfill.js");

function kbStorePath(): string {
  return path.join(tmpDir, "knowledge", "bases.json");
}

function bindingStorePath(): string {
  return path.join(tmpDir, "knowledge", "source-bindings.json");
}

describe("source binding visibility backfill", () => {
  beforeEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(path.join(tmpDir, "knowledge"), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("overwrites stale binding visibility from the target knowledge base", () => {
    const kb = createKnowledgeBase(
      { title: "Team space", visibility: "team", ownerId: "user-a", tenantId: "tenant-1" },
      kbStorePath(),
    );
    bindKnowledgeSource(
      {
        kind: "api",
        title: "CRM",
        knowledgeBaseId: kb.id,
        ownerId: "user-a",
        visibility: "private",
      },
      bindingStorePath(),
    );

    const first = backfillSourceBindingVisibilities({
      bindings: JSON.parse(fs.readFileSync(bindingStorePath(), "utf-8")).bindings,
      kbStorePath: kbStorePath(),
    });
    expect(first.result.updated).toBe(1);
    fs.writeFileSync(
      bindingStorePath(),
      `${JSON.stringify({ bindings: first.bindings }, null, 2)}\n`,
      "utf8",
    );

    const listed = listKnowledgeSourceBindings({}, bindingStorePath());
    expect(listed[0]?.visibility).toBe("team");

    const second = backfillSourceBindingVisibilities({
      bindings: JSON.parse(fs.readFileSync(bindingStorePath(), "utf-8")).bindings,
      kbStorePath: kbStorePath(),
    });
    expect(second.result.updated).toBe(0);
    expect(second.result.unchanged).toBe(1);
  });
});
