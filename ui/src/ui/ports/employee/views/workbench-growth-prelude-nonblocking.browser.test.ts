// @vitest-environment jsdom
/**
 * P0 acceptance: growth prelude must not block chat compose.
 *
 * Dual-mode:
 * - Root `pnpm test` (jsdom): focus / enabled / send callback
 * - `pnpm -C ui test` (chromium): geometry — compose remains hittable with a
 *   long gap list and a narrow viewport (elementFromPoint on send)
 */
import { render } from "lit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "../../../../i18n/index.ts";
import type { GrowthStatusView, NextGrowthActionView } from "../../../controllers/agent-growth.ts";
import type { ChatProps } from "../../../views/chat.ts";
import { renderChat } from "../../../views/chat.ts";
import { renderRobotGrowthPrelude } from "./workbench-stage-growth-prelude.ts";

const isBrowserMode = typeof (expect as unknown as { element?: unknown }).element === "function";

function recommendation(): NextGrowthActionView {
  return {
    kind: "start_work",
    reason: "growth.recommend.start_work",
    priority: 20,
    gaps: [],
    canSkip: true,
    target: { focusComposer: true },
  };
}

function growthView(): GrowthStatusView {
  return {
    lifecycleState: "birth",
    dimensions: { identity: 10, capability: 0, knowledge: 0, habits: 0 },
    activationScore: 5,
    operationalScore: null,
    capabilityReadiness: false,
    isActivated: false,
    templateId: "contract_reviewer",
    capabilityGaps: Array.from({ length: 12 }, (_, index) => ({
      key: `skill-${index}`,
      label: `推荐能力 ${index + 1}`,
      kind: "skill" as const,
      status: "missing" as const,
    })),
    funnel: {
      hasSessionOpened: true,
      hasIdentityCompleted: false,
      hasFirstSkillInstalled: false,
      hasFirstMissionSent: false,
      hasFirstMissionSuccess: false,
      preludeDismissed: false,
    },
    recommendation: recommendation(),
  };
}

function createChatProps(overrides: Partial<ChatProps> = {}): ChatProps {
  return {
    sessionKey: "agent:market-helper:main",
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
    draft: "帮我写一份市场分析",
    queue: [],
    connected: true,
    canSend: true,
    disabledReason: null,
    error: null,
    sessions: {
      ts: 0,
      path: "",
      count: 0,
      defaults: { model: null, contextTokens: null },
      sessions: [],
    },
    focusMode: false,
    assistantName: "市场助手",
    assistantAvatar: null,
    onRefresh: () => undefined,
    onToggleFocusMode: () => undefined,
    onDraftChange: () => undefined,
    onSend: () => undefined,
    onQueueRemove: () => undefined,
    onNewSession: () => undefined,
    renderMode: "workbench-compact",
    ...overrides,
  };
}

/** Minimal flex contract mirroring `.card.chat` + scrollable thread + sticky compose. */
function applyChatShellLayout(root: HTMLElement) {
  const chat = root.querySelector<HTMLElement>(".chat");
  const thread = root.querySelector<HTMLElement>(".chat-thread");
  const compose = root.querySelector<HTMLElement>(".chat-compose");
  if (chat) {
    chat.style.cssText =
      "display:flex;flex-direction:column;height:100%;min-height:0;overflow:hidden;box-sizing:border-box;";
  }
  if (thread) {
    thread.style.cssText = "flex:1 1 0;min-height:0;overflow:auto;";
  }
  if (compose) {
    compose.style.cssText =
      "flex-shrink:0;position:relative;z-index:10;background:#fff;padding:8px 0;";
  }
}

function mountPreludeChat(host: HTMLElement, onSend: ReturnType<typeof vi.fn>) {
  const view = growthView();
  const prelude = renderRobotGrowthPrelude({
    view,
    roleName: "市场助手",
    recommendation: view.recommendation,
    onPrimaryAction: () => undefined,
    onDismiss: () => undefined,
  });
  render(
    renderChat(
      createChatProps({
        threadPrelude: prelude as import("lit").TemplateResult | null,
        onSend: onSend as () => void,
      }),
    ),
    host,
  );
  applyChatShellLayout(host);
}

function querySendButton(host: HTMLElement): HTMLButtonElement | null {
  return host.querySelector<HTMLButtonElement>(
    ".chat-compose__send-btn, .chat-compose .btn.primary",
  );
}

function queryComposeTextarea(host: HTMLElement): HTMLTextAreaElement | null {
  return host.querySelector<HTMLTextAreaElement>(".chat-compose textarea");
}

let host: HTMLDivElement | null = null;

beforeEach(async () => {
  await i18n.setLocale("zh-CN");
});

afterEach(() => {
  host?.remove();
  host = null;
});

describe("growth prelude non-blocking compose (P0)", () => {
  it("keeps composer focusable and send enabled while prelude is visible", async () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    const onSend = vi.fn();
    mountPreludeChat(host, onSend);

    expect(host.querySelector("[data-growth-prelude='robot']")).toBeTruthy();
    const textarea = queryComposeTextarea(host);
    expect(textarea).toBeTruthy();
    textarea!.focus();
    expect(document.activeElement).toBe(textarea);

    const sendBtn = querySendButton(host);
    expect(sendBtn).toBeTruthy();
    expect(sendBtn!.disabled).toBe(false);
    sendBtn!.click();
    expect(onSend).toHaveBeenCalledOnce();
  });

  it("keeps send hittable under long gaps + narrow viewport (browser geometry)", async () => {
    if (!isBrowserMode) {
      return;
    }
    host = document.createElement("div");
    host.style.cssText =
      "width:390px;height:720px;overflow:hidden;position:relative;background:#f5f5f5;";
    document.body.appendChild(host);

    const onSend = vi.fn();
    mountPreludeChat(host, onSend);

    const prelude = host.querySelector<HTMLElement>("[data-growth-prelude='robot']");
    const compose = host.querySelector<HTMLElement>(".chat-compose");
    const sendBtn = querySendButton(host);
    expect(prelude && compose && sendBtn).toBeTruthy();

    const hostBox = host.getBoundingClientRect();
    const composeBox = compose!.getBoundingClientRect();
    const sendBox = sendBtn!.getBoundingClientRect();

    expect(composeBox.height).toBeGreaterThan(20);
    expect(sendBox.width).toBeGreaterThan(10);
    expect(composeBox.bottom).toBeLessThanOrEqual(hostBox.bottom + 1);
    expect(composeBox.top).toBeGreaterThanOrEqual(hostBox.top - 1);

    const cx = sendBox.left + sendBox.width / 2;
    const cy = sendBox.top + sendBox.height / 2;
    const hit = document.elementFromPoint(cx, cy);
    expect(hit).toBeTruthy();
    expect(sendBtn!.contains(hit) || hit === sendBtn).toBe(true);

    sendBtn!.click();
    expect(onSend).toHaveBeenCalledOnce();
  });
});
