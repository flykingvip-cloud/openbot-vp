import type { GroupPromotionPolicy } from "./group-charter-types.js";

export const DEFAULT_GROUP_PROMOTION_POLICY: GroupPromotionPolicy = {
  allowAutoPromote: true,
  requireLifecycleActive: true,
  blockSecretAutoPromote: true,
  dissentEncouraged: true,
};
