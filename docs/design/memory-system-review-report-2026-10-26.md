# 记忆系统复查报告（2026-10-26）

| 字段                         | 值                                                                        |
| ---------------------------- | ------------------------------------------------------------------------- |
| 文档 ID                      | `memory-system-review-report-2026-10-26`                                  |
| 复查日期（Asia/Shanghai）    | 2026-10-26                                                                |
| 初查时间窗口                 | 约 10:24–10:30（Asia/Shanghai）                                           |
| 审核修订时间                 | 约 10:53–11:20（Asia/Shanghai）                                           |
| 初查时 Git SHA（源码工作区） | `5511bf9e6064bacda2278eeed58e9f4991549fd5`                                |
| 修订时 Git SHA（源码工作区） | `d7c4f74978f3e7694a54c2573e1d98a1dd4e7883`                                |
| 分支（源码工作区）           | `collab-group/u1-unified-task-stop`                                       |
| Loom 任务                    | `memory-system-review-2026-10-26:grok-bot`                                |
| 状态                         | 本机源码/配置/只读库/局部测试已核实；**生产未验证**；本稿为审核意见修订版 |
| 本阶段范围                   | 仅调查、验证与方案编写；**无业务代码变更、无部署、无真实记忆迁移**        |

## 1. 环境、版本及证据边界

### 1.1 证据平面（严格区分）

| 平面                           | 是否访问       | 说明                                                                           |
| ------------------------------ | -------------- | ------------------------------------------------------------------------------ |
| 本机源码工作区                 | 是             | `/Users/daniel/AI VP/openbot`，machineId `5374ace8-…`                          |
| 本机运行配置                   | 是             | `~/.openbot/openbot.json`、`~/.openbot/.env`（只读，脱敏）                     |
| 本机 managed Data Space 权威库 | 是             | SQLite URI `mode=ro`；路径 `~/OpenBot/.meta/cogniweave/canonical.sqlite`       |
| 本机运行中 gateway（运行入口） | 是（只读观察） | PID 监听 `127.0.0.1:18789`；`lsof` 确认打开的 DB；**cwd/产物与源码工作区分离** |
| 隔离测试                       | 是             | vitest / `@cogniweave/sdk` vitest；临时引擎                                    |
| 生产 / SaaS LIVE               | **否**         | 一律标「未验证」；不得用本机结果替代                                           |

> **口径约定（审核修订）**：全文凡涉及库计数、进程打开文件、配置解析，一律称「本机 managed Data Space 权威库」或「本机运行入口」。不使用「生产库」「生产观察」。源码中的通用入口（如 `listMemoryCenterAtoms`）仅称「源码入口 / 本机配置下的入口」，**不得**称作「已验证的生产入口」。

### 1.2 关键配置与运行身份（脱敏）

- `memory.backend` = `cogniweave`
- `memory.cogniweave.mode` = `embedded`
- `memory.cogniweave.writeSync` = `sync`
- `memory.cogniweave.sources` = `["memory","sessions"]`
- `memory.cogniweave.sharedSources` = `["sessions"]`
- `memory.cogniweave.cloudSync`：**未配置** → 解析默认 `enabled=false`
- `agents.defaults.memorySearch.enabled` = `true`（embedding provider 已配）
- `OPENBOT_DATA_MODE=managed`，`OPENBOT_MULTITENANT=1`
- `OPENBOT_TENANTS_ROOT=/Users/daniel/OpenBot/tenants`
- Data Root 默认 / 实际：`~/OpenBot`
- State Dir：`~/.openbot`

### 1.3 源码 SHA vs 运行产物身份（收紧结论）

进程打开便携数据库**只能**证明「本机运行入口正在使用该路径」，**不能单独**证明运行产物与本次检查的源码工作区一致。分别记录：

| 身份项                           | 观测值                                                                                                                       | 可证明什么                                 | 无法确认                                                                         |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | -------------------------------------------------------------------------------- |
| 源码工作区 HEAD                  | 初查 `5511bf9e…`；修订时 `d7c4f749…`；分支 `collab-group/u1-unified-task-stop`                                               | 本报告对照阅读的源码版本                   | 不等于运行中 gateway 加载的代码                                                  |
| 运行中 gateway PID               | `85921`（修订时复测；初查窗口亦为监听 `127.0.0.1:18789` 的本机进程）                                                         | 本机运行入口存在                           | —                                                                                |
| 监听                             | `127.0.0.1:18789` / `[::1]:18789`                                                                                            | 本机 gateway 端口                          | —                                                                                |
| 进程 cwd                         | `/Users/daniel/AI VP/openbot-gateway-rebuild-858`                                                                            | 运行自**独立重建树**，非源码工作区路径     | —                                                                                |
| 重建树 Git HEAD                  | `be3221cce7d1cf77330f24cfb43170280ff74857`（分支 `collab/p0-wake-dispatcher-boot`）                                          | 重建工作区 tip                             | 进程未必热加载到该 tip                                                           |
| `dist/build-info.json`（重建树） | `version=2026.7.12-rc.2`，`commit=57c220b8…`，`builtAt=2026-10-24T11:19:02.522Z`（UTC；Asia/Shanghai = 2026-10-24 19:19:02） | 该树曾构建的产物指纹                       | 进程实际映射的 `dist/*` chunk 是否与该 build-info 逐文件一致（未做模块映射核对） |
| 打开的权威库                     | `~/OpenBot/.meta/cogniweave/canonical.sqlite`（及 `-wal`/`-shm`）                                                            | 本机运行入口使用 managed Data Space 便携库 | 不证明源码 SHA == 运行产物                                                       |

**复现命令（脱敏，只读）**：

```bash
# 源码工作区
git -C "/Users/daniel/AI VP/openbot" rev-parse HEAD
# 本机运行入口
lsof -nP -iTCP:18789 -sTCP:LISTEN
lsof -p <gateway-pid> | rg 'cwd|canonical\.sqlite'
# 重建树身份
git -C "/Users/daniel/AI VP/openbot-gateway-rebuild-858" rev-parse HEAD
cat "/Users/daniel/AI VP/openbot-gateway-rebuild-858/dist/build-info.json"
```

### 1.4 工作区脏文件概况（不贴内容）

复查时除本任务 Loom 登记外，工作区另有其他 Agent 未提交改动（协作 dispatch 相关等）。本任务**未修改、未提交、未覆盖**这些文件；仅维护本报告与优化方案，并登记 Loom。

### 1.5 未执行的危险操作

- **未**对真实权威库执行 `search` / `sync` / `writeBack`（`search()` 会先 `syncScope`，在 `writeSync=sync` 下可触发写入）。
- **未**调用可能写入的 gateway 记忆 RPC（如 `data.memory.forget`）。
- **未**重建索引、迁移、删除记忆、重启网关、部署。
- **未**扩展到生产访问。

---

## 2. 实际记忆架构（本机已证实）

### 2.1 权威存储与路径一致性

```
配置 memory.backend=cogniweave
        │
        ▼
resolveMemoryBackendConfig()  → backend=cogniweave, writeSync=sync, storePath=undefined
        │
        ▼
CogniWeaveMemoryManager → ensurePortableCanonicalStore()
        │
        ├─ 便携权威库（本机现行）: ~/OpenBot/.meta/cogniweave/canonical.sqlite
        │     migration_state.json phase=completed（completedAt=2026-09-23T09:00:28.749Z UTC
        │       → Asia/Shanghai 2026-09-23 17:00:28）
        │     自 legacy ~/.openbot/cogniweave/canonical.sqlite cutover
        │
        └─ 本机运行入口（PID 打开文件）: 确认打开便携权威库（非 legacy）
```

**结论（M01）**：本机配置、解析结果、本机运行入口打开的权威库路径**一致**，权威库为 managed Data Space 便携路径，而非仍把 legacy 当作现行权威。  
（与前次盘点「已识别便携库」一致；本复查补强了 `lsof`、migration_state 与配置解析的可复现证据，见 §6。）

覆盖点：

- 显式 `memory.cogniweave.storePath`：未配置。
- `OPENBOT_DATA_ROOT`：未在 `.env` 观察到；默认 `~/OpenBot`。
- 租户工作区：`agents.defaults.workspace` 指向 `~/.openbot/tenants/001/users/<user>/OpenBot/agents/main/workspace`；与 `OPENBOT_TENANTS_ROOT=/Users/daniel/OpenBot/tenants` **并存**（数据平面与 workspace 绑定路径不同，属 managed 布局，不是 backend 漂移）。

### 2.2 写入链路

1. 工作区 Markdown / session 文档被 `listIndexedDocuments` 收集。
2. `syncScope` / `writeBack` 写入 CogniWeave engine（`writeSync=sync`）。
3. 完成写入落入 `cogniweave_write_operations`（本机全部为 `result.status=COMPLETED`）。
4. 事件 / 证据 / 原子进入对应表；ingestions/journals 量级远大于 write_operations（反映细粒度摄入与幂等日志差异，不是一一对应失败计数）。

### 2.3 检索与提示词注入

| 路径                                  | 机制                                                                                                             | 备注                                                                           |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Agent `memory_search` 工具            | `getMemorySearchManager` → CogniWeave `search()` → `syncScope` + `frameTask`/`reason` + evidence                 | **有副作用风险**（sync/writeBack）；本复查未对真实库调用                       |
| Memory Center `listMemoryCenterAtoms` | `ensureMemorySubjectBinding` + `queryAtoms`                                                                      | 源码 ACL 入口；**本机**权威库 `cogniweave_memory_subject_bindings=0`（非生产） |
| 协作学习回流                          | `buildLearningRecallSystemPrompt` → 读 `learning-assets.json` → **构造**提示词片段 → `recordLearningReuseSafely` | 与 CogniWeave atom `reuseCount` **不是同一字段**；计数点见 M06                 |

### 2.4 遗忘链路（实现分叉）

| 入口                                                   | 行为                                             | 是否触达 CogniWeave forget                                                              |
| ------------------------------------------------------ | ------------------------------------------------ | --------------------------------------------------------------------------------------- |
| `data.memory.forget` → `forgetMemoryEntry`             | 仅删除 Data Space 候选文件路径                   | **否**（`src/gateway/server-methods/data.ts` ≈237–261；`src/data/memory-lifecycle.ts`） |
| `CogniWeaveMemoryManager.applyMemoryArtifactLifecycle` | 对已索引 locator 调 `forgetSource`（可选 purge） | **是**（需被调用；`cogniweave-manager.ts` ≈816）                                        |
| `applyTranscriptSourceLifecycle`                       | 会话/源生命周期 archive/restore/forget/purge     | **是**                                                                                  |
| 单元测试 `cogniweave-manager.lifecycle.test.ts`        | 证明 API 在隔离环境可 forget 并过滤检索          | 是（隔离）                                                                              |

本机权威库：`cogniweave_source_bindings` / `source_lifecycle_operations` / `source_object_links` 均为 **0**。说明：不能仅凭「存在 forget API」断言文件删除后权威库最终一致；也不能仅凭「`data.memory.forget` 未调用 API」在未做删除后召回验证前断言业务故障已发生。

---

## 3. M01–M10 逐项复查

### M01 — 配置 / 运行后端 / 权威库路径一致性

| 项       | 内容                                                                                                                                   |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 前次说法 | 本机配置为 CogniWeave embedded、同步写入；需核实运行后端与权威库路径是否一致，是否有环境/租户覆盖                                      |
| 复查结论 | **确认**（本机）                                                                                                                       |
| 证据     | 见下方可复现摘要                                                                                                                       |
| 复现     | 加载 `~/.openbot/openbot.json`；tsx 只读解析探针；`lsof -p <gateway-pid> \| rg canonical.sqlite`；读 `migration_state.json` 的 `phase` |
| 影响范围 | 运维诊断必须以便携权威库为准；勿再把 legacy `~/.openbot/cogniweave` 当现行 SoT                                                         |
| 置信度   | 高（路径一致性）；运行产物与源码 SHA 对齐见 §1.3（中/未完全确认）                                                                      |
| 仍缺     | 生产容器内同等核对（未验证）；运行中模块与 `build-info.commit` 的逐文件映射                                                            |

**可复现证据摘要（脱敏）**：

```text
# 解析探针关键输出（保存自初查 /tmp/openbot-m03-repro.txt 摘要）
cfg.memory.backend cogniweave
resolved.backend cogniweave
resolved.storePath undefined
resolved.writeSync sync
resolved.mode embedded
resolved.cloudSync.enabled false
probe.backend builtin          # ← M03 误报，非解析失败
probe.indexPath ~/.openbot/memory/main.sqlite

# migration_state.json（仅 phase/时间，不含路径校验和）
phase=completed
completedAt=2026-09-23T09:00:28.749Z

# lsof（修订复测 PID 85921）
…/OpenBot/.meta/cogniweave/canonical.sqlite
…/OpenBot/.meta/cogniweave/canonical.sqlite-wal
…/OpenBot/.meta/cogniweave/canonical.sqlite-shm
cwd=/Users/daniel/AI VP/openbot-gateway-rebuild-858
```

### M02 — 权威库事件 / 原子 / 写入日志含义

| 项                                               | 内容                                                                                                                                                                                                                                                     |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 前次说法                                         | 权威库有事件、记忆原子和已完成写入日志                                                                                                                                                                                                                   |
| 复查结论                                         | **确认**（数据存在与口径）；**部分确认**（“写入成功”语义）                                                                                                                                                                                               |
| 证据（本机 managed Data Space 权威库，只读统计） | 见下方 SQL；atoms=216；events=5686；evidence=5686；write_operations=2497 且 `result.status=COMPLETED`；ingestions=207809；dedup_bindings=216；时间窗 write `completed_at` ≈ 2026-09-23 → 2026-10-24 UTC；atom `updated_at` ≈ 2026-06-06 → 2026-10-24 UTC |
| 数据来源与时间                                   | **本机 managed Data Space**；cutover 完成后持续有写入；**非生产**                                                                                                                                                                                        |
| 写入成功代表什么                                 | `cogniweave_write_operations` 是**已完成**幂等写日志，不证明检索命中、提示词注入或回答采用；表中未见失败行（失败可能根本不落此表）                                                                                                                       |
| 重复 / 失败 / 滞后 / 只写不读                    | 有 dedup_bindings=216（与 atoms 对齐）；失败率**无法**从此表直接统计；`memory_subject_bindings=0` 与检索效果未用真实 search 验证 → 「只写不读」**证据不足**                                                                                              |
| 影响范围                                         | 监控若把 write_operations 当业务成功率会高估                                                                                                                                                                                                             |
| 置信度                                           | 高（计数）；中（语义边界）                                                                                                                                                                                                                               |
| 仍缺                                             | 隔离环境制造失败写以确认失败落点；生产同等统计                                                                                                                                                                                                           |

**只读查询（可复现；不含正文）**：

```bash
DB="$HOME/OpenBot/.meta/cogniweave/canonical.sqlite"
sqlite3 "file:${DB}?mode=ro" \
  "SELECT 'atoms',COUNT(*) FROM cogniweave_atoms
   UNION ALL SELECT 'events',COUNT(*) FROM cogniweave_events
   UNION ALL SELECT 'evidence',COUNT(*) FROM cogniweave_evidence
   UNION ALL SELECT 'write_ops',COUNT(*) FROM cogniweave_write_operations
   UNION ALL SELECT 'ingestions',COUNT(*) FROM cogniweave_ingestions
   UNION ALL SELECT 'bindings',COUNT(*) FROM cogniweave_memory_subject_bindings
   UNION ALL SELECT 'source_bindings',COUNT(*) FROM cogniweave_source_bindings;"

# 输出摘要：
# atoms|216  events|5686  evidence|5686  write_ops|2497
# ingestions|207809  bindings|0  source_bindings|0

sqlite3 "file:${DB}?mode=ro" \
  "SELECT COALESCE(json_extract(payload,'\$.result.status'),'unknown'), COUNT(*)
   FROM cogniweave_write_operations GROUP BY 1;"
# COMPLETED|2497

sqlite3 "file:${DB}?mode=ro" \
  "SELECT COALESCE(CAST(json_extract(payload,'\$.metrics.reuseCount') AS TEXT),'null'), COUNT(*)
   FROM cogniweave_atoms GROUP BY 1;"
# 0|216
```

### M03 — 健康检查报告 builtin

| 项             | 内容                                                                                                                                                                                                                                                                                                                                                            |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 前次说法       | 健康检查把后端报告为 builtin                                                                                                                                                                                                                                                                                                                                    |
| 复查结论       | **确认**（可复现；根因为硬编码/探针输入，非配置解析失败）                                                                                                                                                                                                                                                                                                       |
| 证据           | `buildMemoryProbeAgentInput`：`backend: memorySearch ? "builtin" : "unknown"`（`src/gateway/server-methods/doctor-memory-health.ts:85`）；`runOpsHealthProbe` 默认 `backend ?? "builtin"`（`src/memory/health-probe-run.ts:45` / `:58`）；本机探针：`cfg.memory.backend=cogniweave` 但 `probe.backend=builtin`，`probe.indexPath=~/.openbot/memory/main.sqlite` |
| 顶层 `ok` 语义 | `status:"ok"` + `reasonCode:"probe.ok"` 仅表示**探针完整性通过且未检测到被监视路径突变**，**不**表示记忆后端正确、索引新鲜或召回可用                                                                                                                                                                                                                            |
| 影响范围       | 运维误判；与真实 backend 脱节的可观测性缺陷                                                                                                                                                                                                                                                                                                                     |
| 置信度         | 高                                                                                                                                                                                                                                                                                                                                                              |
| 仍缺           | 对本机运行入口实际 RPC 回包抓包（本阶段为避免副作用未调用）；生产未验证                                                                                                                                                                                                                                                                                         |

**复现方式**：

```bash
# 只读 tsx 探针（加载配置 + buildMemoryProbeAgentInput；不写库）
# 关键摘要见上文 / 初查保存的过程输出摘要（已随文档固化关键字段）
pnpm exec tsx -e '... buildMemoryProbeAgentInput(cfg,"main") ...'
# 期望：resolved.backend=cogniweave 且 probe.backend=builtin（现状缺陷）
```

### M04 — Markdown 空但 CogniWeave 有记录

| 项       | 内容                                                                                                                                                                                                                                                                                                                                                                               |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 前次说法 | 部分工作区 Markdown 为空但 CogniWeave 有记录；审计脚本可能用旧后端规则误判                                                                                                                                                                                                                                                                                                         |
| 复查结论 | **部分确认**（与前次「空 Markdown ≠ 无记忆」边界一致，并补强 audit 脚本行为证据）                                                                                                                                                                                                                                                                                                  |
| 证据     | `agt-elledecke204-gmail-com-` / `…n1dwf0gz`：audit `memoryMdAtResolved=0` 且标 P0 `empty-workspace`；同库 atoms 分别为 10 / 11。`main` 无根级 `MEMORY.md`，但有 `memory/*.md` 且 atoms=29。审计脚本**已读取** `cfg.memory.backend=cogniweave`，但仍用 Markdown 计数 + builtin sqlite 路径（`~/.openbot/memory/<agent>.sqlite`）驱动恢复建议（`reindex-ready` / `empty-workspace`） |
| 影响范围 | 把「无 Markdown」当成 CogniWeave 故障会造成误修复；建议动作偏向旧 builtin 索引命令                                                                                                                                                                                                                                                                                                 |
| 置信度   | 高（本机）                                                                                                                                                                                                                                                                                                                                                                         |
| 仍缺     | 生产 audit 输出（未验证）                                                                                                                                                                                                                                                                                                                                                          |

### M05 — atom `reuseCount` 全 0

| 项       | 内容                                                                                        |
| -------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 前次说法 | 记忆原子 reuseCount 全为 0，可能表示无复用                                                  |
| 复查结论 | **确认**全为 0；**确认前次边界**「reuseCount=0 ≠ 未复用」（字段未接线，不能据此判断无复用） |
| 证据     | 216 atoms 的 `payload.metrics.reuseCount` 分布 `0                                           | 216`（SQL 见 M02）；源码中 reuseCount 用于排序加权（`atom-v2`）与合并 max，**未见**召回成功后的自增写回；协作学习复用走**另一套** `learning-assets.json.reuseCount` |
| 统计口径 | 字段存在于 atom metrics；当前写入路径初始化为 0 后基本冻结                                  |
| 影响范围 | 用该字段做「记忆复用率」KPI 无效                                                            |
| 置信度   | 高                                                                                          |
| 仍缺     | 产品是否意图接通该字段（产品决策；见方案 D1）                                               |

### M06 — 协作学习资产与提示词构造计数

| 项                   | 内容                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 前次说法             | 有少量资产及提示词复用计数                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 复查结论             | **部分确认**；指标须命名为**提示词构造计数**，不是「请求已发送」或「模型已采用」                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 证据                 | 本机发现 3 个 `learning-assets.json`（含测试/受限群痕迹）；资产合计 3；`reuseCount` 分布含 0 与 3。路径经 `createWorkspaceCollaborationStores()` → groups 根下按 scope 分片                                                                                                                                                                                                                                                                                                                                                                               |
| 计数点与模型调用先后 | 见下方时序；`recordLearningReuse` 注释（`learning-recall.ts:214–218`）明确：复用 = **真的进了提示词**，不是被创建或查看。计数发生在 `buildLearningRecallSystemPrompt` 内、**返回 prompt 字符串之前**（`learning-recall-context.ts:134` 调用 `recordLearningReuseSafely`）。调用方 `get-reply-run.ts:1247` 在组装 `extraSystemPromptParts` 时 await 该函数；其后才进入 `runReplyAgent`（约 `:1675`）。因此：已证实 = 「候选经验被选入并渲染进待注入的 system 片段，且本地 reuse 账本 +1」；**未证实** = 「含该片段的请求已发往模型」或「模型采用了该经验」 |
| 指标命名             | **提示词构造计数**（prompt-construction / injected-into-assembled-prompt）。若未来在 HTTP/SDK 发送点另计，应单列「请求发送计数」，不得与本字段混用                                                                                                                                                                                                                                                                                                                                                                                                        |
| 筛选                 | active + 置信/复用/时间排序 + limit；**无**当前任务语义相关性过滤器（capabilities 被提取但不用于按任务匹配过滤）                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 影响范围             | 可能注入与当前任务无关的经验；提示词构造计数不能代表回答质量或请求发送                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 置信度               | 中高（源码时序高；本机样本偏少）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 仍缺                 | 实际对话回合日志关联到模型请求体；生产协作根路径（未验证）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

```text
时序（源码）：
  buildLearningRecallSystemPrompt
    → readLearningRecall / merge / renderLearningRecallPrompt
    → recordLearningReuseSafely  # 提示词构造计数 +1（fire-and-forget）
    → return prompt
  get-reply-run 将 prompt 并入 extraSystemPromptParts
  … 后续 runReplyAgent / 模型调用   # 本复查未跟踪到「请求发送计数」
```

### M07 — `query-atoms-acl` 测试失败

| 项       | 内容                                                                                                                                                                                                                                                                                                                                              |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 前次说法 | 测试稳定失败；可能缺主体绑定                                                                                                                                                                                                                                                                                                                      |
| 复查结论 | **确认**仍失败；分类为 **测试过时 / 不完整**（相对产品 ACL 设计），辅以 **潜在产品缺口**（本机 binding 表为空）                                                                                                                                                                                                                                   |
| 首次失败 | 2026-10-26 10:27:56（Asia/Shanghai）— `expected [] to deeply equal ['a1']`                                                                                                                                                                                                                                                                        |
| 独立重跑 | 10:28:07（Asia/Shanghai）— 同样失败                                                                                                                                                                                                                                                                                                               |
| 根因     | `queryAtoms` 在无 live `MemorySubjectBinding` 时 fail-closed 返回 `[]`；测试传了 `caller` 但未调用 `ensureMemorySubjectBinding`。对照：`@cogniweave/sdk` `in-memory-engine.query-p4.test.ts` 先 seed binding 后 **4/4 通过**（合法可读 + 越权拒绝）。源码入口 `listMemoryCenterAtoms` **会** `ensureMemorySubjectBinding`（非「已验证生产入口」） |
| 本机观察 | `cogniweave_memory_subject_bindings=0` → Memory Center 列表路径若从未成功 ensure/persist，ACL 读可能持续空；agent `memory_search` 走 `reason` 路径，不经过 `queryAtoms`                                                                                                                                                                           |
| 影响范围 | CI 噪声；Memory Center 列表可靠性待验证                                                                                                                                                                                                                                                                                                           |
| 置信度   | 高（测试根因）；中（binding 为空的业务影响）                                                                                                                                                                                                                                                                                                      |
| 仍缺     | 隔离副本上调用 `listMemoryCenterAtoms` 观察 binding 是否落库（避免真实副作用需副本）                                                                                                                                                                                                                                                              |

**测试执行方式与摘要**：

```bash
# 失败用例（两次独立重跑）
pnpm exec vitest run src/memory/query-atoms-acl.test.ts
# Start 10:27:56 / 10:28:07 Asia/Shanghai
# FAIL expected [] to deeply equal ['a1']  @ query-atoms-acl.test.ts:57

# 对照 SDK（通过）
cd packages/cogniweave-sdk && pnpm exec vitest run src/runtime/in-memory-engine.query-p4.test.ts
# 4 passed @ 10:29:40 Asia/Shanghai
```

### M08 — 文件遗忘与会话生命周期入口不一致

| 项       | 内容                                                                                                                                                                  |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 前次说法 | 文件遗忘与会话生命周期入口实现不同；可能缺陷                                                                                                                          |
| 复查结论 | **部分确认**（实现分叉属实）；**证据不足**直接定性为「删除后召回不一致」的已发生故障                                                                                  |
| 证据     | `data.memory.forget` 只调 `forgetMemoryEntry`；生命周期 API 与单测存在且通过；本机 `source_*` 表全 0；session 文件有 sync 调度，Markdown 删除补偿未在 forget RPC 串联 |
| 影响范围 | Memory Center「忘记」可能只删文件，索引/原子/证据残留风险                                                                                                             |
| 置信度   | 中（分叉）；低（线上症状）                                                                                                                                            |
| 仍缺     | 隔离环境：写文件→索引→forget RPC→再检索                                                                                                                               |

### M09 — 云同步 InMemoryCloudIntelligenceClient

| 项       | 内容                                                                                                                                                                                                              |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 前次说法 | 云同步使用 InMemory 客户端                                                                                                                                                                                        |
| 复查结论 | **确认**                                                                                                                                                                                                          |
| 证据     | 全仓库唯一 `implements CloudIntelligenceClient` 实现为 `InMemoryCloudIntelligenceClient`；`cogniweave-manager` 注释写明 stub until HTTP client lands；本机 `cloudSync.enabled=false`，循环在 enabled 门闩处不启动 |
| 影响范围 | 在未开启 cloudSync 时**不是**现行故障；开启后仍无真实云客户端                                                                                                                                                     |
| 置信度   | 高                                                                                                                                                                                                                |
| 仍缺     | 生产配置是否启用 cloudSync（未验证）                                                                                                                                                                              |

### M10 — 持久化有，回答效果未验证

| 项       | 内容                                                                                                                                                                    |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 前次说法 | 数据已持久化但回答效果未经验证                                                                                                                                          |
| 复查结论 | **确认**                                                                                                                                                                |
| 证据     | 本机有持久化统计；未见区分「检索命中 / 提示词注入 / 回答采用 / 正确采用」的线上指标或基准集；现有 acceptance 多为 workspace/governance 阶段证据，非端到端回忆正确性基准 |
| 影响范围 | 无法用数据量证明记忆「好用」                                                                                                                                            |
| 置信度   | 高                                                                                                                                                                      |
| 仍缺     | 基线测量设计见优化方案；生产指标（未验证）                                                                                                                              |

---

## 4. 测试结果与失败根因

| 套件                                                          | 结果                | 分类                                                                            |
| ------------------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------- |
| `src/memory/query-atoms-acl.test.ts`                          | 失败 ×2（独立重跑） | **测试过时/不完整**（缺 `ensureMemorySubjectBinding`）；非证明 ACL 实现整体失效 |
| `packages/cogniweave-sdk` `in-memory-engine.query-p4.test.ts` | 4 passed            | 产品 ACL 在正确绑定时行为符合预期                                               |
| `src/memory/cogniweave-manager.lifecycle.test.ts`             | 4 passed            | 生命周期 API 隔离可用                                                           |
| `src/memory/health-probe.test.ts`                             | 7 passed            | 探针只读约束成立                                                                |
| `src/gateway/server-methods/doctor-memory-health.test.ts`     | 6 passed            | 作用域过滤成立                                                                  |
| M03 解析探针（tsx 只读）                                      | 复现 builtin 误报   | **产品可观测性缺陷**                                                            |
| `scripts/memory-platform-audit.mjs`                           | 只读跑通            | 启发式偏 Markdown/builtin sqlite                                                |

**禁止事项遵守**：未改断言、未 skip 制造通过。

---

## 5. 已证实能力 / 已证实问题 / 未验证事项

### 5.1 已证实能力（本机）

- CogniWeave embedded + sync 配置生效；本机运行入口打开便携权威库。
- 权威库持续有完成态写入与原子/事件/证据沉淀。
- 可移植 cutover FSM 已 `completed`（`migration_state.json`）。
- 隔离环境下：源生命周期 forget/archive；queryAtoms ACL（在绑定后）合法可读与越权拒绝。
- 健康探针具备只读完整性信封（但 backend 字段错误）。

### 5.2 已证实问题（本机）

1. **可观测性**：doctor memory health 将 backend 硬编码/默认成 `builtin`，顶层 `ok` 不含后端正确性。
2. **审计启发式**：`memory-platform-audit` 在 cogniweave 下仍用空 Markdown 作为 P0，并指向 builtin sqlite/reindex 叙事。
3. **指标口径**：atom `reuseCount` 未接入召回自增，不能代表复用；学习侧仅为**提示词构造计数**。
4. **测试债务**：`query-atoms-acl.test.ts` 与现行 ACL 契约脱节。
5. **遗忘入口分叉**：文件 forget RPC 未串联 CogniWeave artifact lifecycle。
6. **效果验证缺失**：无端到端回忆/采用基线。
7. **运行身份**：本机运行入口 cwd/build-info 与源码工作区 SHA **不一致**；路径一致 ≠ 版本一致。

### 5.3 未验证（含生产）

- 生产配置、权威库、健康 RPC 实包、cloudSync 开关。
- 真实 `memory_search` 命中率与回答采用率（本阶段禁止有副作用的真实检索）。
- 文件删除后权威库/缓存/召回最终一致性（需隔离副本实验）。
- `memory_subject_bindings=0` 是否导致 Memory Center 列表长期为空。
- 协作学习资产是否覆盖真实业务群（本机样本偏少且含测试群）。
- 「提示词构造」之后的「请求发送计数」与回答采用率。

---

## 6. 对前次盘点的更正清单（区分纠正 vs 补强）

前次盘点**已经识别**：便携权威库；以及「空 Markdown ≠ 无记忆」「reuseCount=0 ≠ 未复用」等边界。本复查不得把上述已有结论写成「被推翻」。清单分两类：

### 6.1 纠正前次错误 / 过强表述

| #   | 纠正项                                                              | 说明                                                                 |
| --- | ------------------------------------------------------------------- | -------------------------------------------------------------------- |
| C1  | 若前次把 `write_operations` 完成态表述为「记忆效果达标」            | **纠正**：只证明完成态写入落账，≠ 召回/注入/采用                     |
| C2  | 若前次把健康检查顶层 `ok` 表述为「记忆系统健康」                    | **纠正**：只证明探针完整性信封，≠ backend 正确或召回可用             |
| C3  | 若前次把 `query-atoms-acl` 失败表述为「ACL 产品整体失效」           | **纠正**：测试未绑定主体；SDK 正式 ACL 测试在绑定后通过              |
| C4  | 若前次把 `InMemoryCloudIntelligenceClient` 表述为「现行云同步故障」 | **纠正**：本机 cloudSync 关闭；该客户端是未启用路径上的 stub         |
| C5  | 若前次暗示「进程打开便携库 ⇒ 运行版本=检查源码」                    | **纠正**：只能证明路径；运行产物身份见 §1.3，与源码工作区 SHA 不一致 |

### 6.2 补强前次未验证 / 已识别但证据不足的事项

| #   | 补强项                          | 说明                                                                                                                    |
| --- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| S1  | 便携权威库为现行 SoT            | 前次已识别；本复查补强：`lsof`、`migration_state.json phase=completed`、配置/`resolveMemoryBackendConfig` 一致证据      |
| S2  | 空 Markdown ≠ CogniWeave 无记忆 | 前次已有边界；本复查补强：audit 脚本在 backend=cogniweave 下仍报 P0 `empty-workspace` 及 builtin reindex 建议的具体行为 |
| S3  | atom `reuseCount=0` ≠ 未复用    | 前次已有边界；本复查补强：SQL 分布 `0                                                                                   | 216`、源码无自增写回、与 learning-assets 字段分离 |
| S4  | 学习复用计数语义                | 补强为**提示词构造计数**，并核对相对 `runReplyAgent` 的先后关系                                                         |
| S5  | 遗忘入口分叉                    | 补强源码行号与「未做删除后召回验证 ⇒ 不得断言已发生故障」                                                               |
| S6  | 效果基线缺失                    | 确认仍无端到端金标；指向优化方案 O8                                                                                     |

---

## 7. 证据索引（仓库内路径 + 随文档摘要）

### 7.1 源码

- `src/memory/backend-config.ts`
- `src/memory/search-manager.ts`
- `src/memory/cogniweave-manager.ts`（含 `applyMemoryArtifactLifecycle` ≈816）
- `src/gateway/server-methods/doctor-memory-health.ts`（`buildMemoryProbeAgentInput` ≈72–86，`backend` 硬编码 builtin）
- `src/memory/health-probe-run.ts`（默认 `backend ?? "builtin"` ≈45、58）
- `scripts/memory-platform-audit.mjs`
- `src/gateway/server-methods/data.ts`（`data.memory.forget` ≈237–261）
- `src/data/memory-lifecycle.ts`（`forgetMemoryEntry`）
- `src/memory/query-atoms-acl.test.ts`
- `packages/cogniweave-sdk/src/runtime/in-memory-engine.ts`
- `packages/cogniweave-sdk/src/runtime/in-memory-engine.query-p4.test.ts`
- `src/auto-reply/reply/learning-recall-context.ts`（构造计数点 ≈134）
- `src/auto-reply/reply/learning-recall.ts`（`recordLearningReuse` 口径注释 ≈214–218）
- `src/auto-reply/reply/get-reply-run.ts`（调用 ≈1247；`runReplyAgent` ≈1675）
- `src/config/data-space.ts` / `src/config/cogniweave-migration.ts`

### 7.2 随文档保存的必要摘要（临时文件不是唯一证据）

下列关键输出已写入本报告正文（§1.3、M01–M03、M06–M07），**不含凭据、不含记忆正文**：

- 解析探针：`cfg/resolved/probe` 字段对照
- 只读 SQL 计数与 `reuseCount` / `write_operations.status` 分布
- vitest 失败/通过摘要与时间戳（Asia/Shanghai）
- 运行身份：PID、cwd、重建树 SHA、`build-info.json` 字段
- `migration_state.json` 的 `phase` / `completedAt`

本地过程输出（机器本地，可作复核辅证，**非**唯一证据）：`/tmp/openbot-query-atoms-acl-1.txt`、`…-2.txt`、`/tmp/openbot-m03-repro.txt`、`/tmp/openbot-query-p4-sdk.txt`。
