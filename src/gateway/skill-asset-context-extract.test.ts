import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const stateDir = path.join(os.tmpdir(), `openbot-skill-context-${Date.now()}`);
const agentId = "bot-skill";
const sessionId = "c00945b6-4a1a-4d54-965d-1bcb662ea92d";

import { resolvePreviewArtifactRecord } from "../shared/preview-artifact/resolve-preview-artifact.ts";

const deliverableBody = [
  "# 📋 会议邀请函：{{ 会议主题 }}",
  "",
  "## 🧩 会议基本信息",
  "",
  "| 项目 | 内容 |",
  "| **时间** | {{ YYYY年MM月DD日 }} |",
].join("\n");

const assistantTextWithMalformedOpenTag = [
  "好的，这是最终版。",
  `<<DELIVERABLE title="会议邀请函 · 最终版模板">`,
  deliverableBody,
  "<</DELIVERABLE>>",
].join("\n");

const _assistantText = [
  "好的，这是最终版。",
  `<<DELIVERABLE title="会议邀请函 · 最终版模板">>`,
  deliverableBody,
  "<</DELIVERABLE>>",
].join("\n");

vi.mock("../config/config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../config/config.js")>();
  return {
    ...actual,
    loadConfig: () => ({
      session: { store: path.join(stateDir, "agents", "{agentId}", "sessions", "sessions.json") },
    }),
  };
});

vi.mock("../config/paths.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../config/paths.js")>();
  return {
    ...actual,
    resolveStateDir: () => stateDir,
  };
});

const { hashPreviewText, resolveSkillContextProfile } =
  await import("./skill-asset-context-extract.js");

function writeAgentSession() {
  const sessionsDir = path.join(stateDir, "agents", agentId, "sessions");
  fs.mkdirSync(sessionsDir, { recursive: true });
  const sessionKey = `agent:${agentId}:main`;
  fs.writeFileSync(
    path.join(sessionsDir, "sessions.json"),
    JSON.stringify(
      {
        [sessionKey]: {
          sessionId,
          updatedAt: Date.now(),
        },
      },
      null,
      2,
    ),
  );
  fs.writeFileSync(
    path.join(sessionsDir, `${sessionId}.jsonl`),
    `${JSON.stringify({
      type: "message",
      message: {
        role: "assistant",
        content: [{ type: "text", text: assistantTextWithMalformedOpenTag }],
      },
    })}\n`,
  );
}

describe("skill-asset-context-extract", () => {
  beforeEach(() => {
    fs.rmSync(stateDir, { recursive: true, force: true });
    writeAgentSession();
  });

  afterEach(() => {
    fs.rmSync(stateDir, { recursive: true, force: true });
  });

  it("hashes preview text the same way as the control UI artifact id", () => {
    const title = "会议邀请函 · 最终版模板";
    const artifactId = `assistant-doc:${hashPreviewText(`${title}\n${deliverableBody}`)}`;
    expect(artifactId.startsWith("assistant-doc:")).toBe(true);
  });

  it("resolves assistant-doc context into a template profile with body", async () => {
    const artifact = resolvePreviewArtifactRecord({
      role: "assistant",
      content: [{ type: "text", text: assistantTextWithMalformedOpenTag }],
    });
    const meta = artifact?.providerMetadata as Record<string, unknown> | undefined;
    const artifactId =
      (typeof meta?.legacyArtifactId === "string" ? meta.legacyArtifactId : "") ||
      (typeof artifact?.artifactId === "string" ? artifact.artifactId : "");
    expect(artifactId.startsWith("assistant-doc:")).toBe(true);
    const resolved = await resolveSkillContextProfile({
      agentId,
      contextId: artifactId,
    });
    expect(resolved).not.toBeNull();
    expect(resolved?.profile.assetType).toBe("template");
    expect(resolved?.profile.outputDescription).toContain("会议邀请函");
    expect(resolved?.profile.usageExamples?.length).toBeGreaterThan(0);
    expect(resolved?.profile.category).toBe("会议协作");
    expect(resolved?.profile.templateVariables?.length).toBeGreaterThan(0);
  });

  it("matches the same artifact id as the control UI for malformed deliverable open tags", async () => {
    const artifact = resolvePreviewArtifactRecord({
      role: "assistant",
      content: [{ type: "text", text: assistantTextWithMalformedOpenTag }],
    });
    const meta = artifact?.providerMetadata as Record<string, unknown> | undefined;
    const legacyArtifactId =
      typeof meta?.legacyArtifactId === "string" ? meta.legacyArtifactId : "";
    const resolved = await resolveSkillContextProfile({ agentId, contextId: legacyArtifactId });
    expect(resolved?.deliverable.legacyArtifactId).toBe(legacyArtifactId);
    expect(resolved?.profile.outputDescription).toContain("会议基本信息");
  });

  it("falls back to the latest deliverable in agent sessions when contextId is a session key", async () => {
    const resolved = await resolveSkillContextProfile({
      agentId,
      contextId: `agent:${agentId}:main`,
    });
    expect(resolved?.profile.outputDescription).toContain("会议基本信息");
  });
});
