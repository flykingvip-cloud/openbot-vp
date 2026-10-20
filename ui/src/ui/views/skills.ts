import type { SkillMessageMap } from "../controllers/skills.ts";
import type { SkillStatusReport } from "../types.ts";

/** Shared skills contract for platform capability governance (not a standalone page renderer). */
export type SkillsProps = {
  loading: boolean;
  report: SkillStatusReport | null;
  error: string | null;
  canManage?: boolean;
  readOnlyReason?: string | null;
  filter: string;
  edits: Record<string, string>;
  busyKey: string | null;
  messages: SkillMessageMap;
  onFilterChange: (next: string) => void;
  onRefresh: () => void;
  onToggle: (skillKey: string, enabled: boolean) => void;
  onEdit: (skillKey: string, value: string) => void;
  onSaveKey: (skillKey: string) => void;
  onInstall: (skillKey: string, name: string, installId: string) => void;
};
