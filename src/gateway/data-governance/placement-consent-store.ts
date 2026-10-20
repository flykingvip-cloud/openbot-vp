/**
 * File-backed placement consent store. Created only by the composition root.
 * Request handlers do not construct or inject this store.
 */
import fs from "node:fs";
import path from "node:path";
import { resolvePlacementConsentStorePath } from "./paths.js";
import type { PlacementConsentStore } from "./placement-platform-verify.js";

type ConsentRecord = {
  tenantId: string;
  resourceId: string;
  consentVersion: string;
  subjectIds: readonly string[];
  purpose: "eligible_cloud_projection";
  expiresAt: string;
  revoked: boolean;
  consentEpoch: string;
};

type ConsentFile = {
  schemaVersion: 1;
  records: Record<string, ConsentRecord>;
};

function consentKey(query: {
  tenantId: string;
  resourceId: string;
  consentVersion: string;
}): string {
  return `${query.tenantId}\0${query.resourceId}\0${query.consentVersion}`;
}

function emptyFile(): ConsentFile {
  return { schemaVersion: 1, records: {} };
}

function readConsentFile(filePath: string): ConsentFile {
  if (!fs.existsSync(filePath)) {
    return emptyFile();
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as ConsentFile;
    if (parsed?.schemaVersion !== 1 || !parsed.records || typeof parsed.records !== "object") {
      return emptyFile();
    }
    return parsed;
  } catch {
    return emptyFile();
  }
}

export function createFilePlacementConsentStore(stateDir: string): PlacementConsentStore {
  const filePath = resolvePlacementConsentStorePath(stateDir);
  return {
    loadConsent(query) {
      const record = readConsentFile(filePath).records[consentKey(query)];
      return record ?? null;
    },
  };
}

/** Test / seed helper. Not exported from the public barrel. */
export function writePlacementConsentRecord(stateDir: string, record: ConsentRecord): void {
  const filePath = resolvePlacementConsentStorePath(stateDir);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const file = readConsentFile(filePath);
  file.records[consentKey(record)] = {
    tenantId: record.tenantId,
    resourceId: record.resourceId,
    consentVersion: record.consentVersion,
    subjectIds: [...record.subjectIds],
    purpose: "eligible_cloud_projection",
    expiresAt: record.expiresAt,
    revoked: record.revoked,
    consentEpoch: record.consentEpoch,
  };
  fs.writeFileSync(filePath, `${JSON.stringify(file, null, 2)}\n`, "utf8");
}
