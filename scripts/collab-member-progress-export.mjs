#!/usr/bin/env node
/**
 * C0 CLI — export member progress from board-claims (+ optional operating-state).
 * Self-contained (no tsx) so tip soak works without a rebuild.
 *
 * Usage:
 *   node scripts/collab-member-progress-export.mjs \
 *     --claims-dir "/path/to/.../runtime/board-claims" \
 *     [--operating-state "/path/to/.../operating-state.json"] \
 *     [--group-id grp-...] \
 *     [--json-out /tmp/progress.json]
 */
import fs from "node:fs/promises";
import path from "node:path";

const SUBMITTED_OR_LATER = new Set(["submitted_for_review", "accepted"]);
const ACTIVE_WORK = new Set(["claimed", "applied", "in_progress", "returned", "blocked"]);

function parseArgs(argv) {
  const out = { table: true, jsonOut: null, claimsDir: null, operatingState: null, groupId: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--claims-dir") {
      out.claimsDir = argv[++i];
    } else if (a === "--operating-state") {
      out.operatingState = argv[++i];
    } else if (a === "--group-id") {
      out.groupId = argv[++i];
    } else if (a === "--json-out") {
      out.jsonOut = argv[++i];
    } else if (a === "--no-table") {
      out.table = false;
    } else if (a === "--help" || a === "-h") {
      out.help = true;
    }
  }
  return out;
}

function latestItemsFromBoardClaimJsonl(raw) {
  const byId = new Map();
  for (const line of raw.split("\n")) {
    if (!line.trim()) {
      continue;
    }
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    const item = parsed?.kind === "board_claim" ? parsed.item : null;
    if (!item || typeof item !== "object") {
      continue;
    }
    const itemId = typeof item.itemId === "string" ? item.itemId.trim() : "";
    const taskId = typeof item.taskId === "string" ? item.taskId.trim() : "";
    const status = typeof item.status === "string" ? item.status.trim() : "";
    if (!itemId || !taskId || !status) {
      continue;
    }
    byId.set(itemId, {
      itemId,
      groupId: typeof item.groupId === "string" ? item.groupId : "",
      taskId,
      title: typeof item.title === "string" && item.title.trim() ? item.title.trim() : taskId,
      status,
      claimantId: typeof item.claimantId === "string" ? item.claimantId : undefined,
      submissionId: typeof item.submissionId === "string" ? item.submissionId : undefined,
      claimedAt: typeof item.claimedAt === "number" ? item.claimedAt : undefined,
      appliedAt: typeof item.appliedAt === "number" ? item.appliedAt : undefined,
      inProgressAt: typeof item.inProgressAt === "number" ? item.inProgressAt : undefined,
      submittedAt: typeof item.submittedAt === "number" ? item.submittedAt : undefined,
      acceptedAt: typeof item.acceptedAt === "number" ? item.acceptedAt : undefined,
      returnedAt: typeof item.returnedAt === "number" ? item.returnedAt : undefined,
      blockedAt: typeof item.blockedAt === "number" ? item.blockedAt : undefined,
    });
  }
  return [...byId.values()];
}

function aggregate(items, claimsDir, groupIdHint, operatingStatePath, currentTaskId) {
  const members = [];
  const unclaimed = [];
  const gaps = [];
  for (const item of items) {
    const claimant = item.claimantId?.trim();
    if (!claimant) {
      unclaimed.push({
        itemId: item.itemId,
        taskId: item.taskId,
        title: item.title,
        status: item.status,
      });
      continue;
    }
    members.push({
      memberId: claimant,
      itemId: item.itemId,
      taskId: item.taskId,
      title: item.title,
      status: item.status,
      submissionId: item.submissionId,
      isSubmitted: SUBMITTED_OR_LATER.has(item.status),
      isActiveWork: ACTIVE_WORK.has(item.status),
      timestamps: {
        claimedAt: item.claimedAt,
        appliedAt: item.appliedAt,
        inProgressAt: item.inProgressAt,
        submittedAt: item.submittedAt,
        acceptedAt: item.acceptedAt,
        returnedAt: item.returnedAt,
        blockedAt: item.blockedAt,
      },
    });
  }
  members.sort((a, b) => a.memberId.localeCompare(b.memberId) || a.taskId.localeCompare(b.taskId));
  if (members.length === 0 && unclaimed.length === 0) {
    gaps.push("no_board_claim_items");
  }
  if (
    members.some((m) => m.status === "claimed" || m.status === "applied") &&
    !members.some((m) => m.isSubmitted)
  ) {
    gaps.push(
      "no_submitted_for_review_visible — field evidence: assignment without交卷态 (stitch risk)",
    );
  }
  if (!members.some((m) => m.status === "in_progress")) {
    gaps.push("no_in_progress_visible — members may be working only in chat drafts");
  }
  if (currentTaskId == null || currentTaskId === "") {
    gaps.push("operating_state_missing_currentTaskId_or_not_provided");
  } else {
    gaps.push(
      "operating_state_only_currentTaskId — no per-member progress map (C1 claim states are source of truth)",
    );
  }
  gaps.push(
    "assistant_at_mention_does_not_wake_peers — wake ledger is C2; C0/C1 only make progress visible",
  );
  return {
    generatedAt: new Date().toISOString(),
    claimsDir,
    groupIdHint,
    itemCount: items.length,
    memberCount: new Set(members.map((m) => m.memberId)).size,
    members,
    unclaimed,
    gaps,
    operatingState: {
      path: operatingStatePath,
      currentTaskId: currentTaskId ?? null,
      note: "operating-state is not a per-member progress authority; board-claims are.",
    },
  };
}

function formatTable(report) {
  const lines = [
    `# Member progress (${report.generatedAt})`,
    `claimsDir=${report.claimsDir}`,
    `items=${report.itemCount} members=${report.memberCount}`,
    "",
    "| member | status | taskId | itemId | submissionId |",
    "| --- | --- | --- | --- | --- |",
  ];
  for (const row of report.members) {
    lines.push(
      `| ${row.memberId} | ${row.status} | ${row.taskId} | ${row.itemId} | ${row.submissionId ?? ""} |`,
    );
  }
  if (report.unclaimed.length) {
    lines.push("", "## Unclaimed");
    for (const u of report.unclaimed) {
      lines.push(`- ${u.status} ${u.taskId} ${u.itemId} (${u.title})`);
    }
  }
  if (report.gaps.length) {
    lines.push("", "## Gaps");
    for (const g of report.gaps) {
      lines.push(`- ${g}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.claimsDir) {
    console.log(
      `Usage: node scripts/collab-member-progress-export.mjs --claims-dir <dir> [options]`,
    );
    process.exit(args.help ? 0 : 2);
  }
  const claimsDir = path.resolve(args.claimsDir);
  let names = [];
  try {
    names = await fs.readdir(claimsDir);
  } catch (e) {
    if (e.code !== "ENOENT") {
      throw e;
    }
  }
  const items = [];
  for (const name of names) {
    if (!name.endsWith(".jsonl")) {
      continue;
    }
    const raw = await fs.readFile(path.join(claimsDir, name), "utf8");
    items.push(...latestItemsFromBoardClaimJsonl(raw));
  }
  const byId = new Map(items.map((i) => [i.itemId, i]));
  let currentTaskId = null;
  const osPath = args.operatingState ? path.resolve(args.operatingState) : undefined;
  if (osPath) {
    try {
      const parsed = JSON.parse(await fs.readFile(osPath, "utf8"));
      currentTaskId = parsed?.activeContext?.currentTaskId ?? null;
    } catch {
      currentTaskId = null;
    }
  }
  const report = aggregate([...byId.values()], claimsDir, args.groupId, osPath, currentTaskId);
  const jsonOut = args.jsonOut;
  if (typeof jsonOut === "string" && jsonOut.length > 0) {
    await fs.writeFile(jsonOut, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    console.error("wrote", jsonOut);
  }
  if (args.table) {
    process.stdout.write(formatTable(report));
  } else if (!args.jsonOut) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
