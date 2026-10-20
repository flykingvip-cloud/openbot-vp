import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { ExternalEffectDomainReader } from "@openbot/evolution-core";
import type { OpenBotConfig } from "../../../config/config.js";
import { DEFAULT_WORKING_STYLE, type WorkingStyle } from "../../agent-growth/genome.js";
import {
  readRobotWorkingStyle,
  resolveRobotWorkingStylePath,
} from "../../agent-growth/working-style-store.js";
import { readSkillInvocationEvents } from "../../skill-invocation/event-store.js";
import {
  getPersonalSkillAssetDetail,
  listRobotSkillAssets,
  SkillAssetStoreError,
} from "../../skill-lifecycle-store.js";

function styleVersion(style: WorkingStyle): string {
  return `style:${style.outputFormat}:${style.reportingCadence}:${style.decisionPreference}:${style.riskPreference}:${style.communicationTone}`;
}

function styleHash(style: WorkingStyle): string {
  return createHash("sha256").update(JSON.stringify(style)).digest("hex");
}

export function createReadonlyEvolutionDomainReader(input?: {
  styleConfig?: OpenBotConfig;
  skillEventsConfigDir?: string;
}): ExternalEffectDomainReader {
  return {
    async readWorkingStyle(agentId) {
      const cfg = input?.styleConfig;
      if (!cfg) {
        return { status: "unreadable" };
      }
      const filePath = resolveRobotWorkingStylePath(cfg, agentId);
      let raw: string;
      try {
        raw = await readFile(filePath, "utf8");
      } catch {
        return { status: "missing" };
      }
      const stored = await readRobotWorkingStyle(cfg, agentId);
      if (!stored) {
        return { status: "unreadable" };
      }
      const style = { ...DEFAULT_WORKING_STYLE, ...stored };
      return {
        status: "ok",
        version: styleVersion(style),
        hash: styleHash(style),
        rawLength: raw.length,
        fieldValue: style,
      };
    },
    async readSkillInstallation({ agentId, skillId }) {
      let skill: ReturnType<typeof getPersonalSkillAssetDetail>;
      try {
        skill = getPersonalSkillAssetDetail(skillId);
      } catch (error) {
        if (error instanceof SkillAssetStoreError && /not found/.test(error.message)) {
          return { status: "missing" };
        }
        return { status: "unreadable" };
      }
      const entry = listRobotSkillAssets(agentId).find((row) => row.id === skillId);
      if (!entry) {
        return { status: "missing" };
      }
      return {
        status: "ok",
        agentId,
        skillId,
        installedVersion: entry.installedVersion,
        enabled: entry.enabled,
        skillVersion: `skill:${skill.lifecycle}:${skill.version}`,
      };
    },
    async readAgentTenantEvidence(agentId) {
      const tenants = new Set(
        readSkillInvocationEvents({
          agentId,
          ...(input?.skillEventsConfigDir ? { configDir: input.skillEventsConfigDir } : {}),
        })
          .map((event) => ("tenantId" in event ? event.tenantId?.trim() : undefined))
          .filter((value): value is string => Boolean(value)),
      );
      if (tenants.size === 0) {
        return { status: "unavailable" };
      }
      if (tenants.size > 1) {
        return { status: "conflict" };
      }
      const [tenantId] = [...tenants];
      if (!tenantId) {
        return { status: "unavailable" };
      }
      return { status: "ok", tenantId };
    },
  };
}
