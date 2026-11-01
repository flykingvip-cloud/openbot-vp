import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CURRENT_SESSION_VERSION } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";
import { isDeliverableResultArtifact } from "../../shared/preview-artifact/deposit-tier.js";
import { declaredDeliverableArtifactFields } from "../../shared/preview-artifact/materialize-declared-artifacts.js";
import { stripControlChannelForDisplay } from "../../shared/text/control-channel-visibility.js";
import { readSessionMessages } from "../session-utils.fs.js";
import {
  appendInjectedAssistantMessageToTranscript,
  appendPersistedAgentMessageToTranscript,
} from "./chat-transcript-inject.js";
import { sanitizeChatHistoryMessagesForTest } from "./chat.js";

describe("deliverable artifacts persist through transcript → chat.history reload", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  function createTranscript(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "deliverable-persist-"));
    dirs.push(dir);
    const transcriptPath = path.join(dir, "session.jsonl");
    const header = {
      type: "session",
      version: CURRENT_SESSION_VERSION,
      id: "sess-deliverable-persist",
      timestamp: new Date().toISOString(),
      cwd: dir,
    };
    fs.writeFileSync(transcriptPath, `${JSON.stringify(header)}\n`, "utf8");
    return transcriptPath;
  }

  function metaOf(artifact: unknown): Record<string, unknown> {
    return (
      (artifact as { providerMetadata?: Record<string, unknown> } | null)?.providerMetadata ?? {}
    );
  }

  it("group-shaped append (stripped text + artifact) survives reload sanitize", () => {
    const transcriptPath = createTranscript();
    const raw = '<<DELIVERABLE title="SOP" file="email-sending-sop.md">>简短概述<</DELIVERABLE>>';
    const artifacts = declaredDeliverableArtifactFields(raw, { timestamp: 1 });
    expect(artifacts.artifact).toBeTruthy();

    const stripped = stripControlChannelForDisplay(raw);
    expect(stripped).not.toContain("<<DELIVERABLE");
    expect(stripped).not.toContain("file=");

    // Production group final now persists the full final message (not live-only).
    const persisted = {
      role: "assistant",
      content: [{ type: "text", text: stripped }],
      timestamp: 1,
      senderLabel: "bot",
      agentId: "bot",
      collaborationRoundId: "round-1",
      collaborationWrap: true,
      ...(artifacts.artifact ? { artifact: artifacts.artifact } : {}),
      ...(artifacts.artifacts ? { artifacts: artifacts.artifacts } : {}),
    };
    const appended = appendPersistedAgentMessageToTranscript({
      transcriptPath,
      message: persisted,
    });
    expect(appended.ok).toBe(true);

    const reloadedRaw = readSessionMessages("sess-deliverable-persist", undefined, transcriptPath);
    expect(reloadedRaw.length).toBeGreaterThanOrEqual(1);
    const reloaded = sanitizeChatHistoryMessagesForTest(reloadedRaw);
    const message = reloaded[reloaded.length - 1] as Record<string, unknown>;
    const block = (message.content as Array<{ text?: string }>)[0];
    expect(block?.text ?? "").not.toContain("<<DELIVERABLE");
    expect(message.artifact).toBeTruthy();
    expect(isDeliverableResultArtifact(message.artifact as Record<string, unknown>)).toBe(true);
    expect(metaOf(message.artifact).workspaceFilename).toBe("email-sending-sop.md");
    expect(metaOf(message.artifact).declared).toBe(true);
  });

  it("direct-fallback inject append persists artifact for history reload", () => {
    const transcriptPath = createTranscript();
    const raw =
      '旁白。\n<<DELIVERABLE title="报告" type="doc" file="report.md">>\n- 要点\n<</DELIVERABLE>>';
    const artifacts = declaredDeliverableArtifactFields(raw, { timestamp: Date.now() });
    const stripped = stripControlChannelForDisplay(raw);
    const appended = appendInjectedAssistantMessageToTranscript({
      transcriptPath,
      message: stripped,
      artifact: artifacts.artifact,
      artifacts: artifacts.artifacts,
    });
    expect(appended.ok).toBe(true);
    expect(appended.message?.artifact).toBeTruthy();

    const reloadedRaw = readSessionMessages("sess-deliverable-persist", undefined, transcriptPath);
    const reloaded = sanitizeChatHistoryMessagesForTest(reloadedRaw);
    const message = reloaded[reloaded.length - 1] as Record<string, unknown>;
    expect(message.artifact).toBeTruthy();
    expect(metaOf(message.artifact).workspaceFilename).toBe("report.md");
    expect((message.content as Array<{ text?: string }>)[0]?.text ?? "").not.toContain("file=");
  });

  it("multi-file + unwritten item keep per-item status after reload", () => {
    const transcriptPath = createTranscript();
    const raw = [
      '<<DELIVERABLE title="缺失" file="missing.pdf" unwritten="true">>概述A<</DELIVERABLE>>',
      '<<DELIVERABLE title="已写" file="ok.md" settle="confirmed">>概述B<</DELIVERABLE>>',
    ].join("\n");
    const artifacts = declaredDeliverableArtifactFields(raw, { timestamp: 2 });
    expect(artifacts.artifacts?.length).toBeGreaterThanOrEqual(2);
    const stripped = stripControlChannelForDisplay(raw);
    const appended = appendPersistedAgentMessageToTranscript({
      transcriptPath,
      message: {
        role: "assistant",
        content: [{ type: "text", text: stripped }],
        timestamp: 2,
        senderLabel: "member-bot",
        agentId: "member-bot",
        ...(artifacts.artifact ? { artifact: artifacts.artifact } : {}),
        ...(artifacts.artifacts ? { artifacts: artifacts.artifacts } : {}),
      },
    });
    expect(appended.ok).toBe(true);

    const reloaded = sanitizeChatHistoryMessagesForTest(
      readSessionMessages("sess-deliverable-persist", undefined, transcriptPath),
    );
    const message = reloaded[reloaded.length - 1] as Record<string, unknown>;
    const list = (
      Array.isArray(message.artifacts) ? message.artifacts : [message.artifact]
    ) as Array<Record<string, unknown>>;
    const byFile = new Map(
      list.map((a) => {
        const filename = metaOf(a).workspaceFilename;
        const key = typeof filename === "string" ? filename : "";
        return [key, metaOf(a)] as const;
      }),
    );
    expect(byFile.get("missing.pdf")?.previewUnavailable).toBe(true);
    expect(byFile.get("missing.pdf")?.workspaceUnwritten).toBe(true);
    expect(byFile.get("ok.md")?.settleConfirmed).toBe(true);
    expect(byFile.get("ok.md")?.previewUnavailable).toBeUndefined();
  });
});
