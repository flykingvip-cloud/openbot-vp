import {
  computeHealthSummary,
  reportHealthSample,
  toFriendlyLabel,
} from "../../controllers/skill-health.ts";

export const skillHealthCapability = {
  report: reportHealthSample,
  compute: computeHealthSummary,
  friendlyLabel: toFriendlyLabel,
} as const;
