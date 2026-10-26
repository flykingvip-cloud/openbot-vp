# Memory Batch1 — 分组交付清单（本地验收）

日期：2026-10-26（Asia/Shanghai）  
工作树：`/private/tmp/openbot-memory-batch1-rework`  
分支：`codex/openbot-memory-batch1-rework`

## 本轮主干对齐（交付收尾）

| 字段 | 值 |
| --- | --- |
| 起点 HEAD（开场） | `d95083cb6a6c30a1d7771d679a60407c4cd9fd60` |
| 首次 rebase 基线 | `origin/main`=`d00bdcca…`（PR #85 askOutcome R83–R85） |
| 二次 rebase 基线（最终验证） | `origin/main`=`29f4edd0a2c16a7682f6ac5da9bc0766e503447f`（PR #86 routing AOR） |
| 最终 tip | `756543be5cf8d49c48fae1c2bd114c7d6c2508a2`（docs/evidence；代码验证 tip=`96082662…`） |
| ahead / behind（交回时） | **163 / 0** |
| 祖先 | `merge-base --is-ancestor origin/main HEAD` → **exit 0** |
| ahead / behind | **163 / 0**（ahead 数≠交付规模；以净差异为准） |
| 工作区 | 对齐后干净；本轮新增 evidence/清单提交后见 git status |
| Loom | 无 `.loom/LOCK`；registry 保留 askOutcome + p1-routing + memory-system-batch1 会话（冲突按语义合并，未统一 ours/theirs） |

**批准性质**：本地交付验收 — **不是**将 ahead 提交整体合入主干。禁 push / PR / merge / deploy。  
**范围**：下列交付组；**不含** O4 只读 foundation / 候选视图 / DS 索引 / 事实级遗忘 / 完整效果验收。

审查文档：[`memory-batch1-check-green-review-2026-10-26.md`](./memory-batch1-check-green-review-2026-10-26.md)  
运行时清单：[`memory-batch1-runtime-change-inventory-8070ef52-to-tip.md`](./memory-batch1-runtime-change-inventory-8070ef52-to-tip.md)

### 冲突与去重摘要

| 项 | 处理 |
| --- | --- |
| `.loom/registry.yaml`（×2） | 保留主干 askOutcome / p1-routing 会话 **与** memory-system review/batch1 会话；lander reason 取主干 PR#85 文案 |
| `src/task-outcome/result-service.ts` | 保留主干 requiredScope / commandId 语义；本支旧版条件改写未覆盖主干 |
| 主干已吸收 | 记忆 Batch1 产品改动 **无**等价合入；对齐的是他人 askOutcome/#86 |
| 对齐后主干债（检查恢复） | #86 引入：`runtime-from-runner` 多余空行；`result-service` 未用函数；`agent-runner-execution` 缺 `void` — 已以最小 format/lint 修复（`99717082` / `96082662`），**非**记忆语义 |

净差异规模（相对 `29f4edd0`）：**约 412 路径**（含大量 check-green 格式/类型对齐与 evidence）；不以 162 ahead 当交付规模。

---

## A. 记忆可观测性（O1 / O2 / O3 + 必要测试）

| 字段 | 内容 |
| --- | --- |
| 净差异要点 | `src/memory/health-probe*.ts`、`health-report.ts`、`doctor-memory-health.*`、`scripts/memory-platform-audit.*`、`memory-platform-audit.o2.test.ts`、`query-atoms-acl.test.ts`、O8 harness（v1/v2/v3）与 isolation 夹具 |
| 代表提交（rebase 后 tip 链） | 早期 O1/O2/O3 锚点经 rebase 重写；验收以路径净差异为准，不以旧 SHA |
| 依赖 | 不依赖 O4 合入；与 O5 文案可并行 |
| 主干等价 | **无** |
| 验证 | post-rebase affected：health-probe 13、audit.o2 10、doctor-memory-health 10、o4-o5-diagnose 3、query-atoms-acl 4 — 均 pass（见 evidence `…-post-rebase-affected-tests-20261026-1920.log`） |
| 剩余风险 | O8 为隔离 harness，≠完整网关/模型效果；完整效果验收仍未关闭 |
| 建议顺序 | **PR-1 优先**（语义清晰、依赖少） |
| 本轮状态 | **可进入 PR 准备（本组）** |

---

## B. O5 文案（文件删除语义）

| 字段 | 内容 |
| --- | --- |
| 净差异要点 | `memory-center-page.ts` / `data-directory-page.ts` / render-model handlers；`memory-forget-gateway-isolation.test.ts`；文案「忘记」→「删除记忆文件」+ title 边界说明 |
| 代表提交 | `6b15d84f`（rebase 后 tip 链内）等 |
| 依赖 | 与 O4/候选视图/DS **解耦**；不重开 O5 缺陷判断 |
| 主干等价 | **无** |
| 验证 | memory-center-page 5、data-directory-page 5、forget-gateway-isolation 5 — pass |
| 剩余风险 | 仅文案+隔离测试；无事实级遗忘产品 |
| 建议顺序 | **可与 A 同 PR 或紧随** |
| 本轮状态 | **可进入 PR 准备（本组）** |

---

## C. 全仓检查恢复（YAML / 格式 / 类型 / 测试契约）

| 字段 | 内容 |
| --- | --- |
| 净差异要点 | 大量 `chore(check-green): oxfmt/types/guards…` 着陆流对齐；另含本轮主干债最小修复（format/lint） |
| 依赖 | 与语义组可拆；**不建议**与 A/B 无差别一次性合入 |
| 纯格式 vs 语义 | **以纯格式/类型/守卫为主**；与业务语义混合提交若无法安全拆分则整组按检查恢复审查 |
| 主干等价 | 部分守卫预算/白名单可能随主干演进需再对表；本 tip 上 `pnpm check` 已绿 |
| 验证 | `pnpm tsgo` exit 0；`pnpm check` exit 0 @ `96082662`（基线 `29f4edd0`） |
| 剩余风险 | 体积大；审查成本高；建议独立 PR 或按着陆流切片 |
| 建议顺序 | **PR-2+（与语义组分离）** |
| 本轮状态 | **可进入 PR 准备（需拆分策略）** |

---

## D. 检查规则校准（预算 / 白名单 / fixture）

| 字段 | 内容 |
| --- | --- |
| 净差异要点 | `scripts/check-core-composition-root-loc.ts`、`check-isolation-fail-closed.mjs`、`check-openbot-ui-boundaries.mjs` + `test/scripts/check-*.test.ts`（`OPENBOT_CHECK_REPO_ROOT` fixture 负例） |
| 依赖 | 常与 C 同检；fixture 负例依赖仓库根解析 |
| 主干等价 | **无**（本支净差仍在） |
| 验证 | isolation/ui-boundaries fixture 测试 2+2 pass；`pnpm check` 含对应 lint 门 exit 0 |
| 剩余风险 | 预算数字绑定实测尺寸；主干再增行可能需重锁（本轮**未**抬预算） |
| 建议顺序 | **可与 C 同 PR** |
| 本轮状态 | **可进入 PR 准备（本组）** |

---

## E. 协作运行时修复

| 字段 | 内容 |
| --- | --- |
| 净差异要点 | 心跳 `setInterval→递归 setTimeout` + updateConfig 防双链；Mode B `mentionMode=single_primary`；空/missing `agentId`；`adminDailySummary` 参数门；退役 `task.handoff` shortcut 拒绝 |
| 代表路径 | `group-task-heartbeat-scheduler.ts`、`mode-b-wake-round-dispatcher.ts`、`decision-engine.ts`、`collaboration-learning.ts` + 对应测试 |
| 依赖 | 独立于记忆业务；生产默认 heartbeat `schedulerEnabled=false` |
| 主干等价 | **无** |
| 验证 | heartbeat scheduler 15、decision-engine 49、wake-round 12、collaboration-learning 10 — pass；`test:collab:runtime-lifecycle` 28 pass（含于 `pnpm check`） |
| 剩余风险 | 低；注意与他人 collab 着陆流审查边界 |
| 建议顺序 | **PR-1 或独立小 PR** |
| 本轮状态 | **可进入 PR 准备（本组）** |

---

## F. 明确未纳入本交付包

| 项 | 说明 |
| --- | --- |
| O4 只读 foundation | 净差仍含 `memory-center-o4-readonly.*`、`LocalMetadataStore` open/countAtoms 等 — **另行授权/验收**，不混入本包合入建议 |
| 候选视图 / Data Space 对齐 | 文档在案；实现未关闭 |
| 完整记忆效果验收 | 局部优化关闭 ≠ 效果验收 |
| ahead 整体合入 | **未批准** |
| task-outcome 文档表格式 + entrypoint 去未用 import | 检查恢复附带；result-service/runtime-from-runner 本轮仅为主干债最小修复 |

---

## G. 本轮最终验证（精确基线）

| 项 | 值 |
| --- | --- |
| 验证 tip（代码门） | `9608266246d00e2fcad119d16b8be3ffc627673d`（其后仅 docs/evidence `756543be`） |
| 验证主干 | `29f4edd0a2c16a7682f6ac5da9bc0766e503447f` |
| 相关测试 | 14 files / **145 passed** / exit **0** — `docs/design/evidence/memory-batch1-post-rebase-affected-tests-20261026-1920.log` |
| `pnpm tsgo` | exit **0** — `…-tsgo-post-rebase-main29f4edd0-20261026-1920.log` |
| `pnpm check` | 首次失败（主干 format）→ lint 债修复后 exit **0** — `…-pnpm-check-post-rebase-main29f4edd0-20261026-1925.log`（失败痕迹：`…-1920.log` / `…-1921.log` 保留） |
| 归属 | format/lint 失败 = 主干 #86 引入、文件内容曾与 main 逐字节相同；已最小修复，未 skip/放宽/抬预算 |

---

## H. 下一阶段 PR 草稿（不创建）

**建议标题：**  
`memory(batch1): O1–O3 observability + O5 delete copy + collab runtime fixes`

**短说明（草稿）：**  
Rebase onto `29f4edd0`. Deliver memory health/audit/ACL probes (O1–O3), O5 file-delete UI copy with gateway forget isolation tests, and collab runtime fixes (heartbeat timer, Mode B mentionMode, empty agentId, adminDailySummary gate, retired handoff refuse). Full-repo check-green/format and check-rule fixture calibration should land as follow-up PR(s). O4 readonly foundation, candidate views, Data Space index, and full memory effect acceptance are out of scope. Verified: affected tests 145 pass; `pnpm tsgo` / `pnpm check` exit 0 on tip `96082662` vs main `29f4edd0`.

**拆分建议：** PR-1 = A+B+E；PR-2 = D+C（检查规则+全仓格式）。

---

## I. 结论

**可进入 PR 准备** — 语义交付组（A/B/E）与检查组（C/D）均已在精确基线 `29f4edd0`←`96082662` 验证通过；未 push / 未开 PR。若主干再次前进，需重新评估，本报告不声称覆盖未测新基线。

历史 format 关闭记录（rebase 前 tip）仍见下方归档。

---

## 归档：rebase 前开场核验（历史）

开场：`origin/main`=`d00bdcca…`；merge-base=`ad711a54…`；ahead/behind **160 / 12**；工作区干净；参考起点 `d95083cb`。  
固定对照 tip（全仓修绿记录）：`aaab116a0ee40ca6b8c04eaaeef6e0831bc69088`（历史）。
