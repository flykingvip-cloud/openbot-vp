// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";
import { render } from "lit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../../i18n/index.ts";
import { setCachedClipboardPermission } from "../account-computer/desktop-clipboard.ts";
import {
  getActiveTakeoverEpisode,
  listTakeoverSkillDrafts,
} from "../account-computer/desktop-takeover-learning.ts";
import type { SessionsListResult } from "../types.ts";
import {
  accountComputerKey,
  applyServerComputerPreview,
  attachComputerSession,
  adoptComputerAccount,
  rememberComputerAccount,
  beginAgentComputerUse,
  resolveComputerOperatorDisplay,
  computerPreviewNeedsInputClaim,
  computerPreviewNeedsOpen,
  computerPreviewOpenPlan,
  computerSessionRequestsInput,
  COMPUTER_FULLSCREEN_CHAT_BASIS,
  computerMainFlex,
  defaultComputerPreviewModel,
  noteBrowserComputerUse,
  messageTriggersComputerPreview,
  syncComputerPreviewFromMessages,
  messageClaimsAccountComputer,
  computerPreviewNeedsStreamRetry,
  scheduleComputerPreviewStreamRetry,
  clearComputerPreviewStreamRetries,
  renderComputerPreviewBody,
  readComputerPreviewModel,
  resetAccountComputerPreviewForTests,
  expireComputerConnectingHoldForTests,
  resolveAccountComputerAccount,
  selectArtifactPreviewSurface,
  selectComputerChip,
  selectComputerSurface,
  setComputerPreviewSize,
  takeoverComputerPreview,
  handBackComputerPreview,
  resetComputerPreviewHandbackForTests,
  noteComputerDesktopSessionAnomaly,
  advanceComputerDesktopInteractiveForTests,
  noteComputerPreviewStreamError,
  noteComputerRemotePageUrl,
  reconnectComputerDesktopSession,
  COMPUTER_PREVIEW_CONTROL_SOURCE,
  computerShowDesktopFrame,
  postComputerShowDesktop,
  rotateComputerPreviewStreamCredential,
  isNovncInvalidOrExpiredTokenDocument,
  NOVNC_INVALID_OR_EXPIRED_TOKEN,
  DESKTOP_POST_TAKEOVER_INPUT_LANDING,
  syncComputerPreviewAfterSessionSwitch,
  type ComputerPreviewChrome,
} from "./account-computer-preview.ts";
import { renderChat, type ChatProps } from "./chat.ts";

const STREAM = "https://gateway.example/sandbox/novnc?token=preview-token";
const STREAM_B = "https://gateway.example/sandbox/novnc?token=preview-token-b";

function createHost(sessionKey = "agent-a"): ComputerPreviewChrome {
  return {
    sidebarOpen: false,
    sidebarSurface: "artifact",
    computerPreviewSize: "docked",
    computerNarrowChat: false,
    computerPreviewRevision: 0,
    sessionKey,
    assistantName: "Ada",
  };
}

function createProps(overrides: Partial<ChatProps> = {}): ChatProps {
  const sessions: SessionsListResult = {
    ts: 0,
    path: "",
    count: 0,
    defaults: { model: null, contextTokens: null },
    sessions: [],
  };
  return {
    sessionKey: "agent-a",
    onSessionKeyChange: () => undefined,
    thinkingLevel: null,
    showThinking: false,
    loading: false,
    sending: false,
    compactionStatus: null,
    fallbackStatus: null,
    messages: [],
    toolMessages: [],
    streamSegments: [],
    stream: null,
    streamStartedAt: null,
    draft: "",
    queue: [],
    connected: true,
    canSend: true,
    disabledReason: null,
    error: null,
    sessions,
    focusMode: false,
    assistantName: "Ada",
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

function paint(
  container: HTMLElement,
  host: ComputerPreviewChrome,
  props: Partial<ChatProps> = {},
) {
  const model = readComputerPreviewModel(host, { tenantId: "tenant-1", userId: "user-1" });
  const onClose = vi.fn();
  const onEnd = vi.fn();
  render(
    renderChat(
      createProps({
        sessionKey: host.sessionKey,
        sidebarOpen: host.sidebarOpen,
        sidebarContent: "handoff notes",
        onCloseSidebar: onClose,
        computerPreview: model,
        onComputerSelectSurface: (surface) => selectComputerSurface(host, surface),
        onComputerSetSize: (size) => setComputerPreviewSize(host, size),
        onComputerTakeover: () => takeoverComputerPreview(host, "You"),
        onComputerHandBack: () => handBackComputerPreview(host),
        onComputerEnd: onEnd,
        onComputerChip: () => selectComputerChip(host),
        onComputerNarrowReturn: () => {
          host.computerNarrowChat = true;
        },
        ...props,
      }),
    ),
    container,
  );
  return { model, onClose, onEnd };
}

describe("account computer preview §5.3", () => {
  let container: HTMLElement;

  beforeEach(() => {
    resetComputerPreviewHandbackForTests();
    resetAccountComputerPreviewForTests();
    container = document.createElement("div");
    document.body.append(container);
  });

  afterEach(() => {
    container.remove();
  });

  it("shows only one tab body and keeps the computer frame off the artifact iframe", () => {
    const host = createHost();
    beginAgentComputerUse(host, "Ada");
    applyServerComputerPreview({
      tenantId: "tenant-1",
      userId: "user-1",
      sessionKey: host.sessionKey,
      action: "open",
      status: "READY",
      streamUrl: STREAM,
      controlledBy: { kind: "agent", label: "Ada" },
    });
    expireComputerConnectingHoldForTests();
    paint(container, host);

    const artifact = container.querySelector(".sidebar-body--artifact");
    const computer = container.querySelector(".sidebar-body--computer");
    expect(artifact).toBeTruthy();
    expect(computer).toBeTruthy();
    expect(computer?.hasAttribute("hidden")).toBe(false);
    expect(artifact?.hasAttribute("hidden")).toBe(true);
    expect(
      container.querySelector(".sidebar-body--artifact [data-testid=computer-frame]"),
    ).toBeNull();
    expect(container.querySelector("[data-testid=computer-fullscreen]")?.textContent).toContain(
      t("chat.computerFullscreen"),
    );
    expect(container.querySelector("[data-testid=computer-shrink]")).toBeNull();
    expect(container.querySelector("[data-testid=computer-expand]")).toBeNull();
    expect(container.querySelector("[data-testid=computer-open]")).toBeNull();
    expect(container.querySelector("[data-testid=computer-end]")).toBeNull();
    expect(container.querySelector("[data-testid=computer-back-to-chat]")).toBeNull();
    expect(container.querySelector("[data-testid=computer-takeover]")).toBeTruthy();

    selectArtifactPreviewSurface(host);
    host.sidebarSurface = "artifact";
    paint(container, host);
    expect(container.querySelector(".sidebar-body--computer")?.hasAttribute("hidden")).toBe(true);
    expect(container.querySelector(".sidebar-body--artifact")?.hasAttribute("hidden")).toBe(false);
    expect(container.querySelector("[data-testid=computer-fullscreen]")).toBeNull();
    expect(container.querySelector("[data-testid=computer-frame]")).toBeTruthy();
  });

  it("does not remount the iframe when expanding, filling the screen, or shrinking", () => {
    const host = createHost();
    beginAgentComputerUse(host, "Ada");
    applyServerComputerPreview({
      tenantId: "tenant-1",
      userId: "user-1",
      sessionKey: host.sessionKey,
      action: "open",
      status: "READY",
      streamUrl: STREAM,
      controlledBy: { kind: "agent", label: "Ada" },
    });
    expireComputerConnectingHoldForTests();
    paint(container, host);
    const frame = container.querySelector("[data-testid=computer-frame]");
    expect(frame).toBeInstanceOf(HTMLIFrameElement);
    const generation = frame?.getAttribute("data-mount-generation");
    const connectionId = frame?.getAttribute("data-connection-id");

    setComputerPreviewSize(host, "expanded");
    paint(container, host);
    expect(container.querySelector(".chat-split-container")?.className).toContain(
      "chat-split-container--computer-expanded",
    );
    setComputerPreviewSize(host, "fullscreen");
    paint(container, host);
    expect(container.querySelector(".chat-split-container")?.className).toContain(
      "chat-split-container--computer-fullscreen",
    );
    setComputerPreviewSize(host, "docked");
    paint(container, host);

    const again = container.querySelector("[data-testid=computer-frame]");
    expect(again).toBe(frame);
    expect(again?.getAttribute("src")).toBe(STREAM);
    expect(again?.getAttribute("data-mount-generation")).toBe(generation);
    expect(again?.getAttribute("data-connection-id")).toBe(connectionId);
    expect(container.querySelector(".chat-split-container")?.className).toContain(
      "chat-split-container--computer-docked",
    );
    const model = readComputerPreviewModel(host, { tenantId: "tenant-1", userId: "user-1" });
    expect(model.streamUrl).toBe(STREAM);
    expect(model.controlsDesktop).toBe(false);
    expect(model.userTakeover).toBe(false);
    expect(model.operator).toEqual({ kind: "agent", label: "Ada" });

    selectComputerSurface(host, "artifact");
    paint(container, host);
    selectComputerSurface(host, "computer");
    paint(container, host);
    expect(container.querySelector("[data-testid=computer-frame]")).toBe(frame);
    expect(container.querySelector("[data-testid=computer-frame]")?.getAttribute("src")).toBe(
      STREAM,
    );
  });

  it("keeps an existing input grant when the picture is resized", () => {
    const host = createHost();
    beginAgentComputerUse(host, "Ada");
    applyServerComputerPreview({
      tenantId: "tenant-1",
      userId: "user-1",
      sessionKey: host.sessionKey,
      action: "open",
      status: "READY",
      streamUrl: STREAM,
      grantsInput: true,
      controlledBy: { kind: "user", label: "You" },
    });
    expireComputerConnectingHoldForTests();
    takeoverComputerPreview(host, "You");
    paint(container, host);
    const frame = container.querySelector("[data-testid=computer-frame]");

    setComputerPreviewSize(host, "expanded");
    paint(container, host);
    setComputerPreviewSize(host, "fullscreen");
    paint(container, host);

    const model = readComputerPreviewModel(host, { tenantId: "tenant-1", userId: "user-1" });
    expect(model.streamUrl).toBe(STREAM);
    expect(model.controlsDesktop).toBe(true);
    expect(model.userTakeover).toBe(true);
    const again = container.querySelector("[data-testid=computer-frame]");
    expect(again).toBe(frame);
    expect(again?.getAttribute("src")).toBe(STREAM);
    expect(container.querySelector(".chat-split-container")?.className).toContain(
      "chat-split-container--computer-fullscreen",
    );
  });

  it("does not open a new preview when the size handler runs", () => {
    const source = readFileSync(path.resolve("ui/src/ui/app-render.ts"), "utf8");
    const start = source.indexOf("onComputerSetSize:");
    const end = source.indexOf("onComputerTakeover:");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const block = source.slice(start, end);
    expect(block).toContain("setComputerPreviewSize");
    expect(block).not.toContain("refreshAccountComputerPreview");
    const selectStart = source.indexOf("onComputerSelectSurface:");
    const selectEnd = source.indexOf("onComputerSetSize:");
    expect(selectStart).toBeGreaterThan(-1);
    expect(selectEnd).toBeGreaterThan(selectStart);
    const selectBlock = source.slice(selectStart, selectEnd);
    expect(selectBlock).toContain("computerPreviewNeedsOpen");
    expect(selectBlock).toContain("computerPreviewNeedsInputClaim");
    expect(selectBlock).toContain("formLocked: Boolean(state.secureFormOffered)");
  });

  it("hides the panel without ending the computer, and the chip only selects the tab", () => {
    const host = createHost();
    beginAgentComputerUse(host, "Ada");
    applyServerComputerPreview({
      tenantId: "tenant-1",
      userId: "user-1",
      sessionKey: host.sessionKey,
      action: "open",
      status: "READY",
      streamUrl: STREAM,
      controlledBy: { kind: "agent", label: "Ada" },
    });
    expireComputerConnectingHoldForTests();
    const first = paint(container, host);
    const frame = container.querySelector("[data-testid=computer-frame]");
    host.sidebarOpen = false;
    const closed = paint(container, host);
    expect(closed.onEnd).not.toHaveBeenCalled();
    expect(first.onClose).not.toHaveBeenCalled();
    expect(container.querySelector("[data-testid=computer-frame]")).toBe(frame);
    expect(container.querySelector(".chat-sidebar--parked")).toBeTruthy();
    expect(readComputerPreviewModel(host, { tenantId: "tenant-1", userId: "user-1" }).ended).toBe(
      false,
    );

    host.sidebarOpen = true;
    host.sidebarSurface = "artifact";
    host.computerPreviewSize = "expanded";
    paint(container, host);
    const chip = container.querySelector("[data-testid=computer-using-chip]");
    expect(chip?.textContent).toContain(t("chat.computerUsing"));
    chip?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(host.sidebarSurface).toBe("computer");
    expect(host.computerPreviewSize).toBe("expanded");
  });

  it("reuses one connection for a second agent of the same user", () => {
    const first = attachComputerSession({
      tenantId: "tenant-1",
      userId: "user-1",
      sessionKey: "agent-a",
      agentLabel: "Ada",
    });
    applyServerComputerPreview({
      tenantId: "tenant-1",
      userId: "user-1",
      sessionKey: "agent-a",
      action: "open",
      status: "READY",
      streamUrl: STREAM,
      controlledBy: { kind: "agent", label: "Ada" },
    });
    expireComputerConnectingHoldForTests();
    applyServerComputerPreview({
      tenantId: "tenant-1",
      userId: "user-1",
      sessionKey: "agent-b",
      action: "open",
      status: "READY",
      streamUrl: STREAM_B,
      controlledBy: { kind: "agent", label: "Ada" },
    });
    const second = attachComputerSession({
      tenantId: "tenant-1",
      userId: "user-1",
      sessionKey: "agent-b",
      agentLabel: "Bea",
    });
    expireComputerConnectingHoldForTests();
    const other = attachComputerSession({
      tenantId: "tenant-1",
      userId: "user-2",
      sessionKey: "agent-c",
      agentLabel: "Cy",
    });
    expect(second.created).toBe(false);
    expect(second.connectionId).toBe(first.connectionId);
    expect(second.streamUrl).toBe(STREAM_B);
    expect(second.ownsFrame).toBe(true);
    expect(other.connectionId).not.toBe(first.connectionId);
    expect(other.created).toBe(true);

    const hostA = createHost("agent-a");
    hostA.sidebarOpen = true;
    hostA.sidebarSurface = "computer";
    const hostB = createHost("agent-b");
    hostB.sidebarOpen = true;
    hostB.sidebarSurface = "computer";
    const account = { tenantId: "tenant-1", userId: "user-1" };
    const boxA = document.createElement("div");
    const boxB = document.createElement("div");
    container.append(boxA, boxB);
    const paintOne = (box: HTMLElement, host: ComputerPreviewChrome) => {
      render(
        renderChat(
          createProps({
            sessionKey: host.sessionKey,
            sidebarOpen: true,
            onCloseSidebar: () => undefined,
            computerPreview: readComputerPreviewModel(host, account),
          }),
        ),
        box,
      );
    };
    paintOne(boxA, hostA);
    paintOne(boxB, hostB);
    const frameA = boxA.querySelector("[data-testid=computer-frame]");
    const frameB = boxB.querySelector("[data-testid=computer-frame]");
    expect(frameA?.getAttribute("src")).toBe(STREAM);
    expect(frameB?.getAttribute("src")).toBe(STREAM_B);
    expect(frameA?.getAttribute("data-connection-id")).toBe(first.connectionId);
    expect(frameB?.getAttribute("data-connection-id")).toBe(first.connectionId);
    expect(boxA.querySelector("[data-testid=computer-status]")).toBeNull();
    expect(boxB.querySelector("[data-testid=computer-status]")).toBeNull();
    expect(boxA.querySelector("[data-testid=computer-operator]")?.textContent).toContain("Ada");
    expect(boxB.querySelector("[data-testid=computer-operator]")?.textContent).toContain("Ada");
    expect(frameB?.hasAttribute("inert")).toBe(true);

    takeoverComputerPreview(hostB, "You");
    advanceComputerDesktopInteractiveForTests(hostB.sessionKey);
    paintOne(boxA, hostA);
    paintOne(boxB, hostB);
    // Takeover keeps open-bot chrome (Ada), never computerYou 「你」/「You」.
    expect(boxA.querySelector("[data-testid=computer-operator]")?.textContent).toContain("Ada");
    expect(boxB.querySelector("[data-testid=computer-operator]")?.textContent).toContain("Ada");
    expect(boxA.querySelector("[data-testid=computer-operator]")?.textContent).not.toContain("You");
    expect(boxB.querySelector("[data-testid=computer-operator]")?.textContent).not.toContain("You");
    expect(boxA.querySelector("[data-testid=computer-operator]")?.textContent).not.toContain("Bea");
    expect(boxB.querySelector("[data-testid=computer-frame]")?.hasAttribute("inert")).toBe(false);
    expect(boxA.querySelector("[data-testid=computer-frame]")?.hasAttribute("inert")).toBe(true);
    expect(boxA.querySelector("[data-testid=computer-frame]")?.getAttribute("src")).toBe(STREAM);
    expect(boxB.querySelector("[data-testid=computer-frame]")?.getAttribute("src")).toBe(STREAM_B);
  });

  it("shows the server user who holds the input grant", () => {
    const host = createHost();
    beginAgentComputerUse(host, "Ada");
    applyServerComputerPreview({
      tenantId: "tenant-1",
      userId: "user-1",
      sessionKey: host.sessionKey,
      action: "open",
      status: "READY",
      streamUrl: STREAM,
      controlledBy: { kind: "user", label: "90fed19a-1c8b-4420-87e0-bcc6165e32fa" },
    });
    expireComputerConnectingHoldForTests();
    paint(container, host);
    expect(container.querySelector("[data-testid=computer-status]")).toBeNull();
    expect(container.querySelector(".computer-preview__status")).toBeNull();
    // Operator chrome always names the open bot, even when a user holds input.
    expect(container.querySelector("[data-testid=computer-operator]")?.textContent).toContain(
      "Ada",
    );
    expect(container.querySelector("[data-testid=computer-operator]")?.textContent).not.toContain(
      t("chat.computerYou"),
    );
    expect(container.querySelector("[data-testid=computer-operator]")?.textContent).not.toContain(
      "90fed19a",
    );

    applyServerComputerPreview({
      tenantId: "tenant-1",
      userId: "user-1",
      sessionKey: host.sessionKey,
      action: "status",
      status: "READY",
      controlledBy: { kind: "user", label: "Mina" },
    });
    expireComputerConnectingHoldForTests();
    paint(container, host);
    expect(container.querySelector("[data-testid=computer-operator]")?.textContent).toContain(
      "Ada",
    );
    expect(container.querySelector("[data-testid=computer-operator]")?.textContent).not.toContain(
      "Mina",
    );
  });

  it("renders CONTROLLED_BY and keeps docked keyboard in chat until take-over", () => {
    const host = createHost();
    beginAgentComputerUse(host, "Ada");
    applyServerComputerPreview({
      tenantId: "tenant-1",
      userId: "user-1",
      sessionKey: host.sessionKey,
      action: "open",
      status: "READY",
      streamUrl: STREAM,
      controlledBy: { kind: "agent", label: "Ada" },
    });
    expireComputerConnectingHoldForTests();
    paint(container, host);
    expect(container.querySelector("[data-testid=computer-status]")).toBeNull();
    expect(container.querySelector(".computer-preview__status")).toBeNull();
    expect(container.querySelector("[data-testid=computer-operator]")?.textContent).toContain(
      "Ada",
    );
    const frame = container.querySelector("[data-testid=computer-frame]");
    expect(frame?.hasAttribute("inert")).toBe(true);
    expect(
      container.querySelector(".chat-split-container")?.getAttribute("data-keyboard-target"),
    ).toBe("chat");

    container
      .querySelector("[data-testid=computer-takeover]")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    advanceComputerDesktopInteractiveForTests(host.sessionKey);
    paint(container, host);
    const taken = container.querySelector("[data-testid=computer-operator]");
    expect(taken?.getAttribute("data-operator-kind")).toBe("agent");
    expect(taken?.textContent).toContain("Ada");
    expect(taken?.textContent).not.toContain("You");
    expect(container.querySelector("[data-testid=computer-frame]")?.hasAttribute("inert")).toBe(
      false,
    );
    expect(
      container.querySelector(".chat-split-container")?.getAttribute("data-keyboard-target"),
    ).toBe("desktop");
  });

  it("swaps takeover for handback while the user controls the desktop", () => {
    const host = createHost();
    beginAgentComputerUse(host, "Ada");
    applyServerComputerPreview({
      tenantId: "tenant-1",
      userId: "user-1",
      sessionKey: host.sessionKey,
      action: "open",
      status: "READY",
      streamUrl: STREAM,
      controlledBy: { kind: "agent", label: "Ada" },
    });
    expireComputerConnectingHoldForTests();
    paint(container, host);
    expect(container.querySelector("[data-testid=computer-takeover]")).toBeTruthy();
    expect(container.querySelector("[data-testid=computer-handback]")).toBeNull();

    takeoverComputerPreview(host, "You");
    paint(container, host);
    expect(container.querySelector("[data-testid=computer-handback]")).toBeTruthy();
    expect(container.querySelector("[data-testid=computer-takeover]")).toBeNull();
    expect(container.querySelector("[data-testid=computer-handback]")?.textContent).toContain(
      t("chat.computerHandBack"),
    );

    container
      .querySelector("[data-testid=computer-handback]")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    paint(container, host);
    const model = readComputerPreviewModel(host, { tenantId: "tenant-1", userId: "user-1" });
    expect(model.userTakeover).toBe(false);
    expect(model.controlsDesktop).toBe(false);
    expect(model.operator?.kind).toBe("agent");
    expect(container.querySelector("[data-testid=computer-takeover]")).toBeTruthy();
    expect(container.querySelector("[data-testid=computer-handback]")).toBeNull();
  });

  it("renders each formal status and shrinks fullscreen on Escape", () => {
    const host = createHost();
    const cases = ["STARTING", "READY", "REAUTH_REQUIRED", "DISCONNECTED"] as const;
    beginAgentComputerUse(host, "Ada");
    for (const status of cases) {
      applyServerComputerPreview({
        tenantId: "tenant-1",
        userId: "user-1",
        sessionKey: host.sessionKey,
        action: status === "DISCONNECTED" ? "end" : "status",
        status,
        streamUrl: status === "READY" || status === "REAUTH_REQUIRED" ? STREAM : null,
        controlledBy: status === "READY" ? { kind: "agent", label: "Ada" } : null,
      });
      expireComputerConnectingHoldForTests();
      if (status === "DISCONNECTED") {
        host.sidebarOpen = true;
        host.sidebarSurface = "computer";
      }
      paint(container, host);
      expect(container.querySelector("[data-testid=computer-status]")).toBeNull();
      expect(container.querySelector(".computer-preview__status")).toBeNull();
    }

    applyServerComputerPreview({
      tenantId: "tenant-1",
      userId: "user-1",
      sessionKey: host.sessionKey,
      action: "open",
      status: "READY",
      streamUrl: STREAM,
      controlledBy: { kind: "agent", label: "Ada" },
    });
    expireComputerConnectingHoldForTests();
    host.sidebarOpen = true;
    host.sidebarSurface = "computer";
    setComputerPreviewSize(host, "fullscreen");
    paint(container, host);
    container
      .querySelector(".chat-split-container")
      ?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(host.computerPreviewSize).toBe("docked");
  });

  it("returns to chat on a narrow screen without dropping the stream", () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const host = createHost();
    beginAgentComputerUse(host, "Ada");
    applyServerComputerPreview({
      tenantId: "tenant-1",
      userId: "user-1",
      sessionKey: host.sessionKey,
      action: "open",
      status: "READY",
      streamUrl: STREAM,
      controlledBy: { kind: "agent", label: "Ada" },
    });
    expireComputerConnectingHoldForTests();
    const model = readComputerPreviewModel(
      host,
      { tenantId: "tenant-1", userId: "user-1" },
      {
        forceNarrow: true,
      },
    );
    render(
      renderChat(
        createProps({
          sidebarOpen: true,
          onCloseSidebar: () => undefined,
          computerPreview: { ...model, forceNarrow: true },
          onComputerNarrowReturn: () => {
            host.computerNarrowChat = true;
          },
        }),
      ),
      container,
    );
    expect(container.querySelector("[data-testid=computer-back-to-chat]")).toBeNull();
    expect(container.querySelector("[data-testid=computer-end]")).toBeNull();
    expect(container.querySelector("[data-testid=computer-open]")).toBeNull();
    expect(container.querySelector(".sidebar-header__close")).toBeTruthy();
    expect(host.computerNarrowChat).toBe(false);
    expect(host.sidebarOpen).toBe(true);
    expect(
      readComputerPreviewModel(host, { tenantId: "tenant-1", userId: "user-1" }).streamUrl,
    ).toBe(STREAM);
    expect(open).not.toHaveBeenCalled();
    open.mockRestore();
  });

  it("attaches the picture after a signed-in open using the platform user id, not the email", () => {
    const email = "ada@example.com";
    const platformUserId = "90fed19a-1c8b-4420-87e0-bcc6165e32fa";
    expect(
      resolveAccountComputerAccount({
        tenantId: "tenant-1",
        employeeUserId: email,
      }),
    ).toBeNull();
    const account = resolveAccountComputerAccount({
      tenantId: "tenant-1",
      employeeUserId: platformUserId,
    });
    expect(account).toEqual({ tenantId: "tenant-1", userId: platformUserId });

    const host = createHost("agent-a");
    beginAgentComputerUse(host, "Ada");
    applyServerComputerPreview({
      tenantId: "tenant-1",
      userId: platformUserId,
      sessionKey: host.sessionKey,
      action: "open",
      status: "READY",
      streamUrl: STREAM,
      controlledBy: { kind: "agent", label: "Ada" },
    });
    expireComputerConnectingHoldForTests();
    const model = readComputerPreviewModel(host, account);
    expect(model.streamUrl).toBe(STREAM);
    expect(model.ownsFrame).toBe(true);
    expect(
      readComputerPreviewModel(host, { tenantId: "tenant-1", userId: email }).streamUrl,
    ).toBeNull();
    const attached = readComputerPreviewModel(host, account);
    render(
      renderChat(
        createProps({
          sidebarOpen: true,
          onCloseSidebar: () => undefined,
          computerPreview: attached,
        }),
      ),
      container,
    );
    expect(container.querySelector("[data-testid=computer-frame]")?.getAttribute("src")).toBe(
      STREAM,
    );
  });

  it("attaches the server user id when employeeAccess has not hydrated", () => {
    expect(
      resolveAccountComputerAccount({
        tenantId: "tenant-1",
        employeeUserId: undefined,
      }),
    ).toBeNull();
    const platformUserId = "90fed19a-1c8b-4420-87e0-bcc6165e32fa";
    const host = createHost("agent-a");
    beginAgentComputerUse(host, "Ada");
    applyServerComputerPreview({
      tenantId: "tenant-1",
      userId: platformUserId,
      sessionKey: host.sessionKey,
      action: "open",
      status: "READY",
      streamUrl: STREAM,
      controlledBy: { kind: "agent", label: "Ada" },
    });
    expireComputerConnectingHoldForTests();
    const model = readComputerPreviewModel(host, null);
    expect(model.streamUrl).toBe(STREAM);
    expect(model.ownsFrame).toBe(true);
    expect(
      readComputerPreviewModel(host, { tenantId: "tenant-1", userId: "ada@example.com" }).streamUrl,
    ).toBeNull();
  });

  it("opens the docked computer tab when an agent starts a browser tool", () => {
    const host = createHost();
    const noted = noteBrowserComputerUse(host, {
      toolName: "browser",
      senderLabel: "Ada",
    });
    expect(noted).toBe(true);
    expect(host.sidebarOpen).toBe(true);
    expect(host.sidebarSurface).toBe("computer");
    expect(host.computerPreviewSize).toBe("docked");
    const model = readComputerPreviewModel(host, { tenantId: "tenant-1", userId: "user-1" });
    expect(model.showChip).toBe(true);
    expect(model.formalStatus).toBe("STARTING");
  });

  it("shows connecting (not a white stage) while STARTING without streamUrl", () => {
    const host = createHost();
    beginAgentComputerUse(host, "Ada");
    const model = readComputerPreviewModel(host, { tenantId: "tenant-1", userId: "user-1" });
    expect(model.formalStatus).toBe("STARTING");
    expect(model.streamUrl).toBeNull();
    expect(computerPreviewNeedsStreamRetry(model)).toBe(true);
    const body = document.createElement("div");
    // render into isolated node via paint path
    host.sidebarOpen = true;
    host.sidebarSurface = "computer";
    paint(container, host, { assistantName: "Ada" });
    expect(container.querySelector("[data-testid=computer-connecting]")).toBeTruthy();
    expect(container.querySelector("[data-testid=computer-frame]")).toBeNull();
    expect(container.querySelector("[data-testid=computer-cold]")).toBeNull();
    void body;
    void renderComputerPreviewBody;
  });

  it("sets a clear gave-up error after stream retries are exhausted (no permanent connecting)", () => {
    vi.useFakeTimers();
    const host = createHost();
    const sync = vi.fn();
    (host as { syncAccountComputerPreview?: () => void }).syncAccountComputerPreview = sync;
    beginAgentComputerUse(host, "Ada");
    scheduleComputerPreviewStreamRetry(
      host as ComputerPreviewChrome & { syncAccountComputerPreview?: () => void },
      { reset: true },
    );
    // Drain every scheduled delay in STREAM_RETRY_DELAYS_MS (7 attempts).
    for (let i = 0; i < 8; i += 1) {
      vi.runOnlyPendingTimers();
    }
    const model = readComputerPreviewModel(host, { tenantId: "tenant-1", userId: "user-1" });
    expect(model.previewError).toBe("gave-up");
    paint(container, host, { assistantName: "Ada" });
    const connecting = container.querySelector("[data-testid=computer-connecting]");
    expect(connecting?.getAttribute("data-preview-error")).toBe("true");
    expect(connecting?.textContent).toContain(t("chat.computerConnectGaveUp"));
    expect(container.querySelector("[data-testid=computer-frame]")).toBeNull();
    clearComputerPreviewStreamRetries();
    vi.useRealTimers();
  });

  it("holds connecting UI for a minimum time even when streamUrl is already ready", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-08T17:00:00+08:00"));
    const host = createHost();
    beginAgentComputerUse(host, "Ada");
    applyServerComputerPreview({
      tenantId: "tenant-1",
      userId: "user-1",
      sessionKey: host.sessionKey,
      action: "open",
      status: "READY",
      streamUrl: STREAM,
      controlledBy: { kind: "agent", label: "Ada" },
    });
    const mid = readComputerPreviewModel(host, { tenantId: "tenant-1", userId: "user-1" });
    expect(mid.streamUrl).toBeNull();
    expect(mid.formalStatus).toBe("STARTING");
    paint(container, host, { assistantName: "Ada" });
    expect(container.querySelector("[data-testid=computer-connecting]")?.textContent).toContain(
      t("chat.computerConnectingWaitingPicture"),
    );
    expect(container.querySelector("[data-testid=computer-frame]")).toBeNull();
    vi.advanceTimersByTime(950);
    const after = readComputerPreviewModel(host, { tenantId: "tenant-1", userId: "user-1" });
    expect(after.streamUrl).toBe(STREAM);
    paint(container, host, { assistantName: "Ada" });
    expect(container.querySelector("[data-testid=computer-frame]")).toBeTruthy();
    vi.useRealTimers();
  });

  it("does not open 电脑 from history unless forceOpen (session switch vs hard refresh)", () => {
    const history = [
      {
        role: "assistant",
        toolName: "browser",
        content: [{ type: "text", text: "我已经在云电脑里打开京东了，电脑 Tab 可见。" }],
        senderLabel: "Ada",
      },
    ];
    expect(messageClaimsAccountComputer(history[0])).toBe(true);
    expect(messageTriggersComputerPreview(history[0])).toBe(true);

    const switched = createHost();
    switched.sidebarOpen = false;
    switched.sidebarSurface = "artifact";
    const revision = switched.computerPreviewRevision;
    const sync = vi.fn();
    (switched as { syncAccountComputerPreview?: () => void }).syncAccountComputerPreview = sync;
    expect(syncComputerPreviewFromMessages(switched, history)).toBe(false);
    expect(switched.sidebarOpen).toBe(false);
    expect(switched.sidebarSurface).toBe("artifact");
    expect(switched.computerPreviewRevision).toBe(revision);
    expect(sync).not.toHaveBeenCalled();

    switched.sidebarOpen = true;
    switched.sidebarSurface = "artifact";
    expect(syncComputerPreviewFromMessages(switched, history)).toBe(false);
    expect(switched.sidebarOpen).toBe(true);
    expect(switched.sidebarSurface).toBe("artifact");

    const refreshed = createHost();
    refreshed.sidebarOpen = false;
    refreshed.sidebarSurface = "artifact";
    (refreshed as { syncAccountComputerPreview?: () => void }).syncAccountComputerPreview = sync;
    expect(syncComputerPreviewFromMessages(refreshed, history, { forceOpen: true })).toBe(true);
    expect(refreshed.sidebarOpen).toBe(true);
    expect(refreshed.sidebarSurface).toBe("computer");
    expect(sync).toHaveBeenCalled();
  });

  it("shows a docker CLI failure instead of the cold black stage", () => {
    const host = createHost();
    host.sidebarOpen = true;
    host.sidebarSurface = "computer";
    applyServerComputerPreview({
      tenantId: "tenant-1",
      userId: "user-1",
      sessionKey: host.sessionKey,
      action: "open",
      status: "COLD",
      failure: "云电脑没有启动：网关里没有 docker 命令（DOCKER_CLI_MISSING）。",
    });
    const model = readComputerPreviewModel(host, { tenantId: "tenant-1", userId: "user-1" });
    render(renderComputerPreviewBody(model), container);
    expect(container.querySelector("[data-testid=computer-cold]")).toBeNull();
    expect(container.querySelector("[data-testid=computer-connecting]")?.textContent).toContain(
      "DOCKER_CLI_MISSING",
    );
  });

  it("keeps the operator mark and drops redundant computer chrome", () => {
    const host = createHost();
    host.sidebarOpen = true;
    host.sidebarSurface = "computer";
    paint(container, host, {
      assistantName: "Ada",
      assistantAvatar: "A",
    });

    const stage = container.querySelector("[data-testid=computer-stage]");
    expect(stage?.querySelector("button")).toBeNull();
    expect(stage?.querySelector("[data-testid=computer-frame]")).toBeNull();
    expect(stage?.querySelector("[data-testid=computer-cold]")?.textContent).toContain(
      t("chat.computerCold"),
    );
    expect(container.querySelector(".computer-preview__footer")).toBeNull();
    expect(container.querySelector(".sidebar-title")).toBeNull();

    const removed = [
      "computer-open",
      "computer-back-to-chat",
      "computer-end",
      "computer-expand",
      "computer-shrink",
    ];
    for (const testId of removed) {
      expect(container.querySelector(`[data-testid=${testId}]`)).toBeNull();
    }
    const fullscreen = container.querySelector("[data-testid=computer-fullscreen]");
    expect(fullscreen?.closest(".computer-chrome-actions")).toBeTruthy();
    expect(fullscreen?.textContent).toContain(t("chat.computerFullscreen"));
    expect(fullscreen?.textContent).not.toContain(t("chat.computerShrink"));
    expect(
      container
        .querySelector("[data-testid=computer-takeover]")
        ?.closest(".computer-chrome-actions"),
    ).toBeTruthy();
    expect(
      container.querySelector("[data-testid=computer-takeover]")?.hasAttribute("disabled"),
    ).toBe(false);
    expect(container.querySelector(".sidebar-header__close")).toBeTruthy();

    const coldOperator = container.querySelector("[data-testid=computer-operator]");
    expect(coldOperator?.getAttribute("data-operator-kind")).toBe("agent");
    expect(coldOperator?.textContent).toContain("Ada");
    expect(coldOperator?.querySelector("[data-testid=computer-operator-avatar]")?.textContent).toBe(
      "A",
    );

    beginAgentComputerUse(host, "Ada");
    paint(container, host, {
      assistantName: "Ada",
      assistantAvatar: "A",
    });
    expect(container.querySelector("[data-testid=computer-open]")).toBeNull();
    expect(container.querySelector("[data-testid=computer-end]")).toBeNull();
    expect(container.querySelector("[data-testid=computer-stage]")?.querySelector("button")).toBe(
      null,
    );
    expect(container.querySelector("[data-testid=computer-cold]")).toBeNull();
    const connectingText =
      container.querySelector("[data-testid=computer-connecting]")?.textContent ?? "";
    expect(
      connectingText.includes(t("chat.computerConnectingChannel")) ||
        connectingText.includes(t("chat.computerConnectingOpening")) ||
        connectingText.includes(t("chat.computerConnecting")),
    ).toBe(true);
    expect(container.querySelector("[data-testid=computer-frame]")).toBeNull();
    expect(
      container.querySelector("[data-testid=computer-takeover]")?.hasAttribute("disabled"),
    ).toBe(false);

    applyServerComputerPreview({
      tenantId: "tenant-1",
      userId: "user-1",
      sessionKey: host.sessionKey,
      action: "open",
      status: "READY",
      streamUrl: STREAM,
      controlledBy: { kind: "agent", label: "Ada" },
    });
    expireComputerConnectingHoldForTests();
    paint(container, host, {
      assistantName: "Ada",
      assistantAvatar: "https://cdn.example/ada.png",
    });
    const liveStage = container.querySelector("[data-testid=computer-stage]");
    expect(liveStage?.querySelector("button")).toBeNull();
    expect(liveStage?.querySelector("[data-testid=computer-frame]")).toBeTruthy();
    expect(liveStage?.querySelector("[data-testid=computer-cold]")).toBeNull();
    expect(container.querySelector("[data-testid=computer-open]")).toBeNull();
    expect(container.querySelector("[data-testid=computer-end]")).toBeNull();
    expect(container.querySelector("[data-testid=computer-operator-avatar]")).toBeInstanceOf(
      HTMLImageElement,
    );
    expect(
      container.querySelector("[data-testid=computer-operator-avatar]")?.getAttribute("src"),
    ).toBe("https://cdn.example/ada.png");

    applyServerComputerPreview({
      tenantId: "tenant-1",
      userId: "user-1",
      sessionKey: host.sessionKey,
      action: "status",
      status: "READY",
      streamUrl: STREAM,
      controlledBy: { kind: "agent", label: "Bea" },
    });
    expireComputerConnectingHoldForTests();
    paint(container, host, {
      assistantName: "Ada",
      assistantAvatar: "https://cdn.example/ada.png",
    });
    const otherAgent = container.querySelector("[data-testid=computer-operator]");
    // Open conversation bot stays on the pill even if another agent id is on the desktop.
    expect(otherAgent?.textContent).toContain("Ada");
    expect(otherAgent?.textContent).not.toContain("Bea");
    expect(
      otherAgent?.querySelector("[data-testid=computer-operator-avatar]")?.getAttribute("src"),
    ).toBe("https://cdn.example/ada.png");

    takeoverComputerPreview(host, "90fed19a-1c8b-4420-87e0-bcc6165e32fa");
    paint(container, host, {
      assistantName: "Ada",
      assistantAvatar: "https://cdn.example/ada.png",
    });
    const userOperator = container.querySelector("[data-testid=computer-operator]");
    // Takeover keeps open-bot chrome; 交还 remains.
    expect(userOperator?.getAttribute("data-operator-kind")).toBe("agent");
    expect(userOperator?.textContent).toContain("Ada");
    expect(userOperator?.textContent).not.toContain(t("chat.computerYou"));
    expect(userOperator?.textContent).not.toContain("90fed19a");
    expect(userOperator?.querySelector("img")).toBeTruthy();
    expect(container.querySelector("[data-testid=computer-handback]")).toBeTruthy();
    expect(container.querySelector("[data-testid=computer-takeover]")).toBeNull();
    expect(
      container.querySelector("[data-testid=computer-handback]")?.hasAttribute("disabled"),
    ).toBe(false);

    const unnamed = createHost();
    unnamed.sidebarOpen = true;
    unnamed.sidebarSurface = "computer";
    resetAccountComputerPreviewForTests();
    paint(container, unnamed, { assistantName: "   ", assistantAvatar: null });
    expect(container.querySelector("[data-testid=computer-operator]")).toBeNull();
    expect(container.querySelector(".sidebar-title")).toBeNull();
    expect(container.querySelector("[data-testid=computer-tab]")?.textContent).toContain(
      t("chat.computerTab"),
    );
  });

  it("names the conversation agent instead of the main agent id", () => {
    const host = createHost();
    host.sidebarOpen = true;
    host.sidebarSurface = "computer";
    beginAgentComputerUse(host, "main");
    applyServerComputerPreview({
      tenantId: "tenant-1",
      userId: "user-1",
      sessionKey: host.sessionKey,
      action: "open",
      status: "READY",
      streamUrl: STREAM,
      controlledBy: { kind: "agent", label: "main" },
    });
    expireComputerConnectingHoldForTests();
    paint(container, host, {
      assistantName: "市场助手",
      assistantAvatar: "市",
    });
    const pill = container.querySelector("[data-testid=computer-operator]");
    expect(pill?.textContent).toContain("市场助手");
    expect(pill?.textContent).not.toContain("main");
    expect(pill?.querySelector("[data-testid=computer-operator-avatar]")?.textContent).toBe("市");
    expect(container.querySelector("[data-testid=computer-status]")).toBeNull();

    const otherOwner = resolveComputerOperatorDisplay(
      { operator: { kind: "agent", label: "main" } },
      { name: "市场助手", agentId: "sales", avatar: "市" },
      [{ id: "main", name: "main", identity: { name: "大白管家", avatar: "大" } }],
    );
    expect(otherOwner).toEqual({ kind: "agent", name: "市场助手", avatar: "市" });

    const takeoverYou = resolveComputerOperatorDisplay(
      { operator: { kind: "user", label: "你" } },
      { name: "大白管家", agentId: "main", avatar: "大" },
      null,
    );
    expect(takeoverYou).toEqual({ kind: "agent", name: "大白管家", avatar: "大" });

    // Rendered pill must not read as 「你 你」 / 「你你」.
    paint(container, host, { assistantName: "大白管家", assistantAvatar: "大" });
    takeoverComputerPreview(host, "你");
    paint(container, host, { assistantName: "大白管家", assistantAvatar: "大" });
    const dabaiPill = container.querySelector("[data-testid=computer-operator]");
    expect(dabaiPill?.textContent).toContain("大白管家");
    expect(dabaiPill?.textContent ?? "").not.toMatch(/你\s*你/);
    expect(dabaiPill?.getAttribute("data-operator-kind")).toBe("agent");
    expect(container.querySelector("[data-testid=computer-handback]")).toBeTruthy();
  });

  it("pins 成果 and 电脑 actions to the same top-right header slot", () => {
    const host = createHost();
    host.sidebarOpen = true;
    host.sidebarSurface = "artifact";
    paint(container, host, {
      sidebarPreviewMode: "artifact",
      artifactWorkspace: {
        artifact: {
          artifactId: "artifact:report",
          title: "WorkBuddy → OpenBot 迁移技能实测（长报告·第二批）",
          artifactType: "document",
          mimeType: "text/markdown",
          textPreview: "正文",
        },
        permissions: { canEdit: true },
      } as unknown as ChatProps["artifactWorkspace"],
    });
    const artifactActions = container.querySelector(".sidebar-header__actions");
    expect(artifactActions).toBeTruthy();
    expect(artifactActions?.querySelector(".sidebar-header__close")).toBeTruthy();
    expect(container.querySelector(".sidebar-title")?.parentElement?.className).toContain(
      "sidebar-header",
    );
    expect(artifactActions?.contains(container.querySelector(".sidebar-title"))).toBe(false);
    expect(container.querySelector(".sidebar-tabs")?.parentElement).toBe(
      artifactActions?.parentElement,
    );

    host.sidebarSurface = "computer";
    paint(container, host);
    const computerActions = container.querySelector(".sidebar-header__actions");
    expect(
      computerActions
        ?.querySelector("[data-testid=computer-fullscreen]")
        ?.closest(".computer-chrome-actions"),
    ).toBeTruthy();
    expect(computerActions?.querySelector(".sidebar-header__close")).toBeTruthy();
    expect(computerActions?.parentElement?.className).toContain("sidebar-header");
    expect(container.querySelector("[data-testid=computer-operator]")?.parentElement).toBe(
      computerActions?.parentElement,
    );
  });

  it("toggles fullscreen from 全屏 and keeps docked chrome free of a second shrink button", () => {
    const host = createHost();
    beginAgentComputerUse(host, "Ada");
    applyServerComputerPreview({
      tenantId: "tenant-1",
      userId: "user-1",
      sessionKey: host.sessionKey,
      action: "open",
      status: "READY",
      streamUrl: STREAM,
      controlledBy: { kind: "agent", label: "Ada" },
    });
    expireComputerConnectingHoldForTests();
    const docked = paint(container, host, { assistantName: "Ada", assistantAvatar: "A" });

    const enter = container.querySelector("[data-testid=computer-fullscreen]");
    expect(enter?.textContent).toContain(t("chat.computerFullscreen"));
    expect(enter?.textContent).not.toContain(t("chat.computerShrink"));
    expect(enter?.getAttribute("data-fullscreen")).toBe("false");
    expect(container.querySelector("[data-testid=computer-shrink]")).toBeNull();
    expect(container.querySelector("[data-testid=computer-tab]")).toBeTruthy();
    expect(container.querySelector("[data-testid=computer-operator]")?.textContent).toContain(
      "Ada",
    );
    expect(container.querySelector("[data-testid=computer-takeover]")).toBeTruthy();
    expect(container.querySelector("[data-testid=computer-stage] button")).toBeNull();

    expect(
      [...container.querySelectorAll(".computer-chrome-actions [data-testid]")].map((node) =>
        node.getAttribute("data-testid"),
      ),
    ).toEqual(["computer-show-desktop", "computer-fullscreen", "computer-takeover"]);
    expect(container.querySelector(".sidebar-header__close")?.getAttribute("aria-label")).toBe(
      t("chat.computerClosePreview"),
    );
    container
      .querySelector(".sidebar-header__close")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(host.computerPreviewSize).toBe("docked");
    expect(host.sidebarOpen).toBe(true);
    expect(host.sidebarSurface).toBe("computer");
    expect(docked.onClose).toHaveBeenCalledTimes(1);

    enter?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(host.computerPreviewSize).toBe("fullscreen");
    const fullscreen = paint(container, host, { assistantName: "Ada", assistantAvatar: "A" });

    expect(container.querySelector("[data-testid=computer-fullscreen]")).toBeNull();
    expect(container.querySelector("[data-testid=computer-show-desktop]")).toBeNull();
    expect(container.querySelector("[data-testid=computer-shrink]")).toBeNull();
    expect(container.querySelector("[data-testid=computer-takeover]")).toBeNull();
    expect(container.querySelector("[data-testid=computer-handback]")).toBeNull();
    expect(container.querySelector("[data-testid=computer-tab]")).toBeNull();
    expect(container.querySelector("[data-testid=artifact-tab]")).toBeNull();
    expect(container.querySelector("[data-testid=computer-operator]")).toBeNull();
    expect(container.querySelector(".sidebar-tabs")).toBeNull();
    expect(container.querySelector(".computer-chrome-actions")).toBeNull();
    expect(container.textContent).not.toContain(t("chat.computerShowDesktop"));
    expect(container.textContent).not.toContain(t("chat.computerHandBack"));
    expect(container.querySelector("[data-testid=computer-open]")).toBeNull();
    expect(container.querySelector("[data-testid=computer-end]")).toBeNull();
    expect(container.querySelector("[data-testid=computer-stage] button")).toBeNull();
    expect(container.querySelector(".sidebar-header")).toBeNull();
    expect(container.querySelector(".sidebar-header__close")).toBeNull();
    expect(container.textContent).not.toContain(t("chat.computerExitFullscreen"));
    expect(container.querySelector("[data-testid=computer-frame]")).toBeTruthy();

    container
      .querySelector(".chat-split-container")
      ?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(host.computerPreviewSize).toBe("docked");
    expect(host.sidebarOpen).toBe(true);
    expect(host.sidebarSurface).toBe("computer");
    expect(fullscreen.onClose).not.toHaveBeenCalled();
    expect(docked.onClose).toHaveBeenCalledTimes(1);

    paint(container, host, { assistantName: "Ada", assistantAvatar: "A" });
    expect(container.querySelector("[data-testid=computer-fullscreen]")?.textContent).toContain(
      t("chat.computerFullscreen"),
    );
    expect(
      container.querySelector("[data-testid=computer-fullscreen]")?.getAttribute("data-fullscreen"),
    ).toBe("false");
    expect(container.querySelector("[data-testid=computer-tab]")).toBeTruthy();
    expect(container.querySelector("[data-testid=artifact-tab]")).toBeTruthy();
    expect(container.querySelector("[data-testid=computer-operator]")?.textContent).toContain(
      "Ada",
    );
    expect(container.querySelector("[data-testid=computer-takeover]")).toBeTruthy();
    expect(container.querySelector(".sidebar-header__close")?.getAttribute("aria-label")).toBe(
      t("chat.computerClosePreview"),
    );
  });

  it("posts show_desktop from 返回桌面 and renames handback to 交给AI", () => {
    const messages: unknown[] = [];
    const hooked = { calls: 0 };
    postComputerShowDesktop({
      __openbotShowDesktop: () => {
        hooked.calls += 1;
      },
      postMessage: () => {
        messages.push("should-not-post");
      },
    } as unknown as Window);
    expect(hooked.calls).toBe(1);
    expect(messages).toEqual([]);
    postComputerShowDesktop({
      postMessage: (data: unknown, origin: string) => {
        messages.push([data, origin]);
      },
    } as Window);
    expect(messages).toEqual([
      [{ source: COMPUTER_PREVIEW_CONTROL_SOURCE, type: "show_desktop" }, "*"],
    ]);
    postComputerShowDesktop(null);
    expect(messages).toHaveLength(1);

    const host = createHost();
    beginAgentComputerUse(host, "Ada");
    applyServerComputerPreview({
      tenantId: "tenant-1",
      userId: "user-1",
      sessionKey: host.sessionKey,
      action: "open",
      status: "READY",
      streamUrl: STREAM,
      controlledBy: { kind: "agent", label: "Ada" },
    });
    expireComputerConnectingHoldForTests();
    takeoverComputerPreview(host, "You");
    const painted = paint(container, host, { assistantName: "Ada", assistantAvatar: "A" });
    expect(container.querySelector("[data-testid=computer-handback]")?.textContent).toContain(
      t("chat.computerHandBack"),
    );
    const zhCopy = readFileSync(path.resolve("ui/src/i18n/locales/zh-CN.ts"), "utf8");
    const enCopy = readFileSync(path.resolve("ui/src/i18n/locales/en.ts"), "utf8");
    expect(zhCopy).toContain('computerHandBack: "交给AI"');
    expect(zhCopy).toContain('computerShowDesktop: "返回桌面"');
    expect(zhCopy).toContain('computerClosePreview: "关闭预览"');
    expect(enCopy).toContain('computerHandBack: "Hand to AI"');
    expect(enCopy).toContain('computerShowDesktop: "Show desktop"');
    expect(enCopy).toContain('computerClosePreview: "Close preview"');
    expect(
      [...container.querySelectorAll(".computer-chrome-actions [data-testid]")].map((node) =>
        node.getAttribute("data-testid"),
      ),
    ).toEqual(["computer-show-desktop", "computer-fullscreen", "computer-handback"]);

    const frame = container.querySelector("[data-testid=computer-frame]");
    expect(frame).toBeInstanceOf(HTMLIFrameElement);
    const live = frame as HTMLIFrameElement;
    const sized = {
      length: 1,
      0: { width: 640, height: 400 },
      item: () => ({ width: 640, height: 400 }),
    } as unknown as DOMRectList;
    vi.spyOn(live, "getClientRects").mockReturnValue(sized);
    const decoy = document.createElement("iframe");
    decoy.dataset.testid = "computer-frame";
    decoy.setAttribute("inert", "");
    vi.spyOn(decoy, "getClientRects").mockReturnValue({
      length: 0,
      item: () => null,
    } as unknown as DOMRectList);
    live.parentElement?.insertBefore(decoy, live);
    expect(computerShowDesktopFrame()).toBe(live);
    const posted: unknown[] = [];
    const view = frame instanceof HTMLIFrameElement ? frame.contentWindow : null;
    expect(view).toBeTruthy();
    vi.spyOn(view as Window, "postMessage").mockImplementation((data, origin) => {
      posted.push([data, origin]);
    });
    container
      .querySelector("[data-testid=computer-show-desktop]")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(posted).toEqual([
      [{ source: COMPUTER_PREVIEW_CONTROL_SOURCE, type: "show_desktop" }, "*"],
    ]);
    expect(host.computerPreviewSize).toBe("docked");
    expect(painted.onClose).not.toHaveBeenCalled();
    expect(container.querySelector("[data-testid=computer-handback]")).toBeTruthy();
  });

  it("docks chat beside the fullscreen computer stage instead of overlaying it", () => {
    const host = createHost();
    beginAgentComputerUse(host, "Ada");
    applyServerComputerPreview({
      tenantId: "tenant-1",
      userId: "user-1",
      sessionKey: host.sessionKey,
      action: "open",
      status: "READY",
      streamUrl: STREAM,
      controlledBy: { kind: "agent", label: "Ada" },
    });
    expireComputerConnectingHoldForTests();
    setComputerPreviewSize(host, "fullscreen");
    paint(container, host);

    const split = container.querySelector(".chat-split-container");
    expect(split?.className).toContain("chat-split-container--computer-fullscreen");
    const stage = container.querySelector("[data-testid=computer-stage]");
    const chatMain = container.querySelector(".chat-main");
    const sidebar = container.querySelector(".chat-sidebar");
    expect(stage).toBeTruthy();
    expect(chatMain).toBeTruthy();
    expect(sidebar?.contains(stage ?? null)).toBe(true);
    expect(stage?.contains(chatMain)).toBe(false);
    expect(sidebar?.querySelector(".chat-thread")).toBeNull();
    expect(sidebar?.querySelector(".chat-compose")).toBeNull();
    expect(chatMain?.querySelector(".chat-thread")).toBeTruthy();
    expect(chatMain?.querySelector(".chat-compose")).toBeTruthy();
    expect(stage?.querySelector(".chat-thread, .chat-compose, button")).toBeNull();

    const css = readFileSync(path.resolve("ui/src/styles/chat/sidebar.css"), "utf8");
    const start = css.indexOf(".chat-split-container--computer-fullscreen > .chat-main");
    const end = css.indexOf(".chat-split-container--computer-parked");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const block = css.slice(start, end);
    expect(block).toContain("position: relative");
    expect(block).toContain("inset: auto");
    expect(block).not.toContain("z-index: 4");
    expect(block).not.toContain("left: 12px");
    expect(block).not.toContain("pointer-events: none");
    expect(block).not.toContain("display: none");
    expect(chatMain?.getAttribute("style")).toContain(
      `flex: 1 1 ${COMPUTER_FULLSCREEN_CHAT_BASIS}`,
    );
  });

  it("keeps the fullscreen computer pane size when the nav rail collapses", () => {
    const fullscreen = {
      ...defaultComputerPreviewModel(),
      surface: "computer" as const,
      size: "fullscreen" as const,
    };
    expect(computerMainFlex(true, 0.62, fullscreen)).toBe(`1 1 ${COMPUTER_FULLSCREEN_CHAT_BASIS}`);
    expect(computerMainFlex(true, 0.62, { ...fullscreen, size: "expanded" })).toBe("0 0 280px");
    expect(computerMainFlex(true, 0.62, { ...fullscreen, size: "docked" })).toBe("0 0 62%");

    const sidebarCss = readFileSync(path.resolve("ui/src/styles/chat/sidebar.css"), "utf8");
    const layoutCss = readFileSync(path.resolve("ui/src/styles/layout.css"), "utf8");
    const workbenchCss = readFileSync(path.resolve("ui/src/styles/workbench.css"), "utf8");
    const declaredPx = (css: string, customProp: string) => {
      const match = css.match(new RegExp(`${customProp}:\\s*(\\d+)px`));
      expect(match?.[1], customProp).toBeTruthy();
      return Number(match?.[1]);
    };

    const basis = declaredPx(sidebarCss, "--computer-fullscreen-chat-basis");
    expect(basis).toBe(Number.parseInt(COMPUTER_FULLSCREEN_CHAT_BASIS, 10));
    expect(sidebarCss.replace(/\s+/g, " ")).toContain(
      "calc(100% - var(--computer-fullscreen-chat-basis) - var(--computer-fullscreen-rail-freed, 0px))",
    );
    const paneRule = sidebarCss.slice(
      sidebarCss.indexOf(".chat-split-container--computer-fullscreen > .chat-sidebar,"),
      sidebarCss.indexOf(".chat-split-container--computer-fullscreen .sidebar-content"),
    );
    expect(paneRule).toContain("flex: 0 0 var(--computer-fullscreen-pane-width)");
    expect(paneRule).toContain("min-width: 0");
    expect(paneRule).not.toContain("flex: 1 1 auto");
    const mainRule = sidebarCss.slice(
      sidebarCss.indexOf(".chat-split-container--computer-fullscreen > .chat-main {"),
      sidebarCss.indexOf(".chat-split-container--computer-fullscreen > .chat-sidebar,"),
    );
    expect(mainRule).toContain("flex: 1 1 var(--computer-fullscreen-chat-basis)");
    expect(mainRule).toContain("max-width: none");
    expect(mainRule).not.toContain("max-width: 360px");
    expect(sidebarCss).toContain(
      ".chat-split-container--computer-expanded .chat-sidebar {\n  flex: 1 1 auto;",
    );

    const rail = declaredPx(sidebarCss, "--employee-workbench-rail");
    const railCollapsed = declaredPx(sidebarCss, "--employee-workbench-rail-collapsed");
    expect(rail).toBeGreaterThan(railCollapsed);
    expect(workbenchCss).toContain(`grid-template-columns: ${rail}px minmax(0, 1fr)`);
    expect(workbenchCss).toContain(`grid-template-columns: ${railCollapsed}px minmax(0, 1fr)`);
    expect(sidebarCss.replace(/\s+/g, " ")).toContain(
      "--computer-fullscreen-rail-freed: calc( var(--employee-workbench-rail) - var(--employee-workbench-rail-collapsed) )",
    );
    expect(sidebarCss).toContain("--computer-fullscreen-rail-freed: 0px");

    const shellRail = declaredPx(layoutCss, "--shell-nav-width");
    const shellRailCollapsed = declaredPx(layoutCss, "--shell-nav-collapsed-width");
    expect(shellRail).toBeGreaterThan(shellRailCollapsed);
    expect(sidebarCss).toContain(
      "--computer-fullscreen-rail-freed: calc(var(--shell-nav-width) - var(--shell-nav-collapsed-width))",
    );
    const focusStart = sidebarCss.indexOf(".shell--chat-focus {");
    const focusBlock = sidebarCss.slice(focusStart, sidebarCss.indexOf("}", focusStart));
    expect(focusBlock).toContain("--computer-fullscreen-rail-freed: 0px");

    const containerWidth = 1400;
    const expandedPane = containerWidth - basis;
    const freed = rail - railCollapsed;
    const collapsedPane = containerWidth + freed - basis - freed;
    expect(collapsedPane).toBe(expandedPane);
    expect(expandedPane).toBeGreaterThan(0);
  });

  it("uniform-scales the 1280×800 desktop to the stage width with chrome margins", () => {
    const css = readFileSync(path.resolve("ui/src/styles/chat/sidebar.css"), "utf8");
    const start = css.indexOf(".computer-preview__frame {");
    const end = css.indexOf("}", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const block = css.slice(start, end);
    expect(block).toContain("position: absolute");
    expect(block).toContain("inset: 0");
    expect(block).toContain("width: 100%");
    expect(block).toContain("height: 100%");
    expect(block).toContain("background: transparent");
    expect(block).not.toContain("#e7e7eb");
    expect(css).not.toContain("aspect-ratio: 16 / 9");
    const stageStart = css.indexOf(".computer-preview__stage {");
    const stage = css.slice(stageStart, css.indexOf("}", stageStart));
    expect(stage).toContain("position: relative");
    expect(stage).toContain("background: transparent");
    expect(stage).toContain("container-type: size");
    expect(stage).toContain("min-height: calc(100cqi * 800 / 1280)");
    expect(stage).toContain("width: 100%");
    expect(stage).not.toContain("background: #e7e7eb");
    expect(stage).not.toContain("background: #0c0c0e");
    const previewStart = css.indexOf(".computer-preview {");
    const preview = css.slice(previewStart, css.indexOf("}", previewStart));
    expect(preview).toContain("container-type: inline-size");
    expect(preview).toContain("overflow: auto");
    const letterboxStart = css.indexOf(".computer-preview__letterbox {");
    const letterbox = css.slice(letterboxStart, css.indexOf("}", letterboxStart));
    expect(letterbox).toContain("position: relative");
    expect(letterbox).toContain("width: 100%");
    expect(letterbox).toContain("height: auto");
    expect(letterbox).toContain("aspect-ratio: 1280 / 800");
    expect(letterbox).not.toContain("min(100cqw");
    expect(letterbox).not.toContain("calc(100cqh");
    expect(letterbox).toContain("background: transparent");
    expect(letterbox).not.toContain("#e7e7eb");
    expect(letterbox).not.toContain("inset: 0");
    expect(stage).toContain("align-items: stretch");
    expect(stage).toContain("justify-content: center");
    expect(stage).toContain("border-radius: 0");
    expect(letterbox).toContain("border-radius: 0");
    expect(letterbox).toContain("max-width: 100%");
    expect(css).toContain(
      ".employee-workbench__assistant-stage\n  > .chat\n  .sidebar-content:has(.sidebar-body--computer:not([hidden]))",
    );
    const gutterReset = css.slice(
      css.indexOf(".employee-workbench__assistant-stage\n  > .chat\n  .sidebar-content:has"),
      css.indexOf(".sidebar-content:has(.sidebar-body--computer:not([hidden])) > .sidebar-body"),
    );
    expect(gutterReset).toContain("padding: 0");
    const computerContent = css.slice(
      css.indexOf(".sidebar-content:has(.sidebar-body--computer:not([hidden])) {"),
      css.indexOf(".sidebar-content:has(.sidebar-body--computer:not([hidden])) > .sidebar-body"),
    );
    expect(computerContent).toContain("padding: 0");
    const immersiveStart = css.indexOf(
      ".chat-split-container--computer-fullscreen .computer-preview__letterbox {",
    );
    const immersive = css.slice(immersiveStart, css.indexOf("}", immersiveStart));
    expect(immersiveStart).toBeGreaterThan(letterboxStart);
    expect(immersive).toContain("width: 100%");
    expect(immersive).toContain("height: auto");
    expect(immersive).toContain("max-width: 100%");
    expect(immersive).toContain("max-height: none");
    expect(immersive).toContain("bottom: 0");
    expect(immersive).toContain("aspect-ratio: 1280 / 800");
    expect(immersive).toContain("transform: none");
    expect(immersive).not.toContain("width: max(");
    expect(immersive).not.toContain("height: max(");
    expect(immersive).not.toContain("aspect-ratio: auto");
    expect(immersive).not.toContain("transform: translate(-50%, -50%)");
    expect(immersive).not.toMatch(/^\s*height: 100%;/m);
    // Width-fit on a wide short pane: scale by width, clip top, keep Dock.
    const widePane = { width: 1200, height: 500 };
    const widthFitScale = widePane.width / 1280;
    const fittedHeight = 800 * widthFitScale;
    expect(fittedHeight).toBeCloseTo(750, 5);
    expect(fittedHeight).toBeGreaterThan(widePane.height);
    const visibleFromBottom = widePane.height / widthFitScale;
    expect(visibleFromBottom).toBeCloseTo(533.333, 2);
    // Bottom-aligned: visible band is fbY=(800-533)…800, so Dock (~bottom 80px) stays.
    expect(800 - visibleFromBottom).toBeLessThan(300);
    expect(visibleFromBottom).toBeGreaterThan(80);
    const coverScale = Math.max(widePane.width / 1280, widePane.height / 800);
    const coverVisibleFbHeight = widePane.height / coverScale;
    expect(coverVisibleFbHeight).toBeLessThan(668);
    const dockedWidth = 640;
    const dockedHeight = dockedWidth * (800 / 1280);
    expect(dockedHeight).toBeCloseTo(400, 5);
    expect((800 / 800) * dockedHeight).toBeLessThanOrEqual(dockedHeight);
    const fullscreenStageStart = css.lastIndexOf(
      ".chat-split-container--computer-fullscreen .computer-preview__stage {",
    );
    const fullscreenStage = css.slice(fullscreenStageStart, css.indexOf("}", fullscreenStageStart));
    expect(fullscreenStage).toContain("overflow: hidden");
    const hideStart = css.indexOf(".chat-split-container--computer-fullscreen .sidebar-tabs");
    const hide = css.slice(hideStart, css.indexOf("}", hideStart));
    expect(hide).toContain(".computer-operator");
    expect(hide).not.toContain(".computer-chrome-actions");
    expect(hide).toContain("display: none");
    const headerHideStart = css.indexOf(
      ".chat-split-container--computer-fullscreen .sidebar-header,",
    );
    const headerHide = css.slice(headerHideStart, css.indexOf("}", headerHideStart));
    expect(headerHideStart).toBeGreaterThan(0);
    expect(headerHide).toContain("display: none");
    const headerStart = css.indexOf(".sidebar-header {");
    const header = css.slice(headerStart, css.indexOf("}", headerStart));
    expect(header).toContain('grid-template-areas: "leading center actions"');
    expect(css).toContain(".sidebar-header:has(> .sidebar-tabs) > .sidebar-title");
    expect(css).toContain("grid-row: 2");
  });

  it("gates keyboard/pointer on INTERACTIVE (takeover alone is not enough)", () => {
    const host = createHost();
    beginAgentComputerUse(host, "Ada");
    applyServerComputerPreview({
      tenantId: "tenant-1",
      userId: "user-1",
      sessionKey: host.sessionKey,
      action: "open",
      status: "READY",
      streamUrl: STREAM,
      controlledBy: { kind: "agent", label: "Ada" },
      grantsInput: true,
    });
    expireComputerConnectingHoldForTests();
    takeoverComputerPreview(host, "You");
    paint(container, host);
    const stage = container.querySelector("[data-testid=computer-stage]");
    expect(stage?.getAttribute("data-controlling")).toBe("true");
    expect(stage?.getAttribute("data-session-interactive")).toBe("false");
    expect(stage?.getAttribute("data-input-keyboard")).toBe("false");
    expect(stage?.getAttribute("data-input-pointer")).toBe("false");
    expect(stage?.getAttribute("data-input-clipboard")).toBe("false");
    expect(container.querySelector("[data-testid=computer-frame]")?.hasAttribute("inert")).toBe(
      true,
    );
    expect(
      container.querySelector(".chat-split-container")?.getAttribute("data-keyboard-target"),
    ).toBe("chat");

    advanceComputerDesktopInteractiveForTests(host.sessionKey);
    paint(container, host);
    const live = container.querySelector("[data-testid=computer-stage]");
    expect(live?.getAttribute("data-session-interactive")).toBe("true");
    expect(live?.getAttribute("data-input-keyboard")).toBe("true");
    expect(live?.getAttribute("data-input-pointer")).toBe("true");
    expect(live?.getAttribute("data-input-clipboard")).toBe("false");
    expect(container.querySelector("[data-testid=computer-frame]")?.hasAttribute("inert")).toBe(
      false,
    );
    expect(
      container.querySelector(".chat-split-container")?.getAttribute("data-keyboard-target"),
    ).toBe("desktop");
  });

  it("unlocks data-input-clipboard when permission is granted under INTERACTIVE", () => {
    const host = createHost();
    beginAgentComputerUse(host, "Ada");
    applyServerComputerPreview({
      tenantId: "tenant-1",
      userId: "user-1",
      sessionKey: host.sessionKey,
      action: "open",
      status: "READY",
      streamUrl: STREAM,
      controlledBy: { kind: "agent", label: "Ada" },
      grantsInput: true,
    });
    expireComputerConnectingHoldForTests();
    takeoverComputerPreview(host, "You");
    advanceComputerDesktopInteractiveForTests(host.sessionKey);
    setCachedClipboardPermission("granted");
    paint(container, host);
    const live = container.querySelector("[data-testid=computer-stage]");
    expect(live?.getAttribute("data-input-keyboard")).toBe("true");
    expect(live?.getAttribute("data-input-clipboard")).toBe("true");
  });

  it("reloads the iframe with the input url after takeover", () => {
    const host = createHost();
    beginAgentComputerUse(host, "Ada");
    applyServerComputerPreview({
      tenantId: "tenant-1",
      userId: "user-1",
      sessionKey: host.sessionKey,
      action: "open",
      status: "READY",
      streamUrl: STREAM,
      controlledBy: { kind: "agent", label: "Ada" },
    });
    expireComputerConnectingHoldForTests();
    paint(container, host);
    const before = container.querySelector("[data-testid=computer-frame]");
    expect(before?.getAttribute("src")).toBe(STREAM);
    expect(before?.hasAttribute("inert")).toBe(true);

    takeoverComputerPreview(host, "You");
    applyServerComputerPreview({
      tenantId: "tenant-1",
      userId: "user-1",
      sessionKey: host.sessionKey,
      action: "open",
      status: "READY",
      streamUrl: STREAM_B,
      grantsInput: true,
      controlledBy: { kind: "user", label: "You" },
    });
    expireComputerConnectingHoldForTests();
    advanceComputerDesktopInteractiveForTests(host.sessionKey);
    paint(container, host);
    const after = container.querySelector("[data-testid=computer-frame]");
    expect(after?.getAttribute("src")).toBe(STREAM_B);
    expect(after?.hasAttribute("inert")).toBe(false);
    expect(
      container.querySelector("[data-testid=computer-stage]")?.getAttribute("data-controlling"),
    ).toBe("true");
    // Declutter: no inset outline frame; pointer unlock is via data-input-* attrs.
    expect(
      container.querySelector("[data-testid=computer-stage]")?.getAttribute("style") ?? "",
    ).not.toContain("inset");
    expect(
      container.querySelector("[data-testid=computer-stage]")?.getAttribute("data-input-pointer"),
    ).toBe("true");
    expect(container.querySelector("[data-testid=computer-open]")).toBeNull();
    expect(container.querySelector("[data-testid=computer-end]")).toBeNull();
    expect(
      readComputerPreviewModel(host, { tenantId: "tenant-1", userId: "user-1" }).controlsDesktop,
    ).toBe(true);
    expect(computerSessionRequestsInput(host.sessionKey)).toBe(true);
  });

  it("keeps AI control while the computer is showing; explicit 接管 claims input", () => {
    const host = createHost();
    beginAgentComputerUse(host, "Ada");
    applyServerComputerPreview({
      tenantId: "tenant-1",
      userId: "user-1",
      sessionKey: host.sessionKey,
      action: "open",
      status: "READY",
      streamUrl: STREAM,
      controlledBy: { kind: "agent", label: "Ada" },
    });
    expireComputerConnectingHoldForTests();
    paint(container, host);
    expect(container.querySelector("[data-testid=computer-frame]")?.hasAttribute("inert")).toBe(
      true,
    );

    // Default: opening / showing 电脑 does not takeControl (AI keeps the desk).
    const claim = computerPreviewOpenPlan(host, { action: "open", userLabel: "You" });
    expect(claim).toEqual({ action: "open", takeControl: false, releaseControl: true });
    expect(computerPreviewNeedsInputClaim(host)).toBe(false);
    takeoverComputerPreview(host, "You");
    expect(computerPreviewOpenPlan(host, { action: "open", userLabel: "You" })).toEqual({
      action: "open",
      takeControl: true,
      releaseControl: false,
    });
    expect(computerPreviewNeedsInputClaim(host)).toBe(true);
    advanceComputerDesktopInteractiveForTests(host.sessionKey);
    paint(container, host);
    expect(container.querySelector("[data-testid=computer-frame]")?.hasAttribute("inert")).toBe(
      false,
    );
    setComputerPreviewSize(host, "fullscreen");
    paint(container, host);
    expect(container.querySelector("[data-testid=computer-takeover]")).toBeNull();
    expect(container.querySelector("[data-testid=computer-frame]")?.hasAttribute("inert")).toBe(
      false,
    );

    applyServerComputerPreview({
      tenantId: "tenant-1",
      userId: "user-1",
      sessionKey: host.sessionKey,
      action: "open",
      status: "READY",
      streamUrl: STREAM_B,
      grantsInput: true,
      controlledBy: { kind: "user", label: "You" },
    });
    expireComputerConnectingHoldForTests();
    expect(computerPreviewOpenPlan(host, { action: "open", userLabel: "You" })).toEqual({
      action: "status",
      takeControl: false,
      releaseControl: false,
    });
    expect(computerPreviewNeedsInputClaim(host)).toBe(false);

    handBackComputerPreview(host);
    expect(computerPreviewOpenPlan(host, { action: "open", userLabel: "You" })).toEqual({
      action: "open",
      takeControl: false,
      releaseControl: true,
      explicitHandback: true,
    });
    paint(container, host);
    expect(container.querySelector("[data-testid=computer-frame]")?.hasAttribute("inert")).toBe(
      true,
    );

    const locked = createHost("agent-locked");
    beginAgentComputerUse(locked, "Ada");
    applyServerComputerPreview({
      tenantId: "tenant-1",
      userId: "user-1",
      sessionKey: locked.sessionKey,
      action: "open",
      status: "READY",
      streamUrl: STREAM,
      controlledBy: { kind: "agent", label: "Ada" },
    });
    expireComputerConnectingHoldForTests();
    expect(
      computerPreviewOpenPlan(locked, { action: "open", userLabel: "You", formLocked: true }),
    ).toEqual({ action: "open", takeControl: false, releaseControl: true });
    expect(computerPreviewNeedsInputClaim(locked, { formLocked: true })).toBe(false);
    expect(
      readComputerPreviewModel(locked, { tenantId: "tenant-1", userId: "user-1" }).controlsDesktop,
    ).toBe(false);
  });

  it("opens a cold computer when the computer surface is selected", () => {
    expect(computerPreviewNeedsOpen(defaultComputerPreviewModel())).toBe(true);
    const host = createHost();
    beginAgentComputerUse(host, "Ada");
    expect(
      computerPreviewNeedsOpen(
        readComputerPreviewModel(host, { tenantId: "tenant-1", userId: "user-1" }),
      ),
    ).toBe(false);
    applyServerComputerPreview({
      tenantId: "tenant-1",
      userId: "user-1",
      sessionKey: host.sessionKey,
      action: "open",
      status: "READY",
      streamUrl: STREAM,
      controlledBy: { kind: "agent", label: "Ada" },
    });
    expireComputerConnectingHoldForTests();
    expect(
      computerPreviewNeedsOpen(
        readComputerPreviewModel(host, { tenantId: "tenant-1", userId: "user-1" }),
      ),
    ).toBe(false);
    expect(
      computerPreviewNeedsOpen({
        formalStatus: "DISCONNECTED",
        streamUrl: null,
        ended: true,
      }),
    ).toBe(true);

    const source = readFileSync(path.resolve("ui/src/ui/app-render.ts"), "utf8");
    const start = source.indexOf("onComputerSelectSurface:");
    const end = source.indexOf("onComputerSetSize:");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const block = source.slice(start, end);
    expect(block).toContain("computerPreviewNeedsOpen");
    expect(block).toContain('refreshAccountComputerPreview?.("open")');
    const sizeStart = source.indexOf("onComputerSetSize:");
    const sizeEnd = source.indexOf("onComputerTakeover:");
    expect(source.slice(sizeStart, sizeEnd)).not.toContain("refreshAccountComputerPreview");
  });
});

describe("account computer M1b anomaly overlay + credential reconnect", () => {
  let container: HTMLElement;

  beforeEach(() => {
    resetAccountComputerPreviewForTests();
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    resetAccountComputerPreviewForTests();
    container.remove();
  });

  it("shows anomaly CTA overlay while iframe streamUrl is still mounted", () => {
    const host = createHost();
    beginAgentComputerUse(host, "Ada");
    applyServerComputerPreview({
      tenantId: "tenant-1",
      userId: "user-1",
      sessionKey: host.sessionKey,
      action: "open",
      status: "READY",
      streamUrl: STREAM,
      controlledBy: { kind: "agent", label: "Ada" },
    });
    expireComputerConnectingHoldForTests();
    noteComputerDesktopSessionAnomaly(host.sessionKey, "auth");
    const model = readComputerPreviewModel(host, { tenantId: "tenant-1", userId: "user-1" });
    expect(model.streamUrl).toBe(STREAM);
    expect(model.sessionStage).toBe("auth");
    expect(model.sessionReconnectReason).toBe("credential");
    render(renderComputerPreviewBody(model, { onReconnectStream: () => undefined }), container);
    expect(container.querySelector("[data-testid=computer-frame]")).toBeTruthy();
    expect(container.querySelector("[data-testid=computer-anomaly-overlay]")).toBeTruthy();
    const btn = container.querySelector("[data-testid=computer-reconnect]");
    expect(btn).toBeTruthy();
    expect(btn?.getAttribute("data-reconnect-reason")).toBe("credential");
    expect(btn?.textContent).toContain(t("chat.computerReconnectCredentialCta"));
  });

  it("REAUTH_REQUIRED wires auth phase; reconnect invokes credential refresh without reload", () => {
    const host = createHost() as ComputerPreviewChrome & {
      refreshAccountComputerPreview?: (action: "open" | "status" | "end") => void;
    };
    const refresh = vi.fn();
    host.refreshAccountComputerPreview = (action) => {
      refresh(action);
    };
    beginAgentComputerUse(host, "Ada");
    applyServerComputerPreview({
      tenantId: "tenant-1",
      userId: "user-1",
      sessionKey: host.sessionKey,
      action: "open",
      status: "READY",
      streamUrl: STREAM,
      controlledBy: { kind: "agent", label: "Ada" },
    });
    expireComputerConnectingHoldForTests();
    applyServerComputerPreview({
      tenantId: "tenant-1",
      userId: "user-1",
      sessionKey: host.sessionKey,
      action: "status",
      status: "REAUTH_REQUIRED",
      streamUrl: STREAM,
    });
    const mid = readComputerPreviewModel(host, { tenantId: "tenant-1", userId: "user-1" });
    expect(mid.sessionStage).toBe("auth");
    expect(mid.sessionReconnectReason).toBe("credential");
    const g = globalThis as { location?: { reload?: () => void } };
    const previous = g.location;
    const reload = vi.fn();
    g.location = { reload };
    reconnectComputerDesktopSession(host, "credential");
    expect(refresh).toHaveBeenCalledWith("open");
    expect(reload).not.toHaveBeenCalled();
    g.location = previous;
  });

  it("network preview error maps to degraded anomaly stage", () => {
    const host = createHost();
    beginAgentComputerUse(host, "Ada");
    applyServerComputerPreview({
      tenantId: "tenant-1",
      userId: "user-1",
      sessionKey: host.sessionKey,
      action: "open",
      status: "READY",
      streamUrl: STREAM,
    });
    expireComputerConnectingHoldForTests();
    noteComputerPreviewStreamError("network timeout while fetching preview", host.sessionKey);
    const model = readComputerPreviewModel(host, { tenantId: "tenant-1", userId: "user-1" });
    expect(model.sessionStage).toBe("degraded");
    expect(model.sessionReconnectReason).toBe("network");
  });
});

describe("account computer interaction ownership coordinator", () => {
  beforeEach(() => {
    resetAccountComputerPreviewForTests();
  });

  afterEach(() => {
    resetAccountComputerPreviewForTests();
  });

  it("agent begin grants INTERACTIVE ownership; human takeover preempts", () => {
    const host = createHost();
    beginAgentComputerUse(host, "Ada");
    const afterAgent = readComputerPreviewModel(host, {
      tenantId: "tenant-1",
      userId: "user-1",
    });
    expect(afterAgent.ownership?.phase).toBe("INTERACTIVE");
    expect(afterAgent.ownership?.owners.keyboard).toBe("agent");
    expect(afterAgent.ownership?.holderAgentId).toBe("Ada");
    expect(afterAgent.controlsDesktop).toBe(false);

    takeoverComputerPreview(host, "You");
    advanceComputerDesktopInteractiveForTests(host.sessionKey);
    const afterHuman = readComputerPreviewModel(host, {
      tenantId: "tenant-1",
      userId: "user-1",
    });
    expect(afterHuman.ownership?.phase).toBe("HUMAN_TAKEOVER");
    expect(afterHuman.ownership?.owners.keyboard).toBe("human");
    expect(afterHuman.ownership?.humanSessionKey).toBe(host.sessionKey);
    expect(afterHuman.controlsDesktop).toBe(true);
    expect(afterHuman.inputCapability?.keyboard).toBe(true);
  });

  it("hand-back enters GRACE then BACKGROUND_AGENT", () => {
    const host = createHost();
    beginAgentComputerUse(host, "Ada");
    takeoverComputerPreview(host, "You");
    handBackComputerPreview(host);
    const grace = readComputerPreviewModel(host, {
      tenantId: "tenant-1",
      userId: "user-1",
    });
    expect(grace.ownership?.phase).toBe("GRACE");
    expect(grace.controlsDesktop).toBe(false);
    expect(grace.inputCapability?.keyboard).toBe(false);
  });

  it("takeover after 交给AI leaves YIELDED and unlocks keyboard/pointer again", () => {
    const host = createHost();
    beginAgentComputerUse(host, "Ada");
    applyServerComputerPreview({
      tenantId: "tenant-1",
      userId: "user-1",
      sessionKey: host.sessionKey,
      action: "open",
      status: "READY",
      streamUrl: STREAM,
      controlledBy: { kind: "agent", label: "Ada" },
    });
    expireComputerConnectingHoldForTests();
    takeoverComputerPreview(host, "You");
    advanceComputerDesktopInteractiveForTests(host.sessionKey);
    applyServerComputerPreview({
      tenantId: "tenant-1",
      userId: "user-1",
      sessionKey: host.sessionKey,
      action: "open",
      status: "READY",
      streamUrl: STREAM_B,
      grantsInput: true,
      controlledBy: { kind: "user", label: "You" },
    });
    expireComputerConnectingHoldForTests();
    advanceComputerDesktopInteractiveForTests(host.sessionKey);

    handBackComputerPreview(host);
    const afterHandBack = readComputerPreviewModel(host, {
      tenantId: "tenant-1",
      userId: "user-1",
    });
    expect(afterHandBack.sessionPhase).toBe("YIELDED");
    expect(afterHandBack.controlsDesktop).toBe(false);
    expect(afterHandBack.inputCapability?.pointer).toBe(false);

    takeoverComputerPreview(host, "You");
    expect(
      readComputerPreviewModel(host, { tenantId: "tenant-1", userId: "user-1" }).sessionPhase,
    ).not.toBe("YIELDED");
    applyServerComputerPreview({
      tenantId: "tenant-1",
      userId: "user-1",
      sessionKey: host.sessionKey,
      action: "open",
      status: "READY",
      streamUrl: `${STREAM_B}-retake`,
      grantsInput: true,
      controlledBy: { kind: "user", label: "You" },
    });
    expireComputerConnectingHoldForTests();
    advanceComputerDesktopInteractiveForTests(host.sessionKey);
    const afterRetake = readComputerPreviewModel(host, {
      tenantId: "tenant-1",
      userId: "user-1",
    });
    expect(afterRetake.sessionPhase).toBe("INTERACTIVE");
    expect(afterRetake.controlsDesktop).toBe(true);
    expect(afterRetake.ownership?.phase).toBe("HUMAN_TAKEOVER");
    expect(afterRetake.inputCapability?.keyboard).toBe(true);
    expect(afterRetake.inputCapability?.pointer).toBe(true);
  });

  it("adoptComputerAccount migrates HUMAN ownership when dest already has live connection", () => {
    const host = createHost();
    // Two live connections on different users (attach does not go through adopt).
    attachComputerSession({
      tenantId: "tenant-1",
      userId: "user-a",
      sessionKey: host.sessionKey,
      agentLabel: "Ada",
    });
    takeoverComputerPreview(host, "You");
    expect(
      readComputerPreviewModel(host, { tenantId: "tenant-1", userId: "user-a" }).ownership?.phase,
    ).toBe("HUMAN_TAKEOVER");

    attachComputerSession({
      tenantId: "tenant-1",
      userId: "user-b",
      sessionKey: host.sessionKey,
      agentLabel: "Bea",
    });
    // Point active back at user-a so adopt(user-b) hits the early-return (dest live).
    rememberComputerAccount({ tenantId: "tenant-1", userId: "user-a" });
    adoptComputerAccount("tenant-1", "user-b");

    const onB = readComputerPreviewModel(host, {
      tenantId: "tenant-1",
      userId: "user-b",
    });
    expect(onB.ownership?.phase).toBe("HUMAN_TAKEOVER");
    expect(onB.ownership?.humanSessionKey).toBe(host.sessionKey);
    expect(onB.ownership?.owners.keyboard).toBe("human");
  });
});

describe("account computer takeover siteHost wiring", () => {
  afterEach(() => {
    resetAccountComputerPreviewForTests();
  });

  it("noteComputerRemotePageUrl feeds siteHost into begin episode on takeover", () => {
    const host = createHost();
    rememberComputerAccount({ tenantId: "tenant-1", userId: "user-1" });
    beginAgentComputerUse(host, "Ada");
    noteComputerRemotePageUrl("https://user:secret@billing.example.com/invoices?token=abc#frag");
    takeoverComputerPreview(host, "You");
    const accountKey = accountComputerKey("tenant-1", "user-1");
    const episode = getActiveTakeoverEpisode(accountKey);
    expect(episode?.siteHost).toBe("billing.example.com");
    const model = readComputerPreviewModel(host, { tenantId: "tenant-1", userId: "user-1" });
    expect(model.ownership?.phase).toBe("HUMAN_TAKEOVER");
    const body = document.createElement("div");
    render(renderComputerPreviewBody(model), body);
    const stage = body.querySelector("[data-testid=computer-stage]");
    expect(stage?.getAttribute("data-takeover-learning")).toBe("active");
    expect(stage?.getAttribute("data-takeover-site-host")).toBe("billing.example.com");
  });

  it("applyServerComputerPreview pageUrl notes remote URL for learning", () => {
    const host = createHost();
    applyServerComputerPreview({
      tenantId: "tenant-1",
      userId: "user-1",
      sessionKey: host.sessionKey,
      action: "open",
      status: "READY",
      streamUrl: STREAM,
      pageUrl: "https://portal.example.org/desk",
    });
    takeoverComputerPreview(host, "You");
    const episode = getActiveTakeoverEpisode(accountComputerKey("tenant-1", "user-1"));
    expect(episode?.siteHost).toBe("portal.example.org");
    handBackComputerPreview(host);
    const drafts = listTakeoverSkillDrafts();
    expect(drafts.some((d) => d.draft.siteHost === "portal.example.org")).toBe(true);
  });

  it("ignores about:blank when noting remote page URL", () => {
    const host = createHost();
    rememberComputerAccount({ tenantId: "tenant-1", userId: "user-1" });
    noteComputerRemotePageUrl("https://keep.example/path");
    noteComputerRemotePageUrl("about:blank");
    beginAgentComputerUse(host, "Ada");
    takeoverComputerPreview(host, "You");
    const episode = getActiveTakeoverEpisode(accountComputerKey("tenant-1", "user-1"));
    expect(episode?.siteHost).toBe("keep.example");
  });
});

describe("noVNC token refresh (DESKTOP_NOVNC_TOKEN_REFRESH_M1)", () => {
  let container: HTMLElement;
  beforeEach(() => {
    resetAccountComputerPreviewForTests();
    setCachedClipboardPermission("prompt");
    container = document.createElement("div");
    document.body.append(container);
  });
  afterEach(() => {
    container.remove();
    resetAccountComputerPreviewForTests();
    vi.restoreAllMocks();
  });

  it("detects Invalid or expired token iframe body", () => {
    const doc = document.implementation.createHTMLDocument("t");
    doc.body.textContent = NOVNC_INVALID_OR_EXPIRED_TOKEN;
    expect(isNovncInvalidOrExpiredTokenDocument(doc)).toBe(true);
    doc.body.textContent = "live desktop";
    expect(isNovncInvalidOrExpiredTokenDocument(doc)).toBe(false);
    expect(isNovncInvalidOrExpiredTokenDocument(null)).toBe(false);
  });

  it("adopts a newly minted view streamUrl (does not keep consumed URL)", () => {
    const host = createHost();
    host.sidebarOpen = true;
    host.sidebarSurface = "computer";
    applyServerComputerPreview({
      tenantId: "tenant-1",
      userId: "user-1",
      sessionKey: host.sessionKey,
      action: "open",
      status: "READY",
      streamUrl: STREAM,
      grantsInput: false,
    });
    expireComputerConnectingHoldForTests();
    expect(
      readComputerPreviewModel(host, { tenantId: "tenant-1", userId: "user-1" }).streamUrl,
    ).toBe(STREAM);
    applyServerComputerPreview({
      tenantId: "tenant-1",
      userId: "user-1",
      sessionKey: host.sessionKey,
      action: "open",
      status: "READY",
      streamUrl: STREAM_B,
      grantsInput: false,
    });
    expireComputerConnectingHoldForTests();
    expect(
      readComputerPreviewModel(host, { tenantId: "tenant-1", userId: "user-1" }).streamUrl,
    ).toBe(STREAM_B);
  });

  it("forces open+takeControl on AUTH_EXPIRED even when input grant looks live", () => {
    const host = createHost();
    host.sidebarOpen = true;
    host.sidebarSurface = "computer";
    beginAgentComputerUse(host, "Ada");
    applyServerComputerPreview({
      tenantId: "tenant-1",
      userId: "user-1",
      sessionKey: host.sessionKey,
      action: "open",
      status: "READY",
      streamUrl: STREAM,
      grantsInput: true,
    });
    takeoverComputerPreview(host, "You");
    // Takeover clears the local grant so the next open remints; simulate that remint.
    applyServerComputerPreview({
      tenantId: "tenant-1",
      userId: "user-1",
      sessionKey: host.sessionKey,
      action: "open",
      status: "READY",
      streamUrl: STREAM_B,
      grantsInput: true,
    });
    advanceComputerDesktopInteractiveForTests(host.sessionKey);
    expireComputerConnectingHoldForTests();
    expect(computerPreviewOpenPlan(host, { action: "open", userLabel: "You" })).toEqual({
      action: "status",
      takeControl: false,
      releaseControl: false,
    });
    noteComputerDesktopSessionAnomaly(host.sessionKey, "auth", host);
    expect(computerPreviewOpenPlan(host, { action: "open", userLabel: "You" })).toEqual({
      action: "open",
      takeControl: true,
      releaseControl: false,
    });
  });

  it("rotateComputerPreviewStreamCredential clears consumed URL and reconnects credential", () => {
    const host = createHost() as ComputerPreviewChrome & {
      refreshAccountComputerPreview?: (action: "open" | "status" | "end") => void;
    };
    host.sidebarOpen = true;
    host.sidebarSurface = "computer";
    const refresh = vi.fn();
    host.refreshAccountComputerPreview = refresh;
    applyServerComputerPreview({
      tenantId: "tenant-1",
      userId: "user-1",
      sessionKey: host.sessionKey,
      action: "open",
      status: "READY",
      streamUrl: STREAM,
      grantsInput: true,
    });
    takeoverComputerPreview(host, "You");
    expireComputerConnectingHoldForTests();
    expect(
      readComputerPreviewModel(host, { tenantId: "tenant-1", userId: "user-1" }).streamUrl,
    ).toBe(STREAM);
    rotateComputerPreviewStreamCredential(host);
    expect(
      readComputerPreviewModel(host, { tenantId: "tenant-1", userId: "user-1" }).streamUrl,
    ).toBeNull();
    expect(refresh).toHaveBeenCalledWith("open");
  });

  it("exports DESKTOP_POST_TAKEOVER_INPUT_M1 landing id", () => {
    expect(DESKTOP_POST_TAKEOVER_INPUT_LANDING).toBe("DESKTOP_POST_TAKEOVER_INPUT_M1");
  });

  it("does not inline position:relative on letterbox (keeps CSS vertical center)", () => {
    const host = createHost();
    beginAgentComputerUse(host, "Ada");
    applyServerComputerPreview({
      tenantId: "tenant-1",
      userId: "user-1",
      sessionKey: host.sessionKey,
      action: "open",
      status: "READY",
      streamUrl: STREAM,
      controlledBy: { kind: "agent", label: "Ada" },
    });
    expireComputerConnectingHoldForTests();
    paint(container, host);
    const letterbox = container.querySelector<HTMLElement>(".computer-preview__letterbox");
    expect(letterbox).toBeTruthy();
    expect(letterbox?.getAttribute("style") ?? "").not.toContain("position");
    expect(letterbox?.style.position ?? "").not.toBe("relative");
  });

  it("shows 接管 on sibling session when another chat holds takeover (not false 交还)", () => {
    const hostA = createHost("agent:market:main");
    beginAgentComputerUse(hostA, "市场助手");
    applyServerComputerPreview({
      tenantId: "tenant-1",
      userId: "user-1",
      sessionKey: hostA.sessionKey,
      action: "open",
      status: "READY",
      streamUrl: STREAM,
      controlledBy: { kind: "agent", label: "市场助手" },
    });
    expireComputerConnectingHoldForTests();
    takeoverComputerPreview(hostA, "You");
    paint(container, hostA);
    expect(container.querySelector("[data-testid=computer-handback]")).toBeTruthy();

    const hostB = createHost("agent:skill:main");
    hostB.sidebarOpen = true;
    hostB.sidebarSurface = "computer";
    paint(container, hostB);
    const modelB = readComputerPreviewModel(hostB, { tenantId: "tenant-1", userId: "user-1" });
    expect(modelB.userTakeover).toBe(true);
    expect(modelB.controlsDesktop).toBe(false);
    expect(modelB.streamUrl).toBeNull();
    expect(container.querySelector("[data-testid=computer-takeover]")).toBeTruthy();
    expect(container.querySelector("[data-testid=computer-handback]")).toBeNull();
  });

  it("takeover clears input grant so openPlan remints takeControl token", () => {
    const host = createHost();
    beginAgentComputerUse(host, "Ada");
    applyServerComputerPreview({
      tenantId: "tenant-1",
      userId: "user-1",
      sessionKey: host.sessionKey,
      action: "open",
      status: "READY",
      streamUrl: STREAM,
      grantsInput: true,
      controlledBy: { kind: "user", label: "You" },
    });
    takeoverComputerPreview(host, "You");
    // Stale inputGrantLive must not status-skip — force open+takeControl.
    expect(computerPreviewOpenPlan(host, { action: "open", userLabel: "You" })).toEqual({
      action: "open",
      takeControl: true,
      releaseControl: false,
    });
  });

  it("syncComputerPreviewAfterSessionSwitch refreshes when 电脑 dock is open", () => {
    const host = createHost("agent:skill:main") as ComputerPreviewChrome & {
      refreshAccountComputerPreview?: (action: "open" | "status" | "end") => void;
    };
    host.sidebarOpen = true;
    host.sidebarSurface = "computer";
    const refresh = vi.fn();
    host.refreshAccountComputerPreview = refresh;
    syncComputerPreviewAfterSessionSwitch(host);
    expect(refresh).toHaveBeenCalledWith("open");

    refresh.mockClear();
    host.sidebarSurface = "artifact";
    syncComputerPreviewAfterSessionSwitch(host);
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("computer strip display name (DESKTOP_COMPUTER_STRIP_DISPLAY_NAME_M1)", () => {
  it("prefers roster agent.name when session identity is DEFAULT Assistant", () => {
    const display = resolveComputerOperatorDisplay(
      { operator: { kind: "agent", label: "bot-2" } },
      { name: "Assistant", agentId: "bot-2", avatar: "A" },
      [{ id: "bot-2", name: "市场助手" }],
    );
    expect(display).toEqual({ kind: "agent", name: "市场助手", avatar: null });
  });

  it("keeps Skill孵化 when identity.name is already set", () => {
    const display = resolveComputerOperatorDisplay(
      { operator: { kind: "agent", label: "skill-hatch" } },
      { name: "Skill孵化", agentId: "skill-hatch", avatar: "技" },
      [{ id: "skill-hatch", name: "roster-unused", identity: { name: "Skill孵化", avatar: "技" } }],
    );
    expect(display).toEqual({ kind: "agent", name: "Skill孵化", avatar: "技" });
  });

  it("returns null (no DEFAULT pill) when neither identity nor roster name exists", () => {
    const display = resolveComputerOperatorDisplay(
      { operator: { kind: "agent", label: "bot-x" } },
      { name: "Assistant", agentId: "bot-x", avatar: "A" },
      [{ id: "bot-x", name: "bot-x" }],
    );
    expect(display).toBeNull();
  });

  it("uses roster identity.name || name for the open bot even during takeover", () => {
    const display = resolveComputerOperatorDisplay(
      { operator: { kind: "user", label: "你" } },
      { name: "Assistant", agentId: "bot-2", avatar: "A" },
      [{ id: "bot-2", name: "市场助手", identity: { avatar: "市" } }],
    );
    expect(display).toEqual({ kind: "agent", name: "市场助手", avatar: "市" });
  });
});
