# 生产 P0 阻断项核实结论与按序整改计划

> **状态**：决策已锁定（2026-07-12）— 见 §0.1  
> **日期**：2026-07-12（修订：锁定共享 Gateway 首发）  
> **范围**：`openbot` 进入线上生产前必须关闭的关键阻断项  
> **前置报告**：架构/验收审查（会话内）  
> **关联**：
>
> - `docs/design/tenant-context-propagation-plan-2026-07-11.md`
> - `.kiro/specs/tenant-context-propagation/` ← **当前主路径，owner: kiro**
> - `docs/design/openbot-saas-tenant-data-architecture.md`
> - `docs/design/hybrid-gateway-isolation-future-plan-2026-07-11.md`（**dedicated 延后**，上线稳定后再做）
> - `SECURITY.md`
> - `deploy/admin-subdomain/README.md`
> - `docs/gateway/trusted-proxy-deployment-examples.md`

---

## 0.1 部署模型决策（已锁定）

| 决策                                | 结论                                               | 说明                                                                                |
| ----------------------------------- | -------------------------------------------------- | ----------------------------------------------------------------------------------- |
| **首发拓扑**                        | **多租户共享 Gateway**（逻辑隔离）                 | 一进程服务多企业；隔离靠 TenantContext + 寻址层 + 守卫                              |
| **当前执行方**                      | **kiro**                                           | spec `tenant-context-propagation`；loom `SAAS-TENANT-DATA` / `SAAS-TENANT-DATA-RPC` |
| **当前进度**                        | **P0 已合入**；P1–P4 未完成                        | 见 §1 B4；handler 尚未接线                                                          |
| **每企业独立 Gateway（dedicated）** | **上线稳定后再执行**                               | 不阻塞首发；对齐 hybrid 计划 parked；进程/容器物理隔离                              |
| **首发生产门禁**                    | **Wave 0–3 运维硬化 + Wave 4（B4）P1–P4 隔离闭环** | 缺 B4 不得宣称共享多租户生产就绪                                                    |

**与早期「路径 A/B」表述的关系**：历史文档中的「路径 A = 一租户一实例可先上」**不再作为首发策略**；dedicated 降为 **Wave 5 / 稳定后**。首发 = 原「路径 B」。

---

## 0. 执行原则

1. **先隔离正确、再公网暴露、并行可发布**：共享多租户下 **B4 是功能正确性与安全门禁**，不是可选项。
2. **kiro 主路径不抢戏**：Wave 4 实施以 kiro 的 spec/tasks 为准；其他 agent 只在协作面签入后改 L1/L2/handler。
3. **按依赖排序，禁止并行跳阶**：tenant-context **P0→P1→P2→P4**（P3 按 spec 可标注延后）；运维 Wave 0–3 可与 P1/P2 **部分并行**，但 **生产 flip 开关必须等 B4 门禁绿**。
4. **dedicated 不抢资源**：`hybrid-gateway-isolation` / 每企业独立实例 **不上首发排期**。
5. **不在共享脏树上做关键路径**：Wave 0 强制 worktree/分支隔离；kiro 在隔离 worktree land。
6. **每波有可测门禁**：没有门禁的“改完了”不算关闭阻断项。

---

## 1. 核实后的阻断项清单（带证据）

| ID     | 阻断项                                          | 严重度      | 首发是否必关 | 核实状态                   |
| ------ | ----------------------------------------------- | ----------- | ------------ | -------------------------- |
| **B0** | 发布工作区不可冻结                              | P0          | ✅ 必关      | ✅ 已核实                  |
| **B1** | 生产危险默认项（unconfigured / bind / sandbox） | P0          | ✅ 必关      | ✅ 已核实                  |
| **B2** | 公网拓扑与反代未闭环（admin / trusted-proxy）   | P0          | ✅ 必关      | ✅ 已核实                  |
| **B3** | 环境变量与品牌双轨（OPENBOT/OPENCLAW）          | P0-ops      | ✅ 必关      | ✅ 已核实                  |
| **B4** | 多租户信任边界未接线（tenant-context 仅 P0）    | **P0 首发** | ✅ **必关**  | ✅ 已核实；**kiro 进行中** |
| **B5** | 每企业独立 Gateway（dedicated）                 | 延后        | ❌ 非首发    | 上线稳定后另立排期         |

> **说明**：共享 Gateway 首发下，B4 与 B0–B3 **同等阻断**；仅运维硬化而无隔离接线 = **不可上生产**。

---

### B0 — 发布工作区不可冻结

**现象**

- 活跃分支相对 remote **ahead 十余 commit**，工作区约 **170+** 未提交改动。
- 改动高度集中在：operational identity 多 provider、knowledge universe、tenant-context 周边、supervisor/UI。
- 本地存在大体积运行态：`memory/` ~1.4GB、`groups/`（已 gitignore，但说明状态膨胀）。

**为何阻断**

- 无法定义“生产 = 哪一次构建”。
- 无法保证 CI 绿的是即将上线的同一树。
- 回滚、审计、事故复盘无基线。

**关闭标准（DoD）**

- [ ] 存在不可变 **release candidate tag**（或 `release/x.y.z` 分支 tip = tag）。
- [ ] 该 tip 上：`pnpm check`、`pnpm test`（或约定子集 + 全量夜间）、Docker build 通过。
- [ ] 工作区无未提交生产相关改动；WIP 全部在独立 feature 分支/worktree。
- [ ] 发布物（镜像 digest / npm pack）由 CI 产出并记录 SHA。

---

### B1 — 生产危险默认项

**证据**

| 位置                                   | 内容                                        | 风险                       |
| -------------------------------------- | ------------------------------------------- | -------------------------- |
| `Dockerfile` L230                      | `CMD ... gateway --allow-unconfigured`      | 无配置亦可启动             |
| `fly.toml` L18                         | `--allow-unconfigured --bind lan`           | 非 loopback + 放宽配置门禁 |
| `src/cli/gateway-cli/run.ts`           | 无 config 且非 local 时依赖该 flag 才能启动 | 生产误用即裸奔             |
| `src/gateway/server-runtime-config.ts` | 默认 `bind` 为 `loopback`（代码默认安全）   | 编排覆盖为 `lan` 时失效    |
| `src/agents/sandbox/config.ts` L191    | `mode` 默认 **`"off"`**                     | exec 易落宿主              |
| `docker-compose.yml`                   | sandbox docker.sock 默认注释                | 容器内无法真正 sandbox     |
| `SECURITY.md`                          | 明确 host-first、单运营者信任模型           | 与公网多用户场景不匹配     |

**关闭标准（DoD）**

- [ ] **生产** Dockerfile / compose / fly / render / k8s 清单 **禁止** `--allow-unconfigured`（仅 dev/e2e 允许，且与 prod target 分离）。
- [ ] 生产 bind 策略文档化：公网必须 `loopback` + 反代，或 `lan` + 强制 auth + 网络策略。
- [ ] 生产配置模板强制：`gateway.auth`（token/password 或 trusted-proxy）、`controlUi.allowedOrigins`。
- [ ] 生产安全基线：`agents.defaults.sandbox.mode` 按场景取值；共享/不可信用户场景强制 `all` + 工具策略收紧。
- [ ] `openbot security audit`（或等价）在 staging 零 critical。

---

### B2 — 公网拓扑与反代未闭环

**证据**

- `deploy/admin-subdomain/README.md`：`admin.openbot.love` 静态 SPA 未反代 `/__openbot/*` → 登录 404。
- 正确模式已写在：
  - `docs/gateway/trusted-proxy-auth.md`
  - `docs/gateway/trusted-proxy-deployment-examples.md`
  - `deploy/admin-subdomain/`（nginx 片段 + 说明）
- 代码要求：`gateway.auth.mode=trusted-proxy` + `platformAuth.enabled` + `trustedProxies` + `allowedOrigins`。

**关闭标准（DoD）**

- [ ] Staging 三端（或本期实际域名）实测通过：
  - 静态 UI 可加载
  - `/__openbot/control-ui-config.json` 200
  - platform-auth 登录成功
  - WebSocket 握手 Origin 通过
- [ ] 直连 Gateway 端口从公网不可达（仅反代/loopback）。
- [ ] Runbook：TLS、HSTS、header 覆盖、回滚步骤可操作。

---

### B3 — OPENBOT / OPENCLAW 环境变量双轨

**证据**

- 代码侧约 **OPENBOT\_\* ~102**、**OPENCLAW\_\* ~246** 符号出现（粗计）。
- 别名并存例：`OPENBOT_GATEWAY_TOKEN` / `OPENCLAW_GATEWAY_TOKEN` / 历史 `CLAWDBOT_*`（见 `src/daemon/service-env.ts`、`src/cli/daemon-cli/restart-health.ts`）。
- 编排不一致：`docker-compose.yml`/`fly.toml` 多用 OPENCLAW；`render.yaml` 用 OPENBOT；`.env.example` 混用。

**为何阻断（运维级 P0）**

- 配错变量 → “服务起来了但 auth 未生效 / 数据目录错位 / 计费密钥丢失”。
- 事故高发在半夜热修，而非编译期。

**关闭标准（DoD）**

- [ ] 发布 **权威环境变量表**（生产只认一列 Primary，其余为 Deprecated alias）。
- [ ] 生产 Runbook / 镜像 entry 只注入 Primary。
- [ ] `doctor` 或启动日志对“只设了 alias 未设 primary”给出明确告警（可选 hardening）。
- [ ] 不要求一次删光 OPENCLAW（兼容保留），但 **生产配置面统一**。

---

### B4 — 多租户信任边界未接线

**证据（与 spec 一致）**

| 项                                                     | 状态                                                                          |
| ------------------------------------------------------ | ----------------------------------------------------------------------------- |
| `src/gateway/tenant-context.ts`                        | ✅ 存在；`resolveTenantContext` / `requireTenantContext`                      |
| `resolveDataRootForContext` / `assertWithinTenantRoot` | ✅ 在 `tenant-store-paths.ts`                                                 |
| P0 单测                                                | ✅ `tenant-context.test.ts` + `tenant-store-paths.test.ts`（约 19 用例量级）  |
| **handler 接线**                                       | ❌ **无** 非测试生产调用 `resolveTenantContext` / `resolveDataRootForContext` |
| L2 `resolveDataRoot(` 直调                             | ❌ 仍在 `src/data/*`、`server-methods/data.ts`、`control-ui.ts` 等            |
| Spec 任务                                              | P0 ✅；P1–P4 ☐（`.kiro/specs/tenant-context-propagation/tasks.md`）           |
| `SECURITY.md`                                          | 明确非多租户对抗边界                                                          |

**关闭标准（DoD）— 首发共享 Gateway（必达）**

- [ ] Spec **P1 + P2 + P4** 完成 + 跨租户泄漏测试 CI 门禁（P3 按评估书面决定）。
- [ ] managed 模式路径均经寻址层；CI 禁止新增直调 `resolveDataRoot(`（allowlist 除外）。
- [ ] 同进程双租户 E2E 绿。
- [ ] `SECURITY.md` / 部署文档增补 **managed 共享 Gateway** 部署假设（与「一用户信任模型」的差异写清）。
- [ ] Owner：**kiro** 主路径；协作面 loom 签入后才改对应目录。

**非关闭项（勿混淆）**

- ~~用一租户一实例替代 B4~~ — **不是首发策略**；dedicated 见 Wave 5。
- P0 alone — **不足以上生产**（仅地基，handler 未接线）。

**进度快照（2026-07-12）**

| 提交/产物    | 说明                                                                             |
| ------------ | -------------------------------------------------------------------------------- |
| `9b7e458757` | P0 foundation                                                                    |
| `51c785006a` | P0 harden（fail-closed + membership-only）                                       |
| `90aa668372` | spec 入库                                                                        |
| tasks.md §1  | P0 全勾；§2–5 未勾                                                               |
| 代码检索     | 生产路径无 `resolveTenantContext` / `resolveDataRootForContext` 调用（仅定义处） |

---

## 2. 总依赖图（首发 = 共享 Gateway）

```text
                    ┌──────────────────────────────────────┐
                    │  Wave 4 / B4  kiro 主路径（关键路径）   │
                    │  tenant-context P0✅ → P1 → P2 → P4   │
                    │  （P3 可按 spec 书面延后）              │
                    └──────────────────┬───────────────────┘
                                       │ 隔离门禁绿
        ┌─────────────┐                │
        │  Wave 0 B0  │  发布基线      │
        └──────┬──────┘                │
               ▼                       │
        ┌─────────────┐                │
        │  Wave 1 B1  │  危险默认项    │
        └──────┬──────┘                │
               ▼                       │
        ┌─────────────┐   ┌──────────┐ │
        │  Wave 2 B2  │──►│ Wave 3   │ │  可与 Wave4 并行
        │  反代拓扑   │   │ B3 env   │ │  （勿抢 kiro 文件）
        └──────┬──────┘   └────┬─────┘ │
               │               │       │
               └───────┬───────┘       │
                       ▼               ▼
              ┌────────────────────────────────┐
              │  首发生产门禁（全部满足）         │
              │  B0–B3 运维就绪 + B4 隔离闭环    │
              │  OPENBOT_MULTITENANT 灰度可开    │
              └────────────────┬───────────────┘
                               │ 生产稳定一段时间后
                               ▼
              ┌────────────────────────────────┐
              │  Wave 5 / B5  dedicated（延后）  │
              │  每企业独立 Gateway（hybrid 计划）│
              └────────────────────────────────┘
```

**并行规则**

| 工作流                         | 可否与 kiro P1–P2 并行                | 约束                                        |
| ------------------------------ | ------------------------------------- | ------------------------------------------- |
| Wave 0–3（发布/镜像/反代/env） | ✅ 鼓励并行                           | 不改 `tenant-context*`、不抢 L1/L2 寻址接线 |
| Wave 4 P1 L1 handler           | 仅 **kiro + 已 loom 签入的 L1 owner** | 见 spec Agents                              |
| Wave 4 P2 L2 data              | 须 **data-directory** 等协作方签入    | 禁止无登记改 `src/data/*`                   |
| Wave 5 dedicated               | ❌ 首发不做                           | 稳定后 + 商业触发再开                       |

---

## 3. 分波详细计划

### Wave 0 — 发布治理（B0）

**目标**：定义“什么东西允许上生产”  
**建议工期**：1–3 天  
**Owner**：发布负责人 + 架构

| #   | 任务                                                            | 产出                         | 验收             |
| --- | --------------------------------------------------------------- | ---------------------------- | ---------------- |
| 0.1 | 盘点工作区：WIP 主题归类（identity / knowledge / tenant / UI…） | 主题清单                     | 每主题有目标分支 |
| 0.2 | 选择 RC 基线：已知较稳 commit 或合并已完成 P0 tenant 的 tip     | `release/candidate-YYYYMMDD` | 分支存在         |
| 0.3 | 隔离 WIP：`git worktree` / feature 分支；禁止在 RC 上继续堆功能 | worktree 列表                | RC 干净          |
| 0.4 | RC 上跑门禁：`pnpm check`、约定测试集、`docker build`           | CI/本地日志                  | 全绿或已知豁免表 |
| 0.5 | 打 tag + 记录镜像 digest 方案                                   | tag + 发布记录模板           | 可复现构建       |
| 0.6 | 冻结策略：RC 仅 cherry-pick 阻断修复                            | CODEOWNERS/约定              | 写入本文件附录   |

**退出标准**：存在可指向的 **RC SHA**，且与即将部署的产物同源。

**风险**

- WIP 与 RC 交织导致“修阻断又带进半成品”。  
  **缓解**：物理 worktree 隔离；RC 分支保护。

---

### Wave 1 — 生产默认项硬化（B1）

**目标**：任何公网/半公网实例不会因默认值裸奔  
**建议工期**：2–4 天  
**Owner**：平台/运维 + Gateway  
**前置**：Wave 0 RC

| #   | 任务                                             | 改动面                                                        | 验收                                 |
| --- | ------------------------------------------------ | ------------------------------------------------------------- | ------------------------------------ |
| 1.1 | 拆分 **prod** vs **dev/e2e** 启动参数            | `Dockerfile` 多 target 或 `Dockerfile.prod`；compose override | prod 无 `--allow-unconfigured`       |
| 1.2 | 修正 `fly.toml` / `render.yaml` 生产清单         | 编排文件                                                      | bind/auth 符合 Runbook               |
| 1.3 | 提供 **生产 openbot.json5 模板**（secrets 外置） | `deploy/production/` 新建                                     | 含 auth、origins、sandbox、data.mode |
| 1.4 | 文档：生产禁止项红线表                           | `docs/install/` 或 `deploy/README`                            | review 通过                          |
| 1.5 | Staging 跑 `security audit --deep`               | 命令输出                                                      | critical=0                           |
| 1.6 | （可选）启动时 production profile 自检           | gateway 启动路径                                              | 缺 token/origins 则拒绝启动          |

**生产配置红线（建议写入模板）**

```json5
{
  gateway: {
    mode: "local", // 或 managed SaaS 约定值
    bind: "loopback",
    auth: {
      /* token | password | trusted-proxy — 必填其一 */
    },
    controlUi: {
      allowedOrigins: [
        /* 精确域名 */
      ],
    },
    trustedProxies: [
      /* 反代 IP */
    ],
  },
  agents: {
    defaults: {
      sandbox: { mode: "all" }, // 共享/不可信场景；可信单用户可 non-main 并书面签字
    },
  },
  data: { mode: "managed" }, // 仅 SaaS；自托管 local
}
```

**退出标准**：用 prod 清单在 staging 拉起实例，未手动打补丁即可通过 audit + 健康检查。

---

### Wave 2 — 公网拓扑验收（B2）

**目标**：浏览器路径完整可用且 Gateway 不直暴  
**建议工期**：2–5 天（含 DNS/证书协调）  
**Owner**：运维 + 前端控制面  
**前置**：Wave 1

| #   | 任务                                                   | 产出                | 验收                     |
| --- | ------------------------------------------------------ | ------------------- | ------------------------ |
| 2.1 | 固化域名矩阵（admin / biz / gw / app）                 | 域名表              | 与产品一致               |
| 2.2 | 落地 nginx（或等价）反代：`/` SPA + `/__openbot/` + WS | conf 入库 `deploy/` | 与 README 一致           |
| 2.3 | Gateway：trusted-proxy + platformAuth + allowedOrigins | 配置                | 登录链路通               |
| 2.4 | 端口防火墙：18789 仅本机                               | 主机策略            | 外网探测失败             |
| 2.5 | 验收脚本（curl + 手工 UI）                             | `deploy/*/smoke.sh` | CI 或手动 checklist 全绿 |
| 2.6 | 失败演练：关 gateway / 错 Origin / 缺 header           | 演练记录            | 错误可诊断               |

**冒烟清单（最低）**

1. `GET https://admin.../` → 200 SPA
2. `GET https://admin.../__openbot/control-ui-config.json` → 200 JSON
3. platform login → session
4. Control UI WS 连接成功
5. 公网 `http(s)://host:18789/healthz` → 超时/拒绝

**退出标准**：Staging 冒烟清单签字；Runbook 可交他人复现。

---

### Wave 3 — 权威环境变量与命名（B3）

**目标**：生产配置只认一套名字  
**建议工期**：1–3 天（可与 Wave 2 后半并行）  
**Owner**：平台  
**前置**：Wave 0；与 Wave 2 配置固化同步完成更佳

| #   | 任务                                                  | 产出                             | 验收                                                |
| --- | ----------------------------------------------------- | -------------------------------- | --------------------------------------------------- |
| 3.1 | 导出当前 env 符号表（脚本扫描）                       | `deploy/env-authority-matrix.md` | 全量 Primary/Alias                                  |
| 3.2 | 裁定生产 Primary 前缀策略                             | 决策记录                         | 建议：**新配置一律 OPENBOT\_**；OPENCLAW\_ 兼容只读 |
| 3.3 | 更新 `.env.example`、compose、fly、render、Runbook    | 文件 diff                        | 生产文档零混用（或明确 alias）                      |
| 3.4 | doctor/启动提示：检测到仅 alias 时警告                | 可选代码                         | 单测覆盖                                            |
| 3.5 | 密钥清单：SMTP/OAuth/支付/Vault 等只走 secret manager | 清单                             | 无明文进库                                          |

**裁定建议（可改，但必须一次拍板）**

| 类别          | Primary                       | Alias（兼容）            |
| ------------- | ----------------------------- | ------------------------ |
| Gateway token | `OPENBOT_GATEWAY_TOKEN`       | `OPENCLAW_GATEWAY_TOKEN` |
| State dir     | `OPENBOT_STATE_DIR`           | `OPENCLAW_STATE_DIR`     |
| Data mode     | `OPENBOT_DATA_MODE`           | —                        |
| Public URL    | `OPENBOT_PUBLIC_APP_BASE_URL` | —                        |

**退出标准**：Staging 部署 YAML **只出现 Primary**；矩阵文档已评审。

---

### Wave 4 — 多租户逻辑隔离（B4，**首发关键路径**）

**目标**：共享 Gateway 安全服务多租户（逻辑隔离）  
**建议工期**：2–6 周（P1–P4，取决于协作方到位）  
**Owner（主）**：**kiro**（`tenant-context-propagation` / loom SAAS-TENANT-DATA\*）  
**协作 Owner（须 loom 签入后再动）**：

| 面                      | 代表路径                                                                             | 协作角色                               |
| ----------------------- | ------------------------------------------------------------------------------------ | -------------------------------------- |
| L1 控制面 store         | `platform-auth-*`、`enterprise-seat-assets-store`、`enterprise-data`、`organization` | 企业/平台相关 owner                    |
| L2 数据模块             | `src/data/*`                                                                         | `data-directory:cursor-data-directory` |
| gateway data handler    | `src/gateway/server-methods/data.ts` 等                                              | 取任务时协调                           |
| L3 会话 / L0 凭证（P3） | session / auth-profiles                                                              | 另属；可书面延后                       |

**前置**：spec 已存在；P0 已合入（`51c785006a` harden + `9b7e458757` foundation）；**隔离 worktree**  
**权威任务清单**：`.kiro/specs/tenant-context-propagation/tasks.md`（以该文件勾选为准，本表为摘要）

| Phase  | 内容                                                        | 状态（2026-07-12 核实） | 门禁                      |
| ------ | ----------------------------------------------------------- | ----------------------- | ------------------------- |
| **P0** | TenantContext + 寻址层 + 回退契约 + 单测                    | ✅ 已合入               | local 零变化              |
| **P1** | L1 storePath DI + handler 寻址                              | ☐ 进行中/待做           | 跨租户 L1 泄漏测试        |
| **P2** | L2 `resolveDataRoot` → `ForContext`                         | ☐                       | 跨租户/跨用户 L2 泄漏测试 |
| **P3** | L3 会话 / L0 凭证隔离                                       | ☐ 可书面延后\*          | 不串会话/密钥             |
| **P4** | 路径守卫 + CI 寻址扫描 + `OPENBOT_MULTITENANT` + 双租户 E2E | ☐                       | 全部门禁绿                |

\*P3 延后条件（须书面记入 tasks）：首发共享进程下若 L0/L3 仍可能串，**不得**延后；仅当有充分证据证明当前会话/凭证已按租户键控或风险可接受时，才可延后。默认建议 **P2+P4 为硬门禁，P3 评估后决定**。

**实现约束（已锁定，见 design）**

- D1 权威身份，不信任 `sessionTenantId` hint
- D2 local 零变化回退
- D3 单一寻址出口
- D5 `OPENBOT_MULTITENANT` 开关灰度

**与运维 Wave 的衔接**

- Staging 可先以 **managed + 双租户夹具** 验证隔离（不必等公网域名）。
- **生产打开多租户流量** 的条件：P1+P2+P4 绿 + Wave 1–2 安全暴露面合格。
- 在 B4 完成前，即使 Wave 0–3 完成，也只能跑 **隔离未完成的预生产**，不得接真实多企业生产数据。

**退出标准（首发共享）**

- [ ] tasks.md 中 P1、P2、P4 勾选完成（P3 按评估）
- [ ] 同进程双租户 E2E 绿
- [ ] CI 寻址守卫生效
- [ ] `SECURITY.md` 或部署文档补充 managed 共享 Gateway 假设
- [ ] Staging 双租户连续验证通过后再灰度

---

### Wave 5 — 每企业独立 Gateway（B5，**延后**）

**目标**：dedicated 物理隔离（VIP/合规/成本分层）  
**状态**：**不上首发排期**；上线稳定后执行  
**参考**：`docs/design/hybrid-gateway-isolation-future-plan-2026-07-11.md`

触发条件（建议同时满足）：

1. 共享 Gateway（Wave 4）生产稳定一段时间
2. 存储卷 / 路由 / 监控 / 备份 / 计费归因稳定
3. 明确 dedicated 商业需求或定价层权益

**不在此计划展开 F0–F6 细节**；届时单独立项。

---

## 4. 路径选择决策（已锁定）

| 选项                     | 含义                    | 状态                              |
| ------------------------ | ----------------------- | --------------------------------- |
| ~~A — 首发一租户一实例~~ | 每企业独立 Gateway 先上 | **否决为第首发**（延后为 Wave 5） |
| **B — 首发共享多租户**   | 一进程多租户 + 逻辑隔离 | **✅ 已锁定；kiro 执行 B4**       |
| ~~C — 先 A 后 B~~        | 先单实例上线再做共享    | **不采纳**（与现行执行不一致）    |

---

## 5. 总排期草图（共享首发）

```text
Now        : kiro 继续 Wave4 P1（L1）；并行可启动 Wave0/1
Week 1     : Wave0 RC 纪律 + Wave1 硬化；kiro P1 门禁
Week 1–3   : kiro P2（+ data-directory 协作）；Wave2 反代 + Wave3 env
Week 2–4   : P4 守卫/开关/双租户 E2E；staging 全链路
Gate       : B0–B4 全绿 → 生产灰度（OPENBOT_MULTITENANT）
稳定后     : Wave5 dedicated（每企业独立 Gateway）按 hybrid 计划启动
```

工期随协作方到位变化；**B4 是最长杆**，Wave 0–3 不得假装可替代 B4。

---

## 6. 每波通用门禁模板

1. **代码**：关联 PR + 单测
2. **构建**：RC 同源镜像
3. **配置**：无 secret 入库
4. **安全**：audit / 端口 / origins
5. **功能冒烟**：本波 DoD checklist
6. **文档**：Runbook 同步
7. **签字**：Owner + 验收官

关闭阻断项时在本文件顶部状态表更新：`开放 → 整改中 → 已关闭（PR/tag）`。

---

## 7. 明确不在本计划范围（首发）

- **每企业独立 Gateway / hybrid dedicated**（Wave 5，上线稳定后）
- 全量删除 OPENCLAW 品牌兼容层
- 非阻断的企业功能堆叠（knowledge/identity 新 provider 等）—— 不得阻塞 B4 与 Wave 0–3；独立 feature 分支
- 移动端 apps 商店发布
- 由非 kiro agent **抢写** tenant-context 主路径（除非 loom 移交）

---

## 8. 即时行动项（决策已锁定后 48h 内）

1. ~~拍板路径~~ → **已锁定：共享 Gateway 首发；dedicated 延后为 Wave 5**。
2. **保护 kiro 主路径**：P1 worktree 隔离；其他主题不得与 tenant 接线抢同一脏树。
3. **协作签入**：P1 前确认 L1 store owner；P2 前 `data-directory` loom register。
4. **并行启动 Wave 0–1**：RC 纪律 + 生产默认项硬化（不改写 tenant 核心文件）。
5. **建立跟踪**：看板列 = Wave0 | Wave1 | Wave2 | Wave3 | **Wave4(kiro P1–P4)** | Wave5(延后)。
6. **对齐 SECURITY**：共享多租户上线前补文档，避免「代码多租户、文档仍单运营者」。

---

## 附录 A — 核实命令备忘

```bash
# 租户寻址是否已接线（期望：仅定义处 + 测试）
grep -rn "resolveDataRootForContext\|resolveTenantContext" src --include='*.ts' | grep -v test

# L2 仍直调 resolveDataRoot 的站点
grep -rn "resolveDataRoot(" src --include='*.ts' | grep -v test | grep -v ForContext

# 生产危险 flag
grep -rn "allow-unconfigured" Dockerfile fly.toml render.yaml docker-compose.yml

# 沙箱默认
grep -n 'mode ?? "off"' src/agents/sandbox/config.ts
```

## 附录 B — 阻断关闭记录（实施时填写）

### Wave 0/1 执行进度（2026-07-12）

| Wave   | 状态                                                            | 产出                                              |
| ------ | --------------------------------------------------------------- | ------------------------------------------------- |
| Wave 0 | **部分完成**（纪律文档 + WIP 盘点；RC 分支/tag 须操作者本地建） | `docs/design/wave0-release-hygiene-2026-07-12.md` |
| Wave 1 | **代码/清单已改**（待 RC 合入与 staging 验）                    | 见下                                              |

Wave 1 文件变更：

- `Dockerfile` CMD：去掉 `--allow-unconfigured`
- `fly.toml` / `fly.private.toml`：同上
- `deploy/production/**`：prod compose、env、config 模板、smoke、README
- `docs/install/docker.md`：与生产策略对齐
- 根 `docker-compose.yml`：注释指向 prod pack；仍无 unconfigured flag

| ID  | 关闭日期 | PR/Tag | 验收人 | 备注 |
| --- | -------- | ------ | ------ | ---- |
| B0  |          |        |        |      |
| B1  |          |        |        |      |
| B2  |          |        |        |      |
| B3  |          |        |        |      |
| B4  |          |        |        |      |
