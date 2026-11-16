import fs from "node:fs";
import path from "node:path";

export type OperatorSessionScan = {
  operatorId: string;
  storePath: string;
  keys: string[];
  sessionFiles: Record<string, { sessionFile: string | null; lineCount: number }>;
};

function countJsonlLines(filePath: string): number {
  if (!filePath || !fs.existsSync(filePath)) {
    return 0;
  }
  const text = fs.readFileSync(filePath, "utf8");
  return text.split(/\r?\n/).filter((line) => line.trim().length > 0).length;
}

/**
 * List operator-scoped session stores under $STATE_DIR/operators/<id>/...
 * Used to verify which store an official write actually landed in.
 */
export function scanOperatorSessionStores(stateDir: string): OperatorSessionScan[] {
  const operatorsDir = path.join(stateDir, "operators");
  if (!fs.existsSync(operatorsDir)) {
    return [];
  }
  const scans: OperatorSessionScan[] = [];
  for (const operatorId of fs.readdirSync(operatorsDir)) {
    const operatorRoot = path.join(operatorsDir, operatorId);
    if (!fs.statSync(operatorRoot).isDirectory()) {
      continue;
    }
    const agentsDir = path.join(operatorRoot, "agents");
    if (!fs.existsSync(agentsDir)) {
      continue;
    }
    for (const agentId of fs.readdirSync(agentsDir)) {
      const storePath = path.join(agentsDir, agentId, "sessions", "sessions.json");
      if (!fs.existsSync(storePath)) {
        continue;
      }
      let raw: unknown;
      try {
        raw = JSON.parse(fs.readFileSync(storePath, "utf8"));
      } catch {
        scans.push({ operatorId, storePath, keys: [], sessionFiles: {} });
        continue;
      }
      const store = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
      const keys: string[] = [];
      const sessionFiles: OperatorSessionScan["sessionFiles"] = {};
      for (const [key, value] of Object.entries(store)) {
        keys.push(key);
        const entry = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
        const sessionFile = typeof entry.sessionFile === "string" ? entry.sessionFile : null;
        sessionFiles[key] = {
          sessionFile,
          lineCount: sessionFile ? countJsonlLines(sessionFile) : 0,
        };
      }
      scans.push({ operatorId, storePath, keys, sessionFiles });
    }
  }
  return scans;
}

export function findSessionAcrossOperators(
  scans: readonly OperatorSessionScan[],
  sessionKey: string,
): Array<{
  operatorId: string;
  storePath: string;
  lineCount: number;
  sessionFile: string | null;
  storeKey: string;
}> {
  const hits: Array<{
    operatorId: string;
    storePath: string;
    lineCount: number;
    sessionFile: string | null;
    storeKey: string;
  }> = [];
  const keyMatches = (storeKey: string) =>
    storeKey === sessionKey ||
    storeKey === `agent:main:${sessionKey}` ||
    storeKey.endsWith(`:${sessionKey}`);
  for (const scan of scans) {
    const matched = [
      ...scan.keys.filter(keyMatches),
      ...Object.keys(scan.sessionFiles).filter(keyMatches),
    ];
    const unique = [...new Set(matched)];
    if (unique.length === 0) {
      continue;
    }
    for (const matchedKey of unique) {
      const file = scan.sessionFiles[matchedKey];
      hits.push({
        operatorId: scan.operatorId,
        storePath: scan.storePath,
        lineCount: file?.lineCount ?? 0,
        sessionFile: file?.sessionFile ?? null,
        storeKey: matchedKey,
      });
    }
  }
  return hits;
}
