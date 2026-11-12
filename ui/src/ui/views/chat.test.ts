import { html, render } from "lit";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { i18n, t } from "../../i18n/index.ts";
// @vitest-environment jsdom
import { GENERIC_CHAT_ERROR_MESSAGE } from "../chat-error-sanitize.ts";
import { DEFAULT_CHAT_CONTEXT_SCOPE } from "../chat/context-scope.ts";
import { resolvePreviewArtifactRecord } from "../chat/generated-preview-artifact.ts";
import type { ArtifactWorkspaceSidebar, SessionsListResult } from "../types.ts";
import type { ChatAttachment } from "../ui-types.ts";
import { renderArtifactSidebar } from "./artifact-sidebar.ts";
import { renderChat, type ChatProps } from "./chat.ts";

function createSessions(): SessionsListResult {
  return {
    ts: 0,
    path: "",
    count: 0,
    defaults: { model: null, contextTokens: null },
    sessions: [],
  };
}

function createProps(overrides: Partial<ChatProps> = {}): ChatProps {
  return {
    sessionKey: "main",
    onSessionKeyChange: () => undefined,
    thinkingLevel: null,
    showThinking: false,
    loading: false,
    sending: false,
    canAbort: false,
    compactionStatus: null,
    fallbackStatus: null,
    messages: [],
    toolMessages: [],
    streamSegments: [],
    stream: null,
    streamStartedAt: null,
    assistantAvatarUrl: null,
    draft: "",
    queue: [],
    connected: true,
    canSend: true,
    disabledReason: null,
    error: null,
    sessions: createSessions(),
    focusMode: false,
    assistantName: "OpenBot",
    assistantAvatar: null,
    onRefresh: () => undefined,
    onToggleFocusMode: () => undefined,
    onDraftChange: () => undefined,
    onSend: () => undefined,
    onQueueRemove: () => undefined,
    onNewSession: () => undefined,
    ...overrides,
  };
}

function createArtifactWorkspace(): ArtifactWorkspaceSidebar {
  return {
    artifact: {
      artifactId: "artifact:handoff",
      artifactType: "doc",
      storageClass: "collaborative-doc",
      title: "Handoff Spec",
      provider: "software",
      openUrl: "https://example.com/artifact/handoff",
      downloadUrl: "https://example.com/artifact/handoff/download",
      editUrl: "https://example.com/artifact/handoff/edit",
      createdBy: { type: "bot", id: "planner" },
      createdAt: "2026-03-30T08:00:00.000Z",
      updatedAt: "2026-03-30T08:00:00.000Z",
      sourceMessage: "Executive handoff summary\n\n- Scope\n- Risks\n- Next steps",
      lifecycleState: "created",
      providerMetadata: {
        previewText: "Executive handoff summary\n\n- Scope\n- Risks\n- Next steps",
      },
    },
    versions: [
      {
        versionId: "version:v2",
        artifactId: "artifact:handoff",
        label: "v2",
        createdAt: "2026-03-30T08:10:00.000Z",
        createdBy: { type: "bot", id: "planner" },
        changeSummary: "Updated for review",
      },
    ],
    deliveries: [],
    grants: [
      {
        grantId: "grant:1",
        artifactId: "artifact:handoff",
        provider: "software",
        principalType: "service",
        principalId: "bot-reviewer",
        grantedRole: "view",
        grantMode: "named-principal",
        status: "granted",
      },
    ],
    intents: [
      {
        intentId: "intent:pending",
        artifactId: "artifact:handoff",
        targetType: "bot",
        targetRef: "bot-reviewer",
        requestedRole: "edit",
        deliveryMode: "smart",
        identityBindingMode: "named",
        approvalRequired: true,
        requestedBy: { type: "user", id: "operator" },
        status: "pending_approval",
        createdAt: "2026-03-30T08:05:00.000Z",
      },
    ],
  };
}

describe("chat view", () => {
  beforeEach(async () => {
    await i18n.setLocale("en");
  });

  it("renders a runtime failure in the transcript when queue and fallback attempts are missing", () => {
    const essay = "这一轮的可见回复已经写好。";
    const container = document.createElement("div");
    const view = renderChat(
      createProps({
        error: "Cannot read properties of undefined (reading 'length')",
        messages: [
          {
            role: "assistant",
            content: [{ type: "text", text: essay }],
            timestamp: Date.now(),
          },
        ],
        queue: undefined as unknown as ChatProps["queue"],
        fallbackStatus: {
          selected: "model-a",
          active: "model-b",
          occurredAt: Date.now(),
        } as ChatProps["fallbackStatus"],
      }),
    );
    render(view, container);
    expect(container.querySelector(".callout.danger")).toBeNull();
    expect(container.textContent).toContain(GENERIC_CHAT_ERROR_MESSAGE);
    expect(container.textContent).not.toContain("reading 'length'");
    expect(container.textContent).not.toContain("Cannot read properties");
    expect(container.textContent).toContain(essay);
  });

  it("keeps a 大白 guide card out of the plain bubble list", () => {
    const guide = "这份引导会留在大白的对话里，你可以随时回看、预览，或继续从这里调整。";
    const container = document.createElement("div");
    const view = renderChat(
      createProps({
        messages: [
          {
            role: "assistant",
            content: [{ type: "text", text: guide }],
            timestamp: Date.now(),
            openclawDaibaiGuide: {
              v: 1,
              slot: "welcome",
              kind: "welcome",
              updatedAt: 1,
            },
          },
          {
            role: "assistant",
            content: [{ type: "text", text: "普通回复还在。" }],
            timestamp: Date.now(),
          },
        ],
      }),
    );
    render(view, container);
    expect(container.textContent).not.toContain(guide);
    expect(container.textContent).toContain("普通回复还在。");
  });

  it("does not paint a danger banner for an unsupported-image API dump", () => {
    const container = document.createElement("div");
    const view = renderChat(
      createProps({
        error:
          '400: {"message":".messages[2]: You have uploaded an unsupported image. Please make sure your image is valid and has one of the following formats: webp, png, jpeg, and gif.","type":"invalid_request_error"}',
        messages: [
          {
            role: "assistant",
            content: [{ type: "text", text: "去掉附件后再发一次就行。" }],
            timestamp: Date.now(),
          },
        ],
      }),
    );
    render(view, container);
    expect(container.querySelector(".callout.danger")).toBeNull();
    expect(container.textContent).toContain("去掉附件后再发一次就行。");
    expect(container.textContent).not.toContain("invalid_request_error");
  });

  it("does not repeat a runtime failure that is already in the transcript", () => {
    const failure = "Cannot read properties of undefined (reading 'length')";
    const container = document.createElement("div");
    render(
      renderChat(
        createProps({
          error: failure,
          messages: [
            {
              role: "assistant",
              content: [{ type: "text", text: failure }],
              timestamp: Date.now(),
            },
          ],
        }),
      ),
      container,
    );
    expect(container.querySelector(".callout.danger")).toBeNull();
    expect(container.textContent?.match(/reading 'length'/g)).toHaveLength(1);
  });

  it("keeps a send limit on the danger rail", () => {
    const container = document.createElement("div");
    const error = "附件“report.pdf”过大，当前可读取上限为 25 MB，该文件为 30 MB。";
    render(renderChat(createProps({ error })), container);
    expect(container.querySelector(".callout.danger")?.textContent).toContain("report.pdf");
  });

  it("does not render a blocking focus-switch choice card", () => {
    const container = document.createElement("div");
    render(
      renderChat(
        createProps({
          messages: [{ id: "u1", role: "user", content: "请使用 web-research 做一次调研" }],
          focusSwitchGate: {
            currentTitle: "生成今日竞品价格检查结果",
            incomingTitle: "请使用 web-research 做一次调研",
          },
        }),
      ),
      container,
    );

    expect(container.querySelector("[data-testid='chat-focus-switch-gate']")).toBeNull();
    expect(container.textContent).not.toContain("Park and start the new task");
    expect(container.textContent).not.toContain("Keep current");
    expect(container.textContent).not.toContain("Cancel the current task and start the new one");
  });

  it("renders a pending steward authorization as a confirm card, not a chat line", () => {
    const container = document.createElement("div");
    const prompt = "企业管理员需要与你发起对话，是否同意？";
    const onStewardCallAuthorizationDecision = vi.fn();
    render(
      renderChat(
        createProps({
          messages: [
            { id: "u1", role: "user", content: [{ type: "text", text: "今天的安排" }] },
            { id: "a1", role: "assistant", content: [{ type: "text", text: "普通回复" }] },
            {
              id: "auth-1",
              role: "assistant",
              content: [{ type: "text", text: prompt }],
              stewardCallAuthorization: {
                id: "steward-call-1",
                prompt,
                actions: ["同意", "不同意"],
                roleLabel: "企业管理员",
              },
            },
          ],
          onStewardCallAuthorizationDecision,
        }),
      ),
      container,
    );

    const card = container.querySelector("[data-steward-call-authorization='steward-call-1']");
    expect(card).not.toBeNull();
    expect(card?.classList.contains("employee-workbench__steward-confirm-card")).toBe(true);
    expect(card?.closest(".chat-group")).toBeNull();
    expect(card?.textContent).toContain(prompt);
    const buttons = Array.from(card?.querySelectorAll("button") ?? []).map((button) =>
      button.textContent?.trim(),
    );
    expect(buttons).toEqual(["同意", "不同意"]);
    for (const group of Array.from(container.querySelectorAll(".chat-group"))) {
      expect(group.textContent ?? "").not.toContain(prompt);
    }
    expect(
      Array.from(container.querySelectorAll(".chat-group")).some((group) =>
        (group.textContent ?? "").includes("普通回复"),
      ),
    ).toBe(true);
    const plainBubbles = Array.from(container.querySelectorAll(".chat-bubble")).filter(
      (bubble) =>
        !bubble.hasAttribute("data-steward-call-authorization") &&
        (bubble.textContent ?? "").includes(prompt),
    );
    expect(plainBubbles).toEqual([]);

    (card?.querySelector("button.primary") as HTMLButtonElement | null)?.click();
    expect(onStewardCallAuthorizationDecision).toHaveBeenCalledWith("同意", "steward-call-1");
    (
      Array.from(card?.querySelectorAll("button") ?? []).at(-1) as HTMLButtonElement | null
    )?.click();
    expect(onStewardCallAuthorizationDecision).toHaveBeenCalledWith("不同意", "steward-call-1");
  });

  it("shows a thread skeleton instead of a blank loading line", () => {
    const container = document.createElement("div");
    render(renderChat(createProps({ loading: true, messages: [] })), container);

    expect(container.querySelector(".chat-thread-skeleton")).not.toBeNull();
    expect(container.querySelector(".chat-thread-skeleton")?.getAttribute("aria-label")).toBe(
      t("chat.loading"),
    );
    expect(container.querySelector(".chat-thread .muted")).toBeNull();
  });

  it("renders compacting indicator as a badge", () => {
    const container = document.createElement("div");
    render(
      renderChat(
        createProps({
          compactionStatus: {
            active: true,
            startedAt: Date.now(),
            completedAt: null,
          },
        }),
      ),
      container,
    );

    const indicator = container.querySelector(".compaction-indicator--active");
    expect(indicator).not.toBeNull();
    expect(indicator?.textContent).toContain("Compacting context...");
  });

  it("does not draw a duplicate user turn or a second checkpoint for the same text", () => {
    const container = document.createElement("div");
    render(
      renderChat(
        createProps({
          messages: [
            { id: "m0", role: "assistant", content: "prelude" },
            { id: "local-a", role: "user", content: "请写公众号文章" },
            { id: "local-b", role: "user", content: "请写公众号文章" },
          ],
          checkpoints: [
            {
              checkpointId: "cp-1",
              boundaryMessageId: "m0",
              createdAt: "2026-07-07T00:00:00.000Z",
              summary: "s",
              restorable: { files: true, transcript: true },
              externalEffects: { present: false, kinds: [] },
            },
          ],
        }),
      ),
      container,
    );
    const hits = container.textContent?.split("请写公众号文章").length ?? 1;
    expect(hits - 1).toBe(1);
    expect(container.querySelectorAll(".chat-checkpoint").length).toBe(1);
  });

  it("hides the in-progress English status and its timestamp while drafting", () => {
    const container = document.createElement("div");
    render(
      renderChat(
        createProps({
          stream:
            "I have the full paper text and OpenBot's self-evolution docs. Now writing the WeChat article.",
          streamStartedAt: Date.now(),
          workProgressLabel: "正在起草",
          sending: true,
        }),
      ),
      container,
    );
    expect(container.textContent).not.toContain("Now writing");
    expect(container.querySelector(".chat-group-timestamp")).toBeNull();
    expect(container.textContent).toContain("正在起草");
  });

  it("renders a per-turn checkpoint divider with a restore action", () => {
    const container = document.createElement("div");
    const onRequestRestoreCheckpoint = vi.fn();
    render(
      renderChat(
        createProps({
          messages: [
            { id: "m0", role: "assistant", content: "prelude" },
            { id: "m1", role: "user", content: "hello" },
            { id: "m2", role: "assistant", content: "hi" },
            { id: "m3", role: "user", content: "more" },
          ],
          checkpoints: [
            {
              checkpointId: "cp-1",
              boundaryMessageId: "m0",
              createdAt: "2026-07-07T00:00:00.000Z",
              summary: "s",
              restorable: { files: true, transcript: true },
              externalEffects: { present: false, kinds: [] },
            },
          ],
          onRequestRestoreCheckpoint,
        }),
      ),
      container,
    );

    const bar = container.querySelector(".chat-checkpoint");
    expect(bar).not.toBeNull();
    expect(bar?.textContent).toContain("Checkpoint");

    container.querySelector<HTMLButtonElement>(".chat-checkpoint__action")?.click();
    expect(onRequestRestoreCheckpoint).toHaveBeenCalledWith("cp-1");
  });

  it("places checkpoint divider after the boundary message, not at thread end", () => {
    const container = document.createElement("div");
    render(
      renderChat(
        createProps({
          messages: [
            { id: "m0", role: "assistant", content: "prelude" },
            { id: "m1", role: "user", content: "hello" },
            { id: "m2", role: "assistant", content: "hi there" },
            { id: "m3", role: "user", content: "continue" },
            { id: "m4", role: "assistant", content: "done" },
          ],
          checkpoints: [
            {
              checkpointId: "cp-boundary",
              // New capture: boundary is the last kept message before the undone user turn.
              boundaryMessageId: "m2",
              createdAt: "2026-07-07T00:00:00.000Z",
              summary: "s",
              restorable: { files: true, transcript: true },
              externalEffects: { present: false, kinds: [] },
            },
          ],
        }),
      ),
      container,
    );

    const thread = container.querySelector(".chat-thread");
    expect(thread).not.toBeNull();
    const children = Array.from(thread!.children);
    const checkpointIndex = children.findIndex((node) =>
      node.classList.contains("chat-checkpoint"),
    );
    const postBoundaryIndex = children.findIndex((node) => node.textContent?.includes("continue"));
    const helloIndex = children.findIndex((node) => node.textContent?.includes("hello"));
    expect(checkpointIndex).toBeGreaterThan(-1);
    expect(postBoundaryIndex).toBeGreaterThan(-1);
    expect(checkpointIndex).toBeLessThan(postBoundaryIndex);
    expect(helloIndex).toBeGreaterThan(-1);
    expect(helloIndex).toBeLessThan(checkpointIndex);
    expect(checkpointIndex).toBeLessThan(children.length - 1);
  });

  it("re-derives an orphan/tip boundary so the restore line sits before the latest user", () => {
    const container = document.createElement("div");
    render(
      renderChat(
        createProps({
          messages: [
            { id: "u1", role: "user", content: "first" },
            { id: "a1", role: "assistant", content: "ok" },
            { id: "u2", role: "user", content: "second" },
            { id: "a2", role: "assistant", content: "done" },
          ],
          checkpoints: [
            {
              checkpointId: "cp-orphan-boundary",
              boundaryMessageId: "missing-id",
              createdAt: "2026-07-07T00:00:00.000Z",
              summary: "s",
              restorable: { files: true, transcript: true },
              externalEffects: { present: false, kinds: [] },
            },
          ],
        }),
      ),
      container,
    );

    const thread = container.querySelector(".chat-thread");
    expect(thread).not.toBeNull();
    const children = Array.from(thread!.children);
    const checkpointIndex = children.findIndex((node) =>
      node.classList.contains("chat-checkpoint"),
    );
    const secondUserIndex = children.findIndex((node) => node.textContent?.includes("second"));
    expect(checkpointIndex).toBeGreaterThan(-1);
    expect(secondUserIndex).toBeGreaterThan(-1);
    expect(checkpointIndex).toBeLessThan(secondUserIndex);
  });

  it("places a first-turn start-boundary line before the only user instruction", () => {
    const container = document.createElement("div");
    render(
      renderChat(
        createProps({
          messages: [
            { id: "u1", role: "user", content: "TO: Skill孵化" },
            { id: "a1", role: "assistant", content: "已生成 PDF" },
          ],
          checkpoints: [
            {
              checkpointId: "cp-first-turn",
              boundaryMessageId: "__openbot_transcript_start__",
              createdAt: "2026-07-07T00:00:00.000Z",
              summary: "s",
              restorable: { files: true, transcript: true },
              externalEffects: { present: false, kinds: [] },
            },
          ],
        }),
      ),
      container,
    );

    const thread = container.querySelector(".chat-thread");
    expect(thread).not.toBeNull();
    const children = Array.from(thread!.children);
    const checkpointIndex = children.findIndex((node) =>
      node.classList.contains("chat-checkpoint"),
    );
    const userIndex = children.findIndex((node) => node.textContent?.includes("TO: Skill孵化"));
    const assistantIndex = children.findIndex((node) => node.textContent?.includes("已生成 PDF"));
    expect(checkpointIndex).toBeGreaterThan(-1);
    expect(userIndex).toBeGreaterThan(-1);
    expect(checkpointIndex).toBeLessThan(userIndex);
    expect(checkpointIndex).toBeLessThan(assistantIndex);
  });

  it("binds a restore line through the transcript entry id and fills the previous user turn", () => {
    const container = document.createElement("div");
    render(
      renderChat(
        createProps({
          messages: [
            {
              id: "local-a",
              transcriptEntryId: "env-a",
              role: "assistant",
              content: "before",
            },
            { id: "local-u1", transcriptEntryId: "env-u1", role: "user", content: "first ask" },
            { id: "local-b", transcriptEntryId: "env-b", role: "assistant", content: "mid" },
            { id: "local-u2", transcriptEntryId: "env-u2", role: "user", content: "second ask" },
          ],
          checkpoints: [
            {
              checkpointId: "cp-hidden",
              boundaryMessageId: "tool-hidden",
              createdAt: "2026-07-07T00:00:00.000Z",
              summary: "older",
              restorable: { files: true, transcript: true },
              externalEffects: { present: false, kinds: [] },
            },
            {
              checkpointId: "cp-visible",
              boundaryMessageId: "env-b",
              createdAt: "2026-07-07T00:00:02.000Z",
              summary: "newer",
              restorable: { files: true, transcript: true },
              externalEffects: { present: false, kinds: [] },
            },
          ],
        }),
      ),
      container,
    );

    const thread = container.querySelector(".chat-thread");
    const children = Array.from(thread?.children ?? []);
    const lines = children.filter((node) => node.classList.contains("chat-checkpoint"));
    expect(lines).toHaveLength(2);
    const userIndex = (text: string) =>
      children.findIndex(
        (node) => node.classList.contains("chat-group") && node.textContent?.includes(text),
      );
    const firstUser = userIndex("first ask");
    const secondUser = userIndex("second ask");
    const firstLine = children.findIndex((node) => node === lines[0]);
    const secondLine = children.findIndex((node) => node === lines[1]);
    expect(firstLine).toBeGreaterThan(-1);
    expect(firstLine).toBeLessThan(firstUser);
    expect(secondLine).toBeGreaterThan(firstUser);
    expect(secondLine).toBeLessThan(secondUser);
  });

  it("does not park a tip checkpoint restore line after the latest assistant", () => {
    const container = document.createElement("div");
    render(
      renderChat(
        createProps({
          messages: [
            { id: "u1", role: "user", content: "first" },
            { id: "a1", role: "assistant", content: "ok" },
          ],
          checkpoints: [
            {
              checkpointId: "cp-tip",
              boundaryMessageId: "a1",
              createdAt: "2026-07-07T00:00:00.000Z",
              summary: "s",
              restorable: { files: true, transcript: true },
              externalEffects: { present: false, kinds: [] },
            },
          ],
        }),
      ),
      container,
    );

    const thread = container.querySelector(".chat-thread");
    expect(thread).not.toBeNull();
    const children = Array.from(thread!.children);
    const checkpointIndex = children.findIndex((node) =>
      node.classList.contains("chat-checkpoint"),
    );
    const userIndex = children.findIndex((node) => node.textContent?.includes("first"));
    const assistantIndex = children.findIndex((node) => node.textContent?.includes("ok"));
    expect(checkpointIndex).toBeGreaterThan(-1);
    expect(checkpointIndex).toBeLessThan(userIndex);
    expect(checkpointIndex).toBeLessThan(assistantIndex);
  });

  it("does not let a later restored checkpoint steal an earlier turn's divider", () => {
    const container = document.createElement("div");
    const requested: string[] = [];
    render(
      renderChat(
        createProps({
          messages: [
            { id: "b0", role: "assistant", content: "quota" },
            { id: "u1", role: "user", content: "现在可否对话" },
            { id: "a1", role: "assistant", content: "可以的" },
          ],
          checkpoints: [
            {
              checkpointId: "cp-earlier",
              boundaryMessageId: "b0",
              createdAt: "2026-08-04T11:48:22.000Z",
              summary: "earlier",
              restorable: { files: true, transcript: true },
              externalEffects: { present: false, kinds: [] },
            },
            {
              checkpointId: "cp-later-already-restored",
              // Boundary is the last kept message; no user after it.
              boundaryMessageId: "a1",
              createdAt: "2026-08-04T12:07:01.000Z",
              summary: "later",
              restorable: { files: true, transcript: true },
              externalEffects: { present: false, kinds: [] },
            },
          ],
          onRequestRestoreCheckpoint: (id) => requested.push(id),
        }),
      ),
      container,
    );

    expect(container.querySelector(".chat-checkpoint")).not.toBeNull();
    container.querySelector<HTMLButtonElement>(".chat-checkpoint__action")?.click();
    expect(requested).toEqual(["cp-earlier"]);
  });

  it("retargets a no-op tip checkpoint to the earlier truncating checkpoint", async () => {
    const { resolveEffectiveChatRestoreCheckpointId } = await import("./chat.ts");
    const messages = [
      { id: "b0", role: "assistant", content: "quota" },
      { id: "u1", role: "user", content: "现在可否对话" },
      { id: "a1", role: "assistant", content: "可以的" },
    ];
    const checkpoints = [
      {
        checkpointId: "cp-earlier",
        boundaryMessageId: "b0",
        createdAt: "2026-08-04T11:48:22.000Z",
        summary: "earlier",
        restorable: { files: true, transcript: true },
        externalEffects: { present: false, kinds: [] },
      },
      {
        checkpointId: "cp-tip",
        boundaryMessageId: "a1",
        createdAt: "2026-08-04T12:07:01.000Z",
        summary: "tip",
        restorable: { files: true, transcript: true },
        externalEffects: { present: false, kinds: [] },
      },
    ];
    expect(resolveEffectiveChatRestoreCheckpointId(checkpoints, messages, "cp-tip")).toBe(
      "cp-earlier",
    );
  });

  it("renders the checkpoint dashed restore line inside workbench conversation rails", () => {
    const container = document.createElement("div");
    container.innerHTML = `
      <section class="employee-workbench__stage-shell employee-workbench__stage-shell--flat">
        <div class="employee-workbench__collaboration-stage-main employee-workbench__collaboration-stage-main--flat">
          <section class="chat"></section>
        </div>
      </section>
    `;
    const chatHost = container.querySelector(".chat");
    expect(chatHost).not.toBeNull();
    render(
      renderChat(
        createProps({
          messages: [
            { id: "m0", role: "assistant", content: "prelude" },
            { id: "m1", role: "user", content: "hello" },
            { id: "m2", role: "assistant", content: "hi" },
            { id: "m3", role: "user", content: "more" },
          ],
          checkpoints: [
            {
              checkpointId: "cp-workbench",
              boundaryMessageId: "m0",
              createdAt: "2026-07-07T00:00:00.000Z",
              summary: "s",
              restorable: { files: true, transcript: true },
              externalEffects: { present: false, kinds: [] },
            },
          ],
        }),
      ),
      chatHost as HTMLElement,
    );

    expect(container.querySelector(".chat-checkpoint__line")).not.toBeNull();
    expect(container.textContent).toContain("Checkpoint");
  });

  it("does not render a working strip while abort is available", () => {
    const container = document.createElement("div");
    const onAbort = vi.fn();
    render(
      renderChat(
        createProps({
          canAbort: true,
          onAbort,
        }),
      ),
      container,
    );

    expect(container.querySelector(".chat-compose__working")).toBeNull();
    expect(container.textContent).not.toContain("Cancel");

    const stopButton = Array.from(container.querySelectorAll("button")).find(
      (btn) => btn.textContent?.trim() === t("chat.stop"),
    );
    expect(stopButton).not.toBeUndefined();
    stopButton?.click();
    expect(onAbort).toHaveBeenCalledTimes(1);
  });

  it("keeps workbench compose free of the cron follow-up hint and parks the knowledge tab above the input", () => {
    const container = document.createElement("div");
    render(
      renderChat(
        createProps({
          renderMode: "workbench-compact",
          onContextScopeChange: () => undefined,
        }),
      ),
      container,
    );

    expect(container.querySelector(".chat-compose__cron-followup")).toBeNull();
    expect(container.textContent ?? "").not.toContain("可直接在下方输入");
    const tab = container.querySelector(".chat-compose__context-tab");
    const tabs = container.querySelector(".chat-compose__context-tabs");
    const field = container.querySelector(".chat-compose__field");
    const row = container.querySelector(".chat-compose__row");
    expect(tab).not.toBeNull();
    expect(tab?.textContent ?? "").toContain(t("chat.composeContextKnowledge"));
    expect(tab?.textContent ?? "").not.toContain(t("chat.composeContext"));
    expect(tabs?.contains(tab)).toBe(true);
    expect(field?.contains(tab)).toBe(false);
    expect(row?.contains(tab)).toBe(false);
    const shell = container.querySelector(".chat-compose__shell--compact");
    expect(shell).not.toBeNull();
    expect(shell?.contains(tab)).toBe(true);
    expect(shell?.contains(row)).toBe(true);
    expect(container.textContent ?? "").not.toContain(t("chat.newSession"));
    expect(field?.classList.contains("chat-compose__field--with-context")).toBe(false);
    expect(field?.querySelector("textarea")?.getAttribute("rows")).toBe("1");
    expect(
      container
        .querySelector(".chat-compose")
        ?.classList.contains("chat-compose--workbench-compact"),
    ).toBe(true);
  });

  it("hides the context capsule in full workbench compose without compact narrowing", () => {
    const container = document.createElement("div");
    render(
      renderChat(
        createProps({
          renderMode: "full",
          hideContextScope: true,
          onContextScopeChange: () => undefined,
        }),
      ),
      container,
    );

    expect(container.querySelector(".chat-compose--workbench-compact")).toBeNull();
    expect(container.querySelector(".chat-compose__context-tab")).toBeNull();
  });

  it("routes mobile non-compact compose height through SoT token", async () => {
    const { readFile } = await import("node:fs/promises");
    const { resolve } = await import("node:path");
    const mobile = await readFile(resolve("ui/src/styles/layout.mobile.css"), "utf8");
    expect(mobile).toContain(":not(.chat-compose--workbench-compact)");
    expect(mobile).toContain("--chat-compose-field-min-height: 60px");
    expect(mobile).toContain("--chat-compose-field-min-height: 52px");
    expect(mobile).not.toMatch(/^\s*min-height:\s*60px\s*;/m);
    expect(mobile).not.toMatch(/^\s*min-height:\s*52px\s*;/m);
  });

  it("keeps compact compose CSS overlay transparent so context tabs do not hide preview text", async () => {
    const { readFile } = await import("node:fs/promises");
    const { resolve } = await import("node:path");
    const layout = await readFile(resolve("ui/src/styles/chat/layout.css"), "utf8");
    const sidebar = await readFile(resolve("ui/src/styles/chat/sidebar.css"), "utf8");
    const workbench = await readFile(resolve("ui/src/styles/workbench.css"), "utf8");
    expect(sidebar).toContain(".chat-main > .chat-compose");
    expect(sidebar).toMatch(/\.chat-main \{[\s\S]*?position:\s*relative/);
    expect(layout).toContain(".chat-compose.chat-compose--workbench-compact");
    expect(layout).toContain(
      ':root[data-theme="light"] .chat-compose.chat-compose--workbench-compact',
    );
    expect(layout).toContain(".chat-compose:not(.chat-compose--workbench-compact)");
    expect(workbench).toContain(".chat-compose:not(.chat-compose--workbench-compact)");
    expect(workbench).toContain(
      ".employee-workbench__assistant-stage--flat > .chat .chat-compose--workbench-compact",
    );
    const compactRule = workbench.slice(
      workbench.indexOf(
        ".employee-workbench__assistant-stage--flat > .chat .chat-compose--workbench-compact",
      ),
      workbench.indexOf(
        ".employee-workbench__assistant-stage--flat > .chat .chat-compose__shell--compact",
      ),
    );
    expect(compactRule).toMatch(/background:\s*transparent/);
    expect(workbench).toContain(
      ".employee-workbench__main--with-signals\n  .employee-workbench__assistant-stage\n  > .chat\n  .chat-compose--workbench-compact",
    );
    const withSignalsCompact = workbench.slice(
      workbench.indexOf(
        ".employee-workbench__main--with-signals\n  .employee-workbench__assistant-stage\n  > .chat\n  .chat-compose--workbench-compact",
      ),
      workbench.indexOf(
        ".employee-workbench__assistant-stage > .chat .chat-compose--workbench-compact",
      ),
    );
    expect(withSignalsCompact).toMatch(/position:\s*absolute/);
    expect(withSignalsCompact).toMatch(/background:\s*transparent/);
    const baseComposeStart = layout.indexOf(".chat-compose {");
    const baseCompose = layout.slice(baseComposeStart, layout.indexOf("}", baseComposeStart) + 1);
    expect(baseCompose).not.toMatch(/position:\s*sticky/);
    expect(baseCompose).not.toMatch(/linear-gradient/);
    expect(workbench).not.toContain(
      ".employee-workbench__main--with-signals .employee-workbench__assistant-stage > .chat .chat-compose,",
    );
    const compactOverlay = workbench.slice(
      workbench.indexOf(
        ".employee-workbench__assistant-stage > .chat .chat-compose--workbench-compact",
      ),
      workbench.indexOf(
        "/* Share the full-width input column so context capsules align with the compose row.",
      ),
    );
    expect(compactOverlay).toMatch(/position:\s*absolute/);
    expect(compactOverlay).toMatch(/background:\s*transparent/);
    expect(compactOverlay).toMatch(/align-items:\s*stretch/);
    const contextColumnStart = workbench.indexOf(
      "/* Share the full-width input column so context capsules align with the compose row.",
    );
    const contextColumn = workbench.slice(contextColumnStart, contextColumnStart + 1400);
    expect(contextColumn).toMatch(/width:\s*100%/);
    expect(contextColumn).toMatch(/inline-size:\s*100%/);
    expect(contextColumn).toMatch(/align-self:\s*stretch/);
    expect(contextColumn).toContain(".chat-compose__shell--compact");
    expect(contextColumn).not.toContain(".chat-compose__context-tabs");
    expect(contextColumn).toMatch(/align-items:\s*flex-start/);
    expect(contextColumn).toMatch(/padding-inline:\s*0/);
    const flatComposeRow = workbench.slice(
      workbench.indexOf(
        ".employee-workbench__assistant-stage--flat > .chat .chat-compose__shell--compact .chat-compose__row,",
      ),
      workbench.indexOf(
        ".employee-workbench__assistant-stage--flat\n  > .chat\n  .chat-compose__shell--compact\n  .chat-compose__context,",
      ),
    );
    expect(flatComposeRow).toMatch(/inline-size:\s*100%/);
    expect(workbench).toMatch(
      /\.employee-workbench__assistant-stage--flat > \.chat \.chat-compose__shell--compact,[\s\S]*inline-size:\s*100%/,
    );
    expect(workbench).not.toContain(
      ".employee-workbench__collaboration-stage-main--flat\n  > .chat\n  .chat-compose--workbench-compact\n  .chat-compose__context {\n  align-self: flex-start;",
    );
    expect(workbench).toContain("--employee-workbench-preview-compose-reserve");
    expect(workbench).toContain("padding: 0 0 var(--employee-workbench-preview-compose-reserve)");
    expect(workbench).not.toContain("padding: 0 0 72px");
    expect(workbench).not.toContain("padding: 8px 0 72px");
    expect(workbench).toContain("min-block-size: 44px");
    expect(workbench).toContain("transform: translate(-50%, -50%)");
    expect(workbench).toContain(
      ".employee-workbench__assistant-stage > .chat .chat-group:not(.user) .chat-bubble",
    );
    const assistantBubbleFlat = workbench.slice(
      workbench.indexOf(
        ".employee-workbench__assistant-stage > .chat .chat-group:not(.user) .chat-bubble",
      ),
      workbench.indexOf(".employee-workbench__assistant-stage > .chat .chat-group-footer"),
    );
    expect(assistantBubbleFlat).toMatch(/background:\s*transparent/);
    expect(assistantBubbleFlat).toMatch(/box-shadow:\s*none/);
    const stageHeadAlign = workbench.slice(
      workbench.indexOf(".employee-workbench__stage-head-align {"),
      workbench.indexOf(
        ".employee-workbench__stage-head--collaboration .employee-workbench__stage-heading,",
      ),
    );
    expect(stageHeadAlign).toMatch(/min-block-size:\s*36px/);
    expect(stageHeadAlign).not.toMatch(/min-block-size:\s*54px/);
    const collabCapsule = workbench.slice(
      workbench.indexOf(".employee-workbench__collaboration-capsule {"),
      workbench.indexOf(".employee-workbench__collaboration-capsule--flat"),
    );
    expect(collabCapsule).toMatch(/block-size:\s*36px/);
    expect(collabCapsule).toMatch(/min-height:\s*36px/);
    expect(layout).not.toContain(".chat-compose__cron-followup");
    expect(layout).toContain("--chat-compose-compact-row-padding: 8px 12px");
    expect(layout).toContain("padding: var(--chat-compose-compact-row-padding)");
    expect(workbench).toContain("padding: var(--chat-compose-compact-row-padding, 8px 12px)");
    const compactTokenStart = layout.indexOf(".chat-compose.chat-compose--workbench-compact");
    expect(layout.slice(compactTokenStart, compactTokenStart + 220)).toContain(
      "--chat-compose-field-min-height: 28px",
    );
    expect(workbench).toContain("/* SoT: compact workbench textarea is 28px");
    expect(workbench).toMatch(/chat-compose--workbench-compact[\s\S]*min-height:\s*28px/);
    expect(workbench).toContain(
      ".employee-workbench__assistant-stage--flat > .chat .chat-compose__row",
    );
    const flatRow = workbench.slice(
      workbench.indexOf(".employee-workbench__assistant-stage--flat > .chat .chat-compose__row,"),
      workbench.indexOf(
        ".employee-workbench__assistant-stage--flat\n  > .chat\n  .chat-compose__shell--compact\n  .chat-compose__context,",
      ),
    );
    expect(flatRow).toContain("padding: 6px 12px");
    expect(flatRow).not.toContain("--chat-compose-compact-row-padding");
  });

  it("does not render the collaboration @ hint above the room input", () => {
    const container = document.createElement("div");
    render(
      renderChat(
        createProps({
          renderMode: "workbench-compact",
          sessionKey: "space:alpha",
        }),
      ),
      container,
    );
    expect(container.querySelector("[data-testid=collaboration-mention-hint]")).toBeNull();
    expect(container.querySelector(".chat-compose__mention-hint")).toBeNull();
  });

  it("turns the compact send button into stop while abort is available", () => {
    const container = document.createElement("div");
    const onAbort = vi.fn();
    render(
      renderChat(
        createProps({
          renderMode: "workbench-compact",
          canAbort: true,
          onAbort,
        }),
      ),
      container,
    );

    expect(container.querySelector(".chat-compose__working")).toBeNull();
    expect(container.textContent).not.toContain("Cancel");

    const micButton = container.querySelector<HTMLButtonElement>(
      '.chat-compose__icon-btn[aria-label="Voice"]',
    );
    expect(micButton).not.toBeNull();
    expect(micButton?.disabled).toBe(true);
    micButton?.click();
    expect(onAbort).not.toHaveBeenCalled();

    const stopButton = container.querySelector<HTMLButtonElement>(".chat-compose__send-btn--stop");
    expect(stopButton).not.toBeNull();
    expect(stopButton?.getAttribute("aria-label")).toBe(t("chat.stop"));
    stopButton?.click();
    expect(onAbort).toHaveBeenCalledTimes(1);
  });

  it("disables the checkpoint restore action when nothing is restorable", () => {
    const container = document.createElement("div");
    render(
      renderChat(
        createProps({
          messages: [
            { id: "m0", role: "assistant", content: "prelude" },
            { id: "m1", role: "user", content: "hello" },
            { id: "m2", role: "assistant", content: "hi" },
            { id: "m3", role: "user", content: "more" },
          ],
          checkpoints: [
            {
              checkpointId: "cp-1",
              boundaryMessageId: "m0",
              createdAt: "2026-07-07T00:00:00.000Z",
              summary: "s",
              restorable: { files: false, transcript: false },
              externalEffects: { present: false, kinds: [] },
            },
          ],
        }),
      ),
      container,
    );

    const button = container.querySelector<HTMLButtonElement>(".chat-checkpoint__action");
    expect(button).not.toBeNull();
    expect(button?.disabled).toBe(true);
  });

  it("shows the confirm card (with external-effects warning) for the pending checkpoint", () => {
    const container = document.createElement("div");
    const onConfirmRestoreCheckpoint = vi.fn();
    render(
      renderChat(
        createProps({
          messages: [
            { id: "m0", role: "assistant", content: "prelude" },
            { id: "m1", role: "user", content: "hello" },
            { id: "m2", role: "assistant", content: "hi" },
            { id: "m3", role: "user", content: "more" },
          ],
          checkpoints: [
            {
              checkpointId: "cp-1",
              boundaryMessageId: "m0",
              createdAt: "2026-07-07T00:00:00.000Z",
              summary: "s",
              restorable: { files: true, transcript: true },
              externalEffects: { present: true, kinds: ["email"] },
            },
          ],
          pendingRestoreCheckpointId: "cp-1",
          onConfirmRestoreCheckpoint,
        }),
      ),
      container,
    );

    expect(container.querySelector(".chat-checkpoint__confirm")).not.toBeNull();
    expect(container.querySelector(".chat-checkpoint__confirm-warning")).not.toBeNull();

    container.querySelector<HTMLButtonElement>(".chat-checkpoint__confirm-commit")?.click();
    expect(onConfirmRestoreCheckpoint).toHaveBeenCalledWith("cp-1");
  });

  it("folds toolUse narration into one reply bubble for run 7fd20883", () => {
    const container = document.createElement("div");
    const narration = "好，那我先打开云电脑浏览器看看有什么待支付的订单。";
    const reply = "浏览器环境已就绪。不过我还需要知道具体买什么。";
    render(
      renderChat(
        createProps({
          messages: [
            {
              role: "assistant",
              stopReason: "toolUse",
              content: [
                { type: "text", text: narration },
                { type: "toolCall", name: "browser", arguments: { action: "status" } },
              ],
            },
            {
              role: "assistant",
              stopReason: "stop",
              content: [{ type: "text", text: reply }],
            },
          ],
        }),
      ),
      container,
    );

    const replyBubbles = Array.from(container.querySelectorAll(".chat-bubble")).filter(
      (bubble) =>
        !bubble.classList.contains("chat-reading-indicator") &&
        !bubble.closest(".chat-tool-progress"),
    );
    expect(replyBubbles).toHaveLength(1);
    expect(replyBubbles[0]?.textContent).toContain("浏览器环境已就绪");
    // Formal reply landed: process channel must leave the main timeline.
    expect(container.querySelector(".chat-tool-progress")).toBeNull();
    expect(replyBubbles[0]?.textContent).not.toContain("好，那我先打开");
  });

  it("shows ▶ 过程 only while tools are still open (no formal reply yet)", () => {
    const container = document.createElement("div");
    const narration = "好，那我先打开云电脑浏览器看看有什么待支付的订单。";
    render(
      renderChat(
        createProps({
          messages: [
            {
              role: "assistant",
              stopReason: "toolUse",
              content: [
                { type: "text", text: narration },
                { type: "toolCall", name: "browser", arguments: { action: "status" } },
              ],
            },
          ],
        }),
      ),
      container,
    );
    expect(container.querySelector(".chat-tool-progress")?.textContent).toContain("好，那我先打开");
    expect(container.querySelectorAll(".chat-bubble").length).toBe(0);
  });

  it("drops DOM/debug toolUse lines from mid-run process channel", () => {
    const container = document.createElement("div");
    render(
      renderChat(
        createProps({
          messages: [
            {
              role: "assistant",
              stopReason: "toolUse",
              content: [
                { type: "text", text: "正在打开京东搜索页。" },
                { type: "toolCall", name: "browser", arguments: { action: "open" } },
              ],
            },
            {
              role: "assistant",
              stopReason: "toolUse",
              content: [
                { type: "text", text: "搜索结果的 DOM 结构不是标准列表，我改用抓链。" },
                { type: "toolCall", name: "browser", arguments: { action: "snapshot" } },
              ],
            },
          ],
        }),
      ),
      container,
    );
    const progress = container.querySelector(".chat-tool-progress");
    expect(progress?.textContent).toContain("正在打开京东搜索页");
    expect(progress?.textContent).not.toContain("DOM");
    expect(progress?.textContent).not.toContain("抓链");
  });

  it("shows live toolUse narration inside the work-progress card, not a second bubble", () => {
    const container = document.createElement("div");
    const narration = "好，那我先打开云电脑浏览器看看有什么待支付的订单。";
    const reply = "浏览器环境已就绪。不过我还需要知道具体买什么。";
    render(
      renderChat(
        createProps({
          stream: reply,
          streamStartedAt: Date.now(),
          workProgressLabel: "正在验证",
          workProgressNarration: narration,
        }),
      ),
      container,
    );

    const replyBubbles = Array.from(container.querySelectorAll(".chat-bubble")).filter(
      (bubble) => !bubble.classList.contains("chat-reading-indicator"),
    );
    expect(replyBubbles).toHaveLength(1);
    expect(replyBubbles[0]?.textContent).toContain("浏览器环境已就绪");
    const progress = container.querySelector("[data-testid='chat-work-progress-narration']");
    expect(progress?.textContent).toContain("好，那我先打开");
    expect(replyBubbles[0]?.textContent).not.toContain("好，那我先打开");
  });

  it("does not render raw tool cards in the user chat thread by default", () => {
    const container = document.createElement("div");
    render(
      renderChat(
        createProps({
          messages: [
            {
              role: "toolResult",
              content: [{ type: "text", text: "internal tool output" }],
              toolCallId: "tool-1",
            },
          ],
          toolMessages: [
            {
              role: "assistant",
              toolCallId: "tool-2",
              content: [
                { type: "toolcall", name: "exec", arguments: { cmd: "echo hi" } },
                { type: "toolresult", name: "exec", text: "hi" },
              ],
            },
          ],
        }),
      ),
      container,
    );

    expect(container.textContent).not.toContain("internal tool output");
    expect(container.textContent).not.toContain("exec");
    expect(container.querySelector(".chat-tool-card")).toBeNull();
  });

  it("does not occupy chat with ConversationTask progress after the matching user message", () => {
    const container = document.createElement("div");
    render(
      renderChat(
        createProps({
          messages: [
            {
              id: "m-user-goal",
              role: "user",
              content: "分三步完成竞品监控",
              timestamp: Date.now(),
            },
            {
              role: "assistant",
              content: [{ type: "text", text: "好的，我先从第一步开始。" }],
              timestamp: Date.now(),
            },
          ],
          conversationTaskProgressEntries: [
            {
              taskId: "7",
              sourceMessageId: "m-user-goal",
              goal: "分三步完成竞品监控",
              lifecycle: "active",
              progress: {
                projectionKind: "canonical",
                taskId: "ct-7",
                goal: "分三步完成竞品监控",
                headline: "0/1 项验收已满足 · 正在执行",
                focus: "分三步完成竞品监控",
                acceptanceProgress: { met: 0, total: 1 },
                executionProgress: { completed: 0, total: 1, inProgress: 1, remaining: 0 },
                mode: "deliver",
                stale: false,
                lastMeaningfulChangeAtMs: Date.now(),
                lastUpdatedAtMs: Date.now(),
                emitToChat: true,
                emitNotification: false,
                nodes: [],
                taskCompleted: false,
                planVersion: 1,
                replans: [],
              },
            },
          ],
        }),
      ),
      container,
    );

    expect(container.querySelectorAll(".chat-conversation-task-progress")).toHaveLength(0);
    expect(container.textContent).not.toContain("0/1 项验收已满足");
  });

  it("renders one task card per task id and overwrites older task updates", () => {
    const container = document.createElement("div");
    render(
      renderChat(
        createProps({
          messages: [
            {
              type: "task_update",
              task: {
                id: "install-feishu",
                title: "安装依赖并检查飞书",
                step_current: 1,
                step_total: 3,
                step_name: "安装依赖",
                status: "running",
                progress: 20,
                message: "正在安装依赖",
              },
            },
            {
              type: "task_update",
              task: {
                id: "install-feishu",
                title: "安装依赖并检查飞书",
                step_current: 2,
                step_total: 3,
                step_name: "健康检查",
                status: "running",
                progress: 60,
                message: "正在进行健康检查",
              },
            },
          ],
        }),
      ),
      container,
    );

    expect(container.querySelectorAll(".chat-task-card")).toHaveLength(1);
    expect(container.textContent).toContain("步骤 2/3：健康检查");
    expect(container.textContent).toContain("正在进行健康检查");
    expect(container.textContent).not.toContain("步骤 1/3：安装依赖");
  });

  it("renders explicit artifact events as document entry cards", () => {
    const container = document.createElement("div");
    const onOpenSidebar = vi.fn();
    render(
      renderChat(
        createProps({
          onOpenSidebar,
          messages: [
            {
              type: "artifact",
              artifact: {
                id: "report-1",
                artifact_type: "markdown",
                title: "依赖安装报告",
                content: "# 依赖安装报告\n\n安装完成，飞书连接等待验证。\n\n下一步继续健康检查。",
                preview: true,
                context: {
                  task_id: "install-feishu",
                  step_index: 1,
                  step_name: "安装依赖",
                  purpose: "确认安装结果",
                  next_action: "确认并继续",
                },
              },
            },
          ],
        }),
      ),
      container,
    );

    expect(container.querySelector(".chat-artifact-entry")).not.toBeNull();
    expect(container.textContent).toContain("依赖安装报告");
    container.querySelector<HTMLButtonElement>(".chat-artifact-entry .btn")?.click();
    expect(onOpenSidebar).toHaveBeenCalledWith(expect.stringContaining("依赖安装报告"));
  });

  it("normalizes explicit ppt artifacts into slide previews for the sidebar", () => {
    const event = {
      type: "artifact",
      artifact: {
        id: "ppt-1",
        artifact_type: "ppt",
        title: "技能孵化方案",
        preview: true,
        content: JSON.stringify({
          pptxPath: "/tmp/skill-incubation.pptx",
          slidePreviews: [
            {
              slideNumber: 1,
              title: "封面",
              imageUrl: "data:image/png;base64,AAA",
              alt: "封面",
            },
          ],
        }),
        context: {
          task_id: "skill-incubation",
          step_index: 2,
          step_name: "生成 PPT",
          purpose: "预览技能孵化结果",
          next_action: "确认或修改",
        },
      },
    };
    const artifact = resolvePreviewArtifactRecord(event);
    expect(artifact).toMatchObject({
      artifactId: "ppt-1",
      artifactType: "slide",
      title: "技能孵化方案",
    });

    const container = document.createElement("div");
    render(
      renderArtifactSidebar({
        workspace: {
          artifact: {
            artifactId: String(artifact?.artifactId),
            artifactType: "slide",
            storageClass: "inline-media",
            title: String(artifact?.title),
            provider: "artifact-event",
            createdBy: { type: "bot", id: "skill-incubator" },
            createdAt: "2026-04-30T00:00:00.000Z",
            updatedAt: "2026-04-30T00:00:00.000Z",
            lifecycleState: "created",
            providerMetadata: artifact?.providerMetadata as Record<string, unknown>,
          },
          versions: [],
          deliveries: [],
          grants: [],
          intents: [],
        },
      }),
      container,
    );

    expect(container.querySelector(".ppt-preview")).not.toBeNull();
    expect(container.querySelector<HTMLImageElement>(".ppt-preview__slide img")?.src).toContain(
      "data:image/png;base64,AAA",
    );
    expect(container.textContent).toContain("1. 封面");
  });

  it("does not render the preview-bottom incubation / organize-as-draft strip", () => {
    const container = document.createElement("div");
    const onOpenSkillSaveFromPreview = vi.fn();
    render(
      renderArtifactSidebar({
        workspace: {
          artifact: {
            artifactId: "doc-1",
            artifactType: "doc",
            storageClass: "inline-media",
            title: "协作方案",
            provider: "artifact-event",
            createdBy: { type: "bot", id: "agent-1" },
            createdAt: "2026-04-30T00:00:00.000Z",
            updatedAt: "2026-04-30T00:00:00.000Z",
            lifecycleState: "created",
            providerMetadata: {
              previewText: "# 协作方案\n\n正文",
            },
          },
          versions: [],
          deliveries: [],
          grants: [],
          intents: [],
        },
        showSystemAssetIncubationHint: true,
        showWeakAssetIncubationHint: true,
        assetIncubationLevel: "L3",
        assetIncubationReason: "重复出现 3 次，建议整理为能力草稿",
        onOpenSkillSaveFromPreview,
      }),
      container,
    );

    expect(container.querySelector(".artifact-preview-incubation-hint")).toBeNull();
    expect(container.textContent).not.toContain(t("chat.artifactIncubationSuggestTitle"));
    expect(container.textContent).not.toContain(t("chat.artifactIncubationOrganizeDraft"));
    expect(container.textContent).not.toContain("重复出现 3 次，建议整理为能力草稿");
    expect(onOpenSkillSaveFromPreview).not.toHaveBeenCalled();
  });

  it("turns write tool calls with document content into previewable artifacts", () => {
    const body = [
      "# 公众号文章编辑与发布 — 企业资产包",
      "",
      "## 1. 业务场景",
      "",
      "将 AI 辅助创作的公众号文章完成从内容生产到微信草稿箱发布的全流程。",
      "",
      "## 2. 输入物",
      "",
      "| 输入 | 类型 |",
      "|------|------|",
      "| 正文 | Markdown |",
      "",
      "## 3. 输出物",
      "",
      "草稿 media_id、封面 media_id、配图 URL 列表。",
    ].join("\n");

    const artifact = resolvePreviewArtifactRecord({
      role: "assistant",
      timestamp: "2026-05-27T11:14:01.824Z",
      content: [
        { type: "text", text: "开始写入成果文件。" },
        {
          type: "toolCall",
          name: "write",
          arguments: {
            path: "/Users/daniel/AI项目/openbot/skills/wechat-article/ASSET.md",
            content: body,
          },
        },
      ],
    });

    expect(artifact).toMatchObject({
      artifactType: "doc",
      title: "ASSET.md",
      provider: "tool-write",
      providerResourceId: "/Users/daniel/AI项目/openbot/skills/wechat-article/ASSET.md",
      sourceMessage: body,
    });
  });

  it("extracts complete file text instead of missing long markdown with nested fences", () => {
    const body = [
      "# 公众号文章编辑与发布 — 企业资产包",
      "",
      "## 4. 固定流程",
      "",
      "```",
      "Step 1: 生成封面",
      "Step 2: 上传素材",
      "```",
      "",
      "## 5. 依赖",
      "",
      "| 脚本 | 路径 |",
      "|------|------|",
      "| publish_agi_axios.js | scripts/ |",
    ].join("\n");
    const artifact = resolvePreviewArtifactRecord({
      role: "assistant",
      content: [
        {
          type: "text",
          text: `以下是完整的 \`ASSET.md\` 内容（345 行）：\n\n---\n\n\`\`\`\n${body}\n\n---\n\n以上就是完整的 345 行 ASSET.md 内容。`,
        },
      ],
    });

    expect(artifact).toMatchObject({
      title: "ASSET.md",
      mimeType: "text/markdown",
      sourceMessage: body,
    });
  });

  it("does not treat file mismatch explanations as the latest artifact", () => {
    const artifact = resolvePreviewArtifactRecord({
      role: "assistant",
      content: [
        {
          type: "text",
          text: [
            "明白了！您实际看到的是**附件文件**的内容，而不是真正的 `ASSET.md`。",
            "",
            "```",
            "### 十要素结构",
            "| # | 要素 | 核心内容 |",
            "### 核心经验已固化为规则",
            "```",
            "",
            "这说明系统显示错了版本。",
          ].join("\n"),
        },
      ],
    });

    expect(artifact).toBeNull();
  });

  it("does not render tool-only assistant messages even when tool cards are enabled", () => {
    const container = document.createElement("div");
    render(
      renderChat(
        createProps({
          showToolCards: true,
          messages: [
            {
              role: "assistant",
              toolCallId: "tool-1",
              content: [
                { type: "toolcall", name: "exec", arguments: { cmd: "pnpm install" } },
                { type: "toolresult", name: "exec", text: '{"ok":true}' },
              ],
            },
          ],
        }),
      ),
      container,
    );

    expect(container.querySelector(".chat-tool-card")).toBeNull();
    expect(container.textContent).not.toContain("pnpm install");
    expect(container.textContent).not.toContain('{"ok":true}');
  });

  it("renders completion indicator shortly after compaction", () => {
    const container = document.createElement("div");
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_000);
    render(
      renderChat(
        createProps({
          compactionStatus: {
            active: false,
            startedAt: 900,
            completedAt: 900,
          },
        }),
      ),
      container,
    );

    const indicator = container.querySelector(".compaction-indicator--complete");
    expect(indicator).not.toBeNull();
    expect(indicator?.textContent).toContain("Context compacted");
    nowSpy.mockRestore();
  });

  it("hides stale compaction completion indicator", () => {
    const container = document.createElement("div");
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(10_000);
    render(
      renderChat(
        createProps({
          compactionStatus: {
            active: false,
            startedAt: 0,
            completedAt: 0,
          },
        }),
      ),
      container,
    );

    expect(container.querySelector(".compaction-indicator")).toBeNull();
    nowSpy.mockRestore();
  });

  it("renders fallback indicator shortly after fallback event", () => {
    const container = document.createElement("div");
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_000);
    render(
      renderChat(
        createProps({
          fallbackStatus: {
            selected: "fireworks/minimax-m2p5",
            active: "deepinfra/moonshotai/Kimi-K2.5",
            attempts: ["fireworks/minimax-m2p5: rate limit"],
            occurredAt: 900,
          },
        }),
      ),
      container,
    );

    const indicator = container.querySelector(".compaction-indicator--fallback");
    expect(indicator).not.toBeNull();
    expect(indicator?.textContent).toContain("Fallback active: deepinfra/moonshotai/Kimi-K2.5");
    expect(indicator?.getAttribute("title")).toContain("Selected: fireworks/minimax-m2p5");
    nowSpy.mockRestore();
  });

  it("hides stale fallback indicator", () => {
    const container = document.createElement("div");
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(20_000);
    render(
      renderChat(
        createProps({
          fallbackStatus: {
            selected: "fireworks/minimax-m2p5",
            active: "deepinfra/moonshotai/Kimi-K2.5",
            attempts: [],
            occurredAt: 0,
          },
        }),
      ),
      container,
    );

    expect(container.querySelector(".compaction-indicator--fallback")).toBeNull();
    nowSpy.mockRestore();
  });

  it("renders fallback-cleared indicator shortly after transition", () => {
    const container = document.createElement("div");
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_000);
    render(
      renderChat(
        createProps({
          fallbackStatus: {
            phase: "cleared",
            selected: "fireworks/minimax-m2p5",
            active: "fireworks/minimax-m2p5",
            previous: "deepinfra/moonshotai/Kimi-K2.5",
            attempts: [],
            occurredAt: 900,
          },
        }),
      ),
      container,
    );

    const indicator = container.querySelector(".compaction-indicator--fallback-cleared");
    expect(indicator).not.toBeNull();
    expect(indicator?.textContent).toContain("Fallback cleared: fireworks/minimax-m2p5");
    expect(indicator?.getAttribute("title")).toContain(
      "Previous fallback: deepinfra/moonshotai/Kimi-K2.5",
    );
    nowSpy.mockRestore();
  });

  it("shows a stop button when aborting is available", () => {
    const container = document.createElement("div");
    const onAbort = vi.fn();
    render(
      renderChat(
        createProps({
          canAbort: true,
          onAbort,
        }),
      ),
      container,
    );

    const stopButton = Array.from(container.querySelectorAll("button")).find(
      (btn) => btn.textContent?.trim() === t("chat.stop"),
    );
    expect(stopButton).not.toBeUndefined();
    stopButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onAbort).toHaveBeenCalledTimes(1);
    expect(container.textContent).not.toContain(t("chat.newSession"));
  });

  it("shows a new session button when aborting is unavailable", () => {
    const container = document.createElement("div");
    const onNewSession = vi.fn();
    render(
      renderChat(
        createProps({
          canAbort: false,
          onNewSession,
        }),
      ),
      container,
    );

    const newSessionButton = Array.from(container.querySelectorAll("button")).find(
      (btn) => btn.textContent?.trim() === t("chat.newSession"),
    );
    expect(newSessionButton).not.toBeUndefined();
    newSessionButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onNewSession).toHaveBeenCalledTimes(1);
    expect(container.textContent).not.toContain(t("chat.stop"));
  });

  it("renders artifact actions for projected shared artifacts", () => {
    const container = document.createElement("div");
    const onOpenArtifact = vi.fn();
    const onRequestArtifactEditAccess = vi.fn();
    render(
      renderChat(
        createProps({
          onOpenArtifact,
          onRequestArtifactEditAccess,
          messages: [
            {
              role: "assistant",
              content: [{ type: "text", text: "Shared artifact: Handoff Spec (v2)" }],
              timestamp: 100,
              artifact: {
                artifactId: "artifact:handoff",
                title: "Handoff Spec",
                versionLabel: "v2",
              },
            },
          ],
        }),
      ),
      container,
    );

    const artifactButton = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent?.includes(t("chat.openArtifact")),
    );
    expect(artifactButton).toBeDefined();
    artifactButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onOpenArtifact).toHaveBeenCalledWith("artifact:handoff");
    expect(
      container.querySelector(".chat-bubble--artifact-output .chat-msg-actions .chat-copy-btn"),
    ).not.toBeNull();

    const requestButton = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent?.includes(t("chat.requestArtifactEditAccess")),
    );
    expect(requestButton).toBeDefined();
    requestButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onRequestArtifactEditAccess).toHaveBeenCalledWith("artifact:handoff");
  });

  it("does not render artifact chrome for regular assistant replies without result artifacts", () => {
    const container = document.createElement("div");
    render(
      renderChat(
        createProps({
          messages: [
            {
              role: "assistant",
              content: [
                {
                  type: "text",
                  text: [
                    "老大，我来再次核实一下，这次扩大范围搜索：",
                    "",
                    "我这边能确认的是当前 workspace 里没有这个文件。",
                    "",
                    "如果你觉得文件应该在，告诉我它可能在哪里创建的，我帮你再查一次。",
                  ].join("\n"),
                },
              ],
              timestamp: 1,
            },
          ],
        }),
      ),
      container,
    );

    expect(container.querySelector(".chat-bubble--artifact-output")).toBeNull();
    expect(container.textContent).not.toContain(t("chat.openArtifact"));
  });

  it("revalidates stale assistant-message preview artifacts and hides delivery summaries", () => {
    const container = document.createElement("div");
    render(
      renderChat(
        createProps({
          messages: [
            {
              role: "assistant",
              content: [
                {
                  type: "text",
                  text: [
                    "配图生成完毕！以下是完整交付物：",
                    "",
                    "✅ 任务完成总结",
                    "",
                    "公众号文章标题：《小米AGI狂飙：罗福莉的两年赌约，胜算几何？》",
                    "",
                    "去草稿箱看看效果吧 👀",
                  ].join("\n"),
                },
              ],
              timestamp: 2,
              artifact: {
                artifactId: "assistant-doc:stale",
                title: "旧误判预览",
                provider: "assistant-message",
              },
            },
          ],
        }),
      ),
      container,
    );

    expect(container.querySelector(".chat-bubble--artifact-output")).toBeNull();
    expect(container.textContent).not.toContain(t("chat.openArtifact"));
  });

  it("does not promote inferred chat articles into 打开成果", () => {
    const container = document.createElement("div");
    const onOpenArtifact = vi.fn();
    render(
      renderChat(
        createProps({
          onOpenArtifact,
          messages: [
            {
              role: "assistant",
              content: [
                {
                  type: "text",
                  text: [
                    "---",
                    "",
                    "以下是完整正文：",
                    "",
                    "---",
                    "",
                    "小米AGI狂飙：罗福莉的两年赌约，胜算几何？",
                    "",
                    "“我正在 Xiaomi MiMo，和一群富有创造力、才华横溢且真诚热爱研究的研究员，致力于构建这样的未来，全力奔赴我们心目中的 AGI。”",
                    "",
                    "这是罗福莉加入小米后发布的一条动态。",
                    "",
                    "2026年3月19日凌晨，小米没有任何预热，悄然发布三款自研大模型——MiMo-V2-Pro、MiMo-V2-Omni、MiMo-V2-TTS，同期宣布 MiMo-V2-Flash 正式开源。",
                    "",
                    "一个月后，“小米两年AGI”成为科技圈最热的话题之一。",
                    "",
                    "在 OpenAI 还在谨慎推进 GPT-5、Google DeepMind 强调“安全优先”的氛围下，小米凭什么敢喊出“两年”？这个豪言背后，是真正的技术自信，还是“人车家全生态”战略下的营销叙事？",
                    "",
                    "今天，我们把这件事说清楚。",
                    "",
                    "一、小米的 AGI 底牌：MiMo-V2 到底什么水平？",
                    "",
                    "先说技术。小米这次并不是只丢出一个大模型名字，而是把推理、语音、端侧与开源节奏一起推到台前。",
                  ].join("\n"),
                },
              ],
              timestamp: 1,
            },
          ],
        }),
      ),
      container,
    );

    expect(container.querySelector(".chat-bubble--artifact-output")).toBeNull();
    expect(container.textContent).not.toContain(t("chat.openArtifact"));
    expect(onOpenArtifact).not.toHaveBeenCalled();
  });

  it("does not treat a planning sentence that mentions SKILL.md as 打开成果", () => {
    const container = document.createElement("div");
    const onOpenArtifact = vi.fn();
    render(
      renderChat(
        createProps({
          onOpenArtifact,
          messages: [
            {
              role: "assistant",
              content: [
                {
                  type: "text",
                  text: [
                    "五、我现在就能替你做的两件事",
                    "",
                    "1. 写一份公众号主编技能包：把选题、撰写、排版、配图固化成一份可复用的 SKILL.md。",
                    "2. 配一份选题策划模板，数字人按模板撰写、你来审。",
                    "",
                    "要不要我现在就开始写这份技能？如果要，请顺便告诉我承接的数字人是谁。",
                  ].join("\n"),
                },
              ],
              timestamp: 1,
            },
          ],
        }),
      ),
      container,
    );

    expect(container.querySelector(".chat-bubble--artifact-output")).toBeNull();
    expect(container.textContent).not.toContain(t("chat.openArtifact"));
    expect(onOpenArtifact).not.toHaveBeenCalled();
  });

  it("keeps 「打开成果」 when tags were stripped but declared artifact was materialized", () => {
    const container = document.createElement("div");
    const onOpenArtifact = vi.fn();
    render(
      renderChat(
        createProps({
          onOpenArtifact,
          messages: [
            {
              role: "assistant",
              content: [
                {
                  type: "text",
                  text: "旁白：SOP 已落盘。\n- 个人邮箱流程",
                },
              ],
              timestamp: 1,
              artifact: {
                artifactId: "assistant-doc:email-sop",
                title: "邮件发送 SOP",
                provider: "assistant-message",
                providerMetadata: {
                  declared: true,
                  deliverableEnvelope: true,
                  previewKind: "file",
                  workspaceFilename: "email-sending-sop.md",
                },
              },
            },
          ],
        }),
      ),
      container,
    );

    expect(container.textContent).toContain(t("chat.openArtifact"));
    expect(container.textContent).toContain("email-sending-sop.md");
    expect(container.textContent).not.toContain("<<DELIVERABLE");
    const artifactButton = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent?.includes(t("chat.openArtifact")),
    );
    expect(artifactButton).toBeDefined();
    artifactButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onOpenArtifact).toHaveBeenCalledWith("assistant-doc:email-sop");
  });

  it("renders one 打开成果 button per located deliverable file", () => {
    const container = document.createElement("div");
    const onOpenArtifact = vi.fn();
    render(
      renderChat(
        createProps({
          onOpenArtifact,
          messages: [
            {
              role: "assistant",
              content: [
                {
                  type: "text",
                  text: [
                    "两份成果都在工作区。",
                    '<<DELIVERABLE title="投资介绍 PDF" file="OpenBot_高质量投资介绍.pdf">>',
                    "PDF 版。",
                    "<</DELIVERABLE>>",
                    '<<DELIVERABLE title="投资介绍网页" file="OpenBot_高质量投资介绍.html">>',
                    "HTML 版。",
                    "<</DELIVERABLE>>",
                  ].join("\n"),
                },
              ],
              timestamp: 1,
            },
          ],
        }),
      ),
      container,
    );

    const artifactButtons = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).filter((button) => button.textContent?.includes(t("chat.openArtifact")));
    expect(artifactButtons).toHaveLength(2);
    expect(container.textContent).toContain("OpenBot_高质量投资介绍.pdf");
    expect(container.textContent).toContain("OpenBot_高质量投资介绍.html");
    artifactButtons[0]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    artifactButtons[1]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onOpenArtifact).toHaveBeenCalledTimes(2);
    expect(onOpenArtifact.mock.calls[0]?.[0]).not.toBe(onOpenArtifact.mock.calls[1]?.[0]);
  });

  it("keeps the analysis body and shows 文件暂未交付 when registration failed", () => {
    const container = document.createElement("div");
    const onOpenArtifact = vi.fn();
    render(
      renderChat(
        createProps({
          onOpenArtifact,
          messages: [
            {
              role: "assistant",
              content: [
                {
                  type: "text",
                  text: [
                    "三张表的字段与口径草案已写入工作区。",
                    '<<DELIVERABLE title="底稿" file="analysis/model.md" settle="retryable">>',
                    "正文仍然可以阅读。",
                    "<</DELIVERABLE>>",
                  ].join("\n"),
                },
              ],
              deliverablePublish: {
                presentation: "pending_recovery",
                verification: "pass",
                registration: "failed",
                failureReason: "manifest_write_failed",
                reasonLabel: "登记失败，可重试",
                relativePath: "analysis/model.md",
                versionChecksum: "abc",
                idempotencyKey: "k",
                settleStatus: "retryable",
              },
              timestamp: 1,
            },
          ],
        }),
      ),
      container,
    );

    expect(container.textContent).toContain("三张表的字段与口径草案已写入工作区。");
    expect(container.textContent).toContain("正文仍然可以阅读。");
    expect(container.textContent).toContain(t("chat.deliverablePendingRecovery"));
    expect(container.textContent).toContain("登记失败，可重试");
    expect(container.textContent).not.toContain(t("chat.openArtifact"));
    expect(container.querySelector('[data-testid="artifact-delivery-undelivered"]')).toBeTruthy();
    expect(onOpenArtifact).not.toHaveBeenCalled();
  });

  it("opens a persisted deliverable from the real 打开成果 control", () => {
    const container = document.createElement("div");
    const onOpenArtifact = vi.fn();
    render(
      renderChat(
        createProps({
          onOpenArtifact,
          messages: [
            {
              role: "assistant",
              content: [
                {
                  type: "text",
                  text: [
                    "报告正文在上面。",
                    '<<DELIVERABLE title="讲座报告" file="讲座报告.pdf" settle="confirmed">>',
                    "PDF 已落在工作区。",
                    "<</DELIVERABLE>>",
                  ].join("\n"),
                },
              ],
              deliverablePublish: {
                presentation: "delivered",
                verification: "pass",
                registration: "registered",
                failureReason: null,
                reasonLabel: null,
                relativePath: "讲座报告.pdf",
                versionChecksum: "abc",
                idempotencyKey: "k",
                settleStatus: "confirmed",
              },
              timestamp: 1,
            },
          ],
        }),
      ),
      container,
    );

    const open = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes(t("chat.openArtifact")),
    );
    expect(open).toBeTruthy();
    open?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onOpenArtifact).toHaveBeenCalledTimes(1);
  });

  it("does not open inferred file mentions as 打开成果 when clicking a generated file link", () => {
    const container = document.createElement("div");
    const onOpenArtifact = vi.fn();
    const body = [
      "## 模块内容概览",
      "",
      "| 章节 | 内容 |",
      "| --- | --- |",
      "| 二、优势分析（S） | 政策支持、一带一路区位、特色产业集聚、用电成本、人力成本等11项优势 |",
      "",
      "## 二、优势分析（S）",
      "",
      "银川数贸平台具备政策承接、产业集聚和区域协同的复合优势。".repeat(8),
    ].join("\n");
    render(
      renderChat(
        createProps({
          onOpenArtifact,
          messages: [
            {
              role: "assistant",
              content: [
                {
                  type: "text",
                  text: [
                    "完成啦！文件保存在：",
                    "",
                    "[银川数贸平台_SWOT分析模块.md](#)",
                    "",
                    "---",
                    "",
                    body,
                  ].join("\n"),
                },
              ],
              timestamp: 1,
            },
          ],
        }),
      ),
      container,
    );

    expect(container.querySelector(".chat-bubble--artifact-output")).toBeNull();
    expect(container.textContent).not.toContain(t("chat.openArtifact"));
    const fileLink = Array.from(container.querySelectorAll<HTMLAnchorElement>("a")).find((link) =>
      link.textContent?.includes("银川数贸平台_SWOT分析模块.md"),
    );
    fileLink?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(onOpenArtifact).not.toHaveBeenCalled();
  });

  it("renders the artifact workspace in the open sidebar", () => {
    const container = document.createElement("div");
    const onRequestEditAccess = vi.fn();
    const onGrantTargetAccess = vi.fn();
    const onCreateVersion = vi.fn();
    render(
      renderChat(
        createProps({
          sidebarOpen: true,
          sidebarContent: null,
          onCloseSidebar: () => undefined,
          artifactWorkspace: createArtifactWorkspace(),
          collaborationTargets: [
            {
              sessionKey: "review",
              label: "Reviewer",
              sublabel: "bot-reviewer",
            },
          ],
          onRequestArtifactEditAccess: onRequestEditAccess,
          onGrantArtifactToTarget: onGrantTargetAccess,
          onCreateArtifactVersion: onCreateVersion,
        }),
      ),
      container,
    );

    expect(container.querySelector(".sidebar-title")?.textContent?.trim()).toBe("Handoff Spec");
    expect(container.textContent).not.toContain(t("markdownSidebar.title"));
    expect(container.textContent).toContain(t("chat.editArtifact"));
    expect(container.textContent).not.toContain(t("chat.artifactEditLabel"));
    expect(container.querySelector(".artifact-edit")).toBeNull();
    const compose = container.querySelector(".chat-compose");
    expect(compose).not.toBeNull();
    expect(container.querySelector(".chat-main")?.contains(compose)).toBe(true);
    expect(container.querySelector(".chat-sidebar")?.contains(compose)).toBe(false);

    const headerEditButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>(
        ".sidebar-header__actions .artifact-preview-action",
      ),
    ).find((button) => button.textContent?.includes(t("chat.editArtifact")));
    headerEditButton?.click();

    const previewText = container.querySelector<HTMLElement>(".artifact-preview-text");
    expect(previewText?.dataset.editing).toBe("1");
  });

  it("shares preview artifacts to collaboration targets from the sidebar", async () => {
    const container = document.createElement("div");
    const onGrantTargetAccess = vi.fn().mockResolvedValue(undefined);
    render(
      renderChat(
        createProps({
          sidebarOpen: true,
          sidebarContent: null,
          onCloseSidebar: () => undefined,
          artifactWorkspace: createArtifactWorkspace(),
          collaborationTargets: [
            {
              sessionKey: "space:upbeyond",
              label: "upbeyond",
              sublabel: "协作小组",
              current: true,
            },
            {
              sessionKey: "member:market",
              label: "市场助手",
              sublabel: "Market Assistant",
            },
          ],
          onGrantArtifactToTarget: onGrantTargetAccess,
        }),
      ),
      container,
    );

    const shareSummary = Array.from(container.querySelectorAll<HTMLElement>("summary")).find(
      (entry) => entry.textContent?.includes(t("chat.shareArtifact")),
    );
    expect(shareSummary).toBeDefined();
    const targetButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>(".artifact-share-menu__item"),
    ).find((button) => button.textContent?.includes("市场助手"));
    expect(targetButton).toBeDefined();
    targetButton?.click();
    await Promise.resolve();

    expect(onGrantTargetAccess).toHaveBeenCalledWith("artifact:handoff", "member:market");
  });

  it("shows smart edit action when an artifact has no external edit url", () => {
    const container = document.createElement("div");
    const workspace = createArtifactWorkspace();
    workspace.artifact = {
      ...workspace.artifact,
      editUrl: undefined,
    };

    render(
      renderChat(
        createProps({
          sidebarOpen: true,
          sidebarContent: null,
          onCloseSidebar: () => undefined,
          artifactWorkspace: workspace,
        }),
      ),
      container,
    );

    const editButton = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent?.includes(t("chat.editArtifact")),
    );
    expect(editButton).toBeDefined();
    editButton?.click();

    const previewText = container.querySelector<HTMLElement>(".artifact-preview-text");
    expect(previewText?.dataset.editing).toBe("1");
    expect(container.querySelector(".artifact-edit")).toBeNull();
  });

  it("renders the file preview shell for empty artifact previews", () => {
    const container = document.createElement("div");
    render(
      renderChat(
        createProps({
          sidebarOpen: true,
          sidebarPreviewMode: "artifact",
          sidebarContent: null,
          onCloseSidebar: () => undefined,
          artifactWorkspace: null,
        }),
      ),
      container,
    );

    expect(container.querySelector(".sidebar-title")?.textContent?.trim()).toBe(
      t("chat.artifactPreviewTitle"),
    );
    expect(container.textContent).not.toContain(t("markdownSidebar.title"));
    expect(container.textContent).toContain(t("chat.artifactPreviewEmpty"));
    expect(container.querySelector(".artifact-preview-primary--empty")).not.toBeNull();
    expect(container.querySelector(".artifact-edit__input")).toBeNull();
    expect(container.textContent).not.toContain(t("chat.artifactGenerateSend"));
  });

  it("renders markdown sidebar content when the sidebar is open", () => {
    const container = document.createElement("div");
    const onCloseSidebar = vi.fn();
    render(
      renderChat(
        createProps({
          sidebarOpen: true,
          sidebarContent: "## Notes\n\nReview the rollout plan.",
          onCloseSidebar,
        }),
      ),
      container,
    );

    expect(container.querySelector(".chat-sidebar")).not.toBeNull();
    expect(container.textContent).toContain("Review the rollout plan.");

    const closeButton = container.querySelector<HTMLButtonElement>(".sidebar-header .btn");
    closeButton?.click();
    expect(onCloseSidebar).toHaveBeenCalledTimes(1);
  });

  it("renders attachment previews and removes them", () => {
    const container = document.createElement("div");
    const attachment: ChatAttachment = {
      id: "att-1",
      dataUrl: "data:image/png;base64,QQ==",
      mimeType: "image/png",
      fileName: "preview.png",
    };
    const onAttachmentsChange = vi.fn();
    render(
      renderChat(
        createProps({
          attachments: [attachment],
          onAttachmentsChange,
        }),
      ),
      container,
    );

    expect(container.querySelectorAll(".chat-attachment")).toHaveLength(1);

    const removeButton = container.querySelector<HTMLButtonElement>(".chat-attachment__remove");
    removeButton?.click();
    expect(onAttachmentsChange).toHaveBeenCalledWith([]);
  });

  it("shows an unsupported-image hint when the current model lacks vision", () => {
    const container = document.createElement("div");
    const attachment: ChatAttachment = {
      id: "att-1",
      dataUrl: "data:image/png;base64,QQ==",
      mimeType: "image/png",
      fileName: "preview.png",
    };
    render(
      renderChat(
        createProps({
          attachments: [attachment],
          imageInputSupported: false,
          onAttachmentsChange: vi.fn(),
        }),
      ),
      container,
    );

    expect(container.querySelector(".chat-attachments__hint")).not.toBeNull();
    expect(container.textContent).toMatch(/does not support image input|不支持图片输入/);
  });

  it("renders compact attachment capsules inline with the context tabs and keeps file picker formats open", () => {
    const container = document.createElement("div");
    const attachment: ChatAttachment = {
      id: "att-1",
      dataUrl: "data:application/pdf;base64,QQ==",
      mimeType: "application/pdf",
      fileName: "report.pdf",
      status: "ready",
      progress: 100,
    };

    render(
      renderChat(
        createProps({
          renderMode: "workbench-compact",
          attachments: [attachment],
          onAttachmentsChange: vi.fn(),
        }),
      ),
      container,
    );

    // Compact mode uses a horizontal capsule inside the context-tabs row rather
    // than the boxy preview card that overlapped the content preview.
    expect(container.querySelector(".chat-attachment--file")).toBeNull();
    const chip = container.querySelector(".chat-compose__attachment-chip");
    expect(chip).not.toBeNull();
    expect(chip?.closest(".chat-compose__context-tabs")).not.toBeNull();
    expect(chip?.classList.contains("chat-compose__attachment-chip--success")).toBe(true);
    expect(container.textContent).toContain("report.pdf");
    // Ready attachments carry no status text; sending is the composer's concern.
    expect(chip?.querySelector(".chat-compose__attachment-chip-status")).toBeNull();
    expect(chip?.textContent).not.toContain("待发送");
    expect(chip?.getAttribute("title")).toBe("report.pdf");
    const input = container.querySelector<HTMLInputElement>(".chat-compose__file-input");
    expect(input?.accept).toContain("application/pdf");
    expect(input?.accept).toContain(".docx");
  });

  it("renders the attachment capsule inline with the knowledge capsule when the context picker is present", () => {
    const container = document.createElement("div");
    const attachment: ChatAttachment = {
      id: "att-1",
      dataUrl: "data:application/pdf;base64,QQ==",
      mimeType: "application/pdf",
      fileName: "report.pdf",
      status: "ready",
      progress: 100,
    };

    render(
      renderChat(
        createProps({
          renderMode: "workbench-compact",
          attachments: [attachment],
          onAttachmentsChange: vi.fn(),
          onContextScopeChange: () => undefined,
        }),
      ),
      container,
    );

    const tabs = container.querySelector(".chat-compose__context-tabs");
    expect(tabs).not.toBeNull();
    // Capsule shares the exact row that holds the knowledge capsule button.
    expect(tabs?.querySelector(".chat-compose__context-tab")).not.toBeNull();
    expect(tabs?.querySelector(".chat-compose__attachment-chip")).not.toBeNull();
    // No standalone fallback row is produced when the picker is present.
    expect(container.querySelector(".chat-compose__context-tabs--standalone")).toBeNull();
    expect(container.querySelector(".chat-attachment--file")).toBeNull();
  });

  it("lets the user delete a failed attachment capsule and bulk-clear failures", () => {
    const container = document.createElement("div");
    const onAttachmentsChange = vi.fn();
    const attachments: ChatAttachment[] = [
      {
        id: "ok",
        dataUrl: "data:application/pdf;base64,QQ==",
        mimeType: "application/pdf",
        fileName: "ok.pdf",
        status: "ready",
      },
      {
        id: "bad-1",
        dataUrl: "",
        mimeType: "application/pdf",
        fileName: "bad-1.pdf",
        status: "failed",
      },
      {
        id: "bad-2",
        dataUrl: "",
        mimeType: "application/pdf",
        fileName: "bad-2.pdf",
        status: "failed",
      },
    ];
    render(
      renderChat(
        createProps({
          renderMode: "workbench-compact",
          attachments,
          onAttachmentsChange,
        }),
      ),
      container,
    );

    const list = container.querySelector(".chat-compose__attachment-chips");
    expect(list?.getAttribute("role")).toBe("list");
    expect(list?.querySelectorAll(".chat-compose__attachment-chip")).toHaveLength(3);

    const failedChip = container.querySelector(".chat-compose__attachment-chip--failed");
    expect(failedChip?.querySelector(".chat-compose__attachment-chip-status")?.textContent).toBe(
      "失败",
    );
    const remove = failedChip?.querySelector<HTMLButtonElement>(
      ".chat-compose__attachment-chip-remove",
    );
    expect(remove?.getAttribute("aria-label")).toContain("bad-1.pdf");
    remove?.click();
    expect(onAttachmentsChange).toHaveBeenLastCalledWith([attachments[0], attachments[2]]);

    container.querySelector<HTMLButtonElement>(".chat-compose__attachment-clear-failed")?.click();
    expect(onAttachmentsChange).toHaveBeenLastCalledWith([attachments[0]]);
  });

  it("keeps long attachment notices out of the capsule and in the tooltip", () => {
    const container = document.createElement("div");
    const notice = "本地已缓存“report.pdf”，已引用该副本准备发送（仍需点发送才会交给机器人）。";
    render(
      renderChat(
        createProps({
          renderMode: "workbench-compact",
          attachments: [
            {
              id: "att-1",
              dataUrl: "data:application/pdf;base64,QQ==",
              mimeType: "application/pdf",
              fileName: "report.pdf",
              status: "ready",
              notice,
            },
          ],
          onAttachmentsChange: vi.fn(),
        }),
      ),
      container,
    );

    const chip = container.querySelector<HTMLElement>(".chat-compose__attachment-chip");
    expect(chip?.textContent).not.toContain("本地已缓存");
    expect(chip?.querySelector(".chat-compose__attachment-chip-status")).toBeNull();
    expect(chip?.title).toContain(notice);
  });

  it("shows a restore action for paste-originated attachments", () => {
    const container = document.createElement("div");
    const encoded = btoa(unescape(encodeURIComponent("很长的粘贴正文")));
    const onDraftChange = vi.fn();
    const onAttachmentsChange = vi.fn();
    render(
      renderChat(
        createProps({
          draft: "请看这个",
          attachments: [
            {
              id: "paste-1",
              dataUrl: `data:text/plain;base64,${encoded}`,
              mimeType: "text/plain",
              fileName: "粘贴内容-20260915.txt",
              status: "ready",
              source: "paste",
              notice: "已转为附件（501 字）",
            },
          ],
          onDraftChange,
          onAttachmentsChange,
        }),
      ),
      container,
    );

    const restore = container.querySelector<HTMLButtonElement>(".chat-paste-fold__expand");
    expect(container.querySelector(".chat-attachment--file")).toBeNull();
    expect(container.querySelector(".chat-paste-fold__preview")?.textContent).toBe(
      "很长的粘贴正文",
    );
    expect(restore?.textContent).toContain("Show in text box");
    restore?.click();
    expect(onDraftChange).toHaveBeenCalledWith("请看这个\n\n很长的粘贴正文");
    expect(onAttachmentsChange).toHaveBeenCalledWith([]);
  });

  it("renders a composer quote chip that can be dismissed", () => {
    const container = document.createElement("div");
    const onQuoteDraftChange = vi.fn();
    render(
      renderChat(
        createProps({
          quoteDraft: { messageId: "msg-1", excerpt: "先改邀请门槛" },
          onQuoteDraftChange,
        }),
      ),
      container,
    );
    expect(container.querySelector(".chat-quote-chip")).not.toBeNull();
    expect(container.textContent).toContain("先改邀请门槛");
    container.querySelector<HTMLButtonElement>(".chat-quote-chip__clear")?.click();
    expect(onQuoteDraftChange).toHaveBeenCalledWith(null);
  });

  it("quotes an assistant turn into the composer", () => {
    const container = document.createElement("div");
    const onQuoteDraftChange = vi.fn();
    render(
      renderChat(
        createProps({
          onQuoteDraftChange,
          messages: [
            {
              id: "msg-a1",
              role: "assistant",
              timestamp: 1000,
              content: [{ type: "text", text: "先改邀请门槛，再给管理员开通员工席位。" }],
            },
          ],
        }),
      ),
      container,
    );
    const quoteBtn = container.querySelector<HTMLButtonElement>(".chat-msg-quote-btn");
    const actions = container.querySelector(".chat-msg-actions");
    expect(quoteBtn).not.toBeNull();
    expect(actions?.querySelector(".chat-copy-btn")).not.toBeNull();
    expect(quoteBtn?.textContent?.trim()).toBe("");
    quoteBtn?.click();
    expect(onQuoteDraftChange).toHaveBeenCalledWith({
      messageId: "msg-a1",
      excerpt: "先改邀请门槛，再给管理员开通员工席位。",
    });
  });

  it("shows a live thinking elapsed clock while delivery text is empty", () => {
    const container = document.createElement("div");
    render(
      renderChat(
        createProps({
          renderMode: "workbench-compact",
          showThinking: true,
          sending: true,
          stream: "",
          streamStartedAt: 100,
          thinkingNowMs: 170_100,
          thinkingProgress: {
            steps: [{ id: "s1", label: "理解问题", status: "active" }],
            activeIndex: 0,
            percent: 12,
            placeholder: "正在梳理思路…",
          },
        }),
      ),
      container,
    );
    expect(container.textContent).toContain("Thinking 2m50s");
    expect(container.querySelector(".chat-thinking-progress")).not.toBeNull();
  });

  it("opens the compact workbench file picker from the attachment button", () => {
    const container = document.createElement("div");
    render(
      renderChat(
        createProps({
          renderMode: "workbench-compact",
          onAttachmentsChange: vi.fn(),
        }),
      ),
      container,
    );

    const input = container.querySelector<HTMLInputElement>(".chat-compose__file-input");
    const button = container.querySelector<HTMLButtonElement>(
      '.chat-compose__icon-btn[aria-label="Add attachment"]',
    );
    expect(input).not.toBeNull();
    expect(button).not.toBeNull();

    const clickSpy = vi.spyOn(input!, "click").mockImplementation(() => undefined);
    button!.click();
    expect(clickSpy).toHaveBeenCalledTimes(1);
    clickSpy.mockRestore();
    expect(input?.accept).toContain(".zip");
    expect(input?.accept).toContain(".rar");
    expect(input?.accept).toContain(".7z");
    expect(input?.accept).toContain(".tgz");
    expect(input?.accept).toContain("application/x-zip-compressed");
    expect(input?.accept).toContain("application/x-rar-compressed");
  });

  it("attaches an archive and shows a visible rejection when the type is unsupported", async () => {
    const originalFileReader = globalThis.FileReader;
    const readAsDataURL = vi.fn();
    class TrackingFileReader extends EventTarget {
      public result: string | ArrayBuffer | null = null;
      public error: DOMException | null = null;

      public readAsDataURL(file: File) {
        readAsDataURL(file);
        this.result = "data:application/zip;base64,UEs=";
        this.dispatchEvent(new Event("load"));
      }
    }
    vi.stubGlobal("FileReader", TrackingFileReader);

    try {
      const container = document.createElement("div");
      let attachments: ChatAttachment[] = [];
      const onAttachmentsChange = vi.fn((next: ChatAttachment[]) => {
        attachments = next;
      });
      const renderComposer = () => {
        render(
          renderChat(
            createProps({
              renderMode: "workbench-compact",
              attachments,
              onAttachmentsChange,
            }),
          ),
          container,
        );
      };
      renderComposer();

      const fileInput = () =>
        container.querySelector<HTMLInputElement>(".chat-compose__file-input");
      const assignFiles = (files: File[]) => {
        const input = fileInput();
        expect(input).not.toBeNull();
        Object.defineProperty(input, "files", { configurable: true, value: files });
        input!.dispatchEvent(new Event("change"));
      };

      assignFiles([new File(["PK"], "bundle.zip", { type: "" })]);
      await Promise.resolve();
      expect(readAsDataURL).toHaveBeenCalledTimes(1);
      expect(
        attachments.some((att) => att.fileName === "bundle.zip" && att.status !== "failed"),
      ).toBe(true);

      readAsDataURL.mockClear();
      attachments = [];
      renderComposer();
      assignFiles([
        new File(["MZ"], "setup.exe", { type: "application/octet-stream" }),
        new File(["PK"], "logs.tgz", { type: "application/gzip" }),
      ]);
      await Promise.resolve();

      expect(readAsDataURL).toHaveBeenCalledTimes(1);
      expect(attachments.map((att) => att.fileName)).toEqual(["logs.tgz", "setup.exe"]);
      const rejected = attachments.find((att) => att.fileName === "setup.exe");
      expect(rejected).toEqual(
        expect.objectContaining({
          status: "failed",
          error: expect.stringContaining("Cannot attach “setup.exe”"),
        }),
      );
      renderComposer();
      const notice = container.querySelector(".chat-compose__attachment-reject");
      expect(notice?.getAttribute("role")).toBe("status");
      expect(notice?.textContent).toContain("Cannot attach “setup.exe”");
      expect(notice?.textContent).toContain("not supported");
    } finally {
      vi.stubGlobal("FileReader", originalFileReader);
    }
  });

  it("shows a rejection notice when an unsupported file is pasted", () => {
    const container = document.createElement("div");
    let attachments: ChatAttachment[] = [];
    const onAttachmentsChange = vi.fn((next: ChatAttachment[]) => {
      attachments = next;
    });
    render(
      renderChat(
        createProps({
          renderMode: "workbench-compact",
          attachments,
          onAttachmentsChange,
        }),
      ),
      container,
    );

    const textarea = container.querySelector("textarea");
    expect(textarea).not.toBeNull();
    const file = new File(["MZ"], "setup.exe", { type: "application/octet-stream" });
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", {
      value: {
        items: [
          {
            kind: "file",
            getAsFile: () => file,
          },
        ],
        getData: () => "",
      },
    });
    textarea!.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(attachments).toEqual([
      expect.objectContaining({
        fileName: "setup.exe",
        status: "failed",
        error: expect.stringContaining("Cannot attach “setup.exe”"),
      }),
    ]);
    render(
      renderChat(
        createProps({
          renderMode: "workbench-compact",
          attachments,
          onAttachmentsChange,
        }),
      ),
      container,
    );
    expect(container.querySelector(".chat-compose__attachment-reject")?.textContent).toContain(
      "Cannot attach “setup.exe”",
    );
  });

  it("shows a local attachment read failure in plain language", async () => {
    const originalFileReader = globalThis.FileReader;
    class FailingFileReader extends EventTarget {
      public result: string | ArrayBuffer | null = null;
      public error = new DOMException("The requested file could not be read", "NotReadableError");

      public readAsDataURL() {
        this.dispatchEvent(new Event("error"));
      }
    }
    vi.stubGlobal("FileReader", FailingFileReader);

    try {
      const container = document.createElement("div");
      const onAttachmentsChange = vi.fn();
      render(
        renderChat(
          createProps({
            renderMode: "workbench-compact",
            onAttachmentsChange,
          }),
        ),
        container,
      );

      const input = container.querySelector<HTMLInputElement>(".chat-compose__file-input");
      expect(input).not.toBeNull();
      Object.defineProperty(input, "files", {
        configurable: true,
        value: [new File(["report"], "report.pdf", { type: "application/pdf" })],
      });
      input!.dispatchEvent(new Event("change"));
      await Promise.resolve();
      await Promise.resolve();

      expect(onAttachmentsChange).toHaveBeenLastCalledWith([
        expect.objectContaining({
          fileName: "report.pdf",
          status: "failed",
          error: expect.stringContaining("无法读取“report.pdf”"),
        }),
      ]);
      const failed = onAttachmentsChange.mock.lastCall?.[0] as ChatAttachment[];
      render(
        renderChat(
          createProps({
            renderMode: "workbench-compact",
            attachments: failed,
            onAttachmentsChange,
          }),
        ),
        container,
      );
      expect(container.querySelector(".chat-compose__attachment-reject")).toBeNull();
      expect(container.textContent).not.toContain("无法读取“report.pdf”");
      expect(
        container.querySelector(".chat-compose__attachment-chip")?.getAttribute("title"),
      ).toContain("无法读取“report.pdf”");
    } finally {
      vi.stubGlobal("FileReader", originalFileReader);
    }
  });

  it("shows an unsupported-type notice once and keeps size errors on the chip", () => {
    const container = document.createElement("div");
    const sizeError = "文件过大：30 MB，上限 25 MB";
    const unsupportedError =
      "Cannot attach “setup.exe”. This file type is not supported. Images, documents, and archives (zip, rar, 7z, tar, gz, tgz) are allowed.";
    const attachments: ChatAttachment[] = [
      {
        id: "size",
        dataUrl: "",
        mimeType: "application/pdf",
        fileName: "big.pdf",
        status: "failed",
        error: sizeError,
      },
      {
        id: "type",
        dataUrl: "",
        mimeType: "application/octet-stream",
        fileName: "setup.exe",
        status: "failed",
        failureReason: "unsupported",
        error: unsupportedError,
      },
    ];
    render(
      renderChat(
        createProps({
          renderMode: "workbench-compact",
          attachments,
          onAttachmentsChange: vi.fn(),
        }),
      ),
      container,
    );

    const notice = container.querySelector(".chat-compose__attachment-reject");
    const lines = [...container.querySelectorAll(".chat-compose__attachment-reject-line")];
    expect(lines).toHaveLength(1);
    expect(lines[0]?.textContent).toBe(unsupportedError);
    expect(notice?.textContent).toContain(unsupportedError);
    expect(container.textContent?.split(unsupportedError)).toHaveLength(2);
    expect(container.textContent).not.toContain(sizeError);
    const chips = [...container.querySelectorAll(".chat-compose__attachment-chip")];
    expect(
      chips.find((chip) => chip.textContent?.includes("big.pdf"))?.getAttribute("title"),
    ).toContain(sizeError);
    expect(chips.find((chip) => chip.textContent?.includes("setup.exe"))?.textContent).toContain(
      "失败",
    );
  });

  it("skips duplicate attachment reads and marks the existing file", () => {
    const originalFileReader = globalThis.FileReader;
    const readAsDataURL = vi.fn();
    class TrackingFileReader extends EventTarget {
      public result: string | ArrayBuffer | null = null;
      public error: DOMException | null = null;

      public readAsDataURL(file: File) {
        readAsDataURL(file);
      }
    }
    vi.stubGlobal("FileReader", TrackingFileReader);

    try {
      const container = document.createElement("div");
      const onAttachmentsChange = vi.fn();
      const attachment: ChatAttachment = {
        id: "att-1",
        dataUrl: "data:application/pdf;base64,QQ==",
        mimeType: "application/pdf",
        fileName: "report.pdf",
        status: "ready",
        progress: 100,
      };
      render(
        renderChat(
          createProps({
            renderMode: "workbench-compact",
            attachments: [attachment],
            onAttachmentsChange,
          }),
        ),
        container,
      );

      const input = container.querySelector<HTMLInputElement>(".chat-compose__file-input");
      expect(input).not.toBeNull();
      Object.defineProperty(input, "files", {
        configurable: true,
        value: [new File(["report"], "report.pdf", { type: "application/pdf" })],
      });
      input!.dispatchEvent(new Event("change"));

      expect(readAsDataURL).not.toHaveBeenCalled();
      expect(onAttachmentsChange).toHaveBeenCalledWith([
        expect.objectContaining({
          id: "att-1",
          fileName: "report.pdf",
          status: "ready",
          notice: expect.stringContaining("本地已缓存“report.pdf”"),
          error: undefined,
        }),
      ]);
    } finally {
      vi.stubGlobal("FileReader", originalFileReader);
    }
  });

  it("adds same-name files with different readable content as a new version", async () => {
    const originalFileReader = globalThis.FileReader;
    class SuccessfulFileReader extends EventTarget {
      public result: string | ArrayBuffer | null = null;
      public error: DOMException | null = null;

      public readAsDataURL() {
        this.result = "data:application/pdf;base64,TkVX";
        this.dispatchEvent(new Event("load"));
      }
    }
    vi.stubGlobal("FileReader", SuccessfulFileReader);
    const container = document.createElement("div");
    const onAttachmentsChange = vi.fn();
    const attachment: ChatAttachment = {
      id: "att-previous",
      dataUrl: "data:application/pdf;base64,T0xE",
      mimeType: "application/pdf",
      fileName: "versioned.pdf",
      sizeBytes: 3,
      lastModified: 1,
      status: "ready",
      progress: 100,
    };
    try {
      render(
        renderChat(
          createProps({
            renderMode: "workbench-compact",
            attachments: [attachment],
            onAttachmentsChange,
          }),
        ),
        container,
      );

      const input = container.querySelector<HTMLInputElement>(".chat-compose__file-input");
      expect(input).not.toBeNull();
      const file = new File(["NEW"], "versioned.pdf", {
        type: "application/pdf",
        lastModified: 2,
      });
      Object.defineProperty(input, "files", {
        configurable: true,
        value: [file],
      });
      input!.dispatchEvent(new Event("change"));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      const latestAttachments = onAttachmentsChange.mock.calls.at(-1)?.[0] as ChatAttachment[];
      expect(latestAttachments).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: "att-previous" }),
          expect.objectContaining({
            fileName: "versioned.pdf",
            status: "ready",
            versionId: "v2",
            notice: expect.stringContaining("已将“versioned.pdf”作为新版本 v2 添加"),
            error: undefined,
          }),
        ]),
      );
    } finally {
      vi.stubGlobal("FileReader", originalFileReader);
    }
  });

  it("renders sent file blocks in chat messages", () => {
    const container = document.createElement("div");
    render(
      renderChat(
        createProps({
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "file",
                  fileName: "report.pdf",
                  mimeType: "application/pdf",
                  status: "sent",
                },
              ],
              timestamp: 1000,
            },
          ],
        }),
      ),
      container,
    );

    expect(container.querySelector(".chat-message-file")).not.toBeNull();
    expect(container.textContent).toContain("report.pdf");
    expect(container.textContent).toContain("已发送");
  });

  it("hides client attachment transport manifests from user message text", () => {
    const container = document.createElement("div");
    render(
      renderChat(
        createProps({
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: [
                    "请查看附件",
                    "",
                    "<attachments>",
                    '<attachment name="report.pdf" mime="application/pdf" status="client_sent" />',
                    "</attachments>",
                  ].join("\n"),
                },
                {
                  type: "file",
                  fileName: "report.pdf",
                  mimeType: "application/pdf",
                  status: "sent",
                },
              ],
              timestamp: 1000,
            },
          ],
        }),
      ),
      container,
    );

    expect(container.textContent).toContain("请查看附件");
    expect(container.textContent).toContain("report.pdf");
    expect(container.textContent).not.toContain("<attachments>");
    expect(container.textContent).not.toContain("client_sent");
  });

  it("keeps a 1:1 owner avatar without name, time, or generic You", () => {
    const container = document.createElement("div");
    render(
      renderChat(
        createProps({
          messages: [
            {
              role: "user",
              content: "hello from topic",
              senderLabel: "Iris",
              timestamp: 1000,
            },
          ],
        }),
      ),
      container,
    );

    expect(container.querySelector(".chat-sender-name")).toBeNull();
    expect(container.querySelector(".chat-group-timestamp")).toBeNull();
    expect(container.querySelector(".chat-avatar.user")?.textContent?.trim()).toBe("I");
    expect(container.textContent).not.toContain("You");
  });

  it("treats control-ui sender labels as the local user in group chat", () => {
    const container = document.createElement("div");
    render(
      renderChat(
        createProps({
          sessionKey: "space:alpha",
          messages: [
            {
              role: "user",
              content: "hello from group",
              senderLabel: "openbot-control-ui",
              timestamp: 1000,
            },
          ],
        }),
      ),
      container,
    );

    expect(container.querySelector(".chat-sender-name")).toBeNull();
    expect(container.textContent).not.toContain("openbot-control-ui");
    expect(container.querySelector(".chat-avatar.user")).not.toBeNull();
  });

  it("shows assistant sender labels for group bot replies", () => {
    const container = document.createElement("div");
    render(
      renderChat(
        createProps({
          sessionKey: "space:alpha",
          messages: [
            {
              role: "assistant",
              content: [{ type: "text", text: "I can help with that." }],
              senderLabel: "Skill孵化",
              timestamp: 1000,
            },
          ],
        }),
      ),
      container,
    );

    expect(container.querySelector(".chat-sender-name")).toBeNull();
    expect(container.querySelector(".chat-group .chat-avatar.assistant")?.textContent?.trim()).toBe(
      "S",
    );
    expect(container.textContent).not.toContain("OpenBot");
  });

  it("hides assistant tool cards in collaboration threads when tool cards are disabled", () => {
    const container = document.createElement("div");
    render(
      renderChat(
        createProps({
          sessionKey: "space:alpha",
          showToolCards: false,
          messages: [
            {
              role: "assistant",
              timestamp: 1000,
              content: [{ type: "toolcall", name: "read", arguments: { path: "MEMORY.md" } }],
            },
            {
              role: "assistant",
              timestamp: 1001,
              senderLabel: "大白管家",
              content: [{ type: "text", text: "这是整理后的结论。" }],
            },
          ],
        }),
      ),
      container,
    );

    expect(container.querySelector(".chat-tool-card")).toBeNull();
    expect(container.textContent).not.toContain("read");
    expect(container.textContent).toContain("这是整理后的结论。");
  });

  it("hides historical thinking in workbench compact even when the setting is on", () => {
    const container = document.createElement("div");
    render(
      renderChat(
        createProps({
          renderMode: "workbench-compact",
          showThinking: true,
          sessions: {
            ...createSessions(),
            sessions: [
              {
                key: "main",
                kind: "direct",
                updatedAt: 1,
                reasoningLevel: "low",
              },
            ],
          },
          messages: [
            {
              role: "assistant",
              timestamp: 1000,
              content: [
                { type: "thinking", thinking: "Let me inspect the sandbox path." },
                { type: "text", text: "本机微信客户端数据在容器目录里，不能直接当知识库。" },
              ],
            },
          ],
        }),
      ),
      container,
    );

    expect(container.querySelector(".chat-thinking")).toBeNull();
    expect(container.textContent).toContain("不能直接当知识库");
    expect(container.textContent).not.toContain("sandbox");
  });

  it("shows ephemeral thinking progress only while delivery text is empty", () => {
    const progress = {
      steps: [{ id: "s1", label: "理解问题", status: "active" as const }],
      activeIndex: 0,
      percent: 12,
      placeholder: "正在梳理思路…",
    };
    const waiting = document.createElement("div");
    render(
      renderChat(
        createProps({
          renderMode: "workbench-compact",
          showThinking: true,
          stream: "",
          streamStartedAt: 100,
          thinkingProgress: progress,
        }),
      ),
      waiting,
    );
    expect(waiting.querySelector(".chat-thinking-progress")).not.toBeNull();
    expect(waiting.textContent).toContain("正在梳理思路");

    const delivering = document.createElement("div");
    render(
      renderChat(
        createProps({
          renderMode: "workbench-compact",
          showThinking: true,
          stream: "本机微信客户端数据在容器目录里，不能直接当知识库。",
          streamStartedAt: 100,
          thinkingProgress: progress,
        }),
      ),
      delivering,
    );
    expect(delivering.querySelector(".chat-thinking-progress")).toBeNull();
    expect(delivering.textContent).toContain("不能直接当知识库");
  });

  it("renders compaction dividers from __openbot markers", () => {
    const container = document.createElement("div");
    render(
      renderChat(
        createProps({
          messages: [
            {
              role: "system",
              content: [{ type: "text", text: "Compaction" }],
              timestamp: 1000,
              __openbot: {
                kind: "compaction",
                id: "comp-1",
              },
            },
          ],
        }),
      ),
      container,
    );

    expect(container.textContent).toContain("Compaction");
    expect(container.querySelector(".message")).toBeNull();
  });

  it("keeps rendering compaction dividers from legacy __openclaw markers", () => {
    const container = document.createElement("div");
    render(
      renderChat(
        createProps({
          messages: [
            {
              role: "system",
              content: [{ type: "text", text: "Compaction" }],
              timestamp: 1001,
              __openclaw: {
                kind: "compaction",
                id: "legacy-comp-1",
              },
            },
          ],
        }),
      ),
      container,
    );

    expect(container.textContent).toContain("Compaction");
    expect(container.querySelector(".message")).toBeNull();
  });

  it("keeps consecutive user messages from different senders in separate groups", () => {
    const container = document.createElement("div");
    render(
      renderChat(
        createProps({
          messages: [
            {
              role: "user",
              content: "first",
              senderLabel: "Iris",
              timestamp: 1000,
            },
            {
              role: "user",
              content: "second",
              senderLabel: "Joaquin De Rojas",
              timestamp: 1001,
            },
          ],
        }),
      ),
      container,
    );

    const groups = container.querySelectorAll(".chat-group.user");
    expect(groups).toHaveLength(2);
    expect(container.querySelector(".chat-sender-name")).toBeNull();
    const initials = Array.from(container.querySelectorAll(".chat-avatar.user")).map((node) =>
      node.textContent?.trim(),
    );
    expect(initials).toEqual(["I", "J"]);
  });

  it("opens a mention popup from collaboration candidates when composing @", () => {
    const container = document.createElement("div");
    render(
      renderChat(
        createProps({
          draft: "@",
          mentionCandidates: [
            {
              agentId: "main",
              displayName: "大白管家",
              roleName: "协调者",
              online: true,
              isCoordinator: true,
              isBot: true,
            },
            {
              agentId: "bot-2",
              displayName: "市场助手",
              roleName: "成员",
              online: true,
              isCoordinator: false,
              isBot: true,
            },
          ],
        }),
      ),
      container,
    );

    const popup = container.querySelector(".mention-popup");
    expect(popup).not.toBeNull();
    expect(popup?.textContent).toContain("大白管家");
    expect(popup?.textContent).toContain("市场助手");
  });

  it("inserts the selected mention into the composer draft", () => {
    const container = document.createElement("div");
    const onDraftChange = vi.fn();
    render(
      renderChat(
        createProps({
          draft: "请 @",
          onDraftChange,
          mentionCandidates: [
            {
              agentId: "bot-2",
              displayName: "市场助手",
              roleName: "成员",
              online: true,
              isCoordinator: false,
              isBot: true,
            },
          ],
        }),
      ),
      container,
    );

    container.querySelector<HTMLElement>('.mention-popup__option[data-agent-id="bot-2"]')?.click();

    expect(onDraftChange).toHaveBeenCalledWith("请 @市场助手 ");
  });
  it("opens the context picker as a fixed overlay so workbench overflow cannot clip it", () => {
    const container = document.createElement("div");
    const onContextScopeChange = vi.fn();
    render(
      renderChat(
        createProps({
          connected: true,
          renderMode: "workbench-compact",
          contextScope: { ...DEFAULT_CHAT_CONTEXT_SCOPE, pickerOpen: false },
          onContextScopeChange,
        }),
      ),
      container,
    );

    const button = container.querySelector<HTMLButtonElement>(".chat-compose__context-tab");
    expect(container.querySelector(".chat-compose__context-pop")).toBeNull();
    expect(button?.disabled).toBe(false);
    expect(button?.textContent).toContain("Knowledge");
    expect(button?.textContent).not.toContain("Context");
    button?.click();
    expect(onContextScopeChange).toHaveBeenCalledWith(
      expect.objectContaining({ pickerOpen: true }),
    );

    render(
      renderChat(
        createProps({
          connected: true,
          renderMode: "workbench-compact",
          contextScope: { ...DEFAULT_CHAT_CONTEXT_SCOPE, pickerOpen: true },
          onContextScopeChange,
        }),
      ),
      container,
    );
    const pop = container.querySelector<HTMLElement>(".chat-compose__context-pop");
    expect(pop).not.toBeNull();
    expect(pop?.dataset.anchored).toBe("true");
    expect(pop?.style.position).toBe("fixed");
    expect(container.querySelector(".chat-compose__context")?.classList.contains("is-open")).toBe(
      true,
    );
    expect(container.querySelector(".chat")?.classList.contains("is-open")).toBe(false);
  });

  it("renders the context source picker without technical jargon", () => {
    const container = document.createElement("div");
    const onContextScopeChange = vi.fn();
    render(
      renderChat(
        createProps({
          sessionKey: "space:alpha",
          contextScope: { ...DEFAULT_CHAT_CONTEXT_SCOPE, pickerOpen: true },
          onContextScopeChange,
        }),
      ),
      container,
    );

    expect(container.querySelector(".chat-compose__context-tab")?.textContent).toContain(
      "Knowledge",
    );
    expect(container.querySelector(".chat-compose__context-tab")?.textContent).not.toContain(
      "Context",
    );
    expect(container.textContent).toContain("Authorized knowledge");
    expect(container.textContent).toContain("Use this conversation only");
    expect(container.textContent).toContain("Search deeper");
    expect(container.textContent).toContain("This turn will use: Authorized knowledge");
    expect(container.textContent).not.toContain("If you don't pick anything");
    expect(container.textContent).not.toContain("Search catalog");
    expect(container.textContent).not.toContain("Context sources");
    expect(container.textContent).not.toContain("This group");
    expect(container.textContent).not.toContain("RAG");
    expect(container.textContent).not.toContain("Token");
    expect(container.textContent).not.toContain("Full Scan");

    const conversation = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Use this conversation only"),
    );
    conversation?.click();
    expect(onContextScopeChange).toHaveBeenCalledWith(
      expect.objectContaining({
        preset: "conversation",
        selectedSources: [],
        deepEnabled: false,
        pickerOpen: true,
      }),
    );
  });

  it("lets the user pick a specific file, folder, or API from the source browser", () => {
    const container = document.createElement("div");
    const onContextScopeChange = vi.fn();
    render(
      renderChat(
        createProps({
          sessionKey: "main",
          contextScope: { ...DEFAULT_CHAT_CONTEXT_SCOPE, pickerOpen: true },
          contextSources: [
            { type: "file", id: "doc-roadmap", label: "roadmap.md", subtitle: "产品资料" },
            { type: "folder", id: "lfb-design", label: "设计稿" },
            { type: "api", id: "src-crm", label: "CRM" },
          ],
          onContextScopeChange,
        }),
      ),
      container,
    );

    expect(container.textContent).toContain("roadmap.md");
    expect(container.textContent).toContain("设计稿");
    expect(container.textContent).toContain("CRM");
    expect(container.textContent).not.toContain("RAG");
    expect(container.textContent).not.toContain("Full Scan");

    const fileBox = Array.from(
      container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
    ).find((input) => input.parentElement?.textContent?.includes("roadmap.md"));
    fileBox?.dispatchEvent(new Event("change", { bubbles: true }));
    expect(onContextScopeChange).toHaveBeenCalledWith(
      expect.objectContaining({
        preset: "custom",
        selectedSources: [expect.objectContaining({ type: "file", id: "doc-roadmap" })],
      }),
    );
  });

  it("groups the search catalog like My Knowledge and checks spaces instead of sections", () => {
    const container = document.createElement("div");
    const onContextScopeChange = vi.fn();
    render(
      renderChat(
        createProps({
          sessionKey: "main",
          contextScope: { ...DEFAULT_CHAT_CONTEXT_SCOPE, pickerOpen: true },
          contextSources: [
            { type: "knowledge", id: "kb-1", label: "产品资料", visibility: "private" },
            { type: "file", id: "doc-roadmap", label: "roadmap.md", parentId: "kb-1" },
            {
              type: "knowledge",
              id: "kb-team",
              label: "团队制度",
              visibility: "team",
              hasConflict: true,
            },
          ],
          onContextScopeChange,
        }),
      ),
      container,
    );

    expect(container.textContent).toContain("Personal");
    expect(container.textContent).toContain("Team");
    expect(container.textContent).toContain("产品资料");
    expect(container.querySelector(".chat-compose__context-conflict")?.getAttribute("title")).toBe(
      "Has conflicts; retrieval may be less accurate",
    );
    expect(container.textContent).not.toContain("Has conflicts; retrieval may be less accurate");
    expect(container.textContent).not.toContain("roadmap.md");
    expect(
      container.querySelector('[data-visibility="private"] input[type="checkbox"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('.chat-compose__context-group-label input[type="checkbox"]'),
    ).toBeNull();

    const spaceRow = container.querySelector<HTMLButtonElement>(
      '[data-key="knowledge:kb-1"] .chat-compose__context-row-main',
    );
    spaceRow?.click();
    expect(onContextScopeChange).toHaveBeenCalledWith(
      expect.objectContaining({
        expandedKeys: ["knowledge:kb-1"],
        pickerOpen: true,
      }),
    );

    const spaceBox = container.querySelector<HTMLInputElement>(
      '[data-key="knowledge:kb-1"] input[type="checkbox"]',
    );
    spaceBox?.dispatchEvent(new Event("change", { bubbles: true }));
    expect(onContextScopeChange).toHaveBeenCalledWith(
      expect.objectContaining({
        preset: "custom",
        selectedSources: [expect.objectContaining({ type: "knowledge", id: "kb-1" })],
      }),
    );
  });

  it("asks the user to confirm extra sources and does not auto-expand", () => {
    const container = document.createElement("div");
    const onAcceptContextExpansion = vi.fn();
    const onDismissContextExpansion = vi.fn();
    render(
      renderChat(
        createProps({
          sessionKey: "main",
          contextExpansion: {
            runId: "run-expand",
            reason: "empty",
            proposedSources: [{ type: "knowledge", id: "kb-product", label: "产品资料库" }],
          },
          onAcceptContextExpansion,
          onDismissContextExpansion,
        }),
      ),
      container,
    );

    expect(container.textContent).toContain("Current sources were not enough");
    expect(container.textContent).toContain("产品资料库");
    expect(container.textContent).not.toContain("RAG");
    expect(container.textContent).not.toContain("Token");

    const accept = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Use these sources"),
    );
    const dismiss = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Not now"),
    );
    accept?.click();
    dismiss?.click();
    expect(onAcceptContextExpansion).toHaveBeenCalledTimes(1);
    expect(onDismissContextExpansion).toHaveBeenCalledTimes(1);
  });

  it("does not keep a consumed-receipt row under the knowledge capsule", () => {
    const container = document.createElement("div");
    render(
      renderChat(
        createProps({
          connected: true,
          contextScope: {
            ...DEFAULT_CHAT_CONTEXT_SCOPE,
            selectedSources: [{ type: "knowledge", id: "kb-inbox", label: "市场助手实测知识库" }],
            consumeReceipts: [
              { type: "knowledge", id: "kb-inbox", label: "小组收录", status: "consumed" },
            ],
          },
          onContextScopeChange: vi.fn(),
        }),
      ),
      container,
    );

    expect(container.querySelector("[data-testid='chat-context-receipts']")).toBeNull();
    expect(container.querySelector("[data-testid='chat-context-reading']")).toBeNull();
    expect(container.querySelector(".chat-compose__context-tab-value")?.textContent).toContain(
      "市场助手实测知识库",
    );
    expect(container.textContent).not.toContain("Used");
    expect(container.textContent).not.toContain("小组收录");
  });

  it("shows file and folder reading status beside the knowledge capsule", () => {
    const container = document.createElement("div");
    render(
      renderChat(
        createProps({
          connected: true,
          contextScope: {
            ...DEFAULT_CHAT_CONTEXT_SCOPE,
            selectedSources: [
              { type: "knowledge", id: "kb-1", label: "市场助手实测知识库" },
              { type: "file", id: "doc-a", label: "roadmap.md" },
              { type: "file", id: "doc-b", label: "notes.txt" },
            ],
          },
          onContextScopeChange: vi.fn(),
        }),
      ),
      container,
    );

    const reading = container.querySelector("[data-testid='chat-context-reading']");
    expect(reading).not.toBeNull();
    expect(reading?.textContent?.trim()).toBe("Reading roadmap.md and 2 files");
    expect(container.querySelector(".chat-compose__context-tab-value")?.textContent).toContain(
      "市场助手实测知识库",
    );
    expect(container.querySelector("[data-testid='chat-context-receipts']")).toBeNull();
  });

  it("shows folder reading status beside the knowledge capsule", () => {
    const container = document.createElement("div");
    render(
      renderChat(
        createProps({
          connected: true,
          contextScope: {
            ...DEFAULT_CHAT_CONTEXT_SCOPE,
            selectedSources: [
              { type: "folder", id: "lfb-1", label: "设计稿" },
              { type: "folder", id: "lfb-2", label: "合同" },
            ],
          },
          onContextScopeChange: vi.fn(),
        }),
      ),
      container,
    );

    expect(
      container.querySelector("[data-testid='chat-context-reading']")?.textContent?.trim(),
    ).toBe("Reading 设计稿 and 2 folders");
    expect(container.querySelector(".chat-compose__context-tab-value")).toBeNull();
  });

  it("keeps denied access next to the capsule without a receipt row", () => {
    const container = document.createElement("div");
    render(
      renderChat(
        createProps({
          connected: true,
          contextScope: {
            ...DEFAULT_CHAT_CONTEXT_SCOPE,
            consumeReceipts: [
              { type: "file", id: "doc-roadmap", label: "roadmap.md", status: "consumed" },
              { type: "api", id: "src-crm", label: "CRM", status: "denied" },
            ],
          },
          onContextScopeChange: vi.fn(),
        }),
      ),
      container,
    );

    expect(container.querySelector("[data-testid='chat-context-receipts']")).toBeNull();
    const reading = container.querySelector("[data-testid='chat-context-reading']");
    expect(reading?.textContent).toContain("CRM");
    expect(reading?.textContent).toContain("No access");
    expect(reading?.classList.contains("is-denied")).toBe(true);
    expect(container.textContent).not.toContain("Used");
  });

  // FT-DEDUPE-THINKING-PROGRESS-UI acceptance A+B
  it("prefers thinking-progress and omits 正在思考 reading-indicator when both would show", () => {
    const container = document.createElement("div");
    render(
      renderChat(
        createProps({
          sessionKey: "agent:main:employee:demo",
          showThinking: true,
          stream: "",
          streamStartedAt: 1,
          thinkingProgress: {
            steps: [
              { id: "s1", label: "理解问题", status: "done" },
              { id: "s2", label: "梳理要点", status: "active" },
              { id: "s3", label: "组织回答", status: "pending" },
            ],
            activeIndex: 1,
            percent: 42,
            placeholder: "正在梳理思路…",
          },
          workProgressLabel: "正在思考",
        }),
      ),
      container,
    );
    expect(container.querySelector(".chat-thinking-progress")).not.toBeNull();
    expect(container.textContent).toContain("正在梳理思路");
    expect(container.querySelector(".chat-reading-indicator")).toBeNull();
    expect(container.querySelector("[data-testid='chat-work-progress']")).toBeNull();
    expect(container.textContent).not.toMatch(/正在思考\s*●|正在思考●/);
  });

  it("still shows alone 正在思考 reading-indicator when thinking-progress is absent", () => {
    const container = document.createElement("div");
    render(
      renderChat(
        createProps({
          sessionKey: "agent:main:employee:demo",
          showThinking: true,
          stream: "",
          streamStartedAt: 1,
          thinkingProgress: null,
          workProgressLabel: "正在思考",
        }),
      ),
      container,
    );
    expect(container.querySelector(".chat-thinking-progress")).toBeNull();
    expect(container.querySelector(".chat-reading-indicator")).not.toBeNull();
    expect(container.querySelector("[data-testid='chat-work-progress']")?.textContent).toBe(
      "正在思考",
    );
  });

  it("shows the live work-progress phase on the reading indicator", () => {
    const container = document.createElement("div");
    render(
      renderChat(
        createProps({
          sessionKey: "agent:main:employee:demo",
          stream: "",
          streamStartedAt: 1,
          workProgressLabel: "正在思考",
        }),
      ),
      container,
    );
    expect(container.querySelector("[data-testid='chat-work-progress']")?.textContent).toBe(
      "正在思考",
    );
    expect(container.textContent).not.toContain("正在思考正在思考");
  });

  it("shows verifying on the same indicator when the stream slot is closed", () => {
    const container = document.createElement("div");
    render(
      renderChat(
        createProps({
          stream: null,
          workProgressLabel: "正在验证",
        }),
      ),
      container,
    );
    expect(container.querySelector("[data-testid='chat-work-progress']")?.textContent).toBe(
      "正在验证",
    );
  });

  it("shows drafting beside streamed reply text and clears when the phase is absent", () => {
    const container = document.createElement("div");
    render(
      renderChat(
        createProps({
          stream: "先写这一段",
          streamStartedAt: 1,
          workProgressLabel: "正在起草",
        }),
      ),
      container,
    );
    expect(container.querySelector("[data-testid='chat-work-progress']")?.textContent).toBe(
      "正在起草",
    );
    expect(container.textContent).toContain("先写这一段");

    render(renderChat(createProps({ stream: null, workProgressLabel: null })), container);
    expect(container.querySelector("[data-testid='chat-work-progress']")).toBeNull();
  });

  it("shows workbench chat phases and clears them on the compact console surface", () => {
    const container = document.createElement("div");
    render(
      renderChat(
        createProps({
          renderMode: "workbench-compact",
          stream: "",
          streamStartedAt: 1,
          workProgressLabel: "正在整理",
        }),
      ),
      container,
    );
    expect(container.querySelector("textarea")).not.toBeNull();
    expect(container.querySelector("[data-testid='chat-work-progress']")?.textContent).toBe(
      "正在整理",
    );
    render(
      renderChat(
        createProps({
          renderMode: "workbench-compact",
          stream: null,
          workProgressLabel: null,
        }),
      ),
      container,
    );
    expect(container.querySelector("[data-testid='chat-work-progress']")).toBeNull();
  });

  it("does not render steward identity on empty space streams", () => {
    const container = document.createElement("div");
    render(
      renderChat(
        createProps({
          sessionKey: "space:alpha",
          assistantName: "大白管家",
          assistantAvatar: "大",
          stream: "   ",
          streamStartedAt: Date.now(),
        }),
      ),
      container,
    );
    const avatar = container.querySelector(".chat-avatar.assistant");
    expect(avatar?.textContent?.trim()).not.toBe("大");
    expect(container.textContent).not.toContain("大白");
    expect(container.querySelector(".chat-reading-indicator")).not.toBeNull();
  });

  it("does not render steward identity on whitespace space stream rows", () => {
    const container = document.createElement("div");
    render(
      renderChat(
        createProps({
          sessionKey: "space:alpha",
          assistantName: "大",
          assistantAvatar: "大",
          stream: "\n",
          streamStartedAt: Date.now(),
        }),
      ),
      container,
    );
    const avatar = container.querySelector(".chat-avatar.assistant");
    expect(avatar?.textContent?.trim()).not.toBe("大");
    expect(container.textContent).not.toContain("大白管家");
  });

  it("does not render steward identity on 1:1 empty streams", () => {
    const container = document.createElement("div");
    render(
      renderChat(
        createProps({
          sessionKey: "agent:main:employee:demo",
          assistantName: "大白管家",
          assistantAvatar: "大",
          stream: "   ",
          streamStartedAt: Date.now(),
        }),
      ),
      container,
    );
    expect(container.querySelector(".chat-avatar.assistant")).toBeNull();
    expect(container.querySelector(".chat-sender-name")).toBeNull();
  });

  it("uses child runId identity for space streams instead of steward fallback", () => {
    const container = document.createElement("div");
    render(
      renderChat(
        createProps({
          sessionKey: "space:alpha",
          assistantName: "大白管家",
          assistantAvatar: "大",
          stream: "在的",
          streamStartedAt: Date.now(),
          chatRunId: "0377a6f4-2ec2-4518-9494-2176a061b8ca:bot-2",
          participantAgents: [
            {
              id: "bot-2",
              name: "市场助手",
              identity: { name: "市场助手" },
            },
          ],
        }),
      ),
      container,
    );
    expect(container.querySelector(".chat-sender-name")).toBeNull();
    const avatar = container.querySelector(".chat-avatar.assistant");
    expect(avatar?.textContent?.trim()).toBe("市");
    expect(avatar?.textContent?.trim()).not.toBe("大");
    expect(container.textContent).not.toContain("大白");
  });

  it("renders a left peek rail for prior user turns and excludes the latest", () => {
    const container = document.createElement("div");
    render(
      renderChat(
        createProps({
          messages: [
            {
              id: "u1",
              role: "user",
              content: "请按 6efc8e811a 验收。\n6efc8e811a 暂不通过验收。",
            },
            { id: "a1", role: "assistant", content: "收到" },
            { id: "u2", role: "user", content: "请复检 P1\ncompose 只同步两层" },
            { id: "a2", role: "assistant", content: "已复检" },
            { id: "u3", role: "user", content: "下一步执行 P3.8" },
          ],
        }),
      ),
      container,
    );

    const rail = container.querySelector('[data-testid="chat-topic-peek-rail"]');
    const strings = container.querySelectorAll('[data-testid="chat-topic-peek-string"]');
    const cards = container.querySelectorAll('[data-testid="chat-topic-peek-card"]');
    expect(rail).not.toBeNull();
    expect(strings).toHaveLength(2);
    expect(cards).toHaveLength(2);
    expect(strings[0]?.getAttribute("data-peek-message-id")).toBe("u1");
    expect(strings[1]?.getAttribute("data-peek-message-id")).toBe("u2");
    expect(rail?.querySelector(".chat-topic-peek-strings")).not.toBeNull();
    expect(rail?.textContent).toContain("请按 6efc8e811a 验收。");
    expect(rail?.textContent).toContain("暂不通过验收");
    expect(rail?.textContent).not.toContain("下一步执行 P3.8");
    expect(container.querySelector('[data-message-id="u3"]')).not.toBeNull();
  });

  it("does not render peek cards when only one user message is visible", () => {
    const container = document.createElement("div");
    render(
      renderChat(
        createProps({
          messages: [
            { id: "u1", role: "user", content: "单独一条" },
            { id: "a1", role: "assistant", content: "好" },
          ],
        }),
      ),
      container,
    );
    expect(container.querySelector('[data-testid="chat-topic-peek-rail"]')).toBeNull();
  });

  it("keeps peek count and tick length on one set of tokens", async () => {
    const { readFile } = await import("node:fs/promises");
    const { resolve } = await import("node:path");
    const layout = await readFile(resolve("ui/src/styles/chat/layout.css"), "utf8");
    const chat = await readFile(resolve("ui/src/ui/views/chat.ts"), "utf8");
    expect(layout).toContain("var(--peek-thread-h, 0px)");
    expect(layout).toContain("var(--peek-len, 8px)");
    expect(layout).not.toContain("var(--peek-thread-h, 360px)");
    expect(layout).not.toContain("var(--peek-len, 9px)");
    expect(chat).toContain("history.slice(-CHAT_HISTORY_RENDER_LIMIT)");
    expect(chat).not.toContain("history.slice(-200)");
    expect(chat).toContain('class="chat-topic-peek-item" hidden');
  });

  it("focuses the target user message when a peek card is clicked", async () => {
    const container = document.createElement("div");
    render(
      renderChat(
        createProps({
          stream: "正在思考",
          streamStartedAt: Date.now(),
          messages: [
            { id: "u1", role: "user", content: "请复检 P1" },
            { id: "a1", role: "assistant", content: "已看" },
            { id: "u2", role: "user", content: "继续" },
          ],
        }),
      ),
      container,
    );
    const target = container.querySelector('[data-message-id="u1"]');
    expect(target).not.toBeNull();
    const scrollIntoView = vi.fn();
    target!.scrollIntoView = scrollIntoView;

    const string = container.querySelector<HTMLButtonElement>('[data-peek-message-id="u1"]');
    expect(string).not.toBeNull();
    string?.click();
    await Promise.resolve();

    expect(scrollIntoView).toHaveBeenCalled();
    expect(target?.classList.contains("is-mention-focus")).toBe(true);
    expect(container.querySelector(".chat-bubble.streaming")).not.toBeNull();
  });

  it("renders a load-earlier control when older history remains on the server", () => {
    const container = document.createElement("div");
    const onLoadOlderHistory = vi.fn();
    render(
      renderChat(
        createProps({
          historyHasMore: true,
          historyLoadingMore: false,
          onLoadOlderHistory,
          messages: [{ id: "u1", role: "user", content: "最近一条" }],
        }),
      ),
      container,
    );
    const button = container.querySelector<HTMLButtonElement>(".chat-history-more__btn");
    expect(button?.textContent).toContain("Load earlier messages");
    button?.click();
    expect(onLoadOlderHistory).toHaveBeenCalledTimes(1);
  });

  it("places login choice and save cards in the thread under the transcript", async () => {
    await i18n.setLocale("zh-CN");
    const onChoose = vi.fn();
    const container = document.createElement("div");
    render(
      renderChat(
        createProps({
          sessionKey: "session-1",
          messages: [{ id: "u-msg", role: "user", content: "登录这个网站" }],
          loginMethodChoice: {
            choiceId: "choice-1",
            sessionKey: "session-1",
            host: "login.example.com",
            methods: ["password", "qr"],
          },
          onLoginMethodChoose: onChoose,
        }),
      ),
      container,
    );
    const thread = container.querySelector(".chat-thread");
    const card = thread?.querySelector("[data-login-choice='choice-1']");
    const compose = container.querySelector(".chat-compose");
    expect(card).not.toBeNull();
    expect(card?.textContent).toContain("选择登录方式");
    expect(thread?.contains(card ?? null)).toBe(true);
    expect(compose?.contains(card ?? null)).toBe(false);
    card?.querySelector<HTMLButtonElement>("[data-login-method='qr']")?.click();
    expect(onChoose).toHaveBeenCalledWith("choice-1", "qr");
  });

  it("places threadEpilogue after transcript messages and before the composer", () => {
    const container = document.createElement("div");
    render(
      renderChat(
        createProps({
          messages: [
            {
              id: "u-msg",
              role: "user",
              content: "请帮我发周会通知",
            },
          ],
          threadPrelude: html`
            <div class="employee-workbench__assistant-prelude" data-test-prelude="true">prelude</div>
          `,
          threadEpilogue: html`
            <div class="employee-workbench__steward-confirm-card" data-meeting-confirm-card="true">
              meeting-confirm-epilogue
            </div>
          `,
        }),
      ),
      container,
    );
    const thread = container.querySelector(".chat-thread");
    const compose = container.querySelector(".chat-compose");
    const prelude = thread?.querySelector('[data-test-prelude="true"]');
    const epilogue = thread?.querySelector('[data-meeting-confirm-card="true"]');
    expect(thread).not.toBeNull();
    expect(compose).not.toBeNull();
    expect(prelude).not.toBeNull();
    expect(epilogue).not.toBeNull();
    expect(epilogue?.closest(".employee-workbench__assistant-prelude")).toBeNull();
    const userBubble = Array.from(thread?.querySelectorAll(".chat-bubble") ?? []).find((node) =>
      node.textContent?.includes("请帮我发周会通知"),
    );
    expect(userBubble).toBeTruthy();
    // Document order: prelude → user message → epilogue card → composer.
    expect(
      prelude!.compareDocumentPosition(userBubble!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      userBubble!.compareDocumentPosition(epilogue!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      epilogue!.compareDocumentPosition(compose!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});

describe("gateway connection banner", () => {
  beforeEach(async () => {
    await i18n.setLocale("en");
  });

  it("does not use the disconnected banner while reconnecting before hello", () => {
    const container = document.createElement("div");
    render(
      renderChat(
        createProps({
          connected: false,
          canSend: false,
          disabledReason: t("chat.reconnecting"),
          gatewayConnectionPhase: "reconnecting",
          loading: true,
          messages: [],
        }),
      ),
      container,
    );

    const callout = container.querySelector("[data-gateway-connection]");
    expect(callout?.textContent).toContain("Reconnecting to the gateway");
    expect(callout?.textContent).not.toContain("Disconnected from gateway");
    expect(container.querySelector(".chat-thread-skeleton")).not.toBeNull();
    expect(container.querySelector("button.callout__retry")).toBeNull();
    const placeholder = container.querySelector("textarea");
    expect(placeholder?.getAttribute("placeholder")).toBe("Reconnecting to the gateway…");
  });

  it("shows gateway unreachable with a retry action and no loading skeleton", () => {
    const container = document.createElement("div");
    const onRetry = vi.fn();
    render(
      renderChat(
        createProps({
          connected: false,
          canSend: false,
          disabledReason: t("chat.gatewayUnreachable"),
          gatewayConnectionPhase: "unreachable",
          onRetryGatewayConnection: onRetry,
          loading: true,
          messages: [],
        }),
      ),
      container,
    );

    expect(container.querySelector(".chat-thread-skeleton")).toBeNull();
    const callout = container.querySelector("[data-gateway-connection='unreachable']");
    expect(callout?.textContent).toContain("Gateway unreachable.");
    expect(callout?.textContent).not.toContain("Disconnected from gateway");
    const retry = container.querySelector("button.callout__retry");
    expect(retry?.textContent).toContain("Retry connection");
    retry?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("keeps the sticky disconnected copy for auth failures", () => {
    const container = document.createElement("div");
    render(
      renderChat(
        createProps({
          connected: false,
          canSend: false,
          disabledReason: t("chat.disconnected"),
          gatewayConnectionPhase: "blocked",
          error: "unauthorized: gateway token missing",
          loading: false,
          messages: [],
        }),
      ),
      container,
    );

    const callout = container.querySelector("[data-gateway-connection='blocked']");
    expect(callout?.textContent).toContain("Disconnected from gateway.");
    expect(callout?.textContent).not.toContain("Reconnecting");
    expect(container.textContent).toContain("gateway token missing");
    expect(container.querySelector("button.callout__retry")).toBeNull();
    const placeholder = container.querySelector("textarea");
    expect(placeholder?.getAttribute("placeholder")).toBe(t("chat.connectToStart"));
  });
});
