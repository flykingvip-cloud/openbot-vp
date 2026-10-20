export const COLLABORATION_WORK_MISSION_TEXT = "围绕研究、内容、能力孵化任务进行协同决策与执行";

export function isOnboardingIntroductionMission(mission: string | null | undefined) {
  const normalized = mission?.replace(/\s+/g, "") ?? "";
  if (!normalized) {
    return false;
  }
  return (
    normalized.includes("介绍") ||
    normalized.includes("认识") ||
    normalized.includes("协作上下文") ||
    normalized.toLowerCase().includes("onboarding")
  );
}

export function suggestWorkMissionAfterOnboarding() {
  return COLLABORATION_WORK_MISSION_TEXT;
}
