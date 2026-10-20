#!/usr/bin/env node
/**
 * Tip soak CLI — print Wake Contract timeline (C2).
 * Usage:
 *   node scripts/collab-wake-events-export.mjs \
 *     --wake-dir "$OPENBOT_TENANTS_ROOT/001/collaboration/groups/<group>/runtime/wake-events" \
 *     [--group-id grp-xxx] [--task-id task-xxx]
 */
import fs from "node:fs";
import path from "node:path";

function arg(name, fallback = undefined) {
  const idx = process.argv.indexOf(name);
  if (idx === -1) {
    return fallback;
  }
  return process.argv[idx + 1] ?? fallback;
}

const wakeDir = arg("--wake-dir");
const groupId = arg("--group-id");
const taskId = arg("--task-id");
if (!wakeDir) {
  console.error("missing --wake-dir");
  process.exit(2);
}

function loadEvents(dir, gid) {
  const files = gid
    ? [path.join(dir, `${encodeURIComponent(gid)}.jsonl`)]
    : fs.existsSync(dir)
      ? fs
          .readdirSync(dir)
          .filter((f) => f.endsWith(".jsonl"))
          .map((f) => path.join(dir, f))
      : [];
  const events = [];
  for (const file of files) {
    if (!fs.existsSync(file)) {
      continue;
    }
    for (const line of fs.readFileSync(file, "utf8").split("\n")) {
      if (!line.trim()) {
        continue;
      }
      try {
        const parsed = JSON.parse(line);
        if (parsed?.kind === "wake_event" && parsed.event) {
          if (taskId && parsed.event.taskId !== taskId) {
            continue;
          }
          events.push(parsed.event);
        }
      } catch {
        // skip
      }
    }
  }
  return events.toSorted((a, b) => a.at - b.at);
}

const events = loadEvents(wakeDir, groupId);
const rows = [];
for (const event of events) {
  const targets = event.toAgentIds?.length ? event.toAgentIds : [""];
  for (const to of targets) {
    rows.push({
      at: event.at,
      from: event.fromAgentId,
      to,
      source: event.source,
      outcome: event.outcome,
      wakeId: event.wakeId,
      taskId: event.taskId ?? "",
    });
  }
}

console.log(JSON.stringify({ count: events.length, timeline: rows }, null, 2));
console.log("\n谁唤醒了谁:");
for (const row of rows) {
  console.log(
    `${new Date(row.at).toISOString()}  ${row.from} → ${row.to || "(none)"}  [${row.source}/${row.outcome}]`,
  );
}
