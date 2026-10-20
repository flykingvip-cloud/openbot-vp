# douyin live 证据（S6）

```yaml
provider: douyin
path_unstable: true
verified_live: false
live_probe_date: "2026-10-19"
live_probe_tz: Asia/Shanghai
live_probe_channel: mac_worktree_no_cloud_pc
skill: oi-bind-douyin
```

**诚实声明**：S6（2026-10-19 Asia/Shanghai）在本机 Mac worktree 记录取证尝试。
本切片**无**可用云电脑会话，**无**真实抖音 Access Token 可供 `credentials.bind`。
**保持** `path_unstable: true` / `verified_live: false`。

## E2E 尝试（2026-10-19）

| 序 | 步骤 | 环境 | 结果 |
|----|------|------|------|
| 1 | 确认公开入口 `https://developer.open-douyin.com/` / `https://open.douyin.com/` | Mac worktree | ok（public_docs） |
| 2 | 云电脑登录开放平台 → 取 Token → bind | Cloud PC | **阻断**：无云电脑会话 |
| 3 | `credentials.bind`（accountHandle + accessToken） | gateway | **未执行**（无真实凭证） |
| 4 | 个人授权页 douyin=active | 产品 UI | **未达** |

## 失败点 / 阻断

- Cloud PC 不可用；无合规 Token。  
- Cookie vs Token 合规性仍标 path_unstable（见 path-map）。

## 翻旗前置（尚未满足）

云电脑越过登录/人机验证 → 取得 Token → `credentials.bind` 成功 → 回写本文件后再翻旗。

## 禁止

伪造 verified_live；密钥进聊天/PR/投影；直接改 OI JSON。
