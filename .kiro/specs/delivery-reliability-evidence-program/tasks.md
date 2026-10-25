# 实施任务看板

## Agents

### 当前执行负责人（Loom 有效登记）

- grokbot-verifiable-delivery · role: owner · scope: 可验证交付与经验收益计划目录及本专项文档/审计产出；不自动取得运行热点代码所有权 · paths: .kiro/specs/delivery-reliability-evidence-program/** · since: 2026-10-24

Loom task：`delivery-reliability-evidence-program:grokbot-verifiable-delivery`  
Session：`445f21c8-4bc3-431e-a284-5d74f48e487e`，ide：cursor，agent：grokbot-verifiable-delivery  
Registry 路径声明含 `.loom/registry.yaml` 登记行；**该文件提交仍由 lander `kiro-loom` 落地**。

### 编制历史（保留，非当前 owner）

- codex-reliability-pm · role: plan-author (historical) · scope: 本计划编制与独立交付包 · paths: 原拟 .kiro/specs/delivery-reliability-evidence-program/** · since: 2026-10-24  
  历史 Loom 摘要：`delivery-reliability-evidence-program:codex-reliability-pm` / session `01a16b84-1595-72d2-87e0-06ef324734d2`（ide：codex）。当时未提交登记曾被共享工作区清除；**当前有效 owner 以上节为准**，本节仅保留编制追溯。

## 计划交付

- [x] P-01 新鲜主干基线核对与计划归属登记；编制基线 `1012c1bd553e69f1b7ebe81d258f3872dfb0bea6` — codex-reliability-pm
- [x] P-02 复核已有 Fabric、进化评价、constitutional 就绪度与近期共享热点 — codex-reliability-pm
- [x] P-03 编制工作包、架构约束、收益评价、恢复与发布门槛、许可审计和执行指令 — codex-reliability-pm
- [x] P-04 七份文档校验与独立交付包 — codex-reliability-pm
- [x] P-05 计划落入仓库目录 `.kiro/specs/delivery-reliability-evidence-program/`；Loom 由 grokbot-verifiable-delivery 重新登记 — grokbot-verifiable-delivery

## 执行看板

人拍板（2026-10-24）：WP-00 收尾 + WP-12 只读并行；运行代码按最小切片放行；WP-11 延期。首个运行候选切片=交接恢复接线（WP-01 合同 → WP-02 精确接管 → recover 接线）。

| ID    | 范围                    | 状态              | 前置                            | Owner                        | 验收 | 备注 |
| ----- | ----------------------- | ----------------- | ------------------------------- | ---------------------------- | ---- | ---- |
| WP-00 | 基线/存量/归属/试点冻结 | IMPLEMENTING      | 无                              | grokbot-verifiable-delivery  | G0   | E0 基线可验收；整体未 ACCEPTED（试点未冻结） |
| WP-01 | 任务结果与证据合同      | IMPLEMENTING      | WP-00                           | grokbot-verifiable-delivery  | G1   | 本轮仅最小合同草案 |
| WP-02 | 交接可靠落地            | AUDITING          | WP-00、WP-01                    | grokbot-verifiable-delivery  | G2-H | 精确接管清单；代码改动待接管成立 |
| WP-03 | 上下文唯一预算责任      | AUDITING          | WP-00、WP-01                    | grokbot-verifiable-delivery  | G2-C | 组装链路审计+单一预算提案；未宣称 G2-C |
| WP-04 | Fabric 决策比较         | DESIGNING         | WP-00、WP-01                    | grokbot-verifiable-delivery（需协调 kiro-fabric） | G3-A | 设计+只读 approvals 夹具已落；无迁移；未宣称 G3-A |
| WP-05 | Fabric 唯一路径试点     | DESIGNING         | WP-04；写操作加 WP-07           | grokbot-verifiable-delivery  | G3-B | evidence_status=prepared；claim_status=unclaimed；production_status=not_verified；默认 legacy |
| WP-06 | 编排持久恢复            | DESIGNING         | WP-00、WP-01                    | grokbot-verifiable-delivery  | G4-A | +ExecutionStep canonical schema/validators；LIVE=false；G4-A evidence_status=prepared / claim_status=unclaimed / production_status=not_verified；**非 G4-A** |
| WP-07 | 外部副作用幂等与核对    | DESIGNING         | WP-06                           | grokbot-verifiable-delivery  | G4-B | DESIGN+矩阵模板+action-idempotency helper；未接线 live send；**非 G4-B** |
| WP-08 | constitutional 内部约束 | NOT_STARTED       | WP-01、WP-04；跨恢复加 WP-06/07 | 未指定                       | G5   | 待合同与归属 |
| WP-09 | 经验归因与统计          | NOT_STARTED       | WP-00、WP-01                    | 未指定                       | G6-A | |
| WP-10 | 收益对照实验            | NOT_STARTED       | WP-09                           | 未指定                       | G6-B | 可备合成回放；收益 UNKNOWN |
| WP-11 | 自动化与综合验收        | DEFERRED          | G2、G3-B、G4-B、G5、G6-B        | —                            | G7   | 人明确延期 |
| WP-12 | 许可与权属审计          | AUDITING          | WP-00                           | grokbot-verifiable-delivery  | GL   | 只读；不改 LICENSE |

## 已知约束与待决项

- 计划目录已落入 `.kiro/specs/delivery-reliability-evidence-program/`；执行基线为 `c0c0ba52`（= origin/main）。编制基线 SHA 仅作阅读对照。
- 试点业务、业务验收负责人、数据授权、最小收益和观察窗**尚未冻结** → WP-00 整体不 ACCEPTED；G0 仅部分通过。
- 禁止整片接管 `collaboration-dispatch/**` 或 `attempt.ts`；第一刀仅已证明必需文件。
- `.loom/registry.yaml` 由 kiro-loom lander **正式 Loom 流程**提交；本任务不得直改、不得扩大代码所有权、不得认领 attempt.ts / fabric/** / collaboration-dispatch/**；须保留 owner/历史 session/takeover（见 `evidence/registry-kiro-loom-handoff.md`）。
- **Schema freeze**：ledger 一等字段在 **ExecutionStep**；payload 仅扩展；compat-read 允许 / 新写入 prefer Step（见 `wp06/execution-step-canonical-schema.md`）。
- **LIVE 冻结**：`ORCHESTRATION_LIVE_INVOKE=false`；G3-B/G4-A 冻结为 evidence_status=prepared / claim_status=unclaimed / production_status=not_verified；G 门不可实施 Agent 自证自批。
- GitHub issue 未绑定；不填造编号。
- 未核对生产 LIVE；无 E3/E4。默认开关/许可/部署行为不变。
- `.agents/skills/PR_WORKFLOW.md` 基线缺失；进 PR 前再搜现行工作流。

## 单项状态更新模板

```text
WP-ID / owner / status / candidate SHA / production status / benefit conclusion
完成：
入口和范围：
证据 manifest：
失败或未知：
依赖与归属：
下一步：
验收人和决定：
— <agent-id>
```

### WP-00 进度（2026-10-24）

WP-00 / grokbot-verifiable-delivery / IMPLEMENTING / candidate SHA c0c0ba52 / production NOT_DEPLOYED / benefit UNKNOWN  
完成：六项 E0 交付物 + 可行性门禁 + Loom 登记与 tasks 归属修正  
入口和范围：仅计划目录与文档；真实业务写入默认关闭  
证据：`wp00/*`、`evidence/WP-00/manifest.json`  
失败或未知：试点未冻结；运行热点归属未接管  
依赖与归属：registry 提交待 kiro-loom  
下一步：人审 E0；并行 WP-12；WP-01 草案与 WP-02 接管表  
验收：E0 可审；整体未 ACCEPTED  
— grokbot-verifiable-delivery


### WP-03..06 进度（2026-10-24）

WP-03 / grokbot-verifiable-delivery / AUDITING / candidate SHA 2df36a55 / production NOT_DEPLOYED / benefit UNKNOWN  
完成：最终组装顺序审计；提案 Phase-B=`compileModelContext` 为最终 messages 预算所有者；不可静默丢弃清单；固定回放名大纲  
证据：`wp03/context-budget-ownership-audit.md`  
失败或未知：未宣称 G2-C；生产 flag 实取值 UNKNOWN  
下一步：人审预算责任提案后再考虑最小代码接管  

WP-04 / grokbot-verifiable-delivery / DESIGNING / candidate SHA pending-wp04-harness / production NOT_DEPLOYED / benefit UNKNOWN  
完成：check/replay/dryRunDiff/isRelaxation 调用链；快照字段草案；diff 分类；入口矩阵骨架；双零证明计划  
关键发现：默认 probes→`ensureExecApprovals` 可能写 approvals 文件（非 billing/工具执行）  
证据：`wp04/fabric-compare-design.md`  
协调：kiro-fabric；不夺 execute 所有权  
下一步：只读 resolveApprovals 夹具 + 填充矩阵 UNKNOWN 格  

WP-05 / grokbot-verifiable-delivery / DESIGNING(PREP) / candidate SHA 2df36a55 / production NOT_DEPLOYED / benefit UNKNOWN  
完成：只读试点候选（memory/web_read/skill_snapshot）；服务端单路径规则草图；入口 keep/migrate/oos 表  
明确：未实现切换；未宣称 G3-B；外部写等 WP-07  
证据：`wp05/path-convergence-prep.md`  

WP-06 / grokbot-verifiable-delivery / DESIGNING(SHAPE+LEASE_HELPER+KILL_FIXTURE_HARNESS+FIELD_MAPPING_ADR+READONLY_MULTISTEP_PICK+PILOT) / candidate SHA pending-wp06-readonly-multistep / production NOT_DEPLOYED / benefit UNKNOWN  
完成：实体映射；LIVE_INVOKE=false；lease/fence 形状+文件/内存 store+单测；KILL_FIXTURE_HARNESS；FIELD_MAPPING_ADR；**READONLY_MULTISTEP_PICK+PILOT**（memory→web_read→acceptance；ADR 命名；mock 只读 invoke；不写 ledger）  
证据：`wp06/orchestration-persistence-lease-design.md`；`wp06/field-mapping-adr.md`；`wp06/readonly-multistep-pilot.md`；`src/task-orchestration/lease-store.ts`；`src/task-orchestration/lease-kill-fixtures.ts`；`src/task-orchestration/readonly-multistep-pilot.ts`  
明确：未武装调度器；**明确不宣称 G4-A**（harness/pilot only，非生产 ledger 证据包）；未挂 ledger 生产持久面；未打开 `ORCHESTRATION_LIVE_INVOKE`  
下一步（延期）：人审后将 provisional 字段挂 fold/生产持久面；G4-A 需生产 ledger 证据；仍不解锁 live invoke  
— grokbot-verifiable-delivery

### WP-05..07 推进（2026-10-24 · ledger increment / WP-07 DESIGN / evidence prep）

WP-05 / grokbot-verifiable-delivery / DESIGNING(PREP) / evidence prep SHA pending / production NOT_DEPLOYED / benefit UNKNOWN  
完成：`evidence/g3b-path-convergence-evidence-prep.md`（准则映射；**PREP/NOT_CLAIMED**）  
明确：未宣称 G3-B；外部写仍依赖 WP-07  

WP-06 / grokbot-verifiable-delivery / DESIGNING(+LEDGER_FIELD_INCREMENT) / production NOT_DEPLOYED / benefit UNKNOWN  
完成：`src/progress-ledger/orch-lease-fields.ts`（+test）；`wp06/ledger-field-increment.md`；`wp06/live-invoke-readiness.md`（**KEEP LIVE=false**）；`evidence/g4a-recovery-evidence-prep.md`（**PREP/NOT_CLAIMED**）  
明确：未改 ExecutionStep/Event fold；未打开 `ORCHESTRATION_LIVE_INVOKE`；**不宣称 G4-A**  

WP-07 / grokbot-verifiable-delivery / DESIGNING / production NOT_DEPLOYED / benefit UNKNOWN  
完成：`wp07/external-side-effect-idempotency-design.md`；`wp07/adapter-capability-matrix.md`（模板）；`src/task-orchestration/action-idempotency.ts`（+test；未接线 live send）  
明确：**不宣称 G4-B**；不夺 Fabric/outbox 所有权  

Registry：`evidence/registry-kiro-loom-handoff.md` — **未提交** `.loom/registry.yaml`（脏/占用交 kiro-loom）  
— grokbot-verifiable-delivery


### 用户绑定冻结（ExecutionStep / LIVE / registry · 2026-10-24）

WP-05 / grokbot-verifiable-delivery / DESIGNING(PREP) / production_status=not_verified / benefit UNKNOWN  
冻结：`evidence_status: prepared` · `claim_status: unclaimed` · `production_status: not_verified`（G3-B）  
明确：**不宣称 G3-B**；dual-exec 生产证明仍缺  

WP-06 / grokbot-verifiable-delivery / DESIGNING(+EXECUTION_STEP_CANONICAL) / production_status=not_verified / benefit UNKNOWN  
完成：`wp06/execution-step-canonical-schema.md`；`src/progress-ledger/execution-step-canonical.ts`（+test）；ADR/ledger-increment/live-readiness 回指；**KEEP LIVE=false**  
冻结：G4-A `evidence_status: prepared` · `claim_status: unclaimed` · `production_status: not_verified`  
明确：未改 fold；未改 `.loom/registry.yaml`；**不宣称 G4-A**；schema freeze location = **ExecutionStep**  

WP-07 / grokbot-verifiable-delivery / DESIGNING / production_status=not_verified / benefit UNKNOWN  
完成：action-idempotency 对齐 retry/attempt + `ACTION_OUTCOME_UNKNOWN`；与 canonical `unknown_outcome` 一致  
明确：**不宣称 G4-B**；未接线 live send  

Registry：`evidence/registry-kiro-loom-handoff.md` 更新为正式 Loom 登记范围；**未提交** `.loom/registry.yaml`  
LIVE：`wp06/live-invoke-readiness.md` 纳入用户全部门禁；结论 KEEP false；通过后先 canary；G 门需代码 owner + 架构/安全 + 业务验收者分别确认  
— grokbot-verifiable-delivery
