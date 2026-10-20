let focusPlanId: string | null = null;
let focusPlanName: string | null = null;

export function setEconomicsFocus(planId: string | null, planName: string | null = null): void {
  focusPlanId = planId;
  focusPlanName = planName;
}

export function getEconomicsFocus(): { planId: string | null; planName: string | null } {
  return { planId: focusPlanId, planName: focusPlanName };
}

export function clearEconomicsFocus(): void {
  focusPlanId = null;
  focusPlanName = null;
}

export function __resetEconomicsFocusForTest(): void {
  clearEconomicsFocus();
}
