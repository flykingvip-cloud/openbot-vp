# P2.5 shadow-only — D 生产部署 + 密钥注入 发布操作者工单(seq 44)

> 类型:发布操作者工单(移交件 D)。**执行方:发布操作者(具备生产访问 + 密钥保管,≠ 实施 owner `kiro-conversation-task-runtime`)。**
> 授权来源:移交件 A `APPROVED — 有条件 GO`(`kiro-release-authority`),受 AC-A1..A6 约束。
> 关联:`./p2-5-production-readiness.md` §5/§7、`./p2-5-ac-a1-privacy-signoff-request.md`、`./p2-production-rollout.md` §1/§8、`./p2-5-production-integration.md` §9。
> **冻结顺序:B → A → D(本工单)→ C**(经生产部署前 CONDITIONAL 验收报告冻结)。
> 前置门禁(缺一即停):**① AC-A1 = CONDITIONAL** —— 方案 APPROVED,但注入 `OPENBOT_CT_SHADOW_HMAC_KEY` 前须闭合 **AC-cond-1..3**(见 `./p2-5-ac-a1-privacy-signoff-request.md`);**AC-cond-4 属启用后(C)观察验收,不是本工单前置**。**② 候选含 #728 且 forward-only。**

## 0. 现状与目标(关键)

- **shadow 代码已在生产但休眠**:LIVE `cf7ceb40a7`(seq 43,PR #748 平台鉴权 cutover)已包含 #728 —— shadow 代码已生产落位,但**未注入密钥、未开 flag/allowlist**,处安全休眠。
- **seq 43 ≠ CTR 密钥部署**:seq 43 证据未记录 `OPENBOT_CT_SHADOW_HMAC_KEY`/纪元/AC-cond 闭合,**不得追认**为 CTR D 阶段。CTR 密钥部署须**新建 seq 44**。
- **本工单目标(仅此)**:从**当刻干净 `origin/main` tip** forward-only 部署 + **注入 shadow HMAC key(AC-cond-1..3 前置)**,记 **seq 44**;shadow 仍**休眠**(allowlist 空 + flag OFF)。**不开 allowlist/flag(=C)、不 activation。**

## 1. 预门禁(发布当刻现场重跑,禁 dirty worktree/侧分支;**须在生产宿主机**)

```bash
git fetch origin
CANDIDATE_SHA=$(git rev-parse origin/main)
./deploy/production/scripts/verify-forward-only.sh --candidate "$CANDIDATE_SHA"   # verdict=allow;exit 20=回退/21=未知 LIVE(无 podman 的机器按设计返 21,须在生产宿主机重跑)
./deploy/production/scripts/verify-delivery-alignment.sh                          # L1/L2/L3: tag/origin/镜像/ledger/provenance
git merge-base --is-ancestor cf7ceb40a7 "$CANDIDATE_SHA" && echo "forward-only from LIVE"
git merge-base --is-ancestor 70e3320b96 "$CANDIDATE_SHA" && echo "候选含 #728"
```

## 2. 密钥注入(AC-cond-1..3 闭合后;密钥由密钥管理下发,勿入 repo/config/日志)

```
OPENBOT_CT_SHADOW_HMAC_KEY=<强随机 root secret>     # 缺失即 fail-closed 不写(休眠)
OPENBOT_CT_SHADOW_HMAC_KEY_ID=<密钥纪元标识,必设并记录>
```

注入前必须满足(逐条记入 §4 seq-44 证据):

- **AC-cond-1**:root ≥ 256-bit CSPRNG、经密钥管理下发;**绝不**入 repo/config/日志/ledger(seq 44 只记 "key set",不记值)。
- **AC-cond-2**:每环境独立 root(prod ≠ staging/dev),不复用。
- **AC-cond-3**:设并记录 `OPENBOT_CT_SHADOW_HMAC_KEY_ID`;轮转 ≤ 90d(对齐 `HMAC_KEY_MAX_AGE_MS`)= 幂等纪元重置。

## 3. 构建 + 部署(container recreate)

- 从**新鲜、干净的 `origin/main` tip** 构建镜像(git archive / clean checkout;**不得 dirty**——共享工作树含 `src/conversation-task/**` 删除态,绝不可作构建/部署输入)。
- **全量 recreate 容器**(env.list 加入上述 key)→ `healthz` 200 / `readyz` ready:true 验活 → 保留回滚容器/tarball。
- **确认 shadow 休眠 + 密钥存在但不输出值**:allowlist 空、`detection`/`qualification` flag OFF(默认即是);env 中 key 已设,但日志/证据**不打印其值**。

## 4. 记录发布(seq 44)

追加 `deploy/production/releases.jsonl`(**seq 44**)+ 更新 `deploy/production/RELEASE_RECORD.md` + 打注解 tag `provenance/sha-<short>`:

```json
{
  "seq": 44,
  "gatewaySha": "<CANDIDATE_SHA>",
  "uiSha": "<CANDIDATE_SHA>",
  "imageTag": "rc-amd64-provenance-<short>",
  "imageDigest": "sha256:<...>",
  "tag": "provenance/sha-<short>",
  "liveFrom": "<UTC>",
  "evidence": "build-info.commit=<CANDIDATE_SHA>; healthz 200; readyz ready:true; OPENBOT_CT_SHADOW_HMAC_KEY set(值不记录); OPENBOT_CT_SHADOW_HMAC_KEY_ID=<纪元>; shadow default-dormant(allowlist空+flag OFF); verify-forward-only=allow; verify-delivery-alignment PASS",
  "executor": "<release-operator>",
  "notes": "CTR P2.5 D:forward-only cf7ceb40a7 -> <CANDIDATE_SHA>,注入 shadow HMAC key(AC-cond-1..3 闭合);shadow 休眠,未开 allowlist/flag/activation。回滚:prev 容器/tarball。"
}
```

**seq-44 证据必录项(AC-cond-1..3,缺任一即未闭合、不得注入 / 验收不过):**

- [ ] **AC-cond-1**:root 来自密钥管理、≥ 256-bit;evidence 仅写 `OPENBOT_CT_SHADOW_HMAC_KEY set(值不记录)`,ledger/日志不含密钥值。
- [ ] **AC-cond-2**:本环境 root 独立于 staging/其他环境(不复用)。
- [ ] **AC-cond-3**:记录 `OPENBOT_CT_SHADOW_HMAC_KEY_ID=<纪元>` + 轮转 ≤ 90d 策略。
- （**AC-cond-4 不在此**:属 C 启用后脱敏观察验收,见 §7。）

- cutover 后:`pnpm delivery:merge-back-plan -- --cutover-sha <CANDIDATE_SHA>` → `pnpm delivery:check-sot -- --use-release-record-live` 通过。

## 5. 回滚(即时)

- 切回 seq 43 容器(`cf7ceb40a7`,shadow 代码仍在但无 key = 休眠)或 before-tarball。
- 注:shadow 运行期回滚(清 allowlist + flag OFF,TTL ≤ 3s、无需重新部署)属 C 的职责,非本工单。

## 6. 边界(AC-A6)

仅部署 + 注入密钥使 shadow **休眠**就绪。**不**开 allowlist/flag(C)、**不** activation/projection/authorization、不建 Task、不写 Ledger、不改 `chat.send`。`production rollout (to activation) = NOT APPROVED` 维持。

## 7. 完成后交接(C)

D 完成(seq 44 记录 + 验活 + AC-cond-1..3 已录)后 → 交**运维**执行 **C**:① 先保持 allowlist 空 / flag OFF,确认 key 存在但不输出值;② 仅开**内部测试租户** allowlist + `detection`/`qualification` flag(activation/projection/authorization 继续 OFF);③ **AC-cond-4 启用后脱敏抽验**(告警/指标 payload 与标签仅含 keyId/HMAC/reason-code,零明文 id/原文;失败即清 allowlist + detection/qualification OFF);④ 观察窗达标 → 附回执(actor/时间/内部租户/flag/HMAC-only 指标)送**最终 P2.5 生产验收**。
