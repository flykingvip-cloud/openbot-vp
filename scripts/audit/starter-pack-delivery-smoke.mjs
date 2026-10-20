#!/usr/bin/env node
/**
 * Operator smoke for A/B/C capability packs (no gateway required).
 *
 *   pnpm exec tsx scripts/audit/starter-pack-delivery-smoke.mjs
 *   pnpm exec tsx scripts/audit/starter-pack-delivery-smoke.mjs --seed-dry-run
 *
 * Exit 0 = starter 15 load + pack policy OK.
 * Does NOT mutate ~/.openbot unless --seed is passed.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
process.chdir(root);

const { PACK_STARTER, PACK_CN_OFFICE, ALL_CAPABILITY_PACKS } =
  await import("../../src/gateway/capability-packs/starter-packs.ts");
const { loadWorkspaceSkillEntries } = await import("../../src/agents/skills.ts");

const args = new Set(process.argv.slice(2));
const issues = [];

console.log("=== Starter pack delivery smoke ===");
console.log(`repo: ${root}`);
console.log(
  `A starter: ${PACK_STARTER.skills.length} · visibility=${PACK_STARTER.employeeVisibilityMode}`,
);
console.log(
  `B cn-office: ${PACK_CN_OFFICE.skills.length} · visibility=${PACK_CN_OFFICE.employeeVisibilityMode}`,
);

for (const pack of ALL_CAPABILITY_PACKS) {
  const auto = pack.autoEntitlePlans.length ? pack.autoEntitlePlans.join(",") : "(none)";
  console.log(
    `pack ${pack.id}: skills=${pack.skills.length} auto=[${auto}] visibility=${pack.employeeVisibilityMode}`,
  );
}

const workspaceDir = path.join(root, ".tmp-starter-pack-smoke-ws");
fs.mkdirSync(workspaceDir, { recursive: true });
const entries = loadWorkspaceSkillEntries(workspaceDir, {});
const names = new Set(entries.map((e) => e.skill.name));

for (const skill of PACK_STARTER.skills) {
  const skillMd = path.join(root, "skills", skill.skillKey, "SKILL.md");
  if (!fs.existsSync(skillMd)) {
    issues.push(`missing SKILL.md: ${skill.skillKey}`);
    continue;
  }
  if (!names.has(skill.skillKey)) {
    issues.push(`runtime load miss: ${skill.skillKey}`);
  } else {
    console.log(`OK load ${skill.skillKey}`);
  }
}

if (PACK_STARTER.employeeVisibilityMode !== "direct_employee_visible") {
  issues.push("starter visibility is not direct_employee_visible");
}
if (PACK_CN_OFFICE.employeeVisibilityMode !== "enterprise_review_required") {
  issues.push("cn-office visibility is not enterprise_review_required");
}

if (args.has("--seed-dry-run") || args.has("--seed")) {
  const { seedOfficialCapabilityPacks } =
    await import("../../src/gateway/capability-packs/seed-registry.ts");
  if (args.has("--seed-dry-run")) {
    console.log("\n[--seed-dry-run] would register:");
    for (const s of PACK_STARTER.skills) {
      console.log(`  starter/${s.skillKey}`);
    }
    for (const s of PACK_CN_OFFICE.skills) {
      console.log(`  cn-office/${s.skillKey}`);
    }
  } else {
    const result = seedOfficialCapabilityPacks({
      packIds: ["starter", "cn-office"],
      skillsRoot: path.join(root, "skills"),
      demoteNonPack: args.has("--demote-non-pack"),
      updatedBy: "starter-pack-delivery-smoke",
    });
    console.log("\n[--seed] result:", result);
  }
}

console.log("\n=== Manual session acceptance (high-frequency) ===");
console.log(`1. summarize — 「把这段话摘要成 5 点：…」`);
console.log(`2. meeting-notes-specialist — 「根据以下会议录音/纪要整理决策与行动项：…」`);
console.log(`3. canvas — 「用柱状图对比 Q1–Q4 销售」→ 应走 canvas.present 或 HTML deliverable`);
console.log(`4. cyber-ppt — 「把这份报告做成 8 页咨询风 PPT」→ 确认门不可跳过`);
console.log(`5. openbot-platform-ops — 「帮我给团队建一个协作空间并挂知识库」→ 走平台 playbook`);
console.log(`个性化：在 <workspace>/skills/<同名>/SKILL.md 覆盖官方文案后开新会话验证。`);

if (issues.length) {
  console.error("\nFAIL:");
  for (const issue of issues) {
    console.error(` - ${issue}`);
  }
  process.exit(1);
}
console.log(`\nPASS: starter ${PACK_STARTER.skills.length}/${PACK_STARTER.skills.length} loadable`);
