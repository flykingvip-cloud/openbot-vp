# 双租户浏览器冒烟 Runbook（共享 Gateway · MULTITENANT=1）

> **状态**：操作员清单（自动化无法完成登录）  
> **日期**：2026-07-13  
> **环境**：openbot.love 生产/预发 `openbot-gateway-rc`（`OPENBOT_MULTITENANT=1`）  
> **前置**：寻址探针 6/6、session 路径探针 6/6、proxy smoke 9/9 已绿（见 `deploy/production/smoke-checklist.md`）

## 入口域名（重要）

| 角色         | URL                            | 双租户验收？                     |
| ------------ | ------------------------------ | -------------------------------- |
| **企业端**   | **`https://biz.openbot.love`** | **是 — 主入口**                  |
| 平台管理端   | `https://admin.openbot.love`   | 否（平台运维，不是企业租户验收） |
| 官网         | `https://www.openbot.love`     | 否                               |
| 本机 gateway | `http://127.0.0.1:18789`       | 否（无生产双租户数据面）         |

---

## 1. 目标

证明**真人浏览器会话**下：

1. 租户 A 只能读写 `tenants/001/...`
2. 租户 B 只能读写 `tenants/workspace-2-87217301/...`
3. 交叉访问（换 cookie / 伪造 tenant hint）被拒绝或读不到对方数据

---

## 2. 账号映射（生产 platform-auth 快照）

| 角色         | 企业 ID                                  | 说明     | 示例 membership（email）                     |
| ------------ | ---------------------------------------- | -------- | -------------------------------------------- |
| **Tenant A** | `001`（upbeyond）                        | 主企业   | `daniel.*@…` 等 → `enterpriseId=001`         |
| **Tenant B** | `workspace-2-87217301`（蓝色空间工作室） | 第二企业 | `aihehe@coze.email` → `workspace-2-87217301` |

> 密码/MFA 不入库；由操作员使用真实凭证。勿在 ticket 中粘贴密码。

导入烟雾用户目录（已存在）：

```text
/root/.openbot/tenants/001/users/<uidA>/OpenBot/...
/root/.openbot/tenants/workspace-2-87217301/users/<uidB>/OpenBot/...
```

---

## 3. 步骤

### 3.0 确认 MT 开着

```bash
ssh root@HOST 'podman exec openbot-gateway-rc printenv OPENBOT_MULTITENANT'
# expect: 1
curl -sS -o /dev/null -w "%{http_code}\n" http://127.0.0.1:18789/healthz
```

### 3.1 Tenant A 登录

1. 浏览器打开 **`https://biz.openbot.love`**（企业端）。
2. 使用 **001** 成员账号登录（含 MFA 若要求）。
3. 进入企业资产 / 席位 / 知识等任一会写 L1 的页面。
4. 做一次**可见写操作**（例如备注、策略开关、无害配置保存）。
5. 主机验证：

```bash
# 最近 mtime 应在 tenants/001 下，而非 workspace-2
find /root/.openbot/tenants/001 -type f -mmin -30 | head
find /root/.openbot/tenants/workspace-2-87217301 -type f -mmin -30 | head
```

**通过标准**：A 操作后仅 `001` 树有新写；`workspace-2` 无对应写入。

### 3.2 Tenant B 登录（建议无痕窗口）

1. 无痕窗口打开 **同一企业端** `https://biz.openbot.love`（不要换成 admin/www）。
2. 使用 **workspace-2** 成员账号登录。
3. 重复一次无害写操作。
4. 再跑上面 `find`。

**通过标准**：B 只碰 `workspace-2-87217301`。

### 3.3 交叉否定（手工）

| #   | 动作                                                                     | 期望                                |
| --- | ------------------------------------------------------------------------ | ----------------------------------- |
| N1  | 登录 A 后，在 URL/请求中塞 `sessionTenantId=workspace-2-…`（若 UI 可改） | 失败或仍解析为 001（hint 不得越权） |
| N2  | 登录 A 后请求 B 的 seat/资源 ID（若可知）                                | 404 / deny，无 B 数据正文           |
| N3  | 两会话并排：A 会话列表不见 B 的 agent 会话标题/内容                      | 无串读                              |

自动化数据面已覆盖 path 隔离；本步确认 **RPC + 会话 cookie** 路径。

### 3.4 Channel（D9）

- **不要**在此窗口对 Telegram/Discord 等开多租户验收。
- 确认 channel 启动仍 skip 或单租户策略（生产曾 `OPENCLAW_SKIP_CHANNELS=1` 类开关）。

---

## 4. 勾选回写

完成后更新 `deploy/production/smoke-checklist.md`：

- [ ] Tenant A browser login + L1 write under `001`
- [ ] Tenant B browser login + L1 write under `workspace-2`
- [ ] Authenticated RPC cross-tenant negative

并在 `RELEASE_RECORD.md` 记：操作人、日期、是否保持 `MULTITENANT=1`。

---

## 5. 失败时

| 现象                                      | 处理                                          |
| ----------------------------------------- | --------------------------------------------- |
| 登录后仍写全局 `~/.openbot/*.json` 业务态 | 查寻址是否关、client 是否无 domain/membership |
| 两租户写到同一路径                        | **立刻** `OPENBOT_MULTITENANT=0` 重启，开事故 |
| MFA/SMTP 挡登录                           | 与多租户隔离无关；先恢复登录再测              |

回退：

```bash
# 见 staging-multitenant-cutover.sh 0
# 或编辑 /root/.openbot/.env.docker 去掉/改 MULTITENANT 后重建容器
```
