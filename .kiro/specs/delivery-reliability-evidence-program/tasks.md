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
| WP-05 | Fabric 唯一路径试点     | DESIGNING         | WP-04；写操作加 WP-07           | grokbot-verifiable-delivery  | G3-B | PREP+绑定切片；默认 legacy；未宣称 G3-B |
| WP-06 | 编排持久恢复            | DESIGNING         | WP-00、WP-01                    | grokbot-verifiable-delivery  | G4-A | 存储/租约设计；ORCHESTRATION_LIVE_INVOKE 仍 false |
| WP-07 | 外部副作用幂等与核对    | NOT_STARTED       | WP-06                           | 未指定                       | G4-B | |
| WP-08 | constitutional 内部约束 | NOT_STARTED       | WP-01、WP-04；跨恢复加 WP-06/07 | 未指定                       | G5   | 待合同与归属 |
| WP-09 | 经验归因与统计          | NOT_STARTED       | WP-00、WP-01                    | 未指定                       | G6-A | |
| WP-10 | 收益对照实验            | NOT_STARTED       | WP-09                           | 未指定                       | G6-B | 可备合成回放；收益 UNKNOWN |
| WP-11 | 自动化与综合验收        | DEFERRED          | G2、G3-B、G4-B、G5、G6-B        | —                            | G7   | 人明确延期 |
| WP-12 | 许可与权属审计          | AUDITING          | WP-00                           | grokbot-verifiable-delivery  | GL   | 只读；不改 LICENSE |

## 已知约束与待决项

- 计划目录已落入 `.kiro/specs/delivery-reliability-evidence-program/`；执行基线为 `c0c0ba52`（= origin/main）。编制基线 SHA 仅作阅读对照。
- 试点业务、业务验收负责人、数据授权、最小收益和观察窗**尚未冻结** → WP-00 整体不 ACCEPTED；G0 仅部分通过。
- 禁止整片接管 `collaboration-dispatch/**` 或 `attempt.ts`；第一刀仅已证明必需文件。
- `.loom/registry.yaml` 由 kiro-loom lander 提交；本任务不得以改他人 owner 刷绿冲突。
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

WP-06 / grokbot-verifiable-delivery / DESIGNING / candidate SHA 2df36a55 / production NOT_DEPLOYED / benefit UNKNOWN  
完成：实体映射；确认 LIVE_INVOKE=false；既有存储增量租约/fencing 提案；kill/restart 夹具名  
证据：`wp06/orchestration-persistence-lease-design.md`  
下一步：字段迁移 ADR；只读有限步骤工作流（仍不解锁 live invoke）  
— grokbot-verifiable-delivery

