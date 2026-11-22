# OpenBot 基础设施全面排查与稳定性治理计划

> **现行结论入口（2026-11-01）：** [closeout-2026-11-01.md](closeout-2026-11-01.md)。本计划仍是原范围。收尾没有把全面审计改名为已完成。当时「未修改 repo」只描述 2026-10-31 初查。

日期2026-10-31 Europe/Berlin。状态：只读初查完成，全面审计待分阶段执行；不是基础设施健康证明。用户目标：判断是否真实故障、验证设计合理性和体系清晰度，形成可重复的稳定性保障，而非仅为某PR消除红灯。当前不授权生产变更、购买服务、修改ruleset、开生产权限或部署。

## 一、初查事实与证据限度

代码快照a9e7bd2b，当前checkout属于#169；本地origin/main=53e11c99。18个workflow文件，文本统计runs-on：ubuntu-24.04 33处、ubuntu-latest5、windows-2025 1、macos-latest2、matrix1。此为文字位置计数，不是实际执行job数或runner库存。

1. 本轮gh api actions/runs失败：api.github.com不可达。这只证明本执行环境的访问受限，不证明GitHub服务、仓库Actions或生产网络故障。
2. 用户证据包报告多个workflow约2秒失败、steps=[]、BlobNotFound；原始API响应/完整run annotations未在本轮重新获取。它是故障线索，不足以单独证明账单耗尽、runner错误或“平台基础设施噪声”。
3. .github/workflows/ci-gate.yml注释称重型CI仍停在Blacksmith，但当前ci.yml的runs-on已改为GitHub-hosted。注释/运行说明与代码不一致，不能用旧runner故事解释新失败。
4. scripts/ci-local-merge-gate.sh使用git fetch ... || true，不能fail closed保证新鲜main；部分绝对门禁对当前checkout跑，--candidate只对diagnostic delta绑定快照，执行清单与CI Gate也不完全等价（本地脚本未覆盖当前S01检查、collab red-line等所有步骤）。旧文档“Equivalent”表述需审计，不能当自动豁免依据。
5. delivery-sot-alignment workflow使用RELEASE_RECORD中的LIVE做一致性检查；它不等于主动读取实际容器build-info。应将“声明账本自洽”与“实际运行态对账”分开。
6. 本机df显示Data卷99%使用率、约14GiB可用（数值为当时观测，不清理任何文件）。这是构建临时空间与稳定性风险，但本轮没有证明它导致任何特定失败。
7. 本机Node22.18.0、pnpm10.23.0、Bun1.2.21；setup action目标Node22.x、pnpm10.23.0、Bun1.3.9。Bun版本偏差需纳入可复现性，而非直接定性缺陷。
8. production compose是仓库设计样例，有healthz/restart/volumes/安全配置，并且HA profile默认manual；不是当前LIVE部署拓扑证据，不应据此假设实际高可用或自动切换。

## 二、目标结构与责任边界

建立一张“声明配置 → 实际资源 → 健康信号 → 恢复动作”的对照图，覆盖：
开发与Git身份 → PR/rulesets → Actions调度与计费 → runner镜像/网络 → 依赖/构建/缓存 → tests/质量门禁 → artifact/registry/digest → staging → 人工批准cutover → 实际gateway/UI/sandbox/数据 → 观测/备份恢复。

每个节点明确owner、真实SoT、依赖、权限边界、输入输出、健康指标和runbook。区分控制面（配置/调度/账本）、执行面（runner/container/agent）、数据面（数据库/文件/对象/备份）、观测面（日志/指标/告警）。避免为同一状态再造多个并行权威。公网主入口沿用https://www.openbot.love/。

审计结果一律标记：已证实故障、可复现代码缺陷、配置风险、历史陈述未核实、环境阻断、未覆盖。禁止“日志缺失=代码绿”“API受限=平台坏”“本地mock绿=Live绿”。

## 三、阶段0：冻结证据与审计登记（首批）

先确认实际repo身份（flykingvip-cloud/openbot-vp与gmood2008/openbot的迁移/镜像关系）、host/worktree和最新main，记录full SHA、PR head SHA及Git祖先关系；fetch失败不宣称新鲜基线。不覆盖其他agent WIP，不自行建分支/worktree。实施前查Loom路径归属并注册独立审计task/session；当前报告在聊天附件目录，不触碰共享registry。

采样至少覆盖当前main、#170同head、一个历史成功run、一个纯workflow sanity失败、一次build类失败；同一事件/HEAD绑定run_id,run_attempt,check_suite_id,job_id,created/started/completed,runner_id/name/group/labels,steps,annotations,conclusion,log HTTP headers/status/request-id。附件用UTC存时标、前端按Europe/Berlin展示，禁止混用时间误判先后。

输出evidence-index.json、原始响应脱敏归档、命令/退出码、抓取时间、权限/访问限制。不得输出token/完整secret/env；404须区分资源不存在、无权访问、日志过期、上游存储异常。无法访问时由具权限USER端运行同一只读collector后交回原始结果，不只给截图或摘要。

## 四、阶段1：CI事故定因（最高优先级）

按层顺序定位，避免先改代码/买runner：
A. 账户/组织/仓库：Actions是否启用、allowed actions策略、托管runner使用权限、配额/预算/支付状态、并发额度、计划限制、fork工作流审批与GITHUB_TOKEN权限。只读核对，不申请或修改。
B. run/check调度：run-level annotations/errors是否明确账单/政策/配置拒绝；job未分配runner还是分配后尚无step；concurrency取消、手动取消与failed分开；PR head vs merge ref及workflow文件SHA核实。
C. runner执行：标签是否有真实资源支持；GitHub-hosted资源 vs self-hosted inventory；平台/架构/runner镜像版本；checkout/action版本支持、workflow语法/权限、依赖与registry访问。不到step的失败不得先归因pnpm/tsgo。
D. 日志链：API响应、权限、重试后是否补齐，run_attempt正确性；网页/API能否对同一job给一致结果；集中同时间失败是否与当前服务状态有关。仅以官方状态历史/账单页面/明确annotations及控制实验互证。

对照实验分级：先读现有run；若仍无法定因，准备可review的最小workflow（单job、托管ubuntu、无checkout/secret/dependency、只输出固定字符串和运行标识、短timeout）。新增或触发workflow须遵循仓库PR权限及可能计费边界，在明确授权后进行，不在本轮擅自触发。依次加checkout、setup、frozen install、类型门禁；每次只加一层。避免无限retry消耗额度。成功控制run与失败目标run对齐HEAD/权限/时间窗。

假设结论须有证伪条件：

- 配额耗尽：明确账单/annotation + 无runner分配，恢复额度后同控制任务完成；单BlobNotFound不够。
- runner标签缺资源：job持续queued且label无可用pool；改到已在线pool的受控实验通过。当前实际标签已变，旧Blacksmith解释需废止或重新证明。
- workflow/action权限：annotation明确拒绝项；最小job可跑、加特定action失败。
- 日志服务问题：runner/steps已实际运行的独立证据与日志获取异常互证。
- 产品代码失败：runner已开始且明确step命令/退出码、同SHA可复现。

事故解除门槛：main最小控制与正式gate都有完整可读step、日志和结束状态；故意失败测试确实红；不能用skip/continue-on-error代替故障恢复。

## 五、阶段2：门禁与构建可复现性审计

逐workflow/job建manifest：触发器、paths、runner、权限、并发取消、timeout、成本、必需/可选/shadow、owner、预期持续时间。核对ruleset实际required check context与workflow名称/事件是否一致；docs-only、fork、merge queue、main push均不得出现永远pending或意外跳过。rulesets不在本轮修改。

建立机器可比较的gate清单，远端与本地替代器消费同一来源，区分candidate-bound与checkout-bound步骤。替代器应：fetch失败退出blocked、候选clean且包含fresh main；所有格式/政策/测试在同一候选快照执行；结构性红线保持强制；skip输出为partial不输出passed。报告绑定base SHA/candidate SHA/tree/runtime/lockfile hash/命令/退出码/跳过原因，无法比较的诊断分类infra-failure。测试不只按错误条数或文件集合做delta，保留完整规范化诊断和数量。

干净临时环境frozen-lockfile安装与build；检查Node/pnpm/Bun、native modules、OS/CPU/libc；缓存冷/热、失效键、缓存污染和无网恢复；registry/npm/artifact依赖验证、action版本与供应链来源。对本机磁盘/FD/内存/进程上限建立preflight，报告资源不足而非伪装产品失败。不在共享机大清理或大并发跑全仓。曾有EPERM loopback与EMFILE，分别保持限制/失败/skip语义，不把MockAgent升级为真实TCP。

全仓技术债独立跟踪：绝对必须绿的规则（权限/安全/完整性等）与暂行delta规则列清；豁免有owner、范围、原因、到期、退出条件及替代证据，不允许永久“CI不可信”通行证。重型平台矩阵单列受支持覆盖与预算，不用最小gate假称替代所有平台测试。

## 六、阶段3：发布链与生产拓扑（只读清点后再演练）

核实真正部署工具（Docker/Podman/launchd/systemd）、宿主/反代/域名/DNS/TLS、运行gateway/UI/sandbox镜像与分离overlay来源，读取实际build-info与镜像digest，和main/provenance tag/releases.jsonl/RELEASE_RECORD三方对账。静态账本不是实际LIVE。验证I1前向、I2主干锚定、I3退休；部署候选是fresh main tip且clean，审批绑定同SHA/digest，主干变化需重验。代码回滚与数据回滚边界单列，不能为演练破坏forward-only政策。

盘点配置/secret权威与注入来源、tenant路径/mount/uid/gid、sandbox host/container映射、docker socket权限、租约创建续租回收、浏览器/网络出口、凭证撤销、跨tenant定位；样例compose不能代替实际有效配置。健康检查分liveness、readiness、依赖降级和用户合成事务；进程存活不能代表模型调用/记忆检索/任务送达健康。仅运行已批准的非生产/只读探针，不主动给真实用户发消息。

输出环境矩阵dev/staging/prod及每层差异，灰度/切流/停止条件/runbook。staging预先验证，生产变更另行具体批准。本轮不自动启HA/自动failover，不改网关/端口/规则。

## 七、阶段4：数据、可观测性与恢复能力

清单：tenant SoT与索引/缓存/derived、数据库/对象/本地volume、event/failure ledger、备份目标/加密/访问/保留与删除；未备份或无法重建的derived要辨清。制定并批准RPO/RTO，不凭猜测给业务承诺。只有隔离恢复演练读取备份、重建索引、核对数量/checksum/tenant边界与业务消费成功，才算备份有效；有备份文件不算可恢复。

链路ID统一commit/digest/run_id/session/task/event，不记录私聊正文与token。CI排队/无runner、空steps失败、不可解释失败、main无成功gate、日志不可读、磁盘/FD/lease耗尽、证书到期、备份过期及恢复演练超期应有独立健康状态。告警保留静默/去重/升级策略，先确认渠道权限再启用，避免发送噪声。完整错误分类不允许catch→零统计→假成功。运营看板显示green/degraded/failed/unknown/blocked，unknown不能算green。

## 八、建议的验收与执行顺序

批次A：CI原始故障证据 + 最小控制定位，给明确根因/未决假设，先恢复可解释信号。
批次B：门禁manifest与本地替代器一致性修复，fail-closed与故意失败测试，修正文档事实；每个修复独立PR。
批次C：干净构建与产物provenance、staging拓扑/最小业务闭环。
批次D：生产只读对账、隔离恢复演练、资源与依赖故障注入（staging）、运行手册验收。
批次E：稳定性基线与持续审计，按批准SLO跑观察窗，证据绑定时间区间而非一次PASS。

建议审计owner单一负责，平台配置/CI/部署/数据owner各有签名；执行agent实施，独立验收方核实before/after与失败注入。用户未要求多agent，本轮不另派agent或新聊天。每批完成后产出问题台账：severity/证明/根因/影响/owner/PR/SHA/验收/残余；状态可追踪，不能用几页架构图替代修复。

验收硬线：

1. 能解释真实失败及可证伪假设；未知项有原因与下一证据，不伪造根因。
2. 从PR到main的必要gate可执行且可读；本地替代器不在错误SHA上判PASS，故意失败必红。
3. clean build产物与实际部署identity一致，配置来源唯一可解释，权限/tenant边界负向测试通过。
4. 真实备份恢复满足批准RPO/RTO；事故处理与回退有演练结果。
5. 相同问题再次出现可通过观测和runbook定位，不依赖临时聊天口述；豁免不得无限期延续。

## 九、权限与当前阻碍

当前只读本地初查可继续；GitHub API在本执行环境不可达，无法核实账单、真实runner、annotations和日志。如果USER侧可达，需提供脱敏原始collector输出或已授权连接环境，不能用默认推测填空。实际生产清点还需确认目标host/容器及已有访问路径；不要求提供secret明文。workflow触发、runner注册、付费调整、ruleset、staging注入、恢复演练和生产变更分别在具体方案可review后处理授权，不把普通只读调查反复设审批。

本报告未修改repo文件、注册表、CI、生产或任何ruleset；没有合并、部署、发消息或创建自动化。后续建议先交批次A证据，再决定B的最小修复，不先铺设另一套调度/告警平台。
