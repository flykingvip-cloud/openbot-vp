# seq 44 — CTR P2.5 shadow-only dormant cutover (ledger template / skeleton)

> **状态:模板/骨架,非最终记账。** 所有 `<FILL-FROM-LIVE>` 字段必须由**人工发布操作者**在真实 cutover 后从运行系统采集填入;在此之前**不得**把本行写进 `https://github.com/flykingvip-cloud/harness-Benchmark-Engine/blob/main/deploy/production/releases.jsonl`。本文件不含任何真实/编造的运行证据。
> 授权:移交件 A `APPROVED — 有条件 GO`(`kiro-release-authority`);AC-A1 = CONDITIONAL(方案 APPROVED,密钥注入受 AC-cond-1..3,PR #747)。
> 候选:`origin/main` = `76fea1fb0669357fa7ed8c4c882bc4588b614cab`(含 #728;forward-only 于 LIVE `cf7ceb40a7`;`verify-forward-only`=allow,已由独立方只读复核)。
> tag:`provenance/sha-76fea1fb0669` 已推送(触发 Docker Release)。

## 前置状态(填表前必须先解决)

- [ ] **GHCR 镜像可用**:`provenance/sha-76fea1fb0669` 的 Docker Release 目前 **failure**(CI runner 基础设施停滞,近期 `main` 与 `provenance/sha-cf7ceb40a7c4` 同样 failure)。→ `cutover-from-ghcr.sh stage` 在镜像发布前会失败。二选一:①修复 CI runner 后重跑 Docker Release 拿到镜像;②在具备资源的维护者环境构建镜像并加载到宿主机(3.5GB 宿主机裸构建会 OOM,需临时 swap)。
- [ ] **AC-cond-1..3 已闭合**并记入下方 evidence(root 来自密钥管理/≥256-bit/prod 独立;`OPENBOT_CT_SHADOW_HMAC_KEY_ID` 已设;轮转 ≤90d)。`ct-shadow.env`(`keylen=64`、`chmod 600`、不在 git)已在宿主机就位,但**未被任何容器加载**。

## https://github.com/flykingvip-cloud/harness-Benchmark-Engine/blob/main/deploy/production/releases.jsonl 追加行(填充后写入;prod 独立、值不记录)

```json
{
  "seq": 44,
  "gatewaySha": "76fea1fb0669357fa7ed8c4c882bc4588b614cab",
  "uiSha": "76fea1fb0669357fa7ed8c4c882bc4588b614cab",
  "imageTag": "<FILL-FROM-LIVE: rc-...-provenance-76fea1fb0669>",
  "imageDigest": "sha256:<FILL-FROM-LIVE: podman inspect --format {{.ImageDigest}}>",
  "tag": "provenance/sha-76fea1fb0669",
  "liveFrom": "<FILL-FROM-LIVE: 新容器 State.StartedAt UTC>",
  "evidence": "build-info.commit=76fea1fb0669...(<FILL-FROM-LIVE: podman exec openbot-gateway-rc cat /app/dist/build-info.json>); healthz 200; readyz ready:true; OPENBOT_CT_SHADOW_HMAC_KEY set(值不记录); OPENBOT_CT_SHADOW_HMAC_KEY_ID=<FILL: 纪元>; root 密钥管理/>=256-bit/prod独立; 轮转<=90d; 先前泄露候选值已作废未用; shadow default-dormant(allowlist空+flag OFF); verify-forward-only=allow; verify-delivery-alignment=<FILL: PASS/WARN 计数>",
  "executor": "<FILL: 发布操作者 id, != kiro-conversation-task-runtime>",
  "liveFrom_note": "同时给 seq 43 补 liveTo=本行 liveFrom"
}
```

## seq 43 收尾(同一 PR 内)

- [ ] 给 `https://github.com/flykingvip-cloud/harness-Benchmark-Engine/blob/main/deploy/production/releases.jsonl` 的 seq 43(`cf7ceb40a7`)补 `"liveTo":"<= seq44 liveFrom>"`。

## 采证命令(操作者在宿主机 / 经 SSH)

```bash
podman exec openbot-gateway-rc cat /app/dist/build-info.json | grep -o '"commit":"[^"]*"'   # == 76fea1fb0669...
curl -s -o /dev/null -w '%{http_code}\n' 127.0.0.1:18789/healthz                              # 200
curl -s 127.0.0.1:18789/readyz                                                                # ready:true
podman inspect --format '{{.ImageDigest}} {{.State.StartedAt}}' openbot-gateway-rc            # imageDigest + liveFrom
```

## RELEASE_RECORD.md

- [ ] 更新 "Latest cutover" 段:seq 44 / `76fea1fb0669` / shadow 休眠 / 回滚容器 `openbot-gateway-rc-prev-cf7ceb40a7`。

## cutover 后校验

```bash
pnpm delivery:merge-back-plan -- --cutover-sha 76fea1fb0669357fa7ed8c4c882bc4588b614cab
pnpm delivery:check-sot -- --use-release-record-live      # 须通过
```

## 边界(不变)

仅 shadow 休眠上线。不开 allowlist/flag(=移交件 C)、不 activation/projection/authorization、不建 Task/写 Ledger/改 chat.send。`production rollout (to activation) = NOT APPROVED`。executor ≠ 实施 owner;实施 owner 不自证/自签/自合。
