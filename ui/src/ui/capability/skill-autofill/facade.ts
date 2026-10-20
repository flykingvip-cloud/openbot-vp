import {
  fetchAutofillResult,
  isEmptyAutofill,
  startAutofill,
  type SkillAutofillState,
} from "../../controllers/skill-autofill.ts";

export type SkillAutofillCapabilityState = SkillAutofillState;

export const skillAutofillCapability = {
  start: startAutofill,
  fetchResult: fetchAutofillResult,
  isEmpty: isEmptyAutofill,
} as const;
