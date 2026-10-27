# Wave 3 — 权威环境变量表（Production）

> **裁定日期**：2026-07-12  
> **规则**：**生产配置只写 Primary（`OPENBOT_*`）**；`OPENCLAW_*` / 历史 `CLAWDBOT_*` 仅作运行时兼容 alias，不得出现在新 staging/prod 编排里。  
> **镜像/脚本**：`docker-setup.sh` 会双向镜像 OPENBOT↔OPENCLAW，但 **权威文档与 YAML 只认 OPENBOT\_**。

---

## 1. 裁定摘要

| 决策                              | 内容                                                        |
| --------------------------------- | ----------------------------------------------------------- |
| Primary 前缀                      | `OPENBOT_`                                                  |
| Deprecated alias                  | `OPENCLAW_*`（兼容）、`CLAWDBOT_*`（更旧）                  |
| 生产 YAML / systemd / fly secrets | **仅 Primary**                                              |
| 本地开发                          | 可用 alias；建议逐步改 Primary                              |
| 扫描刷新                          | `./deploy/production/scripts/scan-env-authority.sh`（可选） |

---

## 2. 核心生产变量（必读）

| Primary                             | Alias（兼容）                        | 必填             | 说明                                                                                                            |
| ----------------------------------- | ------------------------------------ | ---------------- | --------------------------------------------------------------------------------------------------------------- |
| `OPENBOT_GATEWAY_TOKEN`             | `OPENCLAW_GATEWAY_TOKEN`             | 条件\*           | 网关 token；CLI/token 面；trusted-proxy 浏览器路径可另有会话                                                    |
| `OPENBOT_GATEWAY_PASSWORD`          | `OPENCLAW_GATEWAY_PASSWORD`          | 否               | 密码模式 auth                                                                                                   |
| `OPENBOT_GATEWAY_PORT`              | `OPENCLAW_GATEWAY_PORT`              | 否               | 默认 18789                                                                                                      |
| `OPENBOT_STATE_DIR`                 | `OPENCLAW_STATE_DIR`                 | 建议             | 状态根（容器内常 `/home/node/.openclaw` 或 `/data`）                                                            |
| `OPENBOT_CONFIG_PATH`               | `OPENCLAW_CONFIG_PATH`               | 否               | 配置文件绝对路径                                                                                                |
| `OPENBOT_CONFIG_DIR`                | `OPENCLAW_CONFIG_DIR`                | compose          | 宿主机配置目录挂载源                                                                                            |
| `OPENBOT_WORKSPACE_DIR`             | `OPENCLAW_WORKSPACE_DIR`             | compose          | 工作区挂载                                                                                                      |
| `OPENBOT_HOME`                      | `OPENCLAW_HOME`                      | 否               | home 覆盖                                                                                                       |
| `OPENBOT_PUBLIC_APP_BASE_URL`       | `OPENCLAW_PUBLIC_APP_BASE_URL`       | **公网必填**     | 平台登录公开 URL（如 `https://admin...`）                                                                       |
| `OPENBOT_PUBLIC_WEB_BASE_URL`       | `OPENCLAW_PUBLIC_WEB_BASE_URL`       | 否               | Web 入口                                                                                                        |
| `OPENBOT_PUBLIC_BASE_URL`           | `OPENCLAW_PUBLIC_BASE_URL`           | 否               | 通用公开基址                                                                                                    |
| `OPENBOT_DATA_MODE`                 | `OPENCLAW_DATA_MODE`                 | SaaS             | `managed` \| `local`（亦可写配置 `data.mode`）                                                                  |
| `OPENBOT_DATA_ROOT`                 | `OPENCLAW_DATA_ROOT`                 | 否               | Data Space 根                                                                                                   |
| `OPENBOT_SECURITY_PROFILE`          | `OPENCLAW_SECURITY_PROFILE`          | **SaaS 必填**    | `personal_local` \| `managed_enterprise`；服务端选定，客户端不可覆盖；未设时由 `data.mode` 推导                 |
| `OPENBOT_TENANT_EXECUTION_BOUNDARY` | `OPENCLAW_TENANT_EXECUTION_BOUNDARY` | **Managed 必填** | Managed Enterprise 生产必须为 `dedicated`（共享进程 I3 未证明前启动拒绝 `shared_process`）                      |
| `OPENBOT_TENANTS_ROOT`              | —                                    | SaaS             | 租户卷根（如 `/data/tenants`）；Managed + dedicated 边界必填                                                    |
| `OPENBOT_SHARED_BROWSER_ROOT`       | —                                    | **禁止 Managed** | 一旦设置，Managed Enterprise 启动失败（要求租户级浏览器状态）                                                   |
| `OPENBOT_SHARED_CREDENTIAL_ROOT`    | —                                    | **禁止 Managed** | 一旦设置，Managed Enterprise 启动失败（要求租户级凭证根）                                                       |
| `OPENBOT_SHARED_QUEUE_OR_CACHE`     | —                                    | **禁止 Managed** | `1`/`true` 时 Managed Enterprise 启动失败                                                                       |
| `OPENBOT_PLUGIN_TENANT_ACCESS`      | —                                    | SaaS             | `restricted`（默认）\| `unrestricted`（Managed 拒绝）                                                           |
| `OPENBOT_MULTITENANT`               | —                                    | **B4 灰度**      | `1`/`true` 开启逻辑多租户寻址（需 `DATA_MODE=managed`）；现网 cutover 后默认 **勿开** 直至 P1–P4 验证完毕       |
| `OPENBOT_PROGRESS_LEDGER_ENABLED`   | —                                    | **Ledger 灰度**  | `1`/`true`/`yes`/`on` 开启长程 Cron 进度账本；默认关。只在 staging / 单租户打开，生产等 `rollout.md` 签字后再开 |
| `OPENBOT_IMAGE`                     | `OPENCLAW_IMAGE`                     | compose          | 镜像名，如 `openbot:rc`                                                                                         |
| `OPENBOT_IMAGE_INSTALL`             | `OPENCLAW_IMAGE_INSTALL`             | **OCI 必填**     | `1` 表示容器镜像部署；Gateway 跳过 npm-global 更新横幅（避免 `1.0.x` vs `2026.x.x` 误判）                       |
| `OPENBOT_BUNDLED_VERSION`           | `OPENCLAW_BUNDLED_VERSION`           | 否               | 运行时版本覆盖；Dockerfile 由 `OPENBOT_VERSION` build-arg 注入，须与 `package.json` 日历版本一致                |
| `OPENBOT_ALLOW_INSECURE_PRIVATE_WS` | `OPENCLAW_ALLOW_INSECURE_PRIVATE_WS` | **禁止生产**     | 私网 ws 破窗；默认勿设                                                                                          |
| `NODE_ENV`                          | —                                    | 是               | `production`                                                                                                    |
| `NODE_OPTIONS`                      | —                                    | 建议             | 如 `--max-old-space-size=1536`                                                                                  |

\* trusted-proxy 浏览器登录不依赖 token 时，token 仍建议给运维 CLI 使用。

---

## 3. 密钥与商业（按需）

| Primary                                                              | 类别           | 备注                                                       |
| -------------------------------------------------------------------- | -------------- | ---------------------------------------------------------- |
| `OPENBOT_SMTP_HOST` / `PORT` / `USER` / `PASS` / `FROM` / `STARTTLS` | 邮件           | 平台邮件 / operational identity                            |
| `OPENBOT_SECRET_MASTER_KEY`                                          | 加密           | 密钥派生；勿入库                                           |
| `OPENBOT_ENTERPRISE_DATA_VAULT_KEY`                                  | 企业数据保险库 | 或 `*_KEY_REF`                                             |
| `OPENBOT_ENTERPRISE_DATA_VAULT_KEY_REF`                              | 引用           | 外部密钥引用                                               |
| `OPENBOT_COMMERCE_STRIPE_*` / `OPENBOT_COMMERCE_ALIPAY_*`            | 支付           | 仅启用商务时                                               |
| `OPENBOT_USER_OPERATIONAL_IDENTITY_GITHUB_*`                         | OAuth          | GitHub 运营身份                                            |
| `OPENBOT_USER_OPERATIONAL_IDENTITY_X_TWITTER_*`                      | OAuth          | X（Twitter）个人运营身份；见 `x-twitter-oauth.env.example` |
| `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `GEMINI_API_KEY` …          | 模型           | **无 OPENBOT 前缀**；沿用厂商惯例                          |
| `TELEGRAM_BOT_TOKEN` / `DISCORD_BOT_TOKEN` / …                       | 通道           | 无 OPENBOT 前缀                                            |

通道与模型密钥：**Primary = 厂商/生态惯用名**（非 OPENBOT\_），不在此表强制改名。

---

## 4. 明确禁止出现在生产编排的值

| 模式                                                                          | 原因                                                    |
| ----------------------------------------------------------------------------- | ------------------------------------------------------- |
| 仅设 `OPENCLAW_*` 不设 `OPENBOT_*`                                            | 易在镜像/文档切换时静默失效                             |
| `OPENBOT_ALLOW_INSECURE_PRIVATE_WS=1`                                         | 扩大攻击面                                              |
| 明文 token 写进 git / 镜像层                                                  | 泄漏                                                    |
| `OPENBOT_MULTITENANT=1` 在 B4 门禁前                                          | 共享隔离未完成                                          |
| Managed 未设 `OPENBOT_TENANT_EXECUTION_BOUNDARY=dedicated`                    | Gate 0 启动拒绝；不得静默按 Personal Local 信任模型运行 |
| Managed 设置 `OPENBOT_SHARED_BROWSER_ROOT` / `OPENBOT_SHARED_CREDENTIAL_ROOT` | 跨租户状态共享；Gate 0 启动拒绝                         |
| 生产使用 `--allow-unconfigured`                                               | Wave 1 已禁止                                           |

---

## 5. 配置文件 vs 环境变量

| 能力                                                | 优先                          | 环境变量兜底            |
| --------------------------------------------------- | ----------------------------- | ----------------------- |
| `gateway.mode` / `bind` / `auth` / `allowedOrigins` | **配置 JSON**                 | token/password 可用 env |
| `data.mode`                                         | 配置或 `OPENBOT_DATA_MODE`    | 两者都可                |
| 公开登录基址                                        | `OPENBOT_PUBLIC_APP_BASE_URL` | 必须与 nginx 域名一致   |
| 模型/通道密钥                                       | env 或密钥管理                | 勿写进镜像              |

权威配置骨架：

- `deploy/production/openbot.production.example.json5`
- `deploy/production/proxy/gateway.trusted-proxy.example.json5`

---

## 6. Staging 最小集合（复制即用）

见 `env.staging.example`（同目录）。生产完整见 `env.production.example`。

```bash
# 生成 token
openssl rand -hex 32
```

---

## 7. 兼容层说明（给排障）

运行时多处读取顺序类似：

```text
OPENBOT_*  →  OPENCLAW_*  →  (偶尔) CLAWDBOT_*
```

`docker-setup.sh` 的 `openbot_mirror_env` 会在启动前补齐对称变量。  
**排障时**：同时 `env | grep -E 'OPENBOT_|OPENCLAW_'`，确认 Primary 非空。

---

## 8. 验收（Wave 3 DoD）

- [ ] staging/prod compose 或 systemd **仅出现 OPENBOT\_ Primary**
- [ ] `env-authority-matrix.md` 与 `env.production.example` 一致
- [ ] 文档中新示例不再单独推广 `OPENCLAW_GATEWAY_TOKEN` 作为首选
- [ ] 运维签字：本表为唯一生产 env 权威
