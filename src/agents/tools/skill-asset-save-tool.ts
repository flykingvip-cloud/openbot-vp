/**
 * Agent solver for 「纳入资产 / 我的资产」: persist a workspace skill (or inline
 * body) into the personal skill-asset store that backs employee 我的资产.
 *
 * Prefer this over inventing gateway.RPC calls or copying into /account/skills
 * (sandbox remount for reads — not the asset registry).
 */
import fs from "node:fs";
import path from "node:path";
import { Type } from "@sinclair/typebox";
import { recordUserInitiatedSave } from "../../gateway/asset-incubation-adoption-store.js";
import { triggerAssetCuration } from "../../gateway/skill-asset-curation-trigger.js";
import { saveSkillAsset, SkillAssetStoreError } from "../../gateway/skill-lifecycle-store.js";
import { resolveAgentIdFromSessionKey } from "../../routing/session-key.js";
import { resolveWorkspaceRoot } from "../workspace-dir.js";
import type { AnyAgentTool } from "./common.js";
import { jsonResult, ToolInputError } from "./common.js";

const SkillAssetSaveToolSchema = Type.Object({
  name: Type.Optional(
    Type.String({
      description: "Asset display name. Defaults to SKILL.md frontmatter name or folder name.",
    }),
  ),
  summary: Type.Optional(
    Type.String({
      description:
        "One-line description for 我的资产. Defaults to SKILL.md frontmatter description.",
    }),
  ),
  skillPath: Type.Optional(
    Type.String({
      description:
        "Workspace-relative path to SKILL.md (e.g. skills/comment-reply-post/SKILL.md). Preferred when the skill already lives under workspace skills/.",
    }),
  ),
  content: Type.Optional(
    Type.String({
      description: "Inline SKILL.md body when skillPath is unavailable. Prefer skillPath.",
    }),
  ),
  confirmed: Type.Boolean({
    description: "Must be true — medium-risk write into the user's 我的资产.",
  }),
});

function resolveOwnerKey(user?: string | null, platformUserId?: string | null): string {
  const platform = platformUserId?.trim();
  if (platform) {
    return platform;
  }
  const trimmed = user?.trim().toLowerCase();
  if (!trimmed) {
    throw new ToolInputError("authenticated user required to save into 我的资产");
  }
  return trimmed;
}

function resolveSourceAgentId(options?: {
  agentSessionKey?: string;
  requesterAgentIdOverride?: string;
}): string {
  const override = options?.requesterAgentIdOverride?.trim();
  if (override) {
    return override;
  }
  const fromSession = resolveAgentIdFromSessionKey(options?.agentSessionKey);
  return fromSession?.trim() || "main";
}

type Frontmatter = { name?: string; description?: string; body: string };

function parseSkillMarkdown(raw: string): Frontmatter {
  const text = raw.replace(/^\uFEFF/, "");
  if (!text.startsWith("---")) {
    return { body: text };
  }
  const end = text.indexOf("\n---", 3);
  if (end < 0) {
    return { body: text };
  }
  const fm = text.slice(3, end).trim();
  const body = text.slice(end + 4).replace(/^\r?\n/, "");
  let name: string | undefined;
  let description: string | undefined;
  for (const line of fm.split(/\r?\n/)) {
    const nameMatch = line.match(/^name:\s*(.+)$/);
    if (nameMatch) {
      name = nameMatch[1]?.trim().replace(/^["']|["']$/g, "");
      continue;
    }
    const descMatch = line.match(/^description:\s*(.+)$/);
    if (descMatch) {
      description = descMatch[1]?.trim().replace(/^["']|["']$/g, "");
    }
  }
  return { name, description, body };
}

function resolveSkillFile(workspaceDir: string, skillPath: string): string {
  const root = path.resolve(workspaceDir);
  const cleaned = skillPath.trim().replace(/^\/+/, "");
  if (!cleaned || cleaned.includes("\0")) {
    throw new ToolInputError("skillPath is required and must be a relative workspace path");
  }
  if (path.isAbsolute(skillPath.trim()) || cleaned === ".." || cleaned.startsWith("../")) {
    throw new ToolInputError("skillPath must stay inside the agent workspace");
  }
  const segments = cleaned.split(/[\\/]/);
  if (segments.some((seg) => seg === "..")) {
    throw new ToolInputError("skillPath must stay inside the agent workspace");
  }
  const resolved = path.resolve(root, cleaned);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new ToolInputError("skillPath escapes the agent workspace");
  }
  return resolved;
}

function folderNameFromSkillPath(skillPath: string): string {
  const parts = skillPath.replace(/\\/g, "/").split("/").filter(Boolean);
  if (parts.length >= 2 && parts[parts.length - 1]?.toLowerCase() === "skill.md") {
    return parts[parts.length - 2] ?? "skill";
  }
  return parts[parts.length - 1]?.replace(/\.md$/i, "") || "skill";
}

/**
 * Persist a curated skill into 我的资产 (personal skill accumulation).
 * Call when the user asks to 纳入资产 / 收录为资产 / 注册技能资产 — after the
 * workspace SKILL.md exists (or with inline content).
 */
export function createSkillAssetSaveTool(options?: {
  agentSessionKey?: string;
  requesterAgentIdOverride?: string;
  gatewayClientUser?: string;
  gatewayClientPlatformUserId?: string;
  workspaceDir?: string;
}): AnyAgentTool {
  return {
    name: "skill_asset_save",
    label: "Save Skill to My Assets",
    description:
      "Submit a workspace skill into 我的资产 (personal skill assets) so it can be curated, installed, and later shared to the enterprise. Use when the user asks to 纳入资产 / 收录为资产 / 通过技能资产注册流程导入. Prefer skillPath under workspace skills/; do not copy to /account/skills (read remount only). Requires confirmed=true.",
    parameters: SkillAssetSaveToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      if (params.confirmed !== true) {
        throw new ToolInputError("confirmed must be true to save into 我的资产");
      }

      const workspaceDir = resolveWorkspaceRoot(options?.workspaceDir);
      const skillPathRaw = typeof params.skillPath === "string" ? params.skillPath.trim() : "";
      const inlineContent = typeof params.content === "string" ? params.content : "";

      let rawMarkdown = inlineContent;
      let contextId = `agent-skill-save:${Date.now()}`;
      let folderHint = "skill";

      if (skillPathRaw) {
        const abs = resolveSkillFile(workspaceDir, skillPathRaw);
        if (!fs.existsSync(abs)) {
          throw new ToolInputError(`skill file not found: ${skillPathRaw}`);
        }
        const stat = fs.statSync(abs);
        if (!stat.isFile() || stat.size <= 0) {
          throw new ToolInputError(
            `skill file is empty or not a file: ${skillPathRaw} — write SKILL.md first`,
          );
        }
        rawMarkdown = fs.readFileSync(abs, "utf8");
        if (!rawMarkdown.trim()) {
          throw new ToolInputError(`skill file has no content: ${skillPathRaw}`);
        }
        folderHint = folderNameFromSkillPath(skillPathRaw);
        contextId = `workspace-skill:${folderHint}`;
      }

      if (!rawMarkdown.trim()) {
        throw new ToolInputError("provide skillPath to an existing SKILL.md or non-empty content");
      }

      const parsed = parseSkillMarkdown(rawMarkdown);
      const name =
        (typeof params.name === "string" && params.name.trim()) ||
        parsed.name?.trim() ||
        folderHint;
      const summary =
        (typeof params.summary === "string" && params.summary.trim()) ||
        parsed.description?.trim() ||
        `Workspace skill ${folderHint}`;

      if (!name || !summary) {
        throw new ToolInputError("name and summary are required (or provide SKILL.md frontmatter)");
      }

      const ownerUserId = resolveOwnerKey(
        options?.gatewayClientUser,
        options?.gatewayClientPlatformUserId,
      );
      const sourceAgentId = resolveSourceAgentId(options);

      try {
        const result = saveSkillAsset({
          sourceAgentId,
          ownerUserId,
          contextId,
          lifecycle: "draft",
          profile: {
            name: name.slice(0, 120),
            summary: summary.slice(0, 500),
            visibility: "private",
            assetType: "capability",
            category: "skill",
            tags: ["workspace-skill", folderHint].slice(0, 10),
            outputDescription: summary.slice(0, 500),
          },
          runtimeDefinition: {
            prompts: [rawMarkdown.slice(0, 100_000)],
            tools: [],
          },
          autoInstallEnabled: false,
        });

        recordUserInitiatedSave({
          ownerKey: ownerUserId,
          contextId,
          capabilityId: result.skillId,
        });

        void triggerAssetCuration({
          skillId: result.skillId,
          sourceAgentId,
        }).catch(() => undefined);

        return jsonResult({
          ok: true,
          skillId: result.skillId,
          name: result.detail.profile.name,
          summary: result.detail.profile.summary,
          lifecycle: result.detail.lifecycle,
          surface: "我的资产",
          next: "Asset is in 我的资产 as a draft. User can refine there, install to a robot, then submit-to-enterprise for org-wide reuse.",
        });
      } catch (error) {
        if (error instanceof SkillAssetStoreError) {
          throw new ToolInputError(error.message);
        }
        throw error;
      }
    },
  };
}
