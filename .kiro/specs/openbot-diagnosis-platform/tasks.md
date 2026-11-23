# Implementation Plan: OpenBot Diagnosis Platform

## Agents

- `cursor-grok` · role: owner · scope: Track A / A0 Diagnosis Producer Boundary Freeze · paths: src/diagnosis/diagnose-evolution-producer.ts, src/diagnosis/diagnose-evolution-producer.test.ts, src/diagnosis/diagnose-structural-preview.ts, src/diagnosis/diagnose-structural-preview.test.ts, src/diagnosis/skill-installation-candidate.ts, src/diagnosis/skill-installation-candidate.test.ts, src/diagnosis/diagnose-evolution-recheck.ts, src/diagnosis/diagnose-evolution-recheck.test.ts, src/diagnosis/delegation.ts, src/diagnosis/delegation.test.ts, src/diagnosis/diagnose-report-text.ts, src/diagnosis/diagnose-growth-assessment.ts, src/diagnosis/structural-evolution-candidate.ts, src/diagnosis/structural-evolution-candidate.test.ts, src/diagnosis/diagnose-growth-snapshot.ts, src/diagnosis/diagnose-growth-snapshot.test.ts, src/diagnosis/diagnose-evolution-prescription.ts, src/diagnosis/diagnose-evolution-boundary.guardrail.test.ts, src/diagnosis/diagnose-professional-protocol.test.ts, src/diagnosis/diagnose-self-evolution.ts, src/diagnosis/diagnose-live-request.ts, src/diagnosis/report-query-gateway.ts, src/diagnosis/report-query-gateway.confirm-auth.test.ts, src/diagnosis/index.ts, src/agents/tools/confirm-diagnose-evolution-tool.ts, src/agents/tools/confirm-diagnose-evolution-tool.test.ts, src/agents/openclaw-tools.ts, src/agents/tool-catalog.ts, src/agents/builtin-steward/provision.ts, src/gateway/server-methods/diagnosis-reports.pack.ts, src/gateway/server-methods/diagnosis-reports.pack.test.ts, ui/src/ui/ports/diagnosis/diagnosis-conversation-action.ts, ui/src/ui/ports/enterprise/diagnosis/enterprise-diagnosis-surface.node.test.ts, docs/design/openbot-diagnosis-evolution-fusion-plan-2026-09-19.md, docs/design/openbot-diagnosis-evolution-track-a-handoff-2026-09-19.md, .kiro/specs/openbot-diagnosis-platform/tasks.md · since: 2026-09-19
- `cursor-grok-diagnosis` · role: owner · scope: Phase 0 协议冻结、权威事实源盘点、适配矩阵、一期垂直切片、P3.7–P3.10 生产接入评审、P4 只读巡检信号、P5 大白投送合同、P6 对话诊断状态机、P7 分级授权委托、P8 受治理进化提案、P9 治理修复预览、P10 只读诊断可视化、P11 受控灰度回滚演练、P12 Go/No-Go 预检、P13 只读准入排练、P14 独立批准材料冻结、P15 主干收敛排练与 P22 独立审批包冻结 · paths: src/diagnosis/**, src/diagnosis/diagnose.ts, src/diagnosis/diagnose.test.ts, src/diagnosis/diagnosers.ts, src/diagnosis/index.ts, src/diagnosis/phase2.ts, src/diagnosis/phase2.test.ts, src/diagnosis/planner.ts, src/diagnosis/runner.ts, .kiro/specs/openbot-diagnosis-platform/tasks.md, docs/design/openbot-diagnosis-authority-of-record-2026-09-02.md, docs/design/openbot-diagnosis-adapter-matrix-2026-09-02.md, docs/design/openbot-diagnosis-phase1-vertical-slice-2026-09-02.md, docs/design/openbot-diagnosis-p3.7-production-integration-review-2026-09-02.md, docs/design/openbot-diagnosis-p3.8-production-adapters-2026-09-02.md, docs/design/openbot-diagnosis-p3.9-production-rehearsal-2026-09-02.md, docs/design/openbot-diagnosis-p3.10-production-approval-pack-2026-09-02.md, docs/design/openbot-diagnosis-p4-inspection-signals-2026-09-03.md, docs/design/openbot-diagnosis-p5-daibai-delivery-2026-09-03.md, docs/design/openbot-diagnosis-p6-conversation-state-machine-2026-09-03.md, docs/design/openbot-diagnosis-p7-graded-delegation-2026-09-03.md, docs/design/openbot-diagnosis-p8-evolution-proposal-2026-09-03.md, docs/design/openbot-diagnosis-p9-remediation-preview-2026-09-03.md, docs/design/openbot-diagnosis-p10-visualization-2026-09-03.md, docs/design/openbot-diagnosis-p11-production-cutover-2026-09-03.md, docs/design/openbot-diagnosis-p12-go-no-go-2026-09-03.md, docs/design/openbot-diagnosis-p12-preflight-2026-09-03.md, docs/design/openbot-diagnosis-p12-preflight-2026-09-03.json, docs/design/openbot-diagnosis-p13-go-no-go-2026-09-03.md, docs/design/openbot-diagnosis-p13-preflight-2026-09-03.md, docs/design/openbot-diagnosis-p13-preflight-2026-09-03.json, docs/design/openbot-diagnosis-p13-admission-2026-09-03.md, docs/design/openbot-diagnosis-p13-admission-2026-09-03.json, docs/design/openbot-diagnosis-p14-independent-approval-2026-09-03.md, docs/design/openbot-diagnosis-p14-preflight-2026-09-03.md, docs/design/openbot-diagnosis-p14-preflight-2026-09-03.json, docs/design/openbot-diagnosis-p14-approval-2026-09-03.md, docs/design/openbot-diagnosis-p14-approval-2026-09-03.json, docs/design/openbot-diagnosis-p15-trunk-convergence-2026-09-03.md, docs/design/openbot-diagnosis-p15-preflight-2026-09-03.md, docs/design/openbot-diagnosis-p15-preflight-2026-09-03.json, docs/design/openbot-diagnosis-p15-convergence-2026-09-03.md, docs/design/openbot-diagnosis-p15-convergence-2026-09-03.json, docs/design/openbot-diagnosis-p15-postmerge-2026-09-03.md, docs/design/openbot-diagnosis-p15-postmerge-convergence-2026-09-03.md, docs/design/openbot-diagnosis-p15-postmerge-convergence-2026-09-03.json, docs/design/openbot-diagnosis-p15-postmerge-preflight-2026-09-03.md, docs/design/openbot-diagnosis-p15-postmerge-preflight-2026-09-03.json, docs/design/openbot-diagnosis-p15-922-2026-09-03.md, docs/design/openbot-diagnosis-p15-922-convergence-2026-09-03.md, docs/design/openbot-diagnosis-p15-922-convergence-2026-09-03.json, docs/design/openbot-diagnosis-p15-922-preflight-2026-09-03.md, docs/design/openbot-diagnosis-p15-922-preflight-2026-09-03.json, docs/design/openbot-diagnosis-p15-delivery-owner-actions-2026-09-03.md, docs/design/openbot-diagnosis-p15-925-2026-09-04.md, docs/design/openbot-diagnosis-p15-925-convergence-2026-09-04.md, docs/design/openbot-diagnosis-p15-925-convergence-2026-09-04.json, docs/design/openbot-diagnosis-p15-925-preflight-2026-09-04.md, docs/design/openbot-diagnosis-p15-925-preflight-2026-09-04.json, docs/design/openbot-diagnosis-p15-928-2026-09-04.md, docs/design/openbot-diagnosis-p15-928-convergence-2026-09-04.md, docs/design/openbot-diagnosis-p15-928-convergence-2026-09-04.json, docs/design/openbot-diagnosis-p15-928-preflight-2026-09-04.md, docs/design/openbot-diagnosis-p15-928-preflight-2026-09-04.json, docs/design/openbot-diagnosis-p15-929-2026-09-04.md, docs/design/openbot-diagnosis-p15-929-convergence-2026-09-04.md, docs/design/openbot-diagnosis-p15-929-convergence-2026-09-04.json, docs/design/openbot-diagnosis-p15-929-preflight-2026-09-04.md, docs/design/openbot-diagnosis-p15-929-preflight-2026-09-04.json, docs/design/openbot-diagnosis-p15-930-2026-09-04.md, docs/design/openbot-diagnosis-p15-930-convergence-2026-09-04.md, docs/design/openbot-diagnosis-p15-930-convergence-2026-09-04.json, docs/design/openbot-diagnosis-p15-930-preflight-2026-09-04.md, docs/design/openbot-diagnosis-p15-930-preflight-2026-09-04.json, docs/design/openbot-diagnosis-p15-delivery-owner-actions-2026-09-04.md, docs/design/openbot-diagnosis-p16-936-2026-09-04.md, docs/design/openbot-diagnosis-p16-936-convergence-2026-09-04.md, docs/design/openbot-diagnosis-p16-936-convergence-2026-09-04.json, docs/design/openbot-diagnosis-p16-936-preflight-2026-09-04.md, docs/design/openbot-diagnosis-p16-936-preflight-2026-09-04.json, docs/design/openbot-diagnosis-p17-2026-09-04.md, docs/design/openbot-diagnosis-p17-ledger-2026-09-04.md, docs/design/openbot-diagnosis-p17-ledger-2026-09-04.json, docs/design/openbot-diagnosis-p17-dependencies-2026-09-04.md, docs/design/openbot-diagnosis-p17-slo-2026-09-04.md, docs/design/openbot-diagnosis-p17-slo-2026-09-04.json, docs/design/openbot-diagnosis-p17-convergence-2026-09-04.md, docs/design/openbot-diagnosis-p17-convergence-2026-09-04.json, docs/design/openbot-diagnosis-p17-preflight-2026-09-04.md, docs/design/openbot-diagnosis-p17-preflight-2026-09-04.json, docs/design/openbot-diagnosis-p17-delivery-owner-actions-2026-09-04.md, docs/design/openbot-diagnosis-p18-2026-09-04.md, docs/design/openbot-diagnosis-p18-convergence-2026-09-04.md, docs/design/openbot-diagnosis-p18-convergence-2026-09-04.json, docs/design/openbot-diagnosis-p18-preflight-2026-09-04.md, docs/design/openbot-diagnosis-p18-preflight-2026-09-04.json, docs/design/openbot-diagnosis-p18-delivery-owner-actions-2026-09-04.md, docs/design/openbot-diagnosis-p19-2026-09-04.md, docs/design/openbot-diagnosis-p19-convergence-2026-09-04.md, docs/design/openbot-diagnosis-p19-convergence-2026-09-04.json, docs/design/openbot-diagnosis-p19-preflight-2026-09-04.md, docs/design/openbot-diagnosis-p19-preflight-2026-09-04.json, docs/design/openbot-diagnosis-p19-delivery-owner-actions-2026-09-04.md, docs/design/openbot-diagnosis-p20-2026-09-05.md, docs/design/openbot-diagnosis-p20-convergence-2026-09-05.md, docs/design/openbot-diagnosis-p20-convergence-2026-09-05.json, docs/design/openbot-diagnosis-p20-preflight-2026-09-05.md, docs/design/openbot-diagnosis-p20-preflight-2026-09-05.json, docs/design/openbot-diagnosis-p20-delivery-owner-actions-2026-09-05.md, docs/design/openbot-diagnosis-p20.1-2026-09-05.md, docs/design/openbot-diagnosis-p20.1-convergence-2026-09-05.md, docs/design/openbot-diagnosis-p20.1-convergence-2026-09-05.json, docs/design/openbot-diagnosis-p20.1-preflight-2026-09-05.md, docs/design/openbot-diagnosis-p20.1-preflight-2026-09-05.json, docs/design/openbot-diagnosis-p20.1-delivery-owner-actions-2026-09-05.md, docs/design/openbot-diagnosis-p20.2-2026-09-05.md, docs/design/openbot-diagnosis-p20.2-ledger-2026-09-05.md, docs/design/openbot-diagnosis-p20.2-ledger-2026-09-05.json, docs/design/openbot-diagnosis-p20.2-convergence-2026-09-05.md, docs/design/openbot-diagnosis-p20.2-convergence-2026-09-05.json, docs/design/openbot-diagnosis-p20.2-preflight-2026-09-05.md, docs/design/openbot-diagnosis-p20.2-preflight-2026-09-05.json, docs/design/openbot-diagnosis-p20.2-post966-2026-09-05.md, docs/design/openbot-diagnosis-p20.2-post966-convergence-2026-09-05.md, docs/design/openbot-diagnosis-p20.2-post966-convergence-2026-09-05.json, docs/design/openbot-diagnosis-p20.2-post966-preflight-2026-09-05.md, docs/design/openbot-diagnosis-p20.2-post966-preflight-2026-09-05.json, docs/design/openbot-diagnosis-p21-2026-09-05.md, docs/design/openbot-diagnosis-p21-report-2026-09-05.md, docs/design/openbot-diagnosis-p21-report-2026-09-05.json, docs/design/openbot-diagnosis-p21-dependencies-2026-09-05.md, docs/design/openbot-diagnosis-p21-dependencies-2026-09-05.json, docs/design/openbot-diagnosis-p21-slo-2026-09-05.md, docs/design/openbot-diagnosis-p21-slo-2026-09-05.json, docs/design/openbot-diagnosis-p21-convergence-2026-09-05.md, docs/design/openbot-diagnosis-p21-convergence-2026-09-05.json, docs/design/openbot-diagnosis-p21-preflight-2026-09-05.md, docs/design/openbot-diagnosis-p21-preflight-2026-09-05.json, docs/design/openbot-diagnosis-p22-2026-09-05.md, docs/design/openbot-diagnosis-p22-report-2026-09-05.md, docs/design/openbot-diagnosis-p22-report-2026-09-05.json, docs/design/openbot-diagnosis-p22-approval-2026-09-05.md, docs/design/openbot-diagnosis-p22-approval-2026-09-05.json, docs/design/openbot-diagnosis-p22-convergence-2026-09-05.md, docs/design/openbot-diagnosis-p22-convergence-2026-09-05.json, docs/design/openbot-diagnosis-p22-preflight-2026-09-05.md, docs/design/openbot-diagnosis-p22-preflight-2026-09-05.json, docs/design/openbot-diagnosis-p22-post969-2026-09-05.md, docs/design/openbot-diagnosis-p22-post969-report-2026-09-05.md, docs/design/openbot-diagnosis-p22-post969-report-2026-09-05.json, docs/design/openbot-diagnosis-p22-post969-approval-2026-09-05.md, docs/design/openbot-diagnosis-p22-post969-approval-2026-09-05.json, docs/design/openbot-diagnosis-p22-post969-convergence-2026-09-05.md, docs/design/openbot-diagnosis-p22-post969-convergence-2026-09-05.json, docs/design/openbot-diagnosis-p22-post969-preflight-2026-09-05.md, docs/design/openbot-diagnosis-p22-post969-preflight-2026-09-05.json, docs/design/openbot-diagnosis-p22-human-approval-2026-09-05.md, docs/design/openbot-diagnosis-p22-human-approval-2026-09-05.json, docs/design/openbot-diagnosis-p22-human-approval-report-2026-09-05.md, docs/design/openbot-diagnosis-p22-human-approval-report-2026-09-05.json, docs/design/openbot-diagnosis-p22-human-approval-pack-2026-09-05.md, docs/design/openbot-diagnosis-p22-human-approval-pack-2026-09-05.json, docs/design/openbot-diagnosis-p23-2026-09-05.md, docs/design/openbot-diagnosis-p23-report-2026-09-05.md, docs/design/openbot-diagnosis-p23-report-2026-09-05.json, src/diagnosis/production-provenance.ts, src/diagnosis/production-provenance.test.ts, src/diagnosis/production-p21.ts, src/diagnosis/production-p21.test.ts, src/diagnosis/production-p21.cli.ts, src/diagnosis/production-p22.ts, src/diagnosis/production-p22.test.ts, src/diagnosis/production-p22.cli.ts, src/diagnosis/production-p23.ts, src/diagnosis/production-p23.test.ts, src/diagnosis/production-p23.cli.ts, src/diagnosis/production-p24.ts, src/diagnosis/production-p24.test.ts, src/diagnosis/production-p24.cli.ts, src/diagnosis/production-unified-deploy.ts, src/diagnosis/production-unified-deploy.test.ts, src/diagnosis/production-unified-deploy.cli.ts, src/diagnosis/production-unified-deps.ts, src/diagnosis/production-unified-deps.test.ts, src/diagnosis/production-unified-deps.cli.ts, docs/design/openbot-diagnosis-p24-2026-09-05.md, docs/design/openbot-diagnosis-p24-report-2026-09-05.md, docs/design/openbot-diagnosis-p24-report-2026-09-05.json, docs/design/openbot-diagnosis-p24.1-2026-09-05.md, docs/design/openbot-diagnosis-p24.1-report-2026-09-05.md, docs/design/openbot-diagnosis-p24.1-report-2026-09-05.json, docs/design/openbot-diagnosis-unified-window-carry-2026-09-05.md, docs/design/openbot-diagnosis-p24.2-2026-09-05.md, docs/design/openbot-diagnosis-p24.2-report-2026-09-05.md, docs/design/openbot-diagnosis-p24.2-report-2026-09-05.json, docs/design/openbot-diagnosis-p24.2-dependencies-2026-09-05.md, docs/design/openbot-diagnosis-p24.2-dependencies-2026-09-05.json, docs/design/openbot-diagnosis-p24.3-2026-09-05.md, docs/design/openbot-diagnosis-p24.3-report-2026-09-05.md, docs/design/openbot-diagnosis-p24.3-report-2026-09-05.json, docs/design/openbot-diagnosis-p24.3-preflight-2026-09-05.md, docs/design/openbot-diagnosis-p24.3-preflight-2026-09-05.json, docs/design/openbot-diagnosis-p24.3-convergence-2026-09-05.md, docs/design/openbot-diagnosis-p24.3-convergence-2026-09-05.json, docs/design/openbot-diagnosis-p24.3-verify-live-2026-09-05.md, docs/design/openbot-diagnosis-p24.3-verify-live-2026-09-05.json, src/diagnosis/production-unified-lock.ts, src/diagnosis/production-unified-lock.test.ts, src/diagnosis/production-unified-lock.cli.ts, src/diagnosis/production-post-cutover.ts, src/diagnosis/production-post-cutover.test.ts, src/diagnosis/conversation-run.ts, src/diagnosis/conversation-live.ts, src/diagnosis/daibai-delivery-live.ts, src/diagnosis/production-gate-contract.ts, src/diagnosis/production-p24.5.ts, src/diagnosis/production-p24.5.test.ts, src/diagnosis/production-p24.5.cli.ts, src/diagnosis/production-enablement-sequence.ts, src/diagnosis/production-enablement-sequence.test.ts, src/diagnosis/production-p24.6.ts, src/diagnosis/production-p24.6.test.ts, src/diagnosis/production-p24.6.cli.ts, src/diagnosis/production-p24.7.ts, src/diagnosis/production-p24.7.test.ts, src/diagnosis/production-p24.7.cli.ts, src/diagnosis/production-p24.8.ts, src/diagnosis/production-p24.8.test.ts, src/diagnosis/production-p24.8.cli.ts, src/diagnosis/intervention-case.ts, src/diagnosis/production-p26.5.ts, src/diagnosis/production-p25.ts, src/diagnosis/production-p25.test.ts, src/diagnosis/production-p25.cli.ts, src/diagnosis/production-p26.ts, src/diagnosis/production-p26.test.ts, src/diagnosis/production-p26.cli.ts, src/diagnosis/production-p26.1.ts, src/diagnosis/production-p26.1.test.ts, src/diagnosis/production-p26.1.cli.ts, docs/design/openbot-diagnosis-p26.1-2026-09-06.md, docs/design/openbot-diagnosis-p26.1-delivery-owner-actions-2026-09-06.md, docs/design/openbot-diagnosis-p26.1-readiness-2026-09-06.md, docs/design/openbot-diagnosis-p26.1-readiness-2026-09-06.json, src/diagnosis/production-p26.2.ts, src/diagnosis/production-p26.2.test.ts, src/diagnosis/production-p26.2.cli.ts, docs/design/openbot-diagnosis-p26.2-2026-09-06.md, docs/design/openbot-diagnosis-p26.2-delivery-owner-actions-2026-09-06.md, docs/design/openbot-diagnosis-p26.2-readiness-2026-09-06.md, docs/design/openbot-diagnosis-p26.2-readiness-2026-09-06.json, src/diagnosis/production-p26.3.ts, src/diagnosis/production-p26.3.test.ts, src/diagnosis/production-p26.3.cli.ts, docs/design/openbot-diagnosis-p26.3-2026-09-06.md, docs/design/openbot-diagnosis-p26.3-delivery-owner-actions-2026-09-06.md, docs/design/openbot-diagnosis-p26.3-readiness-2026-09-06.md, docs/design/openbot-diagnosis-p26.3-readiness-2026-09-06.json, src/diagnosis/phase1-registry-semantics.test.ts, src/diagnosis/report-query-api.test.ts, src/diagnosis/report-query-deploy.ts, src/diagnosis/report-query-gateway.test.ts, src/diagnosis/report-query-production-integration.test.ts, src/diagnosis/report-query-production-adapters.ts, src/diagnosis/report-query-production-adapters.test.ts, src/diagnosis/report-query-production-rehearsal.ts, src/diagnosis/report-query-production-rehearsal.test.ts, src/diagnosis/report-query-production-approval.ts, src/diagnosis/report-query-production-config.ts, src/diagnosis/report-query-production-config.test.ts, docs/design/openbot-diagnosis-p24.6-2026-09-06.md, docs/design/openbot-diagnosis-p24.6-enablement-2026-09-06.md, docs/design/openbot-diagnosis-p24.6-enablement-2026-09-06.json, docs/design/openbot-diagnosis-p24.7-2026-09-06.md, docs/design/openbot-diagnosis-p24.7-enablement-2026-09-06.md, docs/design/openbot-diagnosis-p24.7-enablement-2026-09-06.json, docs/design/openbot-diagnosis-p24.8-2026-09-06.md, docs/design/openbot-diagnosis-p24.8-enablement-2026-09-06.md, docs/design/openbot-diagnosis-p24.8-enablement-2026-09-06.json, docs/design/openbot-diagnosis-p25-2026-09-06.md, docs/design/openbot-diagnosis-p25-canary-2026-09-06.md, docs/design/openbot-diagnosis-p25-canary-2026-09-06.json, docs/design/openbot-diagnosis-p26-2026-09-06.md, docs/design/openbot-diagnosis-p26-readiness-2026-09-06.md, docs/design/openbot-diagnosis-p26-readiness-2026-09-06.json, src/diagnosis/production-cutover.ts, src/diagnosis/production-cutover.test.ts, src/diagnosis/production-admission.ts, src/diagnosis/production-approval-freeze.ts, src/diagnosis/production-preflight.ts, src/diagnosis/production-trunk-convergence.ts, docs/design/openbot-diagnosis-p24.5-2026-09-05.md, docs/design/openbot-diagnosis-p24.5-enablement-2026-09-05.json, docs/design/openbot-diagnosis-p24.4-2026-09-05.md, docs/design/openbot-diagnosis-p24.4-report-2026-09-05.md, docs/design/openbot-diagnosis-p24.4-report-2026-09-05.json, docs/design/openbot-diagnosis-p24.4-preflight-2026-09-05.md, docs/design/openbot-diagnosis-p24.4-preflight-2026-09-05.json, docs/design/openbot-diagnosis-p24.4-convergence-2026-09-05.md, docs/design/openbot-diagnosis-p24.4-convergence-2026-09-05.json, docs/design/openbot-diagnosis-p24.4-verify-live-2026-09-05.md, docs/design/openbot-diagnosis-p24.4-verify-live-2026-09-05.json, src/diagnosis/production-approval-freeze.test.ts, src/diagnosis/production-admission.test.ts, src/diagnosis/production-preflight.test.ts, src/diagnosis/production-trunk-convergence.test.ts, src/diagnosis/report-query-production-approval.test.ts, ui/src/ui/ports/platform/diagnosis/**, ui/src/ui/ports/enterprise/diagnosis/**, docs/design/openbot-diagnosis-cloud-o1-accept-2026-09-12.md, docs/design/openbot-diagnosis-cloud-o1-accept-2026-09-12.json, docs/design/openbot-diagnosis-cloud-o1-accept-l3-2026-09-12.json, docs/design/openbot-diagnosis-p24.8-enablement-2026-09-12.json, .kiro/specs/openbot-diagnosis-platform/** · since: 2026-09-02
- `codex-diagnosis-architect` · role: contributor · scope: 诊断平台架构评估与实施方案（Phase 0 前） · paths: .kiro/specs/openbot-diagnosis-platform/\*\*, docs/design/openbot-diagnosis-platform-implementation-plan-2026-09-02.md · since: 2026-09-02

## Tasks

- [x] 1.1 核验 Doctor、Runtime、Channel、Agent、Skill、OTEL 与 Evolution Governance 现状。 — codex-diagnosis-architect
- [x] 1.2 评估统一 Diagnosis Protocol、Control Plane、Evidence Plane 与 Diagnosis Graph 的可行性。 — codex-diagnosis-architect
- [x] 1.3 输出结合现状的分阶段改造升级方案。 — codex-diagnosis-architect
- [x] 1.4 基于源码冻结 Authority of Record、分层 Finding、Evidence Planner、完成条件与一期垂直切片。 — codex-diagnosis-architect

## Phase 0 — Protocol freeze and authority inventory

验收状态：**协议冻结待复验勾选；合入前治理已处理，P1 increment 1 已开工**。Phase 0 完成 ≠ Diagnosis Platform 完成。2.1–2.5 仍待验收团队复验后勾选。 — cursor-grok-diagnosis

- [ ] 2.1 完成 Authority of Record 矩阵（SUPPORTED/PARTIAL/MISSING/BLOCKED）。已纠正 record.ts vs event-store.ts、Doctor 无 repair 仍写入。待复验，不得标完成。 — cursor-grok-diagnosis
- [ ] 2.2 冻结 Diagnosis Protocol v1 TypeScript 契约与纯校验（Target/Run/Evidence/Observation/Assessment/Attribution/Hypothesis/Finding/Relation/Case/Recommendation/Verification）。已补 impact 必填、DiagnoserResult 强制挡模型 P0、Evidence Source id 全 snake_case。待复验，不得标完成。 — cursor-grok-diagnosis
- [ ] 2.3 完成现有事实源适配矩阵与副作用边界。id 已统一 snake_case。待复验，不得标完成。 — cursor-grok-diagnosis
- [ ] 2.4 完成一期 Session → Agent → Skill → Tool 垂直切片场景与脱敏 fixture。已补场景卡 Target（tenantId/authority/scope）、场景 1 `agent_not_routed=unknown`、场景 4 双指标、过期 locator=`source_expired`。待复验，不得标完成。 — cursor-grok-diagnosis
- [ ] 2.5 契约测试与场景测试通过；未接入生产主链、未引入自动修复。测试已按复验清单重跑，待验收团队复验后才能勾选。 — cursor-grok-diagnosis

## Merge gates

- Diagnosis-scoped tsgo：`src/diagnosis` 不得出现 `error TS`。过滤器见 `src/diagnosis/tsgo-gate.ts`。
- 全仓 `pnpm tsgo`：独立基线门禁。当前因其他并行任务失败（exit 2），**不**由本任务清理，也不得宣称全仓类型已绿。
- `src/diagnosis/**` 落盘：Loom 任务 `openbot-diagnosis-platform:codex-diagnosis-architect` 的唯一 active session 为 `cursor-grok-diagnosis`（`9ABD7B33-…`）。前任 `codex-diagnosis-architect` session 已 `done`。`sharedPaths` 指定本任务为 lander，避免与 `pi-sdk-family-migration-v3:cursor` 的 `src/**` 归属冲突。`.loom/registry.yaml` 仍由 `kiro-loom` 落盘。

## Phase 1 — Session → Agent → Skill → Tool vertical slice

一期实现只读、进程内；禁止改消息主链、Skill Invocation 写入、doctor-fix、channel restart。
**3.6/3.7 已签收（e067669159）。3.8 已签收（8c259c19e8 / 验收复验）。** Agent/Tool 仍走投影，符合 3.8 范围；主链没写。4.1/4.2 已签。
不挡签收：`BLOCKED` 加 receipt 仍会出 verification（注释只写了 CONFIRMED/PROBABLE）；本文件标题曾误写「3.8 开工中」而 checkbox 已 `[x]`，现已改。
**3.8 完成 ≠ Phase 1 完成 ≠ Diagnosis Platform 完成。** 3.9 接到 Agent/Tool 只读权威采集。不要横向铺 Channel 主链；4.3 只复用 Doctor 只读合同。

- [x] 3.1 Diagnoser Registry：`trace-interaction` / `agent-runtime` / `skill-runtime` / `tool-runtime`。 — cursor-grok-diagnosis
- [x] 3.2 Evidence Catalog：切片源可采集；`route_resolution` reserved 且 `phase1Safe=false`。 — cursor-grok-diagnosis
- [x] 3.3 Skill `attributionResolution` 透传，禁止默认 `identity_tool_name`。 — cursor-grok-diagnosis
- [x] 3.4 Case merger：`mergeKey` 确定性合并；场景 4 为强制回归。 — cursor-grok-diagnosis
- [x] 3.5 Verification 只写 `governanceReceiptRef`；`INCONCLUSIVE` = `status=completed` 且 verification=null。 — cursor-grok-diagnosis
- [x] 3.6 已签收（e067669159）。只读接到 `readSkillInvocationEvents` 与 Session JSONL metadata reader（注入路径；fs 写测试 JSONL，诊断侧不调用 append）。回放 3.7 仍注入采集行。不写主链。 — cursor-grok-diagnosis
- [x] 3.7 已签收（e067669159）。Journal / QUICK-TARGETED 执行器回放 6 个 fixture。完成态只从 `stopWhen` + 采集结果推导；禁止读/抄 `graph.run.completion`。strip-completion 后仍为 CONFIRMED/CONFIRMED/CONFIRMED/CONFIRMED/PROBABLE/INCONCLUSIVE。`ReplayResult` 不含 fixture `case`。 — cursor-grok-diagnosis
- [x] 3.8 已签收。垂直切片接到真实采集路径：3.6 reader 接入 runner（注入 `stores`）；`stopWhen` 边采边停；非 INCONCLUSIVE verification 只写 governance receipt，禁止抄 `graph.verification`。Agent/Tool 仍走投影。禁止改主链、禁止横向铺 Doctor/Channel。3.8 ≠ Phase 1 完成。 — cursor-grok-diagnosis
- [x] 3.9 Agent/Tool 权威源。注入 hook/diagnostic-event observation JSONL，或 Session JSONL 角色元数据；有 store 时不再用 fixture 投影。已补三条必须项：拒绝虚构 `type=agent_runner`；Session 派生 `complete` 仅在见到 `agent_end` 时为 true；runner 回放证明 store 覆盖后 fixture tool 行不再进入 collected。3.9 仍待复验全签。3.9 ≠ Phase 1 完成。 — cursor-grok-diagnosis

## Phase 2 — Runtime / Channel / Doctor read-only

横向接入只读评估，禁止 doctor `--fix` / channel restart / 消息主链变更。Phase 0 完成 ≠ Diagnosis Platform 完成。4.1/4.2 已签收只读注册与合同；4.3 拆分 Doctor 只读合同与 CLI 修复入口。4.4 为只读、进程内 Case 聚合与 Graph，**无生产主链接入**。4.1/4.2 ≠ Phase 2 完成 ≠ Diagnosis Platform 完成。

- [x] 4.1 注册 `runtime-health` / `channel-delivery` / `doctor-static`；模式仅 TARGETED | FULL，不得进入 QUICK。FULL 才调度这三台 Diagnoser；QUICK/TARGETED 垂直切片不变。只读，禁止进 QUICK。4.1 ≠ Phase 2 完成 ≠ Platform 完成。 — cursor-grok-diagnosis
- [x] 4.2 Channel 只读 `evaluateChannelHealth`；Doctor 只调已签收的 `runDoctorChecks` 合同，拒绝 repair/fix。不横向铺 Channel 主链、不重启 channel、不 doctor-fix。4.2 ≠ Phase 2 完成 ≠ Platform 完成。 — cursor-grok-diagnosis
- [x] 4.3 Doctor 纯检查与 `--fix` 路径拆分并完成 CLI 集成。CLI（含 `--fix`）先复用 `runDoctorChecks` 同一套 rows，再进入独立 repair。Diagnosis 只调只读合同。gateway/auth/sandbox verdict 不再双份维护。4.4 未实施。4.3 ≠ Phase 2 完成。 — cursor-grok-diagnosis
- [x] 4.4 跨 Target Case 聚合与跨组件 Diagnosis Graph。按 tenantId + sessionKeyHash + mergeKey 聚合引用；causes 门禁复用现有 Evidence/Rule/Human audit；MODEL_INFERRED 只能 candidate；禁止时间顺序 RCA 与平行 RCA。入口校验 slice 内 tenant/session 一致性（tenant_mismatch / finding_tenant_mismatch / evidence_tenant_mismatch / session_key_mismatch）。EvidenceRef 透传 tenantId + 显式 sessionKeyHash；仅 gateway/host 可为 null，其余 targetType 缺 hash 抛 evidence_ref_session_identity_required。只读、进程内，不接主链、不修、不重启。4.4 ≠ Phase 2 完成 ≠ Diagnosis Platform 完成。 — cursor-grok-diagnosis

## Phase 3 — Composite report (read-only)

只读综合报告。禁止写 Journal store、主链、Skill Invocation、doctor repair、channel restart、自动修复。5.1–5.4 / P3.5 已签收；P3.6 真门禁已落地待复验；P3.7 为生产接入评审材料；P3.8 为默认关闭的生产适配器；P3.9 为配置注入与 live-pack 注册预演；P3.10 为生产接入审批包。5.x / P3.7 / P3.8 / P3.9 / P3.10 完成 ≠ Phase 3 完成 ≠ 生产部署 ≠ Diagnosis Platform 完成。4.1/4.2 已签。垂直切片 `diagnose()` 已接到 runner；本增量 ≠ Phase 1/2/3 完成 ≠ Diagnosis Platform 完成。

- [x] 5.1 只读 Composite Diagnosis Report Contract。从已验收 CompositeDiagnosis 投影 reportId/generatedAt/cases/targets/findings/evidenceRefs/graphEdges/root causes/impactScope/completion/missingEvidence/confidence。不复制 Evidence payload，不推断新 causes，不改 Case/Finding/Relation 状态。MODEL_INFERRED 只在 candidate；INCONCLUSIVE 保留 missingEvidence；P0 要显式 support。同输入 + 同 generatedAt 字节稳定。默认单租户：cases/targets/findings/evidenceRefs 必须与 trusted tenant 一致；多 tenant 抛 report_tenant_mismatch；null 仅表示 system/local 单租户。只读、进程内，不接主链。5.1 ≠ Phase 3 完成。 — cursor-grok-diagnosis
- [x] 5.2 Composite Diagnosis Report validation and export boundary。`validateCompositeDiagnosisReport` 校验 schemaVersion=1、reportId/generatedAt、trusted 单租户、cases/findings/evidenceRefs/targets/missingEvidence 逐项结构、confidence 单位区间、graph fromId/toId 节点存在、accepted/candidate 与 graphEdges 同 relationId 内容一致、RCA 门禁、INCONCLUSIVE missingEvidence、禁止 payload/UI 字段。未知版本拒绝，不降级。`exportCompositeDiagnosisReportJson` 只出稳定 JSON，无 Markdown/HTML/模型摘要。不接 HTTP/RPC。5.2 ≠ Phase 3 完成 ≠ 下一阶段 API/权限入口。 — cursor-grok-diagnosis
- [x] 5.3 只读 Report Query and Authorization Contract。进程内 `queryCompositeReports` / `getCompositeReport`：请求带 tenantId、mode（case/report/session）、caseId/reportId/sessionKeyHash、requestedBy、TrustedTenantContext、limit/cursor/sort。请求 tenant 必须与 trusted 一致；禁止跨 tenant；无 trusted 拒绝；tenantId=null 必须显式 `diagnosis.local_read`。reportId/caseId/sessionKeyHash 不能绕过 tenant。结果一律再走 `validateCompositeDiagnosisReport`。cursor 绑定 tenant 与查询条件，禁止随机 token。注入只读 reader/stub，不新增数据库，不写 Journal/Store/Session/Skill/Tool/Doctor/Channel，不接 HTTP/RPC/UI。5.3 ≠ Phase 3 完成 ≠ 生产查询入口。 — cursor-grok-diagnosis
- [x] 5.4 生产报告查询安全契约与 reference adapter。`ProductionQueryRequest/Response`：服务端 `TrustedTenantContext` 为唯一租户权威，禁止信任客户端 `claimedTenantId`；principal 必须匹配 trusted；report/case/session 越权统一 `forbidden` denial，不泄露目标是否存在；tenantId=null 必须 `diagnosis.local_read`。审计接口只记 principal/tenant/mode/目标摘要/结果数/拒绝原因，不记 payload。限流 per-tenant/per-principal，limit 上限 50。cursor `pq1.` 绑定 tenant+principal+查询+排序，可过期，无随机 token。脱敏 profile：administrator / user / system_local，只出 reference projection。适配现有 query/get，注入 reader，不接 HTTP/RPC/UI/审计存储。5.4 ≠ Phase 3 完成 ≠ 生产 API。 — cursor-grok-diagnosis

## Phase 3.5 — Governed report API boundary (not deployed)

接口契约与路由适配。调用 5.4 `executeProductionReportQuery` / `executeProductionReportGet`，不复制租户/principal/脱敏/游标/配额逻辑。`TrustedTenantContext` 只由服务端认证注入，禁止从 URL/query/body/header 信任 tenantId。响应仅为 `ProductionQueryResponse`。HTTP 状态映射 401/403/429/400；未知方法 404；report/case/session 是否存在一律不泄露。`DIAGNOSIS_REPORT_API_DEPLOYED=false` 由 registry/manifest 读取，false 时不进入 `GATEWAY_METHOD_PACKS` / `coreGatewayHandlers`。禁止事项：生产构建/发布/重启/切流量、写主链、Doctor `--fix`、Channel restart、Skill Invocation 写入。

- [x] P3.5 受治理生产报告查询 API 入口。`dispatchDiagnosisReportApi` / `bindDiagnosisReportApiHandlers` 适配 `diagnosis.reports.query` 与 `diagnosis.reports.get`。认证失败 401，越权/不存在 403，配额 429，未知 schema/非法 cursor 400。审计继续注入 `ProductionQueryAuditSink`。不吞 reader/validation/contract 错误。API 已实现但尚未生产部署。P3.5 ≠ Phase 3 完成 ≠ 生产切换。 — cursor-grok-diagnosis

## Phase 3.6 — Gateway method-pack wiring (not deployed)

将 P3.5 API 接入现有 gateway method-pack / auth resolver。`diagnosisReportsPack` 模块存在，但 `DIAGNOSIS_REPORT_API_DEPLOYED=false` 时不进入 `GATEWAY_METHOD_PACKS` / manifest / `coreGatewayHandlers`，因此 operator.read 网关不能调用 `diagnosis.reports.query` / `get`。Trusted tenant 来自 membership，不从 URL/body/header/`sessionTenantId` 当权威。`tenantId=null` 仍要求 `diagnosis.local_read`。未声明 `sessionDomain` 且 membership tenant 为 null 时失败关闭。默认 deps 为进程内空 reader + 内存审计/配额。禁止事项：生产构建/发布/重启/切流量、写主链、Doctor `--fix`、Channel restart、Skill Invocation 写入。P3.6 ≠ Phase 3 完成 ≠ 生产切换。

- [x] P3.6 受治理报告查询 API 接入 gateway wiring。method-pack + auth resolver 已接；deploy flag 真挡住 live pack 注册。P1 fail-closed 保留。已接入 wiring，但未生产部署。P3.6 ≠ Phase 3 完成 ≠ 生产切换。 — cursor-grok-diagnosis

## Phase 3.7 — Production integration review (not deployed)

基于已验收的 P3.6 wiring，冻结生产接入评审所需的认证、reader、审计、配额与发布候选契约。`DIAGNOSIS_REPORT_API_DEPLOYED=false`。禁止生产构建/发布/重启/切流量，禁止新建 Report DB / Skill Health DB / 诊断事实源。P3.7 ≠ Phase 3 完成 ≠ 生产部署。

- [x] P3.7 生产接入评审契约。冻结 `evaluateDiagnosisProductionAuth` 输入/输出/失败关闭与授权矩阵；tenant 不从 URL/query/body/header/`sessionTenantId` 成为权威。盘点 Composite Report 只读 reader 来源并包装缺失/过期/租户不一致/schema 不兼容。审计 `persist()` 为异步且查询链路 await 后再响应；`record()` 失败关闭。配额窗口失败关闭；审计不含 Evidence payload。发布候选保持 flag=false、无 live 注册。P1 异步 persist 已补。P3.7 ≠ Phase 3 完成 ≠ 生产切换。 — cursor-grok-diagnosis

## Phase 3.8 — Production adapters (not deployed)

实现生产 reader / 审计 persist / 配额存储适配器，全部默认关闭。只读现有 Composite Diagnosis 投影，禁止新建 Report DB / Skill Health DB / 诊断事实源。`DIAGNOSIS_PRODUCTION_ADAPTERS_ENABLED=false`，`DIAGNOSIS_REPORT_API_DEPLOYED=false`。不加入 live pack / manifest / coreGatewayHandlers。禁止生产构建/发布/重启/灰度/切流量。P3.8 ≠ Phase 3 完成 ≠ 生产部署。

- [x] P3.8 默认关闭的生产适配器。`createProductionCompositeReportReader` 校验 schema/tenant/maxAge 并转换 `ProductionReaderFault`；`createProductionAuditPersistSink` 先 `assertProductionAuditRecordSafe` 再异步 persist，无同步旁路；查询链路 `await consumeWindow()` 并在成功/失败路径 `releaseWindow()`；backend unavailable → 503。默认内存仍走同步 `consume()`。P1 配额未接入查询链路已补。P3.8 ≠ Phase 3 完成 ≠ 生产切换。 — cursor-grok-diagnosis

## Phase 3.9 — Production config rehearsal (not deployed)

验证生产配置注入、adapter wiring、gateway method-pack 注册条件与回滚门禁。只做预演与测试，不执行生产发布。默认配置关闭；缺失/非法/backend 不完整 fail-closed。dry-run 只生成可注册候选，不修改 `GATEWAY_METHOD_PACKS` / manifest / `coreGatewayHandlers`。`DIAGNOSIS_PRODUCTION_ADAPTERS_ENABLED=false`，`DIAGNOSIS_REPORT_API_DEPLOYED=false`。禁止生产构建/发布/重启/灰度/切流量/自动修复。P3.9 ≠ Phase 3 完成 ≠ 生产部署。

- [x] P3.9 生产配置注入与 live-pack 注册预演。仅完成预演：配置默认关闭，缺失/非法/backend 不完整 fail-closed；`resolveProductionAdapterDepsFromConfig` 关闭走内存，启用必须同时有 report/audit/quota；quota 异步 window lease，audit await persist，reader 做 schema/tenant/maxAge/payload 校验。`previewDiagnosisLivePackRegistration` 在 flag=false、adapter 未启用或依赖不完整时不注册；全条件满足只返回 candidate，不改 `GATEWAY_METHOD_PACKS` / manifest / `coreGatewayHandlers`。readiness 覆盖 schema/cursor/auth/redaction/status mapping，`readyForProductionCutover` 恒为 false。不执行 build、publish、restart、灰度或流量切换。P3.9 ≠ Phase 3 完成 ≠ 生产部署。 — cursor-grok-diagnosis

## Phase 3.10 — Production approval pack (not deployed)

生成生产接入审批包，并完成合并前 ancestry、静态安全和发布门禁检查。这是审批准备，不是生产发布。`DIAGNOSIS_PRODUCTION_ADAPTERS_ENABLED=false`，`DIAGNOSIS_REPORT_API_DEPLOYED=false`。live pack / HTTP / RPC / UI 真实入口未打开。下一步必须人工批准：真实 backend 配置、live gateway pack 注册、生产构建、重启、灰度与流量切换。禁止本任务执行 build、publish、restart、灰度或切流量。P3.10 ≠ Phase 3 完成 ≠ 生产部署。

- [x] P3.10 生产接入审批包。`DIAGNOSIS_PRODUCTION_APPROVAL_MANIFEST` 汇总 P3.5–P3.9 的 API/auth/reader/audit/quota/redaction/rollback；`approvedForProductionCutover` 恒为 false；生产依赖仍需显式注入和审批。合并前门禁证明 flag 关闭、live pack 未注册、`coreGatewayHandlers` 无 diagnosis methods、无主链/Skill/Doctor/Channel 写入。P3.10 ≠ Phase 3 完成 ≠ 生产切换。 — cursor-grok-diagnosis

## Phase 4 — Dynamic inspection and DiagnosticSignal (read-only)

只读生成 DiagnosticSignal。支持 scheduled / event / threshold / trend / verification-triggered。信号必须引用既有 Target、Evidence、Finding、Case 与 tenant。可创建或关联 DiagnosticCase，不得伪造 Evidence 或 RCA。进程内调度 + 可注入时钟，禁止真实后台常驻线程。禁止写消息主链、Skill Invocation、Doctor、Channel、配置；不新增运行事实源 / Report DB / Skill Health DB；不接入大白投送；不执行修复。P4 ≠ Phase 完成 ≠ 生产部署 ≠ Diagnosis Platform 完成。

- [x] P4 动态巡检与 DiagnosticSignal。校验、去重/合并/抑制/过期、INCONCLUSIVE/缺失证据/重试/失败关闭、租户隔离与幂等已覆盖。不修复、不投送、不驻留线程。P4 已验收，仍未接入真实聊天或消息主链。P4 ≠ 生产切换。 — cursor-grok-diagnosis

## Phase 5 — Da Bai delivery contract (not live)

把 DiagnosticSignal 投送到大白的合同：平台 / 企业 / 员工路由、敏感字段脱敏、投送幂等与回执、失败重试与过期、大白不可用时的待投送队列。默认 transport 为 unavailable；注入内存 transport 仅用于测试。禁止调用 `user.daibai.ask` / `execute`，禁止写消息主链、Session、Skill Invocation、Doctor、Channel。P4 巡检仍不直接投送。P5 ≠ 生产部署 ≠ 真实聊天接入。

- [x] P5 大白投送合同。P12 复验通过：缺授权、租户错配、principal 冒用、过期/撤销 grant 均 fail-closed，`rejected` 不入 pending；回执、重试、过期可审计。仍未接 live Da Bai pack，未写主链。P5 ≠ 生产投送 ≠ 真实聊天接入。 — cursor-grok-diagnosis

## Phase 6 — Conversation diagnosis state machine (in-process)

大白管家在对话窗编排诊断：追问、暂停、授权等待、恢复、取消、超时。仅进程内状态机 + 可注入 store。只能调用已注册 Diagnoser / Evidence Source 与 P5 delivery contract。对话消息与 Evidence 分离；模型输出不得写成正式 RCA。P6 不包含真实聊天接入、跨租户委托、自动修复或生产部署。

- [x] P6 对话诊断状态机。`ConversationDiagnosisRun` 覆盖合法/非法迁移、ask/pause/resume/approve/deny/cancel/timeout、授权等待不得采集、授权过期/撤销、tenant/principal 隔离、快照恢复与 commandId 幂等。未接真实聊天 / HTTP / live handler / UI。P6 ≠ 生产切换 ≠ Diagnosis Platform 完成。 — cursor-grok-diagnosis

## Phase 7 — Graded authorization and remote consult (in-process)

平台 / 企业 / 员工大白之间的分级授权、向下调配、远程诊断委托和会诊。平台大白可以向下调配，但每次调配必须经过相应授权：调配企业大白需企业管理员批准；调配员工大白必须企业管理员 + 员工本人双重授权。`canSubdelegate` 默认 false。Evidence / Finding / Report 分别授权。仅进程内状态机，不是真实跨租户 RPC。不执行修复或生产部署。

- [x] P7 分级授权与会诊委托。`AuthorizationGrant` / `AgentDelegationGrant` / `RemoteDiagnosisMission` / `EvidenceShareGrant` / `ReportShareGrant` 覆盖双重授权、绕过拒绝、过期/撤销/suspend/consumed、P5 投送守卫与 P6 `WAITING_AUTHORIZATION` 恢复。P1：`assertDeliverable` 必须绑定 `auth.principalId === delegatedAgent`，缺 principal 或同租户其他大白/上级角色冒用均拒绝。未接跨租户 RPC / 聊天 / live pack。P7 ≠ 生产切换 ≠ Diagnosis Platform 完成。 — cursor-grok-diagnosis

## Phase 8 — Governed evolution proposal bridge (in-process)

把已授权的 P4–P7 诊断/会诊结果转为 `EvolutionProposal`，并投影到既有 Skill / Working DNA / Capsule / Fabric / Evolution Governance 候选形状。只生成候选与证据引用，不自动应用任何能力变更。固定生命周期 suggest → approve → apply → verify → rollback。授权失效后不得创建或导出。不是真实跨租户 RPC，也不执行 tick / redirect / runtime action。

- [x] P8 受治理进化提案。`EvolutionProposal` 与独立的 candidate / approval / application / verification 对象；P7 grant/mission/share 仍有效才可创建或导出；平台级 proposal 只接受多企业脱敏摘要。未 publish/install Skill、未写 Working DNA、未 promote Capsule、未 mutate Fabric（`autoApplied=false`）、未执行治理 tick。P8 ≠ 生产切换 ≠ Diagnosis Platform 完成。 — cursor-grok-diagnosis

## Phase 9 — Governed remediation preview and verification (in-process)

在 P8 `EvolutionProposal` 上实现 Remediation Preview、人工批准、执行门禁、Verification Diagnosis 与回滚契约。只实现进程内治理执行器；默认 executor 为 dry-run / unavailable。不接 Doctor `--fix`、Channel restart、配置写入、Skill install/disable 或 runtime action。P9 只完成治理执行与验证契约，不代表真实修复或生产部署。

- [x] P9 治理修复预览与验证。`RemediationProposal` / `RemediationExecution` / `RemediationVerification` 覆盖风险门禁、preview 无副作用、高风险人工批准、`doctor_repair`/`channel_restart`/`skill_disable` 阻断、executor 成功/失败/unavailable、baseline/observation 判决与回滚门禁。未接生产写入。P9 ≠ 真实修复 ≠ 生产切换 ≠ Diagnosis Platform 完成。 — cursor-grok-diagnosis

## Phase 10 — Read-only diagnosis visualization (not deployed)

为平台端和企业端提供统一只读诊断可视化，展示动态巡检、Signal、Case、远程会诊、授权、Remediation、Verification 与持续观察状态。UI 只消费既有 Diagnosis API / in-process projection，不创建第二套事实源，不显示 Evidence payload / Prompt / Tool output / 敏感 session。对话入口只发送 `signalId` / `caseId` / target reference。批准/拒绝只刷新既有 P6/P7 状态。不接生产写入、真实聊天、RPC、Doctor、Channel 或自动修复。P10 ≠ 生产 API ≠ 真实聊天 ≠ 自动修复 ≠ 生产部署 ≠ Diagnosis Platform 完成。

- [x] P10 只读诊断可视化。`DiagnosisTimelineProjection` / `DiagnosisTrendProjection` / `DiagnosisGraphProjection` / `DiagnosisAuthorizationProjection` / `DiagnosisRemediationProjection` 携带 tenant scope、redaction profile 与 permission state；平台只出跨企业脱敏摘要，企业只出本企业与已授权员工范围；过期/撤销/suspend/consumed 立即隐藏；空数据、过期、权限不足、加载失败与 INCONCLUSIVE 不得渲染为健康或已解决。未接生产写入、真实聊天或自动修复。P10 ≠ 生产切换 ≠ Diagnosis Platform 完成。 — cursor-grok-diagnosis

## Phase 11 — Controlled production cutover (not started)

把已验收的 P4–P10 进程内能力接到可审批的生产路径：权威 Composite Diagnosis reader、audit persist、quota、gateway method pack、大白投送、对话闭环、Remediation 与 EvolutionProposal。所有生产写入和流量切换必须独立审批，不得默认开启。`DIAGNOSIS_PRODUCTION_ADAPTERS_ENABLED` / `DIAGNOSIS_REPORT_API_DEPLOYED` / `DIAGNOSIS_DAIBAI_DELIVERY_ENABLED` / `DIAGNOSIS_REMEDIATION_EXECUTION_ENABLED` 默认 false。回滚只关 gate、撤销 live pack、停止新任务并保留审计，不得删除历史。P11 ≠ 生产构建 ≠ 灰度切换 ≠ Diagnosis Platform 完成。

- [x] P11 受控灰度与回滚演练。只完成默认关闭的 cutover pack、readiness/provenance、故障注入与回滚演练；复用 P3.5/P3.6 handlers，不注册 live pack，不打开真实聊天/Doctor/Channel/自动修复。未获独立批准前不得生产构建、发布、重启或切流量。P11 ≠ 生产切换 ≠ Diagnosis Platform 完成。 — cursor-grok-diagnosis

## Phase 12 — Consistency, authorization, and observability convergence (not production)

生产准入前最后一轮一致性 / 授权 / 可观测收敛，产出给 `platform_security` 与 `enterprise_admin` 的 Go/No-Go 包。复验 P5、冻结生产依赖清单、冻结观测契约、冻结 gate 审批矩阵，并跑可重复的 deploy-candidate preflight。`readyForIndependentApproval` 仅在 P5 已签、账本/provenance 一致、SLO 观测完整且全部预检通过时为 true。即使为 true 也不得开 gate 或切流量。P12 ≠ 生产部署 ≠ Diagnosis Platform 完成。4.1/4.2 已签。垂直切片 `diagnose()` 已接到 runner。本增量 ≠ Phase 完成 ≠ Platform 完成。

- [x] P12 Go/No-Go 预检包。复验并签收 P5 进程内投送合同；冻结 reader/audit/quota/auth/Da Bai/conversation/remediation 依赖与观测指标；默认 gate 仍全部 false。当前 candidate ≠ origin/main、RELEASE_RECORD ≠ LIVE/ledger、SLO 为空、生产依赖未注入，故 `readyForIndependentApproval=false`，结论为 No-Go。未开 gate、未注册 live pack、未切流量。P12 ≠ 生产切换 ≠ Diagnosis Platform 完成。 — cursor-grok-diagnosis

## Phase 13 — Read-only single-tenant admission rehearsal (not production)

在不改写账本、不补 provenance、不开 gate 的前提下，注入预生产 reader/audit/quota，补齐 SLO 观测，跑单租户只读 `diagnosis.reports.query/get` 与 P4–P10 预览链，再重算 `readyForIndependentApproval`。Trusted tenant 只来自 membership。任何账本 / provenance / SLO / 依赖 / 授权失败仍为 No-Go。即使 Ready 也不得开 gate。P13 ≠ 生产部署 ≠ Diagnosis Platform 完成。4.1/4.2 已签。垂直切片 `diagnose()` 已接到 runner。本增量 ≠ Phase 完成 ≠ Platform 完成。

- [x] P13 只读准入排练。账本一致性保持 No-Go（LIVE/ledger=`6d9ea1f2d5`，RELEASE_RECORD 仍 `37cc40e51f`，缺 `provenance/sha-6d9ea1f2d5`，未改写账本、未补 tag）；预生产依赖与完整 SLO 已排练；只读 query/get 覆盖鉴权、隔离、脱敏、审计、配额；P4–P10 链停在 preview/dry-run。当前树 `readyForIndependentApproval=false`。未开 gate、未注册 live pack、未切流量。P13 ≠ 生产切换 ≠ Diagnosis Platform 完成。 — cursor-grok-diagnosis

## Phase 14 — Release identity review and independent approval freeze (not production)

核对运行容器 LIVE，决定账本/provenance 能否诚实修复，并冻结依赖清单、SLO 证据与分角色/分 gate 审批材料。`readyForIndependentApproval` 仅在 LIVE/ledger/RELEASE_RECORD/provenance 可证明一致、candidate 等于最新 origin/main、SLO 完整且审批材料齐备时为 true。即使 Ready，批准也不等于开 gate。P14 ≠ 生产部署 ≠ Diagnosis Platform 完成。4.1/4.2 已签。垂直切片 `diagnose()` 已接到 runner。本增量 ≠ Phase 完成 ≠ Platform 完成。

- [x] P14 独立批准材料冻结。运行容器 LIVE=`6d9ea1f2d5` 与 ledger seq 58 已对齐故不改写账本；RELEASE_RECORD 仍落后，provenance 在 cutover 时未发布故不补 tag。依赖/SLO/四门 gate 审批包已冻结，批准不等于开启。candidate ≠ origin/main，故 `readyForIndependentApproval=false`。未开 gate、未注册 live pack、未切流量。P14 ≠ 生产切换 ≠ Diagnosis Platform 完成。 — cursor-grok-diagnosis

## Phase 15 — Trunk convergence and identity-evidence rehearsal (not production)

安全收敛诊断候选到最新 `origin/main`，并排练 LIVE / ledger / RELEASE_RECORD / provenance 证据链与诚实修复。candidate 必须等于最新 `origin/main` 才可进入独立批准。缺失 provenance 只生成 remint plan，不发布 tag。P15 ≠ 生产部署 ≠ Diagnosis Platform 完成。4.1/4.2 已签。垂直切片 `diagnose()` 已接到 runner。本增量 ≠ Phase 完成 ≠ Platform 完成。

- [ ] P15 主干收敛与身份证据排练。#936 已于 `2026-09-04T05:26:20Z` 合入（squash `e7c614eb54` = 评估时 origin/main），`candidateEqualsOriginMain=true`。LIVE/ledger 仍是 seq 59 / `3d03d3b4df`（#932，seq 58 已 close）；RELEASE_RECORD 仍 `37cc40e51f46`；provenance 仍缺失且 `do_not_mint`/`published=false`。因此 **仍是 No-Go，仍不能签收**。下一步只属于 `delivery_ledger_owner`：见 P17 行动单，Latest 写 seq 60 / `457057ba2adb`，不得回写 seq 59 / `3d03d3b4df`。未改写账本、未补 tag、未开 gate、未部署。4.1/4.2 与 `diagnose()` 已在主干，不改变 P15 No-Go。P15 ≠ 生产切换 ≠ Diagnosis Platform 完成。 — cursor-grok-diagnosis

## Phase 16 — Post-merge identity re-score before independent approval (not production)

必须基于合并后最新 `origin/main` 重算 candidate，不得使用特征分支或旧快照。P16 确认 4.1/4.2 与 `diagnose()` 合入后的发布身份、账本、provenance、SLO 与生产依赖，输出最终 Go/No-Go。P16 ≠ 生产部署 ≠ Diagnosis Platform 完成。即使 Ready 也不得开 gate。

- [ ] P16 合并后身份链复核与独立审批前最终预检。#936 squash `e7c614eb54` 当时等于评估时 origin/main。P16 验收为暂不能签收 / No-Go。LIVE 其后已切到 seq 60 / `457057ba2adb`（#940）。P16 保持 `[ ]`。 — cursor-grok-diagnosis

## Phase 17 — Release-ledger convergence and admission evidence (not production)

解决 P15/P16 剩余阻塞并重评 Go/No-Go。candidate 必须等于最新 `origin/main`。缺失 provenance 只生成 remint plan。Diagnosis 不得改写 ledger / RELEASE_RECORD，不得补 tag。P17 ≠ 生产部署 ≠ Diagnosis Platform 完成。即使 Ready 也不得开 gate。

- [ ] P17 发布账本收敛与准入证据补齐。验收/复检均为 No-Go。执行下一步时 LIVE 已离开 seq 60，P17 行动单已过期。保持 `[ ]`。 — cursor-grok-diagnosis

## Phase 18 — Next-step RELEASE_RECORD attempt (not production)

执行 P17 指定的下一步：在 LIVE==ledger 可证明时更新 Latest cutover。若 LIVE 已前移则停止写 RELEASE_RECORD，重跑 preflight。P18 ≠ 生产部署 ≠ Diagnosis Platform 完成。即使 Ready 也不得开 gate。

- [ ] P18 下一步执行。candidate=`330d922074`。LIVE=`e59aede250` ≠ ledger seq 60 / `457057ba2adb` ≠ RELEASE_RECORD `37cc40e51f46`。未改账本、未改 Latest、未合并 #941、未补 tag。SLO empty，reader/audit/quota fail closed。`readyForIndependentApproval=false`。其后 LIVE 前移到 seq 62，P18 行动单已过期。P18 ≠ 生产切换 ≠ Diagnosis Platform 完成。 — cursor-grok-diagnosis

## Phase 19 — #945 rescore after claimed merge (not production)

按「945已合入」重跑对账。必须先核实 PR 状态，再以最新 `origin/main` 与容器 LIVE 重跑 convergence / preflight。#945 CLOSED ≠ 合入。Diagnosis 不得改写 ledger / RELEASE_RECORD，不得补 tag。P19 ≠ 生产部署 ≠ Diagnosis Platform 完成。即使 Ready 也不得开 gate。

- [ ] P19 #945 重评。#945 是 CLOSED / superseded，`mergeCommit=null`。seq 61 经 #948，seq 62 经 #950。当时 candidate=`04690f8d2e`（#951）。LIVE=ledger seq 62 / `81aafe1e`。RELEASE_RECORD Latest 仍 seq 61 / `e59aede250`。其后 LIVE 前移到 seq 63，P19 行动单已过期。P15–P19 均不签收。P19 ≠ 生产切换 ≠ Diagnosis Platform 完成。 — cursor-grok-diagnosis

## Phase 20 — Dynamic release-identity reconcile (not production)

解决 P15–P19 的移动 LIVE / ledger / RELEASE_RECORD / provenance 不一致。candidate 必须等于最新 `origin/main`。LIVE 只来自运行容器。Diagnosis 不得改写 ledger / RELEASE_RECORD，不得补 tag。若 LIVE 已前移则废弃旧行动单。P20 ≠ 生产部署 ≠ Diagnosis Platform 完成。即使 Ready 也不得开 gate。身份链未对齐时不得进入 P21。

- [ ] P20 动态发布身份对账。当时 candidate=`65a8195278`（#952）。LIVE=ledger seq 63 / `04690f8d2e`（#953）。RELEASE_RECORD Latest 仍 seq 61 / `e59aede250`。#957 已合入。Latest 修复改走 #960，不得由 Diagnosis 代写。P20 ≠ 生产切换 ≠ Diagnosis Platform 完成。 — cursor-grok-diagnosis

## Phase 20.1 — Current LIVE identity re-score (not production)

在最新 `origin/main` 与当前容器 LIVE 上重跑对账。Latest 只由 `delivery_ledger_owner` 在主干更新。无真实发布证据则 `do_not_mint`。SLO / reader / audit / quota 未完整则 `readyForIndependentApproval=false`。P20.1 ≠ 生产部署。身份链与 SLO 未齐不得进入 P21。

- [ ] P20.1 当前 LIVE 对账。当时 candidate=`e106c3e168`。LIVE=ledger seq 63 / `04690f8d2e`。当时主干 Latest 仍 seq 61；#960 随后合入。#963 已合入。P20.1 ≠ 生产切换 ≠ Diagnosis Platform 完成。 — cursor-grok-diagnosis

## Phase 20.2 — Post-#960 LIVE / Latest re-score (not production)

`delivery_ledger_owner` 已在 `main` 把 Latest 写成已证明的 LIVE/ledger。重读容器后若 LIVE 未前移，不得再写 Latest，不得补 tag。candidate 必须等于最新 `origin/main`。SLO / 依赖未齐则 Ready=false。P20.2 ≠ 生产部署。不得进入 P21。

- [ ] P20.2 主干身份链重算与 provenance peeled-target 修正。#966 已于 `2026-09-05T03:50:52Z` 合入（squash `6d43b3f24c`）。#967 随后合入（squash `dc3b3f849b`）。LIVE=ledger=Latest=provenance peeled=`04690f8d2e`。standalone SLO empty，reader/audit/quota fail closed。未改账本、未补 tag、未开 gate。官方验收仍不勾选。 — cursor-grok-diagnosis

## Phase 21 — Isolated pre-production dependency and SLO evidence (not production)

在已对齐的身份链上注入隔离预生产依赖、完成故障注入、生成可复核 SLO。candidate 必须等于最新 `origin/main`。LIVE 只来自运行容器。standalone production-preflight 仍为空 SLO / fail-closed，不得当成 live 健康。P21 Ready ≠ 开 gate ≠ 生产部署。即使 Ready 也不得自行打开 gate 或部署。

- [ ] P21 隔离预生产依赖与 SLO 证据闭环。candidate=`dc3b3f849b`（#967）。LIVE=ledger=Latest=provenance peeled=`04690f8d2e`。七项隔离依赖 `productionWrite=false`；13 项故障注入通过；隔离 SLO completeness=`complete`。standalone preflight/convergence 仍 No-Go（空 SLO + 生产 reader/audit/quota fail-closed）。未开 gate、未生产构建/发布/重启、未改账本、未补 tag、未提交 `.loom/registry.yaml`。Ready ≠ 生产切换 ≠ Diagnosis Platform 完成。 — cursor-grok-diagnosis

## Phase 22 — Independent approval pack freeze (not production)

在已对齐的身份链上冻结可供人类签署的独立审批包。复用 P14 冻结合同与 P21 隔离证据。批准不等于开启。candidate 必须等于最新 `origin/main`。LIVE 只来自运行容器。standalone production-preflight 仍为空 SLO / fail-closed，不得当成 live 健康。P22 Ready ≠ 已签署 ≠ 开 gate ≠ 生产部署。人类批准已记录后，P23 只做隔离单租户金丝雀，不得把批准当成生产开启。

- [ ] P22 独立审批包冻结。#969 已于 `2026-09-05T05:54:56Z` 合入（squash `2156a529d6`）。人类独立批准已记录：signer=`Daniel / CEO`，四角色与四门 gate 均为 `signed=true` / `decision=approve`，`value_after_approval=false`。candidate=`2156a529d6`。LIVE=ledger=Latest=provenance peeled=`04690f8d2e`。`humanApprovalRecorded=true`，但四门 gate 仍为 false，`approvedForProductionCutover=false`，`gatesOpened=false`。standalone preflight/convergence 仍 No-Go（空 SLO + 生产 reader/audit/quota fail-closed）。未开 gate、未生产构建/发布/重启、未改账本、未补 tag、未提交 `.loom/registry.yaml`。批准 ≠ 开启 ≠ 生产切换 ≠ Diagnosis Platform 完成。P23 仅在用户显式指令后以隔离金丝雀开工。 — cursor-grok-diagnosis

## Phase 23 — Isolated single-tenant report API canary (not production)

消费已记录的 P22 人类独立批准，在隔离进程内演练 adapters + 只读 report API 单租户金丝雀。生产 flag 保持 false，不注册 live pack，不开启 Da Bai / remediation，不进入 P24。candidate 必须等于最新 `origin/main`。LIVE 只来自运行容器。standalone production-preflight 仍为空 SLO / fail-closed，不得当成 live 健康。P23 isolated canary ≠ 开 gate ≠ 生产部署。

- [ ] P23 只读报告 API 单租户隔离金丝雀。前置：P22 人类批准已记录且 `value_after_approval=false`。candidate=`2156a529d6`。LIVE=ledger=Latest=provenance peeled=`04690f8d2e`。隔离金丝雀验证 200/401/403/429/400/404、脱敏、游标、配额、审计；生产 pack preview 仍 `hold/deploy_flag_false`。四门 gate 仍为 false。未注册 live pack、未生产构建/发布/重启、未改账本、未补 tag、未提交 `.loom/registry.yaml`、未进入 P24。隔离金丝雀 ≠ 生产切换 ≠ Diagnosis Platform 完成。 — cursor-grok-diagnosis

## Phase 24 — Isolated Da Bai delivery and conversation canary (not production)

消费已记录的 P22 人类独立批准与 Ready 的 P23 隔离金丝雀，在隔离进程内演练 Da Bai 投送授权、回执与 P6 对话状态机。生产 `DIAGNOSIS_DAIBAI_DELIVERY_ENABLED` 保持 false，不绑定 live chat，不开启 remediation，不进入 P25。candidate 必须等于最新 `origin/main`。LIVE 只来自运行容器。P22 签署可在 LIVE 未变且签署 candidate 是当前 `origin/main` 祖先时沿用。P24 isolated canary ≠ 开 gate ≠ 生产投送。

- [ ] P24 Da Bai 投送与对话闭环隔离金丝雀。前置：P22 人类批准已记录且 `value_after_approval=false`；P23 隔离金丝雀 Ready。candidate=`c33589d9c7`（#970）。签署 candidate=`2156a529d6` 为祖先沿用。LIVE=ledger=Latest=provenance peeled=`04690f8d2e`。隔离验证 platform→enterprise、platform→employee 双授权、enterprise→employee；缺授权/过期/撤销/principal 冒用拒绝且不入 pending；WAITING_AUTHORIZATION / resume / deny / cancel / timeout；幂等 deliveryId、回执、重试、过期、审计；投送投影不含 Evidence；对话文本不写正式 RCA。四门 gate 仍为 false。未绑定 live chat、未开 remediation、未生产构建/发布/重启、未改账本、未补 tag、未提交 `.loom/registry.yaml`、未进入 P25。隔离金丝雀 ≠ 生产切换 ≠ Diagnosis Platform 完成。 — cursor-grok-diagnosis

## Phase 24.1 — Unified production deploy conditions (gates stay closed)

只开放「诊断代码可随其他新组件一起进入下一次 `origin/main` 统一生产发布」的条件。官方 carry：与对话历史弦线（#921）同一窗，不单独切。诊断不拥有 cutover，不以诊断单独切流量，不开启四门功能 gate，不启动 P25 受治理修复灰度，不输出 P26 Production Ready。四门 gate 必须等这次统一窗口 `verify-live` 通过之后才能开。代码可以暗发布（dark ship）。

- [ ] P24.1 统一窗口 carry。智能诊断已写入统一窗口 carry 表，与对话历史弦线同一窗。#973 已合入 `801c3e67d8`。#974 已合入 `8980bc7512`。历史评估当时 `origin/main`=`bf81b0ffcb`（#977）、LIVE=`04690f8d2e`、尚未上 LIVE。其后统一窗口已发布：LIVE=seq 64 / `7d3fdf5bfe`（#976）。当前 `origin/main` tip=`08cbb0681f`（#979），不得再切到该 tip，也不得使用旧 candidate `bf81b0ffcb`。`diagnosisOnlyCutover=false`，`cutoverOwner=delivery`，四门 gate 仍为 false。未改 `NEXT_OFFICIAL_WINDOW.md`、未提交 `.loom/registry.yaml`、未进入 P25/P26。统一窗口 carry ≠ 开 gate ≠ 诊断单独切流 ≠ Diagnosis Platform 完成。 — cursor-grok-diagnosis

## Phase 24.2 — Unified-window production dependency injection (gates stay closed)

为统一窗口注入生产形态的 reader / audit / quota / auth。Da Bai、live conversation、remediation 继续断开，必须等这次统一窗口 `verify-live` 通过后再接。四门功能 gate 保持 false。不连接 LIVE 写入，不注册 live pack，不启动 P25。standalone production-preflight 默认仍 fail-closed。

- [ ] P24.2 统一窗口生产依赖注入。前置：#973/#974 已在主干。#976 已正常 squash 合入 `7d3fdf5bfe`，并已作为统一窗口 LIVE / seq 64 发布。历史评估当时 LIVE=ledger=Latest=provenance peeled=`04690f8d2e`。当前 LIVE=ledger=Latest=provenance peeled=`7d3fdf5bfe`。当前 `origin/main` tip=`08cbb0681f`。P22 签署 candidate=`2156a529d6` / signed LIVE=`04690f8d2e` 因 candidate 与 LIVE 均已变化而失效，不得祖先沿用，须重新签署。reader/audit/quota/auth host injection ready，`productionWrite=false`，`liveConnected=false`。Da Bai / conversation / remediation 仍 disconnected。四门 gate 仍为 false。未进入 P25/P26。生产依赖注入 ≠ 开 gate ≠ 诊断单独切流 ≠ Diagnosis Platform 完成。 — cursor-grok-diagnosis

## Phase 24.3 — Unified-window lock and delivery verify-live (gates stay closed)

等待 #976 正常 squash 合入 `main` 后立即 `git fetch origin`。candidate 必须精确等于当时最新 `origin/main`。重读 LIVE（期望仍为 `04690f8d` / seq 63，否则以容器 `build-info.json` 为准）。重跑 forward-only、delivery alignment、production-preflight、convergence。统一窗口由 delivery cutover，诊断不得单独切流。verify-live 未通过则立即停止后续功能启用，四门 gate 保持 false，不绑定真实聊天，不启用 Da Bai 或 remediation。verify-live 通过也只表示统一窗口发布成功，不表示 Diagnosis Platform 完成，仍不开 gate。

- [ ] P24.3 统一窗口锁点与 delivery verify-live。暗发布验收记录：统一窗口已于 `2026-09-05T12:08:51Z` 由 delivery 发布到 LIVE `7d3fdf5bfef57077f7956ccab07c3c960984331b`（#976）；#980 已合入 `e23e4704eb`，主干 ledger / RELEASE_RECORD Latest / provenance peeled 均为 seq 64 / `7d3fdf5b`。`2026-09-05T13:36:37Z` 与 `2026-09-05T13:49:36Z` 官方 `--verify-live` / R9 / healthz / readyz 再验 PASS。已发布窗口仍是 `7d3fdf5b`；当前 `origin/main` tip=`08cbb0681f`（#979）含账本与后续 UI，不得再切到该 tip。四门 gate 仍为 false。Da Bai / live conversation / remediation 仍断开。live pack 未注册。未进入 P25/P26。未改 `NEXT_OFFICIAL_WINDOW.md`、未提交 `.loom/registry.yaml`。保持未勾选，等待验收。签收仅表示暗发布身份已在主干记账 ≠ 开 gate ≠ Diagnosis Platform 完成。 — cursor-grok-diagnosis

## Phase 24.4 — Post-unified-window re-evaluation (gates stay closed)

统一窗口发布后重评。candidate 必须等于最新 `origin/main`。LIVE 只来自运行容器。不得使用旧 candidate `bf81b0ffcb`。P22 复用只接受签署 candidate 与签署 LIVE 的精确匹配；任一变化即失效并须重新签署。不打开四门 gate，不注册 live pack，不绑定真实聊天，不启用 Da Bai / remediation，不进入 P25。

- [ ] P24.4 统一窗口发布后重评。candidate=`08cbb0681f`（最新 origin/main，#979）。LIVE=ledger=Latest=provenance peeled=`7d3fdf5bfe` seq 64。verify-live PASS。四门功能 gate 仍为 false。Da Bai / live conversation / remediation 仍 disconnected。`2026-09-05T14:32:00Z` 重跑：forward-only allow；delivery-alignment PASS=3 WARN=3 FAIL=0；standalone preflight No-Go（空 SLO / fail-closed）；convergence 身份链 LIVE=ledger=Latest=provenance=`7d3fdf5b`。P22 签署已失效，须逐 gate 重新独立批准。未改历史账本、未补发 provenance。未进入 P25/P26。保持未勾选。 — cursor-grok-diagnosis

## Phase 24.5 — Da Bai delivery + live conversation enablement

新开增量，不复用 P22，不叫 P25。candidate 必须精确等于当时最新 `origin/main`=`0676d469a7d45449837f33965bd7a71d5f7c9251`。LIVE 只读容器 `7d3fdf5bfef57077f7956ccab07c3c960984331b`。Daniel / CEO 仅签署 `DIAGNOSIS_DAIBAI_DELIVERY_ENABLED` 的 `valueAfterApproval=true` 与 `liveConversationBound=true`。其余三门保持 false。金丝雀 `internal_single_tenant` / `tenant-fixture-a`。唯一出站写点 `createLiveDaibaiTransport` → `chat.send`。合入 main 后仍须 delivery 统一窗口 cutover 才对用户生效。不改历史账本、不补 provenance、不注册 report pack、不进 P25/P26。

- [ ] P24.5 大白投送 + live conversation 对用户生效。开启批准已冻结。编译期仅翻开大白门。等待 isolate-F / DDOC PR 合入并由 delivery 做下一次统一窗口 cutover。 — cursor-grok-diagnosis

## Phase 24.6 — Adapters enablement (align order)

按官方门槛顺序打开下一扇门。P24.5 已作为产品第一刀打开大白。P24.6 打开 `DIAGNOSIS_PRODUCTION_ADAPTERS_ENABLED`（approver=`platform_security`）。candidate 必须精确等于当时最新 `origin/main`=`0676d469a7d45449837f33965bd7a71d5f7c9251`。LIVE=`7d3fdf5bfef57077f7956ccab07c3c960984331b`。Report API 与 remediation 保持 false。不注册 live pack，不进 P25/P26。合入 main 后仍须 delivery 统一窗口 cutover。

- [ ] P24.6 adapters 对用户生效。开启顺序合同已落地。编译期翻开 adapters。下一扇门是 report API。等待 isolate-F / DDOC PR 合入并由 delivery 做下一次统一窗口 cutover。 — cursor-grok-diagnosis

## Phase 24.7 — Report API enablement

按官方门槛顺序打开下一扇门。P24.5 已开大白，P24.6 已开 adapters。P24.7 打开 `DIAGNOSIS_REPORT_API_DEPLOYED`（approver=`platform_security`，依赖 adapters）。candidate 必须精确等于当时最新 `origin/main`=`1a429ce5ac017da7365221c795af6884570933d9`。LIVE=`7d3fdf5bfef57077f7956ccab07c3c960984331b`。`diagnosis-reports` pack 随之注册。remediation 保持 false。不进 P25/P26。合入 main 后仍须 delivery 统一窗口 cutover。

- [ ] P24.7 report API 对用户生效。开启批准已冻结。编译期翻开 report API。下一扇门是 remediation。等待 isolate-F / DDOC PR 合入并由 delivery 做下一次统一窗口 cutover。 — cursor-grok-diagnosis

## Phase 24.8 — Remediation enablement

按官方门槛顺序打开最后一扇门。P24.5 大白已合入 main。P24.6 / P24.7 仍未上主干（#986 合进侧枝，#987 与新主干冲突）。P24.8 重放到当时最新 `origin/main`=`0d8a31a2c4e91e13a9acff64ce57511efd694135`，带上 adapters + report API 依赖，打开 `DIAGNOSIS_REMEDIATION_EXECUTION_ENABLED`（approver=`platform_security+enterprise_admin+employee`）。LIVE=`7d3fdf5bfef57077f7956ccab07c3c960984331b`。不部署 live executor，不绑 Doctor `--fix` / Channel restart，不进 P25/P26。合入 main 后仍须 delivery 统一窗口 cutover。

- [ ] P24.8 remediation 对用户生效。开启批准已冻结。编译期翻开 remediation。live executor 仍 undeployed。等待 isolate-F / DDOC PR 合入并由 delivery 做下一次统一窗口 cutover。 — cursor-grok-diagnosis

## Phase 25 — Isolated governed remediation canary

官方 P25「受治理修复灰度」。前置：P24.8 已记录 `platform_security + enterprise_admin + employee` 批准。本增量只在 `tenant-fixture-a` 进程内跑 preview → execute → verification，executor 必须 allowlisted 且只能 dry-run。candidate 必须精确等于当时最新 `origin/main`=`0d8a31a2c4e91e13a9acff64ce57511efd694135`。LIVE=`7d3fdf5bfef57077f7956ccab07c3c960984331b`。生产 live executor 仍 undeployed。不绑 Doctor `--fix` / Channel restart / Skill disable / 配置写入。失败保持 `appliedToRuntime=false` 或进入明确回滚。不进 P26，不切 LIVE。合入 main 后仍须 delivery 统一窗口 cutover。

- [ ] P25 隔离受治理修复灰度。allowlisted dry-run canary 已冻结。#989 已合入 main。live executor 仍 undeployed。等待 delivery 做下一次统一窗口 cutover。 — cursor-grok-diagnosis

## Phase 26 — Closed-loop acceptance (No-Go)

官方 P26「闭环验收与平台完成判定」。前置：P25 隔离 canary 已记录。本增量只在进程内复验完整链路、三角色权限、跨租户/冒用/撤销、P4–P10 引用链、投影一致性、故障注入与回滚。历史冻结 candidate=`0d8a31a2c4e91e13a9acff64ce57511efd694135` 已随 #990 合入而作废。LIVE=`7d3fdf5bfef57077f7956ccab07c3c960984331b`。`p26ProductionReady` 保持 false：LIVE ≠ candidate，生产 SLO 仍 empty，live executor undeployed，且没有单独的 Production Ready 批准。不切 LIVE。合入 main 后仍须 delivery 统一窗口 cutover。

- [ ] P26 闭环验收已评估为 No-Go。#990 已合入 main。隔离链路通过。未宣布 Production Ready。历史 SHA 已作废，见 P26.1。 — cursor-grok-diagnosis

## Phase 26.1 — Post-merge re-evaluation + delivery cutover pack

#988 / #989 / #990 已在主干。本增量按新 `origin/main`=`7d75c0bba6ab692f1396cde3d366a10c68ae092d` 重跑隔离闭环，并写出 delivery 统一窗口行动单。LIVE 仍是 `7d3fdf5bfef57077f7956ccab07c3c960984331b`。`p26ProductionReady` 保持 false。不切 LIVE，不改账本，不补 provenance，不宣布 Production Ready。cutoverOwner=`delivery`。

- [ ] P26.1 合入后复评为 No-Go。#992 已合入 main。隔离链路仍成立。历史 SHA 已作废，见 P26.2。Diagnosis 不切 LIVE。 — cursor-grok-diagnosis

## Phase 26.2 — Unified-window cutover readiness (No-Go)

#992 已在主干。本增量按新 `origin/main`=`040e714cfc1266cb9becaa2b42a159dd503a9b89` 重跑隔离闭环，并证明 I1 allow。LIVE 仍是 `7d3fdf5bfef57077f7956ccab07c3c960984331b`。该 tip 的 GHCR 评估时未证明，`deliveryMayStage=false`。`p26ProductionReady` 保持 false。不切 LIVE，不改账本，不补 provenance，不宣布 Production Ready。cutoverOwner=`delivery`。

- [ ] P26.2 cutover 就绪已评估为 No-Go。#993 已合入 main。I1 allow。历史 SHA 已作废，见 P26.3。Diagnosis 不切 LIVE。 — cursor-grok-diagnosis

## Phase 26.3 — Unified-window cutover hold (No-Go)

#993 已在主干。本增量按新 `origin/main`=`91d4247ee21604f60b37fb1de3cc30209443ef76` 重跑隔离闭环，并证明 I1 allow。LIVE 仍是 `7d3fdf5bfef57077f7956ccab07c3c960984331b`。祖先 `040e714c` GHCR 已 success，禁止当 candidate。当前 tip GHCR 未证明。`furtherDiagnosisResignBlocked=true`。`p26ProductionReady` 保持 false。不切 LIVE。下一动作是 delivery 等当时最新 `origin/main` 的镜像后再 stage。

- [ ] P26.3 cutover hold 已评估为 No-Go。祖先镜像禁止切。诊断停等 delivery。等待 isolate-F / DDOC PR 合入；Diagnosis 不切 LIVE。 — cursor-grok-diagnosis

## Track A / A0 — Diagnosis Producer Boundary Freeze

不接活 Bridge，不向控制面提交 Proposal，不打开 confirm / Da Bai / 产品闸门。完成 A0 ≠ 活 Bridge 完成。A1 只能做 Preview 展示；确认后提交必须等 Track B 提交/WAL/授权接口并通过联合验收。

- [x] A0.1 A/B 分流：四个 A 类 purpose 只留处方，不生成 EvolutionProposal / WorkingDnaCandidate / Skill Candidate / structuralCandidates。 — cursor-grok
- [x] A0.2 StructuralEvolutionCandidate 纯类型+校验；不含权威 tenant / proposalId / grant / cron / apply payload。 — cursor-grok
- [x] A0.3 GrowthAssessmentSnapshot 哈希封存 + 只读 reader/validator；Evidence projection，不是新事实源。 — cursor-grok
- [x] A0.4 处方确认仅本人或 `schedule_diagnosis_prescription` 专用 grant；WDNA grant / 无 grant 管理员拒绝。闸门保持 false。 — cursor-grok
- [x] A0.5 用户可见工具名 `confirm_diagnose_prescription`；旧名同一 handler 别名。 — cursor-grok
- [x] A0.6 专业报告分开自我管理处方与结构性预览；preview 不得写成已进入进化流程。 — cursor-grok
- [x] A0.7 零控制面写入门禁 + `src/diagnosis` 不得 import `evolution-control`。 — cursor-grok
- [x] A0.2b `proposedChange` 枚举；`candidateVersion` 只哈希内容；provenance / 观察窗口不进版本或 cooldown。 — cursor-grok
- [x] A0.2c `reportingCadence` 改为 Working DNA 合法值 `on_completion|milestone|periodic|on_request`；拒绝 Cron `daily|weekday_daily|weekly`。 — cursor-grok
- [x] A0.3b Snapshot `createdAt`/`expiresAt` 必须是合法 ISO，且 `createdAt < expiresAt`，TTL ≤ 合同上限。 — cursor-grok
- [x] A0.4b Gateway confirm 从 Delegation Machine `getGrant` 读完整 grant，不信任工具参数。 — cursor-grok
- [x] A0.5b `createOpenClawTools` 只注册 `confirm_diagnose_prescription`。 — cursor-grok
- [x] A0.7b 零写入改为完整 live-request + 临时目录，断言无 Proposal/Candidate/Ledger/receipt/submit。 — cursor-grok
- [x] A0.8 A1 Preview：从可信 observation + baseline + 真实 report/finding/evidence/snapshot 构造 StructuralPreviewFact，专业报告仅展示 preview only / 未提交 / 需授权。不调用 submitDiagnosisCandidate，不写 WAL/Proposal/Candidate/Ledger，不开 Experiment，不 Apply。确认提交仍等 B 联合验收。 — cursor-grok
- [x] A1.1 Skill 安装 Preview DTO：`SkillInstallationCandidate` 只接受已有 skillId 的明确安装意图，surface=`capability.skill-installation`；unused-skill / 无 skillId / `capability.skill-spec` / 已安装均不出候选。B 可映射 `{ skillId, operation:"install", candidateVersion }`。仍只 preview。 — cursor-grok
- [x] A2 确认后提交：诊断只持久化 preview；Gateway `evolution.diagnosis.submit` 在用户确认后按 `candidateVersion` 加载 DTO 再调用 `submitDiagnosisCandidate`。客户端不得传 candidate。不 startExperiment / Apply。A 类 confirm 闸门保持 false。 — cursor-grok
- [x] A3 只读投影：报告组装与 `evolution.diagnosis.status` 当场读取 `getProposal` / `getExperiment`；`EvolutionSubmissionRef` 不含 status。大白展示「申请开实验」；真正 `evolution.experiments.create` 需要 `operator.approvals`。不 Apply。A 类 confirm 闸门保持 false。 — cursor-grok
- [x] A4 Skill 安装回流：`DiagnosisRecheckPort` 登记 `agent.working-dna` 与 `capability.skill-installation`；无 skillId / skill-spec 拒绝。确认提交同 A2。伪造验证且 store 未变 → STILL_OPEN。不 Apply。 — cursor-grok
- [x] A4 close：WDNA/Skill 对照领域 SoT 与 Application `targetVersionAfter`；VerificationRef/target/findingRefs/tenant 绑定；P26.1/P26.2 保持历史 No-Go 夹具。不 Promote/Apply。 — cursor-grok
- [x] A5 platform trusted context：platform actor 的 trusted.tenantId 必须为 null；enterprise-scoped raw request 抛 tenant_mismatch 且零写入。wrapper 仍把 platform issuer 转成 {tenantId:null}。重放不能跳过校验。 — cursor-grok

## t383 本地发布前门控修复（未发布）

- 本轮独立分支修复归属：src/diagnosis/production-cutover.ts, src/diagnosis/diagnose-professional-protocol.ts, src/diagnosis/diagnose-daibai-inbox.ts, src/diagnosis/write-policy.ts, src/diagnosis/write-policy.test.ts, src/diagnosis/diagnose-daibai-inbox-live.ts；历史诊断测试用显式 policy mock 保留已授权正路径，真实默认拒绝由 write-policy.test.ts 验证。— grok-t383

本轮显式启用的历史测试文件（仅测试注入，不改变生产默认）：

- src/diagnosis/diagnose-daibai-inbox.test.ts — grok-t383
- src/diagnosis/diagnose-evolution-prescription-auth.test.ts — grok-t383
- src/diagnosis/diagnose-evolution-recheck.test.ts — grok-t383
- src/diagnosis/diagnose-policy.test.ts — grok-t383
- src/diagnosis/diagnose.test.ts — grok-t383
- src/diagnosis/diagnosis-issue-queue.test.ts — grok-t383
- src/diagnosis/diagnosis-job.test.ts — grok-t383
- src/diagnosis/intervention-daibai-canary.test.ts — grok-t383
- src/diagnosis/intervention-dispatch.test.ts — grok-t383
- src/diagnosis/intervention-gateway.test.ts — grok-t383
- src/diagnosis/production-admission.test.ts — grok-t383
- src/diagnosis/production-approval-freeze.test.ts — grok-t383
- src/diagnosis/production-cutover.test.ts — grok-t383
- src/diagnosis/production-enablement-sequence.test.ts — grok-t383
- src/diagnosis/production-p21.test.ts — grok-t383
- src/diagnosis/production-p22.test.ts — grok-t383
- src/diagnosis/production-p23.test.ts — grok-t383
- src/diagnosis/production-p24.5.test.ts — grok-t383
- src/diagnosis/production-p24.6.test.ts — grok-t383
- src/diagnosis/production-p24.7.test.ts — grok-t383
- src/diagnosis/production-p24.8.test.ts — grok-t383
- src/diagnosis/production-p24.test.ts — grok-t383
- src/diagnosis/production-p25.test.ts — grok-t383
- src/diagnosis/production-p26.test.ts — grok-t383
- src/diagnosis/production-post-cutover.test.ts — grok-t383
- src/diagnosis/production-preflight.test.ts — grok-t383
- src/diagnosis/production-trunk-convergence.test.ts — grok-t383
- src/diagnosis/production-unified-deploy.test.ts — grok-t383
- src/diagnosis/production-unified-deps.test.ts — grok-t383
- src/diagnosis/production-unified-lock.test.ts — grok-t383
