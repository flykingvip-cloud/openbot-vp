export type CommunicationTone = "neutral" | "formal" | "friendly";
export type OutputFormatPreference = "structured" | "concise" | "detailed" | "conversational";

export type ConfirmationPreference = "proactive" | "confirm_first";
export type Verbosity = "terse" | "normal" | "verbose";

export type UserProfileField = keyof Omit<UserProfile, "observations">;

export interface UserProfile {
  preferredReplyLanguage?: string;
  /** IANA timezone (e.g. Asia/Shanghai) learned from explicit user preference. */
  preferredTimezone?: string;
  preferredOutputFormat: OutputFormatPreference;
  preferredTone: CommunicationTone;
  confirmationPreference: ConfirmationPreference;
  verbosity: Verbosity;
  observations: Partial<Record<UserProfileField, number>>;
}

export const DEFAULT_USER_PROFILE: UserProfile = {
  preferredOutputFormat: "structured",
  preferredTone: "neutral",
  confirmationPreference: "confirm_first",
  verbosity: "normal",
  observations: {},
};

export type PreferenceDirectiveKind =
  | "concise"
  | "detailed"
  | "structured"
  | "conversational"
  | "reply_english"
  | "reply_chinese"
  | "proactive"
  | "confirm_first"
  | "formal"
  | "friendly"
  | "verbose"
  | "terse";

export type PreferenceDirective = {
  kind: PreferenceDirectiveKind;
  /** Short evidence snippet for debugging (not persisted). */
  matched: string;
};

export type UserProfileEffectStatus = "improved" | "regressed" | "inconclusive";

export type UserProfileChangeRecord = {
  changedAtMs: number;
  baselineFriction: number | null;
  appliedDelta: Partial<UserProfile>;
  previousValues?: Partial<UserProfile>;
  assessedAtMs: number | null;
  effectStatus?: UserProfileEffectStatus;
  deltaFriction?: number | null;
  rolledBack?: boolean;
};

export type UserProfileSuppression = {
  suppressedDelta: Partial<UserProfile>;
  suppressedAtMs: number;
};

export function applyUserProfileDelta(
  current: UserProfile,
  delta: Partial<UserProfile>,
): UserProfile {
  const nextObs = { ...current.observations, ...delta.observations };
  const { observations: _dropObs, ...restDelta } = delta;
  return {
    ...current,
    ...restDelta,
    observations: nextObs,
  };
}

export function sameUserProfileDelta(a: Partial<UserProfile>, b: Partial<UserProfile>): boolean {
  const keys: UserProfileField[] = [
    "preferredReplyLanguage",
    "preferredTimezone",
    "preferredOutputFormat",
    "preferredTone",
    "confirmationPreference",
    "verbosity",
  ];
  return keys.every((key) => a[key] === b[key]);
}
