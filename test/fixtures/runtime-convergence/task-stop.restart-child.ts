import path from "node:path";
const root = process.argv[2];
const mode = process.argv[3];
if (!root) {
  throw new Error("Missing isolated state directory");
}
process.env.OPENBOT_STATE_DIR = root;
process.env.OPENCLAW_STATE_DIR = root;
process.env.OPENBOT_CONFIG_PATH = path.join(root, "openbot.json");
process.env.OPENCLAW_CONFIG_PATH = path.join(root, "openbot.json");
const { recordAuthoritativeTaskStop, queryAuthoritativeTaskStop } =
  await import("../../../src/gateway/server-methods/chat-resume-parked-recheck.js");
const scope = {
  scopeKind: "managed" as const,
  tenantId: "tenant-a",
  userId: "user-a",
  sessionKey: "agent:bot:main",
  taskId: "task-a",
};
if (mode === "write") {
  recordAuthoritativeTaskStop({ ...scope, reason: "owner_pause", nowMs: 1000 });
  console.log(JSON.stringify({ written: true }));
} else {
  console.log(JSON.stringify(queryAuthoritativeTaskStop(scope)));
}
