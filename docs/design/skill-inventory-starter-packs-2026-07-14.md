# 技能清单与 Starter Pack 整合（2026-07-14）

## 背景

本地测试期积累了大量技能（仓库 `skills/`、治理 registry、skill-assets、workspace 安装），但：

1. 企业能力中心主要读 **governance registry**，业务 skill 未注册则空白；
2. 租户开通不挂载能力包；
3. Mac/CLI 类 skill 曾被整表 `defaultEnabled`，与 SaaS 默认体验不匹配。

本方案落地 **官方 Pack + 租户权益继承 + seed 脚本**。

## Pack 定义

| Pack ID        | 中文名          | 自动授予          | 员工可见                     | 说明                                                 |
| -------------- | --------------- | ----------------- | ---------------------------- | ---------------------------------------------------- |
| `starter`      | 办公起步包      | 所有 plan         | `direct_employee_visible`    | **A**：全员直接可用（摘要/PPT/画布/引导/API/转写等） |
| `cn-office`    | 中国企业办公包  | trial/business/\* | `enterprise_review_required` | **B**：角色与营销岗位，企业审核后按岗位开放          |
| `channels`     | 渠道与集成包    | 否                | `enterprise_only`            | **C**：Slack/GitHub 等，按需开通                     |
| `local-dev`    | 本机/Mac 工具包 | 否                | `enterprise_only`            | **C**：本机 CLI / Cursor IDE，不进 SaaS 默认         |
| `platform-ops` | 平台运营包      | 否                | `enterprise_only`            | **C**：如 `trial-sales-conversion`，仅平台侧         |

代码锚点：`src/gateway/capability-packs/starter-packs.ts`

## 数据落点

| 数据           | 路径                                                  |
| -------------- | ----------------------------------------------------- |
| 能力注册表     | `~/.openbot/governance/registry.json`                 |
| 租户 Pack 权益 | `~/.openbot/governance/tenant-pack-entitlements.json` |

## 开通钩子

- `createEnterpriseWithPendingAdminActivation` → `entitleTenantForPlan`（**已接线**，best-effort）
- `agents.create` → `autoInstallCapabilitiesOnAgentCreate`（**已接线**，响应含 `capabilityInstall`）
- `platform.tenant.provision` → 仍可走 seed / plan entitlement
- `enterprise-capability.list` → 按租户权益过滤官方 pack skill；非 pack 贡献仍可见

## Seed 命令

```bash
# 注册 starter + cn-office，并降噪非 pack 条目
pnpm exec tsx scripts/seed-capability-starter-packs.ts --demote-non-pack

# 给已有企业授权
pnpm exec tsx scripts/seed-capability-starter-packs.ts --grant-all-enterprises

# 指定租户
pnpm exec tsx scripts/seed-capability-starter-packs.ts --grant-tenants=001

# 预览
pnpm exec tsx scripts/seed-capability-starter-packs.ts --dry-run

# 交付冒烟（加载 + A/B 策略；可选 --seed / --seed-dry-run）
pnpm exec tsx scripts/audit/starter-pack-delivery-smoke.mjs
```

### 高频会话验收（人工）

| #   | 技能                       | 提示词样本                | 期望                                 |
| --- | -------------------------- | ------------------------- | ------------------------------------ |
| 1   | `summarize`                | 把这段话摘要成 5 点       | 结构化摘要，不跑偏到其他 skill       |
| 2   | `meeting-notes-specialist` | 根据纪要整理决策与行动项  | 决策 / owner / due                   |
| 3   | `canvas`                   | 用柱状图对比 Q1–Q4 销售   | `canvas.present` 或 HTML deliverable |
| 4   | `cyber-ppt`                | 把报告做成 8 页咨询风 PPT | 确认门不跳过；产出 PPTX              |
| 5   | `openbot-platform-ops`     | 建协作空间并挂知识库      | 走平台 playbook，不臆造 RPC          |

个性化：在 `<workspace>/skills/<同名>/SKILL.md` 覆盖官方文案后**开新会话**验证。

自动化门禁：`src/gateway/capability-packs/starter-pack-smoke.test.ts`（seed → registry → platform-direct → bundled load）。

## 生产 Cutover 检查项（A/B/C 技能包）

上线前按序确认（失败即停）：

1. **镜像含 skills**  
   `podman exec <gateway> test -f /app/skills/summarize/SKILL.md`  
   `podman exec <gateway> test -f /app/skills/json-canvas/SKILL.md`  
   `podman exec <gateway> test -f /app/skills/cyber-ppt/SKILL.md`  
   （`defuddle` / `json-canvas` / `obsidian-*` 必须是镜像内实体目录，不能是宿主机 symlink）

2. **治理 seed**（在 gateway 宿主或带同一 `CONFIG_DIR` 的运维环境）

   ```bash
   pnpm exec tsx scripts/seed-capability-starter-packs.ts \
     --packs=starter,cn-office --demote-non-pack --grant-all-enterprises
   ```

3. **校验 registry**
   - starter 15 条：`employeeVisibilityMode=direct_employee_visible`、`lifecycleState=active`
   - cn-office：`enterprise_review_required`
   - 抽查：`summarize`、`finance-research` 在 starter；`feishu-integration` 在 cn-office

4. **校验租户权益**  
   `~/.openbot/governance/tenant-pack-entitlements.json` 中目标租户含 `starter` + `cn-office`

5. **运行时冒烟**

   ```bash
   pnpm exec tsx scripts/audit/starter-pack-delivery-smoke.mjs
   ```

6. **产品路径**
   - 新开企业 → 自动 entitle（`createEnterpriseWithPendingAdminActivation`）
   - 新开机器人 → `agents.create` 响应含 `capabilityInstall`
   - 员工市场「平台直达」能看到 starter 技能

7. **人工会话抽检**（见上表 5 条高频技能）

回滚：保留 cutover 前 `registry.json` / `tenant-pack-entitlements.json` 备份；镜像回退到上一 provenance tag。

## 本地资产分级（摘要）

### 进入 starter / cn-office

见 `starter-packs.ts` 中 skillKey 列表（A starter **15** + B cn-office **26**；已剔除无 `SKILL.md` 的 `web-search` / `ppt-generator` / `md2wechat`）。

### 仓库 bundled 但不默认继承

- channels：`slack`, `discord`, `github`, …
- local-dev：`apple-*`, `obsidian*`, `peekaboo`, …
- platform-ops：`trial-sales-conversion`

### 不进 catalog

- `~/.openbot/skill-assets` 个人知识 capture（中医笔记、可行性报告等）— 仅验证沉淀链路

### 已修复

- `skills/` 下 5 个指向本机 workspace 的 symlink（defuddle / json-canvas / obsidian-\*）**已 vendor 为实体目录**（否则 runtime 会因 out-of-root realpath 跳过加载；云端镜像也无法跟随宿主机路径）

1. `agents.create` 模板自动 `install` starter skillKeys
2. 套餐 `package-entitlement` 增加 `capabilityPackIds` 字段
3. 岗位一键装齐 cn-office 子集

## 已实现的后续能力（2026-07-14 续）

1. **agents.create 自动安装** starter + 模板技能（`TEMPLATE_AUTO_SKILL_KEYS`）+ 岗位已推送能力；响应含 `capabilityInstall`。
2. **套餐 capabilityPackIds**：`EntitlementSnapshot` + plan-bundle 透传 + `entitleTenantFromPlanVersion`。
3. **岗位/机器人整包操作**：`enterprise-capability.push-pack-to-positions`、`install-pack-to-robots`（如 packId=`cn-office`）。
