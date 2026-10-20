/**
 * Bridge: Account Computer SiteSkillDraft → skill-lifecycle draft asset.
 * Never auto-approves or publishes — curation stays human-gated.
 */
import { saveSkillAsset } from "../gateway/skill-lifecycle-store.js";

export const DESKTOP_TAKEOVER_SITEHOST_SKILL_LANDING =
  "DESKTOP_TAKEOVER_SITEHOST_SKILL_M1" as const;

/** Mirrors ui SiteSkillDraft shape (kept local to avoid UI↔src import). */
export type TakeoverSiteSkillDraftInput = {
  siteHost: string;
  title: string;
  lesson: string;
  capabilities: string[];
};

export type PersistTakeoverSiteSkillDraftOpts = {
  sourceAgentId?: string | null;
  ownerUserId?: string | null;
  skillId?: string;
};

/**
 * Persist a takeover lesson as lifecycle=draft only.
 * contextId is stable per siteHost for later curation grouping.
 */
export function persistTakeoverSiteSkillDraft(
  draft: TakeoverSiteSkillDraftInput,
  opts: PersistTakeoverSiteSkillDraftOpts = {},
): { skillId: string } {
  const siteHost = draft.siteHost.trim().toLowerCase();
  if (!siteHost) {
    throw new Error("takeover skill draft requires siteHost");
  }
  const title = (draft.title ?? "").trim() || `Takeover lesson · ${siteHost}`;
  const lesson = (draft.lesson ?? "").trim() || `Human takeover lesson on ${siteHost}.`;
  const capabilities = Array.isArray(draft.capabilities)
    ? draft.capabilities.map((c) => String(c).trim()).filter(Boolean)
    : [];

  const { skillId } = saveSkillAsset({
    sourceAgentId: opts.sourceAgentId ?? null,
    ownerUserId: opts.ownerUserId ?? null,
    contextId: `account-computer:takeover:${siteHost}`,
    lifecycle: "draft",
    ...(opts.skillId ? { skillId: opts.skillId } : {}),
    profile: {
      name: title.slice(0, 120),
      summary: lesson.slice(0, 500),
      assetType: "capability",
      tags: ["account-computer", "takeover-learning", siteHost].slice(0, 10),
      category: "desktop",
      visibility: "private",
    },
    runtimeDefinition: {
      prompts: [lesson],
      tools: capabilities.length > 0 ? capabilities : ["desktop.takeover", "desktop.hand_back"],
    },
    autoInstallEnabled: false,
  });
  return { skillId };
}
