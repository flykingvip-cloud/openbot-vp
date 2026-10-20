---
name: independent-work
description: >-
  数字人自己调用服务器、本机节点和隔离浏览器把活干完。用户只做人才能做的授权（扫码、本机执行批准、Passkey、TCC）。
  遇到「独立工作」「操作服务器」「调用本机电脑」「没有连接器也要登后台」「gh 设备码」「浏览器代操作再落到本机」「把结果存到桌面」务必使用。
  不要用来引导用户自己点界面（那是 user-guidance-protocol）；不要用来做无登录公开页抓取（web_fetch / web-research）。
  执行面可以自己选。这不取消高风险确认：对外发送、广播、外部写入、删除、发布、改权限、写凭证、重置密钥、不可逆覆盖，仍然先确认再执行。
user-invocable: true
metadata:
  openclaw:
    emoji: "🖥️"
    promptPriority: 90
---

# 独立工作（服务器 / 本机 / 浏览器）

用户提出目标后，数字人选执行面、自己干完、用证据验收。**不要把控制台或本机操作手册丢回给用户。**

本技能只编排。可执行工序读 [references/procedure.md](references/procedure.md)。扫码循环读 `browser-scan-proxy`；Mac GUI 读 `peekaboo`；凭据读 `1password`；平台写入读 `openbot-platform-ops`。对照表读 [references/box-mapping.md](references/box-mapping.md)。分流读 [references/routing.md](references/routing.md)。

## 铁律

1. **先连接器 / 官方 CLI / 已有 Gateway 工具，再开浏览器。** 有 `gh`、渠道 RPC、知识源、已装 MCP 就走它们。连接器只是缺登录时，走它自己的认证，禁止用未登录浏览器绕过。用户已经在下任务，不要再问「要不要我用浏览器」。这句只取消执行面询问，不取消高风险确认：对外发送、广播、外部写入、删除、发布、改权限、写凭证、重置密钥、不可逆覆盖，仍然先确认再执行。
2. **密钥不进聊天。** 密码、OTP、cookie、AccessKey 不让用户粘贴到对话，也不写入 skill / 记忆 / 仓库。OTP 若已在数字人接管的邮箱里，自己读、自己填。禁止截图核验密码框。
3. **登录页必须隔离。** OpenBot `browser` 用 `profile=openclaw`。禁止把登录开到用户自己的 Chrome 再干等。能拼出直达 URL（含 query / 设备码页）就直接打开。
4. **登录成功不是终点。** 按私有清单继续执行，直到独立验收通过。
5. **不要替用户点最终 Authorize。** 除非用户已明确要求，并且 snapshot 已确认就是授权页。
6. **云电脑 ≠ 用户电脑 ≠ 云 Gateway。** 读写用户磁盘必须走已连接的桌面节点 + exec 授权。云端 Gateway 永不直连用户 loopback sidecar。
7. **GUI 只用正式驱动。** 网页用 `browser`；Mac 窗口用节点上的 `peekaboo`。禁止用 exec 里的 Playwright / CDP / xdotool 偷开 GUI。
8. **授权弹窗不是失败。** 本机 `exec` 批准、TCC Grant、扫码确认都是预期步骤。不要当错误刷屏重试。

## 执行面（从上到下，命中即停）

| 优先级 | 执行面                      | 何时用                                    | 工具                                     |
| ------ | --------------------------- | ----------------------------------------- | ---------------------------------------- |
| 1      | 连接器 / 官方 CLI / Gateway | 服务有 API、CLI、已认证 MCP、已有渠道     | 对应技能 + `exec`/`gh`/`op`              |
| 2      | 隔离浏览器                  | 无连接器，但有网页控制台                  | `browser-scan-proxy`                     |
| 3      | 本机节点 Shell              | 路径、已装软件、落盘、本机项目            | `exec host=node` / `nodes.run`           |
| 4      | 本机 GUI                    | 原生 App、系统对话框、TCC 相关窗口        | 节点上 `peekaboo`                        |
| 5      | 远程服务器                  | 生产/构建机、DNS、容器、公网验收          | SSH（如 `aliyun-build`），不用本机 `dig` |
| 6      | 带路                        | 数字人物理上点不到（Passkey、系统密码框） | `user-guidance-protocol`，且只带这一步   |

开始前写私有清单（不要发给用户当操作手册）：

```
goal: <一句话要变成什么>
host: connector | browser | node | peekaboo | ssh
loginUrl: <直达 URL，能带 query 就带>
forbidden: [<不能动的资源>]
checkpoint: { lastDone, next, evidence }
deliverable: <文件名，本机路径先查再写>
```

## 授权升级（低打扰 → 高打扰）

细则在 `references/procedure.md` 的 A3。摘要：

1. **已有会话** → 直接干。
2. **1Password CLI**：按当前页完整 URL 查用户自有保险库；值不回显；自带 OTP 则继续由 `op` 填。
3. **扫码** → `browser-scan-proxy`。
4. **可定位打字段** → 隔离页代填；单字段 OTP 填完立刻提交。
5. **人必须上手**：Passkey、设备批准、图形拼图、SSO、跨域填不到。长按「我是人类」不算这一档。
6. **本机执行授权 / TCC**：先说明再调用；拒绝则停。

一次性验证码：能从已接管邮箱读取就自己读。用户主动发来的码只用当次，不入库。

## 本机与落盘

走 `references/procedure.md` 的 B。摘要：先选 Connected=1 的节点 → 说明用途再弹授权 → 远端做完再拷 → 在节点上解析 Desktop → 核大小后给完整路径。批量数据先成文件再上传。

## 验收

- 控制台「成功」不够：用不受本机劫持的源再查（生产机、权威 DNS）。
- 落盘：核对本机路径存在与大小后再告诉用户。
- 中途授权过期：记下 checkpoint，重登后先回读再续做，禁止重复破坏性写入。

## 反模式

- 有 CLI / RPC 却去浏览器里抄表；连接器待登录却改用未登录浏览器绕过
- 用户已下任务还问「要不要我用浏览器」
- 把上面那句理解成可以不确认就对外发送、删除、发布、改权限、写凭证、重置密钥或不可逆覆盖
- 让用户把密码或 OTP 贴进聊天；截图核验密码框
- 未确认页面就替用户点 Authorize
- 登录开在 `profile=chrome`，却在隔离页上等待
- 扫码成功后把「请到控制台添加 XXX」交回用户
- 长按人机验证却改走带路；把 Passkey 硬塞进可填表单
- 云 Gateway 去连 `127.0.0.1:3000`
- 把 Box / Grok Bot 的 `request_user_form`、`request_box_help` 当成 OpenBot 工具名来调用
- 未说明用途就连续弹本机授权；写死别人的桌面路径
- 本机 DNS 被劫持时用本地 `dig` 当公网验收

## 完成标准

- 用户只做了人才能做的授权
- `forbidden` 未动
- 有独立于控制台文案的证据
- 若换过登录会话：checkpoint 被续上
