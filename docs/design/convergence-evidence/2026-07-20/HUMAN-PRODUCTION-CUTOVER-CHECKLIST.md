# 人类维护者：生产 Cutover 检查清单

**状态：** 清单 only — **默认不执行**  
**关联 tip：** `9aceda7349da2190e00bb2fbb029175a517ecde7`（RC0 推荐）  
**生产回滚锚点：** `85eee3e7b987b14b3f83301e3f200b3e1d797cc6` / 镜像 `openbot:rc-amd64-v69`  
**代理 agent 不得在未获书面 `PRODUCTION_GO=YES` 时执行本清单中的变更步骤。**

---

## 0. 前置（全部勾选才能继续）

- [ ] RC0-PREP PASS
- [ ] Staging：**SUCCESS**（真主机）或维护者书面接受 **PARTIAL** 本地 sim 风险
- [ ] 书面 `PRODUCTION_GO=YES`（日期、签字人）
- [ ] wecom waiver 未过期（当前至 **2026-08-20**）或生产接受扩大失败面的新 waiver
- [ ] 变更窗口与回滚人已指定

---

## 1. 制品

- [ ] 确认制品 SHA = `9aceda7349…`（`node openbot.mjs --version` / OCI label）
- [ ] 镜像 digest 记入 RELEASE_RECORD
- [ ] **不要** 用 convergence 分支脏 tip（monthly-usage UI 污染段）

建议 tag：`openbot:rc-convergence-20260720` → 生产可再打 `rc-amd64-vNN`

---

## 2. 备份

- [ ] 控制面 / 配置：`~/.openbot` 或主机等价目录快照
- [ ] 知识/记忆/租户数据（若与网关同机）
- [ ] 当前容器/compose 配置导出
- [ ] 回滚镜像仍可 `docker pull/load`：`rc-amd64-v69`

---

## 3. 灰度

- [ ] 先内部租户或只读流量
- [ ] 观察：healthz、readyz（failing ⊆ `{wecom}`）、错误率、队列、定时任务
- [ ] 登录 → roster → chat.history
- [ ] localFolder 导入抽样（若该租户启用）

---

## 4. Cutover

- [ ] 停旧容器（或蓝绿切换）
- [ ] 起新容器（**保留**生产容器命名约定若需要，但镜像为新 digest）
- [ ] 域名/nginx 指向确认
- [ ] smoke：`deploy/production/proxy/smoke.sh` 或等价

---

## 5. 记录

- [ ] 更新 `deploy/production/RELEASE_RECORD.md`：SHA、digest、测试、waiver、rollback
- [ ] 通知相关 owner
- [ ] 若 24h 内 hotfix：回灌 `convergence` / canonical 分支策略

---

## 6. 中止条件

出现任一项 → **立即回滚** 到 v69：

- healthz 非 200
- readyz 失败面 **超出** `{wecom}`
- 登录大面积失败
- chat/session 数据明显 split-brain 复发

回滚步骤见 staging 证据 `staging/rollback.md` 与生产既有 runbook。

---

## 签字

| 角色                     | 姓名 | 日期 | 签名 |
| ------------------------ | ---- | ---- | ---- |
| Maintainer PRODUCTION_GO |      |      |      |
| Release executor         |      |      |      |
| Rollback owner           |      |      |      |
