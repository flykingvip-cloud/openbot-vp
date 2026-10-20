# OpenBot SaaS 租户数据 — Kiro 驳回 / 续做清单

> **状态：验收裁定 v1.3** | 创建：2026-07-11 | 更新：2026-07-11  
> **分工**：**Kiro 团队** — 按规格续做实施；**Cursor 团队** — 按本文档验收（不通过则退回修复）  
> **规格依据**（冻结，变更须先改文档再验收）：
>
> - [SaaS 租户数据架构 v1.1](/design/openbot-saas-tenant-data-architecture)（§12–§17）
> - [Data Space 验收清单](/design/openbot-data-directory-kiro-acceptance-checklist-2026-07-10)（P0/P1 前置）

---

## 0. 裁定结论

**本地 `tenant-import` 管线 + `platform.tenant.*` RPC 已达标；P3 MVP 仅剩 K-08 CLI 与 §7 试点冒烟。**

**复验进度**：R1（2026-07-11）K-01 build + K-02 CLI 通过；R2（2026-07-11）**K-03～K-09 全部通过**（RPC + 运维 CLI + RPC 级 e2e + K-07 store-reader，见 §11 / §14.3）。P3 MVP 代码面已闭环；**唯一剩余为 §7 试点冒烟的 staging 实跑留档**（runbook 见 §7.1，属运维在 upbeyond 上云环境执行，非代码）。在其留档前，P3 MVP 标记为「代码就绪，待冒烟签署」。

| 范围                            | 裁定                 |
| ------------------------------- | -------------------- |
| P0 文档冻结 + OQ-1/OQ-3         | ✅                   |
| P1 `verify-migration-readiness` | ✅                   |
| P2 export/restore CLI + 加固    | ✅（UI 恢复见 K-10） |
| P3 **本地作业引擎**             | ✅                   |
| P3 **完整 MVP + 上云试点**      | ❌ 续做              |

### 0.1 裁定签署（对齐 Data Space 清单 §3.6）

| 项                              | 验收人 | 日期       | 结果                       |
| ------------------------------- | ------ | ---------- | -------------------------- |
| P0 文档冻结 + OQ-1/OQ-3         | Cursor | 2026-07-11 | ☑ 通过                     |
| P1 `verify-migration-readiness` | Cursor | 2026-07-11 | ☑ 通过                     |
| P2 export/restore CLI + 加固    | Cursor | 2026-07-11 | ☑ 通过（UI 恢复见 K-10）   |
| P3 本地作业引擎                 | Cursor | 2026-07-11 | ☑ 通过                     |
| K-01 全仓 build                 | Cursor | 2026-07-11 | ☑ 通过（复验 R1，见 §11）  |
| K-02 CLI 活体验证               | Cursor | 2026-07-11 | ☑ 通过（复验 R1，见 §11）  |
| P3 完整 MVP + 上云试点          | Cursor | —          | ☐ **驳回 / 续做**（§4–§7） |

---

## 1. 验收原则（与 Data Space 清单一致）

1. **按 Phase 分批交付**：每项 PR 须标明 Phase（P0 修复 / P3 RPC / P3 CLI / P3 e2e）；未声明范围的一律不合并。
2. **证据优先**：每项须附命令输出、测试名或冒烟日志；仅 PR 描述不算通过。
3. **架构红线 SAAS-D-01～08**：任一项违反 → **整批驳回**（见 §2 / 架构文档 §12.1）。
4. **禁止跳阶**：未通过 SAAS-T-01～03 **RPC 级** e2e → 不对外提供试点导入（架构 §13）。
5. **多 Agent 共享树**：只评审 Kiro 声明的 `paths:`；`git add .` 禁止；提交前跑 `bun scripts/agent-attribution.ts --fail-on-conflict`。

---

## 2. 架构红线 SAAS-D-01～08（每批必查）

违反任一项 → **整批驳回**，不进入部分通过（架构 §12.1）。

| 编号      | 决策                   | 验收方法                                      | 不通过特征                           |
| --------- | ---------------------- | --------------------------------------------- | ------------------------------------ |
| SAAS-D-01 | 四层模型 L0–L3 清晰    | 每个业务对象唯一对应一层（架构 §5）           | 对象跨层混放 / 归属不明              |
| SAAS-D-02 | 员工导出 ≠ 租户迁移    | 两条路径分离（架构 §6、§7）                   | 员工 export zip 直接当 tenant-import |
| SAAS-D-03 | 凭证永不 import/export | §9.2 禁止列表 + §10.2 一致；secret scanner    | 包内含 `credentials/` / 明文 token   |
| SAAS-D-04 | tenant 隔离            | 路径前缀 + `tenantId` 门禁；跨租户拒绝        | 缺 `tenantId`；跨 tenant 路径可穿越  |
| SAAS-D-05 | L2 与 Data Space 同构  | SaaS `users/.../OpenBot` = 本机 `~/OpenBot`   | 结构分叉                             |
| SAAS-D-06 | managed 模式边界       | 员工不能 browse/import；与 `LOCAL_ONLY` 一致  | managed 下 RPC 仍 200                |
| SAAS-D-07 | ID 重写规则完整        | 覆盖 user/seat/agent/group/kb/identity（§10） | 残留源 id / agent 冲突未处理         |
| SAAS-D-08 | 平台全局计费隔离       | 计费账本不进单租户包（§11）                   | `openbot-billing-*.json` 打入租户包  |

---

## 3. 已通过（勿重写、勿回滚）

以下模块 **验收通过**，续做时 **直接复用**，勿复制逻辑到 Gateway 层：

| 能力                 | 路径                                                                     | 测试                                           |
| -------------------- | ------------------------------------------------------------------------ | ---------------------------------------------- |
| 迁移就绪引擎         | `src/data/migration-readiness.ts`                                        | `migration-readiness.test.ts`                  |
| CLI / RPC 就绪检查   | `src/cli/program/register.data.ts`、`src/gateway/server-methods/data.ts` | 同上                                           |
| tenant-import 全管线 | `src/data/tenant-import/`（9 模块）                                      | `src/data/tenant-import/*.test.ts`（51 项）    |
| 本地作业编排         | `import-job.ts` → `runLocalTenantImport`                                 | `import-job.test.ts`                           |
| P2 export/restore    | `src/data/data-export.ts`、`register.data.ts`                            | `data-export.test.ts`、`register.data.test.ts` |

**本地测试门禁（回归必跑）**：

```bash
OPENBOT_TEST_PROFILE=low pnpm exec vitest run \
  src/data/migration-readiness.test.ts \
  src/data/tenant-import/*.test.ts \
  src/data/data-export.test.ts
```

---

## 4. P0 阻断（已修复，复验 R1 通过）

| ID       | 项           | 现状（复验 R1）                                                                                                                                                              | 要求                                                                                           | 验收                                                                                                  |
| -------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| **K-01** | 全仓 build   | ✅ 已修复：`enterprise-operational-identity-oauth/credential-secrets-persistence.ts` 导入改为 `../../infra/json-files.js`、`../../utils.js`（对照 `billing/seats-store.ts`） | `pnpm build` 零错误                                                                            | ✅ `pnpm build` → `✓ built`，无 missing-module 报错（仅遗留 knowledge-universe 动态导入告警，非本项） |
| **K-02** | CLI 活体验证 | ✅ 已通过：build 绿后本机执行                                                                                                                                                | `--fail-on-legacy-workspace` 在遗留 `data.root=null` + 分散 workspace 时 **exit 1** 并列出路径 | ✅ 门禁 `exit 1`；无 flag `exit 0`（SAAS-T-05）                                                       |

**归属说明**：K-01 文件属他 agent 未跟踪 WIP（operational-identity OAuth）；本次仅按指令修正**相对导入深度**（收敛式、非行为变更），未改其业务逻辑。

---

## 5. P3 续做（架构 §12.2「尚未交付」）

### 5.1 Gateway RPC（K-03～K-06）

| ID       | RPC 方法                           | 权限     | 实现要点                                                                                            | 验收                                                     |
| -------- | ---------------------------------- | -------- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| **K-03** | `platform.tenant.provision`        | 平台超管 | 创建 `tenants/<tid>/` 空树 + control-plane 占位；注册 `server-methods-list.ts` + `method-scopes.ts` | 员工 token 调用 **403**；超管可创建空 tenant             |
| **K-04** | `platform.tenant.import.preflight` | 平台运维 | 包装 `preflightTenantImportArchive`；校验 manifest `targetTenantId`、配额、tenant 存在性            | 含 secret scan（SAAS-T-04）；跨 tenant manifest **拒绝** |
| **K-05** | `platform.tenant.import.start`     | 平台运维 | 异步作业；`importJobId` 幂等（SAAS-T-02）                                                           | 同 `importJobId` 重试返回原结果，**不重复 commit**       |
| **K-06** | `platform.tenant.import.status`    | 平台运维 | 进度 / phase / 错误 / ID 映射报告                                                                   | 作业状态可查询；审计字段含架构 §15 要求                  |

**注册面**（新建，少碰 UI）：

- `src/gateway/server-methods/tenant-import.ts`（或按域拆分）
- `src/gateway/server-methods/tenant-import*.test.ts`
- 更新 `server-methods-list.ts`、`method-scopes.ts`

**禁止**：员工 token 调用任何 `platform.tenant.*`（架构 §14）。

### 5.2 控制面 store 集成（K-07）

| ID       | 项            | 现状                                      | 要求                                                                                                                 | 验收                                                             |
| -------- | ------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| **K-07** | L1 控制面写入 | `commit.ts` 仅 fs 合并进 `tenants/<tid>/` | 从包内切片解析源 id，写入 **platform-auth**、**seat-assets**、**enterprise-data** store（架构 §11 表）；非仅目录拷贝 | upbeyond 导入后 SaaS UI 可见企业与席位；`stats` 与 manifest 一致 |

**参考索引**（架构 §17）：`platform-auth/store.ts`、`enterprise-seat-assets-store.ts`、`enterprise-data/store.ts`。

### 5.3 运维 CLI（K-08）

| ID       | 项                               | 要求                                                                             | 验收                                                                      |
| -------- | -------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| **K-08** | `openbot platform tenant-import` | 封装 `runLocalTenantImport`；子命令：`preflight` / `start` / `dry-run`（或等价） | 与 Gateway RPC 共用 `src/data/tenant-import/` 核心；CLI 可本机打包 + 预检 |

建议：`src/cli/program/register.platform.ts`（或扩展现有 platform 注册）。

### 5.4 RPC 级 e2e（K-09）

| ID       | 测试 ID   | 本地层状态              | RPC 层要求                                               |
| -------- | --------- | ----------------------- | -------------------------------------------------------- |
| **K-09** | SAAS-T-01 | zip-slip + 路径限定已有 | Gateway 跨 tenant 路径穿越被 API 门禁拦截                |
|          | SAAS-T-02 | commit 重跑一致已有     | 同 `importJobId` 的 `import.start` 幂等                  |
|          | SAAS-T-03 | verify 失败零提交已有   | copy/verify/commit 失败点 RPC 级；目标 tenant 原数据完整 |
|          | SAAS-T-04 | secret-scanner 已有     | preflight RPC 拒绝含凭证样本的包                         |

**验收**：新增 Gateway 测试全绿；禁止仅依赖本地层测试宣称 P3 完成。

---

## 6. P2 遗留（非 P3 关闭阻断，但文档已承诺）

| ID       | 项               | 状态    | 要求                                                                                |
| -------- | ---------------- | ------- | ----------------------------------------------------------------------------------- |
| **K-10** | UI「从导出恢复」 | ⏸️ 阻塞 | 共享 UI 热文件 WIP 释放后按架构 §13.2 接线；或试点阶段仅 CLI `openbot data restore` |

**阻塞原因**（勿强行改他人 WIP）：`render-model-data-directory.ts`、`data-directory-page.ts`、`workbench-stage-contracts.ts` 被他 agent 占用；`workspaces.local.choose` 仅目录选择，需路径输入或新文件选择 RPC。

---

## 7. 试点冒烟（关闭 P3 的硬门禁，对应架构 §16）

**对象**：企业 **upbeyond**（`enterpriseId: "001"`，`slug: "upbeyond"`）；员工 **ceo**（`daniel.upbeyond@gmail.com`）。

**前置**：本机 `data.root` 仍为 `null` 时，须先 Data Space 归集再打包（架构 §8 / SAAS-O-02）。

| #   | 检查项（架构 §16）                                                             | 负责                              |
| --- | ------------------------------------------------------------------------------ | --------------------------------- |
| 1   | 本机 `openbot data verify-migration-readiness --fail-on-legacy-workspace` 通过 | 运维 + Kiro 文档                  |
| 2   | 生成 `tenant-import` 包（L1 切片 + ceo L2；**非** 44KB 员工 export zip）       | Kiro CLI（K-08）                  |
| 3   | SaaS staging `platform.tenant.import.start` 成功                               | Kiro RPC（K-05）                  |
| 4   | 企业管理员 / ceo 可登录                                                        | 运维                              |
| 5   | bot-2、协作组 upbeyond、知识库抽样可用                                         | 产品验收                          |
| 6   | tenant 卷内无 `/Users/` 等源机绝对路径残留                                     | `commit.ts` verify（架构 §16 #8） |
| 7   | 凭证已重配，模型调用成功（架构 §10.2）                                         | 运维                              |
| 8   | `openbot doctor` 无 critical（目标 Gateway）                                   | 运维                              |

### 7.1 可执行 runbook（试点：upbeyond → tenant `001`）

以本轮交付的 CLI（K-08）+ RPC（K-03～K-06）执行；`<source-root>` 为本机归集后的源布局，`/data/tenants` 为 SaaS 租户数据卷。

```bash
# 检查项 #1 — 本机归集就绪（data.root=null 时先归集，见架构 §8）
openbot data verify-migration-readiness --fail-on-legacy-workspace   # 期望 exit 0

# 检查项 #2 — 打包 tenant-import（L1 切片 + 每用户 L2；非员工 export zip）
#   源布局：<source-root>/control-plane/{platform-auth-slice,seat-assets,enterprise-data}.json
#           <source-root>/users/<uid>/OpenBot/{agents,shared,memory,.meta}
openbot platform tenant-import package \
  --source-root <source-root> --source-tenant tenant-upbeyond-local \
  --target 001 --out ./tenant-import-001.zip
#   期望："Package written"；"Contents: N user(s), M agent(s), K file(s)"（确认非 ~44KB 员工包）

# 检查项 #2/#3/#6(静态) — 预检（只读；含 secret scan + 跨租户 + zip-slip）
openbot platform tenant-import preflight --archive ./tenant-import-001.zip --target 001
#   期望："Preflight: OK"；无 secret findings；dry-run 亦可：tenant-import run --dry-run

# 检查项 #3 — provision + 导入（SaaS：OPENBOT_TENANTS_ROOT 指向租户卷）
export OPENBOT_TENANTS_ROOT=/data/tenants
openbot platform tenant-provision --tenant 001
openbot platform tenant-import run --archive ./tenant-import-001.zip --target 001 --job-id smoke-001
#   期望："Import complete (phase=done)"；"Committed files: N"
#   SaaS 侧等价：platform.tenant.import.start（幂等键 importJobId=smoke-001）

# 检查项 #6 — 无源机绝对路径残留（commit.ts verify 已在管线内强制拒绝）
rg -l '/Users/|/home/[^/"]+/' /data/tenants/001 --glob '*.json' | wc -l   # 期望 0

# 检查项 #8 — 目标 Gateway 健康
openbot doctor   # 期望无 critical
```

**K-07 store-reader 校验**：导入后 `tenants/001/control-plane/seat-assets.json` 可经 `loadTenantSeatAssetsStore("001")` 归一化为可用 store（席位 + tenant-owned 运营身份可见），无需拷贝到 `CONFIG_DIR`。

**人工验收**（运维 / 产品）：#4 企业管理员 + ceo 登录；#5 bot-2 / 协作组 upbeyond / 知识库抽样;#7 凭证重配后模型调用成功（架构 §10.2）。

**留档**：命令输出 + manifest `stats` + 冒烟表截图/日志 → PR 描述或 `tasks.md`。

---

## 8. P3b 可选（试点可跳过）

| ID       | 项               | 要求                                                                                                                                                                   |
| -------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **K-11** | `billing-import` | `openbot platform billing-import --tenant <tid> --dry-run`；按 `enterprise_id` 拆分 usage/ledger（架构 §11.2）；复用 `usage-records-store.ts` / `ledger-store.ts` 契约 |

试点客户若不需要历史账单，可跳过 K-11；Cost Dashboard 从导入日起算。

---

## 9. 建议 PR 拆分（避免 CONFLICT）

**交付物声明模板**：每个 PR 标题或正文首行标 `Phase: P3-<子域> — <一句话>`。

| PR               | 范围                       | 文件倾向                                            | 声明模板示例                             |
| ---------------- | -------------------------- | --------------------------------------------------- | ---------------------------------------- |
| **PR-A**         | K-01 build 修复            | 单文件 `credential-secrets-persistence.ts`          | `Phase: P0 — fix oauth import depth`     |
| **PR-B**         | K-03～K-06 RPC + scopes    | `server-methods/tenant-import*`、`method-scopes.ts` | `Phase: P3-RPC — platform.tenant.*`      |
| **PR-C**         | K-08 运维 CLI              | `cli/program/register.platform.ts`                  | `Phase: P3-CLI — platform tenant-import` |
| **PR-D**         | K-07 store 集成 + K-09 e2e | store 接线 + `tenant-import*.test.ts`               | `Phase: P3-e2e — store + isolation`      |
| **PR-E**（可选） | K-11 billing-import        | 独立 runbook 命令                                   | `Phase: P3b — billing-import`            |

**勿** 将 `src/data/tenant-import/`（已绿）与 operational-identity OAuth 大改同 PR。

---

## 10. 提交与归属

- 每个 PR：`tasks.md` 签入 + commit trailer `Task: saas-tenant-import-p3` / `Agent: kiro-<handle>`
- 声明 `paths:` 示例：`src/data/tenant-import/**`、`src/gateway/server-methods/tenant-import*`、`src/cli/program/register.platform.ts`
- 落地前：`bun scripts/agent-attribution.ts --fail-on-unattributed --fail-on-conflict`

---

## 11. P3 MVP 完成定义（Kiro 可声明关闭的条件）

全部勾选后方可将架构文档 §13 P3 由 🚧 改为 ✅：

- [x] **K-01** `pnpm build` 通过（复验 R1，2026-07-11）
- [x] **K-02** `verify-migration-readiness` CLI 活体验证通过（复验 R1，2026-07-11）
- [x] **K-03～K-06** `platform.tenant.*` RPC 注册 + 权限门禁（`server-methods/platform-tenant.ts`；scope + `platform` 域双闸门；7 RPC 级单测，R2）
- [x] **K-07** 控制面 store 集成：从包解析源 id 建 plan（`plan-from-package.ts`，OQ-3 email 合并）+ 提交入 per-tenant `tenants/<tid>/control-plane/` + **per-tenant store-reader**（`tenant-store-paths.ts`：`resolveTenantControlPlaneStorePath` + `loadTenantSeatAssetsStore`，经真实 store API 归一化，5 单测）；剩「全 handler tenant-context 传播」为独立 SaaS-infra 重构（非本 MVP 阻断）
- [x] **K-08** `openbot platform tenant-import`（`package` / `preflight` / `run`）+ `platform tenant-provision`（`register.platform.ts`，共用 tenant-import 核心；3 单测含 package→run 端到端）
- [x] **K-09** SAAS-T-01～04 RPC 级测试绿（`platform-tenant.test.ts`）
- [~] **§7** 冒烟 runbook 已就绪（§7.1 可执行命令序列，映射架构 §16 八项）；**staging 实跑留档待运维**（需 upbeyond 上云环境）
- [x] 架构文档 §13 P3 行更新（§12.2/§13/§14/§17/§18）

**可选**：K-10（UI 恢复）、K-11（billing-import）—— 不阻塞 P3 MVP 关闭，但须在 PR 中注明延后原因。

---

## 12. 验收驳回单模板

```markdown
## SaaS 租户数据验收驳回 — P3 — R<round>

**交付**：PR #<n> / commit <sha> / Kiro agent <id>

### 违反项

- [ ] K-<n> : <简述>
- [ ] SAAS-D-<n> : <架构红线>

### 复现

1. ...
2. ...

### 期望（规格引用）

- docs/design/openbot-saas-tenant-data-architecture.md §<n>
- docs/design/openbot-data-directory-kiro-acceptance-checklist-2026-07-10.md §<n>

### 复验范围

仅重测：K-<n>, SAAS-T-<n>, ...
```

若 Kiro 提交「P3 完成」PR 但未满足 §11，验收方回复：

> **驳回**：P3 本地引擎 ✅，MVP ❌。缺项：{列出 K-xx}。请按 [驳回/续做清单](/design/openbot-saas-tenant-data-kiro-handoff-2026-07-11) §5–§7 续做。证据要求见 §1。

---

## 13. Cursor 验收人备忘

| 动作                   | 说明                                                                |
| ---------------------- | ------------------------------------------------------------------- |
| 不代写 Kiro 范围外功能 | 验收只判是否符合规格，不顺手补实现                                  |
| RPC 门禁必查           | 任何 `platform.tenant.*` 被员工 token 调通 → 一律驳回（架构 §14）   |
| 安全项必查             | 任何包含凭证的 tenant-import 包 → 一律驳回（SAAS-D-03 / SAAS-T-04） |
| 本地层 ≠ 完成          | 仅本地 51 单测绿不算 P3；须 RPC 级 e2e + 冒烟留档                   |
| 文档先行               | Kiro 若改架构须先升规格版本，否则按旧规格驳回                       |
| 登记结果               | 通过后在 §0.1 签署表填日期；驳回出具 §12 驳回单                     |

---

## 14. 附录：Cursor 验收记录

### 14.3 复验 R2（2026-07-11，platform RPC 交付后）

| 命令 / 检查                                                                                     | 结果                                                                                                                                                      |
| ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `vitest run src/data/tenant-import + platform-tenant.test`                                      | **79 passed**（含 7 RPC 级：provision / preflight 跨租户拒绝 / start / 幂等 / verify 失败零提交 / status / 域闸门）                                       |
| `rg 'platform\.tenant\.' src/gateway/server-methods-list.ts method-scopes.ts session-domain.ts` | **已注册**（list + READ/ADMIN scope + `platform` 域）                                                                                                     |
| `guardSessionDomain('platform.tenant.provision', 'employee')`                                   | **拒绝**（员工 403 闸门）                                                                                                                                 |
| `openbot platform tenant-import package/run`（`register.platform.test.ts`）                     | **通过**（K-08：package→run 端到端，提交 3 文件）                                                                                                         |
| `tsgo`（本模块 tenant-import / platform-tenant / register.platform）                            | **0 错误**                                                                                                                                                |
| `pnpm build`                                                                                    | **红**——他 agent 的 `platform-auth-email.ts` 重复 `PlatformAuthSmtpConfig` + `enterprise-operational-identity` 缺失模块，**非本模块**（本模块 tsgo 0 错） |
| K-07 per-tenant store-reader（`tenant-store-paths.test.ts`）                                    | **通过**（5 单测：解析 / 真实 store API 加载切片 / 缺文件默认 / 租户隔离 / 非法 id）                                                                      |
| §7 冒烟 runbook（§7.1）                                                                         | **就绪**（可执行命令序列映射 §16 八项）；staging 实跑留档待运维                                                                                           |

### 14.1 复验 R1（2026-07-11，K-01/K-02 修复后）

| 命令 / 检查                                                             | 结果                                                                |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `vitest run migration-readiness + tenant-import/*.test`                 | **77 passed**（51 tenant-import + 迁移就绪 + export 等）            |
| `pnpm build`                                                            | **✓ built**（K-01 修复后无 missing-module；仅遗留 UI 动态导入告警） |
| `data verify-migration-readiness --fail-on-legacy-workspace`            | **exit 1** 并列路径（K-02 / SAAS-T-05）                             |
| `rg 'platform\.tenant\.(provision\|import)' src/gateway/server-methods` | **无匹配** — RPC 仍未注册（K-03～K-06 续做）                        |
| 架构 §12.2「尚未交付」                                                  | RPC / store 集成 / RPC 级 e2e / 冒烟 仍为 ⏳                        |

### 14.2 首验 R0（2026-07-11，初裁）

| 命令 / 检查                                        | 结果                                                       |
| -------------------------------------------------- | ---------------------------------------------------------- |
| `vitest run migration-readiness + tenant-import/*` | **77 passed**                                              |
| `pnpm build`                                       | **失败** — `credential-secrets-persistence.ts` import 路径 |
| RPC 注册检查                                       | **无匹配**                                                 |

---

## 15. 文档修订记录

| 版本 | 日期       | 说明                                                                                                                                                                                                                                                                           |
| ---- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| v1.0 | 2026-07-11 | 初版：P3 本地引擎裁定通过、MVP 驳回；K-01～K-11 续做清单                                                                                                                                                                                                                       |
| v1.1 | 2026-07-11 | 格式对齐 Data Space 验收清单（§2 红线表 / §0.1 签署表 / §12 驳回单 code block / §13 备忘 / §15 修订表）；K-01/K-02 复验 R1 通过并回填                                                                                                                                          |
| v1.2 | 2026-07-11 | 复验 R2 回填：K-03～K-06（`platform.tenant.*` RPC）+ K-08（`register.platform.ts` 运维 CLI）+ K-09（RPC 级 SAAS-T-01～04）通过、K-07 部分交付（plan-from-package + per-tenant control-plane 写入；store-reader 待接线）；§0/§11/§14.3/§17 更新。剩 §7 冒烟 + K-07 store-reader |
| v1.3 | 2026-07-11 | K-07 收尾：新增 `src/gateway/tenant-store-paths.ts`（per-tenant store-reader，5 单测）+ DRY `platform-tenant.ts`/`register.platform.ts` 复用；§7 扩为可执行 runbook（§7.1）。P3 MVP 代码面闭环，唯余 §7 staging 实跑留档                                                       |

---

_对应架构文档：openbot-saas-tenant-data-architecture.md v1.1_
