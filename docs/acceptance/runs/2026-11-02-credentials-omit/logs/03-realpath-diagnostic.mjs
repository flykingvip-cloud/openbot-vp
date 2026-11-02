import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as tar from "tar";
import { isPathWithin } from "./src/commands/cleanup-utils.ts";
import { resolveOAuthDir, resolveStateDir } from "./src/config/paths.ts";
import { createBackupArchive } from "./src/infra/backup-create.ts";

const prevState = process.env.OPENBOT_STATE_DIR;
const prevClaw = process.env.OPENCLAW_STATE_DIR;
const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "cred-omit-diag-"));
const archiveDir = fs.mkdtempSync(path.join(os.tmpdir(), "cred-omit-out-"));
process.env.OPENBOT_STATE_DIR = stateDir;
delete process.env.OPENCLAW_STATE_DIR;

const fictional = '{"token":"FICTIONAL_PLACEHOLDER_NOT_A_SECRET","note":"acceptance-only"}';
fs.writeFileSync(path.join(stateDir, "openbot.json"), "{}");
fs.writeFileSync(path.join(stateDir, "state.txt"), "payload\n");
fs.mkdirSync(path.join(stateDir, "credentials"), { recursive: true });
fs.writeFileSync(path.join(stateDir, "credentials", "oauth.json"), fictional);

const oauthLogical = resolveOAuthDir();
const oauthReal = fs.realpathSync(oauthLogical);
const stateLogical = resolveStateDir();
const stateReal = fs.realpathSync(stateLogical);

console.log(
  JSON.stringify(
    {
      stateLogical,
      stateReal,
      oauthLogical,
      oauthReal,
      symlinkMismatch: oauthLogical !== oauthReal,
      isPathWithin_logical_vs_real_entry: isPathWithin(
        path.join(oauthReal, "oauth.json"),
        oauthLogical,
      ),
      isPathWithin_real_vs_real: isPathWithin(path.join(oauthReal, "oauth.json"), oauthReal),
    },
    null,
    2,
  ),
);

const created = await createBackupArchive({
  output: archiveDir,
  includeWorkspace: false,
  includeCredentials: false,
  nowMs: Date.UTC(2026, 10, 2, 0, 0, 0),
});

console.log(
  JSON.stringify(
    {
      includeCredentials: created.includeCredentials,
      skipped: created.skipped,
      assets: created.assets.map((a) => ({ kind: a.kind, sourcePath: a.sourcePath })),
      archivePath: created.archivePath,
    },
    null,
    2,
  ),
);

const extractDir = fs.mkdtempSync(path.join(os.tmpdir(), "cred-omit-x-"));
tar.x({ file: created.archivePath, cwd: extractDir, gzip: true, sync: true });
const listed = [];
const walk = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      walk(full);
    } else {
      listed.push(full);
    }
  }
};
walk(extractDir);
const credHits = listed.filter(
  (p) => p.includes(`${path.sep}credentials${path.sep}`) || p.endsWith(`${path.sep}oauth.json`),
);
console.log(
  JSON.stringify(
    {
      listedCount: listed.length,
      credentialLeakInArchive: credHits.length > 0,
      credentialRelPaths: credHits.map((p) => path.relative(extractDir, p)),
      nonCredSample: listed
        .filter((p) => !p.includes("credentials"))
        .map((p) => path.relative(extractDir, p))
        .slice(0, 8),
    },
    null,
    2,
  ),
);

if (prevState === undefined) {
  delete process.env.OPENBOT_STATE_DIR;
} else {
  process.env.OPENBOT_STATE_DIR = prevState;
}
if (prevClaw === undefined) {
  delete process.env.OPENCLAW_STATE_DIR;
} else {
  process.env.OPENCLAW_STATE_DIR = prevClaw;
}
fs.rmSync(stateDir, { recursive: true, force: true });
fs.rmSync(archiveDir, { recursive: true, force: true });
fs.rmSync(extractDir, { recursive: true, force: true });
process.exitCode = credHits.length > 0 ? 2 : 0;
