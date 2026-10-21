# ConversationTask Runtime — P2.5 shadow-only 生产就绪与移交(production readiness)

> Owner(实施): `kiro-conversation-task-runtime` · Task: `conversation-task-runtime`
> 关联: `./p2-5-admission-package.md`(§5.1 AC1–AC7)、`./p2-5-production-integration.md`(§7 指标 / §7.4 P2.5 告警 / §9 即时回滚)、`./p2-production-rollout.md`(§1 forward-only 基线 / §8 历史门禁)、`./p2-rollback-drill.md`
> 状态: **移交件。P2.5 shadow-only 实现已合入 `main`(PR #728 合并提交 `70e3320b96`;网关生命周期接线 PR #739)。`main` 上 shadow 默认休眠(三重 fail-closed)。本文件仅为发布前门禁的移交清单,交由独立方执行;实施 owner 未审批、未部署、未开 flag、未下发生产密钥、未 cutover。** 四态:`P2 implementation = ACCEPTED` · `main landing = ACCEPTED` · `P2.5 shadow-only implementation = MERGED (#728)` · `production rollout = NOT APPROVED`。

## 0. 目的与边界

- **目的**:把"从已合入的休眠代码 → 正式云端生产部署/启用"之间**尚未完成的门禁**逐项列清,并指明每道门禁的**执行方(均 ≠ 实施 owner)**。
- **边界(持续生效)**:`activation` / `projection` / `authorization` 保持 **OFF** 且不可在本阶段开启;不创建正式 Task、不写 Progress Ledger、不接 Agent/Mission、不改 `chat.send` 内容/时序/错误语义、不发通知/真实副作用;UI 不得宣称已激活。生产灰度 / cutover / activation 属**另一轮独立生产发布审批**(准入包 §5.1 AC7),`production rollout = NOT APPROVED` 维持。

## 1. 现状与证据(已完成)

- **代码已合入 `main`**:PR #728(`70e3320b96`)+ PR #739(网关 `server.impl.ts` 生命周期接线)。
- **接线**:`src/auto-reply/reply/dispatch-from-config.ts` 单点被动 `observeInboundTurnShadow`(身份只取服务端);`src/gateway/server.impl.ts` 启动 `initShadowHookFromServerConfig` + 关停 `shutdownShadowHook`(有界 drain)。
- **默认休眠(三重 fail-closed)**:① detection/qualification flag 默认 OFF(持久配置源);② 租户 allowlist 默认空;③ HMAC 密钥 env `OPENBOT_CT_SHADOW_HMAC_KEY` 未设置 ⇒ `TenantHmacKeyProvider` 抛错(不写、不降级)。任一未满足 ⇒ 无观测、无写入,回复不受影响。
- **验证**:四维独立评审(gateway 集成 / 租户-ACL 安全 / 隐私-日志 / 运维-告警)CLOSED;设计 C1–C7 CLOSED(#715);CTR 全量测试 + 集成 #14/#15/#17/#1/#2 + 真实跨进程 全绿;oxlint 0、oxfmt PASS、`pnpm build` 通过且 **P2.5 未引入新的动态导入告警**(`main` 上既有的 `[INEFFECTIVE_DYNAMIC_IMPORT]` 均位于 `collaboration-learning`/`knowledge` 等无关模块,P2.5 shadow 代码零告警)。

## 2. 移交件 A —— 独立生产发布审批请求(执行方:发布审批人,决策 ≠ 实施 owner)

- **申请范围(仅此)**:shadow-only 金丝雀**观测**启用 —— 内部 allowlist 租户下计算 detection/qualification + 写 tenant-HMAC 影子日志 + 发射有界指标。
- **明确不申请**:activation / projection / authorization、创建 Task、写 Ledger、改 `chat.send`、通知/副作用、生产 cutover、P3。
- **风险面**:被动 fire-and-forget、不改回复、失败隔离于异步 runner;三重 fail-closed;即时热回滚(§4 第 5 步)。
- **决策产出**:批准 / 有条件批准 / 拒绝;批准须记录 **审批人 + 时间 + 候选 SHA**(见 `./p2-production-rollout.md` §8 解除阻断前置第 2 项)。

## 3. 移交件 B —— 独立生产部署前验收 复评指令(执行方:reviewer ≠ 实施 owner)

- **依据**:此前生产部署前验收结论(NOT PASS)收尾要求「P2.5 shadow PR 合入 `main` 后重做一次独立验收」。#728 已合入,应当重跑。
- **对象**:发布当刻 `git fetch` 后的 `origin/main` tip。
- **逐项复核**:① `dispatch-from-config.ts` 单点被动接线、身份只取服务端;② `server.impl.ts` `initShadowHookFromServerConfig`/`shutdownShadowHook` 生命周期 + fail-safe;③ 三重 fail-closed dormancy;④ 集成 #14/#15/#17/#1/#2 实跑 + 真实跨进程;⑤ `verify-forward-only.sh` + `verify-delivery-alignment.sh` 通过;⑥ 红线 activation/projection/authorization OFF、`chat.send` 未改。
- **产出**:PASS / CONDITIONAL / FAIL + 独立签署。**实施 owner 不得自证/自签。**

## 4. 移交件 C —— shadow 金丝雀启用清单(执行方:运维,**审批后**执行)

按序,每步可即时回滚:

1. **下发 HMAC 密钥**:生产 env `OPENBOT_CT_SHADOW_HMAC_KEY`(未设置即 fail-closed 不写)。密钥来源方案(单一 root secret 派生每租户密钥)须先经 `kiro-privacy-reviewer`(C5)确认。
2. **配置 allowlist**:仅内部测试租户,经服务端 admin API(`setTenantAllow`);默认空;客户端无写入入口。
3. **开 flag**:`detection` / `qualification` 经**持久热配置源**(非纯 env)开启,短 TTL(≤ 3s)+ 更新即 invalidate;`activation`/`projection`/`authorization` 保持 OFF。
4. **监控观察窗**:`./p2-5-production-integration.md` §7 三类指标合同 + §7.4 P2.5 告警(shadow persistence failure / HMAC failure(缺失/过期)/ tenant-scope rejection / queue drop / 延迟标注质量)。渠道/责任人/升级见该表。
5. **停止/回滚(§9)**:清 allowlist + flag off —— 运行时热生效、**无需重新部署**;P2.5 唯一自动响应链 = 清 allowlist → detection/qualification OFF(**区别于** activation force-off)。

- **红线**:allowlist 绝不与 activation 同开。

## 5. 移交件 D —— 交付流水线 cutover 门禁(执行方:发布操作者)

- **发布当刻**(`origin/main` 可能推进,必须现场重跑):

```bash
git fetch origin
CANDIDATE_SHA=$(git rev-parse origin/main)
./deploy/production/scripts/verify-forward-only.sh --candidate "$CANDIDATE_SHA"   # exit 20=候选回退, 21=未知 LIVE(均 fail-closed)
./deploy/production/scripts/verify-delivery-alignment.sh                          # L1/L2/L3: tag / origin / 镜像 / ledger / provenance
```

- 从**新鲜、干净的 `origin/main`** 构建(不得用 dirty worktree / 侧分支 / 未合并提交)。
- **记录发布**:`deploy/production/RELEASE_RECORD.md` + `https://github.com/flykingvip-cloud/harness-Benchmark-Engine/blob/main/deploy/production/releases.jsonl` + 注解 `provenance/sha-*` tag。
- **cutover 后**:`pnpm delivery:merge-back-plan -- --cutover-sha <live-sha>`,再 `pnpm delivery:check-sot -- --use-release-record-live` 通过。
- **注意**:required CI checks 尚未启用(runner 停滞)——发布方须知并据此判断门禁。

## 6. 明确不在本阶段范围(更远,需另行独立审批)

- `activation` / `projection` / `authorization`(真正创建任务)、Progress Ledger、Agent/Mission、生产 cutover 到 activation、P3 —— 全部维持 OFF/NOT APPROVED,属独立的生产发布审批。

## 7. 门禁顺序总览

技术证据先行、审批依据其上、**部署先于启用**。执行顺序 **B → A → D → C**(字母仅为移交件标号;经生产部署前验收 CONDITIONAL 报告冻结):

1. **B 独立生产部署前验收**(技术门禁,reviewer ≠ 实施者)→ 产出 PASS 技术证据。
2. **A 独立生产发布审批**(发布审批人 go/no-go)→ **依据 B 的 PASS 证据**做决策(非"先批后验")。
3. **D 生产 cutover + 密钥注入**(发布操作者)→ 当前 LIVE = **seq 45** / `21e1e8392f0ff5808563727eaa8f66e6ad9ed148`(非 seq 44);shadow 上线但**休眠**(allowlist 空 + flag OFF)。**不打开 C。**
4. **C 运维金丝雀启用 + 观察**(运维)→ 仅在 D 完成后:开内部测试租户 allowlist + `detection`/`qualification` flag;**AC-cond-4 启用后脱敏抽验**;失败即清 allowlist + detection/qualification OFF。

> **Gate C（本 PR / orch-shadow）≠ 上列第 4 步。** 本 grant 只批准 Orchestration Plane 的 `ORCH_SHADOW` **观察**（`routeStep` + reason codes；`LIVE_INVOKE` 仍 false）。**不要**把 §8 的 CTR `activation` / `projection` / `authorization` 勾选框勾上。CTR 金丝雀（detection/qualification + HMAC 影子日志）仍按 §8 独立清单，未因本 PR 放行。

任一门禁未过即停止;实施 owner 全程不审批、不部署、不开 flag、不下发生产密钥、不 cutover。

## 8. 放行 C 复验清单(验收门禁附录)

> 用途:D(seq 45 / `21e1e839`)已完成;独立验收方逐项核验;全绿方可放行 C(金丝雀启用)。**C 仍未打开。** 实施 owner 只核验工件证据、不放行生产。冻结顺序见 §7(B → A → D → C)。

- [ ] **文档门禁**:#753(CONDITIONAL 修订)已合入;`kiro-privacy-reviewer` 已复核确认 AC-cond 相位归类(cond-1..3 = 注入前置、cond-4 = 启用后)。
- [ ] **seq-45 LIVE 存在且正确**:`https://github.com/flykingvip-cloud/harness-Benchmark-Engine/blob/main/deploy/production/releases.jsonl` 有 `seq 45` / `21e1e8392f0ff5808563727eaa8f66e6ad9ed148`;`provenance/sha-21e1e8392f0f` 注解 tag 存在;`git merge-base --is-ancestor 70e3320b96 <seq45.gatewaySha>` 为真(LIVE 含 #728)。#796 同 SHA 账本重建不是新 LIVE pin。
- [ ] **seq 43 未被追认**:确认 seq 44 是 CTR 密钥部署,seq 43(`cf7ceb40a7`,PR #748)仍标记为非 CTR。
- [ ] **AC-cond-1..3 已记录**(注入前置):evidence 仅写 `OPENBOT_CT_SHADOW_HMAC_KEY set(值不记录)`(cond-1);本环境 root 独立于 staging/其他环境(cond-2);`OPENBOT_CT_SHADOW_HMAC_KEY_ID=<纪元>` + 轮转 ≤ 90d(cond-3)。ledger/日志无密钥明文值。
- [ ] **部署后休眠确认**:allowlist 空、`detection`/`qualification` flag OFF、`activation`/`projection`/`authorization` OFF;key 存在但不输出值;`chat.send` 无影响。
- [ ] **C 启用范围**:仅内部测试租户经 admin API(`setTenantAllow`)入 allowlist;开 `detection`/`qualification`;allowlist 绝不与 activation 同开。
- [ ] **AC-cond-4 启用后脱敏抽验**:§7.4 告警/指标 payload 与标签仅含 `keyId`/HMAC/reason-code,**零**明文 tenant/conversation/message id 或原文;失败即清 allowlist + `detection`/`qualification` OFF。
- [ ] **C 回执**:actor / 时间(UTC)/ 内部租户 / 已开 flag / HMAC-only 指标样本。
- [ ] **即时回滚可用**(§9):清 allowlist + flag OFF,TTL ≤ 3s、无需重新部署。

以上全绿 → 提交**最终 P2.5 生产验收**(独立方,≠ 实施 owner)。任一未闭合 → 不放行 C / 立即回滚。

## 9. Gate C 与本清单的关系（orch-shadow，不是 CTR activation）

本切片的 **Gate C** = Orchestration `ORCH_SHADOW` **观察**批准（host env later；source default 仍 OFF）。

| 项                                                | 本 PR                         | 仍 NOT APPROVED                                                                           |
| ------------------------------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------- |
| orch `shadowEnabled` 观察（`routeStep` + reason） | 内核已能打分；host 稍后开 env | 在 `feature.ts` 把 default 翻成 ON                                                        |
| orch `dispatch` / `node` / `browser`              | —                             | 全部 OFF                                                                                  |
| `ORCHESTRATION_LIVE_INVOKE`                       | 保持 `false`                  | 任何 invoke                                                                               |
| CTR `activation` / `projection` / `authorization` | —                             | 全部 OFF；**§8 勾选框保持未勾**                                                           |
| ledger / host cut                                 | —                             | #796 seq 46 ≠ 本次 cut；CTR 口头「seq 46」= 下一次前向 LIVE host cut；Aliyun nextSeq = 48 |

**不要**把本 grant 当成 CTR activation 放行，也**不要**勾 §8 的 activation 相关框。
