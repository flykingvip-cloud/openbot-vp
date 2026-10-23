# Implementation Plan: openbot-evolution-evaluation-closure

## Agents

- cursor-grok · role: contributor · scope: Track B 历史实施与 C8 交付 · paths: `packages/evolution-core/src/**`, `src/gateway/evolution-control/**`, `src/gateway/evolution-governance/**` · since: 2026-09-19
- codex-evolution-closeout · role: contributor · scope: C8 生产发布收尾与验收回归 · paths: `deploy/production/RELEASE_RECORD.md`, `scripts/delivery/ledger.test.ts`, `src/gateway/evolution-control/working-dna-governance-chain.test.ts` · since: 2026-09-23
- historical, not live: `deploy/production/releases.jsonl` was a pre-split copy claimed by this spec. It is not the live ledger and must not be recreated in openbot-vp. Live ledger: https://github.com/flykingvip-cloud/harness-Benchmark-Engine/blob/main/deploy/production/releases.jsonl
- codex-evolution-e52 · role: owner · scope: E5.1.6–E5.1.7 assist 零写入观察窗、稳定控制面候选登记与 E5.2 前置收敛 · paths: `.kiro/specs/openbot-evolution-evaluation-closure/tasks.md`, `src/gateway/evolution-control/bootstrap.ts`, `src/gateway/evolution-control/index.ts`, `src/gateway/evolution-control/shadow-intent-proposal.ts`, `src/gateway/evolution-control/shadow-intent-proposal.test.ts`, `src/gateway/evolution-governance/application-consumption-shadow.ts`, `src/gateway/evolution-governance/control-plane-intent-registration.ts`, `src/gateway/evolution-governance/index.ts`, `src/gateway/evolution-governance/tick-pipeline.ts` · since: 2026-09-24

每个提交 trailers：

```
Task: openbot-evolution-evaluation-closure
Agent: codex-evolution-e52
```

Loom task: `openbot-evolution-evaluation-closure:codex-e52`
Session: `5DB079FD-CC53-43B0-84C3-882C4A876A27` · ide: codex · agent: codex-evolution-e52
Takeover: 已复核 C8/seq97 主干与线上状态、E5.1 shadow 健康合同及生产空窗口后接管 E5.2 前置收敛。

---

## Phase E0.1 — 独立基线与共享评价合同冻结

- [x] **E0.1.1** 专用 worktree + fetch + `origin/main` 祖先 + 干净树 — cursor-grok
- [x] **E0.1.2** Loom session 注册 + 本文件签名 — cursor-grok
- [x] **E0.1.3** 修订 Surface Matrix（含 producer / diagnosisRecheckPolicy / blocker） — cursor-grok
- [x] **E0.1.4** A/B Contract Ownership：A 拥有 `StructuralEvolutionCandidate`，B 不复制 — cursor-grok
- [x] **E0.1.5** EvaluationPolicy 合同（按 Surface/Producer，无全局三票制） — cursor-grok
- [x] **E0.1.6** E1 WAL 状态机与故障注入夹具（不接活诊断） — cursor-grok
- [x] **E0.1.7** 等待 Track A A0 commit SHA 的 blocker — cursor-grok
- [x] **E0.1.8** 本轮未改变运行行为的证明 — cursor-grok

## Phase E0.2 — 评价安全优先级与 WAL 语义修正

- [x] **E0.2.1** 负向事实优先 rollback；drill 只拦 Promote — cursor-grok
- [x] **E0.2.2** Recheck 增加 target / observedEvidenceRefs / 绑定校验 — cursor-grok
- [x] **E0.2.3** WAL 只追加 `proposal.created`；committed 不写 Ledger — cursor-grok
- [x] **E0.2.4** admit 标记为 server-resolved view — cursor-grok
- [x] **E0.2.5** A0.1 blocker：不消费 `c7d7aa54f2` — cursor-grok

## Phase E0.3 — Finding 集合比较与 A0.2 门禁

- [x] **E0.3.1** Finding refs 按去重后的排序集合比较 — cursor-grok
- [x] **E0.3.2** 等待 A0.2；不消费 `c7d7aa54f2` 或 `bb97b44ce6` — cursor-grok
- [x] **E0.3.3** 合入 `main` 后记录主干 SHA `3a01fe0963bee9fb8438e018011785c05348d675`（#1203）。Track A producer freeze `a4368cfade4e16dd80df0b4a4c843ed338b834c3`。 — cursor-grok

状态句：Track B E0 landed on origin/main at 3a01fe0963. Later slices: E1 `#1206` `28ff3afef3`，E2/E4 `#1207` `1e3358e241`，E5-shadow `#1209` `8c3b5e5508`。

## Phase E1 — 可恢复诊断候选提交

- [x] **E1** `previewDiagnosisCandidate` 零写入；`submitDiagnosisCandidate` 经 WAL 提交 Working DNA 候选。不接 live diagnose、不开实验、不 Apply。不得消费 `c7d7aa54f2` 或 `bb97b44ce6`。 — cursor-grok

## Phase E2 — Working DNA 评价纵向切片

- [x] 复用现有 Adapter / Experiment / Ledger，接入 EvaluationPolicy + Recheck Port。diagnosis-origin 必须先 `evaluateWorkingDnaClosure`；operator-origin ingestV1 仍走 canPromote。夹具覆盖 Promote / Hold / Rollback / INCONCLUSIVE。 — cursor-grok

## Phase E3 — Skill Installation 第二切片

- [x] diagnosis-origin Skill Installation 复用同一套 EvaluationPolicy + Recheck；空 / 非 capability skillId → `unknown_target`。operator-origin 仍走 canPromote。 — cursor-grok
- [x] Diagnosis WAL 准入 `capability.skill-installation`：type-import Track A `SkillInstallationCandidate`（PR #1204），仅已有 skillId 的 `install` 候选。不复制 DTO，不开实验，不 Apply。 — cursor-grok

## Phase E4 — 验证回流与长期评价

- [x] `surfaceId → authorityRecheck` registry + Ledger replay。第一期仅 Working DNA / Skill Installation；`VERIFIED` 但 SoT 未变 → `still_open` 且不得关闭 finding。Capsule / Organization / Runtime 未注册合同则 `unsupported_surface`。 — cursor-grok

状态句：Track B E0–E5-shadow landed on origin/main. First-period Working DNA / Skill Installation evaluation is Go. Single-track evolution is No-Go until a separately approved cutover.

## Phase E5 — 历史执行路径单轨收敛（单独 PR）

- [x] runtime auto / skill auto 对照控制面 Application 的 shadow 已合入 `8c3b5e5508`（#1209）。live tick / skill-auto 仍走直接 mutator。assist 零 mutation。 — cursor-grok
- [x] E5.1 consumption contract + shadow。`wouldConsume` 不执行。live `cutoverReady=false`。见 `e5.1-cutover-readiness.md`。 — cursor-grok
- [x] E5.1.1 合同补强：自治走 `evaluateSurfaceAutonomy`；校验 grant `allowedActions`、Proposal/Experiment 过期、Candidate Store payload。readiness 统计全部 deny reason。`e52SwitchAllowed` 在已注册 surface 上为 false。不切换 mutator。 — cursor-grok
- [x] E5.1.2 shadow 证据：损坏/截断/不支持 schema/写失败都使 `cutoverReady=false`。原子写入，最多 500 行。C5 用 A 的 Recheck 事实驱动 EvaluationPolicy，不执行 Adapter Apply。E5.2 仍 No-Go。见 `c5-joint-matrix.md`。 — cursor-grok
- [x] E5.1.3 shadow health 持久化：write/read failure、损坏、截断、未知 schema 写入 health ledger。重启后 `observationStoreHealthy` 仍为 false。readiness 读异常返回 `cutoverReady=false` 且 `e52SwitchAllowed=false`。只有审计过的管理员恢复并且观察窗口重新验证后才能清故障。不切换 mutator，不执行 Adapter Apply。 — cursor-grok
- [x] E5.1.4 fail-closed：health.json 写失败时，故障留在不可变外部 hash chain `evolution-shadow-ledger/events.jsonl`。缺少 mirror 不能恢复 healthy。恢复不接受客户端 `audited` / `observationWindowRevalidated`。服务端校验管理员、审计事件、schema、非空完整窗口、无未消解 denial、无伪造执行。`directMutatorsRetired=false` 时 `e52SwitchAllowed` 永远 false。不等于 E5.2。 — cursor-grok
- [x] E5.1.5 重绑到 `origin/main` `b88a67a116`（含 `#1230` `313b58661b` 与已合并 `#1232` `6fe49507d9`）。保留哈希链和 health mirror。A9 M1 进入同一 shadow/readiness：绑定、观察窗口、denial counts、health chain、`directMutatorsRetired=false`。M1 事件不是 E5.2 receipt。`executedConsumer` 保持 false。恢复只接受 `resolveServerAdmin` 签发的身份。见 `a9-joint-matrix.md`。不等于 E5.2。 — cursor-grok
- [x] E5.1.6 assist 观察窗：runtime pause/limit/recovery 与已就绪 skill install 在 `assist` 下写 shadow 意图，`liveExecuted=false`、`executedConsumer=false`；观察期到期不得绕过模式自动 resume/clear-limit。生产 seq98 已观察到 10 条 runtime shadow，`corrupt=0`、零 live mutation、零 executed consumer；全部为 `missing_application`，因此 E5.2 保持 No-Go。 — codex-evolution-e52
- [x] E5.1.7 稳定候选登记：仅在 `assist` 且 `liveExecuted=false` 时，将 runtime/skill shadow 意图按租户与语义键幂等登记为 `DISCOVERED` Proposal + Candidate；不授权、不建 Experiment/Application、不 Apply。日粒度 commandId 不重复建案，重启可回放；shadow denial 从 `missing_application` 前移为 `missing_experiment`。auto/live 路径仍保持 orphan fail-closed。E5.2 仍 No-Go。 — codex-evolution-e52
- [ ] E5.2 生产 cutover：只有 `e52SwitchAllowed=true` 之后，tick / skill-auto 才改为只消费已批准的控制面 Application。需再次独立批准，本任务不得自行切换。 — cursor-grok

## Phase C6 — M1 证据审计与 Promotion 状态投影

- [x] 基于 `origin/main` `516c4ba34f`（含 `#1235` `470bf68e82` 与 A10 `#1236`）。消费 001 M1 真实 Proposal `evo:diag:8bee2c37b1f39478`、Experiment `exp:cmd-a9-exp-down`、Application `app:cmd-a9-active-up`、Verification `ver:cmd-a9-verify-ok`、Recheck `STILL_OPEN`。核对 tenant、target、surface、candidate、commandId、observation window。A9/M1 只做 shadow observation，不能生成 E5.2 receipt。`applicationVerified`、`recheckOutcome`、`evaluationDecision`、`promotionEligible`、`promotionCompleted` 分开。没有 `promotion.completed` 时不显示「已完成进化」。不切换 mutator，不 Apply。见 `c6-joint-matrix.md`。不等于 E5.2。 — cursor-grok
- [x] C6.1：`promotionCompleted` 只接受唯一且绑定 tenant、Proposal、Experiment、Application、Verification、target、surface、candidate 的结构化事件。`authorityOk=true`、`guardrailDegraded=false`、Recheck `RESOLVED`、EvaluationPolicy `promote`、Application 未 `rolled_back`/`failed` 必须同时成立。重复或冲突事件 fail-closed。不改 A 的 Apply、Verification、Recheck。见 `c6.1-joint-matrix.md`。不等于 E5.2。 — cursor-grok
- [x] C7：`decideEvolutionCompletion` 是唯一完成判定器。A 的 Receipt 投影与 B 的评价投影共同调用它，C6 私有完成算法已删除。Application 只接受 `applied`。事件时间必须晚于 Verification 与 Recheck。冲突、重复、错绑、缺失 fail-closed。不执行 Promote、Apply、Rollback。`executedConsumer=false`，`directMutatorsRetired=false`，`e52SwitchAllowed=false`。见 `c7-completion-contract.md`。不等于 E5.2。 — cursor-grok
- [x] C8：完成判定只读控制面 Ledger。调用方不能提交 `promotion.completed`。服务端按 tenant、proposal、experiment、application 查询。重复、冲突、错绑、时间早于 Verification/Recheck fail-closed。A/B 对同一快照输出一致。重启回放不依赖进程内状态。`executedConsumer=false`，`directMutatorsRetired=false`，`e52SwitchAllowed=false`，`singleTrack=false`。见 `c8-consistency-report.md`。不等于 E5.2。 — cursor-grok

## Phase G — Go / No-Go 报告

- [x] 最终报告：第一期评价闭环 **Go**；系统进化完全单轨 **No-Go**。见 `go-nogo.md`。 — cursor-grok
- [x] **C8 生产收尾**：seq97 已从主干 `f1c7efece96d` 暗发布，`verify-live` 通过，治理模式保持 `assist`；发布账本 0 error。旧治理链测试已改用可信 operator session 与服务端授权端口，未放宽生产授权。E5.2 仍关闭。 — codex-evolution-closeout

## Phase C4 — Diagnosis Recheck 联合接入与复验

- [x] 消费 A4 `#1217` `b20c28825c`（在 `origin/main` `66b886bb88`）。不消费 `#1222` 或预览 SHA。 — cursor-grok
- [x] Gateway observer 用 Application / candidate 填 expectedHash；WDNA 读 `working-style-store`，Skill 读 lifecycle 安装关系。不改 A 的 port，不改 Working DNA 算法。 — cursor-grok
- [x] diagnosis-origin 评价读真实 Authority Gate；Promote 必须先经过 live Recheck。 — cursor-grok
- [x] C4 联合测试：WDNA/Skill Recheck + EvaluationPolicy + binding + Ledger replay。 — cursor-grok
- [x] 回归分类：B live-loop 窗口夹具已对齐；`evolution-grant` 负向合同与 P26.1/P26.2 登记为 A blocker，不标绿。 — cursor-grok

## Phase C4.1 — Rebase A4 close and full evaluation green

- [x] 重放到 `origin/main` `f1c2669353`（含 `#1222` `7c1a196320`）。无单独 A5 squash。 — cursor-grok
- [x] 保留 `#1222` SoT hash / P26 No-Go / Recheck observer；保留 B EvaluationPolicy 接线。 — cursor-grok
- [x] diagnosis 81/521 绿；grant 走 B remap，不改 A 的 Port outcome。 — cursor-grok
- [x] 全量门禁：evolution-control 304/304；evolution-core test+typecheck 绿；tsgo / format / `git diff --check` 绿。`pnpm check` 的 `ui/src/ui/app.ts` LOC 超预算是主干既有项，C4.1 未碰 UI。 — cursor-grok
