# Cursor 任务指令：Phase STAGING-HOST — 真实 Staging 主机部署（全量 SUCCESS）

把下面整段复制给 **Cursor Agent**。  
本 brief：`.kiro/specs/repository-wide-branch-convergence/CURSOR-PHASE-STAGING-HOST-BRIEF.md`

**前置：**

| 项               | 状态                                                                          |
| ---------------- | ----------------------------------------------------------------------------- |
| RC0-PREP         | PASS · `RECOMMENDED_RC0_TIP=9aceda7349…`                                      |
| Staging 本地 sim | PASS / **PARTIAL**（`STAGING_ENV=MISSING`）                                   |
| 本地镜像         | `openbot:rc-convergence-20260720` @ tip `9aceda7349`（若无则按本 brief 重建） |
| **Production**   | **仍 NO_GO**                                                                  |

**必读：**

- `docs/design/convergence-evidence/2026-07-20/staging/STAGING-HANDOFF.md`（PARTIAL）
- `…/staging/image.md` · `deploy-log.md` · `rollback.md`
- `…/rc0-prep/RC0-PREP-HANDOFF.md`
- `deploy/production/staging-runbook.md`（共享树只读）
- 上一 brief：`CURSOR-PHASE-STAGING-DEPLOY-BRIEF.md`

**启动前提（缺一则 STOP 并写 BLOCKED）：**

维护者必须提供 **隔离 staging 环境**，且 **不是** 生产 `8.217.93.71` / `openbot-gateway-rc` / 生产域名：

```text
STAGING_SSH=user@staging-host   # 或等价
STAGING_BASE_URL=https://admin.staging.<domain>   # 或 http://staging-ip:port
# 可选
STAGING_GATEWAY_URL=...
STAGING_STATE_DIR=/var/lib/openbot/staging   # 禁止 /root/.openbot 生产路径
```

若会话中未给出上述信息 → **不要** 猜测生产主机当 staging；在 `staging-host/BLOCKED.md` 写清缺什么并退出（仍可 PASS 为 `BLOCKED_NO_HOST` 文档波，但不得改生产）。

---

## 角色

| 字段      | 值                                                                         |
| --------- | -------------------------------------------------------------------------- |
| **Task**  | `repository-wide-branch-convergence`                                       |
| **Agent** | `cursor-convergence-staging-host`                                          |
| **允许**  | 向 **明确的 staging** 主机 load 镜像、起容器、跑 smoke、写证据             |
| **禁止**  | 生产 cutover；覆盖 `rc-amd64-v69`；容器名 `openbot-gateway-rc`；未授权主机 |

```text
TIP=9aceda7349da2190e00bb2fbb029175a517ecde7
IMAGE_TAG=openbot:rc-convergence-20260720
PROD_HOST_HINT=8.217.93.71          # NEVER deploy here as "staging" without explicit isolation plan
PROD_CONTAINER=openbot-gateway-rc   # NEVER touch
```

---

## 硬禁令

1. **禁止** SSH/部署到已知生产主机，除非维护者 **书面** 声明该主机已隔离为 staging 且容器/路径/域名均非生产。
2. **禁止** `PRODUCTION_GO=YES`。
3. 制品 SHA 必须为 **TIP**；不得用 convergence 脏 tip。
4. readyz 失败面 ⊆ `{wecom}` 或 empty；扩大则 **STOP**。
5. Trailers：
   ```text
   Task: repository-wide-branch-convergence
   Agent: cursor-convergence-staging-host
   ```

---

## 目标

把本地 PARTIAL 升级为 **真实 staging SUCCESS**（或诚实 BLOCKED）。

1. 确认/重建 `IMAGE_TAG` @ `TIP`
2. 传输到 staging 主机并启动（独立 state/容器名）
3. 对 **STAGING_BASE_URL** 跑完整 smoke（含尽量真实的登录与 API）
4. 写 `staging-host/` 证据

---

## Smoke（全量 SUCCESS 必须）

| #   | 检查                  | 期望                                                                     |
| --- | --------------------- | ------------------------------------------------------------------------ |
| 1   | healthz               | 200 live                                                                 |
| 2   | readyz                | ready true **或** 仅 wecom                                               |
| 3   | 登录                  | 真实 staging 账号/token 流程成功（非仅 PLATFORM_AUTH_DISABLED 文档糊弄） |
| 4   | chat.history          | **live** RPC/HTTP 非 5xx（需 token）                                     |
| 5   | knowledge localFolder | 至少 K1 或 K2 在 staging 配置下可验证（API 或受控脚本）                  |
| 6   | 回滚演练记录          | 停 staging 容器 / 切回上一镜像的步骤已执行或 dry-run 有日志              |

若维护者无法提供登录凭据：smoke 3–5 标 **BLOCKED_AUTH**，整体 **PARTIAL**，不得写 SUCCESS。

---

## 交付物

```text
docs/design/convergence-evidence/2026-07-20/staging-host/
  env.md                 # STAGING_SSH / URLs / 证明非生产
  image.md               # digest、TIP、load 方式
  deploy-log.md
  smoke.md
  readyz.md              # 完整 JSON
  rollback.md
  isolation-proof.md     # 容器名、端口、state 路径 vs 生产对照表
  STAGING-HOST-HANDOFF.md
```

把报告 commit 到 **convergence 分支**（与既有 evidence 同树）：

```bash
# 在 openbot-convergence
git add docs/design/convergence-evidence/2026-07-20/staging-host
git commit -m "$(cat <<'EOF'
docs(convergence): real staging-host deploy evidence for tip 9aceda7349

Task: repository-wide-branch-convergence
Agent: cursor-convergence-staging-host
EOF
)"
```

---

## 推荐部署步骤（可按 runbook 调整）

### 1) 镜像

```bash
# 构建机已有则跳过 build
docker images openbot:rc-convergence-20260720
# 传到 staging（示例）
docker save openbot:rc-convergence-20260720 | ssh "$STAGING_SSH" docker load
```

### 2) 运行（示例 — 改名改路径）

```bash
# ON STAGING HOST — names MUST differ from production
docker rm -f openbot-gateway-staging-rc0 || true
docker run -d --name openbot-gateway-staging-rc0 \
  -v /var/lib/openbot/staging:/home/node/.openbot \
  -p 127.0.0.1:18789:18789 \
  -e OPENBOT_GATEWAY_TOKEN=... \
  openbot:rc-convergence-20260720 \
  node dist/index.js gateway --port 18789
```

经 nginx 暴露 **staging 域名 only**。

### 3) Smoke

```bash
curl -sS "$STAGING_BASE_URL/healthz"
curl -sS "$STAGING_BASE_URL/readyz"
# login + history 按你们 platform-auth / token 文档
```

### 4) HANDOFF 字段

```text
STAGING_HOST_RESULT=SUCCESS|PARTIAL|FAILED|BLOCKED_NO_HOST|BLOCKED_AUTH
PRODUCTION_GO=NO
TIP=9aceda7349da2190e00bb2fbb029175a517ecde7
IMAGE_DIGEST=...
```

---

## 验收标准

| 结果                | 条件                                                         |
| ------------------- | ------------------------------------------------------------ |
| **SUCCESS**         | 真 staging 主机 + smoke 1–6 实质通过 + 隔离证明 + 无生产变更 |
| **PARTIAL**         | 主机有但 auth 不足；或仅部分 smoke                           |
| **BLOCKED_NO_HOST** | 维护者仍未提供隔离主机（诚实退出，不算乱部署）               |
| **FAIL**            | 动了生产；或用了错误 tip；或 readyz 失败面扩大却标 SUCCESS   |

---

## 一键开场

```text
本地 staging sim 已是 PARTIAL。请在有隔离 staging 主机时执行全量部署：

.kiro/specs/repository-wide-branch-convergence/CURSOR-PHASE-STAGING-HOST-BRIEF.md

必须使用 tip 9aceda7349da2190e00bb2fbb029175a517ecde7
镜像 openbot:rc-convergence-20260720（可重建）。
禁止部署到生产主机/容器。PRODUCTION_GO=NO。
产出 docs/.../staging-host/* 并 commit。

若维护者尚未提供 STAGING_SSH / STAGING_BASE_URL：写 BLOCKED_NO_HOST 并停止。

Task: repository-wide-branch-convergence
Agent: cursor-convergence-staging-host
```

---

## 维护者：生产 cutover（非 Cursor 默认任务）

真 staging SUCCESS 后，生产仅能由维护者执行，检查清单见：

`docs/design/convergence-evidence/2026-07-20/HUMAN-PRODUCTION-CUTOVER-CHECKLIST.md`

（若该文件尚无，由本任务 agent **只创建清单文档**、不执行 cutover——或由 grok/维护者另补。）
