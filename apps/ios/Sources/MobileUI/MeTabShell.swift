import OpenBotKit
import SwiftUI

/// 我的 hub — 个人设置｜设备｜更多（对齐 Android MeTabScreen）。
/// Secondary pages stay inside the tab (「我的」 kicker + EmployeeRootTabs bar).
/// Not a WebView tab. OAuth / WeChat identity wizard stays on Web.
struct MeTabShell: View {
    var gateway: GatewayNodeSession
    var onLogout: () -> Void
    var onOpenEmployeeWorkbench: (() -> Void)?

    @Environment(NodeAppModel.self) private var appModel
    @AppStorage("node.instanceId") private var instanceId: String = ""

    @State private var segmentIndex = 0
    @State private var route: MeHubRoute = .hub
    @State private var bots: [MeBotRow] = []
    @State private var groups: [MeGroupRow] = []
    @State private var devices: [MePairedDeviceRow] = []
    @State private var listBusy = false
    @State private var listError: String?
    @State private var notice: String?
    @State private var accountEmail: String?
    @State private var accountOrgId: String?

    private var connected: Bool {
        meGatewayIsConnected(statusText: self.appModel.gatewayStatusText, serverName: self.appModel.gatewayServerName)
    }

    private var refreshToken: String {
        "\(self.segmentIndex)#\(String(describing: self.route))#\(self.connected)"
    }

    var body: some View {
        Group {
            if self.route == .hub {
                self.hub
            } else {
                self.secondary
            }
        }
        .task {
            self.loadAccount()
        }
        .task(id: self.refreshToken) {
            await self.refreshVisible()
        }
    }

    private var hub: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                ModuleTitle(title: "我的")
                SoTSegmentedControl(
                    options: ["个人设置", "设备", "更多"],
                    selectedIndex: self.$segmentIndex)
                if let notice = self.notice, !notice.isEmpty {
                    MeSoftBanner(text: notice)
                }
                switch self.segmentIndex {
                case 0:
                    self.personalSection
                case 1:
                    self.deviceSection
                default:
                    self.moreSection
                }
            }
            .padding(.horizontal, OpenBotMobileTokens.pageGutter)
            .padding(.vertical, OpenBotMobileTokens.pageVertical)
        }
    }

    private var personalSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            MeIdentityCardView(state: meIdentityCardFromAccount(email: self.accountEmail, orgId: self.accountOrgId))
            MeSectionLabel(text: "账号与安全")
            MeHubNavRow(
                systemImage: "person",
                title: "账号信息",
                subtitle: "个人资料 · 企业与岗位",
                tint: OpenBotMobileTokens.textSecondary,
                badge: nil,
                action: { self.route = .accountInfo })
            MeHubNavRow(
                systemImage: "lock",
                title: "安全",
                subtitle: "登录密码",
                tint: OpenBotMobileTokens.textSecondary,
                badge: nil,
                action: { self.route = .security })
            MeHubNavRow(
                systemImage: "gearshape",
                title: "偏好",
                subtitle: "语言 · 主题",
                tint: OpenBotMobileTokens.textSecondary,
                badge: nil,
                action: { self.route = .prefs })
            MeHubNavRow(
                systemImage: "link",
                title: "授权",
                subtitle: "工作身份",
                tint: OpenBotMobileTokens.textSecondary,
                badge: nil,
                action: { self.route = .auth })
            // Residual vs Android: logout lives in native chrome here (Android shell handles it).
            MeHubNavRow(
                systemImage: "rectangle.portrait.and.arrow.right",
                title: "退出登录",
                subtitle: "清除平台会话并返回登录",
                tint: OpenBotMobileTokens.danger,
                badge: nil,
                action: self.onLogout)
        }
    }

    private var deviceSection: some View {
        // Android SoT: only 「系统权限」→「设备与权限」. No 「连接状态」row in Me.
        // Residual: connect / voice / canvas / paired-device routes remain reachable from Settings.
        VStack(alignment: .leading, spacing: 10) {
            MeSectionLabel(text: "系统权限")
            MeHubNavRow(
                systemImage: "iphone",
                title: "设备与权限",
                subtitle: "麦克风、相机、通知、定位",
                tint: OpenBotMobileTokens.textSecondary,
                badge: nil,
                action: { self.route = .permissions })
        }
    }

    private var moreSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            MeHubNavRow(
                systemImage: "cpu",
                title: "我的机器人",
                subtitle: "身份、能力与协作",
                tint: OpenBotMobileTokens.accent,
                badge: nil,
                action: { self.route = .robots })
            MeHubNavRow(
                systemImage: "person.3",
                title: "我的协作小组",
                subtitle: "成员与协作",
                tint: OpenBotMobileTokens.accent,
                badge: nil,
                action: { self.route = .groups })
            if let onOpenEmployeeWorkbench = self.onOpenEmployeeWorkbench {
                MeHubNavRow(
                    systemImage: "safari",
                    title: "员工工作台",
                    subtitle: "打开完整工作台",
                    tint: OpenBotMobileTokens.textSecondary,
                    badge: nil,
                    action: onOpenEmployeeWorkbench)
            }
            if self.listBusy {
                MeSoftBanner(text: "正在同步机器人 / 协作小组…")
            }
            if let listError = self.listError, !listError.isEmpty {
                MeSoftBanner(text: "加载失败：\(listError)", warn: true)
            }
        }
    }

    private var secondary: some View {
        MeSubScaffold(
            title: meHubRouteTitle(self.route, bots: self.bots, groups: self.groups),
            onBack: self.goBack,
            trailing: self.trailing)
        {
            switch self.route {
            case .accountInfo:
                MeAccountInfoPage(
                    identity: meIdentityCardFromAccount(email: self.accountEmail, orgId: self.accountOrgId))
            case .security:
                MeSecurityPage(onNotice: { notice in
                    self.notice = notice
                    self.route = .hub
                    self.segmentIndex = 0
                })
            case .prefs:
                MePrefsPage()
            case .auth:
                MeAuthPage(onOpenWorkbench: self.onOpenEmployeeWorkbench)
            case .connect, .permissions:
                SettingsTab(embedded: true)
            case .devices:
                MeDevicesPage(devices: self.devices, offline: !self.connected)
            case .voice:
                VoiceTab(embedded: true)
            case .canvas:
                ScreenTab()
            case .robots:
                MeEntityListPage(
                    emptyText: self.connected ? "暂无机器人（agents.list）。" : "未连接网关，无法读取机器人。",
                    busy: self.listBusy,
                    error: self.listError,
                    rows: self.bots.map { bot in
                        (id: bot.agentId, title: bot.name, subtitle: bot.subtitle, badge: meBotAccessBadge(bot.access))
                    },
                    onOpen: { self.route = .robot(agentId: $0) })
            case let .robot(agentId):
                if let bot = self.bots.first(where: { $0.agentId == agentId }) {
                    MeRobotWorkspacePage(
                        bot: bot,
                        connected: self.connected,
                        gateway: self.gateway,
                        onNotice: { self.notice = $0 },
                        onOpenGroup: { groupId in
                            if self.groups.contains(where: { $0.groupId == groupId }) {
                                self.route = .group(groupId: groupId)
                            } else {
                                self.notice = "未找到协作组 \(groupId)"
                                self.route = .hub
                                self.segmentIndex = 2
                            }
                        },
                        onIdentitySaved: { name, positioning, role, persona in
                            self.applyIdentity(
                                agentId: agentId,
                                name: name,
                                positioning: positioning,
                                role: role,
                                persona: persona)
                        })
                } else {
                    MeSoftBanner(text: "未选择机器人")
                        .padding(.horizontal, OpenBotMobileTokens.pageGutter)
                }
            case .createBot:
                MeCreateBotPage { name, emoji in
                    Task { await self.createBot(name: name, emoji: emoji) }
                }
            case .groups:
                MeEntityListPage(
                    emptyText: self.connected ? "暂无协作小组（collaboration.spaces.list）。" : "未连接网关，无法读取协作小组。",
                    busy: self.listBusy,
                    error: self.listError,
                    rows: self.groups.map { group in
                        (
                            id: group.groupId,
                            title: group.title,
                            subtitle: meGroupSubtitle(group),
                            badge: group.myRoleLabel)
                    },
                    onOpen: { self.route = .group(groupId: $0) })
            case let .group(groupId):
                if let group = self.groups.first(where: { $0.groupId == groupId }) {
                    MeGroupDetailPage(
                        group: group,
                        onSave: { title, purpose in
                            Task { await self.saveGroup(group, title: title, purpose: purpose) }
                        },
                        onInvite: { email in
                            Task { await self.inviteHuman(group, email: email) }
                        })
                } else {
                    MeSoftBanner(text: "未选择协作小组")
                        .padding(.horizontal, OpenBotMobileTokens.pageGutter)
                }
            case .createGroup:
                MeCreateGroupPage { title, avatar, purpose in
                    Task { await self.createGroup(title: title, avatar: avatar, purpose: purpose) }
                }
            case .hub:
                EmptyView()
            }
        }
    }

    private var trailing: AnyView? {
        switch self.route {
        case .robots:
            AnyView(MeCircleAddButton(label: "新建数字员工") { self.route = .createBot })
        case .groups:
            AnyView(MeCircleAddButton(label: "新建协作空间") { self.route = .createGroup })
        default:
            nil
        }
    }

    private func goBack() {
        switch self.route {
        case .robot:
            self.route = .robots
        case .createBot:
            self.route = .robots
        case .group:
            self.route = .groups
        case .createGroup:
            self.route = .groups
        default:
            self.route = .hub
        }
    }

    private func loadAccount() {
        guard let id = EmployeeAccountStore.activeAccountId(),
              let account = EmployeeAccountStore.load(accountId: id)
        else {
            self.accountEmail = nil
            self.accountOrgId = nil
            return
        }
        self.accountEmail = account.userEmail
        self.accountOrgId = account.activeOrgId
    }

    private func refreshVisible() async {
        switch self.route {
        case .devices:
            await self.refreshDevices()
        case .robots, .groups:
            await self.refreshMore()
        case .hub:
            if self.segmentIndex == 2 {
                await self.refreshMore()
            }
        default:
            break
        }
    }

    private func refreshMore() async {
        guard self.connected else {
            self.bots = []
            self.groups = []
            self.listBusy = false
            return
        }
        self.listBusy = true
        self.listError = nil
        do {
            let agentsRaw = try await self.request("agents.list")
            self.bots = parseAgentsListAsMeBots(agentsRaw)
            let spacesRaw = try await self.request("collaboration.spaces.list")
            var actors = Set<String>()
            if let email = self.accountEmail {
                actors.insert(email)
            }
            if let org = self.accountOrgId {
                actors.insert(org)
            }
            self.groups = parseCollaborationSpacesAsMeGroups(spacesRaw, actorKeys: actors)
        } catch {
            if self.isOffline(error) {
                self.bots = []
                self.groups = []
            } else {
                self.listError = meClipped(error.localizedDescription, fallback: "加载失败", limit: 160)
            }
        }
        self.listBusy = false
    }

    private func refreshDevices() async {
        guard self.connected else {
            self.devices = []
            return
        }
        do {
            let raw = try await self.request("device.pair.list")
            let current = self.instanceId.trimmingCharacters(in: .whitespacesAndNewlines)
            self.devices = parseDevicePairList(raw, currentDeviceId: current.isEmpty ? nil : current)
            self.listError = nil
        } catch {
            if !self.isOffline(error) {
                self.listError = meClipped(error.localizedDescription, fallback: "加载设备失败", limit: 160)
            }
        }
    }

    private func createBot(name: String, emoji: String?) async {
        guard self.connected else {
            self.notice = "未连接网关，无法创建"
            self.route = .hub
            self.segmentIndex = 2
            return
        }
        let slug = String(slugifyMeEntityId(prefix: "agent", title: name).dropFirst("agent-".count))
        do {
            let wsRaw = try await self.request(
                "workspaces.create",
                buildWorkspaceCreateLocalParams(name: name, agentSlug: slug))
            let created = parseWorkspaceCreateResult(wsRaw)
            let workspace = created.runtimePath ?? "\(meManagedWorkspaceRoot)/agents/\(slug.isEmpty ? "agent" : slug)"
            let agentRaw = try await self.request(
                "agents.create",
                buildAgentCreateParams(name: name, emoji: emoji, workspace: workspace))
            if let agentId = parseAgentCreateResult(agentRaw), let workspaceId = created.workspaceId,
               !workspaceId.isEmpty
            {
                _ = try? await self.request(
                    "robots.bind-workspace",
                    buildRobotBindWorkspaceParams(agentId: agentId, workspaceId: workspaceId))
            }
            self.notice = "已创建「\(name)」"
            await self.refreshMore()
            self.route = .robots
        } catch {
            let detail = meClipped(error.localizedDescription, fallback: "未知错误")
            self.notice = "创建失败：\(detail)（需网关支持 workspaces.create；云端向导仍见 Web）"
            self.route = .hub
            self.segmentIndex = 2
        }
    }

    private func createGroup(title: String, avatar: String?, purpose: String?) async {
        guard self.connected else {
            self.notice = "未连接网关，无法创建"
            self.route = .hub
            self.segmentIndex = 2
            return
        }
        let groupId = slugifyMeEntityId(prefix: "space", title: title)
        do {
            _ = try await self.request(
                "collaboration.spaces.members.update",
                buildSpaceCreateParams(groupId: groupId, title: title, avatar: avatar, purpose: purpose))
            self.notice = "已创建「\(title)」"
            await self.refreshMore()
            self.route = .groups
        } catch {
            self.notice = "创建失败：\(meClipped(error.localizedDescription, fallback: "未知错误"))"
            self.route = .hub
            self.segmentIndex = 2
        }
    }

    private func saveGroup(_ group: MeGroupRow, title: String, purpose: String?) async {
        guard self.connected else {
            self.notice = "未连接网关，无法保存设置"
            return
        }
        do {
            _ = try await self.request(
                "collaboration.spaces.members.update",
                buildSpaceCreateParams(groupId: group.groupId, title: title, avatar: group.avatar, purpose: purpose))
            self.notice = "已保存设置"
            await self.refreshMore()
            self.route = .groups
        } catch {
            self.notice = "保存失败：\(meClipped(error.localizedDescription, fallback: "未知错误"))"
        }
    }

    private func inviteHuman(_ group: MeGroupRow, email: String) async {
        guard self.connected else {
            self.notice = "未连接网关，无法邀请"
            return
        }
        let name = email.split(separator: "@", maxSplits: 1).first.map(String.init)
        do {
            _ = try await self.request(
                "collaboration.spaces.members.update",
                buildSpaceInviteHumanParams(
                    groupId: group.groupId,
                    title: group.title,
                    purpose: group.purpose,
                    inviteUserId: email,
                    inviteName: name))
            self.notice = "已发送邀请：\(email)"
            await self.refreshMore()
        } catch {
            self.notice = "邀请失败：\(meClipped(error.localizedDescription, fallback: "未知错误"))"
        }
    }

    private func applyIdentity(agentId: String, name: String, positioning: String?, role: String?, persona: String?) {
        self.bots = self.bots.map { bot in
            guard bot.agentId == agentId else { return bot }
            var copy = bot
            copy.name = name
            copy.positioning = positioning
            copy.roleTitle = role
            copy.persona = persona
            return copy
        }
    }

    private func request(_ method: String, _ params: String = "{}") async throws -> String {
        let data = try await self.gateway.request(method: method, paramsJSON: params, timeoutSeconds: 20)
        return String(data: data, encoding: .utf8) ?? ""
    }

    private func isOffline(_ error: Error) -> Bool {
        let ns = error as NSError
        if ns.domain == "Gateway", ns.code == 11 {
            return true
        }
        return ns.localizedDescription.lowercased().contains("not connected")
    }
}
