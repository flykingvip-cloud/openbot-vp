---
read_when:
  - 在 Windows 上安装 OpenBot
  - 查找 Windows 配套应用状态
summary: Windows（WSL2）支持 + 配套应用状态
title: Windows (WSL2)
x-i18n:
  generated_at: "2026-02-03T07:53:19Z"
  model: claude-opus-4-5
  provider: pi
  source_hash: c93d2263b4e5b60cb6fbe9adcb1a0ca95b70cd6feb6e63cfc4459cb18b229da0
  source_path: platforms/windows.md
  workflow: 15
---

# Windows (WSL2)

Windows 上的 OpenBot 推荐**通过 WSL2**（推荐 Ubuntu）。CLI + Gateway 网关在 Linux 内运行，这保持了运行时的一致性并使工具兼容性大大提高（Node/Bun/pnpm、Linux 二进制文件、Skills）。原生 Windows 可能更棘手。WSL2 给你完整的 Linux 体验——一条命令安装：`wsl --install`。

原生 Windows 配套应用已在计划中。

## 安装（WSL2）

- [入门指南](/start/getting-started)（在 WSL 内使用）
- [安装和更新](/install/updating)
- 官方 WSL2 指南（Microsoft）：https://learn.microsoft.com/windows/wsl/install

## Gateway 网关

- [Gateway 网关操作手册](/gateway)
- [配置](/gateway/configuration)

## Gateway 网关服务安装（CLI）

在 WSL2 内：

```
openbot onboard --install-daemon
```

或：

```
openbot gateway install
```

或：

```
openbot configure
```

出现提示时选择 **Gateway service**。

修复/迁移：

```
openbot doctor
```

## 高级：通过 LAN 暴露 WSL 服务（portproxy）

WSL 有自己的虚拟网络。如果另一台机器需要访问**在 WSL 内**运行的服务（SSH、本地 TTS 服务器或 Gateway 网关），你必须将 Windows 端口转发到当前的 WSL IP。WSL IP 在重启后会改变，因此你可能需要刷新转发规则。

示例（以**管理员身份**运行 PowerShell）：

```powershell
$Distro = "Ubuntu-24.04"
$ListenPort = 2222
$TargetPort = 22

$WslIp = (wsl -d $Distro -- hostname -I).Trim().Split(" ")[0]
if (-not $WslIp) { throw "WSL IP not found." }

netsh interface portproxy add v4tov4 listenaddress=0.0.0.0 listenport=$ListenPort `
  connectaddress=$WslIp connectport=$TargetPort
```

允许端口通过 Windows 防火墙（一次性）：

```powershell
New-NetFirewallRule -DisplayName "WSL SSH $ListenPort" -Direction Inbound `
  -Protocol TCP -LocalPort $ListenPort -Action Allow
```

在 WSL 重启后刷新 portproxy：

```powershell
netsh interface portproxy delete v4tov4 listenport=$ListenPort listenaddress=0.0.0.0 | Out-Null
netsh interface portproxy add v4tov4 listenport=$ListenPort listenaddress=0.0.0.0 `
  connectaddress=$WslIp connectport=$TargetPort | Out-Null
```

注意事项：

- 从另一台机器 SSH 目标是 **Windows 主机 IP**（示例：`ssh user@windows-host -p 2222`）。
- 远程节点必须指向**可访问的** Gateway 网关 URL（不是 `127.0.0.1`）；使用 `openbot status --all` 确认。
- 使用 `listenaddress=0.0.0.0` 进行 LAN 访问；`127.0.0.1` 仅保持本地访问。
- 如果你想自动化，注册一个计划任务在登录时运行刷新步骤。

## WSL2 分步安装

### 1）安装 WSL2 + Ubuntu

打开 PowerShell（管理员）：

```powershell
wsl --install
# Or pick a distro explicitly:
wsl --list --online
wsl --install -d Ubuntu-24.04
```

如果 Windows 要求则重启。

### 2）启用 systemd（Gateway 网关安装所需）

在你的 WSL 终端中：

```bash
sudo tee /etc/wsl.conf >/dev/null <<'EOF'
[boot]
systemd=true
EOF
```

然后从 PowerShell：

```powershell
wsl --shutdown
```

重新打开 Ubuntu，然后验证：

```bash
systemctl --user status
```

### 3）安装 OpenBot（在 WSL 内）

在 WSL 内按照 Linux 入门指南流程：

```bash
git clone https://github.com/gmood2008/openbot.git
cd openclaw
pnpm install
pnpm ui:build # auto-installs UI deps on first run
pnpm build
openbot onboard
```

完整指南：[入门指南](/start/getting-started)

## 员工 UI（Web shell）— ADR 选项 1

Windows 上的桌面**员工** UI 是 **WebView2 宿主窗口**，加载与 macOS 相同的 Web
employee embed（`/embed/employee/*`，完整 Web 能力，**无** `shell=mobile`）。复用
同一套 bridge（`openbotEmployeeShell` / `chrome.webview` → `webview2`）。

- 代码：`apps/windows/`（WinUI 3 + WebView2）
- 登录门闩 / 深链：可移植 Stage 54 规则
- `openDeviceSettings` 仍为宿主原生（配套应用仍 planned，不进员工 me embed）
- 证据：`apps/windows/docs/evidence/stage55-windows-employee-web-shell-host/`

**不是**原生四 Tab。见 [`docs/architecture/desktop-ui-adr.zh-CN.md`](../architecture/desktop-ui-adr.zh-CN.md)。

## Windows 配套应用

我们还没有 Windows 配套应用。如果你想让它实现，欢迎贡献。
