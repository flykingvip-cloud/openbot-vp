# OpenBot Diagnosis Platform — P15 主干收敛与身份证据排练

Date: 2026-09-03

Status: **No-Go。2026-09-03 复检仍不能签收：`6d0f004899` / `d028fc955e` 只是验收保留记录，主干收敛未完成。#919 无 mergedAt，candidate ≠ 最新 origin/main。本轮没有新的可签收实现。必须先完成 PR 合并并重新 fetch / 重算 preflight。在此之前不得进入独立批准或任何生产部署。P15 ≠ 生产部署 ≠ Diagnosis Platform 完成。**

Audience: Platform Security、Enterprise Admin、Employee、delivery ledger owner、SRE、QA

Task: `openbot-diagnosis-platform`

Related:

- [P14 独立批准材料冻结](/design/openbot-diagnosis-p14-independent-approval-2026-09-03)
- [P13 只读准入排练](/design/openbot-diagnosis-p13-go-no-go-2026-09-03)
- [P12 Go/No-Go 预检包](/design/openbot-diagnosis-p12-go-no-go-2026-09-03)
- [开发交付链路标准](/design/openbot-dev-delivery-pipeline-standard-2026-07-20)

硬门禁：即使 `readyForIndependentApproval=true`，也不得打开生产 gate、不得注册 live pack、不得调用真实聊天 / RPC / Doctor / Channel、不得自动修复、不得改写 `https://github.com/flykingvip-cloud/harness-Benchmark-Engine/blob/main/deploy/production/releases.jsonl` / `RELEASE_RECORD.md`、不得发布 `provenance/sha-*`。Trusted tenant 只来自服务端 membership。生产依赖只能由显式服务端配置注入。禁止新增 Report DB / Skill Health DB / 平行诊断事实源。

机器可读快照：

- [P15 convergence JSON](/design/openbot-diagnosis-p15-convergence-2026-09-03.json) · [P15 convergence Markdown](/design/openbot-diagnosis-p15-convergence-2026-09-03.md)
- [P15 preflight JSON](/design/openbot-diagnosis-p15-preflight-2026-09-03.json) · [P15 preflight Markdown](/design/openbot-diagnosis-p15-preflight-2026-09-03.md)

复跑命令：

```text
bun src/diagnosis/production-trunk-convergence.cli.ts \
  --json-out docs/design/openbot-diagnosis-p15-convergence-2026-09-03.json \
  --md-out docs/design/openbot-diagnosis-p15-convergence-2026-09-03.md

bun src/diagnosis/production-preflight.cli.ts --live-sha <40-hex> \
  --json-out docs/design/openbot-diagnosis-p15-preflight-2026-09-03.json \
  --md-out docs/design/openbot-diagnosis-p15-preflight-2026-09-03.md
```

合入主干后必须把 candidate 重评为最新 `origin/main`，不要继续用旧特征分支 HEAD。

---

## 1. 发布身份证据链

2026-09-03 从 `root@8.217.93.71` / `openbot-gateway-rc` 读取 `/app/dist/build-info.json`：

```json
{ "commit": "6d9ea1f2d5da2ae46ddfd18ecae12b07692a2a96", "builtAt": "2026-09-03T01:37:57.887Z" }
```

CLI 以容器 LIVE 为准。注入 SHA 与容器不一致时丢弃注入值。

| 身份                          | SHA                                        | 来源                        | 时间                     | 可证明          | 与 LIVE 一致 |
| ----------------------------- | ------------------------------------------ | --------------------------- | ------------------------ | --------------- | ------------ |
| candidate                     | `58e6eebc041b89717e156055fbadaee9b7ba5d31` | `git rev-parse HEAD`        | n/a                      | 是              | 否           |
| origin/main                   | `769da88d21a4ade2ed598ece481b1a31d75e3138` | `git rev-parse origin/main` | n/a                      | 是              | 否           |
| LIVE                          | `6d9ea1f2d5da2ae46ddfd18ecae12b07692a2a96` | 运行容器 `build-info.json`  | 2026-09-03T01:37:57.887Z | 是（container） | 是           |
| ledger open                   | `6d9ea1f2d5da2ae46ddfd18ecae12b07692a2a96` | seq 58 开放行               | 2026-09-03T02:52:10Z     | 是              | 是           |
| RELEASE_RECORD Latest cutover | `37cc40e51f468404baf3077307e347f32f636cb1` | Latest cutover              | 2026-09-02T09:50:59Z     | 是              | 否           |
| provenance                    | missing                                    | annotated tag               | n/a                      | 否              | 否           |

一致性拆分：

- `candidateEqualsOriginMain=false` — 拒绝旧 candidate 进入独立批准
- `liveEqualsLedger=true`
- `liveEqualsReleaseRecord=false`
- `liveEqualsProvenance=false`

Ancestry：`origin/main` 是 candidate 祖先；LIVE 是 candidate 祖先；LIVE 是 `origin/main` 祖先。

---

## 2. Provenance remint plan（不发布）

| 对象                          | 决定                              | 原因                                                                                             |
| ----------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------ |
| `https://github.com/flykingvip-cloud/harness-Benchmark-Engine/blob/main/deploy/production/releases.jsonl` seq 58       | **keep / 不改写**                 | 开放行已等于 LIVE。改写会掩盖运行版本。                                                          |
| `RELEASE_RECORD.md`           | **defer_to_delivery_owner**       | Latest cutover 仍写 seq 54 / `37cc40e51f`。特征分支改写会使审批包看起来已对齐，而 trunk 仍落后。 |
| `provenance/sha-6d9ea1f2d5da` | **do_not_mint / published=false** | seq 58 注明 cutover 拉取 GHCR `main` 且 `no provenance-sha-*`。事后补 tag 等于伪造发布史。       |

proposedTag=`provenance/sha-6d9ea1f2d5da`。存在的 tag 仍是 `provenance/sha-37cc40e51f46`。remint plan ≠ 发布 tag。

delivery_ledger_owner 若要修复人类视图：在 trunk 上把 Latest cutover 写成已证明的 LIVE `6d9ea1f2d5da`；不要回写 ledger 历史。若未来 cutover 需要 provenance，走正常发布路径。

---

## 3. P14 包复验

四门 gate 默认 false：`DIAGNOSIS_PRODUCTION_ADAPTERS_ENABLED`、`DIAGNOSIS_REPORT_API_DEPLOYED`、`DIAGNOSIS_DAIBAI_DELIVERY_ENABLED`、`DIAGNOSIS_REMEDIATION_EXECUTION_ENABLED`。

- live pack `diagnosis-reports` 未注册
- `coreGatewayHandlers` 无 `diagnosis.*`
- 准入排练内 SLO `completeness=complete`；reader / audit / quota 在包内为 available
- 裸 P12 preflight（无注入）仍报 SLO empty、reader/audit/quota unavailable
- P4–P10 链保持 `previewOnly=true`、`appliedToRuntime=false`、`WAITING_AUTHORIZATION`
- `approvalDoesNotOpenGate=true`

---

## 4. 主干收敛路径

当前树 verdict 必须保持 No-Go，直到：

1. 诊断变更经常规 PR 合入 `main`
2. 重新 `git fetch origin` 后 candidate **等于** 最新 `origin/main`
3. RELEASE_RECORD Latest cutover 与 provenance 也可证明对齐

合入后不得继续用旧特征分支 HEAD 当 candidate。即使 PR 成功，只要 RELEASE_RECORD / provenance 未对齐，Ready 仍为 false。

合成对齐输入可以把 `readyForIndependentApproval` 打成 true，仍不会开 gate、不会切流量、不会发布 provenance。

---

## 5. 仍需人工批准

- `platform_security`
- `enterprise_admin`
- `employee`
- `delivery_ledger_owner`

批准 ≠ 开 gate。缺失证据 fail-closed。

---

## 6. 未做

- 未改写 `https://github.com/flykingvip-cloud/harness-Benchmark-Engine/blob/main/deploy/production/releases.jsonl`
- 未改 `RELEASE_RECORD.md`
- 未补 `provenance/sha-6d9ea1f2d5da`
- 未打开任何生产 gate，未注册 live pack
- 未执行生产构建、发布、重启、灰度或流量切换
- 未接真实聊天、live 大白、Doctor `--fix`、Channel restart
- 4.1 / 4.2 仍未勾；`diagnose()` 仍未实现

---

## 7. 2026-09-03 验收结论

**暂不能签收。** 仅确认“预演包已落地，主干收敛未完成”。当前结论仍是 No-Go。

已确认：

- `58e6eebc04` 的 P15 收敛引擎、CLI、测试和快照已提交
- `5407d91cff` 已记录 PR #919，但 PR 仍被 `REVIEW_REQUIRED` 阻塞
- candidate 仍不等于最新 `origin/main`，因此不能进入独立批准
- LIVE 与 ledger 一致；RELEASE_RECORD 仍落后
- provenance 缺失，且当前决策为 `do_not_mint` / `published=false`
- 未改写 ledger、未补 provenance、未打开 gate、未注册 live pack、未部署或切流量

重新申请验收的前置：

1. PR #919 合入 `main`
2. 重新 `git fetch origin`，candidate 精确等于最新 `origin/main`
3. `delivery_ledger_owner` 在主干上处理 RELEASE_RECORD Latest cutover
4. 不得事后补发代表既有发布历史的 provenance tag
5. 重跑 P15 preflight / convergence CLI

在此之前，生产构建、发布、重启、灰度、流量切换及开 gate 仍全部禁止。

---

## 8. 2026-09-03 复检结论

**仍不能签收，继续保持 No-Go。** 本轮没有新的可签收实现。

复检现场：

| 项             | 证据                                                                               |
| -------------- | ---------------------------------------------------------------------------------- |
| P15 checkbox   | 仍为 `[ ]`                                                                         |
| 最新保留提交   | `6d0f004899`（tasks）/ `d028fc955e`（DDOC）只记录验收 hold，不是主干收敛           |
| PR #919        | `state=OPEN` `mergedAt=null` `reviewDecision=REVIEW_REQUIRED`；无“已合入 main”证据 |
| candidate      | `d028fc955e` ≠ `origin/main` `769da88d21`（ancestry 通过，但不得进入独立批准）     |
| LIVE / ledger  | 一致                                                                               |
| RELEASE_RECORD | 仍落后                                                                             |
| provenance     | 仍缺失；未发布补发 tag                                                             |
| 生产边界       | 四门 gate、live pack、真实聊天、自动修复、流量切换仍关闭                           |

下一步仍只能是：完成 PR 合并 → `git fetch origin` → candidate 精确等于最新 `origin/main` → 重跑 preflight。在此之前不得进入独立批准或任何生产部署步骤。
