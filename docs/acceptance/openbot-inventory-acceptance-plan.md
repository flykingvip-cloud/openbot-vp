---
summary: "OpenBot 盘点验收方案：供专家评审会冻结范围、基线与方法，评审通过后再实施审计。"
read_when:
  - Preparing or running an inventory and acceptance audit of OpenBot
  - Freezing the main-tip baseline before a review meeting
title: "盘点验收方案"
---

# OpenBot 盘点验收方案

> 状态：评审稿。本文只定义范围、证据锚点、检查方法与通过标准。  
> 批准本 PR 只批准方法。不批准任何 Stage 0–8 的产品验收结论。  
> 本文不执行审计，不改产品代码。  
> 起草基线已过期。Stage 0 在执行前必须 `git fetch origin main`，再用 `git rev-parse origin/main` 重 pin 当时的尖端。  
> 历史起草基线：`0685ce054e45eb463b34a2f0aff88779e6ebaf3f`（#364 尖端，`feat/floor-p1-b-episode-store`）。它不是执行基线。正文里的代码引用在这个历史 SHA 上核对过。相对它的 CI 叙述只是历史起草示例，不是执行证据。  
> 当前证据键：记账前最后一次 `git fetch origin main`，`git rev-parse origin/main` 打印 `a7bbaf6d14b40f138f677ff3c9c0a90e82de5ace`（#415）。上一份打印是 `5d250c297c90c4da85de925aacc19586693a8324`（#414）。再上一份是 `8e8f772b3443c1b0984351d284a5fc05726acb97`（#412）。更早还有 `7f8b49286a10e2c8133a7b476787bdbc05afc5c6`（#402）、`8aa8d5e45baa2022a6b7629ac34d8573fc1374e4`（#407）、`d478d3bdf1d2fa03cad19d920b9d4480c68a8a92`（#406）、`613733bef10eda5c384d3cc64b4750ea480bf60a`（#405）、`ccc10c2d4ab301a20f49369c9863ad87760ca799`（#404）和 `f9a1884d53793d7fe6ab8d2b63aa863a35db0f7f`（#400）。`execution_baseline_sha` 钉成这份打印。写这些 CURRENT 行时祖先检查退出码 1，没有 rebase。第二复核（代码仓盘点验收）接受 tip `772fd6d3cde2e6d50b9d15d31747a2d1f06313d1` 的盘点账本，产品结论仍不是 PASS。随后 merge 提交 `44dec486760f68bb6ddf5a01ff9146deb6d16fd1` 把这份 `origin/main` 合入。合入后再次 fetch，打印值未变，`git merge-base --is-ancestor origin/main HEAD` 退出码 0。CURRENT 19 行仍是 pin 自检，不是本 PR head。回归是 `UNKNOWN`，不是 `BASELINE_UNCHANGED`。  
> Stage 0 的 `1b910f78ace85d65084ffbe716a55ad0ca6fab17` / 合并树 `97e07fdd33787d72ab2736c643c1648ccfd24186` 相对当时 pin `0f16950e171eeb6ac048a7e3b10a25c173ed9980`，现为 HISTORICAL。那些 `BASELINE_UNCHANGED` 不抄进 CURRENT。  
> 同一 `evidence_run_id` 只保留一条 Actions 结论。`37602196416#112729087430`、`37605284821#112739214151`、`37582511520#112665542148` 的重复 PASS 行已删除，只留 FAIL。方案文件是否出现在失败列表里只写在叙述中。  
> `1b910f78a`、`3a16e0b07`、`a6fc195`、`448a40551`、`462c100c4`、`aee849395`、`b14b16b80` 都是 HISTORICAL。批准本方案不是产品 Stage PASS。Stage 1 的本地 vitest 与启动探针不是 Actions EvidenceRow。Stage 1 未闭合。CURRENT 里的行是 pin 自检，不是本 PR head 的候选 CI。  
> 包：`@upbeyond/openbot` `2026.7.12-rc.2`（历史基线上的版本字段）。产品定位：Enterprise Agent OS。公开站点以 `https://www.openbot.love/` 为准。

## 1. 背景与目标

OpenBot 是企业数字员工的控制面：Gateway 常驻，控制台与 WebChat 经 WebSocket 接入，企业 IM（企业微信、飞书、钉钉）从企业控制台接入，可选节点提供本机能力。仓库同时保留 OpenClaw 兼容别名、大量历史频道插件、多包协作运行时与交付门禁。专家评审需要一份可执行的盘点验收方案，把「看什么、用什么证据、怎样算通过」先冻结，再派人实施。

本方案的目标：

1. 把验收对象钉在可复现的 `main` 尖端。本稿的 0685 只是历史起草基线；执行前由 Stage 0 重 pin，避免口头架构与过期文档混用。
2. 按阶段验收。信任边界是必验横切门，不是可选项。其后才是架构、API 契约、持久化、可靠性、质量与供应链、产品表面。
3. 产品表面只有 Stage 7 一个范围权威。§5.5 只保留可观测、性能、正式 SBOM、发布通道。
4. 规定实施阶段、角色、产出物与阻断条件。评审通过之前不启动全量审计。

成功标准（针对本方案本身，不是针对产品）：评审会能据此排出审计批次、指定主人、接受或收窄范围，并且每一条检查都能回到仓库路径或命令。

## 2. 验收对象与边界

### 2.1 对象

| 项               | 值                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 仓库             | `upbeyond/openbot`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 历史起草基线     | `0685ce054e45eb463b34a2f0aff88779e6ebaf3f`。这是 #364 尖端。代码引用相对它。相对它的 CI 叙述是历史起草示例，不是执行证据，也不能单独支撑 §4.4 的 `BASELINE_UNCHANGED`                                                                                                                                                                                                                                                                                                                                               |
| 当前候选 PR head | `1b910f78ace85d65084ffbe716a55ad0ca6fab17`。它的 Actions 行在 Stage 1 重 pin 后是 HISTORICAL。`3a16e0b07` 与更早候选也是 HISTORICAL。现在的 CURRENT 是 pin 自检，不是这个候选                                                                                                                                                                                                                                                                                                                                       |
| 评审时 PR base   | `82387506c08efafea8ca67fe9f327db8388345dc`（#383，含已合并的 #382）。不是本次 Stage 0 pin                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 当前合并树       | `97e07fdd33787d72ab2736c643c1648ccfd24186`（Merge `1b910f78a` into `a0303a926`）。3a16 的 `6630aac92` 与 a6fc 的 `822f4807` 只属于 HISTORICAL                                                                                                                                                                                                                                                                                                                                                                       |
| 已被取代的候选   | `3a16e0b07` / `6630aac92`；`a6fc195` / `822f4807`；`448a40551` / `155e1eea7`；`462c100c4` / `39259eac0`；`aee849395` / `eebbc04f`；`b14b16b80` / `e95314e60`。全部 HISTORICAL                                                                                                                                                                                                                                                                                                                                       |
| 执行基线         | `a7bbaf6d14b40f138f677ff3c9c0a90e82de5ace`。记账前 `git fetch origin main` 后 `git rev-parse origin/main` 的打印值。`execution_baseline_sha` 写成这一串。上一份打印 `5d250c297c90c4da85de925aacc19586693a8324`（#414）、再上一份 `8e8f772b3443c1b0984351d284a5fc05726acb97`（#412）以及更早的 `7f8b49286`、`8aa8d5e45`、`d478d3bdf`、`613733bef`、`ccc10c2d4`、`f9a1884d5`、`0fd9d2c1c`、`0f16950e1` 都不再是执行基线。安全抽样 blob 相同不是 Signature，不分配 `BASELINE_UNCHANGED`。禁止把那些旧 SHA 当成这次 pin |
| 祖先检查         | 合入提交 `44dec486760f68bb6ddf5a01ff9146deb6d16fd1` 的第二父是 `a7bbaf6d14b40f138f677ff3c9c0a90e82de5ace`。合入后 `git merge-base --is-ancestor origin/main HEAD` 退出码 0。合入前同一检查退出码 1。没有 rebase                                                                                                                                                                                                                                                                                                     |
| 运行时基线       | Node 22+；包管理以 `pnpm-lock.yaml` 为准，Bun 用于部分测试与脚本                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 产品名           | 用户可见命令与文档标题用 OpenBot；`openclaw` 仅作兼容 bin 与 `OPENCLAW_*` 环境变量                                                                                                                                                                                                                                                                                                                                                                                                                                  |

Stage 4 pin for this freeze is `7f8b49286a10e2c8133a7b476787bdbc05afc5c6`. Previous print `8aa8d5e45baa2022a6b7629ac34d8573fc1374e4`, earlier print `d478d3bdf1d2fa03cad19d920b9d4480c68a8a92`, earlier print `613733bef10eda5c384d3cc64b4750ea480bf60a`, intermediate print `ccc10c2d4ab301a20f49369c9863ad87760ca799`, earlier print `f9a1884d53793d7fe6ab8d2b63aa863a35db0f7f`, earlier Stage 1 pin `0fd9d2c1c41ff4a3126a3b450fa57b6e157954a1`, and Stage 0 pin `0f16950e171eeb6ac048a7e3b10a25c173ed9980` are historical. Identical Stage 1 security blobs across these pins are not `BASELINE_UNCHANGED`. A newer `origin/main` requires another pin before the next stage.

### 2.2 在范围内

- 控制面：`src/gateway`、`src/cli`、`src/commands`、协议 schema 与生成物检查。
- 数字员工与 Pi 运行时：`src/agents`、`@earendil-works/pi-coding-agent` 的接入方式、会话转录写入约束。
- 控制台与 WebChat：`ui/`、`docs/web`、Gateway 同源静态资源。
- 频道：产品主路径企业微信 / 飞书 / 钉钉，加上共享路由、配对、allowlist 被改动时必须点名的内置与 `extensions/*` 频道。
- 节点：`apps/macos`、`apps/ios`、`apps/android`、`apps/harmony`、`src/node-host`、`src/cli/nodes-cli*`。
- 技能与工具：`skills/`、`src/agents/skills`、`src/plugin-sdk`、`extensions/*`。
- 持久化：状态目录、配置、会话、凭证、SQLite 索引、企业数据连接器、备份命令。
- 质量门禁与供应链证据：Vitest 配置、`pnpm check`、`pnpm protocol:check`、knip、pre-commit、CI 运行证据、生产依赖审计。
- 信任边界：安全剖面、租户边界、沙箱、凭证根、插件权限、设备配对。
- 产品表面的唯一范围权威是 Stage 7（§5.7）：控制台、企业微信 / 飞书 / 钉钉、节点、doctor / onboard。这些表面不在 §5.5 里再标成可选。

### 2.3 在范围外（除非评审会升格）

- 不在本仓库的安装器站点（`openbot.love` 的 `install.sh` 等位于兄弟仓库）。
- 生产切流、镜像发布、`provenance/sha-*` 打标。本方案只读交付文档与脚本，不执行 cutover。
- 真实密钥、真实租户数据、生产 Postgres。连接器与 HA 只做代码与实验环境核对。
- `docs/zh-CN/**` 正文。它由英文文档经 `scripts/docs-i18n` 生成；验收只检查流水线是否被当作手改源。本稿曾进入英文 `docs/docs.json` 的 Project 组，中文导航仍只有 `zh-CN/reference/credits`，没有对应中文页。该缺口不靠手改 `docs/zh-CN/**` 修补。本稿已从 `docs/docs.json` 与 `docs/index.md` 撤下，留到评审通过后的读者向改写。
- 全量渗透与性能压测。依赖审计证据属于 Stage 6 必验；正式 SBOM 文件已由 Stage 6 CURRENT 以 OWASP `@cyclonedx/cdxgen` 产物闭合（窄），不把 audit/阶段产品写成 PASS。

### 2.4 信任剖面是 Stage 0 硬门

`SECURITY.md` 与 `src/gateway/security-profile.ts` 定义两个互斥剖面，由服务端选择（`OPENBOT_SECURITY_PROFILE` / `gateway.security.profile`）。客户端输入不能改剖面。

- `personal_local`：单运营者网关。会话键是路由；已认证客户端经请求 ALS 后会话 store 与插件 `stateDir` 落在 `$STATE_DIR/operators/<id>/`，跨操作者路径失败关闭。无身份连接仍是共享 `STATE_DIR` 遗留。
- `managed_enterprise`：租户互不信任。身份只来自已认证成员关系；缺上下文失败关闭。共享进程多租户在 I3 隔离被单独证明之前，启动即拒绝。

Stage 0 冻结单必须写下三者之一：`personal_local`、`managed_enterprise`，或「未选定」。Stage 0 当时写下「未选定」。Stage 1 按操作者选择，把 `personal_local` 与 `managed_enterprise` 同时列入本批范围，各写一份结论。抽样名单在 §5.0 执行记录里冻结。

未选定任一剖面时，只允许做与信任边界无关的静态契约检查，例如协议 schema 字段对照、`pnpm protocol:check`、CLI 命令清单、生成物 diff。此时禁止写出产品安全验收结论，包括隔离成立、沙箱生效、凭证根分离、插件权限合格、配对合格。用个人本地观察去宣称托管企业隔离，或反过来，结论无效。两个剖面都要结论时，写成两份独立结论，不合并成一句「安全通过」。

## 3. 仓库速览事实

下列事实在历史起草基线 0685 上核对过。Stage 0 重 pin 之后必须逐条复读，发现漂移记入证据册。它们不是当前 `main` 的验收结论。

### 3.1 单仓布局

`pnpm-workspace.yaml` 包含四个工作区：仓库根、`ui`、`packages/*`、`extensions/*`。

| 区域                             | 作用（以目录与文档为准）                                                  |
| -------------------------------- | ------------------------------------------------------------------------- |
| `src/`                           | CLI、Gateway、频道、会话、配对、配置、媒体、Agent 工具                    |
| `ui/`                            | Control UI / 员工与企业控制台                                             |
| `extensions/`                    | 频道与能力插件（起草时 `extensions/*/package.json` 约 37 个）             |
| `packages/`                      | AOR、collaboration、constitutional、evolution、cogniweave-sdk、toolkit 等 |
| `apps/`                          | macOS、iOS、Android、Harmony                                              |
| `skills/`                        | 随包技能                                                                  |
| `deploy/production`、`deploy/ha` | 交付记录与 HA 控制器 / CommitSafety                                       |
| `docs/`                          | Mintlify 文档（`docs/docs.json`）                                         |
| `Swabble/`                       | 同树独立工程，自带 CI，不并入 Gateway 验收主结论                          |

根命令入口：`openbot.mjs`（`openbot`），兼容入口 `openclaw.mjs`。

### 3.2 运行时地图

`docs/concepts/architecture.md`、`docs/gateway/index.md`、`docs/index.md` 与代码一致的部分：

- 一个常驻 Gateway 进程承担路由、控制面和频道连接。默认绑定 loopback，默认端口 `18789`（`src/config/paths.ts` 的 `DEFAULT_GATEWAY_PORT`）。端口解析：`--port` → `OPENBOT_GATEWAY_PORT` → `gateway.port` → `18789`。
- 同一端口复用 WebSocket 控制/RPC、HTTP API、Control UI 与 hooks。
- 客户端在握手时声明 `role` 与 `scopes`。节点使用 `role: "node"`，并申报 caps / commands / permissions。
- 数字员工是带工作区、技能与会话隔离的 agent，不是一次性聊天。Pi 会话转录是 `parentId` 链；`src/gateway/server-methods/AGENTS.md` 要求经 `SessionManager.appendMessage` 写入，禁止裸追加 JSONL `type: "message"`。
- 产品 IM 主路径是企业微信、飞书、钉钉（企业控制台 → 消息渠道，长连接优先，见 `docs/channels/enterprise-im.md`）。WebChat 走 Gateway WebSocket。其余频道插件是继承适配器目录，不是产品标题。
- Canvas host 由 Gateway HTTP 提供：`/__openbot__/canvas/` 与 `/__openbot__/a2ui/`。

文档新鲜度：`docs/concepts/architecture.md` 标注 Last updated 2026-01-22，`docs/concepts/typebox.md` 标注 2026-01-10。验收以代码为准，把日期早于基线的页面标成「待复核」，不把旧段落当现行契约。

### 3.3 身份与迁移（两条发现，不合并）

保留为发现，不在本方案里改链接、克隆地址或默认目录。`.gmood2008` 不在 `LEGACY_STATE_DIRNAMES` 里。

| ID   | 发现                                         | 证据                                                                                                                                                                                                                                                                                                                                          | 严重度                                                                   |
| ---- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| ID-A | 徽章与安全报告入口仍指向 `gmood2008/openbot` | `README.md` 徽章；`SECURITY.md` 报告入口。本方案 fetch 的远端是 `https://github.com/upbeyond/openbot`                                                                                                                                                                                                                                         | 至少 P2。不得降成信息项                                                  |
| ID-B | 首页配置路径与更新克隆地址和代码默认值不一致 | `docs/index.md` 写 `~/.gmood2008/openbot.json`。代码默认状态目录是 `~/.openbot`（`src/config/paths.ts` 的 `NEW_STATE_DIRNAME`）。遗留目录只有 `.openclaw`、`.clawdbot`、`.moldbot`、`.moltbot`。`src/cli/update-cli/shared.ts` 的 `ensureGitCheckout` 在目录不存在时克隆 `OPENCLAW_REPO_URL`，值为 `https://github.com/gmood2008/openbot.git` | 起草为 P2。评审会可以把这一条升到 P1，因为克隆地址会把更新落到另一个远端 |

两条都要进 Stage 8 发现单。不得写成「已核对无漂移」，也不得合成一条后降级抹掉。

## 4. 验收审计体系总览

### 4.1 阶段（必验顺序）

审计按阶段推进。前一阶段的硬门未过，后一阶段可以采集静态证据，但不得提前给出依赖该硬门的结论。

| 阶段 | 名称         | 必验内容                                                                             | 硬门                                              |
| ---- | ------------ | ------------------------------------------------------------------------------------ | ------------------------------------------------- |
| 0    | 基线冻结     | SHA、剖面、范围、环境、证据规则                                                      | 未选定剖面则禁止产品安全结论（§2.4）              |
| 1    | 信任边界     | `personal_local` 或 `managed_enterprise`、租户边界、沙箱、凭证根、插件权限、设备配对 | 剖面未冻结则本阶段结论为 NOT_COVERED              |
| 2    | 架构         | Gateway、Pi、控制台、WebChat、频道、节点、技能、monorepo                             | 无                                                |
| 3    | API 契约     | WS 请求/响应、WS 事件、HTTP、CLI、Plugin/SDK、Swift 生成客户端                       | 负路径未测则契约结论不得为 PASS                   |
| 4    | 数据持久化   | SoT、写路径、耐久、恢复、备份、还原、读路径；Episode 场景必验                        | `docs/design/*` 不能单独证明 wired                |
| 5    | 可靠性 / HA  | 实现是否存在、激活是否允许、部署是否接线、生产是否批准，四问分开                     | 未批准不得写成生产 HA 通过                        |
| 6    | 质量与供应链 | 测试、lint、CI 运行证据、依赖审计                                                    | 回归与验收分轴（§4.4）；基线未变 ≠ 验收 PASS      |
| 7    | 产品表面     | §5.7：控制台、企业微信 / 飞书 / 钉钉、节点、doctor / onboard。唯一范围权威           | 未列入 §5.7 的表面标 NOT_COVERED。不得再放到 §5.5 |
| 8    | 结论         | 每阶段 PASS / CONDITIONAL / FAIL / NOT_COVERED                                       | P0 无第二人复核不得关闭                           |

§5.5 只保留可观测、性能、正式 SBOM、发布通道，不插入上述顺序，除非评审会升格。产品表面不在 §5.5。

### 4.2 证据优先级与置信度

每条检查仍记录：检查项、证据、方法、通过标准、风险。另加置信度。证据优先级：

1. 基线 SHA 上的源码与测试（可复现命令或测试名）。
2. 可重复命令的退出码与产物。
3. 现行英文文档。与代码冲突时记「文档滞后」或「代码偏离文档」。测试锁定的行为优先。
4. `docs/design/*` 只作意图，是次级证据。`runtime-status: aspirational` 或 DDL-only 不得记成已上线存储。

| 置信度 | 含义                                           | 能否单独支撑 PASS             |
| ------ | ---------------------------------------------- | ----------------------------- |
| E3     | 运行时或测试证据（夹具、vitest、临时目录探针） | 能                            |
| E2     | 确定性命令（退出码、diff、生成物）             | 能，限于该命令覆盖的命题      |
| E1     | 源码检视                                       | 不能单独支撑安全或持久化 PASS |
| E0     | 设计文档或叙述性文档声明                       | 不能支撑 PASS                 |

抽样原则不变：共享热路径全量点名；长尾频道与技能按「产品主路径全查、继承适配器抽样」。抽样名单在 Stage 0 冻结。

### 4.3 严重度

| 级   | 含义                                                                              | 对验收的影响                                   |
| ---- | --------------------------------------------------------------------------------- | ---------------------------------------------- |
| P0   | 信任边界被打破，或契约/数据权威源自相矛盾且可复现                                 | 该阶段 FAIL                                    |
| P1   | 主路径功能、门禁或备份在基线上失败，有文件级根因                                  | FAIL，或带截止日期的 CONDITIONAL（评审会决定） |
| P2   | 文档漂移、死代码、非主路径缺口。§3.3 的 ID-A 至少是这一档；ID-B 可由评审会升到 P1 | 记录，不单独否决。升到 P1 后按 P1 处理         |
| 信息 | 设计目标尚未接线                                                                  | 记入路线图，runtime status 标 aspirational     |

发现单同时写严重度与置信度，例如 `P1/E3`。P0 与 P1 的采集人与复核人必须分开。

### 4.4 回归状态与验收状态

两条轴分开写，禁止用一个词同时表示「没变差」和「产品合格」。

- **回归状态**只回答：相对基线，这次有没有变差，或这次有没有跑成。
- **验收状态**只回答：产品命题是否成立。全文只用 PASS、CONDITIONAL、FAIL、NOT_COVERED。不再使用带空格或带 PASS 后缀的别名。

`BASELINE_UNCHANGED` 不是验收 PASS。格式债与基线相同可以回归合格，同时未缓解的关键依赖漏洞仍可使 Stage 6 验收为 CONDITIONAL 或 FAIL。

#### 回归状态

| 状态               | 含义                                                                                                                      |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| PASS               | 候选该 job 成功，且对比基线无新增失败                                                                                     |
| NEW_REGRESSION     | 候选新增失败，或同一 job 的失败文件、用例比基线多                                                                         |
| BASELINE_UNCHANGED | 候选合并树与当时钉住的可信基线失败签名相同。必须有成对 job 日志。只说明没有新回归。历史起草 SHA 0685 不能单独充当这个基线 |
| NOT_RUN            | 有意未执行：workflow 标 skipped、范围按计划不跑、本环境声明不执行                                                         |
| CANCELLED          | 基础设施或工作流中断：超时、并发取消、runner 失败、被新 run 取代、手动取消                                                |
| UNKNOWN            | 只用于回归归因：可信基线的同名检查没有可比较日志。候选结果已经是 FAIL 时，结果列写 FAIL，不得把结果写成 UNKNOWN           |

`NOT_RUN` 与 `CANCELLED` 都不是干净的「不适用」。必验 job 一旦 `CANCELLED`，不得写成 NOT_COVERED，也不得写成回归 PASS。该检查的验收状态不得为 PASS。

`NOT_COVERED` 是范围决定：评审会把该命题排除在本批之外。`NOT_RUN` 是执行缺口：命题仍在范围内，但这次没有跑。二者不可互换。skipped 是 `NOT_RUN`。cancelled、timeout、runner 失败是 `CANCELLED`。

#### 验收状态

| 状态        | 含义                                                 |
| ----------- | ---------------------------------------------------- |
| PASS        | 该命题在选定剖面与证据置信度下成立                   |
| CONDITIONAL | 主路径有缺口，评审会接受带主人与期限的条件           |
| FAIL        | 命题不成立，或把取消、缺失、基线失败当成通过         |
| NOT_COVERED | 本批范围不包含该命题。不是 skipped，也不是 cancelled |

权威来源是 GitHub Actions 的 run/job 结论与日志，不是 workflow YAML 里的注释。注释可以提示去哪看，不能代替 runner 标签、失败文件列表或断言。

基线对比表五列必须同时在：证据、候选结果、可信基线、回归归因、验收。候选结果不是回归归因。docs-only 是范围事实，不是回归证明。双轴定义以上面两张表为准，不在下文改写。

#### 证据行模式（EvidenceRow）

下面这一块是唯一权威模式。叙述不能增删键。CURRENT 列表里的每一项必须是它的实例：恰好这八个键，不能多，不能少。

```yaml
schema_id: openbot.acceptance.EvidenceRow
schema_version: 1
additional_properties: false
required:
  - candidate_sha
  - execution_baseline_sha
  - evidence_run_id
  - candidate_result
  - regression_status
  - acceptance_status
  - signature
  - evidence_status
candidate_sha: "40-hex"
execution_baseline_sha: "40-hex | UNPINNED"
evidence_run_id: "<run-id>#<job-id>"
candidate_result: "PASS | FAIL | NOT_RUN | CANCELLED"
regression_status: "PASS | NEW_REGRESSION | BASELINE_UNCHANGED | NOT_RUN | CANCELLED | UNKNOWN"
acceptance_status: "PASS | CONDITIONAL | FAIL | NOT_COVERED"
signature: "openbot.acceptance.Signature"
evidence_status: "CURRENT | HISTORICAL"
invariants:
  - "missing any required key => stage8_eligible=false"
  - "evidence_status HISTORICAL => stage8_eligible=false"
  - "HISTORICAL is excluded from the Stage 8 acceptance summary"
  - "execution_baseline_sha UNPINNED => regression_status is not BASELINE_UNCHANGED"
  - "an EvidenceRow acceptance_status PASS is not a Stage 0-8 product PASS"
```

`stage8_eligible=true` 只表示这行可以进摘要。它不把任何 Stage 0–8 产品结论写成 PASS。Stage 0 未执行时，`execution_baseline_sha` 保持 `UNPINNED`。

#### 签名模式（Signature）

八个键冻结。比较是逐字段的 UTF-8 字节相等，不是阅读判断。

```yaml
schema_id: openbot.acceptance.Signature
schema_version: 1
additional_properties: false
required:
  - command
  - exit_code
  - failure_class
  - assertion/error_code
  - affected_files_or_symbols
  - package/advisory_identity
  - severity
  - dependency_reachability
equality: utf8_byte_equality
null_result: UNKNOWN
```

比较器，两名评审必须得到同一个返回值：

```text
fields = [command, exit_code, failure_class, assertion/error_code, affected_files_or_symbols, package/advisory_identity, severity, dependency_reachability]
signatures_equal(a, b):
  if a is null or b is null: return UNKNOWN
  for f in fields:
    if f missing from a or b: return UNKNOWN
    if a[f] is null or b[f] is null: return UNKNOWN
    if utf8_bytes(a[f]) != utf8_bytes(b[f]): return UNEQUAL
  return EQUAL
```

不 trim，不大小写折叠，不把空格或标点看成相同。字符串 `N/A` 只与字符串 `N/A` 相等；`N/A` 不是 `null`。`null` 或键缺失返回 `UNKNOWN`。`EQUAL` 且 `execution_baseline_sha` 为 40 位十六进制，回归状态才可以是 `BASELINE_UNCHANGED`。`EQUAL` 但 `execution_baseline_sha` 为 `UNPINNED` 时，回归状态仍是 `UNKNOWN`。`UNEQUAL` 不是自动的 `NEW_REGRESSION`；没有钉住的基线时仍是 `UNKNOWN`。条数合计不是这八个字段。

下面三组只演示比较器。它们不是账本行，也不把 delivery guard 写成 `BASELINE_UNCHANGED`。

```yaml
delivery_guard_comparator_only:
  ledger_conclusion: UNKNOWN
  not_baseline_unchanged: true
  equal_pair:
    signatures_equal: EQUAL
    regression_status_assigned: null
    candidate:
      command: "scripts/delivery/ledger.test.ts :: production releases.jsonl keeps a single open LIVE row after seq107 record"
      exit_code: "1; Tests 1 failed | 122 passed (123)"
      failure_class: AssertionError
      assertion/error_code: "expected [ 112 ] to deeply equal []; expect(errorSeqs).toEqual([])"
      affected_files_or_symbols: "scripts/delivery/ledger.test.ts; deploy/production/releases.jsonl; errorSeqs; seq 112; open LIVE seq 107"
      package/advisory_identity: "N/A"
      severity: "N/A"
      dependency_reachability: "N/A"
    other:
      command: "scripts/delivery/ledger.test.ts :: production releases.jsonl keeps a single open LIVE row after seq107 record"
      exit_code: "1; Tests 1 failed | 122 passed (123)"
      failure_class: AssertionError
      assertion/error_code: "expected [ 112 ] to deeply equal []; expect(errorSeqs).toEqual([])"
      affected_files_or_symbols: "scripts/delivery/ledger.test.ts; deploy/production/releases.jsonl; errorSeqs; seq 112; open LIVE seq 107"
      package/advisory_identity: "N/A"
      severity: "N/A"
      dependency_reachability: "N/A"
  unequal_pair:
    signatures_equal: UNEQUAL
    regression_status: UNKNOWN
    candidate_assertion/error_code: "expected [ 112 ] to deeply equal []; expect(errorSeqs).toEqual([])"
    other_assertion/error_code: "expected [ 113 ] to deeply equal []; expect(errorSeqs).toEqual([])"
  null_baseline_pair:
    signatures_equal: UNKNOWN
    regression_status: UNKNOWN
    evidence_run_id: "37582511341#112665174405"
    baseline: null
```

`equal_pair` 的八个字符串逐字节相同，比较器返回 `EQUAL`。这组没有 `execution_baseline_sha`，所以不分配 `BASELINE_UNCHANGED`。`unequal_pair` 只差 `112` 与 `113` 一个字节，返回 `UNEQUAL`，回归是 `UNKNOWN`。账本里的 delivery guard 没有基线 Signature，`baseline` 为 `null`，返回 `UNKNOWN`。历史表里同样出现过 `[112]`，不能拿来填这个 `other`。

记账规则：

- 候选结果写 Actions 结论：`PASS`、`FAIL`、`CANCELLED`、`NOT_RUN`。job 已经失败时结果是 `FAIL`。workflow 结束后，结果列不得留下过期的 `UNKNOWN`。
- 回归归因才使用上面的回归状态。`UNKNOWN` 只允许出现在归因列，而且只在可信基线同名或等价检查还没有可比较日志时。
- `BASELINE_UNCHANGED` 只在当前候选合并树与 `execution_baseline_sha` 的成对日志上，失败签名硬字段逐项相同。可信基线是 Stage 0 用 `git fetch origin main` 与 `git rev-parse origin/main` 钉住的当时尖端。`UNPINNED` 或未填硬字段时，失败行的回归是 `UNKNOWN`，不得从 HISTORICAL 表继承。只写「本 PR 是 docs-only」或「没改那个文件」不够。历史起草基线 `0685ce05` 与 `eec7c3a0b` 的配对都不是当前闭合。
- 候选 `FAIL` 不等于 `NEW_REGRESSION`。`NEW_REGRESSION` 需要可信基线该检查通过，或候选签名比基线更差。两边失败且硬字段逐项相同，归因才是 `BASELINE_UNCHANGED`。
- 回归归因不得把验收改成 PASS。失败 job 的「该检查为绿」命题仍是 FAIL。全仓未绿不等于自动归咎本方案 PR。批准本方案不等于任何 Stage 0–8 的产品验收。
- Stage 0 执行前必须 `git fetch origin main`，再 `git rev-parse origin/main`，把打印出的 SHA 钉成可信基线。本轮再次 fetch 的打印值是 `a7bbaf6d14b40f138f677ff3c9c0a90e82de5ace`。上一份打印 `5d250c297c90c4da85de925aacc19586693a8324`、再上一份 `8e8f772b3443c1b0984351d284a5fc05726acb97`、Stage 4 当时的打印 `7f8b49286a10e2c8133a7b476787bdbc05afc5c6`、更早的 `8aa8d5e45baa2022a6b7629ac34d8573fc1374e4` 与 Stage 1 pin `0fd9d2c1c41ff4a3126a3b450fa57b6e157954a1` 已过期。`execution_baseline_sha` 钉成 `a7bbaf6d14b40f138f677ff3c9c0a90e82de5ace`。写 CURRENT 时祖先检查退出码 1；merge `44dec486760f68bb6ddf5a01ff9146deb6d16fd1` 之后退出码 0。没有 rebase。CURRENT 收的是这份 pin 的自检 job，回归是 `UNKNOWN`。Stage 0 候选 `1b910f78ace85d65084ffbe716a55ad0ca6fab17`、合并树 `97e07fdd33787d72ab2736c643c1648ccfd24186` 相对当时 pin `0f16950e171eeb6ac048a7e3b10a25c173ed9980` 的行已改为 HISTORICAL。只有与当前 `execution_baseline_sha` 上已完成 job 的八个签名字段逐字节相同的失败行，回归才是 `BASELINE_UNCHANGED`。安全文件 blob 相同不是 Signature，也不能写成 `BASELINE_UNCHANGED`。pin 上 skipped、未运行，或只打印 `Skipping bun test lane on push events.` 的 success，都不能配对。HISTORICAL 表里相对 `0f16950e1`、`a0303a92689456449127dacd3ace4827cf1fc73c`、`eec7c3a0b` 或 `ebfd22156` 的归因不得抄进 CURRENT。
- Actions 标 skipped 的 job，候选结果是 `NOT_RUN`。不得写成 PASS，不得写成 CANCELLED，也不得继承 `b14b16b80` / `e95314e60` 的 `BASELINE_UNCHANGED`。Stage 6 仍要看、这次却 skipped 的检查无法闭合，验收不得 PASS。

#### CURRENT evidence

本轮 `git fetch origin main` 的打印值是 `a7bbaf6d14b40f138f677ff3c9c0a90e82de5ace`。`execution_baseline_sha` 钉成这一串。下面每一行的 `candidate_sha` 与 `execution_baseline_sha` 都是这份 pin：Actions 检出的是 pin 自己，不是本 PR head，也不是 `1b910f78ace85d65084ffbe716a55ad0ca6fab17`。写这些行时 `git merge-base --is-ancestor origin/main HEAD` 退出码 1，没有 rebase。merge `44dec486760f68bb6ddf5a01ff9146deb6d16fd1` 之后同一检查退出码 0。没有另一份基线 job 日志可做八字段逐字节比较，回归全部是 `UNKNOWN`，不是 `BASELINE_UNCHANGED`。`stage8_eligible` 仍是 false：Stage 2 其余 NOT_COVERED、Stage 3 超时已窄 PASS（含 agent pre-accept join）；API-02 畸形帧已窄 PASS；API-03 策略拒绝已窄 PASS；六列未满（已补部分 E1 + WS 事件部分列）、Stage 4 凭证备份排除与 backup 全链已窄闭合/doctor 迁移 dry-run 已窄 PASS/租户 shard 已窄 PASS/单拍已窄 PASS/知识归档已窄 PASS（阶段仍非 PASS）；Stage 3 WS 事件六列已窄填（含服务端事件去重与 Swift EventFrame backward 窄 PASS）、HA 部署接线 CONDITIONAL（opt-in profile，默认仍无 HA）/Auto FO 未批准/DC NOT_RUN、正式 SBOM 已窄闭合、五条 moderate（yaml GHSA-48c2-rrv3-qjmp；file-type GHSA-j47w-4g3g-c36v；markdown-it GHSA-253c-mchw-3w2r；fast-xml-parser GHSA-jp2q-39xq-3w4g 与 GHSA-gh4j-gqv2-49f6）已窄缓解（阶段仍非 PASS；audit 仍 exit 1）、Stage 7 dingtalk/四设备表面仍 FAIL（移动端 NOT_RUN 探针已记工具链缺口，仍非 PASS）等仍未闭合（Stage 1 跨操作者 store/插件已在后续修复中窄闭合）。第二复核人是「代码仓盘点验收」，接受盘点账本，产品结论不是 PASS。这些行的 `acceptance_status` PASS 只表示该 job 的 Actions 结论，不是 Stage 0–8 产品 PASS。

本 PR head `bf60dc2c21ecaef9c41690bcabff992aeab303d8` 的 Actions 已经终态，但不写 EvidenceRow。11 个 failure job 的 `steps` 为空，日志接口 404，没有命令、退出码或八字段签名。annotation 都是同一句：`The job was not started because recent account payments have failed or your spending limit needs to be increased.` 这不是测试失败，不是 CANCELLED，也不是本 PR 引入的产品红灯。涉及的 run：[37666537089](https://github.com/upbeyond/openbot/actions/runs/37666537089)（CI，docs-scope `112947095065`、secrets `112947094659`、freeze `112947093109`）、[37666536875](https://github.com/upbeyond/openbot/actions/runs/37666536875)（check `112947095909`、delivery guard `112947095312`）、[37666536831](https://github.com/upbeyond/openbot/actions/runs/37666536831)（actionlint `112947094441`、no-tabs `112947093991`）、[37666536807](https://github.com/upbeyond/openbot/actions/runs/37666536807)（docs-scope `112947096902`；install-smoke `112947119617` skipped）、[37666533055](https://github.com/upbeyond/openbot/actions/runs/37666533055)（label `112947080556`、label-issues `112947080911`）、[37666531304](https://github.com/upbeyond/openbot/actions/runs/37666531304)（freeze `112947074720`）。同 head 上 skipped 且无日志的 job 也不写行。`mergeable=MERGEABLE`，`mergeStateStatus=UNSTABLE`。不得当成 CI 已绿。

上一份打印 `5d250c297c90c4da85de925aacc19586693a8324`（#414，chat restore，四个源文件，不是 docs-only）的 workflow 后来都到了终态，但那不是现在的执行基线，所以那些 job 不进 CURRENT：CI [37656787571](https://github.com/upbeyond/openbot/actions/runs/37656787571) 结论 failure；Install Smoke [37656787585](https://github.com/upbeyond/openbot/actions/runs/37656787585) 结论 success；Docker Release [37656787543](https://github.com/upbeyond/openbot/actions/runs/37656787543) 结论 success（build-amd64、build-arm64、create-manifest 都是 success）。这是观察，不是 EvidenceRow。

再上一份 `8e8f772b3443c1b0984351d284a5fc05726acb97`（#412，sandbox desktop，不是 docs-only）也到了终态，不进 CURRENT：CI [37652451120](https://github.com/upbeyond/openbot/actions/runs/37652451120) 结论 failure；Install Smoke [37652451025](https://github.com/upbeyond/openbot/actions/runs/37652451025) 结论 success；Docker Release [37652451235](https://github.com/upbeyond/openbot/actions/runs/37652451235) 结论 failure，jobs API 只有 `create-manifest` `112909713068` 且结论 skipped，日志 zip 为空，`build-amd64` 与 `build-arm64` 不在 jobs 列表里。这是观察，不是 EvidenceRow，也不是 CANCELLED。

本 pin 不是 docs-only。#415 含 markdown 与源文件。docs-scope 步骤跑完后，日志在脚本结束标记之后没有打出 `Docs-only change detected — skipping heavy jobs`。secrets、check-docs、protocol 都实际跑了，check-docs 失败。`7f8b49286` 的 docs-only skip 只描述那一串 SHA，不套到本 pin，也不套到 `5d250c297c90c4da85de925aacc19586693a8324` 或 `8e8f772b3443c1b0984351d284a5fc05726acb97`。

CI workflow [37661176029](https://github.com/upbeyond/openbot/actions/runs/37661176029) 结论 failure。Install Smoke [37661175759](https://github.com/upbeyond/openbot/actions/runs/37661175759) 结论 success。CI Gate [37661175957](https://github.com/upbeyond/openbot/actions/runs/37661175957) 结论 success。Workflow Sanity [37661176049](https://github.com/upbeyond/openbot/actions/runs/37661176049) 结论 success。Memory Workspace Freeze [37661175882](https://github.com/upbeyond/openbot/actions/runs/37661175882) 结论 failure。Docker Release [37661175999](https://github.com/upbeyond/openbot/actions/runs/37661175999) 记账时仍是 in_progress。

没有日志、因此不写 EvidenceRow 的 skipped job：`ios` `112928793918`（workflow 里 `if: false`）、`macos` `112932158741`。六个 checks-windows 分片都已失败并写入 CURRENT。进行中不写成 CANCELLED，也不写行：Docker build-arm64 `112930872767`。已经 success 但本批没有抽日志、因此不写行的 job：Docker build-amd64 `112930882183`、release-check `112932092946`、changed-scope、skills-python、cogniweave 两档、conversation-lifecycle、checks bun、android build、build-artifacts、extensions、Install Smoke 的 docs-scope。

```yaml
- candidate_sha: "a7bbaf6d14b40f138f677ff3c9c0a90e82de5ace"
  execution_baseline_sha: "a7bbaf6d14b40f138f677ff3c9c0a90e82de5ace"
  evidence_run_id: "37661176029#112928791593"
  candidate_result: PASS
  regression_status: UNKNOWN
  acceptance_status: PASS
  signature:
    command: "Detect docs-only changes"
    exit_code: "0"
    failure_class: "N/A"
    assertion/error_code: "step conclusion success; runtime log after the script end marker does not print Docs-only change detected — skipping heavy jobs; secrets job 112928792138 ran; check-docs job 112928995514 ran and failed"
    affected_files_or_symbols: ".github/workflows/ci.yml docs-scope; docs_only; docs_changed"
    package/advisory_identity: "N/A"
    severity: "N/A"
    dependency_reachability: "N/A"
  evidence_status: CURRENT
- candidate_sha: "a7bbaf6d14b40f138f677ff3c9c0a90e82de5ace"
  execution_baseline_sha: "a7bbaf6d14b40f138f677ff3c9c0a90e82de5ace"
  evidence_run_id: "37661176029#112928792138"
  candidate_result: FAIL
  regression_status: UNKNOWN
  acceptance_status: FAIL
  signature:
    command: "pre-commit run --all-files pnpm-audit-prod"
    exit_code: "1"
    failure_class: "audit"
    assertion/error_code: "pnpm-audit-prod Failed; Severity: 9 low | 50 moderate | 2 high | 2 critical; detect-private-key Passed"
    affected_files_or_symbols: "pnpm-audit-prod; detect-private-key"
    package/advisory_identity: "simple-git GHSA-v5rq-49vh-5v5c; simple-git GHSA-x6jw-m9v5-85vh; simple-git GHSA-g4wm-2vf7-vfgr; simple-git GHSA-858h-whjf-mvg5"
    severity: "critical"
    dependency_reachability: "prod audit on the pin tree; this pin does not contain the PR overrides"
  evidence_status: CURRENT
- candidate_sha: "a7bbaf6d14b40f138f677ff3c9c0a90e82de5ace"
  execution_baseline_sha: "a7bbaf6d14b40f138f677ff3c9c0a90e82de5ace"
  evidence_run_id: "37661176029#112928995514"
  candidate_result: FAIL
  regression_status: UNKNOWN
  acceptance_status: FAIL
  signature:
    command: "pnpm check:docs"
    exit_code: "1"
    failure_class: "docs"
    assertion/error_code: "docs/channels/dingtalk.md:49 error MD024/no-duplicate-heading Multiple headings with the same content"
    affected_files_or_symbols: "docs/channels/dingtalk.md; docs/channels/wecom.md; docs/ci/self-hosted-runner.md"
    package/advisory_identity: "N/A"
    severity: "N/A"
    dependency_reachability: "N/A"
  evidence_status: CURRENT
- candidate_sha: "a7bbaf6d14b40f138f677ff3c9c0a90e82de5ace"
  execution_baseline_sha: "a7bbaf6d14b40f138f677ff3c9c0a90e82de5ace"
  evidence_run_id: "37661176029#112929906599"
  candidate_result: FAIL
  regression_status: UNKNOWN
  acceptance_status: FAIL
  signature:
    command: "pnpm protocol:check"
    exit_code: "1"
    failure_class: "protocol"
    assertion/error_code: "git diff --exit-code failed after protocol:gen:swift; GatewayModels.swift adds LocalFilesRedeemParams and ChatHistoryParams.sessionOwnerPlatformUserId"
    affected_files_or_symbols: "apps/macos/Sources/OpenBotProtocol/GatewayModels.swift; apps/shared/OpenBotKit/Sources/OpenBotProtocol/GatewayModels.swift"
    package/advisory_identity: "N/A"
    severity: "N/A"
    dependency_reachability: "N/A"
  evidence_status: CURRENT
- candidate_sha: "a7bbaf6d14b40f138f677ff3c9c0a90e82de5ace"
  execution_baseline_sha: "a7bbaf6d14b40f138f677ff3c9c0a90e82de5ace"
  evidence_run_id: "37661175882#112928790102"
  candidate_result: FAIL
  regression_status: UNKNOWN
  acceptance_status: FAIL
  signature:
    command: "node --import tsx memory-workspace-phase0-inventory.mjs --mode freeze --baseline-blob"
    exit_code: "1"
    failure_class: "freeze"
    assertion/error_code: "ok false; addedProductionHelpers includes resolveSandboxWorkspaceDir and resolveTenantDataRootWorkspaceDir"
    affected_files_or_symbols: "src/agents/sandbox/shared.ts resolveSandboxWorkspaceDir; src/gateway/tenant-context.ts resolveTenantDataRootWorkspaceDir"
    package/advisory_identity: "N/A"
    severity: "N/A"
    dependency_reachability: "N/A"
  evidence_status: CURRENT
- candidate_sha: "a7bbaf6d14b40f138f677ff3c9c0a90e82de5ace"
  execution_baseline_sha: "a7bbaf6d14b40f138f677ff3c9c0a90e82de5ace"
  evidence_run_id: "37661176049#112928790733"
  candidate_result: PASS
  regression_status: UNKNOWN
  acceptance_status: PASS
  signature:
    command: "actionlint"
    exit_code: "0"
    failure_class: "N/A"
    assertion/error_code: "actionlint 1.7.11 job conclusion success; log has no ##[error]"
    affected_files_or_symbols: "actionlint"
    package/advisory_identity: "N/A"
    severity: "N/A"
    dependency_reachability: "N/A"
  evidence_status: CURRENT
- candidate_sha: "a7bbaf6d14b40f138f677ff3c9c0a90e82de5ace"
  execution_baseline_sha: "a7bbaf6d14b40f138f677ff3c9c0a90e82de5ace"
  evidence_run_id: "37661176049#112928790386"
  candidate_result: PASS
  regression_status: UNKNOWN
  acceptance_status: PASS
  signature:
    command: "python workflow tab scan"
    exit_code: "0"
    failure_class: "N/A"
    assertion/error_code: "job conclusion success; Tabs found in workflow file(s) appears only inside the step script, not as a result line after the script end marker"
    affected_files_or_symbols: ".github/workflows"
    package/advisory_identity: "N/A"
    severity: "N/A"
    dependency_reachability: "N/A"
  evidence_status: CURRENT
- candidate_sha: "a7bbaf6d14b40f138f677ff3c9c0a90e82de5ace"
  execution_baseline_sha: "a7bbaf6d14b40f138f677ff3c9c0a90e82de5ace"
  evidence_run_id: "37661175957#112928790760"
  candidate_result: PASS
  regression_status: UNKNOWN
  acceptance_status: PASS
  signature:
    command: "pnpm vitest run scripts/delivery"
    exit_code: "0"
    failure_class: "N/A"
    assertion/error_code: "Tests 123 passed (123); ledger: 110 releases, 0 errors, 30 warnings"
    affected_files_or_symbols: "scripts/delivery; deploy/production/releases.jsonl"
    package/advisory_identity: "N/A"
    severity: "N/A"
    dependency_reachability: "N/A"
  evidence_status: CURRENT
- candidate_sha: "a7bbaf6d14b40f138f677ff3c9c0a90e82de5ace"
  execution_baseline_sha: "a7bbaf6d14b40f138f677ff3c9c0a90e82de5ace"
  evidence_run_id: "37661175957#112928791158"
  candidate_result: PASS
  regression_status: UNKNOWN
  acceptance_status: CONDITIONAL
  signature:
    command: "pnpm lint:ui:capability-boundaries"
    exit_code: "1"
    failure_class: "shadow-lint"
    assertion/error_code: "OpenBot UI boundary check failed: ui/src/ui/app.ts unexpected direct controller import ui/src/ui/controllers/admin-activation-email-receipt.ts; job conclusion success"
    affected_files_or_symbols: "ui/src/ui/app.ts; src/gateway/platform-auth/auth-helpers.ts"
    package/advisory_identity: "N/A"
    severity: "N/A"
    dependency_reachability: "N/A"
  evidence_status: CURRENT
- candidate_sha: "a7bbaf6d14b40f138f677ff3c9c0a90e82de5ace"
  execution_baseline_sha: "a7bbaf6d14b40f138f677ff3c9c0a90e82de5ace"
  evidence_run_id: "37661176029#112929906450"
  candidate_result: FAIL
  regression_status: UNKNOWN
  acceptance_status: FAIL
  signature:
    command: "pnpm check"
    exit_code: "2"
    failure_class: "typecheck"
    assertion/error_code: "src/agents/sandbox/account-file-transfer.test.ts(32,8): error TS2459 Module declares SharedBrowserMigrationSession locally, but it is not exported"
    affected_files_or_symbols: "src/agents/sandbox/account-file-transfer.test.ts; src/agents/sandbox/account-worker.test.ts; src/gateway/server-methods/secure-form.ts"
    package/advisory_identity: "N/A"
    severity: "N/A"
    dependency_reachability: "N/A"
  evidence_status: CURRENT
- candidate_sha: "a7bbaf6d14b40f138f677ff3c9c0a90e82de5ace"
  execution_baseline_sha: "a7bbaf6d14b40f138f677ff3c9c0a90e82de5ace"
  evidence_run_id: "37661176029#112929906610"
  candidate_result: FAIL
  regression_status: UNKNOWN
  acceptance_status: FAIL
  signature:
    command: "pnpm test"
    exit_code: "1"
    failure_class: "test"
    assertion/error_code: "Test Files 104 failed | 374 passed (478); ERR_VM_MODULE_DIFFERENT_CONTEXT"
    affected_files_or_symbols: "vitest node test lane"
    package/advisory_identity: "N/A"
    severity: "N/A"
    dependency_reachability: "N/A"
  evidence_status: CURRENT
- candidate_sha: "a7bbaf6d14b40f138f677ff3c9c0a90e82de5ace"
  execution_baseline_sha: "a7bbaf6d14b40f138f677ff3c9c0a90e82de5ace"
  evidence_run_id: "37661176029#112929906347"
  candidate_result: FAIL
  regression_status: UNKNOWN
  acceptance_status: FAIL
  signature:
    command: "./gradlew --no-daemon :app:testDebugUnitTest"
    exit_code: "1"
    failure_class: "test"
    assertion/error_code: "java.lang.IllegalAccessException at AccessibleObject.java:714; BUILD FAILED"
    affected_files_or_symbols: "apps/android unit tests"
    package/advisory_identity: "N/A"
    severity: "N/A"
    dependency_reachability: "N/A"
  evidence_status: CURRENT
- candidate_sha: "a7bbaf6d14b40f138f677ff3c9c0a90e82de5ace"
  execution_baseline_sha: "a7bbaf6d14b40f138f677ff3c9c0a90e82de5ace"
  evidence_run_id: "37661175759#112928889043"
  candidate_result: PASS
  regression_status: UNKNOWN
  acceptance_status: PASS
  signature:
    command: "bash scripts/test-install-sh-docker.sh"
    exit_code: "0"
    failure_class: "N/A"
    assertion/error_code: "job conclusion success; https://openbot.love/install.sh ok; cli=openbot installed=1.0.1 expected=1.0.1; Sanity: CLI runs then OK for root and non-root; Dockerfile smoke printed OpenBot 2026.7.12-rc.2"
    affected_files_or_symbols: "scripts/test-install-sh-docker.sh; https://openbot.love/install.sh"
    package/advisory_identity: "N/A"
    severity: "N/A"
    dependency_reachability: "N/A"
  evidence_status: CURRENT
- candidate_sha: "a7bbaf6d14b40f138f677ff3c9c0a90e82de5ace"
  execution_baseline_sha: "a7bbaf6d14b40f138f677ff3c9c0a90e82de5ace"
  evidence_run_id: "37661176029#112929906783"
  candidate_result: FAIL
  regression_status: UNKNOWN
  acceptance_status: FAIL
  signature:
    command: "pnpm test"
    exit_code: "1"
    failure_class: "test"
    assertion/error_code: "checks-windows 2/6; Test Files 4 failed | 314 passed | 1 skipped (319); AssertionError expected undefined to be defined; Error spawnSync pnpm.cmd EINVAL; expected match to be differs; expected undefined to be passwd"
    affected_files_or_symbols: "test/appcast.test.ts; src/memory/health-probe.oxlint.test.ts; scripts/__tests__/governance/discard-verify.test.ts; src/shared/preview-artifact/deliverable-envelope.test.ts"
    package/advisory_identity: "N/A"
    severity: "N/A"
    dependency_reachability: "N/A"
  evidence_status: CURRENT
- candidate_sha: "a7bbaf6d14b40f138f677ff3c9c0a90e82de5ace"
  execution_baseline_sha: "a7bbaf6d14b40f138f677ff3c9c0a90e82de5ace"
  evidence_run_id: "37661176029#112929906627"
  candidate_result: FAIL
  regression_status: UNKNOWN
  acceptance_status: FAIL
  signature:
    command: "pnpm test"
    exit_code: "1"
    failure_class: "test"
    assertion/error_code: "checks-windows 3/6; Test Files 7 failed | 310 passed | 1 skipped (318); AssertionError expected false to be true; camera temp path expected an openclaw prefix"
    affected_files_or_symbols: "scripts/ci-diagnostic-delta.test.ts; src/cli/nodes-camera.test.ts; src/infra/exec-approvals.test.ts; src/memory/item7-w3-catalog-synthesis.test.ts; src/memory/u0-boundary-freeze.test.ts; scripts/__tests__/governance/worktree-archive.test.ts; src/vault-sync/store/object-upload-direct.node.test.ts"
    package/advisory_identity: "N/A"
    severity: "N/A"
    dependency_reachability: "N/A"
  evidence_status: CURRENT

- candidate_sha: "a7bbaf6d14b40f138f677ff3c9c0a90e82de5ace"
  execution_baseline_sha: "a7bbaf6d14b40f138f677ff3c9c0a90e82de5ace"
  evidence_run_id: "37661176029#112929906649"
  candidate_result: FAIL
  regression_status: UNKNOWN
  acceptance_status: FAIL
  signature:
    command: "pnpm test"
    exit_code: "1"
    failure_class: "test"
    assertion/error_code: "checks-windows 5/6; Test Files 12 failed | 305 passed | 1 skipped (318); AssertionError expected 2.0.0 to be 0.0.0"
    affected_files_or_symbols: "src/version.test.ts; src/config/sessions.test.ts; src/conversations/conversation-lifecycle.p0.test.ts; src/memory/cogniweave-manager.handle-dark.test.ts; src/memory/cogniweave-manager.lifecycle.test.ts; src/memory/item7-w4-steward-helpers.test.ts; src/memory/manager.get-concurrency.test.ts; src/secrets/target-registry.test.ts; scripts/__tests__/loom/provision.test.ts; src/cli/program/register.data.test.ts; src/node-host/local-files/handlers.test.ts; ui/src/ui/ports/enterprise/views/enterprise-evolution-decision-surface.node.test.ts"
    package/advisory_identity: "N/A"
    severity: "N/A"
    dependency_reachability: "N/A"
  evidence_status: CURRENT
- candidate_sha: "a7bbaf6d14b40f138f677ff3c9c0a90e82de5ace"
  execution_baseline_sha: "a7bbaf6d14b40f138f677ff3c9c0a90e82de5ace"
  evidence_run_id: "37661176029#112929906591"
  candidate_result: FAIL
  regression_status: UNKNOWN
  acceptance_status: FAIL
  signature:
    command: "pnpm test"
    exit_code: "1"
    failure_class: "test"
    assertion/error_code: "checks-windows 6/6; Test Files 10 failed | 308 passed (318); AssertionError missing label for help key agents.defaults.heartbeat.every; Error EBUSY unlink config-store.db"
    affected_files_or_symbols: "src/config/schema.help.quality.test.ts; src/conversation-task/runtime-bootstrap.test.ts; src/diagnosis/diagnose-growth-locator.test.ts; src/diagnosis/report-query-production-approval.test.ts; src/infra/state-migrations.state-dir.test.ts; src/memory/manager-search-operation-boundary.oxlint.test.ts; src/memory/query-atoms-acl.test.ts; src/pairing/pairing-messages.test.ts; src/vault-sync/store/revoke-and-rotate.node.test.ts; ui/src/ui/ports/employee/views/employee-evolution-decision-section.node.test.ts"
    package/advisory_identity: "N/A"
    severity: "N/A"
    dependency_reachability: "N/A"
  evidence_status: CURRENT

- candidate_sha: "a7bbaf6d14b40f138f677ff3c9c0a90e82de5ace"
  execution_baseline_sha: "a7bbaf6d14b40f138f677ff3c9c0a90e82de5ace"
  evidence_run_id: "37661176029#112929906592"
  candidate_result: FAIL
  regression_status: UNKNOWN
  acceptance_status: FAIL
  signature:
    command: "pnpm test"
    exit_code: "1"
    failure_class: "test"
    assertion/error_code: "checks-windows 1/6; Test Files 9 failed | 308 passed | 2 skipped (319); Error Command failed cat oxfmt-args.txt; AssertionError expected [] to deeply equal [ Array(1) ]"
    affected_files_or_symbols: "test/git-hooks-pre-commit.test.ts; test/constitutional-governance-state-convergence.test.ts; src/config/talk-defaults.test.ts; src/conversation-task/shadow-observer.test.ts; src/infra/system-presence.version.test.ts; src/memory/cogniweave-manager.test.ts; src/cron/isolated-agent/delivery-dispatch.named-agent.test.ts; src/plugins/__tests__/loader-registry-roundtrip.test.ts; ui/src/ui/browser-runtime-imports.node.test.ts; ui/src/ui/workspace-compose-ui.node.test.ts"
    package/advisory_identity: "N/A"
    severity: "N/A"
    dependency_reachability: "N/A"
  evidence_status: CURRENT
- candidate_sha: "a7bbaf6d14b40f138f677ff3c9c0a90e82de5ace"
  execution_baseline_sha: "a7bbaf6d14b40f138f677ff3c9c0a90e82de5ace"
  evidence_run_id: "37661176029#112929906740"
  candidate_result: FAIL
  regression_status: UNKNOWN
  acceptance_status: FAIL
  signature:
    command: "pnpm test"
    exit_code: "1"
    failure_class: "test"
    assertion/error_code: "checks-windows 4/6; Test Files 7 failed | 309 passed | 2 skipped (318); Error Command failed worktree-audit.ts"
    affected_files_or_symbols: "test/worktree-audit.test.ts; src/conversation-task/cross-process-consult-persist.test.ts; src/conversation-task/gateway-shadow-hook.test.ts; src/diagnosis/structural-preview-sources.a8.test.ts; src/memory/manager.mistral-provider.test.ts; src/providers/google-shared.ensures-function-call-comes-after-user-turn.test.ts; ui/src/ui/chat/chat-session-dividers.node.test.ts"
    package/advisory_identity: "N/A"
    severity: "N/A"
    dependency_reachability: "N/A"
  evidence_status: CURRENT
```

EvidenceRow 的 PASS 不是产品 PASS。secrets 行的 critical 是 pin 树自己的 `pnpm-audit-prod`，这份 pin 没有本 PR 的 override。protocol 行是 pin 上生成的 Swift 与已提交文件不一致，不是本 PR 的 protocol:check。CI Gate check 的 job 结论是 success，shadow 步骤日志退出码 1，所以该行验收是 CONDITIONAL。install-smoke 行是 pin 自检 PASS。六个 checks-windows 分片都是 FAIL。Docker build-arm64 仍 in_progress，不是行。

#### Historical candidate evidence — 1b910f78a

`evidence_status=HISTORICAL`，`stage8_eligible=false`。Stage 0 冻结用的 `candidate_sha` 是 `1b910f78ace85d65084ffbe716a55ad0ca6fab17`。Actions 检出的合并树是 `97e07fdd33787d72ab2736c643c1648ccfd24186`（`Merge 1b910f78ace85d65084ffbe716a55ad0ca6fab17 into a0303a92689456449127dacd3ace4827cf1fc73c`）。这些行自己的 `execution_baseline_sha` 仍是当时的 pin `0f16950e171eeb6ac048a7e3b10a25c173ed9980`。现在的执行基线是 `a7bbaf6d14b40f138f677ff3c9c0a90e82de5ace`。合并父提交 `a0303a92689456449127dacd3ace4827cf1fc73c` 也不是现在的 pin。下面每一行都来自这个 tip 的真实 job。这些行的 `BASELINE_UNCHANGED` 不抄进 CURRENT。不把 `3a16e0b07`、`448a40551` 或 `a6fc195` 的 run 抄进来。批准本方案不是产品 Stage PASS。本 Stage 0 不宣称 Stage 1–8 产品 PASS。

run 是 [37616465152](https://github.com/upbeyond/openbot/actions/runs/37616465152)、[37616464899](https://github.com/upbeyond/openbot/actions/runs/37616464899)、[37616465180](https://github.com/upbeyond/openbot/actions/runs/37616465180)、[37616465245](https://github.com/upbeyond/openbot/actions/runs/37616465245)、[37616464957](https://github.com/upbeyond/openbot/actions/runs/37616464957)。

check-docs job `112776114617` 只有一条：`candidate_result: FAIL`，`acceptance_status: FAIL`，`exit_code: 1`。方案文件不在失败列表里，这只是观察，不是第二条 PASS 行。pin 的 check-docs job `112778778851` 是 skipped，回归是 UNKNOWN。bun job `112776474893` 失败；pin job `112779260753` 的 success 只打印了 `Skipping bun test lane on push events.`，回归是 UNKNOWN，不是 `NEW_REGRESSION`。Windows `3/6` 的计数与 pin 分片不一致，回归是 UNKNOWN。其余五片 Windows 的失败摘要与 pin 相同，回归是 `BASELINE_UNCHANGED`，验收仍是 FAIL，这些片仍在 Stage 6 内。Memory Workspace Freeze 没有出现在这次 pin 的 push 上，该行回归是 UNKNOWN，不继承 HISTORICAL。`BASELINE_UNCHANGED` 只来自与 `0f16950e171eeb6ac048a7e3b10a25c173ed9980` 完成日志逐字节相同的签名。install-smoke job 失败；同 workflow 的 docs-scope success 是另一行。CI Gate 的 check 与 CI 的 check 是两条 EvidenceRow。

Stage 0 当时把信任剖面记为「未选定」，抽样名单未冻结，所以这些行没有隔离、沙箱、凭证根、插件权限或配对的产品安全结论。Stage 1 的两份结论写在 §5.0 执行记录。

```yaml
- candidate_sha: "1b910f78ace85d65084ffbe716a55ad0ca6fab17"
  execution_baseline_sha: "0f16950e171eeb6ac048a7e3b10a25c173ed9980"
  evidence_run_id: "37616465152#112775874335"
  candidate_result: FAIL
  regression_status: BASELINE_UNCHANGED
  acceptance_status: FAIL
  signature:
    command: "scripts/delivery/ledger.test.ts :: production releases.jsonl keeps a single open LIVE row after seq107 record"
    exit_code: "1; Tests 1 failed | 122 passed (123)"
    failure_class: "AssertionError"
    assertion/error_code: "expected [ 112 ] to deeply equal []; expect(errorSeqs).toEqual([])"
    affected_files_or_symbols: "scripts/delivery/ledger.test.ts; deploy/production/releases.jsonl; errorSeqs; seq 112; open LIVE seq 107"
    package/advisory_identity: "N/A"
    severity: "N/A"
    dependency_reachability: "N/A"
  evidence_status: HISTORICAL
- candidate_sha: "1b910f78ace85d65084ffbe716a55ad0ca6fab17"
  execution_baseline_sha: "0f16950e171eeb6ac048a7e3b10a25c173ed9980"
  evidence_run_id: "37616465152#112775873920"
  candidate_result: FAIL
  regression_status: BASELINE_UNCHANGED
  acceptance_status: FAIL
  signature:
    command: "pnpm format:check"
    exit_code: "1"
    failure_class: "format"
    assertion/error_code: "Format issues found in above 1 files"
    affected_files_or_symbols: "scripts/sandbox-browser-start.html"
    package/advisory_identity: "N/A"
    severity: "N/A"
    dependency_reachability: "N/A"
  evidence_status: HISTORICAL
- candidate_sha: "1b910f78ace85d65084ffbe716a55ad0ca6fab17"
  execution_baseline_sha: "0f16950e171eeb6ac048a7e3b10a25c173ed9980"
  evidence_run_id: "37616465180#112775872658"
  candidate_result: FAIL
  regression_status: UNKNOWN
  acceptance_status: FAIL
  signature:
    command: "node --import tsx memory-workspace-phase0-inventory.mjs --mode freeze --baseline-blob"
    exit_code: "1"
    failure_class: "freeze"
    assertion/error_code: "addedProductionHelpers"
    affected_files_or_symbols: "resolveSandboxWorkspaceDir src/agents/sandbox/shared.ts:20; resolveCollaborationRunWorkspaceDir src/auto-reply/reply/runtime-context-assembly.ts:62; resolveSessionContinuityWorkspaceDir src/auto-reply/reply/session-continuity.ts:405; resolveTenantDataRootWorkspaceDir src/gateway/tenant-context.ts:953"
    package/advisory_identity: "N/A"
    severity: "N/A"
    dependency_reachability: "N/A"
  evidence_status: HISTORICAL
- candidate_sha: "1b910f78ace85d65084ffbe716a55ad0ca6fab17"
  execution_baseline_sha: "0f16950e171eeb6ac048a7e3b10a25c173ed9980"
  evidence_run_id: "37616465245#112775873401"
  candidate_result: PASS
  regression_status: UNKNOWN
  acceptance_status: PASS
  signature:
    command: "actions job conclusion success"
    exit_code: "0"
    failure_class: "N/A"
    assertion/error_code: "assertion text not extracted"
    affected_files_or_symbols: "N/A"
    package/advisory_identity: "N/A"
    severity: "N/A"
    dependency_reachability: "N/A"
  evidence_status: HISTORICAL
- candidate_sha: "1b910f78ace85d65084ffbe716a55ad0ca6fab17"
  execution_baseline_sha: "0f16950e171eeb6ac048a7e3b10a25c173ed9980"
  evidence_run_id: "37616465245#112776385075"
  candidate_result: FAIL
  regression_status: BASELINE_UNCHANGED
  acceptance_status: FAIL
  signature:
    command: "pnpm build:docker"
    exit_code: "1"
    failure_class: "TS18047"
    assertion/error_code: "src/agents/sandbox/account-worker-gateway.ts(50,9): error TS18047: 'head' is possibly 'null'.; src/agents/sandbox/account-worker-gateway.ts(51,10): error TS18047: 'head' is possibly 'null'."
    affected_files_or_symbols: "src/agents/sandbox/account-worker-gateway.ts"
    package/advisory_identity: "N/A"
    severity: "N/A"
    dependency_reachability: "N/A"
  evidence_status: HISTORICAL
- candidate_sha: "1b910f78ace85d65084ffbe716a55ad0ca6fab17"
  execution_baseline_sha: "0f16950e171eeb6ac048a7e3b10a25c173ed9980"
  evidence_run_id: "37616464957#112775872737"
  candidate_result: PASS
  regression_status: UNKNOWN
  acceptance_status: PASS
  signature:
    command: "actions job conclusion success"
    exit_code: "0"
    failure_class: "N/A"
    assertion/error_code: "assertion text not extracted"
    affected_files_or_symbols: "N/A"
    package/advisory_identity: "N/A"
    severity: "N/A"
    dependency_reachability: "N/A"
  evidence_status: HISTORICAL
- candidate_sha: "1b910f78ace85d65084ffbe716a55ad0ca6fab17"
  execution_baseline_sha: "0f16950e171eeb6ac048a7e3b10a25c173ed9980"
  evidence_run_id: "37616464957#112775872286"
  candidate_result: PASS
  regression_status: UNKNOWN
  acceptance_status: PASS
  signature:
    command: "actions job conclusion success"
    exit_code: "0"
    failure_class: "N/A"
    assertion/error_code: "assertion text not extracted"
    affected_files_or_symbols: "N/A"
    package/advisory_identity: "N/A"
    severity: "N/A"
    dependency_reachability: "N/A"
  evidence_status: HISTORICAL
- candidate_sha: "1b910f78ace85d65084ffbe716a55ad0ca6fab17"
  execution_baseline_sha: "0f16950e171eeb6ac048a7e3b10a25c173ed9980"
  evidence_run_id: "37616464899#112775873067"
  candidate_result: PASS
  regression_status: UNKNOWN
  acceptance_status: PASS
  signature:
    command: "actions job conclusion success"
    exit_code: "0"
    failure_class: "N/A"
    assertion/error_code: "assertion text not extracted"
    affected_files_or_symbols: "N/A"
    package/advisory_identity: "N/A"
    severity: "N/A"
    dependency_reachability: "N/A"
  evidence_status: HISTORICAL
- candidate_sha: "1b910f78ace85d65084ffbe716a55ad0ca6fab17"
  execution_baseline_sha: "0f16950e171eeb6ac048a7e3b10a25c173ed9980"
  evidence_run_id: "37616464899#112775872682"
  candidate_result: FAIL
  regression_status: BASELINE_UNCHANGED
  acceptance_status: FAIL
  signature:
    command: "pre-commit run --all-files pnpm-audit-prod"
    exit_code: "1"
    failure_class: "audit-hook"
    assertion/error_code: "pnpm-audit-prod failed; count line is not a signature"
    affected_files_or_symbols: ".>node-llama-cpp>simple-git>@simple-git/argv-parser; .>node-llama-cpp>simple-git; .>express>proxy-addr"
    package/advisory_identity: "@simple-git/argv-parser GHSA-v5rq-49vh-5v5c <2.0.1; simple-git GHSA-x6jw-m9v5-85vh >=3.15.0 <4.0.1; proxy-addr GHSA-jqcg-44mw-7w3h >=1.1.0 <2.0.8"
    severity: "critical"
    dependency_reachability: "pnpm-audit-prod"
  evidence_status: HISTORICAL
- candidate_sha: "1b910f78ace85d65084ffbe716a55ad0ca6fab17"
  execution_baseline_sha: "0f16950e171eeb6ac048a7e3b10a25c173ed9980"
  evidence_run_id: "37616464899#112775874395"
  candidate_result: NOT_RUN
  regression_status: NOT_RUN
  acceptance_status: FAIL
  signature:
    command: "not-executed"
    exit_code: "skipped"
    failure_class: "not-executed"
    assertion/error_code: "job skipped"
    affected_files_or_symbols: "N/A"
    package/advisory_identity: "N/A"
    severity: "N/A"
    dependency_reachability: "N/A"
  evidence_status: HISTORICAL
- candidate_sha: "1b910f78ace85d65084ffbe716a55ad0ca6fab17"
  execution_baseline_sha: "0f16950e171eeb6ac048a7e3b10a25c173ed9980"
  evidence_run_id: "37616464899#112776114617"
  candidate_result: FAIL
  regression_status: UNKNOWN
  acceptance_status: FAIL
  signature:
    command: "pnpm check:docs"
    exit_code: "1"
    failure_class: "markdownlint"
    assertion/error_code: "markdownlint-cli2 v0.23.3 (markdownlint v0.41.1); ELIFECYCLE Command failed with exit code 1"
    affected_files_or_symbols: "not-extracted"
    package/advisory_identity: "N/A"
    severity: "N/A"
    dependency_reachability: "N/A"
  evidence_status: HISTORICAL
- candidate_sha: "1b910f78ace85d65084ffbe716a55ad0ca6fab17"
  execution_baseline_sha: "0f16950e171eeb6ac048a7e3b10a25c173ed9980"
  evidence_run_id: "37616464899#112776114693"
  candidate_result: PASS
  regression_status: UNKNOWN
  acceptance_status: PASS
  signature:
    command: "actions job conclusion success"
    exit_code: "0"
    failure_class: "N/A"
    assertion/error_code: "assertion text not extracted"
    affected_files_or_symbols: "N/A"
    package/advisory_identity: "N/A"
    severity: "N/A"
    dependency_reachability: "N/A"
  evidence_status: HISTORICAL
- candidate_sha: "1b910f78ace85d65084ffbe716a55ad0ca6fab17"
  execution_baseline_sha: "0f16950e171eeb6ac048a7e3b10a25c173ed9980"
  evidence_run_id: "37616464899#112776476995"
  candidate_result: NOT_RUN
  regression_status: NOT_RUN
  acceptance_status: FAIL
  signature:
    command: "not-executed"
    exit_code: "skipped"
    failure_class: "not-executed"
    assertion/error_code: "job skipped"
    affected_files_or_symbols: "N/A"
    package/advisory_identity: "N/A"
    severity: "N/A"
    dependency_reachability: "N/A"
  evidence_status: HISTORICAL
- candidate_sha: "1b910f78ace85d65084ffbe716a55ad0ca6fab17"
  execution_baseline_sha: "0f16950e171eeb6ac048a7e3b10a25c173ed9980"
  evidence_run_id: "37616464899#112776474789"
  candidate_result: FAIL
  regression_status: BASELINE_UNCHANGED
  acceptance_status: FAIL
  signature:
    command: "pnpm build"
    exit_code: "1"
    failure_class: "TS18047"
    assertion/error_code: "src/agents/sandbox/account-worker-gateway.ts(50,9): error TS18047: 'head' is possibly 'null'.; src/agents/sandbox/account-worker-gateway.ts(51,10): error TS18047: 'head' is possibly 'null'."
    affected_files_or_symbols: "src/agents/sandbox/account-worker-gateway.ts"
    package/advisory_identity: "N/A"
    severity: "N/A"
    dependency_reachability: "N/A"
  evidence_status: HISTORICAL
- candidate_sha: "1b910f78ace85d65084ffbe716a55ad0ca6fab17"
  execution_baseline_sha: "0f16950e171eeb6ac048a7e3b10a25c173ed9980"
  evidence_run_id: "37616464899#112776474714"
  candidate_result: FAIL
  regression_status: BASELINE_UNCHANGED
  acceptance_status: FAIL
  signature:
    command: "pnpm format:check"
    exit_code: "1"
    failure_class: "format"
    assertion/error_code: "Format issues found in above 1 files"
    affected_files_or_symbols: "scripts/sandbox-browser-start.html"
    package/advisory_identity: "N/A"
    severity: "N/A"
    dependency_reachability: "N/A"
  evidence_status: HISTORICAL
- candidate_sha: "1b910f78ace85d65084ffbe716a55ad0ca6fab17"
  execution_baseline_sha: "0f16950e171eeb6ac048a7e3b10a25c173ed9980"
  evidence_run_id: "37616464899#112776474794"
  candidate_result: PASS
  regression_status: UNKNOWN
  acceptance_status: PASS
  signature:
    command: "actions job conclusion success"
    exit_code: "0"
    failure_class: "N/A"
    assertion/error_code: "assertion text not extracted"
    affected_files_or_symbols: "N/A"
    package/advisory_identity: "N/A"
    severity: "N/A"
    dependency_reachability: "N/A"
  evidence_status: HISTORICAL
- candidate_sha: "1b910f78ace85d65084ffbe716a55ad0ca6fab17"
  execution_baseline_sha: "0f16950e171eeb6ac048a7e3b10a25c173ed9980"
  evidence_run_id: "37616464899#112776474588"
  candidate_result: PASS
  regression_status: UNKNOWN
  acceptance_status: PASS
  signature:
    command: "actions job conclusion success"
    exit_code: "0"
    failure_class: "N/A"
    assertion/error_code: "assertion text not extracted"
    affected_files_or_symbols: "N/A"
    package/advisory_identity: "N/A"
    severity: "N/A"
    dependency_reachability: "N/A"
  evidence_status: HISTORICAL
- candidate_sha: "1b910f78ace85d65084ffbe716a55ad0ca6fab17"
  execution_baseline_sha: "0f16950e171eeb6ac048a7e3b10a25c173ed9980"
  evidence_run_id: "37616464899#112776474946"
  candidate_result: PASS
  regression_status: UNKNOWN
  acceptance_status: PASS
  signature:
    command: "actions job conclusion success"
    exit_code: "0"
    failure_class: "N/A"
    assertion/error_code: "assertion text not extracted"
    affected_files_or_symbols: "N/A"
    package/advisory_identity: "N/A"
    severity: "N/A"
    dependency_reachability: "N/A"
  evidence_status: HISTORICAL
- candidate_sha: "1b910f78ace85d65084ffbe716a55ad0ca6fab17"
  execution_baseline_sha: "0f16950e171eeb6ac048a7e3b10a25c173ed9980"
  evidence_run_id: "37616464899#112776474893"
  candidate_result: FAIL
  regression_status: UNKNOWN
  acceptance_status: FAIL
  signature:
    command: "bunx vitest run"
    exit_code: "1"
    failure_class: "vitest"
    assertion/error_code: "Test Files 12 failed | 471 passed (483); Tests 16 failed | 3817 passed | 1 skipped (3834)"
    affected_files_or_symbols: "not-extracted"
    package/advisory_identity: "N/A"
    severity: "N/A"
    dependency_reachability: "N/A"
  evidence_status: HISTORICAL
- candidate_sha: "1b910f78ace85d65084ffbe716a55ad0ca6fab17"
  execution_baseline_sha: "0f16950e171eeb6ac048a7e3b10a25c173ed9980"
  evidence_run_id: "37616464899#112776474879"
  candidate_result: PASS
  regression_status: UNKNOWN
  acceptance_status: PASS
  signature:
    command: "actions job conclusion success"
    exit_code: "0"
    failure_class: "N/A"
    assertion/error_code: "assertion text not extracted"
    affected_files_or_symbols: "N/A"
    package/advisory_identity: "N/A"
    severity: "N/A"
    dependency_reachability: "N/A"
  evidence_status: HISTORICAL
- candidate_sha: "1b910f78ace85d65084ffbe716a55ad0ca6fab17"
  execution_baseline_sha: "0f16950e171eeb6ac048a7e3b10a25c173ed9980"
  evidence_run_id: "37616464899#112776475088"
  candidate_result: FAIL
  regression_status: BASELINE_UNCHANGED
  acceptance_status: FAIL
  signature:
    command: "pnpm test"
    exit_code: "1"
    failure_class: "vitest"
    assertion/error_code: "checks-windows 1/6; Test Files 13 failed | 304 passed | 2 skipped (319); Tests 36 failed | 2550 passed | 18 skipped (2604); Test Files 1 failed | 2 passed (4); Tests 1 failed | 50 passed | 1 skipped (101)"
    affected_files_or_symbols: "not-extracted"
    package/advisory_identity: "N/A"
    severity: "N/A"
    dependency_reachability: "N/A"
  evidence_status: HISTORICAL
- candidate_sha: "1b910f78ace85d65084ffbe716a55ad0ca6fab17"
  execution_baseline_sha: "0f16950e171eeb6ac048a7e3b10a25c173ed9980"
  evidence_run_id: "37616464899#112776475108"
  candidate_result: FAIL
  regression_status: BASELINE_UNCHANGED
  acceptance_status: FAIL
  signature:
    command: "pnpm test"
    exit_code: "1"
    failure_class: "vitest"
    assertion/error_code: "checks-windows 2/6; Test Files 4 failed | 314 passed | 1 skipped (319); Tests 4 failed | 2570 passed | 17 skipped (2591)"
    affected_files_or_symbols: "not-extracted"
    package/advisory_identity: "N/A"
    severity: "N/A"
    dependency_reachability: "N/A"
  evidence_status: HISTORICAL
- candidate_sha: "1b910f78ace85d65084ffbe716a55ad0ca6fab17"
  execution_baseline_sha: "0f16950e171eeb6ac048a7e3b10a25c173ed9980"
  evidence_run_id: "37616464899#112776474997"
  candidate_result: FAIL
  regression_status: UNKNOWN
  acceptance_status: FAIL
  signature:
    command: "pnpm test"
    exit_code: "1"
    failure_class: "vitest"
    assertion/error_code: "checks-windows 3/6; Test Files 10 failed | 307 passed | 1 skipped (318); Tests 15 failed | 2452 passed | 49 skipped (2516)"
    affected_files_or_symbols: "not-extracted"
    package/advisory_identity: "N/A"
    severity: "N/A"
    dependency_reachability: "N/A"
  evidence_status: HISTORICAL
- candidate_sha: "1b910f78ace85d65084ffbe716a55ad0ca6fab17"
  execution_baseline_sha: "0f16950e171eeb6ac048a7e3b10a25c173ed9980"
  evidence_run_id: "37616464899#112776475041"
  candidate_result: FAIL
  regression_status: BASELINE_UNCHANGED
  acceptance_status: FAIL
  signature:
    command: "pnpm test"
    exit_code: "1"
    failure_class: "vitest"
    assertion/error_code: "checks-windows 4/6; Test Files 8 failed | 308 passed | 2 skipped (318); Tests 77 failed | 2178 passed | 6 skipped (2261)"
    affected_files_or_symbols: "not-extracted"
    package/advisory_identity: "N/A"
    severity: "N/A"
    dependency_reachability: "N/A"
  evidence_status: HISTORICAL
- candidate_sha: "1b910f78ace85d65084ffbe716a55ad0ca6fab17"
  execution_baseline_sha: "0f16950e171eeb6ac048a7e3b10a25c173ed9980"
  evidence_run_id: "37616464899#112776474902"
  candidate_result: FAIL
  regression_status: BASELINE_UNCHANGED
  acceptance_status: FAIL
  signature:
    command: "pnpm test"
    exit_code: "1"
    failure_class: "vitest"
    assertion/error_code: "checks-windows 5/6; Test Files 14 failed | 303 passed | 1 skipped (318); Tests 45 failed | 2791 passed | 12 skipped (2848)"
    affected_files_or_symbols: "not-extracted"
    package/advisory_identity: "N/A"
    severity: "N/A"
    dependency_reachability: "N/A"
  evidence_status: HISTORICAL
- candidate_sha: "1b910f78ace85d65084ffbe716a55ad0ca6fab17"
  execution_baseline_sha: "0f16950e171eeb6ac048a7e3b10a25c173ed9980"
  evidence_run_id: "37616464899#112776475036"
  candidate_result: FAIL
  regression_status: BASELINE_UNCHANGED
  acceptance_status: FAIL
  signature:
    command: "pnpm test"
    exit_code: "1"
    failure_class: "vitest"
    assertion/error_code: "checks-windows 6/6; Test Files 17 failed | 301 passed (318); Tests 33 failed | 2513 passed | 3 skipped (2549)"
    affected_files_or_symbols: "not-extracted"
    package/advisory_identity: "N/A"
    severity: "N/A"
    dependency_reachability: "N/A"
  evidence_status: HISTORICAL
- candidate_sha: "1b910f78ace85d65084ffbe716a55ad0ca6fab17"
  execution_baseline_sha: "0f16950e171eeb6ac048a7e3b10a25c173ed9980"
  evidence_run_id: "37616464899#112776474956"
  candidate_result: FAIL
  regression_status: BASELINE_UNCHANGED
  acceptance_status: FAIL
  signature:
    command: "pnpm protocol:gen && pnpm protocol:gen:swift && git diff --exit-code -- dist/protocol.schema.json apps/macos/Sources/OpenBotProtocol/GatewayModels.swift apps/shared/OpenBotKit/Sources/OpenBotProtocol/GatewayModels.swift"
    exit_code: "1"
    failure_class: "git-diff"
    assertion/error_code: "ELIFECYCLE Command failed with exit code 1"
    affected_files_or_symbols: "apps/macos/Sources/OpenBotProtocol/GatewayModels.swift; apps/shared/OpenBotKit/Sources/OpenBotProtocol/GatewayModels.swift; peerDelivery; senderLabel; sourceSessionKey; sessionOwnerPlatformUserId"
    package/advisory_identity: "N/A"
    severity: "N/A"
    dependency_reachability: "N/A"
  evidence_status: HISTORICAL
- candidate_sha: "1b910f78ace85d65084ffbe716a55ad0ca6fab17"
  execution_baseline_sha: "0f16950e171eeb6ac048a7e3b10a25c173ed9980"
  evidence_run_id: "37616464899#112776474952"
  candidate_result: FAIL
  regression_status: BASELINE_UNCHANGED
  acceptance_status: FAIL
  signature:
    command: "pnpm canvas:a2ui:bundle && pnpm test"
    exit_code: "1"
    failure_class: "vitest"
    assertion/error_code: "Test Files 109 failed | 369 passed (478); Tests 15 failed | 2913 passed | 1 skipped (2929)"
    affected_files_or_symbols: "TalkDefaults.kt; test/appcast.test.ts > appcast.xml > uses canonical sparkle build for the latest stable appcast entry; src/config/talk-defaults.test.ts > talk silence timeout defaults > matches the Apple and Android runtime constants; src/infra/system-presence.version.test.ts > system-presence version fallback > uses runtime VERSION when OPENCLAW_VERSION is not set; src/infra/system-presence.version.test.ts > system-presence version fallback > uses runtime VERSION when OPENCLAW_VERSION and OPENCLAW_SERVICE_VERSION are blank; src/vault-sync/runtime-reindex-hook.node.test.ts > runVaultSyncRuntimeReindex > returns zero matches when root is missing and no knowledgeBaseId; src/vault-sync/runtime-reindex-hook.node.test.ts > runVaultSyncRuntimeReindex > returns zero matches when knowledgeBaseId has no local-folder binding; src/shared/preview-artifact/deliverable-envelope.test.ts > shared deliverable-envelope quoted coverage gate > strips path segments from a declared file so it stays a safe basename; ui/src/ui/storage.node.test.ts > loadSettings default gateway URL derivation > replaces a stale public-home gateway URL when opening a port subdomain; ui/src/ui/workspace-compose-ui.node.test.ts > workspace compose UI targets > renders the context capsule above the compact compose row; ui/src/ui/artifact/event-handler.test.ts > Artifact Event Handler > detectArtifactsInMessage > detects multiple files in one message; ui/src/ui/artifact/registry.test.ts > ArtifactRegistry > Persistence > gets recent artifacts sorted by update time; ui/src/ui/controllers/platform-auth.test.ts > platform auth controller > activates an enterprise admin and reconnects with the new session; ui/src/ui/controllers/platform-auth.test.ts > platform auth controller > requests an enterprise admin session for the dedicated enterprise login; ui/src/ui/controllers/platform-auth.test.ts > platform auth controller > lets a platform admin create an enterprise with explicit trial settings; ui/src/ui/controllers/platform-auth.test.ts > platform auth controller > logs in through the platform admin entry with an explicit role guard"
    package/advisory_identity: "N/A"
    severity: "N/A"
    dependency_reachability: "N/A"
  evidence_status: HISTORICAL
- candidate_sha: "1b910f78ace85d65084ffbe716a55ad0ca6fab17"
  execution_baseline_sha: "0f16950e171eeb6ac048a7e3b10a25c173ed9980"
  evidence_run_id: "37616464899#112777115569"
  candidate_result: PASS
  regression_status: UNKNOWN
  acceptance_status: PASS
  signature:
    command: "actions job conclusion success"
    exit_code: "0"
    failure_class: "N/A"
    assertion/error_code: "assertion text not extracted"
    affected_files_or_symbols: "N/A"
    package/advisory_identity: "N/A"
    severity: "N/A"
    dependency_reachability: "N/A"
  evidence_status: HISTORICAL
- candidate_sha: "1b910f78ace85d65084ffbe716a55ad0ca6fab17"
  execution_baseline_sha: "0f16950e171eeb6ac048a7e3b10a25c173ed9980"
  evidence_run_id: "37616464899#112778305713"
  candidate_result: NOT_RUN
  regression_status: NOT_RUN
  acceptance_status: FAIL
  signature:
    command: "not-executed"
    exit_code: "skipped"
    failure_class: "not-executed"
    assertion/error_code: "job skipped"
    affected_files_or_symbols: "N/A"
    package/advisory_identity: "N/A"
    severity: "N/A"
    dependency_reachability: "N/A"
  evidence_status: HISTORICAL
- candidate_sha: "1b910f78ace85d65084ffbe716a55ad0ca6fab17"
  execution_baseline_sha: "0f16950e171eeb6ac048a7e3b10a25c173ed9980"
  evidence_run_id: "37616464899#112777974159"
  candidate_result: NOT_RUN
  regression_status: NOT_RUN
  acceptance_status: FAIL
  signature:
    command: "not-executed"
    exit_code: "skipped"
    failure_class: "not-executed"
    assertion/error_code: "job skipped"
    affected_files_or_symbols: "N/A"
    package/advisory_identity: "N/A"
    severity: "N/A"
    dependency_reachability: "N/A"
  evidence_status: HISTORICAL
```

#### Historical candidate evidence — 3a16e0b07

`evidence_status=HISTORICAL`，`stage8_eligible=false`。`candidate_sha` 是 `3a16e0b076c55f02cae59c6651adcb8edc18763d`。Actions 检出的合并树是 `6630aac92194d5fccc56b702dbb6dbd5ffe13b81`（`Merge 3a16e0b076c55f02cae59c6651adcb8edc18763d into f0e2aab091d8510c873ba74a66dd2e8efd1ba5a9`）。`execution_baseline_sha` 记录当时的 pin `a0303a92689456449127dacd3ace4827cf1fc73c`，不是现在的执行基线 `7f8b49286a10e2c8133a7b476787bdbc05afc5c6`。合并父提交 `f0e2aab09` 也不是现在的 pin。这些行的 `BASELINE_UNCHANGED` 不抄进 CURRENT。run 是 [37612383101](https://github.com/upbeyond/openbot/actions/runs/37612383101)、[37612383180](https://github.com/upbeyond/openbot/actions/runs/37612383180)、[37612383138](https://github.com/upbeyond/openbot/actions/runs/37612383138)、[37612383132](https://github.com/upbeyond/openbot/actions/runs/37612383132)、[37612383093](https://github.com/upbeyond/openbot/actions/runs/37612383093)。本记账提交会移动 tip，所以这些行不进入 CURRENT。不把 `448a40551` 或 `a6fc195` 的 run 抄进来。

check-docs job `112762612677` 只保留一条：`candidate_result: FAIL`，`acceptance_status: FAIL`，`exit_code: 1`。方案文件不在该 job 的失败列表里，这只是叙述里的观察，不是第二条 PASS 行。pin 上的 check-docs job `112766715605` 是 skipped，没有可比较签名，回归是 UNKNOWN。

bun job `112763028267` 失败。pin job `112766859475` 的结论是 success，但日志只有 `Skipping bun test lane on push events.`，套件没有执行。回归是 UNKNOWN，不是 `NEW_REGRESSION`。

六条 Windows `pnpm test` 都失败，仍在 Stage 6 选定测试子集内。它们与 pin 上同序号分片的 `Test Files` / `Tests` 计数不一致，所以回归是 UNKNOWN，不是 `NEW_REGRESSION`，也不是 NOT_COVERED。Memory Workspace Freeze 没有在这次 pin 的 push 上出现，该行回归是 UNKNOWN，不继承 `f0e2aab09` 的同文日志。

`BASELINE_UNCHANGED` 只用于和 pin 上已完成 job 八个字段逐字节相同的失败行：delivery guard、CI Gate 的 check、CI 的 check、build-artifacts、install-smoke、protocol、node `pnpm test`、secrets 的三条 critical 公告（包、范围、路径、GHSA、严重度；`dependency_reachability` 取日志里的 `pnpm-audit-prod`，条数合计不是签名）。这些行的验收仍是 FAIL。单行 job PASS 不是 Stage 0–8 产品 PASS。install-smoke job 失败；同 workflow 的 docs-scope success 是另一行。CI Gate 的 check 与 CI workflow 的 check 是两条 EvidenceRow。这次 CI Gate check 在 `pnpm format:check` 退出，没有再跑 structural lint。

```yaml
- candidate_sha: "3a16e0b076c55f02cae59c6651adcb8edc18763d"
  execution_baseline_sha: "a0303a92689456449127dacd3ace4827cf1fc73c"
  evidence_run_id: "37612383101#112762496529"
  candidate_result: FAIL
  regression_status: BASELINE_UNCHANGED
  acceptance_status: FAIL
  signature:
    command: "scripts/delivery/ledger.test.ts :: production releases.jsonl keeps a single open LIVE row after seq107 record"
    exit_code: "1; Tests 1 failed | 122 passed (123)"
    failure_class: "AssertionError"
    assertion/error_code: "expected [ 112 ] to deeply equal []; expect(errorSeqs).toEqual([])"
    affected_files_or_symbols: "scripts/delivery/ledger.test.ts; deploy/production/releases.jsonl; errorSeqs; seq 112; open LIVE seq 107"
    package/advisory_identity: "N/A"
    severity: "N/A"
    dependency_reachability: "N/A"
  evidence_status: HISTORICAL
- candidate_sha: "3a16e0b076c55f02cae59c6651adcb8edc18763d"
  execution_baseline_sha: "a0303a92689456449127dacd3ace4827cf1fc73c"
  evidence_run_id: "37612383101#112762496234"
  candidate_result: FAIL
  regression_status: BASELINE_UNCHANGED
  acceptance_status: FAIL
  signature:
    command: "pnpm format:check"
    exit_code: "1"
    failure_class: "format"
    assertion/error_code: "Format issues found in above 1 files"
    affected_files_or_symbols: "scripts/sandbox-browser-start.html"
    package/advisory_identity: "N/A"
    severity: "N/A"
    dependency_reachability: "N/A"
  evidence_status: HISTORICAL
- candidate_sha: "3a16e0b076c55f02cae59c6651adcb8edc18763d"
  execution_baseline_sha: "a0303a92689456449127dacd3ace4827cf1fc73c"
  evidence_run_id: "37612383138#112762495960"
  candidate_result: FAIL
  regression_status: UNKNOWN
  acceptance_status: FAIL
  signature:
    command: "node --import tsx memory-workspace-phase0-inventory.mjs --mode freeze --baseline-blob"
    exit_code: "1"
    failure_class: "freeze"
    assertion/error_code: "addedProductionHelpers"
    affected_files_or_symbols: "resolveSandboxWorkspaceDir src/agents/sandbox/shared.ts:20; resolveCollaborationRunWorkspaceDir src/auto-reply/reply/runtime-context-assembly.ts:62; resolveSessionContinuityWorkspaceDir src/auto-reply/reply/session-continuity.ts:405; resolveTenantDataRootWorkspaceDir src/gateway/tenant-context.ts:953"
    package/advisory_identity: "N/A"
    severity: "N/A"
    dependency_reachability: "N/A"
  evidence_status: HISTORICAL
- candidate_sha: "3a16e0b076c55f02cae59c6651adcb8edc18763d"
  execution_baseline_sha: "a0303a92689456449127dacd3ace4827cf1fc73c"
  evidence_run_id: "37612383132#112762496026"
  candidate_result: PASS
  regression_status: UNKNOWN
  acceptance_status: PASS
  signature:
    command: "actions job conclusion success"
    exit_code: "0"
    failure_class: "N/A"
    assertion/error_code: "assertion text not extracted"
    affected_files_or_symbols: "N/A"
    package/advisory_identity: "N/A"
    severity: "N/A"
    dependency_reachability: "N/A"
  evidence_status: HISTORICAL
- candidate_sha: "3a16e0b076c55f02cae59c6651adcb8edc18763d"
  execution_baseline_sha: "a0303a92689456449127dacd3ace4827cf1fc73c"
  evidence_run_id: "37612383132#112762595699"
  candidate_result: FAIL
  regression_status: BASELINE_UNCHANGED
  acceptance_status: FAIL
  signature:
    command: "pnpm build:docker"
    exit_code: "1"
    failure_class: "TS18047"
    assertion/error_code: "src/agents/sandbox/account-worker-gateway.ts(50,9): error TS18047: 'head' is possibly 'null'.; src/agents/sandbox/account-worker-gateway.ts(51,10): error TS18047: 'head' is possibly 'null'."
    affected_files_or_symbols: "src/agents/sandbox/account-worker-gateway.ts"
    package/advisory_identity: "N/A"
    severity: "N/A"
    dependency_reachability: "N/A"
  evidence_status: HISTORICAL
- candidate_sha: "3a16e0b076c55f02cae59c6651adcb8edc18763d"
  execution_baseline_sha: "a0303a92689456449127dacd3ace4827cf1fc73c"
  evidence_run_id: "37612383093#112762495798"
  candidate_result: PASS
  regression_status: UNKNOWN
  acceptance_status: PASS
  signature:
    command: "actions job conclusion success"
    exit_code: "0"
    failure_class: "N/A"
    assertion/error_code: "assertion text not extracted"
    affected_files_or_symbols: "N/A"
    package/advisory_identity: "N/A"
    severity: "N/A"
    dependency_reachability: "N/A"
  evidence_status: HISTORICAL
- candidate_sha: "3a16e0b076c55f02cae59c6651adcb8edc18763d"
  execution_baseline_sha: "a0303a92689456449127dacd3ace4827cf1fc73c"
  evidence_run_id: "37612383093#112762496221"
  candidate_result: PASS
  regression_status: UNKNOWN
  acceptance_status: PASS
  signature:
    command: "actions job conclusion success"
    exit_code: "0"
    failure_class: "N/A"
    assertion/error_code: "assertion text not extracted"
    affected_files_or_symbols: "N/A"
    package/advisory_identity: "N/A"
    severity: "N/A"
    dependency_reachability: "N/A"
  evidence_status: HISTORICAL
- candidate_sha: "3a16e0b076c55f02cae59c6651adcb8edc18763d"
  execution_baseline_sha: "a0303a92689456449127dacd3ace4827cf1fc73c"
  evidence_run_id: "37612383180#112762506815"
  candidate_result: PASS
  regression_status: UNKNOWN
  acceptance_status: PASS
  signature:
    command: "actions job conclusion success"
    exit_code: "0"
    failure_class: "N/A"
    assertion/error_code: "assertion text not extracted"
    affected_files_or_symbols: "N/A"
    package/advisory_identity: "N/A"
    severity: "N/A"
    dependency_reachability: "N/A"
  evidence_status: HISTORICAL
- candidate_sha: "3a16e0b076c55f02cae59c6651adcb8edc18763d"
  execution_baseline_sha: "a0303a92689456449127dacd3ace4827cf1fc73c"
  evidence_run_id: "37612383180#112762507228"
  candidate_result: FAIL
  regression_status: BASELINE_UNCHANGED
  acceptance_status: FAIL
  signature:
    command: "pre-commit run --all-files pnpm-audit-prod"
    exit_code: "1"
    failure_class: "audit-hook"
    assertion/error_code: "pnpm-audit-prod failed; count line is not a signature"
    affected_files_or_symbols: ".>node-llama-cpp>simple-git>@simple-git/argv-parser; .>node-llama-cpp>simple-git; .>express>proxy-addr"
    package/advisory_identity: "@simple-git/argv-parser GHSA-v5rq-49vh-5v5c <2.0.1; simple-git GHSA-x6jw-m9v5-85vh >=3.15.0 <4.0.1; proxy-addr GHSA-jqcg-44mw-7w3h >=1.1.0 <2.0.8"
    severity: "critical"
    dependency_reachability: "pnpm-audit-prod"
  evidence_status: HISTORICAL
- candidate_sha: "3a16e0b076c55f02cae59c6651adcb8edc18763d"
  execution_baseline_sha: "a0303a92689456449127dacd3ace4827cf1fc73c"
  evidence_run_id: "37612383180#112762559623"
  candidate_result: NOT_RUN
  regression_status: NOT_RUN
  acceptance_status: FAIL
  signature:
    command: "not-executed"
    exit_code: "skipped"
    failure_class: "not-executed"
    assertion/error_code: "job skipped"
    affected_files_or_symbols: "N/A"
    package/advisory_identity: "N/A"
    severity: "N/A"
    dependency_reachability: "N/A"
  evidence_status: HISTORICAL
- candidate_sha: "3a16e0b076c55f02cae59c6651adcb8edc18763d"
  execution_baseline_sha: "a0303a92689456449127dacd3ace4827cf1fc73c"
  evidence_run_id: "37612383180#112762612677"
  candidate_result: FAIL
  regression_status: UNKNOWN
  acceptance_status: FAIL
  signature:
    command: "pnpm check:docs"
    exit_code: "1"
    failure_class: "markdownlint"
    assertion/error_code: "markdownlint-cli2 v0.23.3 (markdownlint v0.41.1); ELIFECYCLE Command failed with exit code 1"
    affected_files_or_symbols: "not-extracted"
    package/advisory_identity: "N/A"
    severity: "N/A"
    dependency_reachability: "N/A"
  evidence_status: HISTORICAL
- candidate_sha: "3a16e0b076c55f02cae59c6651adcb8edc18763d"
  execution_baseline_sha: "a0303a92689456449127dacd3ace4827cf1fc73c"
  evidence_run_id: "37612383180#112762612681"
  candidate_result: PASS
  regression_status: UNKNOWN
  acceptance_status: PASS
  signature:
    command: "actions job conclusion success"
    exit_code: "0"
    failure_class: "N/A"
    assertion/error_code: "assertion text not extracted"
    affected_files_or_symbols: "N/A"
    package/advisory_identity: "N/A"
    severity: "N/A"
    dependency_reachability: "N/A"
  evidence_status: HISTORICAL
- candidate_sha: "3a16e0b076c55f02cae59c6651adcb8edc18763d"
  execution_baseline_sha: "a0303a92689456449127dacd3ace4827cf1fc73c"
  evidence_run_id: "37612383180#112763024448"
  candidate_result: NOT_RUN
  regression_status: NOT_RUN
  acceptance_status: FAIL
  signature:
    command: "not-executed"
    exit_code: "skipped"
    failure_class: "not-executed"
    assertion/error_code: "job skipped"
    affected_files_or_symbols: "N/A"
    package/advisory_identity: "N/A"
    severity: "N/A"
    dependency_reachability: "N/A"
  evidence_status: HISTORICAL
- candidate_sha: "3a16e0b076c55f02cae59c6651adcb8edc18763d"
  execution_baseline_sha: "a0303a92689456449127dacd3ace4827cf1fc73c"
  evidence_run_id: "37612383180#112763028012"
  candidate_result: FAIL
  regression_status: BASELINE_UNCHANGED
  acceptance_status: FAIL
  signature:
    command: "pnpm build"
    exit_code: "1"
    failure_class: "TS18047"
    assertion/error_code: "src/agents/sandbox/account-worker-gateway.ts(50,9): error TS18047: 'head' is possibly 'null'.; src/agents/sandbox/account-worker-gateway.ts(51,10): error TS18047: 'head' is possibly 'null'."
    affected_files_or_symbols: "src/agents/sandbox/account-worker-gateway.ts"
    package/advisory_identity: "N/A"
    severity: "N/A"
    dependency_reachability: "N/A"
  evidence_status: HISTORICAL
- candidate_sha: "3a16e0b076c55f02cae59c6651adcb8edc18763d"
  execution_baseline_sha: "a0303a92689456449127dacd3ace4827cf1fc73c"
  evidence_run_id: "37612383180#112763028043"
  candidate_result: FAIL
  regression_status: BASELINE_UNCHANGED
  acceptance_status: FAIL
  signature:
    command: "pnpm format:check"
    exit_code: "1"
    failure_class: "format"
    assertion/error_code: "Format issues found in above 1 files"
    affected_files_or_symbols: "scripts/sandbox-browser-start.html"
    package/advisory_identity: "N/A"
    severity: "N/A"
    dependency_reachability: "N/A"
  evidence_status: HISTORICAL
- candidate_sha: "3a16e0b076c55f02cae59c6651adcb8edc18763d"
  execution_baseline_sha: "a0303a92689456449127dacd3ace4827cf1fc73c"
  evidence_run_id: "37612383180#112763028052"
  candidate_result: PASS
  regression_status: UNKNOWN
  acceptance_status: PASS
  signature:
    command: "actions job conclusion success"
    exit_code: "0"
    failure_class: "N/A"
    assertion/error_code: "assertion text not extracted"
    affected_files_or_symbols: "N/A"
    package/advisory_identity: "N/A"
    severity: "N/A"
    dependency_reachability: "N/A"
  evidence_status: HISTORICAL
- candidate_sha: "3a16e0b076c55f02cae59c6651adcb8edc18763d"
  execution_baseline_sha: "a0303a92689456449127dacd3ace4827cf1fc73c"
  evidence_run_id: "37612383180#112763028211"
  candidate_result: PASS
  regression_status: UNKNOWN
  acceptance_status: PASS
  signature:
    command: "actions job conclusion success"
    exit_code: "0"
    failure_class: "N/A"
    assertion/error_code: "assertion text not extracted"
    affected_files_or_symbols: "N/A"
    package/advisory_identity: "N/A"
    severity: "N/A"
    dependency_reachability: "N/A"
  evidence_status: HISTORICAL
- candidate_sha: "3a16e0b076c55f02cae59c6651adcb8edc18763d"
  execution_baseline_sha: "a0303a92689456449127dacd3ace4827cf1fc73c"
  evidence_run_id: "37612383180#112763028265"
  candidate_result: PASS
  regression_status: UNKNOWN
  acceptance_status: PASS
  signature:
    command: "actions job conclusion success"
    exit_code: "0"
    failure_class: "N/A"
    assertion/error_code: "assertion text not extracted"
    affected_files_or_symbols: "N/A"
    package/advisory_identity: "N/A"
    severity: "N/A"
    dependency_reachability: "N/A"
  evidence_status: HISTORICAL
- candidate_sha: "3a16e0b076c55f02cae59c6651adcb8edc18763d"
  execution_baseline_sha: "a0303a92689456449127dacd3ace4827cf1fc73c"
  evidence_run_id: "37612383180#112763028267"
  candidate_result: FAIL
  regression_status: UNKNOWN
  acceptance_status: FAIL
  signature:
    command: "bunx vitest run"
    exit_code: "1"
    failure_class: "vitest"
    assertion/error_code: "Test Files 12 failed | 470 passed (482); Tests 16 failed | 3814 passed | 1 skipped (3831)"
    affected_files_or_symbols: "not-extracted"
    package/advisory_identity: "N/A"
    severity: "N/A"
    dependency_reachability: "N/A"
  evidence_status: HISTORICAL
- candidate_sha: "3a16e0b076c55f02cae59c6651adcb8edc18763d"
  execution_baseline_sha: "a0303a92689456449127dacd3ace4827cf1fc73c"
  evidence_run_id: "37612383180#112763028390"
  candidate_result: PASS
  regression_status: UNKNOWN
  acceptance_status: PASS
  signature:
    command: "actions job conclusion success"
    exit_code: "0"
    failure_class: "N/A"
    assertion/error_code: "assertion text not extracted"
    affected_files_or_symbols: "N/A"
    package/advisory_identity: "N/A"
    severity: "N/A"
    dependency_reachability: "N/A"
  evidence_status: HISTORICAL
- candidate_sha: "3a16e0b076c55f02cae59c6651adcb8edc18763d"
  execution_baseline_sha: "a0303a92689456449127dacd3ace4827cf1fc73c"
  evidence_run_id: "37612383180#112763028522"
  candidate_result: FAIL
  regression_status: UNKNOWN
  acceptance_status: FAIL
  signature:
    command: "pnpm test"
    exit_code: "1"
    failure_class: "vitest"
    assertion/error_code: "checks-windows 1/6; Test Files 14 failed | 303 passed | 2 skipped (319); Tests 37 failed | 2549 passed | 18 skipped (2604); Test Files 1 failed | 2 passed (4); Tests 1 failed | 50 passed | 1 skipped (101)"
    affected_files_or_symbols: "not-extracted"
    package/advisory_identity: "N/A"
    severity: "N/A"
    dependency_reachability: "N/A"
  evidence_status: HISTORICAL
- candidate_sha: "3a16e0b076c55f02cae59c6651adcb8edc18763d"
  execution_baseline_sha: "a0303a92689456449127dacd3ace4827cf1fc73c"
  evidence_run_id: "37612383180#112763028540"
  candidate_result: FAIL
  regression_status: UNKNOWN
  acceptance_status: FAIL
  signature:
    command: "pnpm test"
    exit_code: "1"
    failure_class: "vitest"
    assertion/error_code: "checks-windows 2/6; Test Files 4 failed | 313 passed | 1 skipped (318); Tests 4 failed | 2565 passed | 17 skipped (2586)"
    affected_files_or_symbols: "not-extracted"
    package/advisory_identity: "N/A"
    severity: "N/A"
    dependency_reachability: "N/A"
  evidence_status: HISTORICAL
- candidate_sha: "3a16e0b076c55f02cae59c6651adcb8edc18763d"
  execution_baseline_sha: "a0303a92689456449127dacd3ace4827cf1fc73c"
  evidence_run_id: "37612383180#112763028473"
  candidate_result: FAIL
  regression_status: UNKNOWN
  acceptance_status: FAIL
  signature:
    command: "pnpm test"
    exit_code: "1"
    failure_class: "vitest"
    assertion/error_code: "checks-windows 3/6; Test Files 9 failed | 308 passed | 1 skipped (318); Tests 14 failed | 2451 passed | 49 skipped (2514)"
    affected_files_or_symbols: "not-extracted"
    package/advisory_identity: "N/A"
    severity: "N/A"
    dependency_reachability: "N/A"
  evidence_status: HISTORICAL
- candidate_sha: "3a16e0b076c55f02cae59c6651adcb8edc18763d"
  execution_baseline_sha: "a0303a92689456449127dacd3ace4827cf1fc73c"
  evidence_run_id: "37612383180#112763028566"
  candidate_result: FAIL
  regression_status: UNKNOWN
  acceptance_status: FAIL
  signature:
    command: "pnpm test"
    exit_code: "1"
    failure_class: "vitest"
    assertion/error_code: "checks-windows 4/6; Test Files 9 failed | 307 passed | 2 skipped (318); Tests 78 failed | 2182 passed | 6 skipped (2266)"
    affected_files_or_symbols: "not-extracted"
    package/advisory_identity: "N/A"
    severity: "N/A"
    dependency_reachability: "N/A"
  evidence_status: HISTORICAL
- candidate_sha: "3a16e0b076c55f02cae59c6651adcb8edc18763d"
  execution_baseline_sha: "a0303a92689456449127dacd3ace4827cf1fc73c"
  evidence_run_id: "37612383180#112763028408"
  candidate_result: FAIL
  regression_status: UNKNOWN
  acceptance_status: FAIL
  signature:
    command: "pnpm test"
    exit_code: "1"
    failure_class: "vitest"
    assertion/error_code: "checks-windows 5/6; Test Files 14 failed | 303 passed | 1 skipped (318); Tests 45 failed | 2779 passed | 12 skipped (2836)"
    affected_files_or_symbols: "not-extracted"
    package/advisory_identity: "N/A"
    severity: "N/A"
    dependency_reachability: "N/A"
  evidence_status: HISTORICAL
- candidate_sha: "3a16e0b076c55f02cae59c6651adcb8edc18763d"
  execution_baseline_sha: "a0303a92689456449127dacd3ace4827cf1fc73c"
  evidence_run_id: "37612383180#112763028467"
  candidate_result: FAIL
  regression_status: UNKNOWN
  acceptance_status: FAIL
  signature:
    command: "pnpm test"
    exit_code: "1"
    failure_class: "vitest"
    assertion/error_code: "checks-windows 6/6; Test Files 17 failed | 301 passed (318); Tests 33 failed | 2521 passed | 3 skipped (2557)"
    affected_files_or_symbols: "not-extracted"
    package/advisory_identity: "N/A"
    severity: "N/A"
    dependency_reachability: "N/A"
  evidence_status: HISTORICAL
- candidate_sha: "3a16e0b076c55f02cae59c6651adcb8edc18763d"
  execution_baseline_sha: "a0303a92689456449127dacd3ace4827cf1fc73c"
  evidence_run_id: "37612383180#112763028416"
  candidate_result: FAIL
  regression_status: BASELINE_UNCHANGED
  acceptance_status: FAIL
  signature:
    command: "pnpm protocol:gen && pnpm protocol:gen:swift && git diff --exit-code -- dist/protocol.schema.json apps/macos/Sources/OpenBotProtocol/GatewayModels.swift apps/shared/OpenBotKit/Sources/OpenBotProtocol/GatewayModels.swift"
    exit_code: "1"
    failure_class: "git-diff"
    assertion/error_code: "ELIFECYCLE Command failed with exit code 1"
    affected_files_or_symbols: "apps/macos/Sources/OpenBotProtocol/GatewayModels.swift; apps/shared/OpenBotKit/Sources/OpenBotProtocol/GatewayModels.swift; peerDelivery; senderLabel; sourceSessionKey; sessionOwnerPlatformUserId"
    package/advisory_identity: "N/A"
    severity: "N/A"
    dependency_reachability: "N/A"
  evidence_status: HISTORICAL
- candidate_sha: "3a16e0b076c55f02cae59c6651adcb8edc18763d"
  execution_baseline_sha: "a0303a92689456449127dacd3ace4827cf1fc73c"
  evidence_run_id: "37612383180#112763028424"
  candidate_result: FAIL
  regression_status: BASELINE_UNCHANGED
  acceptance_status: FAIL
  signature:
    command: "pnpm canvas:a2ui:bundle && pnpm test"
    exit_code: "1"
    failure_class: "vitest"
    assertion/error_code: "Test Files 109 failed | 369 passed (478); Tests 15 failed | 2913 passed | 1 skipped (2929)"
    affected_files_or_symbols: "TalkDefaults.kt; test/appcast.test.ts > appcast.xml > uses canonical sparkle build for the latest stable appcast entry; src/config/talk-defaults.test.ts > talk silence timeout defaults > matches the Apple and Android runtime constants; src/infra/system-presence.version.test.ts > system-presence version fallback > uses runtime VERSION when OPENCLAW_VERSION is not set; src/infra/system-presence.version.test.ts > system-presence version fallback > uses runtime VERSION when OPENCLAW_VERSION and OPENCLAW_SERVICE_VERSION are blank; src/vault-sync/runtime-reindex-hook.node.test.ts > runVaultSyncRuntimeReindex > returns zero matches when root is missing and no knowledgeBaseId; src/vault-sync/runtime-reindex-hook.node.test.ts > runVaultSyncRuntimeReindex > returns zero matches when knowledgeBaseId has no local-folder binding; src/shared/preview-artifact/deliverable-envelope.test.ts > shared deliverable-envelope quoted coverage gate > strips path segments from a declared file so it stays a safe basename; ui/src/ui/storage.node.test.ts > loadSettings default gateway URL derivation > replaces a stale public-home gateway URL when opening a port subdomain; ui/src/ui/workspace-compose-ui.node.test.ts > workspace compose UI targets > renders the context capsule above the compact compose row; ui/src/ui/artifact/event-handler.test.ts > Artifact Event Handler > detectArtifactsInMessage > detects multiple files in one message; ui/src/ui/artifact/registry.test.ts > ArtifactRegistry > Persistence > gets recent artifacts sorted by update time; ui/src/ui/controllers/platform-auth.test.ts > platform auth controller > activates an enterprise admin and reconnects with the new session; ui/src/ui/controllers/platform-auth.test.ts > platform auth controller > requests an enterprise admin session for the dedicated enterprise login; ui/src/ui/controllers/platform-auth.test.ts > platform auth controller > lets a platform admin create an enterprise with explicit trial settings; ui/src/ui/controllers/platform-auth.test.ts > platform auth controller > logs in through the platform admin entry with an explicit role guard"
    package/advisory_identity: "N/A"
    severity: "N/A"
    dependency_reachability: "N/A"
  evidence_status: HISTORICAL
- candidate_sha: "3a16e0b076c55f02cae59c6651adcb8edc18763d"
  execution_baseline_sha: "a0303a92689456449127dacd3ace4827cf1fc73c"
  evidence_run_id: "37612383180#112763912915"
  candidate_result: PASS
  regression_status: UNKNOWN
  acceptance_status: PASS
  signature:
    command: "actions job conclusion success"
    exit_code: "0"
    failure_class: "N/A"
    assertion/error_code: "assertion text not extracted"
    affected_files_or_symbols: "N/A"
    package/advisory_identity: "N/A"
    severity: "N/A"
    dependency_reachability: "N/A"
  evidence_status: HISTORICAL
- candidate_sha: "3a16e0b076c55f02cae59c6651adcb8edc18763d"
  execution_baseline_sha: "a0303a92689456449127dacd3ace4827cf1fc73c"
  evidence_run_id: "37612383180#112764515231"
  candidate_result: NOT_RUN
  regression_status: NOT_RUN
  acceptance_status: FAIL
  signature:
    command: "not-executed"
    exit_code: "skipped"
    failure_class: "not-executed"
    assertion/error_code: "job skipped"
    affected_files_or_symbols: "N/A"
    package/advisory_identity: "N/A"
    severity: "N/A"
    dependency_reachability: "N/A"
  evidence_status: HISTORICAL
- candidate_sha: "3a16e0b076c55f02cae59c6651adcb8edc18763d"
  execution_baseline_sha: "a0303a92689456449127dacd3ace4827cf1fc73c"
  evidence_run_id: "37612383180#112766929301"
  candidate_result: NOT_RUN
  regression_status: NOT_RUN
  acceptance_status: FAIL
  signature:
    command: "not-executed"
    exit_code: "skipped"
    failure_class: "not-executed"
    assertion/error_code: "job skipped"
    affected_files_or_symbols: "N/A"
    package/advisory_identity: "N/A"
    severity: "N/A"
    dependency_reachability: "N/A"
  evidence_status: HISTORICAL
```

这些 3a16 行是 HISTORICAL，不进入 Stage 8。它们不进入上面的 CURRENT 列表。

#### Historical candidate evidence — a6fc195bc

`evidence_status=HISTORICAL`，`stage8_eligible=false`。`candidate_sha` 是 `a6fc195bce8076c5b16be762db63f909ba36f208`，合并树 `822f4807b40f34e93dbf807095a1c278aca9471e`（`Merge a6fc195… into 334dc676…`）。`execution_baseline_sha` 记录当时的 pin `ebfd221563dd19a4f684e32146eb7dfc3084df01`，但这些行不再是 CURRENT。run 是 [37605284877](https://github.com/upbeyond/openbot/actions/runs/37605284877)、[37605284821](https://github.com/upbeyond/openbot/actions/runs/37605284821)、[37605284825](https://github.com/upbeyond/openbot/actions/runs/37605284825)、[37605284862](https://github.com/upbeyond/openbot/actions/runs/37605284862)、[37605284876](https://github.com/upbeyond/openbot/actions/runs/37605284876)。check-docs job `112739214151` 只保留一条：`candidate_result: FAIL`，`acceptance_status: FAIL`，`exit_code: 1`。方案文件不在该 job 的失败列表里，这只是叙述里的观察，不是第二条 PASS 行。

pin 的 push 上实际出现的 run 只有 Workflow Sanity [37607921167](https://github.com/upbeyond/openbot/actions/runs/37607921167)（no-tabs `112747852904`、actionlint `112747853327`，结论 success）和 Install Smoke [37607921205](https://github.com/upbeyond/openbot/actions/runs/37607921205)（docs-scope `112748202684` success，install-smoke `112748281893` skipped）。CI Gate、CI、Memory Workspace Freeze 被 path filter 跳过。回归保持 UNKNOWN，不是 `BASELINE_UNCHANGED`。单行 job 结论 PASS 不是 Stage 0–8 产品 PASS。

```yaml
- candidate_sha: "a6fc195bce8076c5b16be762db63f909ba36f208"
  execution_baseline_sha: "ebfd221563dd19a4f684e32146eb7dfc3084df01"
  evidence_run_id: "37605284877#112739136822"
  candidate_result: FAIL
  regression_status: UNKNOWN
  acceptance_status: FAIL
  signature:
    command: "scripts/delivery/ledger.test.ts :: production releases.jsonl keeps a single open LIVE row after seq107 record"
    exit_code: "1; Tests 1 failed | 122 passed (123)"
    failure_class: "AssertionError"
    assertion/error_code: "expected [ 112 ] to deeply equal []; expect(errorSeqs).toEqual([])"
    affected_files_or_symbols: "scripts/delivery/ledger.test.ts; deploy/production/releases.jsonl; errorSeqs; seq 112; open LIVE seq 107"
    package/advisory_identity: "N/A"
    severity: "N/A"
    dependency_reachability: "N/A"
  evidence_status: HISTORICAL
- candidate_sha: "a6fc195bce8076c5b16be762db63f909ba36f208"
  execution_baseline_sha: "ebfd221563dd19a4f684e32146eb7dfc3084df01"
  evidence_run_id: "37605284821#112739136421"
  candidate_result: FAIL
  regression_status: UNKNOWN
  acceptance_status: FAIL
  signature:
    command: "pre-commit run --all-files pnpm-audit-prod"
    exit_code: "1"
    failure_class: "audit-hook"
    assertion/error_code: "pnpm-audit-prod failed; count line is not a signature"
    affected_files_or_symbols: "not-extracted"
    package/advisory_identity: "simple-git GHSA-v5rq-49vh-5v5c; simple-git GHSA-x6jw-m9v5-85vh; proxy-addr GHSA-jqcg-44mw-7w3h"
    severity: "critical"
    dependency_reachability: "not-extracted"
  evidence_status: HISTORICAL
- candidate_sha: "a6fc195bce8076c5b16be762db63f909ba36f208"
  execution_baseline_sha: "ebfd221563dd19a4f684e32146eb7dfc3084df01"
  evidence_run_id: "37605284821#112739214151"
  candidate_result: FAIL
  regression_status: UNKNOWN
  acceptance_status: FAIL
  signature:
    command: "pnpm check:docs"
    exit_code: "1"
    failure_class: "markdownlint"
    assertion/error_code: "markdownlint-cli2 v0.23.3 (markdownlint v0.41.1); ELIFECYCLE Command failed with exit code 1"
    affected_files_or_symbols: "not-extracted"
    package/advisory_identity: "N/A"
    severity: "N/A"
    dependency_reachability: "N/A"
  evidence_status: HISTORICAL
- candidate_sha: "a6fc195bce8076c5b16be762db63f909ba36f208"
  execution_baseline_sha: "ebfd221563dd19a4f684e32146eb7dfc3084df01"
  evidence_run_id: "37605284825#112739136519"
  candidate_result: FAIL
  regression_status: UNKNOWN
  acceptance_status: FAIL
  signature:
    command: "node --import tsx memory-workspace-phase0-inventory.mjs --mode freeze --baseline-blob"
    exit_code: "1"
    failure_class: "freeze"
    assertion/error_code: "addedProductionHelpers"
    affected_files_or_symbols: "resolveSandboxWorkspaceDir src/agents/sandbox/shared.ts:20; resolveCollaborationRunWorkspaceDir src/auto-reply/reply/runtime-context-assembly.ts:62; resolveSessionContinuityWorkspaceDir src/auto-reply/reply/session-continuity.ts:405; resolveTenantDataRootWorkspaceDir src/gateway/tenant-context.ts:953"
    package/advisory_identity: "N/A"
    severity: "N/A"
    dependency_reachability: "N/A"
  evidence_status: HISTORICAL
- candidate_sha: "a6fc195bce8076c5b16be762db63f909ba36f208"
  execution_baseline_sha: "ebfd221563dd19a4f684e32146eb7dfc3084df01"
  evidence_run_id: "37605284862#112739243770"
  candidate_result: NOT_RUN
  regression_status: NOT_RUN
  acceptance_status: FAIL
  signature:
    command: "not-executed"
    exit_code: "skipped"
    failure_class: "not-executed"
    assertion/error_code: "job skipped; do not inherit historical FAIL"
    affected_files_or_symbols: "N/A"
    package/advisory_identity: "N/A"
    severity: "N/A"
    dependency_reachability: "N/A"
  evidence_status: HISTORICAL
- candidate_sha: "a6fc195bce8076c5b16be762db63f909ba36f208"
  execution_baseline_sha: "ebfd221563dd19a4f684e32146eb7dfc3084df01"
  evidence_run_id: "37605284821#112739136775"
  candidate_result: PASS
  regression_status: UNKNOWN
  acceptance_status: PASS
  signature:
    command: "actions job conclusion success"
    exit_code: "0"
    failure_class: "N/A"
    assertion/error_code: "assertion text not extracted"
    affected_files_or_symbols: "N/A"
    package/advisory_identity: "N/A"
    severity: "N/A"
    dependency_reachability: "N/A"
  evidence_status: HISTORICAL
- candidate_sha: "a6fc195bce8076c5b16be762db63f909ba36f208"
  execution_baseline_sha: "ebfd221563dd19a4f684e32146eb7dfc3084df01"
  evidence_run_id: "37605284862#112739136731"
  candidate_result: PASS
  regression_status: UNKNOWN
  acceptance_status: PASS
  signature:
    command: "actions job conclusion success"
    exit_code: "0"
    failure_class: "N/A"
    assertion/error_code: "assertion text not extracted"
    affected_files_or_symbols: "N/A"
    package/advisory_identity: "N/A"
    severity: "N/A"
    dependency_reachability: "N/A"
  evidence_status: HISTORICAL
- candidate_sha: "a6fc195bce8076c5b16be762db63f909ba36f208"
  execution_baseline_sha: "ebfd221563dd19a4f684e32146eb7dfc3084df01"
  evidence_run_id: "37605284876#112739136288"
  candidate_result: PASS
  regression_status: UNKNOWN
  acceptance_status: PASS
  signature:
    command: "actions job conclusion success"
    exit_code: "0"
    failure_class: "N/A"
    assertion/error_code: "assertion text not extracted"
    affected_files_or_symbols: "N/A"
    package/advisory_identity: "N/A"
    severity: "N/A"
    dependency_reachability: "N/A"
  evidence_status: HISTORICAL
- candidate_sha: "a6fc195bce8076c5b16be762db63f909ba36f208"
  execution_baseline_sha: "ebfd221563dd19a4f684e32146eb7dfc3084df01"
  evidence_run_id: "37605284876#112739136645"
  candidate_result: PASS
  regression_status: UNKNOWN
  acceptance_status: PASS
  signature:
    command: "actions job conclusion success"
    exit_code: "0"
    failure_class: "N/A"
    assertion/error_code: "assertion text not extracted"
    affected_files_or_symbols: "N/A"
    package/advisory_identity: "N/A"
    severity: "N/A"
    dependency_reachability: "N/A"
  evidence_status: HISTORICAL
- candidate_sha: "a6fc195bce8076c5b16be762db63f909ba36f208"
  execution_baseline_sha: "ebfd221563dd19a4f684e32146eb7dfc3084df01"
  evidence_run_id: "37605284877#112739136915"
  candidate_result: PASS
  regression_status: UNKNOWN
  acceptance_status: PASS
  signature:
    command: "actions job conclusion success"
    exit_code: "0"
    failure_class: "N/A"
    assertion/error_code: "assertion text not extracted"
    affected_files_or_symbols: "N/A"
    package/advisory_identity: "N/A"
    severity: "N/A"
    dependency_reachability: "N/A"
  evidence_status: HISTORICAL
- candidate_sha: "a6fc195bce8076c5b16be762db63f909ba36f208"
  execution_baseline_sha: "ebfd221563dd19a4f684e32146eb7dfc3084df01"
  evidence_run_id: "37605284821#112739216804"
  candidate_result: NOT_RUN
  regression_status: NOT_RUN
  acceptance_status: FAIL
  signature:
    command: "not-executed"
    exit_code: "skipped"
    failure_class: "not-executed"
    assertion/error_code: "job skipped"
    affected_files_or_symbols: "N/A"
    package/advisory_identity: "N/A"
    severity: "N/A"
    dependency_reachability: "N/A"
  evidence_status: HISTORICAL
- candidate_sha: "a6fc195bce8076c5b16be762db63f909ba36f208"
  execution_baseline_sha: "ebfd221563dd19a4f684e32146eb7dfc3084df01"
  evidence_run_id: "37605284821#112739217427"
  candidate_result: NOT_RUN
  regression_status: NOT_RUN
  acceptance_status: FAIL
  signature:
    command: "not-executed"
    exit_code: "skipped"
    failure_class: "not-executed"
    assertion/error_code: "job skipped"
    affected_files_or_symbols: "N/A"
    package/advisory_identity: "N/A"
    severity: "N/A"
    dependency_reachability: "N/A"
  evidence_status: HISTORICAL
- candidate_sha: "a6fc195bce8076c5b16be762db63f909ba36f208"
  execution_baseline_sha: "ebfd221563dd19a4f684e32146eb7dfc3084df01"
  evidence_run_id: "37605284821#112739216501"
  candidate_result: NOT_RUN
  regression_status: NOT_RUN
  acceptance_status: FAIL
  signature:
    command: "not-executed"
    exit_code: "skipped"
    failure_class: "not-executed"
    assertion/error_code: "job skipped"
    affected_files_or_symbols: "N/A"
    package/advisory_identity: "N/A"
    severity: "N/A"
    dependency_reachability: "N/A"
  evidence_status: HISTORICAL
- candidate_sha: "a6fc195bce8076c5b16be762db63f909ba36f208"
  execution_baseline_sha: "ebfd221563dd19a4f684e32146eb7dfc3084df01"
  evidence_run_id: "37605284821#112739216627"
  candidate_result: NOT_RUN
  regression_status: NOT_RUN
  acceptance_status: FAIL
  signature:
    command: "not-executed"
    exit_code: "skipped"
    failure_class: "not-executed"
    assertion/error_code: "job skipped"
    affected_files_or_symbols: "N/A"
    package/advisory_identity: "N/A"
    severity: "N/A"
    dependency_reachability: "N/A"
  evidence_status: HISTORICAL
- candidate_sha: "a6fc195bce8076c5b16be762db63f909ba36f208"
  execution_baseline_sha: "ebfd221563dd19a4f684e32146eb7dfc3084df01"
  evidence_run_id: "37605284821#112739215235"
  candidate_result: NOT_RUN
  regression_status: NOT_RUN
  acceptance_status: FAIL
  signature:
    command: "not-executed"
    exit_code: "skipped"
    failure_class: "not-executed"
    assertion/error_code: "job skipped"
    affected_files_or_symbols: "N/A"
    package/advisory_identity: "N/A"
    severity: "N/A"
    dependency_reachability: "N/A"
  evidence_status: HISTORICAL
- candidate_sha: "a6fc195bce8076c5b16be762db63f909ba36f208"
  execution_baseline_sha: "ebfd221563dd19a4f684e32146eb7dfc3084df01"
  evidence_run_id: "37605284821#112739216717"
  candidate_result: NOT_RUN
  regression_status: NOT_RUN
  acceptance_status: FAIL
  signature:
    command: "not-executed"
    exit_code: "skipped"
    failure_class: "not-executed"
    assertion/error_code: "job skipped"
    affected_files_or_symbols: "N/A"
    package/advisory_identity: "N/A"
    severity: "N/A"
    dependency_reachability: "N/A"
  evidence_status: HISTORICAL
- candidate_sha: "a6fc195bce8076c5b16be762db63f909ba36f208"
  execution_baseline_sha: "ebfd221563dd19a4f684e32146eb7dfc3084df01"
  evidence_run_id: "37605284821#112739216326"
  candidate_result: NOT_RUN
  regression_status: NOT_RUN
  acceptance_status: FAIL
  signature:
    command: "not-executed"
    exit_code: "skipped"
    failure_class: "not-executed"
    assertion/error_code: "job skipped"
    affected_files_or_symbols: "N/A"
    package/advisory_identity: "N/A"
    severity: "N/A"
    dependency_reachability: "N/A"
  evidence_status: HISTORICAL
- candidate_sha: "a6fc195bce8076c5b16be762db63f909ba36f208"
  execution_baseline_sha: "ebfd221563dd19a4f684e32146eb7dfc3084df01"
  evidence_run_id: "37605284821#112739217989"
  candidate_result: NOT_RUN
  regression_status: NOT_RUN
  acceptance_status: FAIL
  signature:
    command: "not-executed"
    exit_code: "skipped"
    failure_class: "not-executed"
    assertion/error_code: "job skipped"
    affected_files_or_symbols: "N/A"
    package/advisory_identity: "N/A"
    severity: "N/A"
    dependency_reachability: "N/A"
  evidence_status: HISTORICAL
- candidate_sha: "a6fc195bce8076c5b16be762db63f909ba36f208"
  execution_baseline_sha: "ebfd221563dd19a4f684e32146eb7dfc3084df01"
  evidence_run_id: "37605284821#112739216726"
  candidate_result: NOT_RUN
  regression_status: NOT_RUN
  acceptance_status: FAIL
  signature:
    command: "not-executed"
    exit_code: "skipped"
    failure_class: "not-executed"
    assertion/error_code: "job skipped"
    affected_files_or_symbols: "N/A"
    package/advisory_identity: "N/A"
    severity: "N/A"
    dependency_reachability: "N/A"
  evidence_status: HISTORICAL
- candidate_sha: "a6fc195bce8076c5b16be762db63f909ba36f208"
  execution_baseline_sha: "ebfd221563dd19a4f684e32146eb7dfc3084df01"
  evidence_run_id: "37605284821#112739137684"
  candidate_result: NOT_RUN
  regression_status: NOT_RUN
  acceptance_status: FAIL
  signature:
    command: "not-executed"
    exit_code: "skipped"
    failure_class: "not-executed"
    assertion/error_code: "job skipped"
    affected_files_or_symbols: "N/A"
    package/advisory_identity: "N/A"
    severity: "N/A"
    dependency_reachability: "N/A"
  evidence_status: HISTORICAL
- candidate_sha: "a6fc195bce8076c5b16be762db63f909ba36f208"
  execution_baseline_sha: "ebfd221563dd19a4f684e32146eb7dfc3084df01"
  evidence_run_id: "37605284821#112739217592"
  candidate_result: NOT_RUN
  regression_status: NOT_RUN
  acceptance_status: FAIL
  signature:
    command: "not-executed"
    exit_code: "skipped"
    failure_class: "not-executed"
    assertion/error_code: "job skipped"
    affected_files_or_symbols: "N/A"
    package/advisory_identity: "N/A"
    severity: "N/A"
    dependency_reachability: "N/A"
  evidence_status: HISTORICAL
- candidate_sha: "a6fc195bce8076c5b16be762db63f909ba36f208"
  execution_baseline_sha: "ebfd221563dd19a4f684e32146eb7dfc3084df01"
  evidence_run_id: "37605284821#112739217995"
  candidate_result: NOT_RUN
  regression_status: NOT_RUN
  acceptance_status: FAIL
  signature:
    command: "not-executed"
    exit_code: "skipped"
    failure_class: "not-executed"
    assertion/error_code: "job skipped"
    affected_files_or_symbols: "N/A"
    package/advisory_identity: "N/A"
    severity: "N/A"
    dependency_reachability: "N/A"
  evidence_status: HISTORICAL
```

这些 a6fc 行的基线 Signature 是空的。比较器返回 UNKNOWN。它们是 HISTORICAL，不进入 Stage 8。

#### Historical candidate evidence — 448a40551

`evidence_status=HISTORICAL`，`stage8_eligible=false`。这些行是 EvidenceRow，但不得进入 Stage 8 验收摘要。`candidate_sha` 是记账前的 tip `448a40551b856f286cc52f1cc4de5f78f8ab0982`。Actions 实际检出的是合并树 `155e1eea77df83d0147088c4ff931eb7e0b04da0`（`Merge 448a40551b856f286cc52f1cc4de5f78f8ab0982 into 334dc676067738b257aef268492f8cbfd335b703`）。run 是 [37602196309](https://github.com/upbeyond/openbot/actions/runs/37602196309)、[37602196416](https://github.com/upbeyond/openbot/actions/runs/37602196416)、[37602196292](https://github.com/upbeyond/openbot/actions/runs/37602196292)、[37602196290](https://github.com/upbeyond/openbot/actions/runs/37602196290)、[37602196296](https://github.com/upbeyond/openbot/actions/runs/37602196296)。`execution_baseline_sha` 全是 `UNPINNED`。失败行的 `regression_status` 是 `UNKNOWN`。install-smoke job `112729084016` 是 skipped，所以是 `NOT_RUN`。workflow 总结论 success 不是 install-smoke PASS。

CI Gate 的 check job `112729001984` 结论是 success。其中 `pnpm format:check` 打印了 `All matched files use the correct format.`。同 job 的 structural lint 步骤带 `continue-on-error: true`，日志里 `lint:ui:capability-boundaries` 与 `lint:core:composition-root-loc` 出现了 exit 1。那是 shadow 日志，不是该 job 的 FAIL 行，也不是产品 Stage PASS。CI Gate 的 check 与 CI workflow 的 check 仍是两条 EvidenceRow。delivery guard 的 `[112]` 与 462c 行看起来相同，但没有钉住的 `execution_baseline_sha`，比较器对基线返回 `UNKNOWN`，不得写成 `BASELINE_UNCHANGED`。check-docs job `112729087430` 只保留一条 FAIL：`exit_code: 1`。已删除同一 `evidence_run_id` 的 PASS 行。方案文件不在失败列表里，这只是叙述里的观察，不是仓库 check-docs PASS，也不是第二条 EvidenceRow。secrets 的条数合计不是 Signature。Memory Workspace Freeze 的 `assertion/error_code` 是日志里的 `addedProductionHelpers`，没有第二份 Signature。

```yaml
- candidate_sha: "448a40551b856f286cc52f1cc4de5f78f8ab0982"
  execution_baseline_sha: UNPINNED
  evidence_run_id: "37602196309#112729002269"
  candidate_result: FAIL
  regression_status: UNKNOWN
  acceptance_status: FAIL
  signature:
    command: "scripts/delivery/ledger.test.ts :: production releases.jsonl keeps a single open LIVE row after seq107 record"
    exit_code: "1; Tests 1 failed | 122 passed (123)"
    failure_class: "AssertionError"
    assertion/error_code: "expected [ 112 ] to deeply equal []; expect(errorSeqs).toEqual([])"
    affected_files_or_symbols: "scripts/delivery/ledger.test.ts; deploy/production/releases.jsonl; errorSeqs; seq 112; open LIVE seq 107"
    package/advisory_identity: "N/A"
    severity: "N/A"
    dependency_reachability: "N/A"
  evidence_status: HISTORICAL
- candidate_sha: "448a40551b856f286cc52f1cc4de5f78f8ab0982"
  execution_baseline_sha: UNPINNED
  evidence_run_id: "37602196416#112729001378"
  candidate_result: FAIL
  regression_status: UNKNOWN
  acceptance_status: FAIL
  signature:
    command: "pre-commit run --all-files pnpm-audit-prod"
    exit_code: "1"
    failure_class: "audit-hook"
    assertion/error_code: "pnpm-audit-prod failed; count line is not a signature"
    affected_files_or_symbols: "not-extracted"
    package/advisory_identity: "simple-git GHSA-v5rq-49vh-5v5c; simple-git GHSA-x6jw-m9v5-85vh; proxy-addr GHSA-jqcg-44mw-7w3h"
    severity: "critical"
    dependency_reachability: "not-extracted"
  evidence_status: HISTORICAL
- candidate_sha: "448a40551b856f286cc52f1cc4de5f78f8ab0982"
  execution_baseline_sha: UNPINNED
  evidence_run_id: "37602196416#112729087430"
  candidate_result: FAIL
  regression_status: UNKNOWN
  acceptance_status: FAIL
  signature:
    command: "pnpm check:docs"
    exit_code: "1"
    failure_class: "markdownlint"
    assertion/error_code: "markdownlint-cli2 v0.23.3 (markdownlint v0.41.1); ELIFECYCLE Command failed with exit code 1"
    affected_files_or_symbols: "not-extracted"
    package/advisory_identity: "N/A"
    severity: "N/A"
    dependency_reachability: "N/A"
  evidence_status: HISTORICAL
- candidate_sha: "448a40551b856f286cc52f1cc4de5f78f8ab0982"
  execution_baseline_sha: UNPINNED
  evidence_run_id: "37602196292#112729001494"
  candidate_result: FAIL
  regression_status: UNKNOWN
  acceptance_status: FAIL
  signature:
    command: "node --import tsx memory-workspace-phase0-inventory.mjs --mode freeze --baseline-blob"
    exit_code: "1"
    failure_class: "freeze"
    assertion/error_code: "addedProductionHelpers"
    affected_files_or_symbols: "resolveSandboxWorkspaceDir src/agents/sandbox/shared.ts:20; resolveCollaborationRunWorkspaceDir src/auto-reply/reply/runtime-context-assembly.ts:62; resolveSessionContinuityWorkspaceDir src/auto-reply/reply/session-continuity.ts:405; resolveTenantDataRootWorkspaceDir src/gateway/tenant-context.ts:953"
    package/advisory_identity: "N/A"
    severity: "N/A"
    dependency_reachability: "N/A"
  evidence_status: HISTORICAL
- candidate_sha: "448a40551b856f286cc52f1cc4de5f78f8ab0982"
  execution_baseline_sha: UNPINNED
  evidence_run_id: "37602196290#112729084016"
  candidate_result: NOT_RUN
  regression_status: NOT_RUN
  acceptance_status: FAIL
  signature:
    command: "not-executed"
    exit_code: "skipped"
    failure_class: "not-executed"
    assertion/error_code: "job skipped; do not inherit historical FAIL"
    affected_files_or_symbols: "N/A"
    package/advisory_identity: "N/A"
    severity: "N/A"
    dependency_reachability: "N/A"
  evidence_status: HISTORICAL
```

这些 448a 行没有第二份 Signature。比较器的 `b` 是 `null`，所以 `signatures_equal` 返回 `UNKNOWN`。

```yaml
- candidate_sha: "448a40551b856f286cc52f1cc4de5f78f8ab0982"
  execution_baseline_sha: UNPINNED
  evidence_run_id: "37602196416#112729001009"
  candidate_result: PASS
  regression_status: UNKNOWN
  acceptance_status: PASS
  signature:
    command: "actions job conclusion success"
    exit_code: "0"
    failure_class: "N/A"
    assertion/error_code: "assertion text not extracted"
    affected_files_or_symbols: "N/A"
    package/advisory_identity: "N/A"
    severity: "N/A"
    dependency_reachability: "N/A"
  evidence_status: HISTORICAL
- candidate_sha: "448a40551b856f286cc52f1cc4de5f78f8ab0982"
  execution_baseline_sha: UNPINNED
  evidence_run_id: "37602196290#112729002301"
  candidate_result: PASS
  regression_status: UNKNOWN
  acceptance_status: PASS
  signature:
    command: "actions job conclusion success"
    exit_code: "0"
    failure_class: "N/A"
    assertion/error_code: "assertion text not extracted"
    affected_files_or_symbols: "N/A"
    package/advisory_identity: "N/A"
    severity: "N/A"
    dependency_reachability: "N/A"
  evidence_status: HISTORICAL
- candidate_sha: "448a40551b856f286cc52f1cc4de5f78f8ab0982"
  execution_baseline_sha: UNPINNED
  evidence_run_id: "37602196296#112729002406"
  candidate_result: PASS
  regression_status: UNKNOWN
  acceptance_status: PASS
  signature:
    command: "actions job conclusion success"
    exit_code: "0"
    failure_class: "N/A"
    assertion/error_code: "assertion text not extracted"
    affected_files_or_symbols: "N/A"
    package/advisory_identity: "N/A"
    severity: "N/A"
    dependency_reachability: "N/A"
  evidence_status: HISTORICAL
- candidate_sha: "448a40551b856f286cc52f1cc4de5f78f8ab0982"
  execution_baseline_sha: UNPINNED
  evidence_run_id: "37602196296#112729001865"
  candidate_result: PASS
  regression_status: UNKNOWN
  acceptance_status: PASS
  signature:
    command: "actions job conclusion success"
    exit_code: "0"
    failure_class: "N/A"
    assertion/error_code: "assertion text not extracted"
    affected_files_or_symbols: "N/A"
    package/advisory_identity: "N/A"
    severity: "N/A"
    dependency_reachability: "N/A"
  evidence_status: HISTORICAL
- candidate_sha: "448a40551b856f286cc52f1cc4de5f78f8ab0982"
  execution_baseline_sha: UNPINNED
  evidence_run_id: "37602196309#112729001984"
  candidate_result: PASS
  regression_status: UNKNOWN
  acceptance_status: PASS
  signature:
    command: "actions job conclusion success"
    exit_code: "0"
    failure_class: "N/A"
    assertion/error_code: "assertion text not extracted"
    affected_files_or_symbols: "N/A"
    package/advisory_identity: "N/A"
    severity: "N/A"
    dependency_reachability: "N/A"
  evidence_status: HISTORICAL
- candidate_sha: "448a40551b856f286cc52f1cc4de5f78f8ab0982"
  execution_baseline_sha: UNPINNED
  evidence_run_id: "37602196416#112729096349"
  candidate_result: NOT_RUN
  regression_status: NOT_RUN
  acceptance_status: FAIL
  signature:
    command: "not-executed"
    exit_code: "skipped"
    failure_class: "not-executed"
    assertion/error_code: "job skipped"
    affected_files_or_symbols: "N/A"
    package/advisory_identity: "N/A"
    severity: "N/A"
    dependency_reachability: "N/A"
  evidence_status: HISTORICAL
- candidate_sha: "448a40551b856f286cc52f1cc4de5f78f8ab0982"
  execution_baseline_sha: UNPINNED
  evidence_run_id: "37602196416#112729095754"
  candidate_result: NOT_RUN
  regression_status: NOT_RUN
  acceptance_status: FAIL
  signature:
    command: "not-executed"
    exit_code: "skipped"
    failure_class: "not-executed"
    assertion/error_code: "job skipped"
    affected_files_or_symbols: "N/A"
    package/advisory_identity: "N/A"
    severity: "N/A"
    dependency_reachability: "N/A"
  evidence_status: HISTORICAL
- candidate_sha: "448a40551b856f286cc52f1cc4de5f78f8ab0982"
  execution_baseline_sha: UNPINNED
  evidence_run_id: "37602196416#112729096657"
  candidate_result: NOT_RUN
  regression_status: NOT_RUN
  acceptance_status: FAIL
  signature:
    command: "not-executed"
    exit_code: "skipped"
    failure_class: "not-executed"
    assertion/error_code: "job skipped"
    affected_files_or_symbols: "N/A"
    package/advisory_identity: "N/A"
    severity: "N/A"
    dependency_reachability: "N/A"
  evidence_status: HISTORICAL
- candidate_sha: "448a40551b856f286cc52f1cc4de5f78f8ab0982"
  execution_baseline_sha: UNPINNED
  evidence_run_id: "37602196416#112729096207"
  candidate_result: NOT_RUN
  regression_status: NOT_RUN
  acceptance_status: FAIL
  signature:
    command: "not-executed"
    exit_code: "skipped"
    failure_class: "not-executed"
    assertion/error_code: "job skipped"
    affected_files_or_symbols: "N/A"
    package/advisory_identity: "N/A"
    severity: "N/A"
    dependency_reachability: "N/A"
  evidence_status: HISTORICAL
- candidate_sha: "448a40551b856f286cc52f1cc4de5f78f8ab0982"
  execution_baseline_sha: UNPINNED
  evidence_run_id: "37602196416#protocol-job-absent"
  candidate_result: NOT_RUN
  regression_status: NOT_RUN
  acceptance_status: FAIL
  signature:
    command: "not-executed"
    exit_code: "skipped"
    failure_class: "not-executed"
    assertion/error_code: "job skipped"
    affected_files_or_symbols: "N/A"
    package/advisory_identity: "N/A"
    severity: "N/A"
    dependency_reachability: "N/A"
  evidence_status: HISTORICAL
- candidate_sha: "448a40551b856f286cc52f1cc4de5f78f8ab0982"
  execution_baseline_sha: UNPINNED
  evidence_run_id: "37602196416#112729094723"
  candidate_result: NOT_RUN
  regression_status: NOT_RUN
  acceptance_status: FAIL
  signature:
    command: "not-executed"
    exit_code: "skipped"
    failure_class: "not-executed"
    assertion/error_code: "job skipped"
    affected_files_or_symbols: "N/A"
    package/advisory_identity: "N/A"
    severity: "N/A"
    dependency_reachability: "N/A"
  evidence_status: HISTORICAL
- candidate_sha: "448a40551b856f286cc52f1cc4de5f78f8ab0982"
  execution_baseline_sha: UNPINNED
  evidence_run_id: "37602196416#112729095783"
  candidate_result: NOT_RUN
  regression_status: NOT_RUN
  acceptance_status: FAIL
  signature:
    command: "not-executed"
    exit_code: "skipped"
    failure_class: "not-executed"
    assertion/error_code: "job skipped"
    affected_files_or_symbols: "N/A"
    package/advisory_identity: "N/A"
    severity: "N/A"
    dependency_reachability: "N/A"
  evidence_status: HISTORICAL
- candidate_sha: "448a40551b856f286cc52f1cc4de5f78f8ab0982"
  execution_baseline_sha: UNPINNED
  evidence_run_id: "37602196416#112729095936"
  candidate_result: NOT_RUN
  regression_status: NOT_RUN
  acceptance_status: FAIL
  signature:
    command: "not-executed"
    exit_code: "skipped"
    failure_class: "not-executed"
    assertion/error_code: "job skipped"
    affected_files_or_symbols: "N/A"
    package/advisory_identity: "N/A"
    severity: "N/A"
    dependency_reachability: "N/A"
  evidence_status: HISTORICAL
- candidate_sha: "448a40551b856f286cc52f1cc4de5f78f8ab0982"
  execution_baseline_sha: UNPINNED
  evidence_run_id: "37602196416#112729097078"
  candidate_result: NOT_RUN
  regression_status: NOT_RUN
  acceptance_status: FAIL
  signature:
    command: "not-executed"
    exit_code: "skipped"
    failure_class: "not-executed"
    assertion/error_code: "job skipped"
    affected_files_or_symbols: "N/A"
    package/advisory_identity: "N/A"
    severity: "N/A"
    dependency_reachability: "N/A"
  evidence_status: HISTORICAL
- candidate_sha: "448a40551b856f286cc52f1cc4de5f78f8ab0982"
  execution_baseline_sha: UNPINNED
  evidence_run_id: "37602196416#112729096475"
  candidate_result: NOT_RUN
  regression_status: NOT_RUN
  acceptance_status: FAIL
  signature:
    command: "not-executed"
    exit_code: "skipped"
    failure_class: "not-executed"
    assertion/error_code: "job skipped"
    affected_files_or_symbols: "N/A"
    package/advisory_identity: "N/A"
    severity: "N/A"
    dependency_reachability: "N/A"
  evidence_status: HISTORICAL
- candidate_sha: "448a40551b856f286cc52f1cc4de5f78f8ab0982"
  execution_baseline_sha: UNPINNED
  evidence_run_id: "37602196416#112729003561"
  candidate_result: NOT_RUN
  regression_status: NOT_RUN
  acceptance_status: FAIL
  signature:
    command: "not-executed"
    exit_code: "skipped"
    failure_class: "not-executed"
    assertion/error_code: "job skipped"
    affected_files_or_symbols: "N/A"
    package/advisory_identity: "N/A"
    severity: "N/A"
    dependency_reachability: "N/A"
  evidence_status: HISTORICAL
- candidate_sha: "448a40551b856f286cc52f1cc4de5f78f8ab0982"
  execution_baseline_sha: UNPINNED
  evidence_run_id: "37602196416#112729097410"
  candidate_result: NOT_RUN
  regression_status: NOT_RUN
  acceptance_status: FAIL
  signature:
    command: "not-executed"
    exit_code: "skipped"
    failure_class: "not-executed"
    assertion/error_code: "job skipped"
    affected_files_or_symbols: "N/A"
    package/advisory_identity: "N/A"
    severity: "N/A"
    dependency_reachability: "N/A"
  evidence_status: HISTORICAL
- candidate_sha: "448a40551b856f286cc52f1cc4de5f78f8ab0982"
  execution_baseline_sha: UNPINNED
  evidence_run_id: "37602196416#112729097308"
  candidate_result: NOT_RUN
  regression_status: NOT_RUN
  acceptance_status: FAIL
  signature:
    command: "not-executed"
    exit_code: "skipped"
    failure_class: "not-executed"
    assertion/error_code: "job skipped"
    affected_files_or_symbols: "N/A"
    package/advisory_identity: "N/A"
    severity: "N/A"
    dependency_reachability: "N/A"
  evidence_status: HISTORICAL
```

#### Historical candidate evidence — 462c100c4

`evidence_status=HISTORICAL`，`stage8_eligible=false`。下面的 YAML 曾经被标成 CURRENT，现已整组改标。`candidate_sha=462c100c491e790e4ce12476a2de34c683c61e7c`，合并树 `39259eac078a5d5b0223f180d4aa1f429a48a98f`（日志 `HEAD is now at 39259eac0 Merge 462c100c4… into 82387506…`）。它不是记账前的 tip `448a40551`，更不是本记账提交之后的 tip。`execution_baseline_sha` 全是 `UNPINNED`。不得把这些行的 FAIL 或 `NOT_RUN` 抄进 CURRENT。check-docs job `112665542148` 只保留 FAIL（`exit_code: 123`）。同一 id 的 PASS 行已删除。方案文件不在那次 oxfmt 失败列表里，这只是观察。

```yaml
- candidate_sha: "462c100c491e790e4ce12476a2de34c683c61e7c"
  execution_baseline_sha: UNPINNED
  evidence_run_id: "37582511341#112665174584"
  candidate_result: FAIL
  regression_status: UNKNOWN
  acceptance_status: FAIL
  signature:
    command: "pnpm format:check"
    exit_code: "1"
    failure_class: "format"
    assertion/error_code: "Format issues found in above 4 files"
    affected_files_or_symbols: "deploy/ha/controller/fence/README.md; deploy/ha/controller/fence/STAGING-CREDS-CHECKLIST.md; docs/design/honest-empty-reply-direct-only-2026-10-06.md; src/agents/sandbox/ACCOUNT_WORKER_SANDBOX_IMAGES.md"
    package/advisory_identity: "N/A"
    severity: "N/A"
    dependency_reachability: "N/A"
  evidence_status: HISTORICAL
- candidate_sha: "462c100c491e790e4ce12476a2de34c683c61e7c"
  execution_baseline_sha: UNPINNED
  evidence_run_id: "37582511341#112665174405"
  candidate_result: FAIL
  regression_status: UNKNOWN
  acceptance_status: FAIL
  signature:
    command: "scripts/delivery/ledger.test.ts :: production releases.jsonl keeps a single open LIVE row after seq107 record"
    exit_code: "1; Tests 1 failed | 122 passed (123)"
    failure_class: "AssertionError"
    assertion/error_code: "expected [ 112 ] to deeply equal []; expect(errorSeqs).toEqual([])"
    affected_files_or_symbols: "scripts/delivery/ledger.test.ts; deploy/production/releases.jsonl; errorSeqs; seq 112; open LIVE seq 107"
    package/advisory_identity: "N/A"
    severity: "N/A"
    dependency_reachability: "N/A"
  evidence_status: HISTORICAL
- candidate_sha: "462c100c491e790e4ce12476a2de34c683c61e7c"
  execution_baseline_sha: UNPINNED
  evidence_run_id: "37582511520#112665169887"
  candidate_result: FAIL
  regression_status: UNKNOWN
  acceptance_status: FAIL
  signature:
    command: "pre-commit run --all-files pnpm-audit-prod"
    exit_code: "1"
    failure_class: "audit-hook"
    assertion/error_code: "pnpm-audit-prod failed; count line is not a signature"
    affected_files_or_symbols: "not-extracted"
    package/advisory_identity: "simple-git GHSA-v5rq-49vh-5v5c; simple-git GHSA-x6jw-m9v5-85vh; proxy-addr GHSA-jqcg-44mw-7w3h"
    severity: "critical"
    dependency_reachability: "not-extracted"
  evidence_status: HISTORICAL
- candidate_sha: "462c100c491e790e4ce12476a2de34c683c61e7c"
  execution_baseline_sha: UNPINNED
  evidence_run_id: "37582511520#112665542148"
  candidate_result: FAIL
  regression_status: UNKNOWN
  acceptance_status: FAIL
  signature:
    command: "pnpm check:docs"
    exit_code: "123"
    failure_class: "format"
    assertion/error_code: "Format issues found in above 1 files"
    affected_files_or_symbols: "docs/design/honest-empty-reply-direct-only-2026-10-06.md"
    package/advisory_identity: "N/A"
    severity: "N/A"
    dependency_reachability: "N/A"
  evidence_status: HISTORICAL
- candidate_sha: "462c100c491e790e4ce12476a2de34c683c61e7c"
  execution_baseline_sha: UNPINNED
  evidence_run_id: "37582511387#112665169078"
  candidate_result: FAIL
  regression_status: UNKNOWN
  acceptance_status: FAIL
  signature:
    command: "freeze + phase0 evidence tests"
    exit_code: "1"
    failure_class: "not-extracted"
    assertion/error_code: "not-extracted"
    affected_files_or_symbols: "not-extracted"
    package/advisory_identity: "N/A"
    severity: "N/A"
    dependency_reachability: "N/A"
  evidence_status: HISTORICAL
- candidate_sha: "462c100c491e790e4ce12476a2de34c683c61e7c"
  execution_baseline_sha: UNPINNED
  evidence_run_id: "37582511340#112665593382"
  candidate_result: NOT_RUN
  regression_status: NOT_RUN
  acceptance_status: FAIL
  signature:
    command: "not-executed"
    exit_code: "skipped"
    failure_class: "not-executed"
    assertion/error_code: "job skipped; do not inherit historical FAIL"
    affected_files_or_symbols: "N/A"
    package/advisory_identity: "N/A"
    severity: "N/A"
    dependency_reachability: "N/A"
  evidence_status: HISTORICAL
```

这组 462c 行没有第二份 Signature。比较器的 `b` 是 `null`，所以 `signatures_equal` 返回 `UNKNOWN`。`candidate_result: FAIL` 的行因此保持 `regression_status: UNKNOWN`，不得写成 `BASELINE_UNCHANGED`。install-smoke 的 `candidate_result` 是 `NOT_RUN`。Memory Workspace Freeze 的 `assertion/error_code` 是字符串 `not-extracted`。secrets 的 `dependency_reachability` 也是 `not-extracted`，条数合计不是字段。

同一 `candidate_sha` 上其余 EvidenceRow 同样是 HISTORICAL。skipped 的 `candidate_result` 是 `NOT_RUN`。

```yaml
- candidate_sha: "462c100c491e790e4ce12476a2de34c683c61e7c"
  execution_baseline_sha: UNPINNED
  evidence_run_id: "37582511520#112665169689"
  candidate_result: PASS
  regression_status: UNKNOWN
  acceptance_status: PASS
  signature:
    command: "actions job conclusion success"
    exit_code: "0"
    failure_class: "N/A"
    assertion/error_code: "assertion text not extracted"
    affected_files_or_symbols: "N/A"
    package/advisory_identity: "N/A"
    severity: "N/A"
    dependency_reachability: "N/A"
  evidence_status: HISTORICAL
- candidate_sha: "462c100c491e790e4ce12476a2de34c683c61e7c"
  execution_baseline_sha: UNPINNED
  evidence_run_id: "37582511340#112665168989"
  candidate_result: PASS
  regression_status: UNKNOWN
  acceptance_status: PASS
  signature:
    command: "actions job conclusion success"
    exit_code: "0"
    failure_class: "N/A"
    assertion/error_code: "assertion text not extracted"
    affected_files_or_symbols: "N/A"
    package/advisory_identity: "N/A"
    severity: "N/A"
    dependency_reachability: "N/A"
  evidence_status: HISTORICAL
- candidate_sha: "462c100c491e790e4ce12476a2de34c683c61e7c"
  execution_baseline_sha: UNPINNED
  evidence_run_id: "37582511517#112665169972"
  candidate_result: PASS
  regression_status: UNKNOWN
  acceptance_status: PASS
  signature:
    command: "actions job conclusion success"
    exit_code: "0"
    failure_class: "N/A"
    assertion/error_code: "assertion text not extracted"
    affected_files_or_symbols: "N/A"
    package/advisory_identity: "N/A"
    severity: "N/A"
    dependency_reachability: "N/A"
  evidence_status: HISTORICAL
- candidate_sha: "462c100c491e790e4ce12476a2de34c683c61e7c"
  execution_baseline_sha: UNPINNED
  evidence_run_id: "37582511517#112665169851"
  candidate_result: PASS
  regression_status: UNKNOWN
  acceptance_status: PASS
  signature:
    command: "actions job conclusion success"
    exit_code: "0"
    failure_class: "N/A"
    assertion/error_code: "assertion text not extracted"
    affected_files_or_symbols: "N/A"
    package/advisory_identity: "N/A"
    severity: "N/A"
    dependency_reachability: "N/A"
  evidence_status: HISTORICAL
- candidate_sha: "462c100c491e790e4ce12476a2de34c683c61e7c"
  execution_baseline_sha: UNPINNED
  evidence_run_id: "37582511520#112665544039"
  candidate_result: NOT_RUN
  regression_status: NOT_RUN
  acceptance_status: FAIL
  signature:
    command: "not-executed"
    exit_code: "skipped"
    failure_class: "not-executed"
    assertion/error_code: "job skipped"
    affected_files_or_symbols: "N/A"
    package/advisory_identity: "N/A"
    severity: "N/A"
    dependency_reachability: "N/A"
  evidence_status: HISTORICAL
- candidate_sha: "462c100c491e790e4ce12476a2de34c683c61e7c"
  execution_baseline_sha: UNPINNED
  evidence_run_id: "37582511520#112665544636"
  candidate_result: NOT_RUN
  regression_status: NOT_RUN
  acceptance_status: FAIL
  signature:
    command: "not-executed"
    exit_code: "skipped"
    failure_class: "not-executed"
    assertion/error_code: "job skipped"
    affected_files_or_symbols: "N/A"
    package/advisory_identity: "N/A"
    severity: "N/A"
    dependency_reachability: "N/A"
  evidence_status: HISTORICAL
- candidate_sha: "462c100c491e790e4ce12476a2de34c683c61e7c"
  execution_baseline_sha: UNPINNED
  evidence_run_id: "37582511520#112665544286"
  candidate_result: NOT_RUN
  regression_status: NOT_RUN
  acceptance_status: FAIL
  signature:
    command: "not-executed"
    exit_code: "skipped"
    failure_class: "not-executed"
    assertion/error_code: "job skipped"
    affected_files_or_symbols: "N/A"
    package/advisory_identity: "N/A"
    severity: "N/A"
    dependency_reachability: "N/A"
  evidence_status: HISTORICAL
- candidate_sha: "462c100c491e790e4ce12476a2de34c683c61e7c"
  execution_baseline_sha: UNPINNED
  evidence_run_id: "37582511520#112665544394"
  candidate_result: NOT_RUN
  regression_status: NOT_RUN
  acceptance_status: FAIL
  signature:
    command: "not-executed"
    exit_code: "skipped"
    failure_class: "not-executed"
    assertion/error_code: "job skipped"
    affected_files_or_symbols: "N/A"
    package/advisory_identity: "N/A"
    severity: "N/A"
    dependency_reachability: "N/A"
  evidence_status: HISTORICAL
- candidate_sha: "462c100c491e790e4ce12476a2de34c683c61e7c"
  execution_baseline_sha: UNPINNED
  evidence_run_id: "37582511520#protocol-job-absent"
  candidate_result: NOT_RUN
  regression_status: NOT_RUN
  acceptance_status: FAIL
  signature:
    command: "not-executed"
    exit_code: "skipped"
    failure_class: "not-executed"
    assertion/error_code: "job skipped"
    affected_files_or_symbols: "N/A"
    package/advisory_identity: "N/A"
    severity: "N/A"
    dependency_reachability: "N/A"
  evidence_status: HISTORICAL
- candidate_sha: "462c100c491e790e4ce12476a2de34c683c61e7c"
  execution_baseline_sha: UNPINNED
  evidence_run_id: "37582511520#112665543653"
  candidate_result: NOT_RUN
  regression_status: NOT_RUN
  acceptance_status: FAIL
  signature:
    command: "not-executed"
    exit_code: "skipped"
    failure_class: "not-executed"
    assertion/error_code: "job skipped"
    affected_files_or_symbols: "N/A"
    package/advisory_identity: "N/A"
    severity: "N/A"
    dependency_reachability: "N/A"
  evidence_status: HISTORICAL
- candidate_sha: "462c100c491e790e4ce12476a2de34c683c61e7c"
  execution_baseline_sha: UNPINNED
  evidence_run_id: "37582511520#112665544116"
  candidate_result: NOT_RUN
  regression_status: NOT_RUN
  acceptance_status: FAIL
  signature:
    command: "not-executed"
    exit_code: "skipped"
    failure_class: "not-executed"
    assertion/error_code: "job skipped"
    affected_files_or_symbols: "N/A"
    package/advisory_identity: "N/A"
    severity: "N/A"
    dependency_reachability: "N/A"
  evidence_status: HISTORICAL
- candidate_sha: "462c100c491e790e4ce12476a2de34c683c61e7c"
  execution_baseline_sha: UNPINNED
  evidence_run_id: "37582511520#112665544031"
  candidate_result: NOT_RUN
  regression_status: NOT_RUN
  acceptance_status: FAIL
  signature:
    command: "not-executed"
    exit_code: "skipped"
    failure_class: "not-executed"
    assertion/error_code: "job skipped"
    affected_files_or_symbols: "N/A"
    package/advisory_identity: "N/A"
    severity: "N/A"
    dependency_reachability: "N/A"
  evidence_status: HISTORICAL
- candidate_sha: "462c100c491e790e4ce12476a2de34c683c61e7c"
  execution_baseline_sha: UNPINNED
  evidence_run_id: "37582511520#112665544881"
  candidate_result: NOT_RUN
  regression_status: NOT_RUN
  acceptance_status: FAIL
  signature:
    command: "not-executed"
    exit_code: "skipped"
    failure_class: "not-executed"
    assertion/error_code: "job skipped"
    affected_files_or_symbols: "N/A"
    package/advisory_identity: "N/A"
    severity: "N/A"
    dependency_reachability: "N/A"
  evidence_status: HISTORICAL
- candidate_sha: "462c100c491e790e4ce12476a2de34c683c61e7c"
  execution_baseline_sha: UNPINNED
  evidence_run_id: "37582511520#112665544715"
  candidate_result: NOT_RUN
  regression_status: NOT_RUN
  acceptance_status: FAIL
  signature:
    command: "not-executed"
    exit_code: "skipped"
    failure_class: "not-executed"
    assertion/error_code: "job skipped"
    affected_files_or_symbols: "N/A"
    package/advisory_identity: "N/A"
    severity: "N/A"
    dependency_reachability: "N/A"
  evidence_status: HISTORICAL
- candidate_sha: "462c100c491e790e4ce12476a2de34c683c61e7c"
  execution_baseline_sha: UNPINNED
  evidence_run_id: "37582511520#112665170994"
  candidate_result: NOT_RUN
  regression_status: NOT_RUN
  acceptance_status: FAIL
  signature:
    command: "not-executed"
    exit_code: "skipped"
    failure_class: "not-executed"
    assertion/error_code: "job skipped"
    affected_files_or_symbols: "N/A"
    package/advisory_identity: "N/A"
    severity: "N/A"
    dependency_reachability: "N/A"
  evidence_status: HISTORICAL
- candidate_sha: "462c100c491e790e4ce12476a2de34c683c61e7c"
  execution_baseline_sha: UNPINNED
  evidence_run_id: "37582511520#112665544761"
  candidate_result: NOT_RUN
  regression_status: NOT_RUN
  acceptance_status: FAIL
  signature:
    command: "not-executed"
    exit_code: "skipped"
    failure_class: "not-executed"
    assertion/error_code: "job skipped"
    affected_files_or_symbols: "N/A"
    package/advisory_identity: "N/A"
    severity: "N/A"
    dependency_reachability: "N/A"
  evidence_status: HISTORICAL
- candidate_sha: "462c100c491e790e4ce12476a2de34c683c61e7c"
  execution_baseline_sha: UNPINNED
  evidence_run_id: "37582511520#112665544587"
  candidate_result: NOT_RUN
  regression_status: NOT_RUN
  acceptance_status: FAIL
  signature:
    command: "not-executed"
    exit_code: "skipped"
    failure_class: "not-executed"
    assertion/error_code: "job skipped"
    affected_files_or_symbols: "N/A"
    package/advisory_identity: "N/A"
    severity: "N/A"
    dependency_reachability: "N/A"
  evidence_status: HISTORICAL
```

`82387506` 上的 push run 37577960697、37577960688、37577960643 没有写入任何 `baseline_signature`。

#### Historical candidate evidence — aee849395

`evidence_status=HISTORICAL`。这些行不是 EvidenceRow：缺 `signature` 对象。`stage8_eligible=false`。`candidate_sha` 是 `aee84939500e95d36d62beecab8ea5f21204bdbb`，合并树是 `eebbc04f9ecea9413e32a3faccbb1a82dcd08585`，run 是 [37581050809](https://github.com/upbeyond/openbot/actions/runs/37581050809)、[37581050811](https://github.com/upbeyond/openbot/actions/runs/37581050811)、[37581050890](https://github.com/upbeyond/openbot/actions/runs/37581050890)、[37581050813](https://github.com/upbeyond/openbot/actions/runs/37581050813)、[37581050867](https://github.com/upbeyond/openbot/actions/runs/37581050867)。不得与 CURRENT 列表混写。这是专家复核时的快照，不是 Stage 0 冻结。当时 install-smoke 已是 NOT_RUN；CI Gate check 与 CI `check` 已分行。

| workflow                | job                                                                         | run ID                                                                                         | 候选结果 | 基线 job/run                                                                                                          | 回归    | 验收                                          |
| ----------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------- | ------- | --------------------------------------------- |
| CI Gate                 | check (types, lint, format)                                                 | [37581050809](https://github.com/upbeyond/openbot/actions/runs/37581050809) job `112660550869` | FAIL     | 未与 `82387506` 的同名日志做签名配对。不继承历史表                                                                    | UNKNOWN | 该检查为绿：FAIL。不得 PASS                   |
| CI Gate                 | delivery guard                                                              | 同上 run，job `112660550636`                                                                   | FAIL     | 未签名配对。不继承历史表的 `[112]` 闭合                                                                               | UNKNOWN | 不得 PASS                                     |
| CI                      | secrets                                                                     | [37581050811](https://github.com/upbeyond/openbot/actions/runs/37581050811) job `112660723790` | FAIL     | 未签名配对。不继承历史表                                                                                              | UNKNOWN | 不得写成 Stage 6 验收 PASS                    |
| CI                      | check-docs                                                                  | 同上 run，job `112660787499`                                                                   | FAIL     | 未签名配对。日志只列出 `docs/design/honest-empty-reply-direct-only-2026-10-06.md`，不含方案文件。这只是观察，不是闭合 | UNKNOWN | 全仓文档格式为绿：FAIL                        |
| CI                      | docs-scope                                                                  | 同上 run，job `112660723798`                                                                   | PASS     | 未签名配对。候选 PASS 不推出基线 PASS                                                                                 | UNKNOWN | 该 job 候选成功。不是回归闭合，也不是产品验收 |
| Memory Workspace Freeze | freeze + phase0 evidence tests                                              | [37581050890](https://github.com/upbeyond/openbot/actions/runs/37581050890) job `112660550909` | FAIL     | 未签名配对。不继承历史表                                                                                              | UNKNOWN | 扫描干净：FAIL                                |
| Install Smoke           | docs-scope                                                                  | [37581050813](https://github.com/upbeyond/openbot/actions/runs/37581050813) job `112660550687` | PASS     | 未签名配对                                                                                                            | UNKNOWN | 该 job 候选成功。不是 install-smoke PASS      |
| Install Smoke           | install-smoke                                                               | 同上 run，job `112660726140`                                                                   | NOT_RUN  | skipped。历史表里该 job 曾 FAIL，不得继承成 BASELINE_UNCHANGED                                                        | NOT_RUN | 无法闭合。不得 PASS                           |
| Workflow Sanity         | no-tabs                                                                     | [37581050867](https://github.com/upbeyond/openbot/actions/runs/37581050867) job `112660551090` | PASS     | 未签名配对                                                                                                            | UNKNOWN | 该 job 候选成功。不是产品验收                 |
| Workflow Sanity         | actionlint                                                                  | 同上 run，job `112660551358`                                                                   | PASS     | 未签名配对                                                                                                            | UNKNOWN | 该 job 候选成功。不是产品验收                 |
| CI                      | check                                                                       | 37581050811 job `112660789837`                                                                 | NOT_RUN  | skipped。这不是 CI Gate 的 check                                                                                      | NOT_RUN | Stage 6 类型与 lint 这次无法闭合。不得 PASS   |
| CI                      | build-artifacts                                                             | job `112660790369`                                                                             | NOT_RUN  | skipped。不继承历史 TS18047 闭合                                                                                      | NOT_RUN | 无法闭合。不得 PASS                           |
| CI                      | checks                                                                      | job `112660790359`                                                                             | NOT_RUN  | skipped。node/bun 测试矩阵这次没有分片结论                                                                            | NOT_RUN | 选定测试子集无法闭合。不得 PASS               |
| CI                      | checks-windows                                                              | job `112660789846`                                                                             | NOT_RUN  | skipped。不是 CANCELLED，也不继承历史 Windows 行                                                                      | NOT_RUN | 无法闭合。不得 PASS，也不得写成 NOT_COVERED   |
| CI                      | protocol（含在 skipped 的 checks 矩阵；同 run 无单独已执行的 protocol job） | 37581050811                                                                                    | NOT_RUN  | 没有当前候选的 protocol 失败签名                                                                                      | NOT_RUN | 无法闭合。不得 PASS                           |
| CI                      | changed-scope                                                               | job `112660789278`                                                                             | NOT_RUN  | skipped                                                                                                               | NOT_RUN | 不得 PASS                                     |
| CI                      | skills-python                                                               | job `112660789812`                                                                             | NOT_RUN  | skipped。不继承历史 PASS                                                                                              | NOT_RUN | 无法闭合。不得 PASS                           |
| CI                      | cogniweave-sdk-core-gate                                                    | job `112660790030`                                                                             | NOT_RUN  | skipped。不继承历史 PASS                                                                                              | NOT_RUN | 不得 PASS                                     |
| CI                      | cogniweave-sdk-integration-rollback                                         | job `112660791306`                                                                             | NOT_RUN  | skipped                                                                                                               | NOT_RUN | 不得 PASS                                     |
| CI                      | android / ios / macos / release-check                                       | jobs `112660789782`、`112660724643`、`112660791377`、`112660791035`                            | NOT_RUN  | skipped                                                                                                               | NOT_RUN | 不得 PASS                                     |

`82387506` 上存在 push run（CI Gate [37577960697](https://github.com/upbeyond/openbot/actions/runs/37577960697)、CI [37577960688](https://github.com/upbeyond/openbot/actions/runs/37577960688)、Install Smoke [37577960643](https://github.com/upbeyond/openbot/actions/runs/37577960643)）。本表没有用它们做签名配对，所以失败行保持 UNKNOWN。

#### Historical candidate evidence — b14b16b80

`evidence_status=HISTORICAL`。下表不是 EvidenceRow，`stage8_eligible=false`。只保留 `b14b16b80` / 合并树 `e95314e60` / 当时 main `eec7c3a0b` / run [37575951552](https://github.com/upbeyond/openbot/actions/runs/37575951552)。不得把这里的 `BASELINE_UNCHANGED`、PASS 或 CANCELLED 抄到 CURRENT。其中用严重度条数或「看起来一样」写成的 `BASELINE_UNCHANGED` 没有两份相等的 Signature。旧 install-smoke 是 FAIL。448a 与 462c 的 HISTORICAL 行里，install-smoke 都是 NOT_RUN。Windows 在旧表里有 FAIL 与 CANCELLED；448a 与 462c 的 checks-windows 都是 NOT_RUN。这些 HISTORICAL 结论不进入 Stage 8。它们不进入上面的 CURRENT 列表。b14 表里「方案文件 oxfmt」那条 PASS 已删除；format 与 check-docs 的 Actions 结论仍是 FAIL，方案文件不在失败列表里只留在 FAIL 行的叙述中。

[37575951552](https://github.com/upbeyond/openbot/actions/runs/37575951552) 的 workflow 总结论是 `cancelled`。不得把它收成笼统的「CI = FAIL」。当时已完成的 job 各自保留 FAIL 或 PASS。配对用的 push 基线是 [37575422297](https://github.com/upbeyond/openbot/actions/runs/37575422297)、[37575422470](https://github.com/upbeyond/openbot/actions/runs/37575422470)、[37575423029](https://github.com/upbeyond/openbot/actions/runs/37575423029)、[37575422474](https://github.com/upbeyond/openbot/actions/runs/37575422474)。相关旧 run：CI Gate [37575951559](https://github.com/upbeyond/openbot/actions/runs/37575951559)、Memory Workspace Freeze [37575951642](https://github.com/upbeyond/openbot/actions/runs/37575951642)、Install Smoke [37575951530](https://github.com/upbeyond/openbot/actions/runs/37575951530)。这些都不是当前证据。

旧表里的 Windows 六片当时没有被排除出 Stage 6「选定测试子集」。取消的四片因此不是范围外。该事实只描述那次已被取代的 run。

| 证据                                  | 候选结果  | 可信基线                                                                                                                                                                                                                                                                                                         | 回归               | 验收                                                  |
| ------------------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ | ----------------------------------------------------- |
| check-docs（仓库）                    | FAIL      | 同名 job `112643267213` 在 `eec7c3a0b` 的 push 上 skipped，没有第二份 check-docs 日志。等价且已执行的 oxfmt 是 format `112643112838` 与 check `112643330976`：与候选 format/check 同为 4 个文件，其中包含 `docs/design/honest-empty-reply-direct-only-2026-10-06.md`。候选 check-docs 只失败这一份，不是方案文件 | BASELINE_UNCHANGED | 全仓文档格式为绿：FAIL。归因不把验收改成 PASS         |
| format / `pnpm check`                 | FAIL      | 候选与 `eec7c3a0b` 都停在同一 4 个文件：两份 fence markdown、上一行设计文档、`src/agents/sandbox/ACCOUNT_WORKER_SANDBOX_IMAGES.md`。候选 check `112645002041`、format `112644775198`；基线 check `112643330976`、format `112643112838`                                                                           | BASELINE_UNCHANGED | 仓库格式绝对干净：FAIL                                |
| delivery guard                        | FAIL      | 两边都是 `expect(errorSeqs).toEqual([])`，实际 `[112]`。候选 `112644775363`，基线 `112643112628`                                                                                                                                                                                                                 | BASELINE_UNCHANGED | 账本无未关闭错误序号：FAIL                            |
| secrets                               | FAIL      | 两边都是 `Severity: 16 low \| 67 moderate \| 22 high \| 3 critical`，且含 `@modelcontextprotocol/sdk`。候选 `112644775355`，基线 `112643216431`                                                                                                                                                                  | BASELINE_UNCHANGED | 依赖审计为绿：FAIL。不得写成 Stage 6 验收 PASS        |
| node `pnpm test`                      | FAIL      | 候选 `112645002073` 与基线 `112643331079`：`Test Files 109 failed \| 368 passed`，`Tests 15 failed \| 2906 passed \| 1 skipped`。`FAIL` 行集合相同。具名失败在 10 个文件，见下段。两边都出现 `TalkDefaults.kt` 与 `ERR_VM_MODULE_DIFFERENT_CONTEXT`                                                              | BASELINE_UNCHANGED | 测试为绿：FAIL                                        |
| `protocol:check`                      | FAIL      | 两边 `git diff --exit-code` 的 Swift diff 正文相同，两份 `GatewayModels.swift` 都新增 `LocalFilesRedeemParams`。候选 `112645002094`，基线 `112643331036`                                                                                                                                                         | BASELINE_UNCHANGED | 生成物绝对绿：FAIL                                    |
| build-artifacts                       | FAIL      | 两边都是 `src/agents/sandbox/account-worker-gateway.ts` 第 50、51 行 `TS18047` `'head' is possibly 'null'`。候选 `112645002045`，基线 `112643330869`                                                                                                                                                             | BASELINE_UNCHANGED | 构建为绿：FAIL                                        |
| install-smoke                         | FAIL      | 同一 `TS18047`。候选 [37575951530](https://github.com/upbeyond/openbot/actions/runs/37575951530) job `112644907794`，基线 [37575423029](https://github.com/upbeyond/openbot/actions/runs/37575423029) job `112643217008`                                                                                         | BASELINE_UNCHANGED | 安装烟测为绿：FAIL                                    |
| Memory Workspace Freeze               | FAIL      | 两边 baseline blob `03efd61d` 出现 4 次，`unassigned` 14 次，`resolveAgentWorkspaceDir` 22 次。候选 [37575951642](https://github.com/upbeyond/openbot/actions/runs/37575951642) job `112644775031`，基线 [37575422474](https://github.com/upbeyond/openbot/actions/runs/37575422474) job `112643112519`          | BASELINE_UNCHANGED | 扫描干净：FAIL                                        |
| bun test                              | FAIL      | 候选 `112645002046`：`Failed Tests 16`，`Test Files 12 failed \| 470 passed`。基线 `112643331145` 的结论是 success，但日志只有 `Skipping bun test lane on push events`，套件没有执行                                                                                                                             | UNKNOWN            | 缺可信基线上一次真正跑完的 bun 日志。结果不是 UNKNOWN |
| CI workflow 37575951552               | CANCELLED | 总结论是 cancelled。已完成 job 各自是 FAIL 或 PASS，见本表其余行。不得收成「CI = FAIL」                                                                                                                                                                                                                          | CANCELLED          | 不得 PASS                                             |
| Windows `pnpm test` 6/6               | FAIL      | 候选 `112645002051` 与当时基线 `112643330924`：`Test Files 17 failed \| 300 passed`，`Tests 33 failed`。33 个 `FAIL` 行相同。仍在 Stage 6 选定测试子集内，不是范围外                                                                                                                                             | BASELINE_UNCHANGED | 这一片为绿：FAIL。不得 PASS                           |
| Windows `pnpm test` 2/6               | FAIL      | 候选 `112645002114` 与当时基线 `112643331063`：`Test Files 4 failed \| 313 passed \| 1 skipped`，`Tests 4 failed`。4 个 `FAIL` 行相同。仍在选定测试子集内                                                                                                                                                        | BASELINE_UNCHANGED | 这一片为绿：FAIL。不得 PASS                           |
| Windows `pnpm test` 1/6               | CANCELLED | 候选 `112645002057` 被取消，没有失败签名。当时基线 `112643331034` 已失败，不能拿来填候选结果。未书面排除出范围                                                                                                                                                                                                   | CANCELLED          | 不得 PASS。不得写成 NOT_COVERED                       |
| Windows `pnpm test` 3/6               | CANCELLED | 候选 `112645002285` 被取消，没有失败签名。当时基线 `112643330941` 已失败，不能拿来填候选结果。未书面排除出范围                                                                                                                                                                                                   | CANCELLED          | 不得 PASS。不得写成 NOT_COVERED                       |
| Windows `pnpm test` 4/6               | CANCELLED | 候选 `112645002134` 被取消，没有失败签名。当时基线 `112643331053` 已失败，不能拿来填候选结果。未书面排除出范围                                                                                                                                                                                                   | CANCELLED          | 不得 PASS。不得写成 NOT_COVERED                       |
| Windows `pnpm test` 5/6               | CANCELLED | 候选 `112645002127` 被取消，没有失败签名。当时基线 `112643330968` 已失败，不能拿来填候选结果。未书面排除出范围                                                                                                                                                                                                   | CANCELLED          | 不得 PASS。不得写成 NOT_COVERED                       |
| changed-scope                         | PASS      | 候选 `112644918138` 与当时基线 `112643265698` 都是 success                                                                                                                                                                                                                                                       | PASS               | 该 job PASS。不是产品验收                             |
| docs-scope                            | PASS      | 候选 `112644775494` 与基线 `112643216763` 都是 success                                                                                                                                                                                                                                                           | PASS               | 该 job PASS。不是 Stage 0–8 产品验收                  |
| conversation-lifecycle                | PASS      | 候选 `112645002089` 与基线 `112643331100` 都是 success                                                                                                                                                                                                                                                           | PASS               | 该 job PASS。不是产品验收                             |
| cogniweave core 与 rollback           | PASS      | core 候选 `112645002008`、基线 `112643331026`；rollback 候选 `112645668890`、基线 `112644859915`。都是 success                                                                                                                                                                                                   | PASS               | 该 job PASS。不是产品验收                             |
| skills-python                         | PASS      | 候选 `112645002055` 与基线 `112643330956` 都是 success                                                                                                                                                                                                                                                           | PASS               | 该 job PASS。不是产品验收                             |
| extensions `pnpm test:extensions`     | PASS      | 候选 `112645002050` 与基线 `112643331050` 都是 success                                                                                                                                                                                                                                                           | PASS               | 该 job PASS。不是产品验收                             |
| android / macos / ios / release-check | NOT_RUN   | 候选为 skipped。基线 android test `112643330832` 曾失败。候选没有执行，不能配成 BASELINE_UNCHANGED                                                                                                                                                                                                               | NOT_RUN            | 范围内却没跑时不得验收 PASS                           |

下面两段只解释 `b14b16b80` 这张 HISTORICAL 表。它不是 CURRENT，也不是 `aee849395`。node `pnpm test` 的 15 个具名失败在这 10 个文件，当时的合并树与 `eec7c3a0b` 相同：`test/appcast.test.ts`、`src/config/talk-defaults.test.ts`（含 `TalkDefaults.kt` ENOENT）、`src/infra/system-presence.version.test.ts`、`src/vault-sync/runtime-reindex-hook.node.test.ts`、`src/shared/preview-artifact/deliverable-envelope.test.ts`、`ui/src/ui/storage.node.test.ts`、`ui/src/ui/workspace-compose-ui.node.test.ts`、`ui/src/ui/artifact/event-handler.test.ts`、`ui/src/ui/artifact/registry.test.ts`、`ui/src/ui/controllers/platform-auth.test.ts`。16 个失败测试在 bun job，12 个文件：上面去掉 vault-sync，另加 `src/memory/qmd-manager.test.ts`、`src/cron/isolated-agent/delivery-dispatch.named-agent.test.ts`、`src/plugins/__tests__/loader-registry-roundtrip.test.ts`。bun 的归因仍是 UNKNOWN。

相对 `0685ce05` 的叙述只作为历史起草示例，不是执行证据。它不属于当前表。

`ci-gate.yml` 注释提到 Blacksmith runner。历史表抽查的 node 测试（当时候选 `112645002073`、当时基线 `112643331079`）labels 都是 `ubuntu-24.04`，runner group 都是 `GitHub Actions`。因此「失败是因为 Blacksmith 从未订阅」在那次证据里归因是 UNKNOWN。该结论不进入 Stage 8，也不转移到 CURRENT。448a 与 462c 的 HISTORICAL checks 矩阵是 NOT_RUN。CURRENT 的 checks 与 checks-windows 是 NOT_RUN，没有新的 runner 结论。

## 5. 分维度方法

### 5.0 信任边界（Stage 1，必验）

**问题：** 在已选定的剖面上，租户边界、沙箱、凭证根、插件权限、设备配对是否与 `security-profile.ts` 的失败关闭一致。未选定剖面时本节约全部标 NOT_COVERED，只保留 §2.4 允许的静态契约检查。

| 检查项             | 证据                                                                                                                          | 方法                                               | 通过标准                                                                                                                                                                      | 风险                                                             |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| 剖面选择权在服务端 | `src/gateway/security-profile.ts` 错误码 `SECURITY_PROFILE_CLIENT_OVERRIDE_REJECTED`                                          | 找拒绝客户端覆盖的测试或分支                       | 客户端字段不能把剖面改成另一侧                                                                                                                                                | 配置与环境变量双源冲突未被 `SECURITY_PROFILE_CONFLICT` 拦住      |
| 企业租户边界       | 同文件 `SECURITY_PROFILE_MISSING_EXECUTION_BOUNDARY`、`MISSING_TENANTS_ROOT`、`MULTITENANT_SANDBOX_OFF`                       | 在 `managed_enterprise` 夹具上读启动校验           | 缺执行边界、缺租户根、沙箱关闭时启动失败                                                                                                                                      | 用 `personal_local` 主机宣称租户隔离                             |
| 凭证根与队列       | `SECURITY_PROFILE_SHARED_CREDENTIAL_ROOT`、`SHARED_BROWSER_ROOT`、`SHARED_QUEUE_OR_CACHE`                                     | 对照校验函数与 state/credentials 路径              | 企业剖面拒绝共享凭证根、浏览器根、队列或缓存                                                                                                                                  | 多租户共用 `~/.openbot/credentials`                              |
| 插件权限           | `SECURITY_PROFILE_UNRESTRICTED_PLUGIN_ACCESS`；`pnpm lint:plugins:no-register-http-handler`                                   | 读插件可见数据范围与 HTTP 注册 lint                | 企业剖面拒绝无限制进程内访问；lint 结果按 §4.4 记录                                                                                                                           | 把「运营者已安装的恶意插件」记成产品漏洞（`SECURITY.md` 范围外） |
| 设备配对           | `docs/concepts/architecture.md` 配对段；`docs/gateway/pairing.md`；`src/pairing`                                              | 分开 device pairing 与 `node.pair.*`               | 新设备需要批准后才发 device token；`node.pair.*` 不门控 WS 握手这一点被写进结论                                                                                               | 两种配对被收成一次「登录通过」                                   |
| 沙箱与 exec        | `docs/gateway/sandboxing.md`；`SECURITY.md` Profile A 对 `sandbox.mode` 与 `tools.exec.host` 的描述                           | 对照默认值与「沙箱未激活则落在网关宿主」的代码路径 | 结论写明默认行为属于哪一剖面                                                                                                                                                  | 文档写 sandbox、运行时落在宿主却标 PASS                          |
| 未限定的网关 exec  | `SECURITY_PROFILE_UNSCOPED_GATEWAY_EXEC`；`src/agents/sandbox/account-sandbox-startup.ts` 的 `multitenantSandboxStartupIssue` | 在 `managed_enterprise` 且多租户为真时读启动校验   | `sandbox.mode` 不是 `all` 且 `tools.exec.host=gateway` 时失败关闭。同函数在 `exec.host` 为 `node`，或 `mode=non-main` 且 host 不是 `sandbox` 时也返回 `unscoped-gateway-exec` | 只记住 `mode=off` 的另一错误码，漏掉宿主 exec                    |

负路径见 §5.6。本阶段 PASS 至少需要 E2 或 E3。仅有 `SECURITY.md` 段落（E0）不得 PASS。

#### Stage 1 执行记录

操作者把 `personal_local` 与 `managed_enterprise` 都列入本批。两份结论分开写。不合并成一句「安全通过」。B 轮修了两套启动门。本轮只抬 AUTH-01、AUTH-03 与插件权限证据，并按新 vitest 改下面的矩阵。记账前 `git fetch origin main` 后 `git rev-parse origin/main` 打印 `d478d3bdf1d2fa03cad19d920b9d4480c68a8a92`（#406）。上一份打印是 `613733bef10eda5c384d3cc64b4750ea480bf60a`（#405）。更早还打印过 `ccc10c2d4ab301a20f49369c9863ad87760ca799`（#404）和 `f9a1884d53793d7fe6ab8d2b63aa863a35db0f7f`（#400）。下表对象 SHA 当时用 `d478d3bdf1d2fa03cad19d920b9d4480c68a8a92` 复核。Stage 2 开账前再次 `git fetch origin main`，打印 `8aa8d5e45baa2022a6b7629ac34d8573fc1374e4`（#407）。这 25 条相对 `d478d3bdf` 与 `8aa8d5e45` 仍相同，表内 SHA 不改。这不是 Signature，不分配 `BASELINE_UNCHANGED`。表内 SHA 是当时 pin 上的对象，也等于现在 pin 上的对象。本分支改了剖面门源码，那些文件的分支 blob 不再等于表内 SHA。

抽样名单仍按下表冻结。对象 SHA 用 `git rev-parse d478d3bdf1d2fa03cad19d920b9d4480c68a8a92:<path>` 复核。产品三频道全列。继承频道只抽 `extensions/telegram`。表面只冻结路径，不执行 Stage 7。

| 角色         | 路径                                            | 对象 | SHA                                        |
| ------------ | ----------------------------------------------- | ---- | ------------------------------------------ |
| agent        | `src/agents/builtin-steward/identity.ts`        | blob | `0b60a485a2bd11f0facb36b934b0b3a440ba452f` |
| 剖面文件门   | `src/gateway/security-profile.ts`               | blob | `6709778fcb7be583521a589c8ba529d08b705221` |
| 剖面目录门   | `src/gateway/security-profile`                  | tree | `166641c12c1c9c8dfbf24af0192f190911b91a69` |
| 启动接线     | `src/gateway/server.impl.ts`                    | blob | `2cd194bff2c15f2847f294aa2190a5ea6696b6da` |
| 沙箱启动     | `src/agents/sandbox/account-sandbox-startup.ts` | blob | `c5b328c1f7f047a97f63e52861e9d880b8df7282` |
| 凭证根       | `src/config/paths.ts`                           | blob | `3ffaf884777b7c7a4508e83b3de2de0e3e82c28e` |
| 设备配对     | `src/infra/device-pairing.ts`                   | blob | `5193fe19ff9f687de5f6a0aaef74ae439b716a1c` |
| 频道配对     | `src/pairing/pairing-store.ts`                  | blob | `89b65925ac978a67f9f4693272a10cd4c82374d5` |
| 配对文档     | `docs/gateway/pairing.md`                       | blob | `c453ad502f8f53adef0256768a6d7215e6a12c32` |
| 沙箱文档     | `docs/gateway/sandboxing.md`                    | blob | `a8a81dde93ff21eeb0030a5d9f4a9e7af2296a5f` |
| 信任模型     | `SECURITY.md`                                   | blob | `2a86d29045bafe9ffef12b024365aa5fb427b7f6` |
| 插件 lint    | `scripts/check-no-register-http-handler.mjs`    | blob | `0884295be2dd9684d690e1c693bd61740d04f6b2` |
| 产品频道     | `extensions/wecom`                              | tree | `c634e02558228d1ed1cd13be3405e1ee5c283fc9` |
| 产品频道     | `extensions/feishu`                             | tree | `b01a8ca263ccde5afaa1275a446c2ba06fd195f1` |
| 产品频道     | `extensions/dingtalk`                           | tree | `2596af8c691bc461ec589fb8358ad4b86a14918b` |
| 继承频道抽样 | `extensions/telegram`                           | tree | `8b7466c8370da998e7d46a205c4f144496fa2728` |
| 表面 console | `ui/src/ui/views/console-subnav.ts`             | blob | `1169213550c1031ac5baef9d9f3cb7a6c5fe1cfa` |
| 表面 ios     | `apps/ios`                                      | tree | `eaaec82d6d98198d128b64971a288d4e3d80a90a` |
| 表面 android | `apps/android`                                  | tree | `c3516016fab89fd9c563cdfa83b5ed3a338aaeca` |
| 表面 harmony | `apps/harmony`                                  | tree | `de68937b12ceb7113fdad8253b569d8dcdb37e86` |
| 表面 macos   | `apps/macos`                                    | tree | `360e331f23dff1d027e082e5d59146b77d5a0878` |
| 节点宿主     | `src/node-host`                                 | tree | `42df3aeefa24fe0d55deaf023fa4fccb49bd8bb6` |
| 节点 CLI     | `src/cli/nodes-cli`                             | tree | `e5130bdf8e60cbaa2f5b903830a16f254759495c` |
| 表面 onboard | `src/commands/onboard.ts`                       | blob | `75f13549f9e41e817256290f55687451050d1398` |
| 表面 doctor  | `src/commands/doctor.ts`                        | blob | `2ddbb356ba068b9fedd974c0d24b1e148e78ec00` |

内置管家 agent id 在 `src/agents/builtin-steward/identity.ts` 写为 `main`。这只冻结身份文件。

这些本地命令没有 Actions `evidence_run_id`，不写入 CURRENT。回归列保持 UNKNOWN：没有与 pin 成对的同命令日志，不分配 `BASELINE_UNCHANGED`。

执行过的命令：

| 命令                                                                                                                                                                                                                                | 退出码 | 结果摘要                                                                                                                                                                                                                                                 |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm exec vitest run --config vitest.config.ts --maxWorkers 1 src/gateway/security-profile.test.ts src/gateway/security-profile/security-profile.test.ts src/gateway/account-computer-p0.test.ts src/infra/device-pairing.test.ts` | 0      | `Test Files 4 passed (4)`；`Tests 40 passed (40)`                                                                                                                                                                                                        |
| `node scripts/check-no-register-http-handler.mjs`                                                                                                                                                                                   | 0      | 标准输出为空                                                                                                                                                                                                                                             |
| `rg -n clientProfileHint src`                                                                                                                                                                                                       | 0      | 只命中 `src/gateway/security-profile.ts` 的参数定义与 `src/gateway/security-profile.test.ts` 的调用                                                                                                                                                      |
| `pnpm exec tsx` 启动探针（临时状态目录；未入库）                                                                                                                                                                                    | 0      | 另一操作者 `sessions.json` 读成功；插件 `stateDir` 读成功；未设 host 的 exec `ppid` 等于探针进程；`security=deny` 首行 `exec denied: host=gateway security=deny`                                                                                         |
| `OPENBOT_TEST_PROFILE=low pnpm exec vitest run --config vitest.config.ts --maxWorkers 1` 加 `-t` 过滤，文件为 exec 宿主、sessions 可见性、browser hardening、auth compat、auth modes、roles allowlist                               | 0      | `Test Files 6 passed`；`Tests 12 passed, 33 skipped`。过滤掉的用例没有当成通过                                                                                                                                                                           |
| `rg -n node.pair src/gateway/server/ws-connection/message-handler.ts`                                                                                                                                                               | 1      | 无命中。握手文件不引用 `node.pair`                                                                                                                                                                                                                       |
| `OPENBOT_TEST_PROFILE=low pnpm exec vitest run --config vitest.config.ts --maxWorkers 1 src/gateway/security-profile.test.ts src/gateway/security-profile/security-profile.test.ts src/gateway/account-computer-p0.test.ts`         | 0      | 修门之后：`Test Files 3 passed`；`Tests 31 passed`。本地退出码不是 Actions 行                                                                                                                                                                            |
| `OPENBOT_TEST_PROFILE=low pnpm exec vitest run --config docs/acceptance/vitest.stage1-evidence.config.ts --maxWorkers 1 docs/acceptance/stage1-auth-plugin-evidence.test.ts`                                                        | 0      | 本轮证据夹具：`Test Files 1 passed`；`Tests 10 passed`。两剖面的 token、口令、`mode=none`、本地静默 `hello-ok`，以及企业剖面插件 `stateDir` 读取。本地退出码不是 Actions 行。夹具放在 `docs/acceptance/`，避免和 `src/gateway/**` 的落地流混在同一次提交 |

修门前的探针曾复现一边 ok、一边抛错。下表是修门之后 vitest 里的同一矩阵。未重跑的三行沿用补 E3 的探针，并在格内标明。本地通过不表示产品 Stage PASS。

| 探针                                                                           | 文件门 `assertSecurityProfileAllowsStartup`                                                                                                                         | 目录门 `validateSecurityProfileStartup`                              |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `tenantsRootConfigured: true`，没有 `OPENBOT_TENANTS_ROOT`                     | 拒绝，`SECURITY_PROFILE_MISSING_TENANTS_ROOT`                                                                                                                       | 抛 `DG0_MANAGED_MISSING_TENANTS_ROOT`                                |
| 只有 `OPENCLAW_TENANTS_ROOT`                                                   | 拒绝，`SECURITY_PROFILE_MISSING_TENANTS_ROOT`                                                                                                                       | 抛 `DG0_MANAGED_MISSING_TENANTS_ROOT`                                |
| `OPENBOT_SHARED_CREDENTIAL_ROOT`，另有 dedicated 与 `OPENBOT_TENANTS_ROOT`     | 拒绝，`SECURITY_PROFILE_SHARED_CREDENTIAL_ROOT`                                                                                                                     | 抛 `DG0_MANAGED_SHARED_CREDENTIAL_ROOT`                              |
| `pluginTenantAccess=unrestricted`，同样的租户根                                | 拒绝，`SECURITY_PROFILE_UNRESTRICTED_PLUGIN_ACCESS`                                                                                                                 | 抛 `DG0_MANAGED_UNRESTRICTED_PLUGIN_ACCESS`                          |
| `OPENBOT_MULTITENANT=1`，`sandbox.mode=all`，dedicated，`OPENBOT_TENANTS_ROOT` | 拒绝，`I2`，`shared_process`，不是 `I4`，`SECURITY_PROFILE_MISSING_EXECUTION_BOUNDARY`                                                                              | 抛 `DG0_MANAGED_MISSING_EXECUTION_BOUNDARY`                          |
| dedicated 与 `OPENBOT_TENANTS_ROOT`，没有多租户                                | ok，`I4`，`dedicated`                                                                                                                                               | ok，`ManagedEnterprise`                                              |
| `data.tenantId` 与 `OPENBOT_TENANTS_ROOT`，边界令牌未设                        | ok，`I4`，`dedicated`                                                                                                                                               | ok，`dedicated_tenant_boundary`                                      |
| 多租户且未设置 sandbox                                                         | 错误码含 `SECURITY_PROFILE_MULTITENANT_SANDBOX_OFF`                                                                                                                 | 先抛 `DG0_MANAGED_MULTITENANT_SANDBOX_OFF`                           |
| 多租户，`sandbox.mode=all`，`tools.exec.host=gateway`                          | 错误码含 `SECURITY_PROFILE_UNSCOPED_GATEWAY_EXEC`                                                                                                                   | 先抛 `DG0_MANAGED_UNSCOPED_GATEWAY_EXEC`                             |
| 两个启动函数都传入 `clientProfileHint=managed_enterprise`                      | 抛 `SECURITY_PROFILE_CLIENT_OVERRIDE_REJECTED`，剖面保持 `personal_local`                                                                                           | 抛 `DG0_CLIENT_OVERRIDE_REJECTED`。不传 hint 时同一本地配置两边都 ok |
| `multitenantSandboxStartupIssue`                                               | 缺省 `sandbox-off`；`host=gateway` 或 `host=node` 或 `mode=non-main` 为 `unscoped-gateway-exec`；`mode=all` 为 null。个人本地启动仍 ok。本行沿用补 E3，本轮没有重跑 | 目录门对空配置返回 `PersonalLocal`。本行沿用补 E3                    |
| `resolveOAuthDir({}, stateDir)`                                                | 返回 `stateDir/credentials`。本行沿用补 E3，本轮没有重跑                                                                                                            | 同一次调用                                                           |
| `requestDevicePairing` 然后 `approveDevicePairing`                             | pending 对象没有 `token` 键；批准后 `tokens.operator.token` 存在。不记录 token 字节。本行沿用补 E3                                                                  | 配对函数没有剖面参数                                                 |

S1-GATE-01：两套启动门现在调用同一个 `evaluateManagedEnterpriseStartup`。上表每一行都是同 ok 或同拒绝。错误码家族仍是 `SECURITY_PROFILE_*` 与 `DG0_*`，语义按上表对齐。共享进程仍标成 `I2` / `shared_process`，但不再放行；这与 `SECURITY.md`「I3 证明前启动即拒绝」一致。`account-computer-p0.test.ts` 的用例改为 `refuses dedicated plus multitenant as shared-process, never I4`，没有删掉。这个分叉不再是一边放行一边拒绝。没有第二人复核，所以不把它写成 P0 关闭仪式，也不写成 CONDITIONAL。

`src/gateway/server.impl.ts` 在非 minimal test gateway 时先调用文件门，随后无条件调用目录门。minimal test gateway 跳过文件门，目录门仍执行。因此只存在于文件门的拒绝，不会出现在 minimal 路径上。

##### personal_local

| 检查     | 置信度 | 验收 | 回归    | 本批证据与归因                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| -------- | ------ | ---- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 隔离     | E3     | PASS | UNKNOWN | 窄 PASS。命题是「已认证网关客户端身份进入请求 ALS 后，另一操作者的会话 store 路径不可读」。`deriveOperatorIdFromGatewayClient({ platformUserId })` → `withOperatorStateScope`（`handleGatewayRequest` 已接线）。证据不依赖导出 `OPENBOT_OPERATOR_ID`。`resolveDefaultSessionStorePath("main")` 落在 `$STATE_DIR/operators/<id>/...`；外国/遗留路径 `loadSessionStore` 抛 `CROSS_OPERATOR_STATE_DENIED`。无 `platformUserId`/`pairedDeviceId`/`user` 的共享令牌连接仍是未作用域的历史单操作者 `STATE_DIR`（显式遗留）。`OPENBOT_OPERATOR_ID` 仅作测试/开发覆盖。回归 UNKNOWN |
| 沙箱     | E3     | PASS | UNKNOWN | 命题只限于「未设置 `tools.exec.host` 且沙箱运行时未激活时，exec 在网关宿主进程内完成」。`resolveSandboxConfigForAgent({})` 的 `mode` 是 `off`，`resolveSandboxRuntimeStatus` 的 `sandboxed` 是 false。`resolveConfiguredExecHost({ sandboxAvailable: false })` 是 `gateway`。`createExecTool({ security: "full", ask: "off" })` 跑 `node -e` 打印的 `ppid` 等于探针 `process.pid`，`details.status` 是 `completed`。`security=deny` 抛出的首行是 `exec denied: host=gateway security=deny`。显式 `configuredHost: "sandbox"` 且 `sandboxAvailable: false` 时，解析结果仍是 `sandbox`，本批没有把它说成宿主落地。这不是沙箱隔离 PASS，也不是 Stage 1 PASS。归因：配置默认 |
| 凭证根   | E3     | PASS | UNKNOWN | 命题只限于 `resolveOAuthDir({}, stateDir)` 等于 `stateDir/credentials`。探针复现了这个路径。这不是租户凭证分离，也不是 Stage 1 PASS                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 插件权限 | E3     | PASS | UNKNOWN | 窄 PASS。命题是「请求 ALS 下插件 `ctx.stateDir` 读不到另一操作者会话」。`stateDir` 为惰性 getter，跟随 `resolveOperatorStateRoot()`；在 `withOperatorStateScope("operator-a")` 内 `startPluginServices` 得到操作者根；外国/遗留路径不可见；绝对外国 `loadSessionStore` 含 `CROSS_OPERATOR_STATE_DENIED`。无 ALS/认证身份时插件仍见遗留共享 `STATE_DIR`。HTTP 注册 lint 本轮未重跑。回归 UNKNOWN |
| 配对     | E3     | PASS | UNKNOWN | 命题只限于「未批准设备的 WS `connect` 被拒绝，且 `node.pair.*` 不门控这次握手」。`does not silently auto-pair non-control-ui browser clients on loopback` 通过：`res.ok` 为 false，错误含 `pairing required`，pending 的 `silent` 为 false。`rejects reconnect metadata spoof for paired node devices` 通过：伪造元数据的重连抛 `pairing required`；该文件的批准函数是 `approveDevicePairing`。`message-handler.ts` 的 `rg node.pair` 退出码 1。这不是完整配对 PASS。本地静默自动批准的成功 `hello-ok` 记在 AUTH-03，本格命题仍只覆盖未批准拒绝。握手函数没有剖面参数。归因：产品门                                                                                      |

本剖面结论改为窄 PASS（上表写明的命题）。隔离与插件权限在已认证客户端 ALS 下失败关闭。无身份的共享令牌连接仍是未作用域遗留。沙箱、凭证根、配对仍是先前窄 PASS。这不是与企业剖面合成的一句「安全通过」。

##### managed_enterprise

| 检查     | 置信度 | 验收 | 回归    | 本批证据与仍缺的 E3                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| -------- | ------ | ---- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 隔离     | E3     | PASS | UNKNOWN | 启动门命题沿用。另增 store 命题：本剖面下经 `deriveOperatorIdFromGatewayClient` + ALS（非仅 env）外国/遗留 `sessions.json` 的 `loadSessionStore` 抛 `CROSS_OPERATOR_STATE_DENIED`。`handleGatewayRequest` 对带 `platformUserId` 的客户端进入同一 ALS。这不是跨租户 L3 存储全面 PASS。回归 UNKNOWN |
| 沙箱     | E3     | PASS | UNKNOWN | 命题只限于多租户。缺省 sandbox 时两套门分别抛 `SECURITY_PROFILE_MULTITENANT_SANDBOX_OFF` 与 `DG0_MANAGED_MULTITENANT_SANDBOX_OFF`。`tools.exec.host=gateway` 且 `mode=all` 时分别抛 `SECURITY_PROFILE_UNSCOPED_GATEWAY_EXEC` 与 `DG0_MANAGED_UNSCOPED_GATEWAY_EXEC`。错误码字符串不同，两边都失败关闭。这不是 Stage 1 PASS                                                                                                                                                                                                            |
| 凭证根   | E2     | PASS | UNKNOWN | 命题只限于启动门对共享凭证根的同一拒绝。`OPENBOT_SHARED_CREDENTIAL_ROOT` 时文件门含 `SECURITY_PROFILE_SHARED_CREDENTIAL_ROOT`，目录门抛 `DG0_MANAGED_SHARED_CREDENTIAL_ROOT`。状态目录与租户根重叠时目录门仍抛 `DG0_MANAGED_SHARED_STATE_ROOT`，文件门同样抛出启动错误。这不是凭证存储布局的全面 PASS。回归 UNKNOWN                                                                                                                                                                                                                   |
| 插件权限 | E3     | PASS | UNKNOWN | 窄 PASS。启动门分叉仍闭合。本剖面 dedicated + `OPENBOT_TENANTS_ROOT` 启动 ok；插件 `stateDir` 在请求 ALS（`platformUserId` 派生）下为操作者根；外国路径失败关闭。这不是租户 L3 全面接线 PASS。回归 UNKNOWN |
| 配对     | E3     | PASS | UNKNOWN | 与个人本地是同一次握手测试。用例没有设置 `OPENBOT_SECURITY_PROFILE`。`message-handler.ts` 不引用 `node.pair`，批准走 `approveDevicePairing`。命题同样只限于「未批准则 `pairing required`，且 `node.pair.*` 不门控握手」。本轮证据夹具在本剖面环境变量下另跑了本地静默 `hello-ok`，结果记在 AUTH-03，不扩成本格的完整配对 PASS。归因：产品门，握手无剖面分支                                                                                                                                                                           |

本剖面结论改为窄 PASS（上表写明的命题）。启动门隔离、沙箱、凭证根、配对仍是先前窄 PASS；插件 `stateDir` 在已认证 ALS 下失败关闭。这不是企业 L3 存储全面 PASS，也不是与个人剖面合成的一句「安全通过」。

##### AUTH-01 / AUTH-02 / AUTH-03

| ID      | 置信度                            | 验收 | 回归    | 本批证据与仍缺的 E3                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------- | --------------------------------- | ---- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AUTH-01 | E3 两剖面；认证模式由探针显式设置 | PASS | UNKNOWN | 窄 PASS。命题：剖面启动门 ok 之后，显式 `gateway.auth.mode` 的负路径与 `mode=none` 边界。`stage1-auth-plugin-evidence.test.ts` 对 `personal_local` 与 `managed_enterprise` 都先调用两套启动门并得到 ok。token 模式：Control UI 缺 token 时 `res.ok` 为 false，错误匹配 Control UI settings 或 `gateway token missing`，载荷不是 `hello-ok`；错误 token 含 `gateway token mismatch`。`POST /tools/invoke` 无凭证与错误 Bearer 都是 HTTP 401；正确 Bearer 的状态码不是 401，本行不记录它的具体成功码。password 模式：错误口令含 `unauthorized`，不是 `hello-ok`。`mode=none`：loopback 的 `res.payload.type` 是 `hello-ok`；`bind=lan` 时 `resolveGatewayRuntimeConfig` 抛出 `refusing to bind gateway`，没有监听套接字。两个剖面都不自选 `gateway.auth.mode`。这不是现场远程客户端，也不是全面 AUTH PASS。回归 UNKNOWN |
| AUTH-02 | E2                                | PASS | UNKNOWN | 产品意图是禁止客户端改剖面，服务器仍可选 `managed_enterprise`。`resolveSecurityProfile` 在 hint 下仍返回 `SECURITY_PROFILE_CLIENT_OVERRIDE_REJECTED`，剖面保持 `personal_local`。`assertSecurityProfileAllowsStartup` 现在接同一参数并抛错。目录门 `validateSecurityProfileStartup` 对同一 hint 抛 `DG0_CLIENT_OVERRIDE_REJECTED`。不传 hint 时，dedicated 加 `OPENBOT_TENANTS_ROOT` 的服务器配置两边都 ok。`server.impl.ts` 仍不传 hint，因为启动处没有客户端字段。本轮证据没有改变这条。这不是现场 WS 客户端探针，也不是 AUTH-01。回归 UNKNOWN                                                                                                                                                                                                                                                                      |
| AUTH-03 | E3 未批准拒绝与本地静默成功       | PASS | UNKNOWN | 窄 PASS。未批准的非 Control UI 浏览器设备仍是先前 E3：`res.ok` 为 false，`pairing required`，pending `silent` 为 false。本轮两剖面都跑了本地无 Origin 的新 CLI 设备：`res.ok` 为 true，`payload.type` 是 `hello-ok`，该设备不在 pending，paired 上存在 operator token。不记录 token 字节。远程显式批准后的第二次 `hello-ok` 本轮没有重跑；先前 `approveDevicePairing` 仍是另一条记录。这不是完整设备生命周期 PASS。回归 UNKNOWN                                                                                                                                                                                                                                                                                                                                                                                       |

Stage 1 总结论：上表写明的信任边界命题为窄 PASS（两剖面独立结论，不合并成一句「安全通过」）。S1-GATE-01 同一判定；AUTH-01/02/03 窄 PASS；已认证网关客户端（`platformUserId` / `pairedDeviceId` / `user`）经 `handleGatewayRequest` ALS 跨操作者 store / 插件 `stateDir` 失败关闭。无上述身份的连接与未设 ALS 的进程仍是历史单操作者共享 `STATE_DIR`（显式遗留）。`OPENBOT_OPERATOR_ID` 仅测试/开发覆盖。没有第二人复核，不写成 P0 关闭仪式。

本轮本地证据（退出码不是 Actions 行）：`OPENBOT_TEST_PROFILE=low pnpm exec vitest run --config docs/acceptance/vitest.stage1-evidence.config.ts --maxWorkers 1 docs/acceptance/stage1-auth-plugin-evidence.test.ts` → Test Files 1 passed；Tests 13 passed。另：`src/config/operator-state-scope.test.ts` 与 `src/plugins/services.test.ts` 通过。

先前 CONDITIONAL 的三项跨操作者可读：在已认证客户端请求路径上已失败关闭并改写 `SECURITY.md`。无身份共享令牌/未作用域进程仍是显式遗留，不扩成全面多操作者网关 PASS。Stage 2 transcript 等不在本行关闭。`stage8_eligible` 仍为 false。

本记录不是 EvidenceRow。没有新增 CURRENT 行。

Stage 1 之后：

1. Stage 1 上表命题窄 PASS。跨操作者 store/插件 CONDITIONAL 已闭合。AUTH-01、AUTH-02、AUTH-03 仍是窄 PASS。
2. S1-GATE-01 的启动门分叉已由同一谓词闭合。没有第二人复核，不写成 P0 关闭。
3. 本地 vitest 退出码不是 Actions 行，也不从 HISTORICAL 继承 `BASELINE_UNCHANGED`。
4. 本修复分支自 `origin/main` tip 检出；合入前由验收 bot 复核。
5. 后续按序推进 Stage 2 CONDITIONAL（transcript）与 Stage 3+ 未覆盖项。`stage8_eligible` 保持 false。
6. `1b910f78a` 的质量门仍在 HISTORICAL。本批没有相对 pin 重配那些 job。

### 5.1 架构

**问题：** 控制面、数字员工运行时、控制台、WebChat、频道、节点、技能是否构成一条可解释的调用链，且 monorepo 边界有机器检查。

| 检查项               | 证据                                                                                                                                                  | 方法                                                                                                 | 通过标准                                                                    | 风险                                                                                  |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Gateway 是唯一控制面 | `docs/concepts/architecture.md`；`src/cli/gateway-cli/register.ts`；`src/gateway/server-http.ts`                                                      | 从 `openbot gateway` 追到 WS 监听与 HTTP 复用；核对默认端口与 loopback                               | 文档、CLI、服务器入口对「单端口复用、默认 18789、默认 loopback」一致        | 多 Gateway / 远程绑定文档与 `gateway.bind` 示例不一致                                 |
| 数字员工与 Pi 运行时 | `src/agents/**`；`@earendil-works/pi-coding-agent` 引用；`src/gateway/server-methods/AGENTS.md`                                                       | 追一条 agent turn：CLI `agent` → Gateway RPC → Pi SessionManager；抽查转录写入是否走 `appendMessage` | 主路径不绕过 SessionManager 写消息叶；技能加载走 Pi `loadSkillsFromDir`     | 裸 JSONL 写入会拆断 `parentId` 链，压缩与历史不可恢复                                 |
| 控制台与 WebChat     | `ui/`；`docs/web/control-ui.md`；`docs/web/webchat.md`；`src/gateway/control-ui*`                                                                     | 列出 UI 路由与 Gateway 静态托管；确认 WebChat 使用同一 WS                                            | 控制台与 WebChat 都声明 Gateway 为后端，无第二套私有协议                    | UI 工作区与 `dist/` 不同步时，运行中的 UI 与源码不一致                                |
| 频道分层             | `docs/channels/index.md`；`docs/channels/enterprise-im.md`；`extensions/wecom`、`feishu`、`dingtalk`；`src/channels`、`src/routing`                   | 画「产品 IM / 继承插件」两层；对共享路由、allowlist、配对抽 1 个产品频道 + 1 个继承频道              | 产品三频道有控制台字段与长连接优先说明；继承频道不出现在产品标题路径        | 改共享逻辑时漏频道（仓库指南要求内置与扩展一起看）                                    |
| 节点                 | `docs/gateway/protocol.md` 节点握手；`docs/nodes`；`apps/*`；`src/cli/nodes-cli/register.ts`                                                          | 核对 `role: node`、caps、device 签名；区分 Gateway-owned pairing 与 WS device pairing                | 节点命令面（camera、canvas、screen、location）与协议示例可对应到 CLI 或 app | `docs/gateway/pairing.md` 写明 `node.pair.*` 不门控 WS 握手，易与 device pairing 混淆 |
| 技能与工具           | `skills/`；`src/agents/skills`；`docs/tools/skills.md`；`src/gateway/server-methods/skills.ts`、`tools-catalog.ts`                                    | 区分 bundled、workspace、插件工具；核对 catalog RPC 与 CLI `skills`                                  | 技能来源可枚举；工具目录有 schema 与策略挂钩点                              | 插件工具绕过策略直接执行                                                              |
| Monorepo 边界        | `pnpm-workspace.yaml`；`pnpm lint:core:architecture-manifest`；`pnpm lint:plugins:no-monolithic-plugin-sdk-entry-imports`；`pnpm lint:aor:boundaries` | 在基线上运行上述 lint（只读，不修）                                                                  | 命令退出码被记录；失败项有主人或明确标为既有债务                            | 架构清单与真实 import 漂移                                                            |

方法包登记（实施时对照 `src/gateway/server-methods/packs/registry.ts`）：`chat-checkpoints`、`steward-workspace-file`、`group-workspace-file`、`supervisor`、`fabric`、`digital-employee`、`daibai`、`support-cases`、`task-context`、`data-governance`、`evolution-control`、`evolution-delegation`、`evolution-perception`，以及 `DIAGNOSIS_REPORT_API_DEPLOYED` 为真时的 `diagnosis-reports`。`pnpm lint:gateway:method-packs` 是这条清单的机器门。

#### Stage 2 执行记录

Stage 2 开账前 `git fetch origin main`，`git rev-parse origin/main` 打印 `8aa8d5e45baa2022a6b7629ac34d8573fc1374e4`（#407，`fix(ci): main format + delivery ledger + pnpm audit`）。上一份打印 `d478d3bdf1d2fa03cad19d920b9d4480c68a8a92`（#406）。祖先检查退出码 1，merge-base 仍是 `0685ce054e45eb463b34a2f0aff88779e6ebaf3f`。本批不 rebase。下列架构锚点的 blob 在 `d478d3bdf`、`8aa8d5e45` 与本分支 HEAD 上相同，除非另行写明。`package.json` 与 `ui/src/ui` 树不相同：pin 前进了依赖 overrides 与电脑预览；本分支还落后于 pin 的部分 UI。相同 blob 不是 Signature，不分配 `BASELINE_UNCHANGED`。CURRENT 仍为空。本地命令没有 Actions `evidence_run_id`。回归列保持 UNKNOWN。

| 检查项               | 置信度 | 验收        | 回归    | 记录                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| -------------------- | ------ | ----------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Gateway 是唯一控制面 | E1     | PASS        | UNKNOWN | 窄 PASS。命题只是「单端口复用、默认 18789、默认 loopback」在文档、CLI 与服务器入口一致。`docs/concepts/architecture.md` 写默认 `127.0.0.1:18789`，canvas 复用同一端口。`GatewayConfig.port` 注释写明单端口复用、默认 18789。`DEFAULT_GATEWAY_PORT` 与 `resolveGatewayPort` 的回落都是 18789。`src/cli/gateway-cli/run.ts` 在未传 `--bind` 时用 `loopback`。`server.impl.ts` 端口缺省 18789。`server-runtime-state.ts` 对同一个 HTTP server 调用 `createGatewayHttpServer` 与 `attachGatewayUpgradeHandler`。没有本轮监听探针，不是 E3。`lan` / `tailnet` / `custom` 是显式 bind，不是第二套控制面。「每主机恰好一个 Gateway」没有进程探针                                                                                                                              |
| 数字员工与 Pi 运行时 | E3     | PASS | UNKNOWN | **窄 PASS（聊天用户叶写路径）**：`appendRawTranscriptMessage` / `appendUserTranscriptMessage` 现经 `appendPersistedAgentMessageToTranscript` → `SessionManager.appendMessage`（与 inject 助手叶同路径）。证据：`chat-transcript-sessionmanager.test.ts` + `docs/acceptance/stage2-transcript-evidence.test.ts`（parentId 链；`chat.ts` 不再调用 `appendTranscriptMessageEntry(`）。源码链 agent→Gateway→`openSessionManager` 仍是 E1 叙述，**不是**一次跑通的 live agent turn。技能加载仍走 `loadSkillsFromDir`。崩溃后恢复 E3 未另交。不把 Stage 2 整体写成全面架构 PASS。 |
| 控制台与 WebChat     | E1     | PASS        | UNKNOWN | 窄 PASS。`docs/web/control-ui.md` 与 `docs/web/webchat.md` 都写 Gateway WebSocket、同一默认端口。`ui/src/ui/gateway.ts` 构造 `new WebSocket`，blob `47c5c960095a2cc63a04d3c0afb88dcb3950eef1` 与 pin 相同。`chat.ts` 相对 pin 差 49 行，差在电脑预览全屏，不改传输。没有浏览器会话，也没有核对运行中的 `dist/`                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 频道分层             | E1     | PASS        | UNKNOWN | 窄 PASS。`EnterpriseImFormChannelId` 只有 `wecom` / `feishu` / `dingtalk`。该表单注释写飞书与钉钉默认长连接。`docs/channels/index.md` 把 Telegram 放在 inherited，不放进产品标题。抽样：`extensions/wecom/src/monitor.ts` 有 allowFrom 与 pairing；`extensions/telegram/src/channel.ts` 有 `resolveAllowFrom` 与 pairing。没有真实 IM 连接。三棵产品频道树与 `extensions/telegram` 的 tree SHA 与 pin 相同                                                                                                                                                                                                                                                                                                                                                             |
| 节点                 | E1     | PASS        | UNKNOWN | 窄 PASS。`docs/gateway/protocol.md` 的示例命令 `camera.snap`、`canvas.navigate`、`screen.record`、`location.get` 能对上 `src/cli/nodes-cli/register.camera.ts`、`register.canvas.ts`、`register.screen.ts`、`register.location.ts`。`docs/gateway/pairing.md` 写 `node.pair.*` 不门控 WS 握手。`message-handler.ts` 无 `node.pair`。没有真实节点握手                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 技能与工具           | E1     | PASS        | UNKNOWN | 窄 PASS，只覆盖来源可枚举，以及 catalog 有校验和 allowlist 挂钩。`docs/tools/skills.md` 写 bundled、managed、workspace、plugin。`skills.status` 与 `tools.catalog` 都在。`tools.catalog` 先走 `validateToolsCatalogParams`，插件组经 `resolvePluginTools`，`toolAllowlist` 为 `group:plugins`。插件执行期是否绕过策略没有探针，那一部分是 NOT_COVERED，不把这一行扩成策略 PASS                                                                                                                                                                                                                                                                                                                                                                                         |
| Monorepo 边界        | E2     | PASS        | UNKNOWN | 窄 PASS，只覆盖下面四条命令在本工作树的退出码。方法写的是在基线上跑。本工作树不是 pin 的后代，这四条没有在 pin 检出上重跑，pin 上的同命令是 NOT_COVERED。四条 lint 源文件 blob 与 pin 相同。被扫描的树不是 pin：本分支含剖面门与验收文档改动，并落后于 pin 的 `package.json` overrides 与部分 `ui/src/ui`。`check-gateway-method-packs` 打印 14 packs、94 methods。`DIAGNOSIS_REPORT_API_DEPLOYED` 为 true，所以 `diagnosis-reports` 在册。登记名单与 `registry.ts` 一致                                                                                                                                                                                                                                                                                               |

执行过的命令（工作树 HEAD 当时是 Stage 1 证据 tip，不是 pin，也不是本记账提交）：

| 命令                                                       | 退出码 | 结果摘要                                                                        |
| ---------------------------------------------------------- | ------ | ------------------------------------------------------------------------------- |
| `pnpm lint:core:architecture-manifest`                     | 0      | `Architecture manifest passed (12 rules, 12272 files scanned).`                 |
| `pnpm lint:plugins:no-monolithic-plugin-sdk-entry-imports` | 0      | `OK: bundled plugin source files use scoped plugin-sdk subpaths (840 checked).` |
| `pnpm lint:aor:boundaries`                                 | 0      | `AOR boundary guard: OK (no forbidden imports in packages/aor-*).`              |
| `pnpm lint:gateway:method-packs`                           | 0      | `check-gateway-method-packs ok (14 packs, 94 methods)`                          |

##### CURRENT（Stage 2 transcript SessionManager，`ba8b1e8d` 之上）

本轮相对 tip `ba8b1e8d97e394523d53463326bf509667891c16`（#457 已合入）叠加聊天用户叶写路径修复。本记录不是 EvidenceRow。本地 vitest 不是 Actions 行。回归 UNKNOWN。`stage8_eligible` 仍为 false。**不把 Stage 2 整体或产品写成 PASS**。

| 命令 | 退出码 | 结果摘要 |
| ---- | ------ | -------- |
| `OPENBOT_TEST_PROFILE=low pnpm exec vitest run --config vitest.config.ts --maxWorkers 1 src/gateway/server-methods/chat-transcript-sessionmanager.test.ts` | 0 | `Tests 1 passed`（SessionManager parentId 链） |
| `OPENBOT_TEST_PROFILE=low pnpm exec vitest run --config docs/acceptance/vitest.stage2-evidence.config.ts --maxWorkers 1 docs/acceptance/stage2-transcript-evidence.test.ts` | 0 | `Tests 2 passed`（E3 链 + E1 `chat.ts` 锚点） |

Stage 2 总结论：不是全面架构 PASS。没有 FAIL 行。**聊天用户叶绕过 `SessionManager.appendMessage` 的 CONDITIONAL 已窄闭合为 PASS（写路径命题）**。其余窄 PASS 仍只覆盖上表写明的命题。pin 上的四条 lint、现场监听、真实 agent turn、真实频道、真实节点、插件执行期策略，都还是 NOT_COVERED。本记录不是 EvidenceRow。`stage8_eligible` 仍为 false。

本阶段可提交验收：

1. 单端口复用、默认 18789、默认 loopback，文档与入口一致（E1）。
2. 控制台与 WebChat 声明同一 Gateway WebSocket（E1）。`gateway.ts` blob 与 pin 相同。
3. 产品三频道有控制台字段与长连接说明，Telegram 不在产品标题（E1）。
4. 节点命令面能对上 CLI，`node.pair.*` 不在握手文件里（E1）。
5. 技能来源可枚举，`tools.catalog` 有 schema 校验和 `toolAllowlist`（E1）。执行期策略除外。
6. 四条架构 lint 在本工作树退出码 0（E2）。这不是 pin 上的运行，回归 UNKNOWN。
7. 聊天用户叶经 `SessionManager.appendMessage` 写入（窄 PASS，写路径命题；非 live agent turn）。

不提交为 PASS 的项：真实 agent turn / 崩溃后恢复 E3、现场监听、真实频道、真实节点、插件执行期策略（均为 NOT_COVERED）。聊天用户叶 SessionManager 写路径已窄 PASS，不扩成 Stage 2 全面架构 PASS。

Stage 2 之后进入 Stage 3。Stage 1 的三项跨操作者可读已在后续修复分支闭合（见 Stage 1 总结论）；本 Stage 2 记录不回溯改写。

### 5.2 API 契约（Stage 3，必验）

**问题：** 每条对外契约都要填同一张矩阵，而不是只核对「有没有这个路由」。起草时在 `src/gateway` 未发现独立 OpenAPI 规范文件；契约主路径是 TypeBox，经 `scripts/protocol-gen.ts` 生成 `dist/protocol.schema.json` 与 Swift 模型。若实施时找到 OpenAPI 产物，补进矩阵，不事先假定它存在。

矩阵列（每个面都要填，空着标 NOT_COVERED）：schema、authz、idempotency、errors、versioning、backward compat。

| 面                  | schema                                                                                                                     | authz                                                                    | idempotency                                                                                                                                                     | errors                                                     | versioning                                                                       | backward compat                                                                            |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| WS 请求/响应        | TypeBox，`src/gateway/protocol/schema/protocol-schemas.ts`；帧为 `req`/`res`                                               | `connect` 的 token、role、scopes、device 签名                            | `send`、`poll`、`agent`、`node.invoke` 要求 `idempotencyKey`。锚点是 `docs/gateway/protocol.md` 与 `agent.ts`、`nodes.ts`，不是 `docs/concepts/architecture.md` | 非法转换与校验失败必须是 `res.ok=false` 或断连，不能当成功 | `minProtocol`/`maxProtocol`，文档示例为 3                                        | 遗留 client id 只走 `src/gateway/protocol/client-info.ts` 一类别名表，实施时打开该文件核对 |
| WS 事件             | `event` 帧，含 `seq?`、`stateVersion?`                                                                                     | 仅已连接且 scope 允许的订阅                                              | 事件本身不要求客户端重放幂等；服务端去重缓存要单独记录                                                                                                          | 未知事件不得被客户端当成 ack                               | 与协议版本一起生成                                                               | 生成物 diff 为空，或差异有主人                                                             |
| HTTP                | `/v1/chat/completions`（默认关）、`/v1/responses`、`/tools/invoke`（常开）、hooks、`/commerce/webhooks/stripe` 与 `alipay` | Gateway Bearer，或 webhook 签名；Chat Completions 文档写明等价运营者权限 | 抽查会话键与工具调用是否去重                                                                                                                                    | 401/403/429 与工具策略拒绝必须可见                         | 路径版本只看到 `/v1`；无 OpenAPI 版本字段时写明                                  | 默认开关与文档一致                                                                         |
| CLI                 | `src/cli/program/command-registry.ts`、`register.subclis.ts`、`routes.ts`                                                  | 走 Gateway 的命令继承 Gateway auth；本地文件命令写明信任假设             | 快路径与 Commander 对同一命令的退出码一致                                                                                                                       | 非 0 退出与 stderr 可区分用法错误和网关拒绝                | `openbot` 为用户命令，`openclaw` 为兼容入口                                      | 帮助文本与注册表命令名一致                                                                 |
| Plugin/SDK          | `src/plugin-sdk`；插件不得走被 lint 禁止的 HTTP 注册方式                                                                   | 插件不拥有剖面选择权                                                     | 插件工具调用走同一工具策略                                                                                                                                      | 拒绝返回错误，不返回空成功                                 | SDK 入口不被单体 import（`lint:plugins:no-monolithic-plugin-sdk-entry-imports`） | 扩展 `package.json` 的运行时依赖在 `dependencies`                                          |
| 生成客户端（Swift） | `pnpm protocol:check` 对比 `GatewayModels.swift`（macOS 与 `apps/shared`）                                                 | 与 WS auth 字段同源                                                      | 与 schema 中的幂等字段同源；语义仍按下面四情形                                                                                                                  | Swift 模型含错误载荷，或标 NOT_COVERED                     | `protocol:check` 的回归状态按 §4.4 归档                                          | `git diff --exit-code` 覆盖两份 Swift 与 JSON Schema                                       |

幂等证据锚点：`docs/gateway/protocol.md` 写明 “Side-effecting methods require idempotency keys”。`src/gateway/protocol/schema/agent.ts` 里 `SendParamsSchema`、`PollParamsSchema`、`AgentParamsSchema` 都要求 `idempotencyKey: NonEmptyString`。`src/gateway/protocol/schema/nodes.ts` 里 `NodeInvokeParamsSchema` 同样要求该字段。不要把 `docs/concepts/architecture.md` 当作这条证据。

幂等列不只核对「schema 里有没有键」。`send`、`poll`、`agent`、`node.invoke` 都要写下四种情形的结果，结果只能是拒绝、返回原结果，或 409：

| 情形              | 必须定义的结果                                        |
| ----------------- | ----------------------------------------------------- |
| 相同键 + 相同载荷 | 返回原结果，不产生第二次副作用                        |
| 相同键 + 不同载荷 | 拒绝或 409。禁止静默覆盖成第二次成功                  |
| 超时后重试        | 返回原结果，或明确的进行中 / 冲突。不产生第二次副作用 |
| 并发重复          | 单写者完成一次；其余拒绝、返回原结果，或 409          |

| 检查项                | 证据                                                                                                                                                                                                                 | 方法                                                                                                                     | 通过标准                                                            | 风险                                                    |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- | ------------------------------------------------------- |
| WS 握手与帧           | `docs/gateway/protocol.md`；`docs/concepts/typebox.md`；`src/gateway/protocol/schema/protocol-schemas.ts`                                                                                                            | 对照 connect 挑战、`minProtocol/maxProtocol`（文档示例为 3）、`hello-ok`、req/res/event 三帧                             | 文档示例与 TypeBox schema 字段一致；设备签名绑定 nonce              | 协议文档日期旧于 schema，客户端按旧字段连接             |
| 生成物未漂移          | `package.json` 的 `protocol:gen`、`protocol:check`；产物 `dist/protocol.schema.json`、`apps/macos/Sources/OpenBotProtocol/GatewayModels.swift`、`apps/shared/OpenBotKit/Sources/OpenBotProtocol/GatewayModels.swift` | 在干净树上运行 `pnpm protocol:check`（会生成并 `git diff --exit-code`）                                                  | 退出码 0，或差异被标为已知未提交生成物并有主人                      | Swift 与 JSON Schema 分叉导致 macOS / 共享 Kit 行为不同 |
| RPC 方法面            | `src/gateway/server-methods/**`；`packs/registry.ts`；`pack-merge.ts`                                                                                                                                                | 导出方法名清单，与 schema、UI 调用、CLI `gateway call` 抽样交叉                                                          | 每个 pack 拥有的方法都在合并表中；无「schema 有、handler 无」或相反 | 方法包与遗留注册双写                                    |
| HTTP Chat Completions | `src/gateway/openai-http.ts`；`docs/gateway/openai-http-api.md`                                                                                                                                                      | 确认 `POST /v1/chat/completions` 默认关闭、Bearer 与 Gateway auth 同源、文档写明等价于运营者权限                         | 默认关闭可被测试或配置读取证明；开启后仍要求 Gateway 认证           | 被当成「窄权限 OpenAI 兼容接口」暴露到公网              |
| OpenResponses         | `src/gateway/openresponses-http.ts`；`docs/gateway/openresponses-http-api.md`                                                                                                                                        | 核对 `POST /v1/responses` 的开关、认证与会话前缀                                                                         | 与文档一致，且与 agent 主路径共用策略                               | 与 Chat Completions 的认证模式分叉                      |
| Tools Invoke          | `docs/gateway/tools-invoke-http-api.md`；Gateway HTTP 路由                                                                                                                                                           | 核对 `POST /tools/invoke`：常开、Gateway auth、工具策略、默认 2MB                                                        | 未认证请求失败；策略拒绝的工具不会执行                              | 常开端点在错误 bind 下扩大攻击面                        |
| Hooks 与 webhook      | `src/gateway/server-http.ts`、`hooks.ts`；`pnpm lint:webhook:no-low-level-body-read`；`src/gateway/commerce-payments-http.ts`（`/commerce/webhooks/stripe`、`/commerce/webhooks/alipay`）                            | 列 hook 路径与插件 webhook 透传；抽查 body 读取是否走统一 helper                                                         | lint 结果被记录；支付 webhook 有签名或等价校验的代码位置            | 插件自行读 raw body，绕过签名与超时                     |
| CLI 面                | `src/cli/program/command-registry.ts`；`src/cli/program/register.subclis.ts`；`src/cli/program/routes.ts`                                                                                                            | 导出顶层命令清单，抽样 5 条对照 `docs/cli`                                                                               | 核心命令与文档描述一致；lazy register 不丢子命令                    | 快路径 `routes.ts` 与 Commander 行为不一致              |
| 认证、配对、会话      | `SECURITY.md`；`src/gateway/security-profile.ts`；`docs/gateway/pairing.md`；`docs/channels/pairing.md`；`src/pairing`；`src/gateway/server-methods/sessions.ts`                                                     | 分开记录：Gateway token/password、device token、node pairing、频道 pairing、安全剖面。各画一张「谁签发、谁存储、谁校验」 | 五种机制不被写成一个「登录」。剖面由服务端选择，客户端不能覆盖      | 本地自动批准与远程显式批准被配错                        |

CLI 顶层（实施时以代码为准，起草时可见）：

- 核心：`setup`、`onboard`、`configure`、`config`、`backup`、`doctor`、`dashboard`、`reset`、`uninstall`、`message`、`memory`、`data`、`agent`、`agents`、`status`、`health`、`sessions`、`browser`。
- 子命令：`acp`、`gateway`、`daemon`、`logs`、`system`、`models`、`approvals`、`nodes`、`local-files`、`devices`、`node`、`sandbox`、`tui`、`conversation-task`、`cron`、`dns`、`docs`、`hooks`、`webhooks`、`qr`、`clawbot`、`pairing`、`plugins`、`channels`、`directory`、`security`、`secrets`、`skills`、`update`、`completion`。

负路径（AUTH 与 API）集中在 §5.6。Stage 3 的验收 PASS 要求矩阵六列都有 E1 以上证据，四种幂等情形都有期望，且 AUTH-01、API-01、API-02、API-03 至少有 E2 或 E3。生成物检查的回归状态按 §4.4 归档。基线已红且签名相同写 BASELINE_UNCHANGED。这不是验收 PASS，也不是绝对绿。

#### Stage 3 执行记录

##### CURRENT（Stage 3 Plugin/SDK backward E1/E2，`e1b68060` 之上）

本轮相对 tip `e1b68060bd20b048833bb72b181aa5dfcc0b072c`（#520 ACCEPT squash）补上 **Plugin/SDK backward compat** 窄切片：命题「扩展 `package.json` 的运行时依赖在 `dependencies`」。证据：`extensions/*/package.json` 第三方运行时包不在 peer/dev 单独出现（宿主包 `openclaw`/`@upbeyond/openbot`/`openbot` 可仅 peer/dev）；`install.ts` 的 `hasDeps` 只读 `manifest.dependencies`；`collectBundledExtensionRootDependencyGapErrors` 只镜像 `dependencies`（peer-only 不产生 gap）；Feishu `@larksuiteoapi/node-sdk` 在扩展与根 `dependencies` 同规格。本记录不是 EvidenceRow。本地 vitest 不是 Actions 行。回归 UNKNOWN。`stage8_eligible` 仍为 false。**不把 Stage 3 整体或产品写成 PASS**。不改写 §5.2 矩阵原文。API-01/02/03、WS 事件六列、CLI 六列、WS 请求 backward/authz、Plugin schema/authz/idempotency/errors 窄 PASS 措辞不回退。

| 命令 | 退出码 | 结果摘要 |
| ---- | ------ | -------- |
| `OPENBOT_TEST_PROFILE=low pnpm exec vitest run --config docs/acceptance/vitest.stage3-evidence.config.ts --maxWorkers 1 docs/acceptance/stage3-plugin-backward-evidence.test.ts` | 0 | `Tests 4 passed`（扩展 deps 面 + install hasDeps + release-check gap + Feishu 根镜像） |

**Plugin/SDK 六列（本轮）**：schema **E1/E2 窄 PASS**（既有）不回退；authz **E1/E2 窄 PASS**（既有）不回退；idempotency **E1/E2 窄 PASS**（既有）不回退；errors **E1/E2 窄 PASS**（既有）不回退；backward **E1/E2 窄 PASS**（运行时 deps 在 dependencies + install/release-check 接线；非 live 插件安装舰队；非 npm pack dry-run 全量；非 Stage 6 audit）；versioning E1 PASS（既有）不回退。Stage 3 总结论仍 **不是 PASS**（阶段六面/负路径/AUTH-E3 等总门槛仍开；本切片不宣称 Stage 3 整体 PASS）。

##### HISTORICAL（Stage 3 Plugin/SDK errors E1/E2，`59b55d94` 之上；Plugin backward 见上方 CURRENT）

本轮相对 tip `59b55d944943d159e51218e3769c62211040e456`（#519 ACCEPT squash）补上 **Plugin/SDK errors** 窄切片：命题「拒绝返回错误，不返回空成功」。证据：`registerPluginCommand` 对畸形名/空描述/重复注册返回 `{ ok: false, error: 非空字符串 }`，从不返回空成功；`registerCommand` registrar 在 `!result.ok` 时 `pushDiagnostic(level:"error")` 并 `return`，不写入 `record.commands`；`validateJsonSchemaValue` 对非法值返回 `{ ok: false, errors: [...] }` 且 errors 非空。本记录不是 EvidenceRow。本地 vitest 不是 Actions 行。回归 UNKNOWN。`stage8_eligible` 仍为 false。**不把 Stage 3 整体或产品写成 PASS**。不改写 §5.2 矩阵原文。API-01/02/03、WS 事件六列、CLI 六列、WS 请求 backward/authz、Plugin schema/authz/idempotency 窄 PASS 措辞不回退。

| 命令 | 退出码 | 结果摘要 |
| ---- | ------ | -------- |
| `OPENBOT_TEST_PROFILE=low pnpm exec vitest run --config docs/acceptance/vitest.stage3-evidence.config.ts --maxWorkers 1 docs/acceptance/stage3-plugin-errors-evidence.test.ts` | 0 | `Tests 3 passed`（registerPluginCommand 拒绝形态 + registrar 诊断接线 + schema 校验 ok:false） |

**Plugin/SDK 六列（本轮）**：schema **E1/E2 窄 PASS**（既有）不回退；authz **E1/E2 窄 PASS**（既有）不回退；idempotency **E1/E2 窄 PASS**（既有）不回退；errors **E1/E2 窄 PASS**（拒绝→明确错误/诊断；非 live 插件加载舰队；非 /tools/invoke；非 install/update 全矩阵；非 backward）；backward 仍 NOT_COVERED（其后见上方 CURRENT）；versioning E1 PASS（既有）不回退。Stage 3 总结论仍 **不是 PASS**（当时 Plugin backward 仍开）。

##### HISTORICAL（Stage 3 Plugin/SDK idempotency E1/E2，`9234156e` 之上；Plugin errors 见上方 CURRENT）


本轮相对 tip `9234156e1798c9b93f60191c727d13423c5e9e66`（#518 ACCEPT squash）补上 **Plugin/SDK idempotency** 窄切片：命题「插件工具调用走同一工具策略」。证据：`applyToolPolicyPipeline` + `getPluginToolMeta` 对插件工具与核心工具共用 deny/allow；`group:plugins` 经 `expandPolicyWithPluginGroups`/`buildPluginToolGroups` 展开进同一策略列表；`createOpenClawTools` 将 `resolvePluginTools` 并入同一工具数组并下传 `pluginToolAllowlist`；`pi-tools` 以 `getPluginToolMeta` 接入 `applyToolPolicyPipeline`；`tools.catalog` 以 `toolAllowlist: ["group:plugins"]` 经同一 `resolvePluginTools`。本记录不是 EvidenceRow。本地 vitest 不是 Actions 行。回归 UNKNOWN。`stage8_eligible` 仍为 false。**不把 Stage 3 整体或产品写成 PASS**。不改写 §5.2 矩阵原文。API-01/02/03、WS 事件六列、CLI 六列、WS 请求 backward/authz、Plugin schema/authz 窄 PASS 措辞不回退。

| 命令 | 退出码 | 结果摘要 |
| ---- | ------ | -------- |
| `OPENBOT_TEST_PROFILE=low pnpm exec vitest run --config docs/acceptance/vitest.stage3-evidence.config.ts --maxWorkers 1 docs/acceptance/stage3-plugin-idempotency-evidence.test.ts` | 0 | `Tests 6 passed`（deny 同路径 + group:plugins 展开 + allow 无插件条目丢插件 + openclaw-tools 合并 + pi-tools 接线 + catalog group:plugins） |

**当时 Plugin/SDK 六列**：schema **E1/E2 窄 PASS**（既有）不回退；authz **E1/E2 窄 PASS**（既有）不回退；idempotency **E1/E2 窄 PASS**（同一工具策略管线 + group:plugins 展开 + 产品接线；非 live 插件加载舰队；非全 alsoAllow/sandbox/delivery-lane 矩阵；非 /tools/invoke 重放）；errors 仍 NOT_COVERED（其后见上方 CURRENT）；backward 仍 NOT_COVERED；versioning E1 PASS（既有）不回退。其后 errors 见上方 CURRENT。

##### HISTORICAL（Stage 3 Plugin/SDK schema E1/E2，`f247d0b4` 之上；Plugin idempotency 见上方 CURRENT）


本轮相对 tip `f247d0b4ad7d4fc9f390014170b6732c2607f118`（#517 ACCEPT squash）补上 **Plugin/SDK schema** 窄切片：命题「`src/plugin-sdk` 面 + 插件不得走被 lint 禁止的 HTTP 注册方式」。证据：`findDeprecatedRegisterHttpHandlerLines` 检出 `.registerHttpHandler(`、忽略 `registerHttpRoute`/`registerPluginHttpRoute`；`OpenClawPluginApi` 仅有 `registerHttpRoute(OpenClawPluginHttpRouteParams)`（含 `path`/`auth`/`handler`），无 `registerHttpHandler`；`src/plugin-sdk/index.ts` 导出 `registerPluginHttpRoute`/`normalizePluginHttpPath`/`emptyPluginConfigSchema`，不含 `registerHttpHandler`；`package.json` `lint:plugins:no-register-http-handler` 接入 `check`；生产 `src`+`extensions` 树（跳过 `*.test.ts`）零 callsite。本记录不是 EvidenceRow。本地 vitest 不是 Actions 行。回归 UNKNOWN。`stage8_eligible` 仍为 false。**不把 Stage 3 整体或产品写成 PASS**。不改写 §5.2 矩阵原文。API-01/02/03、WS 事件六列、CLI 六列、WS 请求 backward/authz、Plugin authz 窄 PASS 措辞不回退。

| 命令 | 退出码 | 结果摘要 |
| ---- | ------ | -------- |
| `OPENBOT_TEST_PROFILE=low pnpm exec vitest run --config docs/acceptance/vitest.stage3-evidence.config.ts --maxWorkers 1 docs/acceptance/stage3-plugin-schema-evidence.test.ts` | 0 | `Tests 5 passed`（finder + API 类型面 + SDK 导出 + package 接线 + 生产树零 callsite） |
| `node scripts/check-no-register-http-handler.mjs`（等价生产扫描） | 0 | 无 deprecated callsite 输出 |

**当时 Plugin/SDK 六列**：schema **E1/E2 窄 PASS**（SDK HTTP 路由面 + no-register-http-handler 生产零 callsite；非完整 dist export 清单 / 非 live 插件加载舰队）；authz **E1/E2 窄 PASS**（既有）不回退；idempotency 仍 NOT_COVERED（其后见上方 CURRENT）；errors / backward 仍 NOT_COVERED；versioning E1 PASS（既有）不回退。其后 idempotency 见上方 CURRENT。

##### HISTORICAL（Stage 3 Plugin/SDK authz E1/E2，`c2d985f8` 之上；Plugin schema/idempotency 见上方）


本轮相对 tip `c2d985f817c37d3f92bcbf59f01b8fecdd3b0e85`（#516 ACCEPT squash）补上 **Plugin/SDK authz** 窄切片：命题「插件不拥有剖面选择权」。证据：`resolveSecurityProfile` / `assertSecurityProfileAllowsStartup` 对 `clientProfileHint` 返回/抛出 `SECURITY_PROFILE_CLIENT_OVERRIDE_REJECTED`，剖面仍由 server/env/config 派生；Managed Enterprise 下 `pluginTenantAccess=unrestricted`（config 或 `OPENBOT_PLUGIN_TENANT_ACCESS`）→ `SECURITY_PROFILE_UNRESTRICTED_PLUGIN_ACCESS`；默认/显式 `restricted` 可启动；`src/plugin-sdk/index.ts` 不导出剖面选择 API；`server.impl.ts` 启动调用 `assertSecurityProfileAllowsStartup(cfgAtStart, process.env)` 不传 hint。本记录不是 EvidenceRow。本地 vitest 不是 Actions 行。回归 UNKNOWN。`stage8_eligible` 仍为 false。**不把 Stage 3 整体或产品写成 PASS**。不改写 §5.2 矩阵原文。API-01/02/03、WS 事件六列、CLI 六列、WS 请求 backward/authz 窄 PASS 措辞不回退。

| 命令 | 退出码 | 结果摘要 |
| ---- | ------ | -------- |
| `OPENBOT_TEST_PROFILE=low pnpm exec vitest run --config docs/acceptance/vitest.stage3-evidence.config.ts --maxWorkers 1 docs/acceptance/stage3-plugin-authz-evidence.test.ts` | 0 | `Tests 4 passed`（hint reject + unrestricted deny + sdk 无剖面导出 + startup 无 hint） |
| `OPENBOT_TEST_PROFILE=low pnpm exec vitest run src/gateway/security-profile.test.ts src/gateway/security-profile/security-profile.test.ts --maxWorkers 1` | 0（可选抽查） | 既有单元测含 client hint / unrestricted_plugin |

**当时 Plugin/SDK 六列**：schema 仍 NOT_COVERED（其后见上方 CURRENT）；authz **E1/E2 窄 PASS**（无剖面选择权 + 企业拒绝 unrestricted + SDK 不导出 + startup 无 hint；非 live 多租户舰队；非 schema/HTTP lint；非工具策略幂等）；idempotency / errors / backward 仍 NOT_COVERED；versioning E1 PASS（既有）不回退。其后 schema 见上方 CURRENT。

##### HISTORICAL（Stage 3 WS 请求 authz E1/E2，`64a237b0` 之上；Plugin authz 见上方 CURRENT）

本轮相对 tip `64a237b05783dd2fcaaa455a7f861ea76702501e`（#515 ACCEPT squash）补上 **WS 请求/响应 authz** 窄切片：命题「connect 握手对 token（或 password）、role、operator scopes、以及（需要时）device 签名失败关闭」。证据：`authorizeGatewayConnect` token_missing/mismatch/ok；`parseGatewayRole` / `isRoleAuthorizedForMethod` / `roleCanSkipDeviceIdentity`；`authorizeOperatorScopesForMethod` 缺 scope 明确拒绝；`buildDeviceAuthPayload(V3)` + `signDevicePayload`/`verifyDeviceSignature` 正反路径；`evaluateMissingDeviceIdentity` 无共享凭证时 `reject-device-required`；`message-handler` / `auth-context` / `server-methods` 接线（`resolveConnectAuthState`、签名校验拒绝、role/scope 门）。本记录不是 EvidenceRow。本地 vitest 不是 Actions 行。回归 UNKNOWN。`stage8_eligible` 仍为 false。**不把 Stage 3 整体或产品写成 PASS**。不改写 §5.2 矩阵原文。API-01/02/03、WS 事件六列、CLI 六列与 WS 请求 backward 窄 PASS 措辞不回退。

| 命令 | 退出码 | 结果摘要 |
| ---- | ------ | -------- |
| `OPENBOT_TEST_PROFILE=low pnpm exec vitest run --config docs/acceptance/vitest.stage3-evidence.config.ts --maxWorkers 1 docs/acceptance/stage3-ws-request-authz-evidence.test.ts` | 0 | `Tests 6 passed`（token + role + scopes + device sig + missing-device + wiring） |
| `OPENBOT_TEST_PROFILE=low pnpm exec vitest run src/gateway/role-policy.test.ts src/gateway/device-auth.test.ts src/gateway/gateway-method-auth.test.ts --maxWorkers 1` | 0 | 既有单元测绿（role / payload / method scopes） |

**WS 请求/响应六列（本轮）**：schema E1 PASS（既有）；authz **E1/E2 窄 PASS**（token/role/scopes/device 签名门禁 + 接线；非 live 多设备握手；非 Control UI 浏览器套件；非 Plugin authz）；idempotency / errors / versioning / backward 既有窄 PASS 不回退。Stage 3 总结论仍 **不是 PASS**（Plugin 多数列仍开）。

##### HISTORICAL（Stage 3 WS 请求 backward E1/E2，`f9fd742c` 之上；WS 请求 authz 见上方 CURRENT）

本轮相对 tip `f9fd742c5f9500bb3e5de9ebd6221e47d4f43ec7`（#514 ACCEPT squash）补上 **WS 请求/响应 backward compat** 窄切片：命题「遗留 client id 只走 `src/gateway/protocol/client-info.ts` 一类别名表」。证据：`LEGACY_GATEWAY_CLIENT_ID_ALIASES` 为唯一别名表；`normalizeGatewayClientId` 将 `openclaw-*` / `moltbot-*` 映射到 canonical；`GatewayClientIdSchema` / `validateConnectParams` 接受 canonical+该表、拒绝未知；`message-handler.ts` 握手路径调用 `normalizeGatewayClientId(connectParams.client.id)`；`primitives.ts` 不另写死 `openclaw-macos` 列表。本记录不是 EvidenceRow。本地 vitest 不是 Actions 行。回归 UNKNOWN。`stage8_eligible` 仍为 false。**不把 Stage 3 整体或产品写成 PASS**。不改写 §5.2 矩阵原文。API-01/02/03、WS 事件六列与 CLI 六列窄 PASS 措辞不回退。**WS 请求 authz（connect token/role/scopes/device 签名）仍 NOT_COVERED**。

| 命令 | 退出码 | 结果摘要 |
| ---- | ------ | -------- |
| `OPENBOT_TEST_PROFILE=low pnpm exec vitest run --config docs/acceptance/vitest.stage3-evidence.config.ts --maxWorkers 1 docs/acceptance/stage3-ws-request-backward-evidence.test.ts` | 0 | `Tests 3 passed`（单表 normalize + ConnectParams schema + handshake 接线） |
| `OPENBOT_TEST_PROFILE=low pnpm exec vitest run src/gateway/protocol/client-info.test.ts src/gateway/server.ios-client-id.test.ts --maxWorkers 1` | 0 | 既有单元/接线测绿（别名 + validateConnectParams） |

**WS 请求/响应六列（本轮）**：schema E1 PASS（既有）；authz **仍 NOT_COVERED**；idempotency / errors / versioning 既有窄 PASS 不回退；backward compat **E1/E2 窄 PASS**（单别名表 + schema 接受/拒未知 + handshake normalize；非 live 多设备握手；非 Stage 7 device happy_path）。Stage 3 总结论仍 **不是 PASS**（Plugin 多数列与 WS 请求 authz 仍开）。

##### HISTORICAL（Stage 3 CLI errors E1/E2，`b039cbf6` 之上；WS 请求 backward/authz 见上方）

本轮相对 tip `b039cbf6bddf0b6c70e31ffbbdd3e0b3934843e8`（#496 ACCEPT squash）补上 **CLI errors** 窄切片：命题「非 0 退出与 stderr 可区分用法错误和网关拒绝」。产品约定：用法 → stderr 前缀 `usage:` + 退出码 **2**；网关拒绝 → 前缀 `gateway reject:` + 退出码 **1**。证据：`cli-errors.ts` 分类/格式化；`configureProgramHelp` 的 Commander `outputError` + `exitOverride` 映射用法退出；`runGatewayCommand` 强制 `gateway_reject`；非法 `--timeout` 本地校验走 usage。本记录不是 EvidenceRow。本地 vitest 不是 Actions 行。回归 UNKNOWN。`stage8_eligible` 仍为 false。**不把 Stage 3 整体或产品写成 PASS**。不改写 §5.2 矩阵原文。API-01/02/03、WS 事件六列与 CLI versioning/backward/idempotency/authz 窄 PASS 措辞不回退。

| 命令 | 退出码 | 结果摘要 |
| ---- | ------ | -------- |
| `OPENBOT_TEST_PROFILE=low pnpm exec vitest run --config docs/acceptance/vitest.stage3-evidence.config.ts --maxWorkers 1 docs/acceptance/stage3-cli-errors-evidence.test.ts` | 0 | `Tests 5 passed`（契约前缀+退出码 + 分类 + help/gateway/timeout 接线） |
| `OPENBOT_TEST_PROFILE=low pnpm exec vitest run src/cli/cli-errors.test.ts src/cli/program/register.status-health-sessions.test.ts --maxWorkers 1` | 0 | `Tests 14 passed` |

**CLI 六列**：schema **E1 PASS**（既有）；authz **E1/E2 窄 PASS**（既有）；idempotency **E1/E2 窄 PASS**（既有）；errors **E1/E2 窄 PASS**（usage↔gateway reject 可区分；非全命令面 spawn / 非 live Gateway）；versioning **E1/E2 窄 PASS**（既有）；backward compat **E1/E2 窄 PASS**（既有）。Stage 3 总结论仍 **不是 PASS**（Plugin 多数列与 WS 请求 authz/backward 仍开）。

##### HISTORICAL（Stage 3 CLI authz E1/E2，`4ca25245` 之上；CLI errors / WS 请求 backward 见上方）

本轮相对 tip `4ca25245fa05463301738f4e41ad5825a32fa303`（#494 ACCEPT squash）补上 **CLI authz** 窄切片：命题「走 Gateway 的命令继承 Gateway auth；本地文件命令写明信任假设」。证据：`addGatewayClientOptions` / `callGatewayFromCli` 暴露并下传 `--token`/`--password`，且以 `GATEWAY_CLIENT_NAMES.CLI` / `GATEWAY_CLIENT_MODES.CLI` 调用 `callGateway`；cron / local-files / `gateway call` 走该继承路径；`ensureExplicitGatewayAuth` 在 CLI URL override 无显式凭证时抛错；`backup` 为本地文件系统命令（不调 Gateway），帮助与 `docs/cli/backup.md` 写明 OS-user STATE_DIR 信任假设。产品修复：`gateway-rpc` / `local-files` 补 `--password` 与 password 下传。本记录不是 EvidenceRow。本地 vitest 不是 Actions 行。回归 UNKNOWN。`stage8_eligible` 仍为 false。**不把 Stage 3 整体或产品写成 PASS**。不改写 §5.2 矩阵原文。API-01/02/03、WS 事件六列与 CLI versioning/backward/idempotency 窄 PASS 措辞不回退。

| 命令 | 退出码 | 结果摘要 |
| ---- | ------ | -------- |
| `OPENBOT_TEST_PROFILE=low pnpm exec vitest run --config docs/acceptance/vitest.stage3-evidence.config.ts --maxWorkers 1 docs/acceptance/stage3-cli-authz-evidence.test.ts` | 0 | `Tests 5 passed`（flags + wiring + modules + URL override + backup trust） |

**当时 CLI 六列**：schema E1；authz E1/E2 窄 PASS；idempotency E1/E2；errors NOT_COVERED；versioning/backward E1/E2。其后 errors / WS 请求 backward 见上方。

##### HISTORICAL（Stage 3 CLI idempotency E1/E2，`9a741441` 之上；CLI authz/errors 见上方）

本轮相对 tip `9a741441439e654bedf75d5048fbeb23d3daa882`（#493 ACCEPT squash）补上 **CLI idempotency** 窄切片：命题「快路径与 Commander 对同一命令的退出码一致」。证据：`status`/`health`/`sessions` 快路径与 `register.status-health-sessions` 共用同一 command 入口；非法/残缺 `--timeout` 快路径 `return false` fallthrough 到 Commander（产品修复：`resolveOptionalPositiveIntFlag`）；同 argv 下两路径调用同一 mock handler 且共享 `runtime.exit` 码。锚点：`routes.ts` / `register.status-health-sessions.ts` / `route.ts`。本记录不是 EvidenceRow。本地 vitest 不是 Actions 行。回归 UNKNOWN。`stage8_eligible` 仍为 false。**不把 Stage 3 整体或产品写成 PASS**。不改写 §5.2 矩阵原文。API-01/02/03、WS 事件六列与 CLI versioning/backward 窄 PASS 措辞不回退。

| 命令 | 退出码 | 结果摘要 |
| ---- | ------ | -------- |
| `OPENBOT_TEST_PROFILE=low pnpm exec vitest run --config docs/acceptance/vitest.stage3-evidence.config.ts --maxWorkers 1 docs/acceptance/stage3-cli-idempotency-evidence.test.ts` | 0 | `Tests 5 passed`（共享入口 + fallthrough + health/status 同 exit） |
| `OPENBOT_TEST_PROFILE=low pnpm exec vitest run src/cli/program/routes.test.ts --maxWorkers 1` | 0 | `Tests 24 passed`（含非法 timeout fallthrough） |

**当时 CLI 六列**：schema E1；authz NOT_COVERED；idempotency E1/E2 窄 PASS；errors NOT_COVERED；versioning/backward E1/E2。其后 authz 见上方 CURRENT。

##### HISTORICAL（Stage 3 CLI backward compat E1/E2，`7872e272` 之上；CLI idempotency 见上方 CURRENT）

本轮相对 tip `7872e2722ad2b7766a64767dec08c8bbcd296983`（#482 ACCEPT squash；其后 main 已前进无关产品 PR 至 `e1773267`）补上 **CLI backward compat** 窄切片：命题「帮助文本与注册表命令名一致」。证据：根 `--help` 列出全部 core + subcli 注册名；`hasSubcommands` 根命令带 ` *` 后缀且仅这些带星；Examples 使用 `openbot` 展示名、不含 `openclaw`。锚点：`configureProgramHelp` `subcommandTerm` + Commands hint；`getCoreCliCommandNames` / `getSubCliEntries`。本记录不是 EvidenceRow。本地 vitest 不是 Actions 行。回归 UNKNOWN。`stage8_eligible` 仍为 false。**不把 Stage 3 整体或产品写成 PASS**。不改写 §5.2 矩阵原文。API-01/02/03、WS 事件六列与 CLI versioning 窄 PASS 措辞不回退。

| 命令 | 退出码 | 结果摘要 |
| ---- | ------ | -------- |
| `OPENBOT_TEST_PROFILE=low pnpm exec vitest run --config docs/acceptance/vitest.stage3-evidence.config.ts --maxWorkers 1 docs/acceptance/stage3-cli-backward-evidence.test.ts` | 0 | `Tests 3 passed`（help 列出注册名 + `*` 后缀对齐 hasSubcommands + Examples 用 openbot） |

**当时 CLI 六列**：schema E1；authz/idempotency/errors NOT_COVERED；versioning E1/E2；backward E1/E2 窄 PASS。其后 idempotency 见上方 CURRENT。

##### HISTORICAL（Stage 3 CLI versioning E1/E2，`bd99d83d` 之上；CLI backward/idempotency 见上方）

本轮相对 tip `bd99d83da93b5b196d325ee08ecd9ac1bbd0709d`（#481 ACCEPT squash）补上 **CLI versioning** 窄切片：命题「`openbot` 为用户命令，`openclaw` 为兼容入口」。证据：`package.json` `bin` 双入口；`openclaw.mjs` 发 DeprecationWarning 后 `import("./openbot.mjs")`；`openbot.mjs` `KNOWN_CLI_NAMES` 含二者；`resolveCliName`/`replaceCliName` 展示名统一为 `openbot`。本记录不是 EvidenceRow。本地 vitest 不是 Actions 行。回归 UNKNOWN。`stage8_eligible` 仍为 false。**不把 Stage 3 整体或产品写成 PASS**。不改写 §5.2 矩阵原文。API-01/02/03 与 WS 事件六列窄 PASS 措辞不回退。

| 命令 | 退出码 | 结果摘要 |
| ---- | ------ | -------- |
| `OPENBOT_TEST_PROFILE=low pnpm exec vitest run --config docs/acceptance/vitest.stage3-evidence.config.ts --maxWorkers 1 docs/acceptance/stage3-cli-versioning-evidence.test.ts` | 0 | `Tests 4 passed`（bin 映射 + openclaw shim + openbot KNOWN_CLI_NAMES + display 统一） |

**当时 CLI 六列**：schema E1；authz/idempotency/errors/backward NOT_COVERED；versioning E1/E2 窄 PASS。其后 backward 见上方 CURRENT。

##### HISTORICAL（Stage 3 WS 事件 Swift/backward compat E2，`15b1e7e1` 之上；CLI versioning/backward 见上方）


本轮相对 tip `15b1e7e1f725f4c2feb01321e744504def20cab9`（#479 ACCEPT squash）补上 **WS 事件 backward compat** 窄切片：核对 `dist/protocol.schema.json` 的 `EventFrame` 属性集与两份已提交 `GatewayModels.swift`（macos + shared）的 `EventFrame` CodingKeys 线名一致（`type`/`event`/`payload`/`seq`/`stateVersion`）；两份 Swift 结构体正文相同；`stateVersion` 经 `case stateversion = "stateVersion"` 映射；`dedupeKey` **不是** EventFrame 线字段（仅广播缓存）。另跑 `pnpm protocol:check` 退出码 0（gen + gen:swift 后无 diff）。本记录不是 EvidenceRow。本地 vitest / protocol:check 不是 Actions 行。回归 UNKNOWN。`stage8_eligible` 仍为 false。**不把 Stage 3 整体或产品写成 PASS**。不改写 §5.2 矩阵原文。API-01/02/03 与 WS 事件 schema/authz/idempotency/errors/versioning 窄 PASS 措辞不回退。

| 命令 | 退出码 | 结果摘要 |
| ---- | ------ | -------- |
| `OPENBOT_TEST_PROFILE=low pnpm exec vitest run --config docs/acceptance/vitest.stage3-evidence.config.ts --maxWorkers 1 docs/acceptance/stage3-ws-events-evidence.test.ts` | 0 | `Tests 9 passed`（既有 7 + Swift EventFrame wire keys vs schema + required/optional 字段） |
| `pnpm protocol:check` | 0 | gen + gen:swift 后两份 Swift 与 `dist/protocol.schema.json` 无 diff |

**当时 WS 事件六列**：schema E2 / authz E3 / idempotency E3 / errors E2 / versioning E1 / backward E2。当时 CLI versioning 仍 NOT_COVERED（其后见上方 CURRENT）。

##### HISTORICAL（Stage 3 WS 事件服务端去重 / idempotency E3，`5155179c` 之上；backward 见上方 CURRENT）

本轮相对 tip `5155179c05124c3c805874bdddbfc6f450f6b8b4`（#478 ACCEPT squash）补上 **WS 事件 idempotency** 窄切片：广播可选 `dedupeKey` + TTL 缓存；同键 TTL 内抑制再 fan-out 且 **不递增 seq**；无 `dedupeKey` 的事件永不被该缓存抑制；产品接线于 `exec.approval.*` / `device.pair.*` / `node.pair.*`。**不**宣称客户端重放幂等；**不**覆盖全量事件类型。本记录不是 EvidenceRow。本地 vitest 不是 Actions 行。回归 UNKNOWN。`stage8_eligible` 仍为 false。**不把 Stage 3 整体或产品写成 PASS**。不改写 §5.2 矩阵原文。API-01/02/03 与 WS 事件 schema/authz/errors/versioning 窄 PASS 措辞不回退。当时 **WS 事件 backward 仍 NOT_COVERED**（其后见上方 CURRENT）。

| 命令 | 退出码 | 结果摘要 |
| ---- | ------ | -------- |
| `OPENBOT_TEST_PROFILE=low pnpm exec vitest run --config docs/acceptance/vitest.stage3-evidence.config.ts --maxWorkers 1 docs/acceptance/stage3-ws-events-evidence.test.ts` | 0 | 当时 `Tests 7 passed`（既有 5 + idempotency 同键抑制/TTL 恢复 + 无 key 不抑制） |
| `OPENBOT_TEST_PROFILE=low pnpm exec vitest run --config vitest.config.ts --maxWorkers 1 src/gateway/gateway-misc.test.ts -t "broadcast"` | 0 | companion 作用域 fan-out（既有；未要求 dedupeKey） |

**当时 WS 事件六列**：schema E2 / authz E3 / idempotency E3 / errors E2 / versioning E1 / backward NOT_COVERED。

##### HISTORICAL（Stage 3 WS 事件六列切片 E2/E3，`47ef2bb8` 之上；idempotency / backward 见上方）

本轮相对 tip `47ef2bb8b477ae79400c1fe0fa87c7a8bdc348e5`（#475 ACCEPT squash）补上 **WS 事件** 六列窄切片：`EventFrame` schema（`seq?`/`stateVersion?`）+ AJV；广播 `seq` 递增与 `EVENT_SCOPE_GUARDS` 作用域投递；未知 `event` 名仍为 `type:event` 而非 `res`；`PROTOCOL_VERSION===3`。当时 **服务端事件去重缓存仍 NOT_COVERED**（其后见上方 CURRENT）。本记录不是 EvidenceRow。本地 vitest 不是 Actions 行。回归 UNKNOWN。`stage8_eligible` 仍为 false。**不把 Stage 3 整体或产品写成 PASS**。

| 命令 | 退出码 | 结果摘要 |
| ---- | ------ | -------- |
| `OPENBOT_TEST_PROFILE=low pnpm exec vitest run --config docs/acceptance/vitest.stage3-evidence.config.ts --maxWorkers 1 docs/acceptance/stage3-ws-events-evidence.test.ts` | 0 | 当时 `Tests 5 passed`（schema/versioning/authz scope+seq/errors） |
| `OPENBOT_TEST_PROFILE=low pnpm exec vitest run --config vitest.config.ts --maxWorkers 1 src/gateway/gateway-misc.test.ts -t "broadcast"` | 0 | companion 作用域 fan-out（既有） |

**当时 WS 事件六列**：schema E2 / authz E3 / idempotency NOT_COVERED / errors E2 / versioning E1 / backward NOT_COVERED。

##### HISTORICAL（Stage 3 API-03 enterprise policy reject，`20bd2f21` 之上；WS 事件见上方 CURRENT）

本轮相对 tip `20bd2f21b29a467c853b41c934921fb83d93c36a`（#470 ACCEPT squash）补上 API-03：**策略拒绝返回明确错误**（`/tools/invoke` 权威 deny + `managed_enterprise` 失败关闭）。本记录不是 EvidenceRow。本地 vitest 不是 Actions 行。回归 UNKNOWN。`stage8_eligible` 仍为 false。**不把 Stage 3 整体或产品写成 PASS**。不改写 §5.2 矩阵原文。API-01 / API-02 窄 PASS 措辞不回退。当时 WS 事件六列仍整行 NOT_COVERED（其后见上方 CURRENT）。

| 命令 | 退出码 | 结果摘要 |
| ---- | ------ | -------- |
| `OPENBOT_TEST_PROFILE=low pnpm exec vitest run --config docs/acceptance/vitest.stage3-evidence.config.ts --maxWorkers 1 docs/acceptance/stage3-api-evidence.test.ts docs/acceptance/stage3-api03-policy-evidence.test.ts` | 0 | `Tests 9 passed`（含 API-03 企业 fail-closed 明确错误码 4 + 既有 5） |
| `OPENBOT_TEST_PROFILE=low pnpm exec vitest run --config vitest.config.ts --maxWorkers 1 src/gateway/tools-invoke-http.test.ts -t "404\|policy\|deny\|unauthorized\|forbidden\|denylisted\|capability deny\|sessions_spawn\|sessions_send\|denies gateway"` | 0 | `Tests 10 passed \| 13 skipped`（denylist/profile 404 带 `{ok:false,error}`；sessions_*/gateway deny；enforced tenant capability 404 `not_found`） |

**证据边界（产品已足，证据打包 + denylist 体断言加固）**：
1. HTTP `/tools/invoke` 权威策略拒绝 → **404** + `{ok:false, error:{type:"not_found", message}}`，不是空 200 / 静默丢弃。
2. `managed_enterprise`：`resolveSecurityProfile` / `assertSecurityProfileAllowsStartup` 在缺执行边界、共享凭证/浏览器根、客户端剖面覆盖时返回/抛出明确 `SECURITY_PROFILE_*`（`SecurityProfileStartupError`），不是静默放行。

**API-03**：相对 §5.6「策略拒绝 → 明确错误；非空 200 / 非静默丢弃」升级为 **窄 PASS（E3）**。**仍开（诚实）**：默认 `OPENBOT_GOVERNANCE_TOOLS_INVOKE_MODE=shadow` 下 `tenantCapabilities` deny **不改 HTTP**（需 `enforced` 才 404，属治理 rollout，不在本 PR 改默认）；非 live IdP / 多租户舰队；非全 webhook/插件策略面。Stage 3 总结论仍 **不是 PASS**。

##### HISTORICAL（Stage 3 API-02 WS malformed-frame disconnect，`02a9af3e` 之上；API-03 / WS 事件见上方）

本轮相对 tip `02a9af3e6ae57c893c9496d3070b6dec2adae16a`（含 #466 squash `6a0c85672f320295bdd695007d6d6e3eae2d23a1`）补上 API-02 **真实 gateway WS** 畸形帧断连 / 重连证据，并修正 post-handshake 畸形 JSON 原先不断连的缺口。本记录不是 EvidenceRow。本地 vitest 不是 Actions 行。回归 UNKNOWN。`stage8_eligible` 仍为 false。**不把 Stage 3 整体或产品写成 PASS**。不改写 §5.2 矩阵原文。API-01 超时窄 PASS 措辞不回退。当时 API-03 仍 CONDITIONAL（其后见上方 CURRENT）。

| 命令 | 退出码 | 结果摘要 |
| ---- | ------ | -------- |
| `OPENBOT_TEST_PROFILE=low pnpm exec vitest run --config vitest.config.ts --maxWorkers 1 src/gateway/server.ws-malformed-frame.test.ts` | 0 | `Tests 4 passed`（pre/post 畸形 JSON → close 1007；pre 非法 req → 1008；post 非法 req → ok:false；断连后可 reconnect） |
| `OPENBOT_TEST_PROFILE=low pnpm exec vitest run --config docs/acceptance/vitest.stage3-evidence.config.ts --maxWorkers 1 docs/acceptance/stage3-api-evidence.test.ts` | 0 | `Tests 5 passed`（AJV E2 + API-01 helpers + E1 supplements） |

**产品修复**：`message-handler.ts` parse/handle catch 在握手后也 `close(1007, "invalid json")`（先前仅 `!getClient()` 时关闭）。非法但可解析的 req：握手前仍 close 1008；握手后仍 `res.ok=false`（请求终止，符合「连接或请求终止」）。

**API-02**：相对 §5.6「畸形帧或畸形 JSON → 校验失败，连接或请求终止，不把残缺参数当默认成功」升级为 **窄 PASS（E3 线 + E2 AJV）**。**不是**全量模糊 / 二进制帧 / HTTP body 套件。Stage 3 总结论仍 **不是 PASS**。

##### HISTORICAL（Stage 3 agent pre-accept in-flight join，`378470cc` 之上；API-02/03 见上方）

本轮相对 tip `378470cc8a6c96c52eae1148ca3dfc1ec548592b`（#462 已合入）补上 agent **pre-accept** 并发同键 join。本记录不是 EvidenceRow。本地 vitest 不是 Actions 行。回归 UNKNOWN。`stage8_eligible` 仍为 false。**不把 Stage 3 整体或产品写成 PASS**。不改写 §5.2 矩阵原文。当时 API-02 / API-03 仍 CONDITIONAL（API-02 其后见上方 CURRENT）。

| 命令 | 退出码 | 结果摘要 |
| ---- | ------ | -------- |
| `OPENBOT_TEST_PROFILE=low pnpm exec vitest run --config vitest.config.ts --maxWorkers 1 src/gateway/server-methods/agent.test.ts -t "pre-accept\|timeout retry\|accepted ack\|malformed agent session"` | 0 | `Tests 3 passed`（含 pre-accept in-flight join + accepted/ok 重试） |

**API-01 超时后重试 / agent**：窄 PASS 升级为四方法均含 **in-flight promise join**（`send`/`poll`/`node.invoke`/`agent` pre-accept）。agent 在 `setGatewayDedupeEntry(accepted)` 之前经 `getIdempotencyInflightMap` 登记；同键同载荷并发第二次 await 第一次的 accept/error 并 `cached: true`，`agentCommand` 仅 1 次。accepted/ok dedupe 重试仍有效。Stage 3 总结论仍 **不是 PASS**。

##### HISTORICAL（Stage 3 timeout/in-flight 扩至四方法，`7330c3e4` 之上；agent pre-accept / API-02 见上方）

本轮相对 tip `7330c3e4e26f71ca9288a3a35ee53ca00836c5af`（#459 已合入）扩展超时/in-flight 幂等。本记录不是 EvidenceRow。本地 vitest 不是 Actions 行。回归 UNKNOWN。`stage8_eligible` 仍为 false。**不把 Stage 3 整体或产品写成 PASS**。不改写 §5.2 矩阵原文。

| 命令 | 退出码 | 结果摘要 |
| ---- | ------ | -------- |
| `OPENBOT_TEST_PROFILE=low pnpm exec vitest run --config vitest.config.ts --maxWorkers 1 src/gateway/server-methods/send.test.ts -t "timeout retry\|in-flight poll\|in-flight send\|replays poll"` | 0 | `Tests 4 passed`（send+poll in-flight join） |
| `OPENBOT_TEST_PROFILE=low pnpm exec vitest run --config vitest.config.ts --maxWorkers 1 src/gateway/server-methods/nodes.invoke-wake.test.ts -t "timeout retry"` | 0 | `Tests 1 passed`（node.invoke in-flight join） |
| `OPENBOT_TEST_PROFILE=low pnpm exec vitest run --config vitest.config.ts --maxWorkers 1 src/gateway/server-methods/agent.test.ts -t "timeout retry\|accepted ack"` | 0 | `Tests 1 passed`（agent accepted/ok dedupe 重试，无第二次 run） |

**API-01 超时后重试**：窄 PASS（四方法均有「超时重试不二次副作用」证据）。机制：`send`/`poll`/`node.invoke` = in-flight promise join（`joinOrRunIdempotencyInflight` / 同路径）；`agent` 当时仅为 early accepted dedupe（pre-accept join 见上方 HISTORICAL/CURRENT 链）。当时 API-02 / API-03 / 六列未满仍 CONDITIONAL（API-02 其后见 CURRENT 窄 PASS）。

##### HISTORICAL（第一次执行）

执行基线当时是 Stage 2 开账的 `8aa8d5e45baa2022a6b7629ac34d8573fc1374e4`。当时：schema 幂等键 / API-01 同键同载荷 / 同键不同载荷 / 并发重复 / AUTH-01 为窄 PASS；**超时重试、API-02、API-03、`protocol:check`、六列矩阵其余面为 NOT_COVERED**。该 HISTORICAL 结论不抄成当前。产品改动曾在 `0d5bc7729`（`node.invoke`）与 `086123de5`（`send` / `poll` / `agent`）。

##### HISTORICAL（Stage 3 跟进，`b0719b11` 之上；超时扩面 / API / WS 事件见上方）

本轮 `git fetch origin main` 后 tip 为 `b0719b11f8437b67e7421aa6036942f3927ffc15`（#430 已合入；其后本分支再叠 Stage 3 证据提交）。`git merge-base --is-ancestor origin/main HEAD` 退出码 0。本记录不是 EvidenceRow。CURRENT Actions 行仍为空（本地 vitest / `protocol:check` 不是 Actions 行）。回归 UNKNOWN。`stage8_eligible` 仍为 false。不改写 §5.2 矩阵原文去迁就弱 mock；不把 AJV 单元校验抬成全量 WS 畸形帧 PASS；超时四方法已有 in-flight/dedupe 证据（窄 PASS，见 CURRENT）；不把 CLI 五命令抽样抬成 CLI 六列 PASS。

产品修复：提交 `pnpm protocol:gen` + `protocol:gen:swift` 生成的两份 `GatewayModels.swift`（补 `LocalFilesRedeemParams` / `LocalFilesKeysetEvent`、以及 `ChatHistory` / `ChatSend` / `ChatInject` 新增可选字段），使干净树上 `pnpm protocol:check` 退出码 0。

| 检查项                   | 置信度 | 验收         | 回归    | 记录 |
| ------------------------ | ------ | ------------ | ------- | ---- |
| schema 有幂等键          | E1     | PASS         | UNKNOWN | 继承 HISTORICAL 窄 PASS。四副作用 schema 仍要求 `idempotencyKey` |
| API-01 相同键 + 相同载荷 | E3     | PASS         | UNKNOWN | 继承 HISTORICAL 窄 PASS（`send`/`poll`/`agent`/`node.invoke`） |
| API-01 相同键 + 不同载荷 | E3     | PASS         | UNKNOWN | 继承 HISTORICAL 窄 PASS（拒绝，`details.status` 409） |
| API-01 超时后重试        | E3     | PASS（窄：四方法含 agent pre-accept join） | UNKNOWN | **窄 PASS（四方法均 in-flight join）**。`send`/`poll`/`node.invoke`：promise join；**`agent`：pre-accept `getIdempotencyInflightMap` join**（并发同键 await 第一次 accept/error，`cached: true`，`agentCommand`×1）+ accepted/ok dedupe 重试。证据：`agent.test.ts` pre-accept + timeout retry。共享 helper：`idempotency-inflight.ts`。**不是** Stage 3 整体 PASS；API-02/03 其后见 CURRENT 窄 PASS；六列仍 CONDITIONAL |
| API-01 并发重复          | E3     | PASS         | UNKNOWN | 继承 HISTORICAL 窄 PASS（仅 `send` 并发同载荷；`agent` 并发未重跑） |
| AUTH-01                  | E3     | PASS         | UNKNOWN | 仍引用 Stage 1 窄 PASS，本阶段未重跑 |
| API-02                   | E3     | PASS（窄：WS 畸形 JSON/非法帧断连或请求终止） | UNKNOWN | **窄 PASS（E3 线 + E2 AJV）**。命题「校验失败 → 连接或请求终止，不把残缺当成功」：畸形 JSON → `close(1007)`（含握手后，产品修复）；握手前非法 req → `close(1008)`；握手后非法 req → `res.ok=false`；AJV 拒残缺 send/req。证据：`server.ws-malformed-frame.test.ts` + `stage3-api-evidence.test.ts`。断连后可 `connectOk` 重连。**不是**全量模糊/二进制帧/HTTP body 套件；**不是** Stage 3 整体 PASS；API-03 其后见 CURRENT 窄 PASS |
| API-03                   | E3     | PASS（窄：/tools/invoke 权威 deny + 企业 fail-closed 明确错误） | UNKNOWN | **窄 PASS（E3）**。命题「策略拒绝 → 明确错误；非空 200 / 非静默丢弃」：① `/tools/invoke` denylist/profile/sessions_*/gateway/`enforced` tenant capability → 404 `{ok:false,error:not_found}`；② `managed_enterprise` 缺边界/共享根/客户端覆盖 → `SECURITY_PROFILE_*` / `SecurityProfileStartupError`。证据：`tools-invoke-http.test.ts` + `stage3-api03-policy-evidence.test.ts`。**仍开**：默认 shadow 下 tenantCapabilities deny 不改 HTTP；非 live IdP；非全 webhook 面。**不是** Stage 3 整体 PASS；API-01/02 窄 PASS 不回退 |
| 生成物未漂移（Swift）    | E2     | PASS         | UNKNOWN | 干净树 `pnpm protocol:check` 退出码 0（gen + gen:swift 后两份 Swift 与 `dist/protocol.schema.json` 无 diff）。本轮提交先前缺失的生成字段，不是把失败标成 NOT_COVERED |
| 六列矩阵其余面           | E1–E3  | CONDITIONAL  | UNKNOWN | 见下表。本轮补：**Plugin/SDK errors** 窄填；先前 **Plugin/SDK schema/authz/idempotency** + **WS 请求 authz/backward** + **CLI 六列** + **WS 事件** 六列 + WS versioning/CLI schema/Plugin versioning E1。**仍开**：Plugin backward。阶段不得 PASS（API-01/02/03 已窄 PASS；六列未满） |

六列矩阵本轮实填（空着仍标 NOT_COVERED；不改写列命题）：

| 面 | schema | authz | idempotency | errors | versioning | backward compat |
| --- | --- | --- | --- | --- | --- | --- |
| WS 请求/响应 | E1 PASS（TypeBox + 幂等键字段） | E1/E2 窄 PASS（connect token/role/scopes/device 签名门禁 + handshake/method 接线；非 live 多设备 / 非 Control UI 浏览器套件） | E3 窄 PASS/CONDITIONAL（API-01 四情形；超时四方法窄 PASS；API-02/03 窄 PASS） | E3 窄 PASS（API-02 WS 畸形 JSON/非法帧断连或 ok:false；非全量模糊） | E1 PASS（`PROTOCOL_VERSION === 3`，与 `docs/gateway/protocol.md` 示例一致；本轮未重跑握手拒绝套件） | E1/E2 窄 PASS（遗留 client id 仅 `LEGACY_GATEWAY_CLIENT_ID_ALIASES`；ConnectParams 接受 canonical+别名、拒未知；handshake `normalizeGatewayClientId`；非 live 多设备） |
| WS 事件 | E2 PASS（EventFrame + seq?/stateVersion?；protocol.md 对齐） | E3 窄 PASS（EVENT_SCOPE_GUARDS；非匹配 scope/非 operator 不投递） | E3 窄 PASS（`dedupeKey` TTL 缓存；同键抑制 fan-out/seq；approval/pair 接线；无 key 不抑制；非客户端重放幂等；非全事件面） | E2 窄 PASS（未知 event 名仍为 type:event，不通过 ResponseFrame） | E1 PASS（PROTOCOL_VERSION=3 + EventFrameSchema） | E2 窄 PASS（两份 Swift EventFrame 线键=schema；protocol:check 空 diff；非全 payload 类型/非 Swift 运行时解码） |
| HTTP | E1 PASS（`/tools/invoke` 常开文档+路由；`/v1/chat/completions` 缺省 `enabled` 为 false，见 `server.impl.ts` 注释） | E3 窄 PASS（tools-invoke 权威 deny；非全 webhook；shadow tenantCapabilities 仍开） | NOT_COVERED（会话键/工具调用去重未本轮抽查） | E3 窄 PASS（API-03 404/`ok:false` + 企业 fail-closed 码） | E1（路径仅见 `/v1`；无 OpenAPI 版本字段） | E1（chat completions 默认关与文档一致） |
| CLI | E1 PASS（`getCoreCliCommandNames` 含 setup/onboard/doctor/dashboard/agent；对应 `docs/cli/*.md` 存在；`gateway` 为 subcli 另有文档） | E1/E2 窄 PASS（Gateway 命令继承 token/password + CLI client；URL override 需显式凭证；backup 本地信任假设；非 live handshake） | E1/E2 窄 PASS（快路径↔Commander 共享 status/health/sessions 入口 + 非法 `--timeout` fallthrough；非全命令面 spawn） | E1/E2 窄 PASS（`usage:`+exit 2 vs `gateway reject:`+exit 1；Commander exitOverride + runGatewayCommand；非全命令面 spawn / 非 live Gateway） | E1/E2 窄 PASS（`bin.openbot`/`bin.openclaw`；openclaw→openbot shim+DeprecationWarning；display 统一 openbot；非 spawn `--version` E3） | E1/E2 窄 PASS（根 help 列注册名 + `*`=hasSubcommands + Examples 用 openbot；非 docs/cli 全量漂移） |
| Plugin/SDK | E1/E2 窄 PASS（SDK `registerPluginHttpRoute`/`normalizePluginHttpPath` + `OpenClawPluginApi.registerHttpRoute`；`no-register-http-handler` 生产零 callsite；非完整 dist export 清单 / 非 live 加载） | E1/E2 窄 PASS（clientProfileHint 拒绝；managed unrestricted_plugin 拒绝；SDK 无剖面导出；startup 无 hint；非 live 舰队） | E1/E2 窄 PASS（同一 `applyToolPolicyPipeline` + `getPluginToolMeta`；`group:plugins` 展开；openclaw-tools/pi-tools/catalog 接线；非 live 舰队 / 非全矩阵） | E1/E2 窄 PASS（registerPluginCommand 拒绝→ok:false+error；registrar 错误诊断；schema 校验 errors 非空；非 live 舰队 / 非 /tools/invoke / 非 install 全矩阵） | E1 PASS（`pnpm lint:plugins:no-monolithic-plugin-sdk-entry-imports` 退出码 0；842 文件） | NOT_COVERED |
| 生成客户端（Swift） | E2 PASS（`protocol:check`） | NOT_COVERED（未对 Swift auth 字段做客户端侧复核） | E1（生成模型含 `idempotencyKey`；语义仍靠 API-01） | NOT_COVERED | UNKNOWN（按 §4.4 归档；无成对基线日志） | E2 PASS（两份 Swift + schema `git diff --exit-code` 空） |

执行过的命令：

| 命令 | 退出码 | 结果摘要 |
| ---- | ------ | -------- |
| `OPENBOT_TEST_PROFILE=low pnpm exec vitest run --config docs/acceptance/vitest.stage3-evidence.config.ts --maxWorkers 1 docs/acceptance/stage3-api-evidence.test.ts`（Node ≥22） | 0 | `Test Files 1 passed`；`Tests 5 passed`（API-01 helpers + API-02 validators + PROTOCOL_VERSION/CLI E1） |
| `OPENBOT_TEST_PROFILE=low pnpm exec vitest run --config vitest.config.ts --maxWorkers 1 src/gateway/server.ws-malformed-frame.test.ts`（Node ≥22） | 0 | `Tests 4 passed`（API-02 E3 WS 畸形帧断连/重连；见 CURRENT） |
| `OPENBOT_TEST_PROFILE=low pnpm exec vitest run --config vitest.config.ts --maxWorkers 1 src/gateway/server-methods/send.test.ts -t "timeout retry\|in-flight send when the same key"`（Node ≥22） | 0 | `Tests 2 passed \| 21 skipped`（含新增 timeout-retry join） |
| `OPENBOT_TEST_PROFILE=low pnpm exec vitest run --config vitest.config.ts --maxWorkers 1 src/gateway/tools-invoke-http.test.ts -t "404\|policy\|deny\|unauthorized\|forbidden\|denylisted\|capability deny\|sessions_spawn\|sessions_send\|denies gateway"` | 0 | `Tests 10 passed \| 13 skipped`（API-03 E3；见 CURRENT） |
| `OPENBOT_TEST_PROFILE=low pnpm exec vitest run --config docs/acceptance/vitest.stage3-evidence.config.ts --maxWorkers 1 docs/acceptance/stage3-api03-policy-evidence.test.ts` | 0 | `Tests 4 passed`（API-03 企业 fail-closed 明确错误；见 CURRENT） |
| `pnpm protocol:check`（提交生成物之后） | 0 | gen + gen:swift 后无 diff |
| `pnpm lint:plugins:no-monolithic-plugin-sdk-entry-imports` | 0 | `OK: ... 842 checked` |

Stage 3 总结论：**不是 PASS**。**API-01 超时后重试已窄 PASS（四方法，含 agent pre-accept in-flight join）**；**API-02 已窄 PASS（WS 畸形 JSON/非法帧断连或请求终止 + AJV）**；**API-03 已窄 PASS（/tools/invoke 权威 deny + 企业 fail-closed 明确错误）**。`protocol:check` / Swift schema+backward compat 为窄 PASS。六列补了 WS versioning / CLI schema / Plugin versioning 的 E1，以及 **WS 事件六列（含 backward）均窄 PASS**、**CLI versioning/backward/idempotency/authz/errors 均窄 PASS**、**WS 请求 backward/authz 窄 PASS**、**Plugin/SDK authz/schema/idempotency/errors 窄 PASS**；**Plugin backward 仍 NOT_COVERED**。本记录不是 EvidenceRow。`stage8_eligible` 仍为 false。

本阶段可再交验（窄，不是阶段 PASS）：

1. 四副作用 schema 幂等键；同键同载荷 / 同键不同载荷 / 并发（`send`）；AUTH-01 引用。
2. `send`/`poll`/`node.invoke`/`agent`（含 pre-accept）in-flight 同载荷 join + agent accepted/ok dedupe 重试（超时重试窄 PASS）。
3. API-02 窄 PASS：WS 畸形 JSON → close 1007；非法帧 → close 1008 或 ok:false；AJV 拒残缺；断连后可重连（非全量模糊）。
4. API-03 窄 PASS：`/tools/invoke` 权威 404/`ok:false` + `managed_enterprise` `SECURITY_PROFILE_*` fail-closed（shadow tenantCapabilities / live IdP / 全 webhook 仍开）。
5. `pnpm protocol:check` 退出码 0（生成物未漂移）。
6. WS versioning E1（`PROTOCOL_VERSION=3`）；CLI schema E1（五命令+docs）；Plugin versioning E1（no-monolithic lint）。
7. WS 事件六列窄 PASS（含 Swift EventFrame backward E2 + protocol:check；非全 payload 类型面）。
8. CLI versioning 窄 PASS（openbot 用户命令 / openclaw 兼容入口；非 spawn `--version` E3）。
9. CLI backward 窄 PASS（根 help ↔ 注册表命令名 / `*` 后缀；非 docs/cli 全量；非 argv spawn 套件）。
10. CLI idempotency 窄 PASS（快路径↔Commander 共享入口 + 非法 `--timeout` fallthrough；非全命令面 spawn；非 authz/errors）。
11. CLI authz 窄 PASS（Gateway 命令继承 token/password + CLI client；URL override 显式凭证；backup 本地信任假设；非 live handshake；非 errors）。
12. CLI errors 窄 PASS（`usage:`+exit 2 vs `gateway reject:`+exit 1；Commander exitOverride + runGatewayCommand；非全命令面 spawn / 非 live Gateway）。
13. WS 请求 backward 窄 PASS（遗留 client id 仅 `client-info.ts` 别名表 + ConnectParams 接受/拒未知 + handshake normalize；非 live 多设备；非 authz）。
14. WS 请求 authz 窄 PASS（connect token/role/scopes/device 签名门禁 + handshake/method 接线；非 live 多设备；非 Control UI 浏览器套件；非 Plugin authz）。
15. Plugin/SDK authz 窄 PASS（无剖面选择权：clientProfileHint 拒绝 + unrestricted_plugin 拒绝 + SDK 不导出 + startup 无 hint；非 schema/HTTP lint；非工具策略幂等；非 live 舰队）。
16. Plugin/SDK schema 窄 PASS（SDK HTTP 路由面 + `no-register-http-handler` 生产零 callsite；非完整 dist export 清单；非 live 插件加载；非 idempotency/errors/backward）。
17. Plugin/SDK idempotency 窄 PASS（同一工具策略管线 + group:plugins 展开 + openclaw-tools/pi-tools/catalog 接线；非 live 舰队 / 非全矩阵；非 errors/backward）。
18. Plugin/SDK errors 窄 PASS（拒绝→ok:false+error / registrar 错误诊断 / schema errors 非空；非 live 舰队；非 /tools/invoke；非 install 全矩阵；非 backward）。

不提交为阶段 PASS：全量 WS 模糊/二进制帧套件、默认 shadow 下租户能力 enforce、live IdP、全 webhook 策略面、全量事件类型去重、全 payload 类型面 / Swift 运行时解码套件、Plugin backward、完整 dist SDK export 清单 / live 插件加载、Swift authz/errors、live 多设备握手 / Control UI 浏览器 authz 套件、live 多租户舰队。API-01/02/03 与 WS 事件六列（含 Swift EventFrame backward）与 CLI 六列（含 errors）与 WS 请求 backward/authz 与 Plugin/SDK authz/schema/idempotency/errors 已窄闭合；不扩成 Stage 3 整体 PASS。

### 5.3 数据持久化（Stage 4，必验）

**问题：** 每个 store 走完一条链：权威源（SoT）→ 写路径 → 耐久 → 恢复 → 备份 → 还原 → 读路径。引擎分类（D/Q/E）只是这条链上的一个字段。`docs/design/openbot-persistence-engine-matrix-2026-07-13.md` 与其他 `docs/design/*` 是意图，置信度 E0，不能单独把 runtime status 标成 wired。

每个抽中的 store 固定填写：

| 字段                 | 要回答的问题                               |
| -------------------- | ------------------------------------------ |
| authoritative source | 谁是权威，冲突时以谁为准                   |
| writer               | 哪个函数或命令写入                         |
| reader               | 哪个函数或命令读回                         |
| initialization       | 首次创建发生在哪里                         |
| migration            | 谁迁移旧布局，有无确认开关                 |
| recovery             | 崩溃或不完整写之后如何继续                 |
| backup               | 是否进入 `backup create`，凭证是否排除     |
| restore              | `backup verify` 或等价还原是否读回同一权威 |
| runtime status       | `wired` / `aspirational` / `dual`          |
| consistency          | 并发与一致性模型，见下一段                 |

`consistency` 从下列词里选，可以组合：CAS、lock、transaction、append-only、last-write-wins、rebuildable、eventual、single-writer。Episode 的组合是 lock + CAS + transaction（`.txn`）+ append-only。CAS 比较发生在 `withRoundLock` 里面，锁是单写者。其他 store 实施时按源码填写，不得留空，也不得用引擎字母 D/Q/E 代替这个字段。

起草时用代码核对过、实施时必须重填的锚点：

| store            | authoritative source                                         | writer / reader                                  | runtime status             |
| ---------------- | ------------------------------------------------------------ | ------------------------------------------------ | -------------------------- |
| Gateway 配置     | `openbot.json`（遗留文件名见 `src/config/paths.ts`）         | 配置加载器；doctor 可改写                        | wired，D                   |
| 会话             | `agents/<agentId>/sessions/sessions.json`                    | `resolveDefaultSessionStorePath`；`sessions` CLI | wired，E                   |
| 凭证             | `<stateDir>/credentials`（`resolveOAuthDir`）                | 登录与 auth profile；备份必须回答是否排除        | wired，密钥                |
| 记忆索引         | `memory/<agentId>.sqlite`（文档路径，实施时对 `src/memory`） | 记忆索引模块                                     | wired，Q，以代码为准       |
| 知识索引         | `src/gateway/knowledge/**` 的 `node:sqlite`                  | `ensure*Schema` 与检索函数                       | wired，Q                   |
| Episode          | `<ns>/episodes/<id>/` 与 `<id>.txn`                          | `episode-store.ts`                               | wired 但默认关闭，见场景   |
| AI workforce DDL | `ai-workforce-governance/shared/db-schema.ts`                | 矩阵称未成为默认权威                             | aspirational，不得标 wired |
| 客户 Postgres    | 连接器目标库，不是产品 SoT                                   | `enterprise-data/adapters/postgres.ts`           | 外部系统，只读探测         |
| HA Postgres      | `ha_controller_instance` 等交付控制表                        | `deploy/ha/controller`                           | 交付库，不是租户 SoT       |

产品状态默认不是中心化 Postgres。`package.json` 的 `pg` 服务于客户连接器。状态目录可用 `OPENBOT_STATE_DIR`（兼容 `OPENCLAW_STATE_DIR`）。

#### Episode store 必验场景

证据文件：`src/gateway/collaboration-dispatch/episode-store.ts`、`episode-store.test.ts`、`episode-boundary.test.ts`。`isCollabEpisodeStoreEnabled` 仅当 `collaboration.episodeStore === true`。事务文件是 `episodeTxnPath` → `<episodesDir>/<episodeId>.txn`。快照是 `episode.json`，事件是 `events.jsonl`。

| ID             | 场景                                 | 通过标准                                                                                                                                                                         | 现有测试锚点                                                                            |
| -------------- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| PERSIST-EP-01  | `episodeStore=false`                 | 不要求出现 episode 目录；`recoverIncompleteEpisodes` 返回 `{recovered:0, scanned:0}`；遗留 round 仍是该路径的权威；恢复函数不读不写 `rounds/`                                    | `episode-store.test.ts` flag-off；`episode-boundary.test.ts`                            |
| PERSIST-EP-02  | `episodeStore=true` 的创建到删除事务 | 创建快照 → `applyEpisodeTransition` 合法迁移 → 写 `.txn` → 追加 `events.jsonl` → 落 `episode.json` → 删除 `.txn`。同一 `eventId` 第二次为 skipped，版本不加                      | 幂等 `eventId` 测试；`finishEpisodeCommit`                                              |
| PERSIST-EP-03  | 崩溃留下 pending `.txn`              | 下次 `readPersistedEpisode` 走 `recoverEpisodeCommit`，快照与事件到达 txn 内版本，txn 被删除                                                                                     | `crash mid-commit: pending txn is finished on next read`                                |
| PERSIST-EP-04a | 非法迁移                             | `canTransitionEpisodeState` 失败时抛 `EpisodeTransitionError`，不写第二个快照。这不是 CAS                                                                                        | `episode-store.test.ts` 的 `illegal transition throws`；`episode-state-machine.test.ts` |
| PERSIST-EP-04b | 并发 CAS                             | 过期 `stateVersion` 抛 `EpisodeCasConflictError`，不写第二个快照。比较写在 `applyEpisodeTransition` 的 `withRoundLock` 回调里                                                    | 同一测试里的 stale version 断言                                                         |
| PERSIST-EP-04c | 单写者锁                             | `withRoundLock` 保证同一 episode 的并发写只有一个进入临界区。锁不是 `EpisodeCasConflictError`                                                                                    | `episode-store.test.ts` 的 concurrent locking                                           |
| PERSIST-EP-05  | `events.jsonl` 坏行                  | 审计问题，不预判缺陷：`readEpisodeEventIds` 在 `JSON.parse` 失败时跳过该行（源码注释 skip corrupt line）。实施必须记录跳过是否只影响去重集合、快照是否仍权威、坏行是否被静默丢掉 | 源码 `readEpisodeEventIds`；若无测试则置信度最高 E1，结论不得为 PASS                    |

PERSIST-EP-01、EP-02、EP-03、EP-04a、EP-04b、EP-04c 以现有测试为 E3 候选，实施时在 Stage 0 重 pin 后的 SHA 上重跑对应文件并记录退出码。EP-05 在补测试之前保持开放问题。不得把非法迁移和 CAS 冲突写成同一个错误类。

链上其余检查（每行还要回填上一张固定字段表，含 consistency，不能只写引擎名）：

| 检查项             | 证据                                                                                                                     | 方法                                                                                                                            | 通过标准                                                                       | 风险                                              |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------- |
| 引擎分类与现状一致 | 持久化矩阵；`src/memory`；`src/gateway/knowledge`；`src/config/paths.ts`                                                 | 按矩阵抽 8 个域，每个给出「文件路径样例 + 读写函数 + D/Q/E」                                                                    | 抽样域的引擎与矩阵一致，或差异被写成矩阵勘误                                   | 把 aspirational DDL 当成已持久化                  |
| 会话与转录         | `src/config/sessions/paths.ts`；`src/commands/sessions.ts`；Pi `SessionManager`                                          | 追默认 store、多 agent 目录、`sessions migrate-legacy-stores`                                                                   | 路径含 agentId；非法 session id 被 `SAFE_SESSION_ID_RE` 拒绝                   | 遗留目录 `.openclaw` 与 `.openbot` 双读导致串数据 |
| 凭证与配置分离     | `src/config/paths.ts`；`docs/gateway/secrets.md`；`src/secrets`；`src/cli/command-secret-targets.ts`                     | 确认密钥不进普通配置导出；SecretRef 与 auth-profiles 的优先级有文档（`docs/gateway/authentication.md` 指向 OAuth 与 SecretRef） | 备份/导出路径有排除凭证的说明或代码；auth profile 高于 inline key 的行为被记录 | 备份包带走 `credentials/` 或 `.env`               |
| 租户隔离           | `src/gateway/security-profile.ts`；`pnpm lint:gateway:isolation-fail-closed`；`node scripts/check-tenant-addressing.mjs` | 在 `managed_enterprise` 假设下追一条写入的 shard key（tenantId / userId / agentId）                                             | 新 store 能落到租户路径或明确的 L0；缺上下文失败关闭有测试                     | 全局 `~/.openbot/*.json` 吃多租户业务态           |
| 迁移               | `src/commands/doctor*`；`openbot doctor` 文档 `docs/gateway/doctor.md`；seat-assets 迁移说明（矩阵所引设计文）           | 列出 doctor 会改写的状态，区分「检测」与「修复」                                                                                | 每个破坏性迁移有 dry-run 或确认开关，并有测试名                                | doctor 在 yes 模式无提示改写生产状态              |
| 备份               | `src/cli/program/register.backup.ts`（`backup create`、`backup verify`）                                                 | 读命令实现，列出归档包含与排除；若评审会授权，在临时目录做一次 create+verify                                                    | verify 能发现截断包；凭证排除策略写明                                          | 备份不可恢复，或把密钥打进归档                    |
| SQLite 生命周期    | `src/gateway/knowledge/kb-index-schema.ts` 等 `ensure*Schema`                                                            | 找 schema 版本或启动时 ensure；确认每库文件的 shard                                                                             | 索引库可重建或有迁移函数；shard 键写在模块头注释或调用处                       | 无版本的 SQLite 文件在升级后静默读错              |

备份与还原的通过标准：证据册写明从临时 `OPENBOT_STATE_DIR` 到 `backup verify` 的路径，且不依赖生产主机。隔离的通过标准：已选定剖面下，企业剖面的跨租户读取失败关闭；未选定剖面时本句标 NOT_COVERED。

#### Stage 4 执行记录

##### CURRENT（Stage 4 知识索引归档还原 E3，`81368554` 之上）

本轮相对 tip `8136855493988f3068de2b9045b4e563dea56b36`（#474 ACCEPT squash）补上 **知识索引归档还原** E3：临时 `OPENBOT_STATE_DIR` 下按产品布局写入 `knowledge/index/personal/<owner>.db`（schema + marker chunk）→ `backup create` → `backup verify` → 解包后以 `ensureKnowledgeIndexSchema` 重开并读回 marker。本记录不是 EvidenceRow。本地 vitest 不是 Actions 行。回归 UNKNOWN。`stage8_eligible` 仍为 false。**不把 Stage 4 整体或产品写成 PASS**（doctor 全量 config 键 / 全 store shard 普查 / 多拍仍开）。不改写 §5.3 矩阵原文。backup / doctor / 租户 shard / pin 单拍 / 凭证排除窄 PASS 措辞不回退。

| 命令 | 退出码 | 结果摘要 |
| ---- | ------ | -------- |
| `OPENBOT_TEST_PROFILE=low pnpm exec vitest run --config docs/acceptance/vitest.stage4-evidence.config.ts --maxWorkers 1 docs/acceptance/stage4-knowledge-archive-restore-evidence.test.ts` | 0 | `Tests 2 passed`（create→verify 含 knowledge/index db；extract 重开读回 marker；tenant 路径契约） |

**产品**：知识索引进 state 树，随默认 `backup create` state 资产归档；本轮抽查 personal index db 往返，非独立 restore CLI、非租户云路径 E3。

**知识索引归档还原**：相对「字段表备份/还原链 NOT_COVERED / 未做归档抽查」升级为 **窄 PASS（E3）**。**仍开**：租户 Mode B `tenants/.../shared/knowledge` 云路径未在本证据；独立 restore 命令不存在（本窄结论 = verify+extract 重开）；doctor 全量 config 键 / 全 store shard 普查 / 多拍控制器。Stage 4 总结论仍 **不是 PASS**。

##### HISTORICAL（Stage 4 pin 单拍运行时 E3，`27287348` 之上；知识归档见上方 CURRENT）

本轮相对 tip `2728734838de782e28a0d50f42a0f49e0c1867b0`（#473 ACCEPT squash）补上 **pin 单拍运行时** E3：`collaboration.episodeStore` 默认关闭；开启时 `runSingleBeatEpisodeAroundRound`（chat 主路径 wrap）创建/推进一拍 Episode 后停住，拒绝 `next_beat`；关闭时不写 episode、`recoverIncompleteEpisodes` 为空操作。本记录不是 EvidenceRow。本地 vitest 不是 Actions 行。回归 UNKNOWN。`stage8_eligible` 仍为 false。**不把 Stage 4 整体或产品写成 PASS**。不改写 §5.3 矩阵原文。backup / doctor dry-run / 租户 shard / 凭证排除窄 PASS 措辞不回退。当时知识索引归档还原仍开（其后见上方 CURRENT）。

| 命令 | 退出码 | 结果摘要 |
| ---- | ------ | -------- |
| `OPENBOT_TEST_PROFILE=low pnpm exec vitest run --config docs/acceptance/vitest.stage4-evidence.config.ts --maxWorkers 1 docs/acceptance/stage4-pin-single-shot-evidence.test.ts` | 0 | `Tests 4 passed`（默认 off + chat wrap；flag off 无写；flag on → EPISODE_CLOSED 单拍；二次 wrap 不增拍） |
| `OPENBOT_TEST_PROFILE=low pnpm exec vitest run --config vitest.config.ts --maxWorkers 1 src/gateway/collaboration-dispatch/episode-single-beat-runtime.g2.test.ts` | 0 | `Tests 6 passed`（产品 companion：边界/恢复/拒绝 next_beat） |

**产品**：`episode-single-beat-runtime.ts`（P0 G2）已接线 `chat.ts`；旗标默认 off，不改变默认 G8 执行器。

**pin 单拍运行时**：相对「旗标后的单拍运行时：一回合最多一拍；状态沿转移表；Store 与 round 目录互不读写；旗标关闭行为不变」升级为 **窄 PASS（E3）**。**仍开**：多拍控制器 / Floor live；当时知识索引归档还原仍开（其后见上方 CURRENT）；`episodeStore` 默认仍关闭（有意）。Stage 4 总结论仍 **不是 PASS**。

##### HISTORICAL（Stage 4 tenant store shard isolation E3，`84294232` 之上；pin 单拍 / 知识归档见上方）

本轮相对 tip `842942326dee8591dd5ac04e46c5ca53a1fbb9f4`（#472 ACCEPT squash）补上 **租户 store shard** E3：在 `managed` + `OPENBOT_MULTITENANT=1` 下追写入到 `tenantId`/`userId`/`agentId` 路径，缺上下文失败关闭。本记录不是 EvidenceRow。本地 vitest 不是 Actions 行。回归 UNKNOWN。`stage8_eligible` 仍为 false。**不把 Stage 4 整体或产品写成 PASS**。不改写 §5.3 矩阵原文。backup / doctor dry-run / 凭证排除窄 PASS 措辞不回退。当时 pin 单拍仍开（其后见上方 CURRENT）。

| 命令 | 退出码 | 结果摘要 |
| ---- | ------ | -------- |
| `OPENBOT_TEST_PROFILE=low pnpm exec vitest run --config docs/acceptance/vitest.stage4-evidence.config.ts --maxWorkers 1 docs/acceptance/stage4-tenant-store-shard-evidence.test.ts` | 0 | `Tests 4 passed`（control-plane 写入 `tenants/<tid>/…`；跨租户不可见；session 路径含 tid/uid/agentId；缺 ctx fail-closed） |
| `OPENBOT_TEST_PROFILE=low pnpm exec vitest run --config vitest.config.ts --maxWorkers 1 src/gateway/tenant-store-paths.test.ts` | 0 | `Tests 14 passed`（产品 companion） |
| `pnpm check:tenant-addressing` | 0 | `tenant-addressing guard: ok`（`seat-tenant-index` 双布局 residual 已注明 allowlist） |

**产品**：`tenant-store-paths.ts` 已按 tenant/user/agent 分片；本轮将 `seat-tenant-index.ts` 对全局 `loadEnterpriseSeatAssetsStore()` 的双布局索引读标为 addressing guard 文档化 residual（非请求路径静默全局回退）。

**租户隔离（store）**：相对「managed 下追 shard key；落到租户路径或明确 L0；缺上下文失败关闭」升级为 **窄 PASS（E3）**。**仍开**：并非仓库内每一个 store 文件都逐条追写；当时 pin 单拍 / 知识索引归档还原仍 NOT_COVERED（pin 单拍其后见上方 CURRENT）。Stage 4 总结论仍 **不是 PASS**。

##### HISTORICAL（Stage 4 doctor migration dry-run E3，`6e58e7ae` 之上；tenant shard / pin 单拍 / 知识归档见上方）

本轮相对 tip `6e58e7ae2620f962daad17196c08372be3187f7c`（#471 ACCEPT squash）补上 **doctor 破坏性迁移 dry-run / 确认开关** E3。本记录不是 EvidenceRow。本地 vitest 不是 Actions 行。回归 UNKNOWN。`stage8_eligible` 仍为 false。**不把 Stage 4 整体或产品写成 PASS**。不改写 §5.3 矩阵原文。backup create+verify / 凭证排除窄 PASS 措辞不回退。当时租户 shard / 单拍仍开（tenant shard 其后见上方 CURRENT）。

| 命令 | 退出码 | 结果摘要 |
| ---- | ------ | -------- |
| `OPENBOT_TEST_PROFILE=low pnpm exec vitest run --config docs/acceptance/vitest.stage4-evidence.config.ts --maxWorkers 1 docs/acceptance/stage4-doctor-migration-evidence.test.ts` | 0 | `Tests 3 passed`（sessions preview 检测不写盘；cron confirm=false 不改写；confirm=true 规范化） |
| `OPENBOT_TEST_PROFILE=low pnpm exec vitest run --config vitest.e2e.config.ts --maxWorkers 1 src/commands/doctor.runs-legacy-state-migrations-yes-mode-without.e2e.test.ts -t "legacy state migrations"` | 0 | `Tests 3 passed`（yes/nonInteractive 无提示执行；**confirm decline 不调用** `runLegacyStateMigrations`） |

**破坏性迁移 ↔ 开关 ↔ 测试名（窄清单）**：
1. Legacy sessions/agent/WhatsApp 状态：`detectLegacyStateMigrations` **preview（dry-run 检测）**；交互 `prompter.confirm`；拒绝不跑 `runLegacyStateMigrations`。测试：`stage4-doctor-migration-evidence.test.ts`（preview）；`doctor.runs-legacy-state-migrations-yes-mode-without.e2e.test.ts`（decline / yes / nonInteractive）。
2. Legacy cron store：`maybeRepairLegacyCronStore` confirm 开关；false 不改字节。测试：`stage4-doctor-migration-evidence.test.ts` + `doctor-cron.test.ts`。
3. `--yes` / `nonInteractive`：显式 opt-in 无提示执行（有测试名；不是静默默认）。

**迁移（doctor）**：相对「每个破坏性迁移有 dry-run 或确认开关，并有测试名」升级为 **窄 PASS（E3）**。**仍开**：并非 doctor 改写的每一条 config 键迁移都在本清单；当时租户 shard / pin 单拍仍 NOT_COVERED（tenant shard 其后见上方 CURRENT）。Stage 4 总结论仍 **不是 PASS**。

##### HISTORICAL（Stage 4 backup create+verify 全链 E3，`4558a6c4` 之上；doctor / tenant shard / pin 单拍 / 知识归档见上方）

本轮相对 tip `4558a6c4384874a4faabab83eb49e270ca4eb0a1`（#458 已合入）叠加 backup create→verify 全链证据。本记录不是 EvidenceRow。本地 vitest 不是 Actions 行。回归 UNKNOWN。`stage8_eligible` 仍为 false。**不把 Stage 4 整体或产品写成 PASS**。当时 doctor 迁移仍开（其后见上方 CURRENT）。

| 命令 | 退出码 | 结果摘要 |
| ---- | ------ | -------- |
| `OPENBOT_TEST_PROFILE=low pnpm exec vitest run --config docs/acceptance/vitest.stage4-evidence.config.ts --maxWorkers 1 docs/acceptance/stage4-store-evidence.test.ts`（Node ≥22） | 0 | `Test Files 1 passed`；`Tests 13 passed`（含 create→verify 全链 + 默认排除凭证） |

Stage 4 总结论（该 HISTORICAL 当时）：**不是 PASS**。**backup create+verify 全链 E3 窄 PASS**。凭证排除窄 PASS 仍有效。当时 doctor 迁移 / 租户 shard / 单拍仍 NOT_COVERED/CONDITIONAL。

##### HISTORICAL（Episode 窄闭合；其余 store NOT_COVERED）

Stage 4 开账当时 tip/`7f8b49286` 上：EP-01..EP-05 窄 PASS；**其余 store 字段表为 NOT_COVERED**。该 HISTORICAL 结论不抄成当前整阶段 PASS。单拍运行时与 `seedPersistedEpisode` 仍不在本分支默认路径。

##### HISTORICAL（其余 store 跟进；凭证备份排除窄闭合，`0b3faeaa` 之上；全链 E3 见上方 CURRENT）

本轮记账相对 tip `0b3faeaa9ede2c9e4562a795b7a54a1b1fce6c14`（其后本分支叠加凭证备份排除）。`git merge-base --is-ancestor origin/main HEAD` 退出码 0。本记录不是 EvidenceRow。本地 vitest 不是 Actions 行。回归 UNKNOWN。`stage8_eligible` 仍为 false。不把引擎字母 D/Q/E 当成 consistency；不改写 §5.3 固定字段命题；**默认备份排除凭证为窄 PASS**（`--include-credentials` 可恢复旧行为）；不把 aspirational DDL 标成 wired；**不把 Stage 4 整体写成 PASS**。

###### 固定字段表（其余 store；Episode 仍见 HISTORICAL EP 行）

| store | authoritative source | writer | reader | initialization | migration | recovery | backup | restore | runtime status | consistency |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Gateway 配置 | `openbot.json`（`resolveCanonicalConfigPath` → `<stateDir>/openbot.json`；遗留名见 `paths.ts`） | `writeConfigFile`（`src/config/io.ts`） | `loadConfig` | 首次写/加载时创建候选路径 | doctor 可改写（见迁移行） | 无效配置快照 `valid=false` 时备份拒绝带 workspace | 默认进 `backup create` state/config | `backup verify` 校验 manifest | wired | single-writer（进程内配置 IO）；文件 last-write-wins |
| 会话 | `agents/<agentId>/sessions/sessions.json`（`resolveDefaultSessionStorePath`） | sessions store / CLI | 同左；transcript 另路径 | agent 目录按需创建 | `sessions migrate-legacy-stores`（本轮未 E3） | pruning/bak 轮转（已有测试，本轮抽路径+id） | 位于 state 根下，随 state 归档 | 同 backup verify | wired | single-writer per store file；id 经 `SAFE_SESSION_ID_RE` |
| 凭证 | `<stateDir>/credentials`（`resolveOAuthDir`）；`oauth.json` | 登录 / auth profile 写 OAuth 目录 | 同左 | 目录按登录创建 | 遗留 `.openclaw/credentials` 候选（路径层） | 缺目录则备份跳过 | **默认排除**（plan `skipped.reason=excluded`；state 树 tar filter 剥 oauth）；`--include-credentials` 恢复旧包含 | verify 不要求凭证 payload | wired（密钥材料） | single-writer；路径可 `OPENBOT_OAUTH_DIR` 覆盖 |
| 记忆索引 | `memory/<agentId>.sqlite`（`src/agents/memory-search.ts` fallback） | `MemoryIndexManager` / `ensureMemoryIndexSchema` | 检索路径同库 | `ensureMemoryIndexSchema` 建 meta/files/chunks | schema-v2 写路径关闭（暗准备，非生产） | 打开时 ensure | 位于 state 下，随 state | 同 backup | wired（Q） | single-writer SQLite；rebuildable index |
| 知识索引 | knowledge `node:sqlite`（`ensureKnowledgeIndexSchema`） | ingest / ensure*Schema | `kb-retrieve` 等 | `ensureKnowledgeIndexSchema` | 表 `IF NOT EXISTS` + governance ensure | ensure 可重建结构 | **窄 PASS**：state 下 `knowledge/index/**/*.db` 随 backup create 进包（见 CURRENT） | **窄 PASS**：verify+extract 后 schema+marker 可读（非独立 restore CLI；非租户云路径） | wired（Q） | single-writer SQLite；rebuildable |
| AI workforce DDL | `ai-workforce-governance/shared/db-schema.ts` 字符串 DDL | **无**默认 `ensure*Schema` 接线 | 不作为产品读权威 | 未初始化为默认权威 | n/a | n/a | n/a | n/a | **aspirational**（不得标 wired） | n/a（未接线） |
| 客户 Postgres | 连接器目标库（非产品 SoT） | 连接器写不在产品 SoT | `resolveReadOnlyQuery` 仅 SELECT/WITH | 外部库 | 外部 | 外部 | 不进 openbot backup | 外部 | 外部系统，只读探测 | read-only guard |
| HA Postgres | `ha_controller_instance` 等交付表 | `deploy/ha/controller/lease.py` upsert | controller 读 | HA migrations | commitsafety SQL | controller recovery | 交付库，非租户备份 | 交付流程 | 交付控制，非租户 SoT | DB 事务（交付侧） |

| ID / 检查项 | 置信度 | 验收 | 回归 | 记录 |
| --- | --- | --- | --- | --- |
| PERSIST-EP-01..05 | E3 | PASS | UNKNOWN | 继承 HISTORICAL 窄 PASS（本轮未重跑 episode 套件；不降级） |
| Gateway 配置字段表 | E2 | PASS | UNKNOWN | 窄 PASS：路径 SoT=`openbot.json`；writer/reader=`writeConfigFile`/`loadConfig`。未做损坏配置恢复 E3 |
| 会话字段表 | E2 | PASS | UNKNOWN | 窄 PASS：`resolveDefaultSessionStorePath("agent-alpha")` → `.../agents/agent-alpha/sessions/sessions.json`；`isValidSessionId` 拒绝 `../etc/passwd` 与空串。未重跑 migrate-legacy E3 |
| 凭证字段表 | E2/E3 | PASS | UNKNOWN | 窄 PASS：路径 `resolveOAuthDir` → `<state>/credentials`；**默认备份排除凭证**（plan + archive filter；与 data-export 排除对齐）。`--include-credentials` 可 opt-in。不构成 Stage 4 整体 PASS |
| 记忆索引字段表 | E3 | PASS | UNKNOWN | 窄 PASS：`ensureMemoryIndexSchema` 创建 meta/files/chunks/embedding_cache；路径契约 `memory/<agentId>.sqlite`。未做崩溃恢复 E3 |
| 知识索引字段表 | E3 | PASS（窄：schema + 归档还原抽查） | UNKNOWN | **窄 PASS**：schema 既有；**归档还原 E3**：temp state → seed `knowledge/index/personal/<owner>.db` → backup create/verify → extract 重开读回 marker。证据：`stage4-knowledge-archive-restore-evidence.test.ts`。**仍开**：租户 Mode B 云路径未抽查；无独立 restore CLI。**不是** Stage 4 整体 PASS |
| AI workforce DDL | E1 | PASS | UNKNOWN | 窄 PASS **仅**证明 runtime-status=aspirational 源码声明；不得标 wired；无 ensure 接线 |
| 客户 Postgres | E2 | PASS | UNKNOWN | 窄 PASS：只读守卫拒绝 DELETE/INSERT；适配器文档称外部连接器非产品 SoT |
| HA Postgres | E1 | PASS | UNKNOWN | 窄 PASS：`lease.py` upsert `ha_controller_instance`；定位为交付控制表非租户 SoT |
| 备份 / 还原 | E3 | PASS（窄：排除凭证 + create→verify 全链） | UNKNOWN | **窄 PASS（排除凭证 + 全链）**：默认 `includeCredentials=false`；plan 将 credentials 标 `excluded`；archive payload 不含 `credentials/`/`oauth.json`；`--include-credentials` 恢复包含。**全链 E3**：临时 `OPENBOT_STATE_DIR` → `backupCreateCommand` → `backupVerifyCommand`（`verified.ok`、manifest `schemaVersion=1`、assetCount 对齐、payload 含 `state.txt`、无 credentials）。证据：`stage4-store-evidence.test.ts`（create→verify）+ `backup.test.ts` / `backup-verify.test.ts`。**不是** Stage 4 整体 PASS；doctor / tenant shard / pin 单拍 / 知识归档其后见 CURRENT 窄 PASS |
| 迁移（doctor） | E3 | PASS（窄：preview dry-run + confirm 开关） | UNKNOWN | **窄 PASS（E3）**。命题「破坏性迁移有 dry-run 或确认开关并有测试名」：legacy sessions preview 检测不写盘；confirm decline 不跑 `runLegacyStateMigrations`；cron confirm=false 不改 store；confirm=true 可规范化。证据：`stage4-doctor-migration-evidence.test.ts` + `doctor.runs-legacy-state-migrations-yes-mode-without.e2e.test.ts`（含 decline）+ `doctor-cron.test.ts`。`--yes`/`nonInteractive` 为显式 opt-in。**仍开**：非全部 config 键迁移清单；知识归档见 CURRENT。**不是** Stage 4 整体 PASS |
| SQLite 生命周期 | E3 | PASS | UNKNOWN | 窄 PASS：memory + knowledge 的 `ensure*Schema` 本轮 E3；未证明所有知识附属库 shard 头注释 |
| 租户隔离（store） | E3 | PASS（窄：managed+MULTITENANT shard 路径 + fail-closed） | UNKNOWN | **窄 PASS（E3）**。命题：managed 下写入落到 `tenants/<tid>/…`（control-plane / `users/<uid>/state/agents/<agentId>/…`）；缺 ctx `resolveDataRootForContext(null)` fail-closed；跨租户 seat-assets 不可见。证据：`stage4-tenant-store-shard-evidence.test.ts` + `tenant-store-paths.test.ts`；`pnpm check:tenant-addressing` ok（`seat-tenant-index` 双布局 residual 已注明）。**仍开**：非全 store 枚举；知识归档见 CURRENT。**不是** Stage 4 整体 PASS |
| pin 单拍运行时 | E3 | PASS（窄：旗标单拍 + 默认 off + chat wrap） | UNKNOWN | **窄 PASS（E3）**。命题：`collaboration.episodeStore` 默认 off；on 时 `runSingleBeatEpisodeAroundRound` 创建/推进至 `EPISODE_CLOSED`，最多一拍，拒绝 `next_beat`；off 时不写 episode、recover 空操作；chat 主路径已 wrap G8。证据：`stage4-pin-single-shot-evidence.test.ts` + `episode-single-beat-runtime.g2.test.ts`。**仍开**：多拍 / Floor live；默认仍关闭；知识归档见 CURRENT。**不是** Stage 4 整体 PASS |

执行过的命令：

| 命令 | 退出码 | 结果摘要 |
| ---- | ------ | -------- |
| `OPENBOT_TEST_PROFILE=low pnpm exec vitest run --config docs/acceptance/vitest.stage4-evidence.config.ts --maxWorkers 1 docs/acceptance/stage4-store-evidence.test.ts`（Node ≥22） | 0 | `Test Files 1 passed`；`Tests 13 passed`（含默认排除 / includeCredentials opt-in / create→verify 全链） |
| `OPENBOT_TEST_PROFILE=low pnpm exec vitest run --config docs/acceptance/vitest.stage4-evidence.config.ts --maxWorkers 1 docs/acceptance/stage4-doctor-migration-evidence.test.ts` | 0 | `Tests 3 passed`（doctor dry-run/confirm；见 CURRENT） |
| `OPENBOT_TEST_PROFILE=low pnpm exec vitest run --config docs/acceptance/vitest.stage4-evidence.config.ts --maxWorkers 1 docs/acceptance/stage4-tenant-store-shard-evidence.test.ts` | 0 | `Tests 4 passed`（tenant shard；见 CURRENT） |
| `OPENBOT_TEST_PROFILE=low pnpm exec vitest run --config docs/acceptance/vitest.stage4-evidence.config.ts --maxWorkers 1 docs/acceptance/stage4-pin-single-shot-evidence.test.ts` | 0 | `Tests 4 passed`（pin 单拍；见 CURRENT） |
| `OPENBOT_TEST_PROFILE=low pnpm exec vitest run --config docs/acceptance/vitest.stage4-evidence.config.ts --maxWorkers 1 docs/acceptance/stage4-knowledge-archive-restore-evidence.test.ts` | 0 | `Tests 2 passed`（知识归档还原；见 CURRENT） |
| `OPENBOT_TEST_PROFILE=low pnpm exec vitest run --config vitest.config.ts --maxWorkers 1 src/gateway/collaboration-dispatch/episode-single-beat-runtime.g2.test.ts` | 0 | `Tests 6 passed`（产品 companion；见 CURRENT） |
| `pnpm check:tenant-addressing` | 0 | `ok`（见 CURRENT） |
| `OPENBOT_TEST_PROFILE=low pnpm exec vitest run --config vitest.e2e.config.ts --maxWorkers 1 src/commands/doctor.runs-legacy-state-migrations-yes-mode-without.e2e.test.ts -t "legacy state migrations"` | 0 | `Tests 3 passed`（yes/nonInteractive/decline；见 CURRENT） |
| `OPENBOT_TEST_PROFILE=low pnpm exec vitest run --config vitest.config.ts --maxWorkers 1 src/commands/backup.test.ts src/commands/backup.atomic.test.ts` | 0 | `Test Files 2 passed`；`Tests 19 passed`（含默认排除 archive 与 `--include-credentials`） |
| `OPENBOT_TEST_PROFILE=low pnpm exec vitest run --config vitest.config.ts --maxWorkers 1 src/config/paths.test.ts src/gateway/knowledge/kb-index.test.ts -t "oauth paths\|ensureKnowledgeIndexSchema\|initializes schema"` | 0 | 既有路径/schema 窄证据 |

Stage 4 总结论：**不是 PASS**。EP-01..05 仍为窄 PASS。其余 store 固定字段表已重填：配置/会话/记忆/知识/客户 PG 只读/HA 交付定位/aspirational DDL 为窄 PASS 或定位 PASS；**凭证备份排除命题为窄 PASS**（默认 exclude + CLI opt-in）；**backup create+verify 全链 E3 已窄闭合为 PASS**；**doctor 迁移 dry-run/confirm 已窄 PASS（E3）**；**租户 store shard 已窄 PASS（E3）**；**pin 单拍运行时已窄 PASS（E3）**；**知识索引归档还原已窄 PASS（E3）**。本记录不是 EvidenceRow。`stage8_eligible` 仍为 false。

本阶段可再交验（窄，不是阶段 PASS）：

1. EP-01..05（继承）。
2. 配置/会话路径与 session id 守卫；OAuth 凭证目录；memory/knowledge ensure*Schema。
3. 客户 PG 只读 SQL 守卫；HA `ha_controller_instance` 交付定位；workforce DDL aspirational 声明。
4. **默认备份排除凭证**（窄 PASS；`--include-credentials` 恢复旧行为）。
5. **backup create→verify 全链**（窄 PASS；临时 `OPENBOT_STATE_DIR`；非 Stage 4 整体）。
6. **doctor 迁移 dry-run/confirm**（窄 PASS；legacy preview + confirm decline + cron confirm；非全 config 键清单）。
7. **租户 store shard**（窄 PASS；managed+MULTITENANT 路径 + fail-closed；非全 store 枚举）。
8. **pin 单拍运行时**（窄 PASS；旗标 G2 单拍 + 默认 off + chat wrap；非多拍/Floor live）。
9. **知识索引归档还原**（窄 PASS；state 布局 create→verify→extract 重开；非租户云路径 / 无独立 restore CLI）。

不提交为阶段 PASS：doctor 全量 config 键迁移枚举、全 store shard 普查、多拍控制器、租户知识云路径。backup / doctor dry-run / tenant shard / pin 单拍 / 知识归档已窄 PASS，**仍不扩成 Stage 4 整体 PASS**。

### 5.3a 可靠性与 HA（Stage 5，必验）

四问分开回答，禁止并成「HA 通过」。

| 问           | 证据                                                                                                     | 起草时可见的答案（实施时重核）                                   |
| ------------ | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| 实现是否存在 | `deploy/ha/controller/`、`deploy/ha/commitsafety/`、`.github/workflows/ha-commitsafety-sql.yml`          | 双控制器与 CommitSafety SQL 在树内                               |
| 激活是否允许 | `deploy/ha/controller/README.md`：`python -m controller run-once --mode auto` 被拒绝；默认 `mode=manual` | 自动故障转移代码路径存在，默认不允许当生产自动切换               |
| 部署是否接线 | `deploy/production/`、`Dockerfile`、`docs/install/docker.md`                                             | 实施时核对运行手册是否把控制器进程接进生产拓扑；接不上就写未接线 |
| 生产是否批准 | 同一 README：Production Auto Failover **NOT APPROVED / OFF**；Fence/Cloudflare 默认 lab stub             | 生产批准 = 否。不得把 lab stub 写成已启用                        |

Stage 5 结论可以是「实现存在，激活默认关闭，生产未批准」。这不是 FAIL，除非评审会把「生产已批准」写成验收命题。

#### Stage 5 执行记录

##### HISTORICAL（接线前 FAIL）

执行基线仍是 Stage 4 的 `7f8b49286a10e2c8133a7b476787bdbc05afc5c6`。当时在 pin 上检索 `ha/controller` 与 `HA_CONTROLLER`，根 `Dockerfile`、`docs/install/docker.md`、`deploy/production` 都没有命中。**部署是否接线 = FAIL（未接线）**。该 HISTORICAL 行不抄成当前结论。

##### CURRENT（生产接线跟进）

跟进分支在 `54daf0cb`（#426 合入后的 `origin/main`）之上实现最小生产接线。命题收窄为：「生产 compose 包是否提供可启用的 Dual Controller 启动入口（opt-in），且默认 `up` 不自动拉起、Auto FO 仍未批准」。不宣称生产已跑通故障转移，不宣称 Auto FO 批准。

| 问           | 置信度 | 验收 | 回归    | 记录                                                                                                                                                                                                                                                                                                                                 |
| ------------ | ------ | ---- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 实现是否存在 | E2     | PASS | UNKNOWN | 窄 PASS。`deploy/ha/controller/` 仍在树内；新增 `heartbeat-loop` CLI 与 `deploy/ha/controller/Dockerfile`。CommitSafety SQL 目录仍在。DC-01..07 仍 NOT_RUN                                                                                                                                                                           |
| 激活是否允许 | E3     | PASS | UNKNOWN | 窄 PASS。默认 `manual`；`run-once --mode auto` 与 `HA_CONTROLLER_MODE=auto` 的 `heartbeat-loop` 均 `SystemExit`（文案 Production Auto Failover is NOT APPROVED）。证据：`docs/acceptance/stage5-ha-production-wiring-evidence.test.ts`                                                                                              |
| 部署是否接线 | E2     | CONDITIONAL | UNKNOWN | **CONDITIONAL（相对先前 FAIL，不是 PASS）**。生产 compose 已有 `openbot-ha-controller` + **`profiles: ["ha"]`** 与文档/env 入口（artifact 存在）。但默认 `compose up` 仍起 **零** HA 进程；镜像默认 `openbot-ha-controller:local`（无 release 钉）；证据以文件核对 + CLI `mode=auto` 拒绝为主，`docker compose --profile ha config` 在有 Docker 时跑、无 Docker 时 skip。不把 dormant profile 写成生产默认拓扑已接线。Owner：platform/SRE（inventory follow-up）。剩余：release 镜像钉、compose config 烟测进 CI、文档化且实际使用的 enablement |
| 生产是否批准 | E1     | PASS | UNKNOWN | 窄 PASS。命题仍是「生产未批准」写明。Auto FO = 否；Fence 默认 lab。接线 ≠ 批准                                                                                                                                                                                                                                                        |

Stage 5 总结论：**实现存在，激活默认关闭，部署接线为 CONDITIONAL（opt-in profile `ha` 有 artifact，默认拓扑仍无 HA 进程），生产 Auto FO 未批准**。四句仍不合并成「HA 通过」或「生产 HA PASS」。DC 夹具 NOT_RUN；无真实故障转移；默认拓扑仍只起 gateway。本记录不是 EvidenceRow。`stage8_eligible` 仍为 false。

本阶段可提交验收：

1. 双控制器代码在树内，含生产侧车镜像与 `heartbeat-loop`（E2）。
2. `mode=auto` / `HA_CONTROLLER_MODE=auto` 被 CLI 拒绝，默认 `manual`（E3）。
3. 生产批准 = 否（E1）。
4. 部署接线从 FAIL 抬到 **CONDITIONAL**：compose profile `ha` + 文档/env 入口存在；**不是** PASS（默认仍未接线；无 release 镜像钉）。

不提交为 PASS：部署接线（保持 CONDITIONAL）；DC-01 到 DC-07；真实故障转移；默认 `compose up` 自动拉起控制器；Production Auto Failover 批准；产品 HA PASS。

本轮本地证据（退出码不是 Actions 行）：`OPENBOT_TEST_PROFILE=low pnpm exec vitest run --config docs/acceptance/vitest.stage5-evidence.config.ts --maxWorkers 1 docs/acceptance/stage5-ha-production-wiring-evidence.test.ts` → Test Files 1 passed；Tests 6 passed（含 `docker compose --profile ha config` 用例；本机无 Docker 时该用例 skip 警告后仍通过，账本保持 CONDITIONAL）。复核 REJECT 后：部署接线从 PASS 改为 CONDITIONAL。

### 5.4 质量与供应链（Stage 6，必验）

**问题：** 门禁是否在候选 SHA 上真实跑完，以及生产依赖审计是否被逐条记录。回归状态与验收状态按 §4.4 分开。依赖审计是必验证据，深度修复不在本方案内。与基线同签名只说明回归状态是 BASELINE_UNCHANGED，不说明 Stage 6 验收 PASS，也不记成无关 PR 引入的新回归。

供应链证据：`.github/workflows/ci.yml` job `secrets` 执行 `pre-commit run --all-files pnpm-audit-prod`。文档修订头 `9f23ebf63` 的 run `37569676205` 与 `main` run `37567349570` 均为失败。候选日志含 `@modelcontextprotocol/sdk` 与 `simple-git`，严重度合计含 3 critical。缓解前这份方法说明写过「本方案 PR 未改 `pnpm-lock.yaml`」。本轮执行记录改为：`pnpm.overrides` 把三条 critical 钉到修复版本，并改了 `pnpm-lock.yaml`。正式 SBOM 文件现由 `pnpm sbom:cyclonedx` 调用 OWASP `@cyclonedx/cdxgen@12.8.5` 生成并入库（见 §5.4 CURRENT）；**不**把「有 SBOM 文件」写成「没有漏洞」或 Stage 6 产品 PASS。根 `package.json` `license` 为 MIT。许可证冲突扫描若未跑，回归标 NOT_RUN；只有评审会把它排除出范围时，验收才标 NOT_COVERED。

每条依赖发现按公告身份填写，不按条数填写。禁止用「3 critical = 基线 = Stage 6 PASS」收口。禁止用 `108→108` 或 `16 low | 67 moderate | 22 high | 3 critical` 这种合计写成 `BASELINE_UNCHANGED`。回归闭合要逐条对齐 GHSA 或 CVE、包名、受影响版本范围、依赖路径、prod/dev 可达性、严重度。缺任一项则该条回归是 UNKNOWN。

| 字段              | 要回答的问题                                                     |
| ----------------- | ---------------------------------------------------------------- |
| advisory          | GHSA 或 CVE。没有则写未知，不得省略                              |
| package           | 包名                                                             |
| vulnerable range  | 公告中的受影响版本范围                                           |
| affected version  | lockfile 中的受影响版本                                          |
| dependency path   | 从根到该包的依赖路径                                             |
| severity          | critical / high / moderate / low。写这一条，不写全表合计         |
| direct/transitive | 直接依赖还是传递依赖                                             |
| prod/dev          | 生产依赖还是开发依赖，以及是否可达                               |
| fixed version     | 公告给出的修复版本；没有则写未知                                 |
| reachable surface | Gateway、插件、仅构建工具，或未知                                |
| mitigation        | 升级、隔离，或带主人的风险接受                                   |
| acceptance impact | 该条对 Stage 6 验收的影响；不得因条数相同或与基线叙述相同而 PASS |

| 检查项          | 证据                                                                                                                                         | 方法                                                                                                                             | 通过标准                                                                                                     | 风险                                                                                     |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| 单元 / 集成     | `vitest.unit.config.ts`、`vitest.config.ts`；`pnpm test`；`docs/help/testing.md`                                                             | 记录 `pnpm test` 实际入口（`scripts/test-parallel.mjs`）与分片；CI 上 Node 与 Bun 分片见 `.github/workflows/ci.yml` job `checks` | 实施批次选定的测试命令退出码 0，或失败用例有基线 issue                                                       | Linux CI 默认堆内存不足（workflow 已把 `OPENCLAW_TEST_MAX_OLD_SPACE_SIZE_MB` 提到 6144） |
| E2E / live      | `vitest.e2e.config.ts`、`vitest.live.config.ts`；`pnpm test:e2e`、`pnpm test:live`                                                           | e2e 纳入必跑清单；live 仅在有密钥的授权环境，且不把密钥写入证据册                                                                | e2e 结果附命令；live 未跑时回归标 NOT_RUN，仅评审会排除时验收标 NOT_COVERED                                  | 用 live 失败否定与密钥无关的逻辑                                                         |
| 类型与 lint     | `pnpm check`（`package.json`：host env policy、oxfmt、collaboration/evolution 构建、`tsgo`、oxlint、一组架构/频道/UI/配对 lint）             | 首选跑 `.github/workflows/ci-gate.yml` 同等子集：`pnpm format:check`、`scripts/ci-diagnostic-delta.mjs`、协作运行时红线          | 相对基线无新增 `tsgo` / oxlint 诊断；格式的回归状态按 §4.4，BASELINE_UNCHANGED 不是验收 PASS                 | 全量 `pnpm check` 会停在既有 `tsgo` 债务，不能单独当合并门                               |
| 协议与架构 lint | `pnpm protocol:check`；`pnpm lint:gateway:method-packs`；`pnpm lint:gateway:isolation-fail-closed`；`pnpm lint:auth:pairing-account-scope`   | 与 CI Gate 的 shadow 步骤对照，标出 blocking 与 `continue-on-error`                                                              | blocking 为绿；shadow 失败记入债务清单并注明「不阻断合并」                                                   | 把 warn-only 的 Loom / 结构 lint 说成已强制                                              |
| 死代码          | `knip.config.ts`；`pnpm deadcode:knip`                                                                                                       | 跑 knip 或记录最近一次 CI 产物；ignore 列表本身要被审一眼                                                                        | 新增生产入口未被 knip 标成未使用；ignore 有理由                                                              | 过度 ignore 掩盖真正的死入口                                                             |
| 密钥扫描        | `.pre-commit-config.yaml`（`detect-private-key`、Yelp `detect-secrets`，基线 `.secrets.baseline`）；`.github/workflows/ci.yml` job `secrets` | 确认 pre-commit 与 CI 使用同一基线；抽查 exclude 是否只覆盖测试夹具                                                              | 基线以外的新增密钥使 hook 失败                                                                               | exclude 过宽，真实密钥被忽略                                                             |
| Pre-commit      | `.pre-commit-config.yaml` 头部：`prek install` / `prek run --all-files`；另有 shellcheck、工作流与大文件检查                                 | 记录安装方式与 CI 是否调用同一配置                                                                                               | 贡献者文档与 CI secrets job 指向同一工具                                                                     | 本地未装 hook，只靠 CI                                                                   |
| CI 真实性       | Actions run/job，不是 YAML 注释                                                                                                              | 填 §4.4 对比表：base run、candidate run、失败签名、runner labels、回归状态、验收状态                                             | 每个必看 job 有回归状态；CANCELLED 的必验 job 验收不得为 PASS 或 NOT_COVERED；注释与 labels 冲突时标 UNKNOWN | 把 skipped 写成失败，把 cancelled 写成不适用，或把基线红写成新回归或验收 PASS            |
| 覆盖率门槛      | `docs/help/testing.md` 的 `pnpm test:coverage`；仓库指南中的 V8 70% 线                                                                       | 若评审要求覆盖率，单列一次 `pnpm test:coverage`，记录四项百分比                                                                  | 达到门槛，或列出低于门槛的包并有豁免                                                                         | 用全仓平均掩盖 Gateway 热路径未覆盖                                                      |
| 文档 CI         | `ci.yml` job `check-docs`（`pnpm check:docs`，仅 docs 变更）；`docs-scope` 可跳过重 job                                                      | 本方案这种 docs-only 变更应命中 docs scope                                                                                       | docs workflow 绿；不要求为文档 PR 跑全量测试                                                                 | 跳过逻辑误伤非文档文件                                                                   |

Stage 6 的回归对比表覆盖 format、check-docs（若改了文档）、delivery guard、secrets 审计、选定测试子集。新失败是 NEW_REGRESSION。签名按 §4.4 硬字段逐项相同才是 BASELINE_UNCHANGED。依赖审计还要按 GHSA/CVE、包、版本范围、依赖路径、prod/dev 可达性、严重度逐条相同；条数相同不够。有意跳过是 NOT_RUN。超时、并发取消、runner 失败、superseded、手动取消是 CANCELLED，必验项不得当成不适用。没有日志，或硬字段有一侧缺失，是 UNKNOWN。shadow lint 失败不写成验收 FAIL。

Stage 6 的验收 PASS 还要求：依赖发现已按上一张字段表填完，且没有把未缓解的 critical 可达面写成通过。格式债 BASELINE_UNCHANGED 可以与依赖审计的 CONDITIONAL 或 FAIL 同时成立。

#### Stage 6 执行记录

本轮再次 `git fetch origin main`。`git rev-parse origin/main` 打印 `a7bbaf6d14b40f138f677ff3c9c0a90e82de5ace`。`execution_baseline_sha` 钉成这一串。`git merge-base --is-ancestor origin/main HEAD` 退出码 1。不 rebase。CURRENT 里已抽出日志的终态 job 见上一节，共 19 行。本地 `pnpm audit --prod` 退出码不是 Actions 行。合计数字不是 `BASELINE_UNCHANGED`。记账 tip 不是候选 SHA `1b910f78ace85d65084ffbe716a55ad0ca6fab17`。

上一轮接受的 pin 是 `7f8b49286a10e2c8133a7b476787bdbc05afc5c6`。那个 SHA 是文档修订，下面的 docs-only 归因只描述它。中间打印过 `8e8f772b3443c1b0984351d284a5fc05726acb97`（#412，sandbox desktop，不是 docs-only）和 `5d250c297c90c4da85de925aacc19586693a8324`（#414，chat restore，四个源文件，不是 docs-only）。这两份后来都到了终态，但再 fetch 时 `origin/main` 已经是 `a7bbaf6d14b40f138f677ff3c9c0a90e82de5ace`（#415，Collab floor live cutover，不是 docs-only）。`8e8f772b3` 与 `5d250c297` 的终态不进 CURRENT。`5d250c297` 的 Docker Release [37656787543](https://github.com/upbeyond/openbot/actions/runs/37656787543) 结论 success。

本 pin 上的 workflow。检出 SHA 就是 pin 自己。已抽日志的终态 job 在 CURRENT。未终态的不写行：

| workflow                | run                                                                         | 再查时 status | 结论                                                                                                                                                                                                            |
| ----------------------- | --------------------------------------------------------------------------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CI                      | [37661176029](https://github.com/upbeyond/openbot/actions/runs/37661176029) | completed     | workflow 结论 failure。docs-scope、secrets、check-docs、protocol、check、node test、android test、六个 windows 分片已写入 CURRENT。ios、macos skipped 且无日志，不写行。release-check success，未抽日志，不写行 |
| Install Smoke           | [37661175759](https://github.com/upbeyond/openbot/actions/runs/37661175759) | completed     | workflow 结论 success。install-smoke 已写入 CURRENT。docs-scope success 未抽日志，不写行                                                                                                                        |
| CI Gate                 | [37661175957](https://github.com/upbeyond/openbot/actions/runs/37661175957) | completed     | workflow 结论 success。delivery guard 与 check 已写入 CURRENT。check 的 shadow lint 退出码 1，该行验收 CONDITIONAL                                                                                              |
| Workflow Sanity         | [37661176049](https://github.com/upbeyond/openbot/actions/runs/37661176049) | completed     | workflow 结论 success。actionlint 与 no-tabs 已写入 CURRENT                                                                                                                                                     |
| Memory Workspace Freeze | [37661175882](https://github.com/upbeyond/openbot/actions/runs/37661175882) | completed     | workflow 结论 failure。job 已写入 CURRENT。这不是 `secrets` 的结果                                                                                                                                              |
| Docker Release          | [37661175999](https://github.com/upbeyond/openbot/actions/runs/37661175999) | in_progress   | build-amd64 已 success，未抽日志，不写行。build-arm64 仍在跑，不写行，不写成 CANCELLED                                                                                                                          |

##### 窄命题：上一 pin `7f8b49286` 上 secrets / checks / install-smoke 为什么没有完成日志

`ci.yml` 的 `push` 带 `paths-ignore`：`docs/**`、`**/*.md`、`**/*.mdx`。pin `7f8b49286` 是文档修订。该 SHA 的 push 只出现两个 workflow：

| workflow        | run                                                                         | job             | job id         | 结论    | 日志里能引用的句子                                                                     |
| --------------- | --------------------------------------------------------------------------- | --------------- | -------------- | ------- | -------------------------------------------------------------------------------------- |
| Workflow Sanity | [37645190223](https://github.com/upbeyond/openbot/actions/runs/37645190223) | `no-tabs`       | `112874019353` | success | 步骤 `Fail on tabs in workflow files` 结论 success。日志没有单独的 `Tabs found` 结果行 |
| Workflow Sanity | 同上                                                                        | `actionlint`    | `112874019765` | success | 步骤 `Lint workflows` 结论 success                                                     |
| Install Smoke   | [37645190390](https://github.com/upbeyond/openbot/actions/runs/37645190390) | `docs-scope`    | `112877919488` | success | 标准输出有一行 `Docs-only change detected — skipping heavy jobs`                       |
| Install Smoke   | 同上                                                                        | `install-smoke` | `112878263814` | skipped | API 返回 `steps: []`。workflow 总结论 success 不是这个 job 的 PASS                     |

`secrets`、`checks`、`check-docs`、Windows 分片没有出现在 `7f8b49286` 的 run 列表里，因为上面的 path filter 让 `ci.yml` 整份 workflow 不启动。这是 NOT_RUN，原因已经写明，不是「日志去向不明」。`install-smoke` 的 `if: needs.docs-scope.outputs.docs_only != 'true'` 在 `docs_only=true` 时跳过，所以该 job 是 NOT_RUN。这四条观察只描述 `7f8b49286`，不写入现在的 CURRENT，也不套到 `8e8f772b3443c1b0984351d284a5fc05726acb97`、`5d250c297c90c4da85de925aacc19586693a8324` 或 `a7bbaf6d14b40f138f677ff3c9c0a90e82de5ace`。

本 PR tip 上另有未完成的 run：CI [37648200842](https://github.com/upbeyond/openbot/actions/runs/37648200842) 与 Install Smoke [37648200758](https://github.com/upbeyond/openbot/actions/runs/37648200758)，记账时 `status` 都是 `queued`。排队不是完成日志，不写成 EvidenceRow，也不写成 CANCELLED。

##### 窄命题：本工作树的密钥扫描与生产审计

`git diff --name-only origin/main...HEAD -- .github/workflows` 为空。`secrets` job 里的 zizmor 只在 workflow 文件有 diff 时运行；本工作树没有跑 zizmor，这一步记 NOT_RUN，不是 zizmor PASS。

本工作树执行 `pre-commit run --all-files detect-private-key`（pre-commit 4.6.2）。钩子打印 `detect private key...Passed`，退出码 0。窄 PASS 只覆盖这个钩子：基线以外的私钥文件没有让它失败。它不是 `secrets` job 的 PASS，也不是 Actions EvidenceRow。

本地 `pnpm audit --prod --json` 退出码 1。`metadata.vulnerabilities` 是 info 0、low 16、moderate 67、high 20、critical 0。退出码 1 是因为 high 仍在，不是因为 critical。三条已接受的 GHSA（`GHSA-v5rq-49vh-5v5c`、`GHSA-x6jw-m9v5-85vh`、`GHSA-jqcg-44mw-7w3h`）不在这份 JSON 里，`simple-git`、`proxy-addr`、`argv-parser` 这三个名字也不在。没有豁免工单：没有剩余 critical 需要豁免。不编造工单号、负责人或期限。high 20 没有逐条对上，合计不能当回归签名。回归 UNKNOWN。这不是 Actions EvidenceRow。

critical 三条在缓解后的字段（锁文件与这次本地 JSON。不是 pin 的 Actions 日志）：

| advisory                              | package                   | vulnerable range  | resolved version | dependency path                                       | severity | direct/transitive | prod/dev   | fixed version | reachable surface                      | mitigation                                                                                                                                                                                                                                          | acceptance impact                                   |
| ------------------------------------- | ------------------------- | ----------------- | ---------------- | ----------------------------------------------------- | -------- | ----------------- | ---------- | ------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| GHSA-v5rq-49vh-5v5c / CVE-2026-102829 | `@simple-git/argv-parser` | `<2.0.1`          | `2.0.1`          | `.>node-llama-cpp>simple-git>@simple-git/argv-parser` | critical | transitive        | prod audit | `>=2.0.1`     | 见下段。不是默认 Gateway HTTP 处理函数 | `pnpm.overrides` 钉到 `2.0.1`。缓解前锁里是 `1.1.1`                                                                                                                                                                                                 | 缓解。本地审计 JSON 里没有这条。不构成 Stage 6 PASS |
| GHSA-x6jw-m9v5-85vh / CVE-2026-102828 | `simple-git`              | `>=3.15.0 <4.0.1` | `4.0.2`          | `.>node-llama-cpp>simple-git`                         | critical | transitive        | prod audit | `>=4.0.1`     | 同上                                   | `pnpm.overrides` 从 `3.36.0` 改到 `4.0.2`。`patches/simple-git@4.0.2.patch` 补上 default 导出，因为 `node-llama-cpp` 写的是 `import simpleGit from "simple-git"`，4.0.2 的 ESM 只导出具名 `simpleGit`。不用 `4.0.1`，它仍依赖 `argv-parser` `2.0.0` | 缓解。本地审计 JSON 里没有这条。不构成 Stage 6 PASS |
| GHSA-jqcg-44mw-7w3h / CVE-2026-90711  | `proxy-addr`              | `>=1.1.0 <2.0.8`  | `2.0.8`          | `.>express>proxy-addr`                                | critical | transitive        | prod audit | `>=2.0.8`     | 见下段                                 | `pnpm.overrides` 钉到 `2.0.8`。缓解前锁里是 `2.0.7`                                                                                                                                                                                                 | 缓解。本地审计 JSON 里没有这条。不构成 Stage 6 PASS |

`node-llama-cpp@3.16.2` 仍是根 `package.json` 的 peerDependency。它的声明依赖是 `simple-git@^3.31.1`。override 之后锁文件解析到打过补丁的 `simple-git@4.0.2`。已安装副本里，`simple-git` 只出现在 `dist/bindings/utils/cloneLlamaCppRepo.js` 与 `dist/utils/gitReleaseBundles.js`。`cloneLlamaCppRepo()` 由 node-llama-cpp 的源码下载命令调用；`ensureLlamaCppRepoIsCloned` 由 `compileLLamaCpp.js` 在源码构建路径调用。`getLlama.js` 导入该模块做克隆状态检查，文件内没有 `cloneLlamaCppRepo(` 调用。OpenBot 自己的源码不导入 `simple-git`。本地嵌入只在 `src/memory/embeddings.ts` 的 `createLocalEmbeddingProvider` 里动态加载 `node-llama-cpp`。这把 git 参数注入的落点放在可选本地嵌入的源码克隆/构建，而不是默认 Gateway 请求处理函数。包仍在生产依赖树里。补丁只恢复 default 导出，让该模块还能被加载。没有把「不是默认请求路径」写成通过。

`express` 被 `src/browser/server.ts`、`src/browser/server-middleware.ts`、`src/browser/bridge-server.ts`、`src/media/server.ts`、`src/line/webhook.ts`、`src/line/bot.ts` 导入。`express` 的 `request.js` 在读取 `req.ip` 与 `req.ips` 时调用 `proxyaddr`。锁文件里 `express@5.2.1` 与 `express@5.0.x` 都依赖 `proxy-addr@2.0.8`。`src` 里没有 `trust proxy` 赋值，也没有 `req.ip` / `req.ips` 读取。公告条件是信任子网把 IPv4-mapped IPv6 当成可信地址。这个设置不在 `src` 里。浏览器控制、媒体与 LINE 的 Express 应用仍会加载这个模块。没有把「`src` 未读 `req.ip`」写成通过。

合入 main 之前，本 PR 树没有为这些 high 做 override。当时 `metadata.vulnerabilities.high` 是 20。`advisories` 里 severity 为 high 的条目是下面 17 个 GHSA（undici 两条各有 7.x 与 8.x 两段范围，所以表下有 19 行路径）。metadata 的 20 与这 19 行差 1，JSON 里没有第 20 个单独标题，不编。没有豁免工单号。合计不是回归签名。回归 UNKNOWN。这张表描述合入前的 PR 树，不是合入后的审计。

合入 `a7bbaf6d14b40f138f677ff3c9c0a90e82de5ace` 时保留了 main 已落地的 high override（axios `1.20.0`、brace-expansion `5.0.12`、fast-uri `3.1.8`、`@grpc/grpc-js` `1.14.5`、sharp `0.35.5`、source-map-js `1.2.2`、undici 7 `7.30.0`、undici 8 `8.11.2`、`@modelcontextprotocol/sdk` `1.31.0`），并保留本 PR 的 critical pin（`@simple-git/argv-parser` `2.0.1`、`simple-git` `4.0.2`、`proxy-addr` `2.0.8` 与 `patches/simple-git@4.0.2.patch`）。合入后在本工作树重跑 `pnpm audit --prod`：退出码 1，metadata 是 info 0、low 9、moderate 50、high 0、critical 0。这是本地命令，不是 Actions EvidenceRow。阶段仍不是 PASS。

| GHSA                | package                   | vulnerable range                        | patched                  | path                                                                                                           | severity |
| ------------------- | ------------------------- | --------------------------------------- | ------------------------ | -------------------------------------------------------------------------------------------------------------- | -------- |
| GHSA-3pq3-5fj3-cg6v | axios                     | `>=1.13.0 <1.20.0`                      | `>=1.20.0`               | `.>@larksuiteoapi/node-sdk>axios`                                                                              | high     |
| GHSA-542g-h47m-68v8 | axios                     | `>=1.13.0 <1.20.0`                      | `>=1.20.0`               | `.>@larksuiteoapi/node-sdk>axios`                                                                              | high     |
| GHSA-c29m-xwm3-cm6r | axios                     | `>=1.16.1 <1.20.0`                      | `>=1.20.0`               | `.>@larksuiteoapi/node-sdk>axios`                                                                              | high     |
| GHSA-m8m8-qj5v-23w3 | axios                     | `>=1.15.2 <1.20.0`                      | `>=1.20.0`               | `.>@larksuiteoapi/node-sdk>axios`                                                                              | high     |
| GHSA-mghh-pgcx-3jjj | axios                     | `>=1.15.0 <1.20.0`                      | `>=1.20.0`               | `.>@larksuiteoapi/node-sdk>axios`                                                                              | high     |
| GHSA-r4gj-5m52-g5wh | axios                     | `>=1.17.0 <1.20.0`                      | `>=1.20.0`               | `.>@larksuiteoapi/node-sdk>axios`                                                                              | high     |
| GHSA-x97p-jq2g-jp4f | axios                     | `>=1.15.1 <1.20.0`                      | `>=1.20.0`               | `.>@larksuiteoapi/node-sdk>axios`                                                                              | high     |
| GHSA-58mr-gqgx-xq4g | fast-uri                  | `=3.1.6`                                | `>=3.1.7`                | `.>ajv>fast-uri`                                                                                               | high     |
| GHSA-qw65-cvwx-89v3 | fast-uri                  | `>=3.0.0 <3.1.7`                        | `>=3.1.7`                | `.>ajv>fast-uri`                                                                                               | high     |
| GHSA-68fv-2mgg-jv7q | source-map-js             | `>=1.0.0 <1.2.2`                        | `>=1.2.2`                | `extensions__matrix>@vector-im/matrix-bot-sdk>sanitize-html>postcss>source-map-js`                             | high     |
| GHSA-6j4f-fj2g-mc7p | brace-expansion           | `>=4.0.0 <5.0.10`                       | `>=5.0.10`               | `.>@discordjs/voice>prism-media>@discordjs/opus>@discordjs/node-pre-gyp>rimraf>glob>minimatch>brace-expansion` | high     |
| GHSA-qhr7-859c-m2p7 | brace-expansion           | `>=4.0.0 <5.0.11`                       | `>=5.0.11`               | 同上                                                                                                           | high     |
| GHSA-6qxp-vccf-f47h | @modelcontextprotocol/sdk | `>=1.12.0 <1.31.0`                      | `>=1.31.0`               | `.>@earendil-works/pi-ai>@google/genai>@modelcontextprotocol/sdk`                                              | high     |
| GHSA-m9gg-hp2v-232j | @grpc/grpc-js             | `>=1.14.0 <1.14.5`                      | `>=1.14.5`               | `extensions__diagnostics-otel>@opentelemetry/sdk-node>@opentelemetry/exporter-logs-otlp-grpc>@grpc/grpc-js`    | high     |
| GHSA-rfgv-xxqx-mfg5 | undici                    | `>=7.0.0 <7.29.1` 与 `>=8.0.0 <8.10.2`  | `>=7.29.1` 与 `>=8.10.2` | `.>undici` 与 `.>@earendil-works/pi-coding-agent>undici`                                                       | high     |
| GHSA-w293-vg96-wgc3 | undici                    | `>=7.24.1 <7.29.1` 与 `>=8.0.0 <8.10.2` | `>=7.29.1` 与 `>=8.10.2` | 同上                                                                                                           | high     |
| GHSA-wq5f-xc86-pv6w | sharp                     | `<0.35.5`                               | `>=0.35.5`               | `.>sharp`                                                                                                      | high     |

##### 正式 SBOM

##### HISTORICAL（缺正式文件）

历史缺口：根脚本无名 cyclonedx/syft；`@cyclonedx/cyclonedx-npm` 依赖 `npm ls` 在 pnpm 布局失败；临时 `/tmp` JSON 未入库。该 HISTORICAL 不构成当前文件 PASS。

##### HISTORICAL（OWASP cdxgen CycloneDX，`1a39f223` 之上；#435 驳回后改标准工具；yaml moderate 见下方 CURRENT）


本轮基线 tip `1a39f223ba1b90f3876b8c526575ff6b0ba16a6c`（#434）。`git merge-base --is-ancestor origin/main HEAD` 退出码 0。

先前自定义 lockfile→JSON 发射器被独立验收 **REJECT**（相对 §5.4/E10 的 cyclonedx/syft「正式签发」表述过宽）。现改为标准工具：

1. 生成器包装 `scripts/generate-cyclonedx-sbom.ts` → `pnpm dlx @cyclonedx/cdxgen@12.8.5`（`-t js --spec-version 1.6 --no-recurse --no-install-deps --validate`）。
2. 脚本入口：`pnpm sbom:cyclonedx`。
3. 入库产物：`sbom/openbot.cdx.json`（CycloneDX **1.6**；`metadata.tools` 含 `@cyclonedx/cdxgen@12.8.5`）。
4. 说明：`sbom/README.md`。`cdxgen` 的 `timestamp`/`serialNumber` 非 bit-identical；再生成以 **component purl 集合** 对齐。
5. 遗留自定义发射器：`scripts/generate-cyclonedx-sbom.lockfile-legacy.ts`（仅支持证据，非正式路径）。

正式 SBOM **文件**单元格为窄 PASS（标准工具 + 入库 + 可再生成）。**不**把 Stage 6 整体写成 PASS：`pnpm audit --prod` 仍因 moderate/low 退出码 1（其后 `yaml` GHSA-48c2-rrv3-qjmp 见下方 CURRENT 窄缓解；退出码仍 1）。

| 检查项                                                          | 置信度 | 验收        | 回归    | 记录                                                                                                                                                                                                                  |
| --------------------------------------------------------------- | ------ | ----------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 三条 critical 的字段表                                          | E2     | 缓解        | UNKNOWN | 三条 GHSA 已不在本地 `pnpm audit --prod --json`。合入后 metadata critical 为 0、high 为 0。没有豁免工单。moderate 与 low 仍使命令退出码 1。不构成 Stage 6 PASS                                                        |
| `detect-private-key`                                            | E2     | PASS        | UNKNOWN | 窄 PASS。只此钩子退出码 0。不是 `secrets` job PASS                                                                                                                                                                    |
| `pnpm-audit-prod`                                               | E2     | FAIL        | UNKNOWN | 合入后本地 `pnpm audit --prod` 退出码 1。metadata high 0、critical 0、moderate 50、low 9。不是 Actions EvidenceRow                                                                                                    |
| 上一 pin `7f8b49286` 的 secrets / checks / check-docs / Windows | E2     | NOT_RUN     | NOT_RUN | 那个 SHA 的 `ci.yml` push path filter 使 workflow 不启动。原因已写明。不套用到新 pin                                                                                                                                  |
| 上一 pin 的 install-smoke                                       | E2     | NOT_RUN     | NOT_RUN | job `112878263814` skipped。`docs-scope` 日志写明 docs-only。只描述 `7f8b49286`                                                                                                                                       |
| 本 pin `a7bbaf6d` 的已抽日志 job                                | E2     | 见 CURRENT  | UNKNOWN | CI 结论 failure。Install Smoke 结论 success，镜像打印 OpenBot 2026.7.12-rc.2，`cli=openbot installed=1.0.1`。secrets FAIL（pin 树仍有 2 critical）。六个 windows 分片 FAIL。Docker build-arm64 仍 in_progress，不写行 |
| 本工作树 install-smoke / 全量 checks                            | E1     | NOT_RUN     | NOT_RUN | 没有 docker。没有跑 `pnpm test` 分片、`pnpm format:check`、`pnpm check`、`pnpm protocol:check`、knip、覆盖率                                                                                                          |
| zizmor                                                          | E2     | NOT_RUN     | NOT_RUN | workflow diff 为空，按 job 条件会跳过。本轮没有执行扫描器                                                                                                                                                             |
| 许可证冲突扫描                                                  | E1     | NOT_RUN     | NOT_RUN | 根 `package.json` 的 `license` 字段是 MIT。这只是字段存在。没有跑冲突扫描                                                                                                                                             |
| 正式 SBOM 文件                                                  | E3     | PASS        | UNKNOWN | 窄 PASS：OWASP `@cyclonedx/cdxgen@12.8.5` 生成并入库 `sbom/openbot.cdx.json`（CycloneDX 1.6，1600 components；tools 含 cdxgen）。再生成 purl 集合对齐（timestamp 可变）。证据 `stage6-sbom-evidence.test.ts`。**不是** audit PASS，也不构成 Stage 6 产品 PASS |
| 可观测 / 性能 / 发布通道                                        | E1     | NOT_COVERED | UNKNOWN | 版本字段是 `2026.7.12-rc.2`。没有跑 `npm view`，没有跑性能预算，没有把 OTel 写成已接线                                                                                                                                |

正式 SBOM 证据命令：

| 命令 | 退出码 | 结果摘要 |
| ---- | ------ | -------- |
| `pnpm sbom:cyclonedx`（Node ≥22；内部 `pnpm dlx @cyclonedx/cdxgen@12.8.5`） | 0 | 写入 `sbom/openbot.cdx.json`（1600 components；tools=@cyclonedx/cdxgen） |
| `OPENBOT_TEST_PROFILE=low pnpm exec vitest run --config docs/acceptance/vitest.stage6-evidence.config.ts --maxWorkers 1 docs/acceptance/stage6-sbom-evidence.test.ts` | 0 | `Tests 3 passed`（cdxgen 工具元数据 + purl 集合再生成 + script 入口） |
| `pnpm audit --prod`（本工作树抽查，非 Actions 行） | 1 | metadata critical 0、high 0；moderate/low 仍使退出码 1。**不**因 SBOM 改写为 audit PASS |

Stage 6 总结论：三条 critical 已用 override 解除。正式 SBOM 文件为 **窄 PASS**（OWASP `@cyclonedx/cdxgen` 入库且可再生成）。阶段仍 **不是 PASS**：`pnpm audit --prod` 退出码 1（moderate/low）；全量 checks、格式、覆盖率、许可证扫描等仍 NOT_RUN。合入前的 high 表保留为当时的记录。产品结论仍不是 PASS。`stage8_eligible` 仍是 false。

### 5.5 建议增补域

产品表面不在本节。控制台、企业微信 / 飞书 / 钉钉、节点、doctor / onboard 只由 Stage 7（§5.7）规定。本节只保留可观测、性能、正式 SBOM、发布通道。治理合规与研发多 Agent 过程本批为 NOT_COVERED；Episode 仍由 Stage 4 覆盖，协作运行时红线仍由 Stage 6 的 CI 项覆盖。

#### E2 可观测性

理由：Gateway 排障依赖日志、健康与 RPC 探针；另有 `extensions/diagnostics-otel`。没有观测面，事故无法验收「可诊断」。

证据：`docs/gateway/logging.md`、`docs/gateway/health.md`、`openbot logs`、`openbot health`、`extensions/diagnostics-otel`。  
方法：列出日志落盘、脱敏（`logging.redactPatterns`）、health RPC、OTel 插件是否默认启用。  
通过标准：主路径有一条从症状到日志字段的说明；密钥默认不进 info 日志。  
风险：OTel 未接线却被销售材料写成已观测。

#### E4 性能

理由：仓库有 `pnpm test:perf:budget` 与 `pnpm test:perf:hotspots`，以及 Gateway 热路径（WS、会话、知识检索）。性能不进第一支柱，是因为没有评审冻结的预算就不会有通过线。

方法：评审会若升格，只接受已提交的预算阈值与命令，不临时加压测场景。  
通过标准：预算命令相对基线无回退，或回退有解释。  
风险：无预算的「感觉慢」无法验收。

#### E10 正式 SBOM 文件

依赖审计日志已是 Stage 6 必验证据。正式 SBOM 文件现由 `pnpm sbom:cyclonedx` 调用 OWASP `@cyclonedx/cdxgen@12.8.5` 生成 CycloneDX 1.6，产物提交于 `sbom/openbot.cdx.json`（见 §5.4 CURRENT）。E10 与 Stage 6「正式 SBOM 文件」单元格对齐为窄 PASS；仍不把 Stage 6 整体或 audit 写成 PASS。

#### E11 发布通道

理由：`README.md` 与仓库指南区分 stable（`vYYYY.M.D`，npm `latest`）、beta（`vYYYY.M.D-beta.N`，npm `beta`）、dev（`main`）。验收对象若是「仓库尖端」，不得把 npm `latest` 的行为写成同一结论。

证据：`docs/install/development-channels.md`、`docs/reference/RELEASING.md`、`package.json` version `2026.7.12-rc.2`。  
方法：记录本 SHA 的版本字段，并说明它与 git tag、npm dist-tag 的关系需要在实施时用只读 `npm view` 核对。  
通过标准：报告标题写明「源码 SHA」还是「已发布 tag」。  
风险：rc 版本与已发布 stable 被当成同一个验收对象。

### 5.6 负路径（信任边界与 API，必验）

未选定剖面时，只跑与信任边界无关的静态项（API-02 的 schema 形状）。AUTH 项标 NOT_COVERED，不得写安全 PASS。

| ID      | 命题                                | 期望                                                                                                                                                                                                             | 证据方向                                                                    |
| ------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| AUTH-01 | 缺少或错误的 Gateway token/password | 前置：写下所选剖面的认证模式。仅当该模式要求认证时，才期望握手失败或 HTTP 401/403，且不进入 `hello-ok`。若该剖面明确允许未认证的本地或开发访问，则记录该配置，并验证行为停在允许范围内。401/403 不是无条件不变量 | `docs/gateway/protocol.md`、`openai-http` 测试；实施时点名测试与剖面配置    |
| AUTH-02 | 客户端试图改安全剖面                | 拒绝，错误码方向为 `SECURITY_PROFILE_CLIENT_OVERRIDE_REJECTED`                                                                                                                                                   | `security-profile.ts`                                                       |
| AUTH-03 | 新设备或未批准设备                  | 不发可用 device token；本地自动批准与远程显式批准分开记录                                                                                                                                                        | 架构文档配对段；`src/pairing`                                               |
| API-01  | 副作用调用的幂等                    | 按 §5.2 四情形写期望：相同键+相同载荷返回原结果；相同键+不同载荷拒绝或 409；超时重试不产生第二次副作用；并发重复只有一次成功。覆盖 `send`、`poll`、`agent`、`node.invoke`，以及 Episode 相同 `eventId`           | `docs/gateway/protocol.md`；`agent.ts`；`nodes.ts`；`episode-store.test.ts` |
| API-02  | 畸形帧或畸形 JSON                   | 校验失败，连接或请求终止，不把残缺参数当默认成功                                                                                                                                                                 | TypeBox 校验与 HTTP 解析测试                                                |
| API-03  | 策略拒绝                            | 返回明确错误。拒绝不是空 200，也不是静默丢弃                                                                                                                                                                     | `/tools/invoke` 与工具策略；企业剖面的失败关闭错误                          |

### 5.7 产品表面强制验收矩阵（Stage 7）

本节是强制验收矩阵，不是可选指导。它仍是控制台、企业微信、飞书、钉钉、iOS、Android、Harmony、macOS，以及 doctor / onboard 的唯一范围。§5.5 不得再把它们标成可选。未列入矩阵的表面标 NOT_COVERED。

```yaml
schema_id: openbot.acceptance.SurfaceMatrix
schema_version: 1
kind: mandatory_acceptance_matrix
not: optional_guidance
required_surface_ids:
  - console
  - wecom
  - feishu
  - dingtalk
  - ios
  - android
  - harmony
  - macos
  - doctor_onboard
required_path_kinds:
  - happy_path
  - negative_path
  - observable_result
existence_or_config_only_is_pass: false
invariants:
  - "each surface_id has exactly happy_path, negative_path, and observable_result"
  - "a missing path_kind => that surface acceptance_status=FAIL"
  - "existence or config-only evidence => that surface acceptance_status=FAIL"
```

无设备时不要求重编。该缺口标 NOT_RUN，不是 NOT_COVERED，也不是 PASS。存在性或仅配置不能充当任一行的 E3。

| surface_id     | path_kind         | e3_required | existence_or_config_only_is_pass | required_observation                                                                                                                                        |
| -------------- | ----------------- | ----------- | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| console        | happy_path        | true        | false                            | 已授权会话打开花名册、渠道、知识或 WebChat，请求落到对应 Gateway 方法。锚点 `ui/src/ui/views/console-subnav.ts`、`pnpm test:ui`                             |
| console        | negative_path     | true        | false                            | Gateway 错误或未授权时不得进入成功态                                                                                                                        |
| console        | observable_result | true        | false                            | 界面展示 Gateway 返回的错误，不显示假成功                                                                                                                   |
| wecom          | happy_path        | true        | false                            | 配置，然后认证，然后消息进入 Gateway，然后路由到预期 agent，然后回复回到企业微信。锚点 `extensions/wecom`、`docs/channels/enterprise-im.md`                 |
| wecom          | negative_path     | true        | false                            | 无效凭证或未允许的发送者被明确拒绝，失败关闭，不误路由，不假成功                                                                                            |
| wecom          | observable_result | true        | false                            | 频道侧可见回复或拒绝；测试断言或日志指出路由到的 agent。长连接与 URL callback 是否互斥写在同一条结论                                                        |
| feishu         | happy_path        | true        | false                            | 配置，然后认证，然后消息进入 Gateway，然后路由到预期 agent，然后回复回到飞书。锚点 `extensions/feishu`、`docs/channels/enterprise-im.md`                    |
| feishu         | negative_path     | true        | false                            | 无效凭证或未允许的发送者被明确拒绝，失败关闭，不误路由，不假成功                                                                                            |
| feishu         | observable_result | true        | false                            | 频道侧可见回复或拒绝；测试断言或日志指出路由到的 agent                                                                                                      |
| dingtalk       | happy_path        | true        | false                            | 配置，然后认证，然后消息进入 Gateway，然后路由到预期 agent，然后回复回到钉钉。锚点 `extensions/dingtalk`、`docs/channels/enterprise-im.md`                  |
| dingtalk       | negative_path     | true        | false                            | 无效凭证或未允许的发送者被明确拒绝，失败关闭，不误路由，不假成功                                                                                            |
| dingtalk       | observable_result | true        | false                            | 频道侧可见回复或拒绝；测试断言或日志指出路由到的 agent                                                                                                      |
| ios            | happy_path        | true        | false                            | 已批准设备连上 Gateway，client id 被接受，一次节点调用有往返。锚点 `apps/ios`、`src/gateway/protocol/client-info.ts`                                        |
| ios            | negative_path     | true        | false                            | 未批准设备拿不到可用 device token                                                                                                                           |
| ios            | observable_result | true        | false                            | 连接结果与调用结果出现在测试断言或日志里                                                                                                                    |
| android        | happy_path        | true        | false                            | 已批准设备连上 Gateway，client id 被接受，一次节点调用有往返。锚点 `apps/android`、`src/gateway/protocol/client-info.ts`                                    |
| android        | negative_path     | true        | false                            | 未批准设备拿不到可用 device token                                                                                                                           |
| android        | observable_result | true        | false                            | 连接结果与调用结果出现在测试断言或日志里                                                                                                                    |
| harmony        | happy_path        | true        | false                            | 已批准设备连上 Gateway，client id 被接受，一次节点调用有往返。锚点 `apps/harmony`、`src/gateway/protocol/client-info.ts`                                    |
| harmony        | negative_path     | true        | false                            | 未批准设备拿不到可用 device token                                                                                                                           |
| harmony        | observable_result | true        | false                            | 连接结果与调用结果出现在测试断言或日志里                                                                                                                    |
| macos          | happy_path        | true        | false                            | 已批准设备连上 Gateway，client id 被接受，一次节点调用有往返。Swift 生成物仍进入 `protocol:check`。锚点 `apps/macos`、`src/gateway/protocol/client-info.ts` |
| macos          | negative_path     | true        | false                            | 未批准设备拿不到可用 device token                                                                                                                           |
| macos          | observable_result | true        | false                            | 连接结果与调用结果出现在测试断言或日志里                                                                                                                    |
| doctor_onboard | happy_path        | true        | false                            | doctor 检测遗留状态目录并给出迁移说明；onboard 把企业 IM 放在产品路径。锚点 `src/commands/onboard.ts`、`src/commands/doctor*.ts`、`docs/gateway/doctor.md`  |
| doctor_onboard | negative_path     | true        | false                            | 危险修复在未确认时不改写                                                                                                                                    |
| doctor_onboard | observable_result | true        | false                            | 命令输出或测试断言可见。无状态目录时该执行标 NOT_RUN                                                                                                        |

判定式：对每个 `surface_id`，`path_kind` 集合必须等于 `{happy_path, negative_path, observable_result}`。缺一行，该表面 `acceptance_status=FAIL`。只拿出目录、配置、client id 或文档存在，该表面 `acceptance_status=FAIL`。

#### Stage 7 执行记录

##### 生产依赖审计（单条 moderate）

##### CURRENT（Stage 6 窄 moderate 审计：`morgan` GHSA-4vj7-5mj6-jm8m，`c8aff040` 之上）

本轮相对 tip `c8aff0406506c573ffe479e216d52c7dd9ca19eb`（#528 ACCEPT squash）对生产依赖审计做 **单条 moderate** 缓解：经 `@vector-im/matrix-bot-sdk` 传递的 `morgan` 的 **GHSA-4vj7-5mj6-jm8m**（CVE-2026-5078，`:remote-user` 令牌未中和控制字符 → 日志伪造；受影响 `>=1.2.0 <=1.10.1`，路径 `extensions__matrix>@vector-im/matrix-bot-sdk>morgan` @ 1.10.1）。缓解：根 `pnpm.overrides.morgan` → `1.11.0`（传递依赖，无根 `dependencies.morgan`）。诚实性：1.10.1→1.11.0 为同 major 内 minor bump；同包仍残留需 `>=1.12.0` 的 **GHSA-jxfw-x594-9x9m** 与需 `>=1.12.1` 的 **GHSA-9f6g-j8ch-79g4**，不扩写；先前 yaml / file-type / markdown-it / fast-xml-parser(jp2q/gh4j) / hono(xgm2/8j4g/gqvv/hxh3) / @hono/node-server / dompurify(v9jr/hpcv/rp9w/cmwh/55q2) / mysql2(rgwj) / qs(q8mj/4mjr) / music-metadata(53v6) / ip-address(rpw4/2vr4/j6r3/h3mg) 单元格仍清除；metadata `moderate` 14→13、`low` 5；**退出码仍为 1**。本记录不是 EvidenceRow。本地 vitest 不是 Actions 行。回归 UNKNOWN。`stage8_eligible` 仍为 false。**不把 Stage 6 整体或产品写成 PASS**。不改写 §5.4 矩阵原文。正式 SBOM 与既有 moderate 窄缓解措辞不回退。

| 命令 | 退出码 | 备注 |
| --- | --- | --- |
| `pnpm audit --prod`（缓解后） | 1 | `18 vulnerabilities`；`5 low | 13 moderate`；**无** `GHSA-4vj7-5mj6-jm8m`（仍有 `GHSA-jxfw-x594-9x9m` / `GHSA-9f6g-j8ch-79g4`） |
| `OPENBOT_TEST_PROFILE=low pnpm exec vitest run --config docs/acceptance/vitest.stage6-evidence.config.ts --maxWorkers 1 docs/acceptance/stage6-audit-moderate-morgan-evidence.test.ts` | 0 | `Tests 3 passed`（字段表 JSON + override pin + live audit 无该 GHSA 且 exit≠0；残差 jxfw/9f6g 仍在） |

**单条公告字段表（§5.4）**：见 `docs/acceptance/stage6-audit-moderate-morgan-evidence.json`（advisory / package / vulnerable range / affected version / path / severity / transitive / prod / fixed / surface / mitigation / acceptance impact）。

##### HISTORICAL（Stage 6 窄 moderate 审计：`ip-address` GHSA-j6r3-76f7-8jcv，`004ac8ff` 之上；morgan 4vj7 见上方 CURRENT）


本轮相对 tip `004ac8ff2dfd377863398a0bba81db5725a55ef7`（#527 ACCEPT squash）对生产依赖审计做 **单条 moderate** 缓解：经 `@earendil-works/pi-ai` → `@google/genai` → `@modelcontextprotocol/sdk` → `express-rate-limit` 传递的 `ip-address` 的 **GHSA-j6r3-76f7-8jcv**（CVE-2026-101912，`isInSubnet()`/`isHostInSubnet()` 跨族比较可把名单外地址判进 allowlist；受影响 `<=10.7.0`，路径 `.>@earendil-works/pi-ai>@google/genai>@modelcontextprotocol/sdk>express-rate-limit>ip-address` @ 10.5.1）。缓解：根 `pnpm.overrides.ip-address` `10.5.1` → `10.7.1`（传递依赖，无根 `dependencies.ip-address`）。诚实性：10.5.1→10.7.1 为同 major 内 minor bump；同一 pin 副作用清除同阈值 moderate **GHSA-h3mg-xc3c-68pw**（CVE-2026-101911，亦需 `>=10.7.1`；不另开第二单元格）；先前 yaml / file-type / markdown-it / fast-xml-parser(jp2q/gh4j) / hono(xgm2/8j4g/gqvv/hxh3) / @hono/node-server / dompurify(v9jr/hpcv/rp9w/cmwh/55q2) / mysql2(rgwj) / qs(q8mj/4mjr) / music-metadata(53v6) / ip-address(rpw4/2vr4) 单元格仍清除；metadata `moderate` 16→14、`low` 5；**退出码仍为 1**。本记录不是 EvidenceRow。本地 vitest 不是 Actions 行。回归 UNKNOWN。`stage8_eligible` 仍为 false。**不把 Stage 6 整体或产品写成 PASS**。不改写 §5.4 矩阵原文。正式 SBOM 与既有 moderate 窄缓解措辞不回退。

| 命令 | 退出码 | 备注 |
| --- | --- | --- |
| `pnpm audit --prod`（缓解后） | 1 | `19 vulnerabilities`；`5 low | 14 moderate`；**无** `GHSA-j6r3-76f7-8jcv` / `GHSA-h3mg-xc3c-68pw`（rpw4/2vr4 亦仍清除） |
| `OPENBOT_TEST_PROFILE=low pnpm exec vitest run --config docs/acceptance/vitest.stage6-evidence.config.ts --maxWorkers 1 docs/acceptance/stage6-audit-moderate-ip-address-j6r3-evidence.test.ts` | 0 | `Tests 3 passed`（字段表 JSON + override pin + live audit 无该 GHSA 且 exit≠0；同 pin 副作用清 h3mg；prior rpw4 测已放宽） |

**单条公告字段表（§5.4）**：见 `docs/acceptance/stage6-audit-moderate-ip-address-j6r3-evidence.json`（advisory / package / vulnerable range / affected version / path / severity / transitive / prod / fixed / surface / mitigation / acceptance impact）。

##### HISTORICAL（Stage 6 窄 moderate 审计：`ip-address` GHSA-rpw4-54j3-4h4q，`c63afcd7` 之上；j6r3 见上方 HISTORICAL）

本轮相对 tip `c63afcd7c0083177c4baf97d9d1982b59906375e`（#526 ACCEPT squash）对生产依赖审计做 **单条 moderate** 缓解：经 `@earendil-works/pi-ai` → `@google/genai` → `@modelcontextprotocol/sdk` → `express-rate-limit` 传递的 `ip-address` 的 **GHSA-rpw4-54j3-4h4q**（CVE-2026-101913，`Address6.isLinkLocal()` 把链路本地识别成 `fe80::/64` 而非 `fe80::/10` → SSRF/信任边界旁路；受影响 `<=10.5.0`，路径 `.>@earendil-works/pi-ai>@google/genai>@modelcontextprotocol/sdk>express-rate-limit>ip-address` @ 10.3.1）。缓解：根 `pnpm.overrides.ip-address` `10.3.1` → `10.5.1`（传递依赖，无根 `dependencies.ip-address`）。诚实性：10.3.1→10.5.1 为同 major 内 minor bump；同一 pin 副作用清除同阈值 moderate **GHSA-2vr4-cq9g-pvrc**（CVE-2026-101910，亦需 `>=10.5.1`；不另开第二单元格）；仍残留需 `>=10.7.1` 的 ip-address moderate **GHSA-j6r3-76f7-8jcv** 与 **GHSA-h3mg-xc3c-68pw**，不扩写；先前 yaml / file-type / markdown-it / fast-xml-parser(jp2q/gh4j) / hono(xgm2/8j4g/gqvv/hxh3) / @hono/node-server / dompurify(v9jr/hpcv/rp9w/cmwh/55q2) / mysql2(rgwj) / qs(q8mj/4mjr) / music-metadata(53v6) 单元格仍清除；metadata `moderate` 18→16、`low` 5；**退出码仍为 1**。本记录不是 EvidenceRow。本地 vitest 不是 Actions 行。回归 UNKNOWN。`stage8_eligible` 仍为 false。**不把 Stage 6 整体或产品写成 PASS**。不改写 §5.4 矩阵原文。正式 SBOM 与既有 moderate 窄缓解措辞不回退。

| 命令 | 退出码 | 备注 |
| --- | --- | --- |
| `pnpm audit --prod`（缓解后） | 1 | `21 vulnerabilities`；`5 low | 16 moderate`；**无** `GHSA-rpw4-54j3-4h4q` / `GHSA-2vr4-cq9g-pvrc`（仍有 `GHSA-j6r3-76f7-8jcv` / `GHSA-h3mg-xc3c-68pw`） |
| `OPENBOT_TEST_PROFILE=low pnpm exec vitest run --config docs/acceptance/vitest.stage6-evidence.config.ts --maxWorkers 1 docs/acceptance/stage6-audit-moderate-ip-address-evidence.test.ts` | 0 | `Tests 3 passed`（字段表 JSON + override pin + live audit 无该 GHSA 且 exit≠0；同 pin 副作用清 2vr4；更高阈值 j6r3/h3mg 仍在） |

**单条公告字段表（§5.4）**：见 `docs/acceptance/stage6-audit-moderate-ip-address-evidence.json`（advisory / package / vulnerable range / affected version / path / severity / transitive / prod / fixed / surface / mitigation / acceptance impact）。

##### HISTORICAL（Stage 6 窄 moderate 审计：`music-metadata` GHSA-53v6-4h7p-p4gj，`2df283f4` 之上；ip-address rpw4/j6r3 见上方）

本轮相对 tip `2df283f407522c3bf139bcd8f5cf633402b8f761`（#524 ACCEPT squash）对生产依赖审计做 **单条 moderate** 缓解：扩展 `@openclaw/matrix` 直接依赖 `music-metadata` 的 **GHSA-53v6-4h7p-p4gj**（CVE-2026-107387，APEv2 解析器按标签项 size 无界分配内存 → DoS；受影响 `<=11.12.3`，路径 `extensions__matrix>music-metadata` @ 11.12.3；同 override 亦覆盖 `@whiskeysockets/baileys>music-metadata`）。缓解：`extensions/matrix/package.json` `dependencies.music-metadata` `^11.12.3` → `^11.16.0`，根 `pnpm.overrides.music-metadata` `11.12.3` → `11.16.0`。诚实性：11.12.3→11.16.0 为同 major 内 minor bump；同一 pin 副作用清除同包 moderate **GHSA-jjpr-9cvf-cq55**（CVE-2026-107388）、**GHSA-5gfj-9q3v-qfp3**（CVE-2026-107389）、**GHSA-f94x-6692-553q**（CVE-2026-107391）、**GHSA-8j4c-6x6g-rq3j**（CVE-2026-107392；不另开第二–第五单元格）；先前 yaml / file-type / markdown-it / fast-xml-parser(jp2q/gh4j) / hono(xgm2/8j4g/gqvv/hxh3) / @hono/node-server / dompurify(v9jr/hpcv/rp9w/cmwh/55q2) / mysql2(rgwj) / qs(q8mj/4mjr) 单元格仍清除；metadata `moderate` 23→18、`low` 5；**退出码仍为 1**。本记录不是 EvidenceRow。本地 vitest 不是 Actions 行。回归 UNKNOWN。`stage8_eligible` 仍为 false。**不把 Stage 6 整体或产品写成 PASS**。不改写 §5.4 矩阵原文。正式 SBOM 与既有 moderate 窄缓解措辞不回退。

| 命令 | 退出码 | 备注 |
| --- | --- | --- |
| `pnpm audit --prod`（缓解后） | 1 | `23 vulnerabilities`；`5 low | 18 moderate`；**无** `GHSA-53v6-4h7p-p4gj` / `GHSA-jjpr-9cvf-cq55` / `GHSA-5gfj-9q3v-qfp3` / `GHSA-f94x-6692-553q` / `GHSA-8j4c-6x6g-rq3j` |
| `OPENBOT_TEST_PROFILE=low pnpm exec vitest run --config docs/acceptance/vitest.stage6-evidence.config.ts --maxWorkers 1 docs/acceptance/stage6-audit-moderate-music-metadata-evidence.test.ts` | 0 | `Tests 3 passed`（字段表 JSON + matrix dep+override pin + live audit 无该 GHSA 且 exit≠0；同 pin 副作用清四条 sibling） |

**单条公告字段表（§5.4）**：见 `docs/acceptance/stage6-audit-moderate-music-metadata-evidence.json`（advisory / package / vulnerable range / affected version / path / severity / direct(extension) / prod / fixed / surface / mitigation / acceptance impact）。

##### HISTORICAL（Stage 6 窄 moderate 审计：`qs` GHSA-4mjr-xmp4-gh2g，`21817f96` 之上；music-metadata 53v6 / ip-address rpw4 见上方）

本轮相对 tip `21817f96347c7105d2d3da63c6a2aa1a85c167dc`（#523 ACCEPT squash）对生产依赖审计做 **单条 moderate** 缓解：经 `@larksuiteoapi/node-sdk` 传递的 `qs` 的 **GHSA-4mjr-xmp4-gh2g**（CVE-2026-82417，`qs.stringify` 对攻击者可控值调用 `utils.isBuffer()` 时未校验 `constructor.isBuffer` 可调用性 → DoS；受影响 `>=2.2.5 <6.16.0`，路径 `.>@larksuiteoapi/node-sdk>qs` @ 6.15.2）。缓解：根 `pnpm.overrides.qs` `6.15.2` → `6.16.0`（传递依赖，无根 `dependencies.qs`）。诚实性：6.15.2→6.16.0 为同 major 内 minor bump；同一 pin 副作用清除同阈值 moderate **GHSA-x5fp-wj9c-mxmx**（CVE-2026-82562，亦需 `>=6.16.0`；不另开第二单元格）；先前 yaml / file-type / markdown-it / fast-xml-parser(jp2q/gh4j) / hono(xgm2/8j4g/gqvv/hxh3) / @hono/node-server / dompurify(v9jr/hpcv/rp9w/cmwh/55q2) / mysql2(rgwj) / qs(q8mj) 单元格仍清除；metadata `moderate` 25→23、`low` 5；**退出码仍为 1**。本记录不是 EvidenceRow。本地 vitest 不是 Actions 行。回归 UNKNOWN。`stage8_eligible` 仍为 false。**不把 Stage 6 整体或产品写成 PASS**。不改写 §5.4 矩阵原文。正式 SBOM 与既有 moderate 窄缓解措辞不回退。

| 命令 | 退出码 | 备注 |
| --- | --- | --- |
| `pnpm audit --prod`（缓解后） | 1 | `28 vulnerabilities`；`5 low | 23 moderate`；**无** `GHSA-4mjr-xmp4-gh2g` / `GHSA-x5fp-wj9c-mxmx`（q8mj 亦仍清除） |
| `OPENBOT_TEST_PROFILE=low pnpm exec vitest run --config docs/acceptance/vitest.stage6-evidence.config.ts --maxWorkers 1 docs/acceptance/stage6-audit-moderate-qs-4mjr-evidence.test.ts` | 0 | `Tests 3 passed`（字段表 JSON + override pin + live audit 无该 GHSA 且 exit≠0；同 pin 副作用清 x5fp） |

**单条公告字段表（§5.4）**：见 `docs/acceptance/stage6-audit-moderate-qs-4mjr-evidence.json`（advisory / package / vulnerable range / affected version / path / severity / transitive / prod / fixed / surface / mitigation / acceptance impact）。

##### HISTORICAL（Stage 6 窄 moderate 审计：`qs` GHSA-q8mj-m7cp-5q26，`e7614880` 之上；qs 4mjr 见上方 HISTORICAL）

本轮相对 tip `e7614880bf645afbcd2da3cdfd10ca9c799133d5`（#522 ACCEPT squash）对生产依赖审计做 **单条 moderate** 缓解：经 `@larksuiteoapi/node-sdk` 传递的 `qs` 的 **GHSA-q8mj-m7cp-5q26**（`qs.stringify` 在 `filter` 数组含 `null`/`undefined` 时抛 TypeError → 远程可触发 DoS；受影响 `>=6.11.1 <=6.15.1`，路径 `.>@larksuiteoapi/node-sdk>qs` @ 6.14.2）。缓解：根 `pnpm.overrides.qs` `6.14.2` → `6.15.2`（传递依赖，无根 `dependencies.qs`）。诚实性：6.14.2→6.15.2 为同 minor 内 patch bump；**无**同 pin 副作用清其他 moderate；仍残留需 `>=6.16.0` 的 qs **GHSA-4mjr-xmp4-gh2g** 与 **GHSA-x5fp-wj9c-mxmx**，不扩写；先前 yaml / file-type / markdown-it / fast-xml-parser(jp2q/gh4j) / hono(xgm2/8j4g/gqvv/hxh3) / @hono/node-server / dompurify(v9jr/hpcv/rp9w/cmwh/55q2) / mysql2(rgwj) 单元格仍清除；metadata `moderate` 26→25、`low` 5；**退出码仍为 1**。本记录不是 EvidenceRow。本地 vitest 不是 Actions 行。回归 UNKNOWN。`stage8_eligible` 仍为 false。**不把 Stage 6 整体或产品写成 PASS**。不改写 §5.4 矩阵原文。正式 SBOM 与既有 moderate 窄缓解措辞不回退。

| 命令 | 退出码 | 备注 |
| --- | --- | --- |
| `pnpm audit --prod`（缓解后） | 1 | `30 vulnerabilities`；`5 low | 25 moderate`；**无** `GHSA-q8mj-m7cp-5q26`（仍有 `GHSA-4mjr-xmp4-gh2g` / `GHSA-x5fp-wj9c-mxmx`） |
| `OPENBOT_TEST_PROFILE=low pnpm exec vitest run --config docs/acceptance/vitest.stage6-evidence.config.ts --maxWorkers 1 docs/acceptance/stage6-audit-moderate-qs-q8mj-evidence.test.ts` | 0 | `Tests 3 passed`（字段表 JSON + override pin + live audit 无该 GHSA 且 exit≠0） |

**单条公告字段表（§5.4）**：见 `docs/acceptance/stage6-audit-moderate-qs-q8mj-evidence.json`（advisory / package / vulnerable range / affected version / path / severity / transitive / prod / fixed / surface / mitigation / acceptance impact）。

##### HISTORICAL（Stage 6 窄 moderate 审计：`mysql2` GHSA-rgwj-5xj2-c3m3，`01ce778e` 之上；qs q8mj / qs 4mjr 见上方）

本轮相对 tip `01ce778eff59b26d85dd157b996c4b5a37fdf718`（#521 ACCEPT squash）对生产依赖审计做 **单条 moderate** 缓解：根直接依赖 `mysql2` 的 **GHSA-rgwj-5xj2-c3m3**（压缩 MySQL 协议处理中无界 zlib inflate → decompression-bomb DoS；受影响 `<=3.23.0`，路径 `.>mysql2` @ 3.22.5）。缓解：`package.json` `dependencies.mysql2` → `^3.23.1`，根 `pnpm.overrides.mysql2` → `3.23.1`。诚实性：3.22.5→3.23.1 为同 major 内 patch/minor bump；无同 pin 副作用清其他 moderate（本公告单点）；先前 yaml / file-type / markdown-it / fast-xml-parser(jp2q/gh4j) / hono(xgm2/8j4g/gqvv/hxh3) / @hono/node-server / dompurify(v9jr/hpcv/rp9w/cmwh/55q2) 单元格仍清除；metadata `moderate` 27→26、`low` 5；**退出码仍为 1**。本记录不是 EvidenceRow。本地 vitest 不是 Actions 行。回归 UNKNOWN。`stage8_eligible` 仍为 false。**不把 Stage 6 整体或产品写成 PASS**。不改写 §5.4 矩阵原文。正式 SBOM 与既有 moderate 窄缓解措辞不回退。

| 命令 | 退出码 | 备注 |
| --- | --- | --- |
| `pnpm audit --prod`（缓解后） | 1 | `31 vulnerabilities`；`5 low | 26 moderate`；**无** `GHSA-rgwj-5xj2-c3m3` / `mysql2` 公告 |
| `OPENBOT_TEST_PROFILE=low pnpm exec vitest run --config docs/acceptance/vitest.stage6-evidence.config.ts --maxWorkers 1 docs/acceptance/stage6-audit-moderate-mysql2-evidence.test.ts` | 0 | `Tests 3 passed`（字段表 JSON + dep+override pin + live audit 无该 GHSA 且 exit≠0） |

**单条公告字段表（§5.4）**：见 `docs/acceptance/stage6-audit-moderate-mysql2-evidence.json`（advisory / package / vulnerable range / affected version / path / severity / direct / prod / fixed / surface / mitigation / acceptance impact）。

##### HISTORICAL（Stage 6 窄 moderate 审计：`dompurify` GHSA-55q2-fjhq-7xh7，`4aea6530` 之上；mysql2 rgwj / qs q8mj 见上方）

本轮相对 tip `4aea653003cc635d1da3a3e7d7795950c9cb3896`（#513 ACCEPT squash）对生产依赖审计做 **单条 moderate** 缓解：`ui` 工作区直接依赖 `dompurify` 的 **GHSA-55q2-fjhq-7xh7**（`IN_PLACE` hook 移除后留下可执行的脱离子树 → XSS；受影响 `<=3.4.12`，路径 `ui>dompurify` @ 3.4.11）。缓解：`ui/package.json` `dependencies.dompurify` → `^3.4.13`，根 `pnpm.overrides.dompurify` → `3.4.13`。诚实性：3.4.11→3.4.13 为同 minor 内 patch bump；同一 pin 副作用清除更低阈值 low **GHSA-c2j3-45gr-mqc4**（CVE-2026-66010，需 `>=3.4.12`；不另开第二单元格）；仍残留需更高版本的 dompurify low（`>=3.4.16`：GHSA-6688-9rhm-gjv2 与适用于 3.4.13–3.4.15 的 GHSA-p98j-92pf-mc4p），不扩写；先前 GHSA-v9jr / GHSA-hpcv / GHSA-rp9w / GHSA-cmwh 与 `@hono/node-server` / hono 核心单元格仍清除；metadata `moderate` 28→27、`low` 5→5（清 c2j3、浮现 p98j）；**退出码仍为 1**。本记录不是 EvidenceRow。本地 vitest 不是 Actions 行。回归 UNKNOWN。`stage8_eligible` 仍为 false。**不把 Stage 6 整体或产品写成 PASS**。不改写 §5.4 矩阵原文。正式 SBOM 与 yaml / file-type / markdown-it / fast-xml-parser(jp2q/gh4j) / hono(xgm2/8j4g/gqvv/hxh3) / @hono/node-server(frvp/92pp) / dompurify(v9jr/hpcv/rp9w/cmwh) moderate 窄缓解措辞不回退。

| 命令 | 退出码 | 备注 |
| --- | --- | --- |
| `pnpm audit --prod`（缓解后） | 1 | `32 vulnerabilities`；`5 low | 27 moderate`；**无** `GHSA-55q2-fjhq-7xh7` / `GHSA-c2j3-45gr-mqc4` |
| `OPENBOT_TEST_PROFILE=low pnpm exec vitest run --config docs/acceptance/vitest.stage6-evidence.config.ts --maxWorkers 1`（55q2 + cmwh + rp9w + hpcv + v9jr） | 0 | `Tests 15 passed`（5 files；字段表 JSON + ui+override pin≥3.4.13 + live audit 无 55q2 且 exit≠0；先验证据已允许 3.4.13 并去掉 55q2 残留断言） |

**单条公告字段表（§5.4）**：见 `docs/acceptance/stage6-audit-moderate-dompurify-55q2-evidence.json`（advisory / package / vulnerable range / affected version / path / severity / direct(ui) / prod / fixed / surface / mitigation / acceptance impact）。

##### HISTORICAL（Stage 6 窄 moderate 审计：`dompurify` GHSA-cmwh-pvxp-8882，`4aea6530` squash / tip `dd459a00` 之上；55q2 见上方 CURRENT）


本轮相对 tip `dd459a004b091bcc2bdec581816862a4ee1215f0`（#511 ACCEPT squash）对生产依赖审计做 **单条 moderate** 缓解：`ui` 工作区直接依赖 `dompurify` 的 **GHSA-cmwh-pvxp-8882**（CVE-2026-65898，`setConfig()` 经 hook clone-guard 旁路导致永久 `ALLOWED_ATTR` 污染——3.4.7 hook-pollution 修复不完整；受影响 `<=3.4.10`，路径 `ui>dompurify` @ 3.4.7）。缓解：`ui/package.json` `dependencies.dompurify` → `^3.4.11`，根 `pnpm.overrides.dompurify` → `3.4.11`。诚实性：3.4.7→3.4.11 为同 minor 内 patch bump；同一 pin 副作用清除更低阈值 low **GHSA-vxr8-fq34-vvx9**（CVE-2026-65899，需 `>=3.4.9`）与 low **GHSA-gvmj-g25r-r7wr**（CVE-2026-65900，需 `>=3.4.8`；不另开第二/第三单元格）；仍残留需更高版本的 dompurify moderate（`>=3.4.13` GHSA-55q2）与 low，不扩写；先前 GHSA-v9jr / GHSA-hpcv / GHSA-rp9w 与 `@hono/node-server` / hono 核心单元格仍清除；metadata `moderate` 29→28、`low` 7→5；**退出码仍为 1**。本记录不是 EvidenceRow。本地 vitest 不是 Actions 行。回归 UNKNOWN。`stage8_eligible` 仍为 false。**不把 Stage 6 整体或产品写成 PASS**。不改写 §5.4 矩阵原文。正式 SBOM 与 yaml / file-type / markdown-it / fast-xml-parser(jp2q/gh4j) / hono(xgm2/8j4g/gqvv/hxh3) / @hono/node-server(frvp/92pp) / dompurify(v9jr/hpcv/rp9w) moderate 窄缓解措辞不回退。

| 命令 | 退出码 | 备注 |
| --- | --- | --- |
| `pnpm audit --prod`（缓解后） | 1 | `33 vulnerabilities`；`5 low | 28 moderate`；**无** `GHSA-cmwh-pvxp-8882` / `GHSA-vxr8-fq34-vvx9` / `GHSA-gvmj-g25r-r7wr` |
| `OPENBOT_TEST_PROFILE=low pnpm exec vitest run --config docs/acceptance/vitest.stage6-evidence.config.ts --maxWorkers 1`（cmwh + rp9w + hpcv + v9jr） | 0 | `Tests 12 passed`（4 files；字段表 JSON + ui+override pin≥3.4.11 + live audit 无 cmwh 且 exit≠0；更高阈值 GHSA-55q2 仍在；先验证据已允许 3.4.11） |

**单条公告字段表（§5.4）**：见 `docs/acceptance/stage6-audit-moderate-dompurify-cmwh-evidence.json`（advisory / package / vulnerable range / affected version / path / severity / direct(ui) / prod / fixed / surface / mitigation / acceptance impact）。

##### HISTORICAL（Stage 6 窄 moderate 审计：`dompurify` GHSA-rp9w-3fw7-7cwq，`89e04f55` 之上；cmwh/55q2 见上方）


本轮相对 tip `89e04f557dd431154f659d3e93aad98e7f87b310`（#510 ACCEPT squash）对生产依赖审计做 **单条 moderate** 缓解：`ui` 工作区直接依赖 `dompurify` 的 **GHSA-rp9w-3fw7-7cwq**（CVE-2026-49978，`IN_PLACE` 跳过挂在 `<template>.content` 内 shadow root 的内容，留下可执行标记；受影响 `<=3.4.6`，路径 `ui>dompurify` @ 3.4.6）。缓解：`ui/package.json` `dependencies.dompurify` → `^3.4.7`，根 `pnpm.overrides.dompurify` → `3.4.7`。诚实性：3.4.6→3.4.7 为同 minor 内 patch bump；同一 pin 副作用清除同阈值 moderate **GHSA-76mc-f452-cxcm**（CVE-2026-65902，亦需 `>=3.4.7`）与 low **GHSA-x4vx-rjvf-j5p4**（受影响 `<=3.4.6`；不另开第二/第三单元格）；仍残留需更高版本的 dompurify moderate（`>=3.4.11` / `>=3.4.13`）与 low，不扩写；先前 GHSA-v9jr / GHSA-hpcv 与 `@hono/node-server` / hono 核心单元格仍清除；metadata `moderate` 31→29、`low` 8→7；**退出码仍为 1**。本记录不是 EvidenceRow。本地 vitest 不是 Actions 行。回归 UNKNOWN。`stage8_eligible` 仍为 false。**不把 Stage 6 整体或产品写成 PASS**。不改写 §5.4 矩阵原文。正式 SBOM 与 yaml / file-type / markdown-it / fast-xml-parser(jp2q/gh4j) / hono(xgm2/8j4g/gqvv/hxh3) / @hono/node-server(frvp/92pp) / dompurify(v9jr/hpcv) moderate 窄缓解措辞不回退。

| 命令 | 退出码 | 备注 |
| --- | --- | --- |
| `pnpm audit --prod`（缓解后） | 1 | `36 vulnerabilities`；`7 low | 29 moderate`；**无** `GHSA-rp9w-3fw7-7cwq` / `GHSA-76mc-f452-cxcm` / `GHSA-x4vx-rjvf-j5p4` |
| `OPENBOT_TEST_PROFILE=low pnpm exec vitest run --config docs/acceptance/vitest.stage6-evidence.config.ts --maxWorkers 1 docs/acceptance/stage6-audit-moderate-dompurify-rp9w-evidence.test.ts` | 0 | `Tests 3 passed`（字段表 JSON + ui+override pin + live audit 无该 GHSA 且 exit≠0；更高阈值 dompurify 仍在） |

**单条公告字段表（§5.4）**：见 `docs/acceptance/stage6-audit-moderate-dompurify-rp9w-evidence.json`（advisory / package / vulnerable range / affected version / path / severity / direct(ui) / prod / fixed / surface / mitigation / acceptance impact）。

##### HISTORICAL（Stage 6 窄 moderate 审计：`dompurify` GHSA-hpcv-96wg-7vj8，`bfdeede2` 之上；rp9w/cmwh 见上方）


本轮相对 tip `bfdeede289d57e9b50c3e055cddd5ce1b31ddd3b`（#508 ACCEPT squash）对生产依赖审计做 **单条 moderate** 缓解：`ui` 工作区直接依赖 `dompurify` 的 **GHSA-hpcv-96wg-7vj8**（CVE-2026-49458，跨 realm 的 `IN_PLACE` 消毒经 realm 绑定的 `instanceof` 检查留下可执行标记；受影响 `<=3.4.5`，路径 `ui>dompurify` @ 3.4.0）。缓解：`ui/package.json` `dependencies.dompurify` → `^3.4.6`，根 `pnpm.overrides.dompurify` → `3.4.6`。诚实性：3.4.0→3.4.6 为同 minor 内 patch bump；同一 pin 副作用清除同阈值 **GHSA-r47g-fvhr-h676**（CVE-2026-49459，亦需 `>=3.4.6`；不另开第二单元格）；仍残留需更高版本的 dompurify moderate（`>=3.4.7` / `>=3.4.11` / `>=3.4.13`）与 low，不扩写；先前 GHSA-v9jr 首针与 `@hono/node-server` / hono 核心单元格仍清除；metadata `moderate` 33→31、`low` 8；**退出码仍为 1**。本记录不是 EvidenceRow。本地 vitest 不是 Actions 行。回归 UNKNOWN。`stage8_eligible` 仍为 false。**不把 Stage 6 整体或产品写成 PASS**。不改写 §5.4 矩阵原文。正式 SBOM 与 yaml / file-type / markdown-it / fast-xml-parser(jp2q/gh4j) / hono(xgm2/8j4g/gqvv/hxh3) / @hono/node-server(frvp/92pp) / dompurify(v9jr) moderate 窄缓解措辞不回退。

| 命令 | 退出码 | 备注 |
| --- | --- | --- |
| `pnpm audit --prod`（缓解后） | 1 | `39 vulnerabilities`；`8 low | 31 moderate`；**无** `GHSA-hpcv-96wg-7vj8` / `GHSA-r47g-fvhr-h676` |
| `OPENBOT_TEST_PROFILE=low pnpm exec vitest run --config docs/acceptance/vitest.stage6-evidence.config.ts --maxWorkers 1 docs/acceptance/stage6-audit-moderate-dompurify-hpcv-evidence.test.ts` | 0 | `Tests 3 passed`（字段表 JSON + ui+override pin + live audit 无该 GHSA 且 exit≠0；更高阈值 dompurify 仍在） |

**单条公告字段表（§5.4）**：见 `docs/acceptance/stage6-audit-moderate-dompurify-hpcv-evidence.json`（advisory / package / vulnerable range / affected version / path / severity / direct(ui) / prod / fixed / surface / mitigation / acceptance impact）。

##### HISTORICAL（Stage 6 窄 moderate 审计：`dompurify` GHSA-v9jr-rg53-9pgp，`eed0505e` 之上；hpcv 见上方 HISTORICAL）

本轮相对 tip `eed0505e209f3e43ed20ebcb61cd71ec51b520af`（#507 ACCEPT squash）对生产依赖审计做 **单条 moderate** 缓解：`ui` 工作区直接依赖 `dompurify` 的 **GHSA-v9jr-rg53-9pgp**（CVE-2026-41238，经 `CUSTOM_ELEMENT_HANDLING` 回退的原型污染→XSS 旁路；受影响 `>=3.0.1 <3.4.0`，路径 `ui>dompurify` @ 3.3.2）。缓解：`ui/package.json` `dependencies.dompurify` → `^3.4.0`，根 `pnpm.overrides.dompurify` → `3.4.0`。诚实性：3.3.2→3.4.0 为 minor bump；同一 pin 副作用清除同阈值 **GHSA-39q2-94rc-95cp**、**GHSA-crv5-9vww-q3g8**、**GHSA-h7mw-gpvr-xq4m**（均需 `>=3.4.0`；不另开第二/第三/第四单元格）；仍残留需更高版本的 dompurify moderate（`>=3.4.6` / `>=3.4.7` / `>=3.4.11` / `>=3.4.13`）与 low，不扩写；先前 `@hono/node-server` / hono 核心单元格仍清除；metadata `moderate` 37→33、`low` 8；**退出码仍为 1**。本记录不是 EvidenceRow。本地 vitest 不是 Actions 行。回归 UNKNOWN。`stage8_eligible` 仍为 false。**不把 Stage 6 整体或产品写成 PASS**。不改写 §5.4 矩阵原文。正式 SBOM 与 yaml / file-type / markdown-it / fast-xml-parser(jp2q/gh4j) / hono(xgm2/8j4g/gqvv/hxh3) / @hono/node-server(frvp/92pp) moderate 窄缓解措辞不回退。

| 命令 | 退出码 | 备注 |
| --- | --- | --- |
| `pnpm audit --prod`（缓解后） | 1 | `41 vulnerabilities`；`8 low | 33 moderate`；**无** `GHSA-v9jr-rg53-9pgp` / `GHSA-39q2-94rc-95cp` / `GHSA-crv5-9vww-q3g8` / `GHSA-h7mw-gpvr-xq4m` |
| `OPENBOT_TEST_PROFILE=low pnpm exec vitest run --config docs/acceptance/vitest.stage6-evidence.config.ts --maxWorkers 1 docs/acceptance/stage6-audit-moderate-dompurify-evidence.test.ts` | 0 | `Tests 3 passed`（字段表 JSON + ui+override pin + live audit 无该 GHSA 且 exit≠0；更高阈值 dompurify 仍在） |

**单条公告字段表（§5.4）**：见 `docs/acceptance/stage6-audit-moderate-dompurify-evidence.json`（advisory / package / vulnerable range / affected version / path / severity / direct(ui) / prod / fixed / surface / mitigation / acceptance impact）。

##### HISTORICAL（Stage 6 窄 moderate 审计：`@hono/node-server` GHSA-frvp + GHSA-92pp，`ffdef314` 之上；dompurify 见上方）


本轮相对 tip `ffdef314ad532f0f4e35bcdf2667b54574e3842d`（#506 ACCEPT squash）对生产依赖审计做 **`@hono/node-server` 单 pin** 缓解（用户排序优先：一次 pin 清掉该包剩余两条 moderate）：传递依赖路径 `.>@buape/carbon>@hono/node-server` @ 1.19.10。**主单元格 GHSA-frvp-7c67-39w9**（Windows `serve-static` 经编码反斜杠 `%5C` 的路径穿越 / 前缀中间件旁路；受影响 `<1.19.15`，无 CVE 别名于 audit JSON）。**同 pin 有意共清 GHSA-92pp-h63x-v22m**（CVE-2026-39406，`serveStatic` 重复斜杠 `//` 中间件旁路；受影响 `<1.19.13`）。缓解：`pnpm.overrides.@hono/node-server` → `1.19.15`（非根直接依赖，仅 override）。诚实性：1.19.10→1.19.15 同 minor patch bump；不扩写 `dompurify` 等多条剩余 moderate。本地 `pnpm audit --prod` 后两条 GHSA 均消失；先前 hono 核心单元格在 `hono@4.13.7` 下仍清除；metadata `moderate` 39→37、`low` 8；**退出码仍为 1**。本记录不是 EvidenceRow。本地 vitest 不是 Actions 行。回归 UNKNOWN。`stage8_eligible` 仍为 false。**不把 Stage 6 整体或产品写成 PASS**。不改写 §5.4 矩阵原文。正式 SBOM 与 yaml / file-type / markdown-it / fast-xml-parser(jp2q/gh4j) / hono(xgm2/8j4g/gqvv/hxh3) moderate 窄缓解措辞不回退。

| 命令 | 退出码 | 备注 |
| --- | --- | --- |
| `pnpm audit --prod`（缓解后） | 1 | `45 vulnerabilities`；`8 low | 37 moderate`；**无** `GHSA-frvp-7c67-39w9` / `GHSA-92pp-h63x-v22m` |
| `OPENBOT_TEST_PROFILE=low pnpm exec vitest run --config docs/acceptance/vitest.stage6-evidence.config.ts --maxWorkers 1 docs/acceptance/stage6-audit-moderate-hono-node-server-evidence.test.ts` | 0 | `Tests 3 passed`（字段表 JSON + override pin + live audit 无两条 GHSA 且 exit≠0） |

**公告字段表（§5.4）**：见 `docs/acceptance/stage6-audit-moderate-hono-node-server-evidence.json`（主 advisory GHSA-frvp + sibling GHSA-92pp / package / vulnerable range / affected version / path / severity / transitive / prod / fixed / surface / mitigation / acceptance impact）。

##### HISTORICAL（Stage 6 窄 moderate 审计：`hono` GHSA-hxh3-vqpv-xpqv，`0d48b3d6` 之上；dompurify 见上方 CURRENT）


本轮相对 tip `0d48b3d68d4e56d14e2c8b6230c99bddeaf66a3a`（#505 ACCEPT squash）对生产依赖审计做 **单条 moderate** 缓解：直接依赖 `hono` 的 **GHSA-hxh3-vqpv-xpqv**（CVE-2026-93981，`hono/jsx` SSR 对 Suspense / ErrorBoundary / Context.Provider / `renderToString` 等路径上的纯字符串未做 HTML 转义；受影响 `<4.13.7`，路径 `.>hono` @ 4.13.5）。缓解：`dependencies.hono` → `4.13.7`，`pnpm.overrides.hono` → `4.13.7`。诚实性：同 minor 内 patch bump；本仓无 `from 'hono'` 直接引用观测到，仍保留为直接 prod 依赖 / override。本地 `pnpm audit --prod` 后该 GHSA 消失；先前 hono 单元格（xgm2 / 8j4g / gqvv 及其 pin 副作用）在同一 pin 下仍清除；不扩写 `@hono/node-server` / `dompurify` 等剩余 moderate；metadata `moderate` 40→39、`low` 8；**退出码仍为 1**。本记录不是 EvidenceRow。本地 vitest 不是 Actions 行。回归 UNKNOWN。`stage8_eligible` 仍为 false。**不把 Stage 6 整体或产品写成 PASS**。不改写 §5.4 矩阵原文。正式 SBOM 与 yaml / file-type / markdown-it / fast-xml-parser(jp2q/gh4j) / hono(xgm2/8j4g/gqvv) moderate 窄缓解措辞不回退。

| 命令 | 退出码 | 备注 |
| --- | --- | --- |
| `pnpm audit --prod`（缓解后） | 1 | `47 vulnerabilities`；`8 low | 39 moderate`；**无** `GHSA-hxh3-vqpv-xpqv` |
| `OPENBOT_TEST_PROFILE=low pnpm exec vitest run --config docs/acceptance/vitest.stage6-evidence.config.ts --maxWorkers 1 docs/acceptance/stage6-audit-moderate-hono-hxh3-evidence.test.ts` | 0 | `Tests 3 passed`（字段表 JSON + package pin + live audit 无该 GHSA 且 exit≠0） |

**单条公告字段表（§5.4）**：见 `docs/acceptance/stage6-audit-moderate-hono-hxh3-evidence.json`（advisory / package / vulnerable range / affected version / path / severity / direct / prod / fixed / surface / mitigation / acceptance impact）。

##### HISTORICAL（Stage 6 窄 moderate 审计：`hono` GHSA-gqvv-2mrq-wpjv，`d2bb678d` 之上；hono GHSA-hxh3 / @hono/node-server 见上方）


本轮相对 tip `d2bb678dff1d5fa0e2c0686f7a7d0e4d7d674d1c`（#504 ACCEPT squash）对生产依赖审计做 **单条 moderate** 缓解：直接依赖 `hono` 的 **GHSA-gqvv-2mrq-wpjv**（CVE-2026-84365，`toSSG()` 路径穿越修复不完整；受影响 `<4.13.5`，路径 `.>hono` @ 4.12.34）。缓解：`dependencies.hono` → `4.13.5`，`pnpm.overrides.hono` → `4.13.5`。诚实性：4.12→4.13 为 minor bump；本仓无 `from 'hono'` 直接引用观测到，仍保留为直接 prod 依赖 / override。本地 `pnpm audit --prod` 后该 GHSA 消失；同一 pin 副作用清除 **GHSA-g6gw-c38x-mqfc** 与 **GHSA-crvj-82cr-hjcx**（不另开第二/第三单元格）；仍残留需 `>=4.13.7` 的 **GHSA-hxh3-vqpv-xpqv**，不扩写；metadata `moderate` 43→40、`low` 8；**退出码仍为 1**。本记录不是 EvidenceRow。本地 vitest 不是 Actions 行。回归 UNKNOWN。`stage8_eligible` 仍为 false。**不把 Stage 6 整体或产品写成 PASS**。不改写 §5.4 矩阵原文。正式 SBOM 与 yaml / file-type / markdown-it / fast-xml-parser(jp2q/gh4j) / hono(xgm2/8j4g) moderate 窄缓解措辞不回退。

| 命令 | 退出码 | 备注 |
| --- | --- | --- |
| `pnpm audit --prod`（缓解后） | 1 | `48 vulnerabilities`；`8 low | 40 moderate`；**无** `GHSA-gqvv-2mrq-wpjv`（亦无 `GHSA-g6gw-c38x-mqfc` / `GHSA-crvj-82cr-hjcx`；仍有 `GHSA-hxh3-vqpv-xpqv`） |
| `OPENBOT_TEST_PROFILE=low pnpm exec vitest run --config docs/acceptance/vitest.stage6-evidence.config.ts --maxWorkers 1 docs/acceptance/stage6-audit-moderate-hono-gqvv-evidence.test.ts` | 0 | `Tests 3 passed`（字段表 JSON + package pin + live audit 无该 GHSA 且 exit≠0） |

**单条公告字段表（§5.4）**：见 `docs/acceptance/stage6-audit-moderate-hono-gqvv-evidence.json`（advisory / package / vulnerable range / affected version / path / severity / direct / prod / fixed / surface / mitigation / acceptance impact）。

##### HISTORICAL（Stage 6 窄 moderate 审计：`hono` GHSA-8j4g-w8fx-2239，`753c216c` 之上；hono GHSA-gqvv / GHSA-hxh3 见上方）

本轮相对 tip `753c216c17b7a2f4413d842ae96dcbf475360cd1`（#503 ACCEPT squash）对生产依赖审计做 **单条 moderate** 缓解：直接依赖 `hono` 的 **GHSA-8j4g-w8fx-2239**（CVE-2026-69207，CORS middleware 经 `Access-Control-Request-Headers` 的 ReDoS；受影响 `<4.12.34`，路径 `.>hono` @ 4.12.27）。缓解：`dependencies.hono` → `4.12.34`，`pnpm.overrides.hono` → `4.12.34`。本地 `pnpm audit --prod` 后该 GHSA 消失；同一 pin 副作用清除 **GHSA-f23p-vx2j-j53r**、**GHSA-54fx-42gc-7vw4** 与 low **GHSA-79qm-7rj5-m7r9**（不另开第二/第三/第四单元格）；仍残留需更高版本的 hono 公告（`>=4.13.5` / `>=4.13.7`），不扩写；metadata `moderate` 46→43、`low` 9→8；**退出码仍为 1**。本记录不是 EvidenceRow。本地 vitest 不是 Actions 行。回归 UNKNOWN。`stage8_eligible` 仍为 false。**不把 Stage 6 整体或产品写成 PASS**。不改写 §5.4 矩阵原文。正式 SBOM 与 yaml / file-type / markdown-it / fast-xml-parser(jp2q/gh4j) / hono(xgm2) moderate 窄缓解措辞不回退。

| 命令 | 退出码 | 备注 |
| --- | --- | --- |
| `pnpm audit --prod`（缓解后） | 1 | `51 vulnerabilities`；`8 low | 43 moderate`；**无** `GHSA-8j4g-w8fx-2239`（亦无 `GHSA-f23p-vx2j-j53r` / `GHSA-54fx-42gc-7vw4` / `GHSA-79qm-7rj5-m7r9`） |
| `OPENBOT_TEST_PROFILE=low pnpm exec vitest run --config docs/acceptance/vitest.stage6-evidence.config.ts --maxWorkers 1 docs/acceptance/stage6-audit-moderate-hono-8j4g-evidence.test.ts` | 0 | `Tests 3 passed`（字段表 JSON + package pin + live audit 无该 GHSA 且 exit≠0） |

**单条公告字段表（§5.4）**：见 `docs/acceptance/stage6-audit-moderate-hono-8j4g-evidence.json`（advisory / package / vulnerable range / affected version / path / severity / direct / prod / fixed / surface / mitigation / acceptance impact）。

##### HISTORICAL（Stage 6 窄 moderate 审计：`hono` GHSA-xgm2-5f3f-mvvc，`94784af5` 之上；hono GHSA-8j4g / GHSA-gqvv / GHSA-hxh3 见上方）

本轮相对 tip `94784af584db325f06b983000017db61aff222dd`（#502 ACCEPT squash）对生产依赖审计做 **单条 moderate** 缓解：直接依赖 `hono` 的 **GHSA-xgm2-5f3f-mvvc**（CVE-2026-59897，AWS API Gateway v1 adapter 对重复请求头做去重时可能丢掉作为另一值子串的独立值；受影响 `>=4.3.3 <4.12.27`，路径 `.>hono` @ 4.12.25）。缓解：`dependencies.hono` → `4.12.27`，`pnpm.overrides.hono` → `4.12.27`。本地 `pnpm audit --prod` 后该 GHSA 消失；同一 pin 副作用清除 **GHSA-hvrm-45r6-mjfj** 与 **GHSA-w62v-xxxg-mg59**（不另开第二/第三单元格）；仍残留需更高版本的 hono 公告（如 `>=4.12.34` / `>=4.13.5` / `>=4.13.7`），不扩写；metadata `moderate` 49→46、`low` 9；**退出码仍为 1**。本记录不是 EvidenceRow。本地 vitest 不是 Actions 行。回归 UNKNOWN。`stage8_eligible` 仍为 false。**不把 Stage 6 整体或产品写成 PASS**。不改写 §5.4 矩阵原文。正式 SBOM 与 yaml / file-type / markdown-it / fast-xml-parser(jp2q/gh4j) moderate 窄缓解措辞不回退。

| 命令 | 退出码 | 摘要 |
| --- | --- | --- |
| `pnpm audit --prod`（缓解后） | 1 | `55 vulnerabilities`；`9 low | 46 moderate`；**无** `GHSA-xgm2-5f3f-mvvc`（亦无 `GHSA-hvrm-45r6-mjfj` / `GHSA-w62v-xxxg-mg59`） |
| `OPENBOT_TEST_PROFILE=low pnpm exec vitest run --config docs/acceptance/vitest.stage6-evidence.config.ts --maxWorkers 1 docs/acceptance/stage6-audit-moderate-hono-evidence.test.ts` | 0 | `Tests 3 passed`（字段表 JSON + package pin + live audit 无该 GHSA 且 exit≠0） |

**单条公告字段表（§5.4）**：见 `docs/acceptance/stage6-audit-moderate-hono-evidence.json`（advisory / package / vulnerable range / affected version / path / severity / direct / prod / fixed / surface / mitigation / acceptance impact）。

**验收影响**：该 moderate 单元格为 **窄缓解（E3）**。Stage 6 总结论仍 **不是 PASS**（其余 46 moderate + 9 low 仍使 audit 失败；无 Actions 全门禁重跑；不得用条数合计写成 BASELINE_UNCHANGED）。

##### HISTORICAL（Stage 6 窄 moderate 审计：`fast-xml-parser` GHSA-gh4j-gqv2-49f6，`4f321f55` 之上；hono GHSA-8j4g 见上方 CURRENT）

本轮相对 tip `4f321f5584218fc3a6a85398421f20eaab97b055`（#501 ACCEPT squash）对生产依赖审计做 **单条 moderate** 缓解：直接依赖 `fast-xml-parser` 的 **GHSA-gh4j-gqv2-49f6**（CVE-2026-41650，XMLBuilder 注释/`CDATA` 分隔符未转义注入；受影响 `<5.7.0`，路径 `.>fast-xml-parser` @ 5.5.7）。缓解：`dependencies.fast-xml-parser` → `^5.7.0`，`pnpm.overrides.fast-xml-parser` → `5.7.0`。本地 `pnpm audit --prod` 后该 GHSA 消失；同包 **GHSA-jp2q-39xq-3w4g** 在同一 pin 下继续保持清除（既有 HISTORICAL 单元格，不扩写）；metadata `moderate` 50→49、`low` 9；**退出码仍为 1**。本记录不是 EvidenceRow。本地 vitest 不是 Actions 行。回归 UNKNOWN。`stage8_eligible` 仍为 false。**不把 Stage 6 整体或产品写成 PASS**。不改写 §5.4 矩阵原文。正式 SBOM 与 yaml / file-type / markdown-it / fast-xml-parser(jp2q) moderate 窄缓解措辞不回退。

| 命令 | 退出码 | 摘要 |
| --- | --- | --- |
| `pnpm audit --prod`（缓解后） | 1 | `58 vulnerabilities`；`9 low \| 49 moderate`；**无** `GHSA-gh4j-gqv2-49f6`（亦无 `GHSA-jp2q-39xq-3w4g`） |
| `OPENBOT_TEST_PROFILE=low pnpm exec vitest run --config docs/acceptance/vitest.stage6-evidence.config.ts --maxWorkers 1 docs/acceptance/stage6-audit-moderate-fast-xml-parser-gh4j-evidence.test.ts` | 0 | `Tests 3 passed`（字段表 JSON + package pin + live audit 无该 GHSA 且 exit≠0） |

**单条公告字段表（§5.4）**：见 `docs/acceptance/stage6-audit-moderate-fast-xml-parser-gh4j-evidence.json`（advisory / package / vulnerable range / affected version / path / severity / direct / prod / fixed / surface / mitigation / acceptance impact）。

**验收影响**：该 moderate 单元格为 **窄缓解（E3）**。Stage 6 总结论仍 **不是 PASS**（其余 49 moderate + 9 low 仍使 audit 失败；无 Actions 全门禁重跑；不得用条数合计写成 BASELINE_UNCHANGED）。

##### HISTORICAL（Stage 6 窄 moderate 审计：`fast-xml-parser` GHSA-jp2q-39xq-3w4g，`d222c8f7` 之上；GHSA-gh4j 见上方 CURRENT）

本轮相对 tip `d222c8f757fccdea3a50d5924b09d056cf1d714c`（#500 ACCEPT squash）对生产依赖审计做 **单条 moderate** 缓解：直接依赖 `fast-xml-parser` 的 **GHSA-jp2q-39xq-3w4g**（CVE-2026-33349，`maxEntityCount`/`maxEntitySize` 设为 0 时因 falsy 判断被绕过；受影响 `>=5.0.0 <5.5.7`，路径 `.>fast-xml-parser` @ 5.5.6）。缓解：`dependencies.fast-xml-parser` → `^5.5.7`，`pnpm.overrides.fast-xml-parser` → `5.5.7`。本地 `pnpm audit --prod` 后该 GHSA 消失；同包 **GHSA-gh4j-gqv2-49f6**（需 `>=5.7.0`）仍在，不扩成第二单元格；metadata `moderate` 51→50、`low` 9；**退出码仍为 1**。本记录不是 EvidenceRow。本地 vitest 不是 Actions 行。回归 UNKNOWN。`stage8_eligible` 仍为 false。**不把 Stage 6 整体或产品写成 PASS**。不改写 §5.4 矩阵原文。正式 SBOM 与 yaml / file-type / markdown-it moderate 窄缓解措辞不回退。

| 命令 | 退出码 | 结果摘要 |
| ---- | ------ | -------- |
| `pnpm audit --prod`（缓解后） | 1 | `59 vulnerabilities`；`9 low \| 50 moderate`；**无** `GHSA-jp2q-39xq-3w4g`（仍有 `GHSA-gh4j-gqv2-49f6`） |
| `OPENBOT_TEST_PROFILE=low pnpm exec vitest run --config docs/acceptance/vitest.stage6-evidence.config.ts --maxWorkers 1 docs/acceptance/stage6-audit-moderate-fast-xml-parser-evidence.test.ts` | 0 | `Tests 3 passed`（字段表 JSON + package pin + live audit 无该 GHSA 且 exit≠0） |

**单条公告字段表（§5.4）**：见 `docs/acceptance/stage6-audit-moderate-fast-xml-parser-evidence.json`（advisory / package / vulnerable range / affected version / path / severity / direct / prod / fixed / surface / mitigation / acceptance impact）。

**验收影响**：该 moderate 单元格为 **窄缓解（E3）**。Stage 6 总结论仍 **不是 PASS**（其余 50 moderate + 9 low 仍使 audit 失败；无 Actions 全门禁重跑；不得用条数合计写成 BASELINE_UNCHANGED）。

##### HISTORICAL（Stage 6 窄 moderate 审计：`markdown-it` GHSA-253c-mchw-3w2r，`51ff1fc4` 之上；fast-xml-parser 见上方 CURRENT）

本轮相对 tip `51ff1fc44cbf96d2d05b14df0cb020cfb160b0be`（#499 ACCEPT squash）对生产依赖审计做 **单条 moderate** 缓解：直接依赖 `markdown-it` 的 **GHSA-253c-mchw-3w2r**（linkify: true 两条二次路径 DoS；受影响 `<14.3.1`，路径 `.>markdown-it` @ 14.1.1）。缓解：`dependencies.markdown-it` → `^14.3.2`，`pnpm.overrides.markdown-it` → `14.3.2`。本地 `pnpm audit --prod` 后该 GHSA 消失；同一 pin 副作用清除 **GHSA-6v5v-wf23-fmfq**（smartquotes；不另开第二单元格）；metadata `moderate` 53→51、`low` 9；**退出码仍为 1**。本记录不是 EvidenceRow。本地 vitest 不是 Actions 行。回归 UNKNOWN。`stage8_eligible` 仍为 false。**不把 Stage 6 整体或产品写成 PASS**。不改写 §5.4 矩阵原文。正式 SBOM 与 yaml / file-type moderate 窄缓解措辞不回退。

| 命令 | 退出码 | 结果摘要 |
| ---- | ------ | -------- |
| `pnpm audit --prod`（缓解后） | 1 | `60 vulnerabilities`；`9 low \| 51 moderate`；**无** `GHSA-253c-mchw-3w2r`（亦无 `GHSA-6v5v-wf23-fmfq`） |
| `OPENBOT_TEST_PROFILE=low pnpm exec vitest run --config docs/acceptance/vitest.stage6-evidence.config.ts --maxWorkers 1 docs/acceptance/stage6-audit-moderate-markdown-it-evidence.test.ts` | 0 | `Tests 3 passed`（字段表 JSON + package pin + live audit 无该 GHSA 且 exit≠0） |

**单条公告字段表（§5.4）**：见 `docs/acceptance/stage6-audit-moderate-markdown-it-evidence.json`（advisory / package / vulnerable range / affected version / path / severity / direct / prod / fixed / surface / mitigation / acceptance impact）。

**验收影响**：该 moderate 单元格为 **窄缓解（E3）**。Stage 6 总结论仍 **不是 PASS**（其余 51 moderate + 9 low 仍使 audit 失败；无 Actions 全门禁重跑；不得用条数合计写成 BASELINE_UNCHANGED）。

##### HISTORICAL（Stage 6 窄 moderate 审计：`file-type` GHSA-j47w-4g3g-c36v，`820f24e5` 之上；markdown-it / fast-xml-parser 见上方）

本轮相对 tip `820f24e585df68c6c6115b0ab272739d027c3f6b`（#498 ACCEPT squash）对生产依赖审计做 **单条 moderate** 缓解：直接依赖 `file-type` 的 **GHSA-j47w-4g3g-c36v**（CVE-2026-32630，ZIP 解压炸弹 / 已知大小输入绕过 inflate 上限；受影响 `>=20.0.0 <=21.3.1`，路径 `.>file-type` @ 21.3.1）。缓解：`dependencies.file-type` → `^21.3.2`，`pnpm.overrides.file-type` → `21.3.2`。本地 `pnpm audit --prod` 后该 GHSA 消失；metadata `moderate` 54→53、`low` 9；**退出码仍为 1**。本记录不是 EvidenceRow。本地 vitest 不是 Actions 行。回归 UNKNOWN。`stage8_eligible` 仍为 false。**不把 Stage 6 整体或产品写成 PASS**。不改写 §5.4 矩阵原文。正式 SBOM 与 yaml moderate 窄 PASS/缓解措辞不回退。

| 命令 | 退出码 | 结果摘要 |
| ---- | ------ | -------- |
| `pnpm audit --prod`（缓解后） | 1 | `62 vulnerabilities`；`9 low \| 53 moderate`；**无** `GHSA-j47w-4g3g-c36v` |
| `OPENBOT_TEST_PROFILE=low pnpm exec vitest run --config docs/acceptance/vitest.stage6-evidence.config.ts --maxWorkers 1 docs/acceptance/stage6-audit-moderate-filetype-evidence.test.ts` | 0 | `Tests 3 passed`（字段表 JSON + package pin + live audit 无该 GHSA 且 exit≠0） |

**单条公告字段表（§5.4）**：见 `docs/acceptance/stage6-audit-moderate-filetype-evidence.json`（advisory / package / vulnerable range / affected version / path / severity / direct / prod / fixed / surface / mitigation / acceptance impact）。

**验收影响**：该 moderate 单元格为 **窄缓解（E3）**。Stage 6 总结论仍 **不是 PASS**（其余 53 moderate + 9 low 仍使 audit 失败；无 Actions 全门禁重跑；不得用条数合计写成 BASELINE_UNCHANGED）。

##### HISTORICAL（Stage 6 窄 moderate 审计：`yaml` GHSA-48c2-rrv3-qjmp，`b309050e` 之上；file-type / markdown-it / fast-xml-parser 见上方）

本轮相对 tip `b309050e637a39ee468d65c536fcd505e4aecfd5`（#476 ACCEPT squash）对生产依赖审计做 **单条 moderate** 缓解：直接依赖 `yaml` 的 **GHSA-48c2-rrv3-qjmp**（CVE-2026-33532，栈溢出 / 深度嵌套集合；受影响 `>=2.0.0 <2.8.3`，路径 `.>yaml` @ 2.8.2）。缓解：`dependencies.yaml` → `^2.8.3`，`pnpm.overrides.yaml` → `2.8.3`。本地 `pnpm audit --prod` 后该 GHSA 消失；metadata `moderate` 50→49、`low` 9；**退出码仍为 1**。本记录不是 EvidenceRow。本地 vitest 不是 Actions 行。回归 UNKNOWN。`stage8_eligible` 仍为 false。**不把 Stage 6 整体或产品写成 PASS**。不改写 §5.4 矩阵原文。正式 SBOM 窄 PASS 措辞不回退。

| 命令 | 退出码 | 结果摘要 |
| ---- | ------ | -------- |
| `pnpm audit --prod`（缓解后） | 1 | `58 vulnerabilities`；`9 low \| 49 moderate`；**无** `GHSA-48c2-rrv3-qjmp` |
| `OPENBOT_TEST_PROFILE=low pnpm exec vitest run --config docs/acceptance/vitest.stage6-evidence.config.ts --maxWorkers 1 docs/acceptance/stage6-audit-moderate-evidence.test.ts` | 0 | `Tests 3 passed`（字段表 JSON + package pin + live audit 无该 GHSA 且 exit≠0） |

**单条公告字段表（§5.4）**：见 `docs/acceptance/stage6-audit-moderate-yaml-evidence.json`（advisory / package / vulnerable range / affected version / path / severity / direct / prod / fixed / surface / mitigation / acceptance impact）。

**验收影响**：该 moderate 单元格为 **窄缓解（E3）**。Stage 6 总结论仍 **不是 PASS**（其余 49 moderate + 9 low 仍使 audit 失败；无 Actions 全门禁重跑；不得用条数合计写成 BASELINE_UNCHANGED）。

##### HISTORICAL（接线前）

九个 `surface_id` 都有三行 `path_kind`。先前：console 表面 PASS；wecom/feishu negative 路径 E3 PASS，happy/observable FAIL；dingtalk 三行 E1+NOT_RUN；四设备三行 NOT_RUN（表面 FAIL）；doctor_onboard happy FAIL（onboard 未加载企业 IM）。该 HISTORICAL 结论不抄成当前。

##### CURRENT（Stage 7 跟进；DingTalk mock CONDITIONAL，`93748af0` 之上）

存在性或仅配置不能当 PASS。无设备不重编 → **NOT_RUN**（不是 NOT_COVERED，也不是 PASS）。企业 IM（wecom/feishu/**dingtalk**）happy/observable 用进程内插件入站 + **mock dispatch/outbound**（不打真实 HTTP、不进 Gateway WS）。相对 §5.7 矩阵原命题记 **CONDITIONAL**，不把矩阵改写成 mock 命题，也不记 PASS。Live DingTalk `sendText` / Client ID+Secret 仍 **NOT_RUN** / NEEDS_LIVE_CHANNEL。本记录不是 EvidenceRow。`stage8_eligible` 仍为 false。**不把 Stage 7 整体写成 PASS**。

历史+本轮命令：`OPENBOT_TEST_PROFILE=low pnpm exec vitest run --config docs/acceptance/vitest.stage7-evidence.config.ts --maxWorkers 1 docs/acceptance/stage7-surface-evidence.test.ts docs/acceptance/stage7-channel-doctor-evidence.test.ts docs/acceptance/stage7-channel-happy-evidence.test.ts` → Test Files 3 passed；Tests 9 passed（含 DingTalk happy）。

本轮移动端诚实探针（linux acceptance box）：`OPENBOT_TEST_PROFILE=low pnpm exec vitest run --config docs/acceptance/vitest.stage7-mobile-evidence.config.ts --maxWorkers 1 docs/acceptance/stage7-mobile-device-evidence.test.ts` → Test Files 1 passed；Tests 3 passed。探针断言：无 `xcodebuild`/JDK/`adb`/`ohpm`；`apps/{ios,android,macos,harmony}` 树存在；`openbot-ios`/`openbot-android`/`openbot-macos` client id 可规范化；**无** harmony client id。**不**因此把四设备表面抬成 PASS。

产品修复：`extensions/wecom` / `extensions/dingtalk` 新增 `onboarding` 适配器并挂到插件；`processWecomInbound` 导出供证据调用。本轮：`extensions/dingtalk/src/monitor.ts` 导出 `processDingtalkInbound`（进程内入站→路由→mock 可替换的 dispatch/outbound）；**未**接线真实 Stream/Webhook 传输。

| surface_id     | path_kind         | 置信度 | 该路径验收 | 本轮实际断言 |
| -------------- | ----------------- | ------ | ---------- | ------------ |
| console        | happy_path        | E3     | PASS       | 已授权 Control UI 打开渠道表面，`channels.status` 落到进程内 Gateway（jsdom；非设备浏览器） |
| console        | negative_path     | E3     | PASS       | 错误 token 拒绝，文案含 `gateway token mismatch` |
| console        | observable_result | E3     | PASS       | `renderOverview` `.callout.danger` 含 Gateway 原文，状态 `warn` |
| wecom          | happy_path        | E3     | CONDITIONAL | **相对 §5.7 矩阵原命题（需进 Gateway + 回复回企微）为 CONDITIONAL，不是 PASS。** 已证命题收窄为：进程内插件入站 `processWecomInbound` + mock `dispatchInboundReplyWithBase` / `sendWecomTextMessage`；**不是** Gateway WS；**不是** live cloud。`agentId=main` 来自 mock routing |
| wecom          | negative_path     | E3     | PASS       | 错误签名回调 401，`unauthorized`，入站回调未跑 |
| wecom          | observable_result | E3     | CONDITIONAL | 断言 mock 路径上 `agentId=main` 与出站 `to`/正文。相对矩阵「频道侧可见回复」为 CONDITIONAL（mock 出站，非 live）。仅 callback；websocket 未同跑。不改写 §5.7 矩阵原文 |
| feishu         | happy_path        | E3     | CONDITIONAL | **相对 §5.7 矩阵原命题（需进 Gateway + 回复回飞书）为 CONDITIONAL，不是 PASS。** 已证：进程内 `handleFeishuMessage` + mock `resolveAgentRoute` / reply dispatcher / send；**不是** Gateway WS；**不是** live cloud |
| feishu         | negative_path     | E3     | PASS       | webhook 无 `verificationToken` 抛错，监听未起 |
| feishu         | observable_result | E3     | CONDITIONAL | 断言 mock 路径上 `agentId=main` 与 reply dispatcher 调用。相对矩阵「频道侧可见回复」为 CONDITIONAL（mock 出站）。不改写 §5.7 矩阵原文 |
| dingtalk       | happy_path        | E3     | CONDITIONAL | **相对 §5.7 矩阵原命题（需进 Gateway + 回复回钉钉）为 CONDITIONAL，不是 PASS。** 已证：进程内 `processDingtalkInbound` + mock `dispatchInboundReplyWithBase` / `sendDingtalkMessage`；**不是** Gateway WS；**不是** live cloud / 真实 Client 凭证发网。`agentId=main` 来自 mock routing |
| dingtalk       | negative_path     | E3     | PASS       | `dingtalkPlugin.config.unconfiguredReason` 含 Client ID/Secret；`isConfigured(false)` 为 false（无网络） |
| dingtalk       | observable_result | E3     | CONDITIONAL | 断言 mock 路径上 `agentId=main` 与出站 `to`/正文。相对矩阵「频道侧可见回复」为 CONDITIONAL（mock 出站，非 live）。不改写 §5.7 矩阵原文 |
| ios            | happy_path        | E1 | NOT_RUN | **无设备池 / linux box 无 `xcodebuild`。** 不重编。Owner：platform/mobile。翻 PASS 需：已批准设备连 Gateway + client id 接受 + 一次节点往返（E3） |
| ios            | negative_path     | E1 | NOT_RUN | 同上；翻 PASS 需：未批准设备拿不到可用 device token（E3） |
| ios            | observable_result | E1 | NOT_RUN | 同上；翻 PASS 需：连接/调用结果出现在断言或设备日志 |
| android        | happy_path        | E1 | NOT_RUN | **无设备/模拟器池；acceptance box 无 JDK/`adb`。** 不重编。Owner：platform/mobile。翻 PASS 需：已批准设备连 Gateway + client id + 节点往返（E3）。`pnpm android:test` 单元测≠设备表面 |
| android        | negative_path     | E1 | NOT_RUN | 同上；翻 PASS 需：未批准设备无可用 token（E3） |
| android        | observable_result | E1 | NOT_RUN | 同上 |
| harmony        | happy_path        | E1 | NOT_RUN | **无 Harmony 设备/池；无 `ohpm`。** 另：`GATEWAY_CLIENT_IDS` **无** harmony 条目（E1 探针）。Owner：platform/mobile。翻 PASS 需：协议侧接受的 client id（若需要先补）+ 已批准设备往返（E3） |
| harmony        | negative_path     | E1 | NOT_RUN | 同上；翻 PASS 需：未批准设备无可用 token（E3） |
| harmony        | observable_result | E1 | NOT_RUN | 同上 |
| macos          | happy_path        | E1 | NOT_RUN | **linux box 无 macOS 宿主 / 无 `xcodebuild`。** `pnpm protocol:check` **不**代替设备往返。Owner：platform/mobile。翻 PASS 需：已批准 macOS app 连 Gateway + 节点往返（E3） |
| macos          | negative_path     | E1 | NOT_RUN | 同上；翻 PASS 需：未批准设备无可用 token（E3） |
| macos          | observable_result | E1 | NOT_RUN | 同上 |
| doctor_onboard | happy_path        | E3     | PASS       | doctor：legacy sessions preview 成立且未创建目标目录；onboard：注册 wecom/feishu/dingtalk 真实插件后 `listChannelOnboardingAdapters()` 含三者（产品 `plugin.onboarding`） |
| doctor_onboard | negative_path     | E3     | PASS       | `maybeRepairLegacyCronStore` 在 `confirm=false` 时不改写 `jobs.json` |
| doctor_onboard | observable_result | E3     | PASS       | preview 字符串与 cron 提示出现在断言/输出；临时状态目录存在 |

表面验收：

| surface_id     | acceptance_status | 为什么 |
| -------------- | ----------------- | ------ |
| console        | PASS              | 三行 E3。jsdom + 进程内 Gateway。非设备浏览器 |
| wecom          | CONDITIONAL       | negative PASS；happy/observable **CONDITIONAL**（进程内插件 + mock dispatch/outbound；非 Gateway；非 live）。§5.7 矩阵原文未改。websocket 未同跑 |
| feishu         | CONDITIONAL       | negative PASS；happy/observable **CONDITIONAL**（进程内插件 + mock outbound；非 Gateway；非 live）。§5.7 矩阵原文未改 |
| dingtalk       | CONDITIONAL       | negative PASS；happy/observable **CONDITIONAL**（进程内 `processDingtalkInbound` + mock dispatch/outbound；非 Gateway；非 live）。§5.7 矩阵原文未改。真实 `sendText`/Client 凭证仍 NOT_RUN |
| ios            | FAIL              | 三行 NOT_RUN（无 iOS 设备/`xcodebuild`）。存在 `apps/ios` + `openbot-ios` client id **不**构成 PASS |
| android        | FAIL              | 三行 NOT_RUN（无设备/JDK/`adb`）。存在 `apps/android` + `openbot-android` **不**构成 PASS |
| harmony        | FAIL              | 三行 NOT_RUN（无设备/`ohpm`；协议无 harmony client id）。存在 `apps/harmony` **不**构成 PASS |
| macos          | FAIL              | 三行 NOT_RUN（无 macOS 宿主）。`protocol:check` ≠ 设备往返 |
| doctor_onboard | PASS              | 三行 E3。企业 IM 已在产品 onboarding 路径 |

Stage 7 总结论：console / doctor_onboard 表面 PASS。wecom / feishu / **dingtalk** 表面 **CONDITIONAL**（进程内 + mock；非 Gateway / 非 live）。**ios/android/harmony/macos** 表面仍 **FAIL**（各三行 path_kind 为 NOT_RUN：无设备池 / 工具链；harmony 另缺协议 client id）。阶段不是 PASS。`stage8_eligible` 仍为 false。不改写 §5.7 矩阵原文；不把目录存在或 client id 存在写成表面 PASS；不把 NOT_RUN 设备写成 PASS；不把 DingTalk mock 抬成 live PASS。

四设备翻转条件（Owner：platform/mobile）：每表面在真实/授权设备或模拟器上完成 happy（已批准连接+节点往返）+ negative（未批准无 token）+ observable（断言/日志），置信度 E3。

## 6. 实施阶段

评审会通过本方案并完成 Stage 0 之前，不开始后面的产品结论。批准本文只批准方法，不批准任何 Stage 0–8 的产品验收结论。阶段编号与 §4.1 相同。

| 阶段           | 入口                    | 工作                                                                                | 出口                                                         |
| -------------- | ----------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| 0 基线冻结     | 评审会纪要              | 重 pin `origin/main`；写下剖面或「未选定」；冻结范围、环境、证据规则、抽样          | 冻结单。未选定剖面时注明禁止产品安全结论                     |
| 1 信任边界     | 冻结单已选剖面          | §5.0 与 AUTH-01/02/03                                                               | 阶段结论四值之一。未选剖面则 NOT_COVERED                     |
| 2 架构         | Stage 0                 | §5.1                                                                                | 发现单，含置信度                                             |
| 3 API 契约     | Stage 0；安全结论不提前 | 矩阵与 API-01/02/03                                                                 | 负路径未测则不得 PASS                                        |
| 4 数据持久化   | Stage 0                 | 固定字段表（含 consistency）与 PERSIST-EP-01 至 05                                  | EP-05 无测试则不 PASS                                        |
| 5 可靠性 / HA  | Stage 0                 | 四问分开                                                                            | 生产未批准被写明                                             |
| 6 质量与供应链 | Stage 0                 | §4.4 两轴对比表、依赖字段表、`pnpm-audit-prod` 日志                                 | 回归合格不等于验收 PASS                                      |
| 7 产品表面     | Stage 0                 | §5.7 强制验收矩阵。每个 surface 必须有 happy_path、negative_path、observable_result | 缺一行，或只有存在性/配置证据，该表面 acceptance_status=FAIL |
| 8 结论         | 1–7 的复核              | 只引用 `stage8_eligible=true` 的 EvidenceRow。`HISTORICAL` 排除                     | P0 有第二人复核。Stage 0 未执行时不得宣称基线已冻结          |

### Stage 8 执行记录

本轮再次 `git fetch origin main`。打印值仍是 `a7bbaf6d14b40f138f677ff3c9c0a90e82de5ace`。第二复核接受账本之后，merge 提交 `44dec486760f68bb6ddf5a01ff9146deb6d16fd1` 把这份 main 合入。合入后 `git merge-base --is-ancestor origin/main HEAD` 退出码 0。合入前同一检查退出码 1。没有 rebase。`execution_baseline_sha` 仍钉成这一串。CURRENT 有 19 行，都是 pin 自检：`candidate_sha` 与 `execution_baseline_sha` 相同，回归是 `UNKNOWN`，不是 `BASELINE_UNCHANGED`。它们不是本 PR head 的候选 CI。六个 Windows 分片都已失败并写入 CURRENT。未抽日志的已完成 job 也不是行。HISTORICAL 行不进入本结论。

第二复核人是「代码仓盘点验收」。`product_conclusion` 是「盘点账本就绪」。`stage8_eligible=false`。不写产品 PASS。不关闭 P0。本代理不合入 `main`。产品结论仍不是 PASS。

Stage 8 字段（这不是 EvidenceRow，`stage8_eligible` 保持 false）：

| 字段                   | 值                                                                                                                                                                                                                                                     |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| product_conclusion     | 盘点账本就绪                                                                                                                                                                                                                                           |
| stage8_eligible        | false                                                                                                                                                                                                                                                  |
| second_reviewer        | 代码仓盘点验收                                                                                                                                                                                                                                         |
| current_rows           | 19。run `37661176029` 的 docs-scope / secrets / check-docs / protocol / check / node test / android test / windows 1 至 6；`37661175882` freeze；`37661176049` actionlint / no-tabs；`37661175957` delivery guard / check；`37661175759` install-smoke |
| execution_baseline_sha | `a7bbaf6d14b40f138f677ff3c9c0a90e82de5ace`                                                                                                                                                                                                             |
| ancestor_check         | 合入后退出码 0。合入前退出码 1。没有 rebase                                                                                                                                                                                                            |
| reason                 | 产品结论不是 PASS。遗留包括 Stage 2 其余 NOT_COVERED（真实 agent turn 等；transcript 写路径已窄 PASS）、Stage 3 超时已窄 PASS（含 agent pre-accept join）；API-02 畸形帧已窄 PASS；API-03 策略拒绝已窄 PASS；六列未满（WS 事件六列含 backward 已窄 PASS；CLI versioning/backward/idempotency/authz/errors 已窄 PASS；WS 请求 backward/authz 已窄 PASS；Plugin/SDK authz/schema/idempotency/errors 已窄 PASS；Plugin backward 仍开）、Stage 4 凭证备份排除与 backup create+verify 全链已窄 PASS、doctor 迁移 dry-run 已窄 PASS、租户 shard 已窄 PASS、单拍已窄 PASS、知识归档已窄 PASS（阶段仍非 PASS）、HA 部署接线 CONDITIONAL（opt-in `ha`；默认拓扑仍无 HA；无 release 镜像钉）与 Auto FO 未批准、DC NOT_RUN、正式 SBOM 窄 PASS、yaml / file-type / markdown-it / fast-xml-parser（jp2q + gh4j）moderate 已窄缓解（markdown-it pin 另清 GHSA-6v5v 副作用）、audit 仍退出码 1、Stage 7 wecom/feishu/dingtalk 表面 CONDITIONAL、四设备 FAIL（NOT_RUN；无设备/工具链；harmony 无 client id）。console/doctor_onboard 已 PASS。Stage 1 跨操作者 store/插件已窄闭合。pin 自检不是本 PR head。不得产品 PASS                                                |

可再交验的窄命题（不是阶段 PASS，也不是产品 PASS）：

1. Stage 1：S1-GATE-01 同判定；AUTH-01/02/03 窄 PASS；已认证客户端请求 ALS 下跨操作者 store/插件 `stateDir` 失败关闭（窄 PASS）。无身份连接仍是共享 `STATE_DIR` 遗留。`SECURITY.md` 已与行为对齐。
2. Stage 2：端口、控制台与 WebChat、三个产品频道、节点命令、技能来源与 `tools.catalog`、四条架构 lint 窄可交验。**聊天叶经 SessionManager.appendMessage 窄 PASS**；真实 agent turn 等仍 NOT_COVERED。阶段不是全面 PASS。
3. Stage 3：相同键加相同载荷、相同键加不同载荷（拒绝或 `details.status` 409）窄可交验。超时重试为 **窄 PASS（四方法，含 agent pre-accept join）**；API-02 为 **窄 PASS（WS 畸形帧断连/请求终止 + AJV）**；API-03 为 **窄 PASS（/tools/invoke 权威 deny + 企业 fail-closed 明确错误；shadow tenantCapabilities / live IdP / 全 webhook 仍开）**。`protocol:check` 窄 PASS。六列补 WS versioning / CLI schema / Plugin versioning E1，以及 WS 事件六列（含 backward）均窄 PASS、CLI versioning/backward/idempotency/authz/errors 窄 PASS、WS 请求 backward/authz 窄 PASS、Plugin/SDK authz/schema/idempotency/errors 窄 PASS；Plugin backward 仍 NOT_COVERED。阶段不是 PASS。
4. Stage 4：EP-01 至 EP-05 窄可交验。配置/会话/记忆/知识/客户 PG 只读/HA 交付/aspirational DDL 字段表已窄填；**凭证备份排除窄 PASS**；**backup create+verify 全链 E3 窄 PASS**；**doctor 迁移 dry-run/confirm 窄 PASS**；**租户 store shard 窄 PASS**；**pin 单拍运行时窄 PASS**；**知识索引归档还原窄 PASS**。doctor 全量 config 键 / 全 store shard 普查 / 多拍仍开。阶段不是 PASS。
5. Stage 5：双控制器在树、`mode=auto` 拒绝、默认 manual、生产批准为否；生产部署接线为 **CONDITIONAL**（opt-in profile `ha` artifact；默认仍无 HA）。不把 HA / Auto FO / 部署接线写成 PASS。DC NOT_RUN。
6. Stage 6：三条 critical 已 override。正式 SBOM（OWASP `@cyclonedx/cdxgen@12.8.5` → `sbom/openbot.cdx.json` + `pnpm sbom:cyclonedx`）窄 PASS。合入后本地 `pnpm audit --prod` metadata critical 为 0、high 为 0，退出码仍是 1（moderate/low），没有豁免表。`detect-private-key` 在本工作树退出码 0。阶段不是 PASS。
7. Stage 7：console/doctor_onboard PASS；wecom/feishu/dingtalk CONDITIONAL（mock；非 live）；ios/android/harmony/macos FAIL（三行 NOT_RUN；工具链/设备池缺口已探针；不抬 PASS）。阶段不是 PASS。

仍不能交成通过：

| 项                                                          | 状态                                                                                                                                                                                                                                                             |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stage 1 同网关跨操作者可读（已认证 ALS）                     | PASS（窄）                                                                                                                                                                                                                                                       |
| Stage 2 聊天叶经 SessionManager.appendMessage               | PASS（窄：写路径）。真实 agent turn / 崩溃恢复 E3 仍 NOT_COVERED。阶段不是全面 PASS                                                                                                                                                                                                                                                      |
| Stage 3 超时重试、API-02、API-03、协议检查、六列            | 超时 **窄 PASS（四方法，含 agent pre-accept join）**；API-02 **窄 PASS（WS 畸形帧断连/ok:false + AJV）**；API-03 **窄 PASS（tools-invoke 权威 deny + 企业 fail-closed；shadow tenantCapabilities 仍开）**；`protocol:check` 窄 PASS；六列补 WS versioning/CLI schema/Plugin versioning E1 + **WS 事件六列（含 backward）窄 PASS** + **CLI versioning/backward/idempotency/authz/errors 窄 PASS** + **WS 请求 backward/authz 窄 PASS** + **Plugin/SDK authz/schema/idempotency/errors 窄 PASS**；Plugin backward 仍 NOT_COVERED。阶段不是 PASS                                                                                                                                                         |
| Stage 4 其余 store 与 pin 单拍运行时                        | 字段表已部分窄 PASS；**凭证备份排除窄 PASS**；**backup create+verify 全链 E3 窄 PASS**；**doctor 迁移 dry-run/confirm 窄 PASS**；**租户 store shard 窄 PASS**；**pin 单拍窄 PASS**；**知识归档还原窄 PASS**。doctor 全量键 / 全 store 普查 / 多拍仍开。阶段不是 PASS                                                                                                                                                                                                                                       |
| Stage 5 生产部署接线（compose profile `ha`）                | **CONDITIONAL**。Owner：platform/SRE。剩余：release 镜像钉、`compose --profile ha config` 烟测（有 Docker 时）、实际启用路径。默认拓扑仍零 HA；Auto FO 未批准；DC NOT_RUN。不构成产品 HA PASS                                                                       |
| Stage 6 critical 三条                                       | 缓解。metadata critical 为 0。没有豁免工单。不构成阶段 PASS                                                                                                                                                                                                      |
| Stage 6 `pnpm audit --prod` 整体                            | FAIL。合入后退出码 1。metadata high 0、critical 0、moderate 50、low 9。没有豁免工单。合入前 high 表仍留在正文                                                                                                                                                    |
| Stage 6 全量 checks、格式、协议、覆盖率、许可证扫描、zizmor | NOT_RUN                                                                                                                                                                                                                                                          |
| Stage 6 正式 SBOM                                           | 窄 PASS（`@cyclonedx/cdxgen@12.8.5` 入库 + 可再生成）。不构成 Stage 6 产品 PASS；audit 仍退出码 1                                                                                                                                                                                                                   |
| Stage 6 本 pin 的 CI / install-smoke                        | Install Smoke 结论 success。CI 结论 failure。已抽出日志的 19 行在 CURRENT。Docker build-arm64 仍 in_progress，不写行                                                                                                                                             |
| Stage 6 上一 pin install-smoke 与 secrets/checks            | NOT_RUN。只描述 `7f8b49286`                                                                                                                                                                                                                                      |
| Stage 7 console                                             | PASS。jsdom 渲染生产视图，请求进了进程内 Gateway。不是设备浏览器                                                                                                                                                                                                 |
| Stage 7 wecom / feishu                                      | 表面 **CONDITIONAL**。negative PASS；happy/observable CONDITIONAL（进程内 + mock；非 Gateway / 非 live）。§5.7 矩阵原文未改写                                                                                                                                      |
| Stage 7 doctor_onboard                                      | 表面 PASS。happy 含企业 IM 产品 onboarding；negative/observable 仍 E3                                                                                                                                                                                           |
| Stage 7 dingtalk                                            | 表面 **CONDITIONAL**。negative PASS；happy/observable CONDITIONAL（进程内 + mock；非 Gateway / 非 live）。真实 Client/`sendText` 仍 NOT_RUN                                                                                                                                                                        |
| Stage 7 ios / android / harmony / macos                     | 各三行 path_kind **NOT_RUN**，表面 **FAIL**。linux box 无 xcodebuild/JDK/adb/ohpm；`stage7-mobile-device-evidence` 已记工具链缺口 + E1 client id（harmony 无协议条目）。不抬 PASS。Owner：platform/mobile |
| Stage 8 产品验收与基线冻结                                  | `execution_baseline_sha` 已钉 `a7bbaf6d14b40f138f677ff3c9c0a90e82de5ace`。CURRENT 19 行是 pin 自检，回归 UNKNOWN。`stage8_eligible=false`。第二复核人是代码仓盘点验收。盘点账本就绪。产品结论不是 PASS。本 PR head 的 job 因账单未启动，无日志，不写 EvidenceRow |

证据命令上限（可增不可悄悄替换）：

- `git rev-parse HEAD` 与 `git merge-base --is-ancestor origin/main HEAD`
- `pnpm protocol:check`
- CI Gate 等价检查（格式、诊断增量、协作红线）
- 选定的 `pnpm test` 子集（低内存：`OPENBOT_TEST_PROFILE=low`）
- `pnpm deadcode:knip`（可降为「记录最近成功运行」若环境无依赖）
- `openbot doctor` 的文档对照（无状态目录时允许不执行，回归标 NOT_RUN；只有范围排除才标 NOT_COVERED）

禁止项：生产 cutover、`npm publish`、改安全剖面默认值、对真实租户库执行连接器 SQL、把 Episode store 在共享环境打开。

## 7. 角色分工

| 角色              | 职责                                         | 不负责                                                                               |
| ----------------- | -------------------------------------------- | ------------------------------------------------------------------------------------ |
| 评审主持人        | 收口范围、剖面、严重度口径、有条件通过       | 代写证据                                                                             |
| 架构验收人        | §5.1、方法包、monorepo 边界                  | 性能压测                                                                             |
| 协议与 API 验收人 | §5.2、`protocol:check`、HTTP 开关            | 控制台视觉                                                                           |
| 数据验收人        | §5.3、备份试验、隔离键                       | 生产库变更                                                                           |
| 质量验收人        | §5.4、§4.4 两轴对比表、依赖字段表            | 把 NOT_RUN、CANCELLED 或基线失败写成新回归或验收 PASS；把 CANCELLED 写成 NOT_COVERED |
| 安全复核人        | §5.0、§5.6 的 AUTH 项；与数据验收人分开签 P0 | 全量渗透（另立授权）                                                                 |
| 记录人            | 证据册格式、SHA、命令原文                    | 改结论                                                                               |

一人可兼两角，但 P0 发现的采集人与复核人必须分开。产品代码改动不在验收角色内；整改另开变更。

## 8. 产出物清单

本 PR 只交付本方案。评审通过并实施之后，应有：

| 产出物     | 内容                                                                   | 完成定义                                                 |
| ---------- | ---------------------------------------------------------------------- | -------------------------------------------------------- |
| 冻结单     | SHA、剖面、范围内外、抽样表                                            | 主持人签字或等价评审记录                                 |
| 证据册     | 每条是 §4.4 的 EvidenceRow，内含 Signature 八键                        | 缺 required 键或 `HISTORICAL` 则 `stage8_eligible=false` |
| 发现单     | ID、严重度、置信度、阶段、文件、根因                                   | P0/P1 有第二人复核                                       |
| 阶段结论   | Stage 0–8：PASS / CONDITIONAL / FAIL / NOT_COVERED。摘要只引用 CURRENT | HISTORICAL 不参与 Stage 8 验收摘要                       |
| 建议域附录 | §5.5 各项是升格、排除（NOT_COVERED）还是未执行（NOT_RUN）              | 与评审决议一致                                           |
| 缺口表     | 主人、下一次验证命令                                                   | 无主人的 P0 不得关闭验收                                 |

证据册不收录密钥、真实手机号、生产连接串、未脱敏日志。

## 9. 风险与前置

| 风险                                               | 前置或缓解                                                                 |
| -------------------------------------------------- | -------------------------------------------------------------------------- |
| `main` 在评审与实施之间前进                        | 阶段 0 重 pin；旧结论作废                                                  |
| 用 workflow 注释解释 CI                            | 只采用 Actions run/job。注释与 labels 不一致时该主张标 UNKNOWN             |
| 全量 `pnpm check` / `pnpm test` 耗时长且有既有债务 | 同签名只写回归 BASELINE_UNCHANGED；验收另判，不因此 PASS                   |
| 文档日期旧于代码                                   | 冲突时以测试锁定的行为为准，并记文档滞后                                   |
| 双状态目录（`.openbot` 与遗留名）                  | 试验只用临时 `OPENBOT_STATE_DIR`                                           |
| `pg` 与 HA Postgres 被理解成产品主库               | 报告明确写：主状态是分片 JSON/SQLite；`pg` 是客户连接器；HA 库是交付控制库 |
| Episode store 默认关闭                             | PERSIST-EP-01 覆盖关闭；EP-02 至 EP-04 只在测试夹具里打开                  |
| 未选定剖面却写出安全通过                           | Stage 0 硬门：只允许静态契约检查                                           |
| 仓库 URL 与状态目录名在文档和代码之间不一致        | 已是至少 P2 的身份与迁移发现（§3.3），不在本方案里改历史链接               |
| docs-only CI 跳过测试                              | 符合预期；不要为了「看起来跑过测试」去改无关代码                           |
| 多 Agent 共享工作树                                | 实施审计的人只追加证据文件，不提交他人未完成改动                           |

前置：Node 22+、可 `pnpm install` 的网络、对 `origin/main` 的只读 git、评审会书面范围。没有这些，只保留文档对照，结论标「环境不足」。

## 10. 评审会待决问题

1. 剖面：本次只验 `personal_local`、只验 `managed_enterprise`，还是两份结论？本批已选定两份独立结论，见 §5.0 执行记录。这不把任一剖面写成 PASS。
2. 频道：企业微信 / 飞书 / 钉钉按 §5.1 与 §5.7 全查，不再待决是否纳入。待决只剩继承频道的抽样比例，且不得把继承频道写成产品标题。
3. 质量门：回归轴已要求相对基线无新增。评审会是否还要求绝对干净的 `tsgo`，还是接受 BASELINE_UNCHANGED 配验收 CONDITIONAL？
4. 依赖审计只有在 GHSA/CVE、包、版本范围、依赖路径、prod/dev 可达性、严重度逐条相同后，回归才可以是 BASELINE_UNCHANGED。验收是否把未缓解的 critical 定为 FAIL，还是允许带主人的 CONDITIONAL？禁止因条数相同写成 Stage 6 PASS。
5. HTTP 兼容端点：默认关闭的 `/v1/chat/completions` 是否要在隔离环境打开做一次 AUTH-01？
6. 备份：是否授权在临时目录运行 `backup create` 与 `backup verify`？
7. PERSIST-EP-05 坏行跳过：在补测试之前，是否接受「开放问题、不得 PASS」？
8. §5.5 只剩可观测、性能、正式 SBOM、发布通道。哪些再升为必验？企业 IM 已是 Stage 7，不再放在这个问题里。
9. 有条件通过：P1 是否允许带主人与期限？P0 是否一律否决？
10. 身份发现已拆开。ID-A（徽章与 SECURITY 链接）保持至少 P2。ID-B（`~/.gmood2008` 与 `ensureGitCheckout` 的 `gmood2008/openbot.git`）是否升到 P1？
11. 验收报告的读者：内部工程、企业客户安全问卷，还是两者？这决定证据册能否含内部路径。
12. 实施人是否允许只加证据文件到 `docs/acceptance/`，还是证据放在评审系统外？

## 附录 路径索引

路径均相对仓库根。实施时以基线 SHA 的文件为准。

| 主题                    | 路径                                                                                                                                                                                                                  |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 产品入口文档            | `docs/index.md`、`README.md`、`VISION.md`                                                                                                                                                                             |
| 架构                    | `docs/concepts/architecture.md`、`docs/gateway/index.md`、`docs/gateway/protocol.md`                                                                                                                                  |
| 安全剖面                | `SECURITY.md`、`src/gateway/security-profile.ts`、`docs/gateway/security/index.md`                                                                                                                                    |
| TypeBox 与协议生成      | `docs/concepts/typebox.md`、`src/gateway/protocol/schema/protocol-schemas.ts`、`scripts/protocol-gen.ts`                                                                                                              |
| HTTP                    | `src/gateway/openai-http.ts`、`src/gateway/openresponses-http.ts`、`src/gateway/server-http.ts`、`docs/gateway/openai-http-api.md`、`docs/gateway/openresponses-http-api.md`、`docs/gateway/tools-invoke-http-api.md` |
| CLI                     | `src/cli/program/command-registry.ts`、`src/cli/program/register.subclis.ts`、`src/cli/program/routes.ts`                                                                                                             |
| 方法包                  | `src/gateway/server-methods/packs/registry.ts`、`src/gateway/server-methods/pack-merge.ts`                                                                                                                            |
| 企业 IM                 | `docs/channels/enterprise-im.md`、`extensions/wecom`、`extensions/feishu`、`extensions/dingtalk`                                                                                                                      |
| 节点与配对              | `docs/gateway/pairing.md`、`docs/channels/pairing.md`、`src/pairing`、`apps/macos`、`apps/ios`、`apps/android`、`apps/harmony`                                                                                        |
| 状态与会话              | `src/config/paths.ts`、`src/config/sessions/paths.ts`                                                                                                                                                                 |
| 持久化分类              | `docs/design/openbot-persistence-engine-matrix-2026-07-13.md`、`docs/design/openbot-saas-tenant-data-architecture.md`                                                                                                 |
| SQLite / 记忆           | `src/gateway/knowledge/`、`src/memory/`、`docs/concepts/memory.md`                                                                                                                                                    |
| Postgres 连接器         | `src/gateway/enterprise-data/adapters/postgres.ts`                                                                                                                                                                    |
| Episode store           | `src/gateway/collaboration-dispatch/episode-store.ts`、`episode-store.test.ts`、`episode-boundary.test.ts`、`episode-state.ts`、`episode-state-machine.ts`                                                            |
| 备份 / doctor / onboard | `src/cli/program/register.backup.ts`、`src/commands/doctor*.ts`、`src/commands/onboard.ts`、`docs/gateway/doctor.md`                                                                                                  |
| 测试与质量              | `docs/help/testing.md`、`vitest.*.config.ts`、`knip.config.ts`、`.pre-commit-config.yaml`、`.secrets.baseline`                                                                                                        |
| CI                      | `.github/workflows/ci.yml`、`.github/workflows/ci-gate.yml`、`.github/workflows/codeql.yml`、`docs/reference/ci-local-merge-gate.md`                                                                                  |
| HA 与交付               | `deploy/ha/controller/README.md`、`deploy/ha/commitsafety/`、`deploy/production/`                                                                                                                                     |
| 工作区                  | `pnpm-workspace.yaml`、`package.json`、`ui/`、`packages/`、`extensions/`、`skills/`                                                                                                                                   |
| 文档导航                | `docs/docs.json`                                                                                                                                                                                                      |
| 协作红线                | `packages/collaboration-runtime`、`package.json` 脚本 `lint:collab:*`、`test:collab:runtime-lifecycle`                                                                                                                |

相关但不同的既有矩阵：`docs/architecture/multiplatform-acceptance-matrix.md` 是多平台共享验收，不替代本方案。
