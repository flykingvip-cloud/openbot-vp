import type { OpenBotConfig } from "../../config/config.js";
import { userModelingInferEnabled } from "./config.js";
import type { UserInteractionSignals } from "./derive.js";
import type { PreferenceDirectiveKind } from "./types.js";
import type { UserProfile } from "./types.js";

export type UserProfileInferCaller = (prompt: string) => Promise<string | null>;

const ALLOWED_INFER_KINDS: ReadonlySet<PreferenceDirectiveKind> = new Set([
  "concise",
  "detailed",
  "structured",
  "conversational",
  "reply_english",
  "reply_chinese",
  "proactive",
  "confirm_first",
  "formal",
  "friendly",
  "verbose",
  "terse",
]);

/** Build a PII-free summary for optional LLM inference (never includes raw message text). */
export function buildSanitizedInferSummary(params: {
  profile: UserProfile;
  directiveKinds: PreferenceDirectiveKind[];
  replyLanguage: string | null;
}): string {
  return JSON.stringify({
    observations: params.profile.observations,
    profile: {
      preferredReplyLanguage: params.profile.preferredReplyLanguage ?? null,
      preferredOutputFormat: params.profile.preferredOutputFormat,
      preferredTone: params.profile.preferredTone,
      confirmationPreference: params.profile.confirmationPreference,
      verbosity: params.profile.verbosity,
    },
    signals: {
      directiveKinds: params.directiveKinds,
      replyLanguage: params.replyLanguage,
    },
  });
}

function extractJsonObject(raw: string): Record<string, unknown> | null {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  const candidate = fenced ?? raw.trim();
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) {
    return null;
  }
  try {
    const parsed = JSON.parse(candidate.slice(start, end + 1)) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** Parse LLM JSON output into deterministic signals (invalid → empty). */
export function parseInferredUserSignals(raw: string): UserInteractionSignals {
  const parsed = extractJsonObject(raw);
  if (!parsed) {
    return {};
  }
  const directivesRaw = parsed.directives;
  const kinds: PreferenceDirectiveKind[] = [];
  if (Array.isArray(directivesRaw)) {
    for (const entry of directivesRaw) {
      const kind = typeof entry === "string" ? entry.trim() : "";
      if (ALLOWED_INFER_KINDS.has(kind as PreferenceDirectiveKind)) {
        kinds.push(kind as PreferenceDirectiveKind);
      }
    }
  }
  const replyLanguageRaw = parsed.replyLanguage;
  const replyLanguage =
    typeof replyLanguageRaw === "string" && replyLanguageRaw.trim()
      ? replyLanguageRaw.trim().slice(0, 8)
      : null;
  return {
    directives: kinds.map((kind) => ({ kind, matched: "inferred" })),
    replyLanguage,
  };
}

function buildInferPrompt(summary: string): string {
  return [
    "You infer stable user communication preferences from a sanitized summary (no raw messages).",
    "Return ONLY JSON:",
    '{"directives":["concise"|"detailed"|...],"replyLanguage":"zh"|"en"|null}',
    "Pick at most 2 directive kinds that best match long-term preference; omit if uncertain.",
    'Never invent PII. If uncertain, return {"directives":[],"replyLanguage":null}.',
    "",
    "Summary:",
    summary,
  ].join("\n");
}

export async function inferUserProfileSignals(params: {
  cfg: OpenBotConfig;
  profile: UserProfile;
  signals: UserInteractionSignals;
  caller?: UserProfileInferCaller | null;
  tenantId?: string | null;
}): Promise<UserInteractionSignals> {
  if (!userModelingInferEnabled(params.cfg, params.tenantId)) {
    return {};
  }
  const caller = params.caller;
  if (!caller) {
    return {};
  }
  const directiveKinds = (params.signals.directives ?? []).map((d) => d.kind);
  const summary = buildSanitizedInferSummary({
    profile: params.profile,
    directiveKinds,
    replyLanguage: params.signals.replyLanguage ?? null,
  });
  const raw = await caller(buildInferPrompt(summary)).catch(() => null);
  if (!raw?.trim()) {
    return {};
  }
  return parseInferredUserSignals(raw);
}

/** Merge inferred signals into deterministic ones (deterministic wins on conflicts). */
export function mergeUserInteractionSignals(
  primary: UserInteractionSignals,
  secondary: UserInteractionSignals,
): UserInteractionSignals {
  const seen = new Set((primary.directives ?? []).map((d) => d.kind));
  const mergedDirectives = [...(primary.directives ?? [])];
  for (const directive of secondary.directives ?? []) {
    if (!seen.has(directive.kind)) {
      seen.add(directive.kind);
      mergedDirectives.push(directive);
    }
  }
  return {
    directives: mergedDirectives,
    replyLanguage: primary.replyLanguage ?? secondary.replyLanguage ?? null,
  };
}
