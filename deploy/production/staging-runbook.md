# Staging 安装 + 冒烟 Runbook（Wave 1–3）

> 在 **staging 主机** 上执行。本机可用 `scripts/staging-local-sim.sh` 做近似演练。  
> RC 工作树：`release/candidate-20260712` · 镜像：`openbot:rc`

---

## 0. 前置

| 项   | 要求                                                               |
| ---- | ------------------------------------------------------------------ |
| 机器 | Linux x86_64/arm64，能跑 Docker 或 openbot 二进制                  |
| DNS  | 至少一个：`admin.staging.<domain>` → 该机（或 LB→该机）            |
| 端口 | 公网 80/443；**18789 不对公网开放**                                |
| 产物 | `openbot:rc` 镜像 **或** 从 RC 源码 `docker build -t openbot:rc .` |
| 权限 | 可 sudo 装 nginx / 写 `/var/lib/openbot`                           |

将本仓库 `deploy/production` 拷到服务器，例如：

```bash
# 从开发机
rsync -a deploy/production/ user@STAGING_HOST:~/openbot-production/
# 或 git clone RC 分支后仅用 deploy/production
```

---

## 1. 环境变量（Wave 3）

```bash
sudo mkdir -p /var/lib/openbot/staging/{state,workspace}
cd ~/openbot-production   # 或仓库内 deploy/production

cp env.staging.example /var/lib/openbot/staging/.env
# 编辑：
#   OPENBOT_GATEWAY_TOKEN=$(openssl rand -hex 32)
#   OPENBOT_PUBLIC_APP_BASE_URL=https://admin.staging.YOUR_DOMAIN
#   OPENBOT_IMAGE=openbot:rc
#   OPENBOT_CONFIG_DIR=/var/lib/openbot/staging/state
#   OPENBOT_WORKSPACE_DIR=/var/lib/openbot/staging/workspace

# 权威表：env-authority-matrix.md — 禁止只写 OPENCLAW_*
```

加载：

```bash
set -a
source /var/lib/openbot/staging/.env
set +a
```

---

## 2. Gateway 配置（Wave 1+2）

```bash
# 以 trusted-proxy 多域骨架为底
cp proxy/gateway.trusted-proxy.example.json5 \
  /var/lib/openbot/staging/state/openclaw.json

# 将 allowedOrigins 改成 staging 真实 HTTPS 源，例如仅：
#   "https://admin.staging.YOUR_DOMAIN"
# 若暂无 HTTP 内网调试，origins 也必须与浏览器地址栏一致。
```

最小必改字段：

- `gateway.controlUi.allowedOrigins`
- `gateway.auth.mode: "trusted-proxy"` + `platformAuth.enabled: true`
- `gateway.bind: "loopback"`
- `gateway.mode: "local"`
- `data.mode: "managed"`（SaaS staging）
- `logging.redactSensitive: "all"`（**日志聚合外送前必须经 redact**：任何把 gateway/channel
  日志送往集中聚合（Loki/ELK/云日志）的部署，必须先确认此档位为 `"all"`，
  启动日志中 `log redaction: logging.redactSensitive=all` 为准）

---

## 3. 启动 Gateway

### 3A. Docker（推荐，对齐 RC 镜像）

```bash
# 若镜像在开发机构建：
#   docker save openbot:rc | ssh user@STAGING docker load
# 或在 staging 上从 RC 源码 docker build -t openbot:rc .

cd ~/openbot-production
export $(grep -v '^#' /var/lib/openbot/staging/.env | xargs)

docker compose -f docker-compose.prod.yml --env-file /var/lib/openbot/staging/.env up -d

# 若 nginx 在同一台机，需要 loopback 映射时取消 compose 内 ports 注释：
#   "127.0.0.1:18789:18789"
```

### 3B. 宿主机进程

```bash
export OPENBOT_PUBLIC_APP_BASE_URL  # 已 source
export OPENBOT_STATE_DIR=/var/lib/openbot/staging/state
# 配置文件需在 state 目录可被进程找到（openclaw.json）
openbot gateway run --bind loopback --port 18789
```

健康检查：

```bash
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:18789/healthz   # 200
```

---

## 4. 安装反代（Wave 2）

```bash
cd ~/openbot-production/proxy

# 若域名不是 openbot.love：先 sed 改 nginx/*.conf 的 server_name，
# 或从 vhost-cookie-native.conf.template 生成。

sudo ./install-nginx.sh
# 或手工 copy nginx/* 到 /etc/nginx/conf.d/

# TLS
sudo certbot --nginx -d admin.staging.YOUR_DOMAIN
# 多域时追加 -d biz... -d gw...

# 防火墙：见 proxy/firewall.md
sudo ufw deny 18789/tcp   # 示例；按发行版调整
sudo ufw allow 80,443/tcp
```

---

## 5. 冒烟（必须）

```bash
cd ~/openbot-production/proxy

# 仅本机 gateway
./smoke.sh --local-only

# 经公网/边缘域名
./smoke.sh --base-url https://admin.staging.YOUR_DOMAIN
```

期望：`FAIL=0`。若 edge 404 HTML → nginx 未反代 `/__openbot`；若 platform-auth 非 JSON → 检查 `platformAuth.enabled` 与 `OPENBOT_PUBLIC_APP_BASE_URL`。

完整清单：`smoke-checklist.md`。

---

## 6. 负向安全

```bash
# 从另一台机器（非 staging）：
curl -m 3 http://STAGING_PUBLIC_IP:18789/healthz
# 必须失败（超时/拒绝）。若 200 → 阻断上线。
```

---

## 7. 签字表

| 检查项                   | 结果 | 签字 |
| ------------------------ | ---- | ---- |
| env 仅 OPENBOT\_ Primary |      |      |
| healthz 200（loopback）  |      |      |
| smoke --local-only 绿    |      |      |
| smoke --base-url 绿      |      |      |
| :18789 公网不可达        |      |      |
| TLS 有效                 |      |      |
| B4 MULTITENANT 仍关闭    |      |      |
| 日志外送前 redact=all    |      |      |

---

## 8. 本机没有 staging 主机时

在开发机演练（不替代真实 staging 签字）：

```bash
cd /path/to/openbot-rc
./deploy/production/scripts/staging-local-sim.sh
```

该脚本用 `openbot:rc` + 临时配置起容器，并跑 `smoke.sh --local-only`。

---

## 9. Knowledge scheduled projection soak（残余风险 A）

在 B4 多租户 smoke 窗口内，验证 scheduled 企业知识投影会跨租户扫描并写 cursor。

### 9A. 开发机 / CI（无需 live gateway）

```bash
# simulate + inspect-selftest
pnpm soak:scheduled-projection:all
# 或
OPENBOT_SOAK_MODE=all bash deploy/production/scripts/staging-scheduled-projection-soak.sh

# 知识数据闭环回归包（golden-path + scheduled unit + soak all）
pnpm check:knowledge-data-closure
```

### 9B. Staging live inspect（cutover 签字）

前置：`OPENBOT_MULTITENANT=1`，各租户 `control-plane/enterprise-data.json` 含 enabled `scheduled` binding，gateway maintenance 至少 tick 一次。

```bash
OPENBOT_SOAK_MODE=inspect \
  OPENBOT_TENANTS_ROOT=/root/.openbot/tenants \
  OPENBOT_SCHEDULE_CURSOR_PATH=/root/.openbot/enterprise-knowledge-schedule-cursor.json \
  bash deploy/production/scripts/staging-scheduled-projection-soak.sh
```

通过标准：Summary `FAIL=0`；cursor 对多租户有 `tenantId::bindingId` 活动（success 或 failure-backoff）。勾选 `smoke-checklist.md` 中 inspect 项。

---

## Appendix — Live host (Plan A, 2026-07-12)

| Item              | Value                                   |
| ----------------- | --------------------------------------- |
| SSH               | `root@8.217.93.71`                      |
| Domains           | `*.openbot.love` (no `admin.staging.*`) |
| Deploy            | npm + systemd (not Docker RC yet)       |
| Pack path on host | `~/openbot-production/`                 |
| Assessment        | `HOST_ASSESSMENT-2026-07-12.md`         |

Smoke on host:

```bash
cd ~/openbot-production/proxy
./smoke.sh --local-only
./smoke.sh --base-url https://admin.openbot.love
```
