// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { tmpDir } = vi.hoisted(() => ({
  tmpDir: `/tmp/openbot-kb-compat-${Math.random().toString(36).slice(2)}`,
}));

vi.mock("../../utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils.js")>();
  return {
    ...actual,
    CONFIG_DIR: tmpDir,
  };
});

const {
  appendCompatWarnings,
  isSourceBindVisibilityInputRejected,
  isStrictKnowledgeBaseIdRequired,
  resolvePersonalImportKnowledgeBase,
  sourceBindVisibilityIgnoredWarning,
} = await import("./knowledge-compat.js");
const { readKnowledgeCompatWarningStats, resetKnowledgeCompatWarningStatsForTests } =
  await import("./knowledge-compat-stats.js");

describe("knowledge-compat", () => {
  beforeEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(path.join(tmpDir, "knowledge"), { recursive: true });
    delete process.env.OPENBOT_KNOWLEDGE_REQUIRE_KNOWLEDGE_BASE_ID;
    delete process.env.OPENCLAW_KNOWLEDGE_REQUIRE_KNOWLEDGE_BASE_ID;
    delete process.env.OPENBOT_KNOWLEDGE_REJECT_SOURCE_BIND_VISIBILITY;
    delete process.env.OPENCLAW_KNOWLEDGE_REJECT_SOURCE_BIND_VISIBILITY;
    resetKnowledgeCompatWarningStatsForTests();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.OPENBOT_KNOWLEDGE_REQUIRE_KNOWLEDGE_BASE_ID;
    delete process.env.OPENCLAW_KNOWLEDGE_REQUIRE_KNOWLEDGE_BASE_ID;
    delete process.env.OPENBOT_KNOWLEDGE_REJECT_SOURCE_BIND_VISIBILITY;
    delete process.env.OPENCLAW_KNOWLEDGE_REJECT_SOURCE_BIND_VISIBILITY;
    resetKnowledgeCompatWarningStatsForTests();
  });

  it("uses explicit knowledgeBaseId without warnings", () => {
    const resolved = resolvePersonalImportKnowledgeBase({
      explicitKbId: "kb-explicit",
      ownerId: "user-a",
      tenantId: null,
    });
    expect(resolved.knowledgeBaseId).toBe("kb-explicit");
    expect(resolved.compatWarnings).toEqual([]);
    expect(resolved.rejectedReason).toBeUndefined();
  });

  it("falls back to personal inbox with compat warning", () => {
    const resolved = resolvePersonalImportKnowledgeBase({
      explicitKbId: undefined,
      ownerId: "user-a",
      tenantId: null,
    });
    expect(resolved.knowledgeBaseId).toBeTruthy();
    expect(resolved.compatWarnings).toHaveLength(1);
    expect(resolved.compatWarnings[0]?.code).toBe("implicit_personal_inbox");
    expect(readKnowledgeCompatWarningStats().implicit_personal_inbox).toBe(1);
  });

  it("rejects implicit inbox when strict flag is enabled", () => {
    process.env.OPENBOT_KNOWLEDGE_REQUIRE_KNOWLEDGE_BASE_ID = "1";
    expect(isStrictKnowledgeBaseIdRequired()).toBe(true);
    const resolved = resolvePersonalImportKnowledgeBase({
      explicitKbId: undefined,
      ownerId: "user-a",
      tenantId: null,
    });
    expect(resolved.knowledgeBaseId).toBeUndefined();
    expect(resolved.rejectedReason).toBe("knowledgeBaseId required");
  });

  it("appends compatWarnings to success payloads", () => {
    const payload = appendCompatWarnings({ ok: true }, [sourceBindVisibilityIgnoredWarning()]);
    expect(payload.compatWarnings).toHaveLength(1);
    expect(payload.ok).toBe(true);
  });

  it("reads reject-source-bind-visibility flag", () => {
    expect(isSourceBindVisibilityInputRejected()).toBe(false);
    process.env.OPENBOT_KNOWLEDGE_REJECT_SOURCE_BIND_VISIBILITY = "1";
    expect(isSourceBindVisibilityInputRejected()).toBe(true);
  });
});
