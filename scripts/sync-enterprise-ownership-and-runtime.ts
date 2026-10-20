import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "../src/config/config.js";
import { loadEnterpriseSeatAssetsStore } from "../src/gateway/enterprise-seat-assets-store.js";
import { upsertOwnershipRecord } from "../src/gateway/ownership-store.js";
import { listAgentsForGateway } from "../src/gateway/session-utils.js";
import { CONFIG_DIR } from "../src/utils.js";

function normalize(value: string | null | undefined): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

async function main() {
  const cfg = loadConfig();
  const seatStore = await loadEnterpriseSeatAssetsStore();
  const agents = listAgentsForGateway(cfg).agents;
  const platformStorePath = path.join(CONFIG_DIR, "openbot-platform-auth.json");
  const platformStore = fs.existsSync(platformStorePath)
    ? (JSON.parse(fs.readFileSync(platformStorePath, "utf8")) as {
        users?: Record<string, { displayName?: string }>;
        enterprises?: Record<string, { id: string; name: string }>;
      })
    : null;
  const spacesRoot = path.join(CONFIG_DIR, "spaces");
  const spaces = fs.existsSync(spacesRoot)
    ? fs
        .readdirSync(spacesRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => {
          const root = path.join(spacesRoot, entry.name);
          const profilePath = path.join(root, "profile.json");
          const membersPath = path.join(root, "members.json");
          if (!fs.existsSync(profilePath) || !fs.existsSync(membersPath)) {
            return null;
          }
          try {
            const profile = JSON.parse(fs.readFileSync(profilePath, "utf8")).profile;
            const members = JSON.parse(fs.readFileSync(membersPath, "utf8")).members ?? [];
            return {
              groupId: profile?.groupId ?? profile?.id ?? entry.name,
              members: {
                humans: members.filter(
                  (member: { memberKind?: string }) => member.memberKind === "human",
                ),
              },
            };
          } catch {
            return null;
          }
        })
        .filter(
          (
            entry,
          ): entry is {
            groupId: string;
            members: { humans: Array<{ status?: string; name?: string }> };
          } => Boolean(entry),
        )
    : [];
  const runtimeStorePath = path.join(CONFIG_DIR, "agent-runtime", "store.json");

  for (const seat of Object.values(seatStore.seats)) {
    const tenantId = normalize(seat.tenantId);
    const positionId = normalize(seat.seatId);
    const positionLabel = normalize(seat.title);
    const managerUserId = normalize(seat.currentEmployeeId);
    if (!tenantId || !positionId || !positionLabel || !managerUserId) {
      continue;
    }
    const managerLabel =
      platformStore?.users?.[managerUserId]?.displayName?.trim() || managerUserId;

    for (const agentId of seat.defaultAgentAssetIds ?? []) {
      const agent = agents.find((entry) => entry.id === agentId) ?? null;
      upsertOwnershipRecord({
        tenantId,
        subjectKind: "agent",
        subjectId: agentId,
        positionId,
        positionLabel,
        createdByUserId: managerUserId,
        createdByUserLabel: agent?.ownerName?.trim() || managerLabel,
        currentManagerUserId: managerUserId,
        currentManagerLabel: agent?.ownerName?.trim() || managerLabel,
        notes: "sync-enterprise-ownership-and-runtime",
      });
    }

    for (const groupId of seat.defaultSpaceIds ?? []) {
      const space = spaces.find((entry) => entry.groupId === groupId) ?? null;
      const humanLabel =
        space?.members?.humans?.find((member) => member.status !== "removed")?.name?.trim() ||
        managerUserId;
      upsertOwnershipRecord({
        tenantId,
        subjectKind: "group",
        subjectId: groupId,
        positionId,
        positionLabel,
        createdByUserId: managerUserId,
        createdByUserLabel: humanLabel,
        currentManagerUserId: managerUserId,
        currentManagerLabel: humanLabel,
        notes: "sync-enterprise-ownership-and-runtime",
      });
    }
  }

  if (fs.existsSync(runtimeStorePath)) {
    const runtimeStore = JSON.parse(fs.readFileSync(runtimeStorePath, "utf8")) as {
      agents?: Record<string, { runtimeAgentId: string; name: string; tenantCoverage?: string[] }>;
    };
    for (const agent of Object.values(runtimeStore.agents ?? {})) {
      const tenantId = agent.tenantCoverage?.[0];
      const enterpriseName = tenantId ? platformStore?.enterprises?.[tenantId]?.name : null;
      if (tenantId && enterpriseName && agent.runtimeAgentId === `rt-${tenantId}`) {
        agent.name = `${enterpriseName} Runtime`;
      }
    }
    fs.writeFileSync(runtimeStorePath, `${JSON.stringify(runtimeStore, null, 2)}\n`, "utf8");
  }
}

void main();
