import {
  applyUserProfileDelta,
  DEFAULT_USER_PROFILE,
  type PreferenceDirective,
  type PreferenceDirectiveKind,
  type UserProfile,
  type UserProfileEffectStatus,
  type UserProfileField,
} from "./types.js";

export type UserInteractionSignals = {
  directives?: PreferenceDirective[];
  replyLanguage?: string | null;
  preferredTimezone?: string | null;
};

const TIMEZONE_HINTS: Array<{ tz: string; patterns: RegExp[] }> = [
  {
    tz: "Asia/Shanghai",
    patterns: [/北京时间/u, /东八区/u, /UTC\+8/u, /GMT\+8/u, /Asia\/Shanghai/u, /中国时间/u],
  },
  {
    tz: "Asia/Hong_Kong",
    patterns: [/香港时间/u, /Asia\/Hong_Kong/u],
  },
  {
    tz: "America/New_York",
    patterns: [/美东时间/u, /Eastern Time/u, /America\/New_York/u],
  },
  {
    tz: "America/Los_Angeles",
    patterns: [/美西时间/u, /Pacific Time/u, /America\/Los_Angeles/u],
  },
  {
    tz: "Europe/London",
    patterns: [/伦敦时间/u, /Europe\/London/u],
  },
];

const DIRECTIVE_PATTERNS: Array<{
  kind: PreferenceDirectiveKind;
  patterns: RegExp[];
}> = [
  {
    kind: "concise",
    patterns: [
      /\b(concise|brief|short|keep it short|be concise)\b/i,
      /简洁|简短|精简|少说|简短点|简洁点|言简意赅/,
    ],
  },
  {
    kind: "detailed",
    patterns: [/\b(detailed|thorough|in depth|more detail)\b/i, /详细|详尽|细致|详细点|说详细/],
  },
  {
    kind: "structured",
    patterns: [/\b(structured|bullet|outline|step by step)\b/i, /结构化|分点|条理|列点/],
  },
  {
    kind: "conversational",
    patterns: [/\b(conversational|casual|chatty)\b/i, /口语|聊天感|随意点/],
  },
  {
    kind: "reply_english",
    patterns: [
      /\breply in english\b/i,
      /\brespond in english\b/i,
      /\buse english\b/i,
      /用英文|用英语|英文回复|英语回复/,
    ],
  },
  {
    kind: "reply_chinese",
    patterns: [/\breply in chinese\b/i, /\brespond in chinese\b/i, /用中文|中文回复|汉语回复/],
  },
  {
    kind: "proactive",
    patterns: [
      /\b(just do it|don't ask|stop asking|act autonomously)\b/i,
      /别老问|不要问|直接做|别每次都问|不用确认/,
    ],
  },
  {
    kind: "confirm_first",
    patterns: [
      /\b(ask before|confirm before|check with me first)\b/i,
      /先确认|先问我|别擅自|不要擅自/,
    ],
  },
  {
    kind: "formal",
    patterns: [/\b(formal|professional tone)\b/i, /正式|严肃|专业一点/],
  },
  {
    kind: "friendly",
    patterns: [/\b(friendly|warm tone)\b/i, /友好|亲切|温暖一点/],
  },
  {
    kind: "verbose",
    patterns: [/\b(verbose|expand|elaborate)\b/i, /多说|详细说明|展开讲/],
  },
  {
    kind: "terse",
    patterns: [/\b(terse|tldr|too long)\b/i, /太长|精简回复|少说废话/],
  },
];

/** Deterministic explicit preference detection (zh/en). */
export function detectUserPreferenceDirectives(text: string): PreferenceDirective[] {
  const trimmed = text.trim();
  if (!trimmed) {
    return [];
  }
  const found: PreferenceDirective[] = [];
  const seen = new Set<PreferenceDirectiveKind>();
  for (const rule of DIRECTIVE_PATTERNS) {
    for (const pattern of rule.patterns) {
      const match = trimmed.match(pattern);
      if (match && !seen.has(rule.kind)) {
        seen.add(rule.kind);
        found.push({ kind: rule.kind, matched: match[0] });
        break;
      }
    }
  }
  return found;
}

/** Lightweight deterministic language hint (no LLM). */
export function detectReplyLanguage(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }
  const han = (trimmed.match(/[\u4e00-\u9fff]/g) ?? []).length;
  const latin = (trimmed.match(/[A-Za-z]/g) ?? []).length;
  if (han >= 2 && latin === 0) {
    return "zh";
  }
  if (han >= 4 && han > latin) {
    return "zh";
  }
  if (latin >= 12 && latin > han * 2) {
    return "en";
  }
  return null;
}

/** Detect explicit IANA or common zh/en timezone hints from user text. */
export function detectPreferredTimezone(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }
  const iana = trimmed.match(/\b([A-Za-z_]+\/[A-Za-z_]+(?:\/[A-Za-z_]+)?)\b/u);
  if (iana?.[1]) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: iana[1] }).format(new Date());
      return iana[1];
    } catch {
      // fall through to phrase hints
    }
  }
  for (const hint of TIMEZONE_HINTS) {
    if (hint.patterns.some((pattern) => pattern.test(trimmed))) {
      return hint.tz;
    }
  }
  return null;
}

function bumpObservation(current: UserProfile, field: UserProfileField): Partial<UserProfile> {
  const count = (current.observations[field] ?? 0) + 1;
  return { observations: { ...current.observations, [field]: count } };
}

function directiveDelta(current: UserProfile, kind: PreferenceDirectiveKind): Partial<UserProfile> {
  switch (kind) {
    case "concise":
      return {
        ...bumpObservation(current, "preferredOutputFormat"),
        ...bumpObservation(current, "verbosity"),
        preferredOutputFormat: "concise",
        verbosity: "terse",
      };
    case "detailed":
      return {
        ...bumpObservation(current, "preferredOutputFormat"),
        ...bumpObservation(current, "verbosity"),
        preferredOutputFormat: "detailed",
        verbosity: "verbose",
      };
    case "structured":
      return {
        ...bumpObservation(current, "preferredOutputFormat"),
        preferredOutputFormat: "structured",
      };
    case "conversational":
      return {
        ...bumpObservation(current, "preferredOutputFormat"),
        preferredOutputFormat: "conversational",
      };
    case "reply_english":
      return {
        ...bumpObservation(current, "preferredReplyLanguage"),
        preferredReplyLanguage: "en",
      };
    case "reply_chinese":
      return {
        ...bumpObservation(current, "preferredReplyLanguage"),
        preferredReplyLanguage: "zh",
      };
    case "proactive":
      return {
        ...bumpObservation(current, "confirmationPreference"),
        confirmationPreference: "proactive",
      };
    case "confirm_first":
      return {
        ...bumpObservation(current, "confirmationPreference"),
        confirmationPreference: "confirm_first",
      };
    case "formal":
      return {
        ...bumpObservation(current, "preferredTone"),
        preferredTone: "formal",
      };
    case "friendly":
      return {
        ...bumpObservation(current, "preferredTone"),
        preferredTone: "friendly",
      };
    case "verbose":
      return {
        ...bumpObservation(current, "verbosity"),
        verbosity: "verbose",
      };
    case "terse":
      return {
        ...bumpObservation(current, "verbosity"),
        verbosity: "terse",
      };
    default:
      return {};
  }
}

/**
 * Map explicit signals → profile delta. Explicit directives apply immediately (≥1 hit).
 * Language-only hints apply on the first detected observation (per-turn lock covers cold start).
 */
export function deriveUserProfileDelta(
  current: UserProfile,
  signals: UserInteractionSignals,
): Partial<UserProfile> {
  let working = { ...DEFAULT_USER_PROFILE, ...current };
  let delta: Partial<UserProfile> = {};

  for (const directive of signals.directives ?? []) {
    const piece = directiveDelta(working, directive.kind);
    if (Object.keys(piece).length === 0) {
      continue;
    }
    working = applyUserProfileDelta(working, piece);
    delta = applyUserProfileDelta(
      { ...DEFAULT_USER_PROFILE, ...delta, observations: delta.observations ?? {} },
      piece,
    );
  }

  const lang = signals.replyLanguage?.trim();
  if (lang && lang !== working.preferredReplyLanguage) {
    const obsField: UserProfileField = "preferredReplyLanguage";
    const nextCount = (working.observations[obsField] ?? 0) + 1;
    const langPiece: Partial<UserProfile> = {
      observations: { ...working.observations, [obsField]: nextCount },
    };
    const hasExplicitLangDirective = (signals.directives ?? []).some((d) =>
      d.kind.startsWith("reply_"),
    );
    if (hasExplicitLangDirective || nextCount >= 1) {
      langPiece.preferredReplyLanguage = lang;
    }
    working = applyUserProfileDelta(working, langPiece);
    delta = applyUserProfileDelta(
      { ...DEFAULT_USER_PROFILE, ...delta, observations: delta.observations ?? {} },
      langPiece,
    );
  }

  const tz = signals.preferredTimezone?.trim();
  if (tz && tz !== working.preferredTimezone) {
    const obsField: UserProfileField = "preferredTimezone";
    const nextCount = (working.observations[obsField] ?? 0) + 1;
    const tzPiece: Partial<UserProfile> = {
      observations: { ...working.observations, [obsField]: nextCount },
    };
    if (nextCount >= 1) {
      tzPiece.preferredTimezone = tz;
    }
    working = applyUserProfileDelta(working, tzPiece);
    delta = applyUserProfileDelta(
      { ...DEFAULT_USER_PROFILE, ...delta, observations: delta.observations ?? {} },
      tzPiece,
    );
  }

  const keys: UserProfileField[] = [
    "preferredReplyLanguage",
    "preferredTimezone",
    "preferredOutputFormat",
    "preferredTone",
    "confirmationPreference",
    "verbosity",
  ];
  const trimmed: Partial<UserProfile> = { observations: delta.observations ?? {} };
  for (const key of keys) {
    if (delta[key] !== undefined && delta[key] !== current[key]) {
      (trimmed as Record<string, unknown>)[key] = delta[key];
    }
  }
  if (
    Object.keys(trimmed.observations ?? {}).length === 0 &&
    keys.every((k) => trimmed[k] === undefined)
  ) {
    return {};
  }
  return trimmed;
}

/** Friction proxy: recurring directives that match fields we already changed. */
export function countRecurringDirectiveFriction(
  appliedDelta: Partial<UserProfile>,
  directives: PreferenceDirective[],
): number {
  if (!directives.length) {
    return 0;
  }
  let count = 0;
  for (const directive of directives) {
    switch (directive.kind) {
      case "concise":
      case "terse":
        if (
          appliedDelta.preferredOutputFormat === "concise" ||
          appliedDelta.verbosity === "terse"
        ) {
          count += 1;
        }
        break;
      case "detailed":
      case "verbose":
        if (
          appliedDelta.preferredOutputFormat === "detailed" ||
          appliedDelta.verbosity === "verbose"
        ) {
          count += 1;
        }
        break;
      case "reply_english":
        if (appliedDelta.preferredReplyLanguage === "en") {
          count += 1;
        }
        break;
      case "reply_chinese":
        if (appliedDelta.preferredReplyLanguage === "zh") {
          count += 1;
        }
        break;
      case "proactive":
        if (appliedDelta.confirmationPreference === "proactive") {
          count += 1;
        }
        break;
      case "confirm_first":
        if (appliedDelta.confirmationPreference === "confirm_first") {
          count += 1;
        }
        break;
      case "formal":
        if (appliedDelta.preferredTone === "formal") {
          count += 1;
        }
        break;
      case "friendly":
        if (appliedDelta.preferredTone === "friendly") {
          count += 1;
        }
        break;
      default:
        break;
    }
  }
  return count;
}

export function evaluateUserProfileEffect(
  baselineFriction: number | null | undefined,
  currentFriction: number | null | undefined,
  opts?: { minDelta?: number },
): { status: UserProfileEffectStatus; deltaFriction: number | null } {
  const minDelta = opts?.minDelta ?? 1;
  if (typeof baselineFriction !== "number" || typeof currentFriction !== "number") {
    return { status: "inconclusive", deltaFriction: null };
  }
  const deltaFriction = currentFriction - baselineFriction;
  if (Math.abs(deltaFriction) < minDelta) {
    return { status: "inconclusive", deltaFriction };
  }
  // Lower friction is better (user stopped repeating the same ask).
  if (deltaFriction < 0) {
    return { status: "improved", deltaFriction };
  }
  return { status: "regressed", deltaFriction };
}
