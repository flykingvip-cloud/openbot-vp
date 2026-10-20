import { DatabaseSync } from "node:sqlite";
import {
  evaluateDestructiveInDbTransaction,
  normalizeRootFingerprint,
  readV1RootGuardUnlockFromEnv,
} from "./v1-root-guard.js";

const sqlitePath = process.argv[2];
const workspaceDir = process.argv[3];
if (!sqlitePath || !workspaceDir) {
  process.exit(2);
}

const db = new DatabaseSync(sqlitePath);
db.exec("PRAGMA busy_timeout = 5000");
const decision = evaluateDestructiveInDbTransaction(db, {
  op: "rebuild",
  incomingFingerprint: normalizeRootFingerprint(workspaceDir),
  sqlitePath,
  unlock: readV1RootGuardUnlockFromEnv(),
});
if (decision.allow) {
  console.log("allowed");
  process.exit(1);
}
console.log(`refused:${decision.reason ?? "unknown"}`);
process.exit(0);
