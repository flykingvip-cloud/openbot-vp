import { describe, expect, it, vi } from "vitest";
import { t } from "../../../i18n/index.ts";
import type { GrowthStatusView } from "../../controllers/agent-growth.ts";
import type { GatewayBrowserClient } from "../../gateway.ts";
import {
  GROWTH_BIRTH_TURN_PLACEHOLDER,
  LOCAL_GROWTH_OPENING_ID_PREFIX,
  buildNewRobotOpeningGreeting,
  hasAssistantChatMessage,
  isLocalGrowthOpeningMessage,
  maybeTriggerGrowthBirthTurn,
  shouldTriggerGrowthBirthTurn,
  syncGrowthBirthAwakeningState,
} from "./growth-birth-turn-wire.ts";

function growingView(): GrowthStatusView {
  return {
    lifecycleState: "growing",
    dimensions: { identity: 50, capability: 50, knowledge: 0, habits: 0 },
    activationScore: 25,
    operationalScore: null,
    capabilityReadiness: false,
    isActivated: false,
    templateId: "generic_worker",
  };
}

function birthTurnHost(partial: Record<string, unknown> = {}) {
  const request = vi.fn(async () => ({ runId: "run-1" }));
  return {
    connected: true,
    client: { request } as unknown as GatewayBrowserClient,
    sessionKey: "agent:helper:main",
    agentsList: null,
    collaborationSpacesResult: null,
    workbenchTeamSelectedKey: "agent:helper:main",
    workbenchActiveGrowthStatus: growingView(),
    chatMessage: "",
    workbenchPrimaryModule: "assistant" as const,
    workbenchRobotWorkbenchTab: "overview" as const,
    workbenchGroupProfileView: "chat" as const,
    chatLoading: false,
    chatSending: false,
    chatMessages: [] as Array<{ role: string }>,
    chatRunId: null,
    chatStream: null,
    chatStreamSessionKey: null,
    chatStreamStartedAt: null,
    chatThinkingProgress: null,
    lastError: null,
    workbenchGrowthBirthAwakening: false,
    workbenchGrowthBirthTurnSentKey: null,
    requestUpdate: vi.fn(),
    requestMock: request,
    ...partial,
  };
}

describe("growth birth turn wire", () => {
  it("detects assistant messages", () => {
    expect(hasAssistantChatMessage([])).toBe(false);
    expect(hasAssistantChatMessage([{ role: "user" }, { role: "assistant" }])).toBe(true);
    const opening = {
      id: `${LOCAL_GROWTH_OPENING_ID_PREFIX}agent:helper:main`,
      role: "assistant",
    };
    expect(isLocalGrowthOpeningMessage(opening)).toBe(true);
    expect(hasAssistantChatMessage([opening])).toBe(false);
  });

  it("shouldTrigger only for robot birth/growing prelude without assistant", () => {
    expect(shouldTriggerGrowthBirthTurn(birthTurnHost())).toBe(true);
    expect(
      shouldTriggerGrowthBirthTurn(
        birthTurnHost({
          workbenchActiveGrowthStatus: { ...growingView(), lifecycleState: "activated" },
        }),
      ),
    ).toBe(false);
    expect(
      shouldTriggerGrowthBirthTurn(birthTurnHost({ chatMessages: [{ role: "assistant" }] })),
    ).toBe(false);
    expect(
      shouldTriggerGrowthBirthTurn(
        birthTurnHost({
          chatMessages: [
            {
              id: `${LOCAL_GROWTH_OPENING_ID_PREFIX}agent:helper:main`,
              role: "assistant",
            },
          ],
        }),
      ),
    ).toBe(true);
    expect(
      shouldTriggerGrowthBirthTurn(
        birthTurnHost({ workbenchGrowthBirthTurnSentKey: "agent:helper:main" }),
      ),
    ).toBe(false);
  });

  it("maybeTrigger sends growthBirthTurn placeholder once", async () => {
    const host = birthTurnHost();
    await maybeTriggerGrowthBirthTurn(host);
    expect(host.workbenchGrowthBirthTurnSentKey).toBe("agent:helper:main");
    const opening = host.chatMessages.find((entry) => isLocalGrowthOpeningMessage(entry));
    expect(opening).toMatchObject({ role: "assistant" });
    const openingText =
      opening && "content" in opening
        ? (opening as { content: Array<{ text?: string }> }).content[0]?.text
        : "";
    expect(openingText).toBe(
      buildNewRobotOpeningGreeting(t("frontstage.workbench.growth.defaultRoleName")),
    );
    expect(openingText).toMatch(/identity|身份/);
    expect(host.requestMock).toHaveBeenCalledWith(
      "chat.send",
      expect.objectContaining({
        sessionKey: "agent:helper:main",
        message: GROWTH_BIRTH_TURN_PLACEHOLDER,
        growthBirthTurn: true,
      }),
    );
    await maybeTriggerGrowthBirthTurn(host);
    expect(host.requestMock).toHaveBeenCalledTimes(1);
  });

  it("syncGrowthBirthAwakeningState clears awakening after assistant reply", () => {
    const host = birthTurnHost({ workbenchGrowthBirthAwakening: true });
    syncGrowthBirthAwakeningState(host);
    expect(host.workbenchGrowthBirthAwakening).toBe(true);
    host.chatMessages = [{ role: "assistant" }] as Array<{ role: string }>;
    syncGrowthBirthAwakeningState(host);
    expect(host.workbenchGrowthBirthAwakening).toBe(false);
  });
});
