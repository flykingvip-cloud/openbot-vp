import fs from "node:fs";
import path from "node:path";
import type {
  AgentDelegationGrant,
  AuthorizationGrant,
  DelegationReceipt,
  DelegationStore,
  EvidenceShareGrant,
  RemoteDiagnosisMission,
  ReportShareGrant,
} from "./delegation.js";

type FileDelegationSnapshot = {
  grants: Record<string, AuthorizationGrant>;
  delegations: Record<string, AgentDelegationGrant>;
  missions: Record<string, RemoteDiagnosisMission>;
  evidenceShares: Record<string, EvidenceShareGrant>;
  reportShares: Record<string, ReportShareGrant>;
  commands: Record<string, DelegationReceipt>;
};

function emptySnapshot(): FileDelegationSnapshot {
  return {
    grants: {},
    delegations: {},
    missions: {},
    evidenceShares: {},
    reportShares: {},
    commands: {},
  };
}

function readSnapshot(filePath: string): FileDelegationSnapshot {
  try {
    if (!fs.existsSync(filePath)) {
      return emptySnapshot();
    }
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as Partial<FileDelegationSnapshot>;
    return {
      grants: parsed.grants ?? {},
      delegations: parsed.delegations ?? {},
      missions: parsed.missions ?? {},
      evidenceShares: parsed.evidenceShares ?? {},
      reportShares: parsed.reportShares ?? {},
      commands: parsed.commands ?? {},
    };
  } catch {
    return emptySnapshot();
  }
}

function writeSnapshot(filePath: string, snapshot: FileDelegationSnapshot): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  fs.renameSync(tmpPath, filePath);
}

/** Durable delegation store for gateway-scoped evolution grants (audit via machine receipts). */
export function createFileDelegationStore(filePath: string): DelegationStore {
  let snapshot = readSnapshot(filePath);
  const persist = () => writeSnapshot(filePath, snapshot);
  return {
    getGrant: (id) => snapshot.grants[id],
    putGrant: (grant) => {
      snapshot.grants[grant.grantId] = grant;
      persist();
    },
    getDelegation: (id) => snapshot.delegations[id],
    putDelegation: (grant) => {
      snapshot.delegations[grant.grantId] = grant;
      persist();
    },
    getMission: (id) => snapshot.missions[id],
    putMission: (mission) => {
      snapshot.missions[mission.missionId] = mission;
      persist();
    },
    getEvidenceShare: (id) => snapshot.evidenceShares[id],
    putEvidenceShare: (grant) => {
      snapshot.evidenceShares[grant.grantId] = grant;
      persist();
    },
    getReportShare: (id) => snapshot.reportShares[id],
    putReportShare: (grant) => {
      snapshot.reportShares[grant.grantId] = grant;
      persist();
    },
    getCommand: (id) => snapshot.commands[id],
    putCommand: (id, receipt) => {
      snapshot.commands[id] = receipt;
      persist();
    },
    listMissions: () => Object.values(snapshot.missions),
  };
}
