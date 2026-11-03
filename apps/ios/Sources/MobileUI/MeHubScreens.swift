import OpenBotKit
import SwiftUI

struct MeSubScaffold<Content: View>: View {
    var title: String
    var onBack: () -> Void
    var trailing: AnyView?
    var content: Content

    init(
        title: String,
        onBack: @escaping () -> Void,
        trailing: AnyView? = nil,
        @ViewBuilder content: () -> Content)
    {
        self.title = title
        self.onBack = onBack
        self.trailing = trailing
        self.content = content()
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                Button(action: self.onBack) {
                    Image(systemName: "chevron.left")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(OpenBotMobileTokens.text)
                        .frame(width: 32, height: 32)
                        .background(Color.white)
                        .clipShape(Circle())
                        .overlay(Circle().stroke(OpenBotMobileTokens.border, lineWidth: 1))
                }
                .buttonStyle(.plain)
                .accessibilityLabel("返回")

                VStack(spacing: 0) {
                    Text("我的")
                        .font(OpenBotMobileTokens.caption2(.semibold))
                        .foregroundStyle(OpenBotMobileTokens.textTertiary)
                    Text(self.title)
                        .font(OpenBotMobileTokens.headline(.bold))
                        .foregroundStyle(OpenBotMobileTokens.text)
                        .lineLimit(1)
                }
                .frame(maxWidth: .infinity)

                Group {
                    if let trailing = self.trailing {
                        trailing
                    } else {
                        Color.clear
                    }
                }
                .frame(width: 32, height: 32)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 6)

            self.content
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        }
    }
}

struct MeCircleAddButton: View {
    var label: String
    var action: () -> Void

    var body: some View {
        Button(action: self.action) {
            Image(systemName: "plus")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(OpenBotMobileTokens.accent)
                .frame(width: 32, height: 32)
                .background(Color.white)
                .clipShape(Circle())
                .overlay(Circle().stroke(OpenBotMobileTokens.border, lineWidth: 1))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(self.label)
    }
}

struct MeSoftBanner: View {
    var text: String
    var warn: Bool = false

    var body: some View {
        Text(self.text)
            .font(OpenBotMobileTokens.caption1())
            .foregroundStyle(self.warn ? OpenBotMobileTokens.warning : OpenBotMobileTokens.textSecondary)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(12)
            .background(self.warn ? OpenBotMobileTokens.warningSoft : OpenBotMobileTokens.surface)
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
    }
}

struct MeHubNavRow: View {
    var systemImage: String
    var title: String
    var subtitle: String
    var tint: Color
    var badge: String?
    var badgeWarn: Bool = false
    var action: () -> Void

    var body: some View {
        Button(action: self.action) {
            HStack(spacing: 12) {
                Image(systemName: self.systemImage)
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(self.tint)
                    .frame(width: 36, height: 36)
                    .background(OpenBotMobileTokens.surface)
                    .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                VStack(alignment: .leading, spacing: 2) {
                    Text(self.title)
                        .font(OpenBotMobileTokens.headline())
                        .foregroundStyle(OpenBotMobileTokens.text)
                    Text(self.subtitle)
                        .font(OpenBotMobileTokens.caption1())
                        .foregroundStyle(OpenBotMobileTokens.textSecondary)
                        .multilineTextAlignment(.leading)
                }
                Spacer(minLength: 8)
                if let badge = self.badge {
                    Text(badge)
                        .font(OpenBotMobileTokens.caption2(.semibold))
                        .foregroundStyle(self.badgeWarn ? OpenBotMobileTokens.warning : OpenBotMobileTokens.success)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 3)
                        .background(self.badgeWarn ? OpenBotMobileTokens.warningSoft : OpenBotMobileTokens.successSoft)
                        .clipShape(Capsule())
                }
                Image(systemName: "chevron.right")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(OpenBotMobileTokens.textTertiary)
            }
            .padding(12)
            .background(Color.white)
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .stroke(OpenBotMobileTokens.border, lineWidth: 1))
        }
        .buttonStyle(.plain)
    }
}

struct MeIdentityCardView: View {
    var state: MeIdentityCardState

    var body: some View {
        HStack(spacing: 12) {
            Text(self.state.avatarGlyph)
                .font(OpenBotMobileTokens.headline(.bold))
                .foregroundStyle(OpenBotMobileTokens.accent)
                .frame(width: 44, height: 44)
                .background(OpenBotMobileTokens.accentSoft)
                .clipShape(Circle())
            VStack(alignment: .leading, spacing: 3) {
                Text(self.state.displayName)
                    .font(OpenBotMobileTokens.headline())
                    .foregroundStyle(OpenBotMobileTokens.text)
                Text(self.state.email)
                    .font(OpenBotMobileTokens.callout())
                    .foregroundStyle(OpenBotMobileTokens.textSecondary)
                Text(self.state.orgLine)
                    .font(OpenBotMobileTokens.caption1())
                    .foregroundStyle(OpenBotMobileTokens.textTertiary)
            }
            Spacer(minLength: 0)
        }
        .padding(12)
        .background(Color.white)
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(OpenBotMobileTokens.border, lineWidth: 1))
    }
}

struct MeSectionLabel: View {
    var text: String

    var body: some View {
        Text(self.text)
            .font(OpenBotMobileTokens.caption1(.semibold))
            .foregroundStyle(OpenBotMobileTokens.textTertiary)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.top, 4)
    }
}

struct MePrimaryButton: View {
    var label: String
    var enabled: Bool = true
    var action: () -> Void

    var body: some View {
        Button(action: self.action) {
            Text(self.label)
                .font(OpenBotMobileTokens.headline(.semibold))
                .foregroundStyle(Color.white)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 12)
                .background(self.enabled ? OpenBotMobileTokens.accent : OpenBotMobileTokens.borderStrong)
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        }
        .buttonStyle(.plain)
        .disabled(!self.enabled)
    }
}

struct MeField: View {
    var label: String
    @Binding var text: String
    var disabled: Bool = false

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(self.label)
                .font(OpenBotMobileTokens.caption1(.semibold))
                .foregroundStyle(OpenBotMobileTokens.textTertiary)
            TextField(self.label, text: self.$text, axis: .vertical)
                .font(OpenBotMobileTokens.body())
                .foregroundStyle(OpenBotMobileTokens.text)
                .disabled(self.disabled)
                .padding(12)
                .background(Color.white)
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .stroke(OpenBotMobileTokens.border, lineWidth: 1))
        }
    }
}

struct MeInfoLine: View {
    var label: String
    var value: String

    var body: some View {
        HStack {
            Text(self.label)
                .font(OpenBotMobileTokens.callout())
                .foregroundStyle(OpenBotMobileTokens.textSecondary)
            Spacer(minLength: 8)
            Text(self.value)
                .font(OpenBotMobileTokens.callout(.semibold))
                .foregroundStyle(OpenBotMobileTokens.text)
                .multilineTextAlignment(.trailing)
        }
    }
}

struct MeDevicesPage: View {
    var devices: [MePairedDeviceRow]
    var offline: Bool

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                MeSoftBanner(text: "对齐 Web 系统设置 → 我的设备（device.pair.list）。")
                if self.offline {
                    MeSoftBanner(text: "未连接网关，无法读取已配对设备。", warn: true)
                } else if self.devices.isEmpty {
                    MeSoftBanner(text: "暂无已配对设备。")
                } else {
                    ForEach(self.devices) { device in
                        VStack(alignment: .leading, spacing: 4) {
                            HStack {
                                Text(device.displayName)
                                    .font(OpenBotMobileTokens.headline())
                                    .foregroundStyle(OpenBotMobileTokens.text)
                                Spacer()
                                if device.isCurrent {
                                    Text("本机")
                                        .font(OpenBotMobileTokens.caption2(.semibold))
                                        .foregroundStyle(OpenBotMobileTokens.accent)
                                }
                            }
                            Text(device.platform ?? device.deviceId)
                                .font(OpenBotMobileTokens.caption1())
                                .foregroundStyle(OpenBotMobileTokens.textSecondary)
                        }
                        .padding(12)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(Color.white)
                        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                        .overlay(
                            RoundedRectangle(cornerRadius: 14, style: .continuous)
                                .stroke(OpenBotMobileTokens.border, lineWidth: 1))
                    }
                }
            }
            .padding(.horizontal, OpenBotMobileTokens.pageGutter)
            .padding(.vertical, 8)
        }
    }
}

struct MeEntityListPage: View {
    var emptyText: String
    var busy: Bool
    var error: String?
    var rows: [(id: String, title: String, subtitle: String, badge: String?)]
    var onOpen: (String) -> Void

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                if self.busy {
                    MeSoftBanner(text: "正在同步…")
                }
                if let error = self.error, !error.isEmpty {
                    MeSoftBanner(text: "加载失败：\(error)", warn: true)
                }
                if !self.busy, self.rows.isEmpty, self.error == nil {
                    MeSoftBanner(text: self.emptyText)
                }
                ForEach(self.rows, id: \.id) { row in
                    Button {
                        self.onOpen(row.id)
                    } label: {
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(row.title)
                                    .font(OpenBotMobileTokens.headline())
                                    .foregroundStyle(OpenBotMobileTokens.text)
                                Text(row.subtitle)
                                    .font(OpenBotMobileTokens.caption1())
                                    .foregroundStyle(OpenBotMobileTokens.textSecondary)
                            }
                            Spacer(minLength: 8)
                            if let badge = row.badge {
                                Text(badge)
                                    .font(OpenBotMobileTokens.caption2(.semibold))
                                    .foregroundStyle(OpenBotMobileTokens.accent)
                                    .padding(.horizontal, 8)
                                    .padding(.vertical, 3)
                                    .background(OpenBotMobileTokens.accentSoft)
                                    .clipShape(Capsule())
                            }
                        }
                        .padding(12)
                        .background(Color.white)
                        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                        .overlay(
                            RoundedRectangle(cornerRadius: 14, style: .continuous)
                                .stroke(OpenBotMobileTokens.border, lineWidth: 1))
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, OpenBotMobileTokens.pageGutter)
            .padding(.vertical, 8)
        }
    }
}

struct MeCreateBotPage: View {
    var onCreate: (String, String?) -> Void

    @State private var name = ""
    @State private var emoji = "🤖"

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                MeSoftBanner(
                    text: "对齐 Web 新建数字员工：workspaces.create（受管 ~/.openbot/workspace）"
                        + " → agents.create → robots.bind-workspace。完整设计向导仍在 Web。")
                MeField(label: "名称", text: self.$name)
                MeField(label: "头像 emoji", text: self.$emoji)
                MePrimaryButton(
                    label: "创建",
                    enabled: !self.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                {
                    let trimmed = self.name.trimmingCharacters(in: .whitespacesAndNewlines)
                    let face = self.emoji.trimmingCharacters(in: .whitespacesAndNewlines)
                    self.onCreate(trimmed, face.isEmpty ? nil : face)
                }
            }
            .padding(.horizontal, OpenBotMobileTokens.pageGutter)
            .padding(.vertical, 8)
        }
    }
}

struct MeCreateGroupPage: View {
    var onCreate: (String, String?, String?) -> Void

    @State private var title = ""
    @State private var avatar = "👥"
    @State private var purpose = ""

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                MeSoftBanner(text: "复用 Web 新建协作空间（collaboration.spaces.members.update）。手机为精简表单。")
                MeField(label: "协作小组名称", text: self.$title)
                MeField(label: "头像", text: self.$avatar)
                MeField(label: "目标（可选）", text: self.$purpose)
                MePrimaryButton(
                    label: "创建",
                    enabled: !self.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                {
                    let name = self.title.trimmingCharacters(in: .whitespacesAndNewlines)
                    let face = self.avatar.trimmingCharacters(in: .whitespacesAndNewlines)
                    let goal = self.purpose.trimmingCharacters(in: .whitespacesAndNewlines)
                    self.onCreate(name, face.isEmpty ? nil : face, goal.isEmpty ? nil : goal)
                }
            }
            .padding(.horizontal, OpenBotMobileTokens.pageGutter)
            .padding(.vertical, 8)
        }
    }
}

struct MeGroupDetailPage: View {
    var group: MeGroupRow
    var onSave: (String, String?) -> Void
    var onInvite: (String) -> Void

    @State private var title: String
    @State private var purpose: String
    @State private var inviteEmail = ""

    init(group: MeGroupRow, onSave: @escaping (String, String?) -> Void, onInvite: @escaping (String) -> Void) {
        self.group = group
        self.onSave = onSave
        self.onInvite = onInvite
        self._title = State(initialValue: group.title)
        self._purpose = State(initialValue: group.purpose ?? "")
    }

    private var canEdit: Bool {
        self.group.myRoleLabel == "群主"
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                MeSectionLabel(text: "基本信息")
                MeField(label: "名称", text: self.$title, disabled: !self.canEdit)
                VStack(alignment: .leading, spacing: 8) {
                    MeInfoLine(label: "群主", value: self.group.ownerLabel ?? "—")
                    MeInfoLine(label: "主负责人（协调机器人）", value: self.group.coordinatorBotLabel ?? "—")
                    MeInfoLine(label: "我的角色", value: self.group.myRoleLabel)
                }
                .padding(12)
                .background(Color.white)
                .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .stroke(OpenBotMobileTokens.border, lineWidth: 1))
                MeField(label: "目标 / 说明", text: self.$purpose, disabled: !self.canEdit)
                if self.canEdit {
                    MePrimaryButton(label: "保存设置") {
                        let name = self.title.trimmingCharacters(in: .whitespacesAndNewlines)
                        let goal = self.purpose.trimmingCharacters(in: .whitespacesAndNewlines)
                        self.onSave(name.isEmpty ? self.group.title : name, goal.isEmpty ? nil : goal)
                    }
                }
                MeSectionLabel(text: "成员名单")
                if self.group.members.isEmpty {
                    MeSoftBanner(text: "暂无成员明细（collaboration.spaces.list members.humans/bots）。")
                } else {
                    VStack(alignment: .leading, spacing: 8) {
                        ForEach(self.group.members) { member in
                            MeInfoLine(label: member.kind == "bot" ? "机器人" : "成员", value: member.name)
                        }
                    }
                    .padding(12)
                    .background(Color.white)
                    .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: 14, style: .continuous)
                            .stroke(OpenBotMobileTokens.border, lineWidth: 1))
                }
                if self.canEdit {
                    MeSectionLabel(text: "邀请成员")
                    MeSoftBanner(text: "复用 Web collaboration.spaces.members.update invites.humans。")
                    MeField(label: "邮箱 / 用户 ID", text: self.$inviteEmail)
                    MePrimaryButton(
                        label: "邀请",
                        enabled: !self.inviteEmail.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    {
                        let email = self.inviteEmail.trimmingCharacters(in: .whitespacesAndNewlines)
                        self.inviteEmail = ""
                        self.onInvite(email)
                    }
                }
            }
            .padding(.horizontal, OpenBotMobileTokens.pageGutter)
            .padding(.vertical, 8)
        }
    }
}

struct MeRobotWorkspacePage: View {
    var bot: MeBotRow
    var connected: Bool
    var gateway: GatewayNodeSession
    var onNotice: (String) -> Void
    var onOpenGroup: (String) -> Void
    var onIdentitySaved: (String, String?, String?, String?) -> Void

    @State private var tab: MeBotWorkspaceTab = .identity
    @State private var detail: MeBotWorkspaceDetail?
    @State private var authRows: [MeBotAuthGrantRow] = []
    @State private var authSelected: Set<String> = []
    @State private var busy = false
    @State private var loadError: String?
    @State private var name: String
    @State private var positioning: String
    @State private var role: String
    @State private var persona: String

    init(
        bot: MeBotRow,
        connected: Bool,
        gateway: GatewayNodeSession,
        onNotice: @escaping (String) -> Void,
        onOpenGroup: @escaping (String) -> Void,
        onIdentitySaved: @escaping (String, String?, String?, String?) -> Void)
    {
        self.bot = bot
        self.connected = connected
        self.gateway = gateway
        self.onNotice = onNotice
        self.onOpenGroup = onOpenGroup
        self.onIdentitySaved = onIdentitySaved
        self._name = State(initialValue: bot.name)
        self._positioning = State(initialValue: bot.positioning ?? "")
        self._role = State(initialValue: bot.roleTitle ?? "")
        self._persona = State(initialValue: bot.persona ?? "")
    }

    private var canEdit: Bool {
        self.bot.access == .owned
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 6) {
                        ForEach(MeBotWorkspaceTab.allCases, id: \.self) { item in
                            let selected = item == self.tab
                            Button {
                                self.tab = item
                            } label: {
                                Text(meBotWorkspaceTabLabel(item))
                                    .font(OpenBotMobileTokens.caption1(selected ? .semibold : .medium))
                                    .foregroundStyle(selected ? OpenBotMobileTokens.accent : OpenBotMobileTokens
                                        .textSecondary)
                                    .padding(.horizontal, 10)
                                    .padding(.vertical, 6)
                                    .background(selected ? OpenBotMobileTokens.accentSoft : OpenBotMobileTokens
                                        .surfaceStrong)
                                    .clipShape(Capsule())
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
                if self.busy {
                    MeSoftBanner(text: "加载工作区…")
                }
                if let loadError = self.loadError, !loadError.isEmpty {
                    MeSoftBanner(text: loadError, warn: true)
                }
                switch self.tab {
                case .identity:
                    self.identityTab
                case .capabilities:
                    self.capabilitiesTab
                case .growth:
                    self.growthTab
                case .auth:
                    self.authTab
                case .collaboration:
                    self.collaborationTab
                }
            }
            .padding(.horizontal, OpenBotMobileTokens.pageGutter)
            .padding(.vertical, 8)
        }
        .task(id: self.bot.agentId) {
            await self.load()
        }
    }

    private var identityTab: some View {
        VStack(alignment: .leading, spacing: 12) {
            if !self.canEdit {
                MeSoftBanner(text: "协作中的机器人：身份只读。")
            }
            MeField(label: "名称", text: self.$name, disabled: !self.canEdit)
            MeField(label: "定位", text: self.$positioning, disabled: !self.canEdit)
            MeField(label: "角色", text: self.$role, disabled: !self.canEdit)
            MeField(label: "人格 / 模型（可选）", text: self.$persona, disabled: !self.canEdit)
            if self.canEdit {
                MePrimaryButton(label: "保存身份") {
                    Task { await self.saveIdentity() }
                }
            }
        }
    }

    private var capabilitiesTab: some View {
        let caps = self.detail?.capabilities ?? []
        let personas = self.detail?.personas ?? []
        return VStack(alignment: .leading, spacing: 12) {
            MeSectionLabel(text: "已安装")
            if caps.isEmpty {
                MeSoftBanner(text: "还没有安装能力。")
            } else {
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(caps) { cap in
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(cap.name)
                                    .font(OpenBotMobileTokens.headline())
                                    .foregroundStyle(OpenBotMobileTokens.text)
                                Text(String(repeating: "★", count: cap.stars) + String(
                                    repeating: "☆",
                                    count: 5 - cap.stars))
                                    .font(OpenBotMobileTokens.caption1())
                                    .foregroundStyle(OpenBotMobileTokens.textSecondary)
                            }
                            Spacer()
                            Text(cap.sourceLabel)
                                .font(OpenBotMobileTokens.caption1())
                                .foregroundStyle(OpenBotMobileTokens.textSecondary)
                        }
                    }
                }
                .padding(12)
                .background(Color.white)
                .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .stroke(OpenBotMobileTokens.border, lineWidth: 1))
            }
            MeSectionLabel(text: "扮演")
            if personas.isEmpty {
                MeSoftBanner(text: "暂无扮演身份。")
            } else {
                VStack(alignment: .leading, spacing: 6) {
                    ForEach(personas) { persona in
                        Text(persona.label)
                            .font(OpenBotMobileTokens.headline())
                            .foregroundStyle(OpenBotMobileTokens.text)
                        if let description = persona.description, !description.isEmpty {
                            Text(description)
                                .font(OpenBotMobileTokens.callout())
                                .foregroundStyle(OpenBotMobileTokens.textSecondary)
                        }
                    }
                }
                .padding(12)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color.white)
                .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .stroke(OpenBotMobileTokens.border, lineWidth: 1))
            }
            MePrimaryButton(label: "探索能力") {
                self.onNotice("探索能力请用 Web 能力中心")
            }
        }
    }

    private var growthTab: some View {
        let growth = self.detail?.growth ?? MeBotGrowthSummary()
        return VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 8) {
                MeInfoLine(label: "等级", value: "L\(growth.level)")
                MeInfoLine(label: "配置成熟度", value: growth.activationScore.map(String.init) ?? "—")
                MeInfoLine(label: "实战表现", value: growth.operationalScore.map(String.init) ?? "—")
                MeInfoLine(label: "能力就绪", value: growth.capabilityReadyLabel)
                MeInfoLine(label: "能力缺口", value: growth.gapCount > 0 ? "\(growth.gapCount) 项待补" : "无")
            }
            .padding(12)
            .background(Color.white)
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .stroke(OpenBotMobileTokens.border, lineWidth: 1))
            MeSoftBanner(text: "对齐 Web 成长档案：robot.workspace.get → growth。")
        }
    }

    private var authTab: some View {
        let enterprise = self.authRows.filter { $0.kind == "enterprise" }
        let personal = self.authRows.filter { $0.kind != "enterprise" }
        return VStack(alignment: .leading, spacing: 12) {
            MeSoftBanner(text: "运营授权读写走既有 grants 接口。OAuth / 微信绑定向导仍在 Web，不在手机内建。")
            MeSectionLabel(text: "企业身份")
            self.grantList(enterprise, empty: "企业暂未开放身份。")
            MeSectionLabel(text: "个人身份")
            self.grantList(personal, empty: "还没有个人身份。")
            if self.canEdit {
                MePrimaryButton(label: "确认授权") {
                    Task { await self.confirmGrants() }
                }
            }
        }
    }

    private var collaborationTab: some View {
        let collabs = self.detail?.collaborations ?? []
        return VStack(alignment: .leading, spacing: 10) {
            if collabs.isEmpty {
                MeSoftBanner(text: "尚未参与协作小组。")
            } else {
                ForEach(collabs) { row in
                    Button {
                        self.onOpenGroup(row.groupId)
                    } label: {
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(row.title)
                                    .font(OpenBotMobileTokens.headline())
                                    .foregroundStyle(OpenBotMobileTokens.text)
                                Text("参与中")
                                    .font(OpenBotMobileTokens.caption1())
                                    .foregroundStyle(OpenBotMobileTokens.textSecondary)
                            }
                            Spacer()
                            Image(systemName: "chevron.right")
                                .font(.system(size: 12, weight: .semibold))
                                .foregroundStyle(OpenBotMobileTokens.textTertiary)
                        }
                        .padding(12)
                        .background(Color.white)
                        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                        .overlay(
                            RoundedRectangle(cornerRadius: 14, style: .continuous)
                                .stroke(OpenBotMobileTokens.border, lineWidth: 1))
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    @ViewBuilder
    private func grantList(_ rows: [MeBotAuthGrantRow], empty: String) -> some View {
        if rows.isEmpty {
            MeSoftBanner(text: empty)
        } else {
            VStack(alignment: .leading, spacing: 8) {
                ForEach(rows) { row in
                    Toggle(isOn: Binding(
                        get: { self.authSelected.contains(row.identityId) },
                        set: { on in
                            if on {
                                self.authSelected.insert(row.identityId)
                            } else {
                                self.authSelected.remove(row.identityId)
                            }
                        })) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(row.title)
                                    .font(OpenBotMobileTokens.headline())
                                    .foregroundStyle(OpenBotMobileTokens.text)
                                Text(row.subtitle)
                                    .font(OpenBotMobileTokens.caption1())
                                    .foregroundStyle(OpenBotMobileTokens.textSecondary)
                            }
                        }
                        .disabled(!self.canEdit || !row.enabled)
                }
            }
            .padding(12)
            .background(Color.white)
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .stroke(OpenBotMobileTokens.border, lineWidth: 1))
        }
    }

    private func load() async {
        self.busy = true
        self.loadError = nil
        if !self.connected {
            self.detail = MeBotWorkspaceDetail(
                agentId: self.bot.agentId,
                name: self.bot.name,
                positioning: self.bot.positioning,
                role: self.bot.roleTitle,
                personaTraits: self.bot.persona)
            self.loadError = "未连接网关：仅展示列表缓存，能力/成长/授权需联网。"
            self.busy = false
            return
        }
        do {
            let raw = try await self.request(
                "robot.workspace.get",
                buildRobotWorkspaceGetParams(agentId: self.bot.agentId))
            if let parsed = parseRobotWorkspaceGet(raw) {
                self.detail = parsed
                self.name = parsed.name
                self.positioning = parsed.positioning ?? ""
                self.role = parsed.role ?? ""
                self.persona = parsed.personaTraits ?? ""
            } else {
                self.detail = MeBotWorkspaceDetail(
                    agentId: self.bot.agentId,
                    name: self.bot.name,
                    positioning: self.bot.positioning,
                    role: self.bot.roleTitle,
                    personaTraits: self.bot.persona)
            }
            self.authRows = await self.loadGrants()
            self.authSelected = Set(self.authRows.filter(\.enrolled).map(\.identityId))
        } catch {
            self.loadError = meClipped(error.localizedDescription, fallback: "加载工作区失败")
            self.detail = MeBotWorkspaceDetail(
                agentId: self.bot.agentId,
                name: self.bot.name,
                positioning: self.bot.positioning,
                role: self.bot.roleTitle,
                personaTraits: self.bot.persona)
        }
        self.busy = false
    }

    private func loadGrants() async -> [MeBotAuthGrantRow] {
        if let raw = try? await self.request(
            "user-operational-identity.access.list-for-agent",
            buildRobotWorkspaceGetParams(agentId: self.bot.agentId))
        {
            let rows = parseAgentAccessListForGrants(raw)
            if !rows.isEmpty {
                return rows
            }
        }
        if let raw = try? await self.request("user-operational-identity.list", "{}") {
            return meAuthGrantsFromIdentities(parseUserOperationalIdentities(raw))
        }
        return []
    }

    private func saveIdentity() async {
        let savedName = self.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            ? self.bot.name
            : self.name.trimmingCharacters(in: .whitespacesAndNewlines)
        let savedPosition = self.blankToNil(self.positioning)
        let savedRole = self.blankToNil(self.role)
        let savedPersona = self.blankToNil(self.persona)
        guard self.connected else {
            self.onNotice("未连接网关，无法保存身份")
            return
        }
        do {
            _ = try await self.request(
                "robot.workspace.updateIdentity",
                buildRobotIdentityUpdateParams(
                    agentId: self.bot.agentId,
                    name: savedName,
                    positioning: savedPosition,
                    role: savedRole,
                    personaTraits: savedPersona))
            self.onNotice("已保存身份")
            self.onIdentitySaved(savedName, savedPosition, savedRole, savedPersona)
        } catch {
            self.onNotice("保存失败：\(meClipped(error.localizedDescription, fallback: "未知错误"))")
        }
    }

    private func confirmGrants() async {
        guard self.connected else {
            self.onNotice("未连接网关，无法确认授权")
            return
        }
        let scope = self.bot.access == .owned ? "owned" : "shared"
        do {
            var added = 0
            for id in self.authSelected {
                _ = try await self.request(
                    "user-operational-identity.grants.upsert",
                    buildRobotIdentityGrantUpsertParams(identityId: id, agentId: self.bot.agentId, agentScope: scope))
                added += 1
            }
            self.onNotice("已确认授权（\(added)）")
        } catch {
            self.onNotice("授权失败：\(meClipped(error.localizedDescription, fallback: "未知错误"))")
        }
    }

    private func request(_ method: String, _ params: String) async throws -> String {
        let data = try await self.gateway.request(method: method, paramsJSON: params, timeoutSeconds: 20)
        return String(data: data, encoding: .utf8) ?? ""
    }

    private func blankToNil(_ value: String) -> String? {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}

func meClipped(_ raw: String, fallback: String, limit: Int = 140) -> String {
    let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
    let text = trimmed.isEmpty ? fallback : trimmed
    if text.count <= limit {
        return text
    }
    return String(text.prefix(limit))
}


// MARK: - Account hub pages (Android MeTabScreen SoT)

struct MeAccountInfoPage: View {
    var identity: MeIdentityCardState

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                MeSoftBanner(text: "账号资料当前为只读，完整编辑请到员工工作台。")
                MeSectionLabel(text: "个人资料")
                VStack(alignment: .leading, spacing: 10) {
                    MeInfoLine(label: "显示名称", value: self.identity.displayName)
                    MeInfoLine(label: "邮箱", value: self.identity.email)
                }
                .padding(12)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color.white)
                .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .stroke(OpenBotMobileTokens.border, lineWidth: 1))
                MeSectionLabel(text: "企业与岗位")
                VStack(alignment: .leading, spacing: 10) {
                    MeInfoLine(label: "组织", value: self.identity.orgLine)
                }
                .padding(12)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color.white)
                .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .stroke(OpenBotMobileTokens.border, lineWidth: 1))
            }
            .padding(.horizontal, OpenBotMobileTokens.pageGutter)
            .padding(.vertical, 8)
        }
    }
}

struct MeSecurityPage: View {
    var onNotice: (String) -> Void
    @State private var current = ""
    @State private var next = ""
    @State private var confirm = ""
    @State private var busy = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                MeSoftBanner(text: "用于修改登录密码。")
                MeSectionLabel(text: "修改密码")
                SecureField("当前密码", text: self.$current)
                    .textContentType(.password)
                    .padding(12)
                    .background(Color.white)
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: 12, style: .continuous)
                            .stroke(OpenBotMobileTokens.border, lineWidth: 1))
                SecureField("新密码", text: self.$next)
                    .textContentType(.newPassword)
                    .padding(12)
                    .background(Color.white)
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: 12, style: .continuous)
                            .stroke(OpenBotMobileTokens.border, lineWidth: 1))
                SecureField("确认新密码", text: self.$confirm)
                    .textContentType(.newPassword)
                    .padding(12)
                    .background(Color.white)
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: 12, style: .continuous)
                            .stroke(OpenBotMobileTokens.border, lineWidth: 1))
                MePrimaryButton(label: self.busy ? "保存中…" : "保存") {
                    self.submit()
                }
                .disabled(self.busy)
                .opacity(self.busy ? 0.6 : 1)
            }
            .padding(.horizontal, OpenBotMobileTokens.pageGutter)
            .padding(.vertical, 8)
        }
    }

    private func submit() {
        if self.current.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            self.onNotice("请输入当前密码")
            return
        }
        if self.next.count < 8 {
            self.onNotice("新密码至少 8 位")
            return
        }
        if self.next != self.confirm {
            self.onNotice("两次输入的新密码不一致")
            return
        }
        if self.next == self.current {
            self.onNotice("新密码不能与当前密码相同")
            return
        }
        self.busy = true
        Task {
            let outcome = await PlatformAuthClient.changePassword(
                currentPassword: self.current,
                newPassword: self.next)
            await MainActor.run {
                self.busy = false
                switch outcome {
                case .success:
                    self.onNotice("密码已更新")
                case let .notice(message):
                    self.onNotice(message)
                case .mfaRequired:
                    self.onNotice("改密失败：需要二次验证，请到员工工作台完成")
                case let .failure(message):
                    self.onNotice("改密失败：\(message)")
                }
            }
        }
    }
}

struct MePrefsPage: View {
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                MeSoftBanner(text: "语言与主题跟随系统；完整偏好可在员工工作台调整。")
                MeSectionLabel(text: "界面与语言")
                VStack(alignment: .leading, spacing: 10) {
                    MeInfoLine(label: "语言", value: "跟随系统")
                    MeInfoLine(label: "主题", value: "跟随系统")
                }
                .padding(12)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color.white)
                .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .stroke(OpenBotMobileTokens.border, lineWidth: 1))
            }
            .padding(.horizontal, OpenBotMobileTokens.pageGutter)
            .padding(.vertical, 8)
        }
    }
}

struct MeAuthPage: View {
    var onOpenWorkbench: (() -> Void)?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                MeSoftBanner(text: "查看工作身份与可用模型；完整授权可在员工工作台完成。")
                MeSectionLabel(text: "工作身份")
                MeHubNavRow(
                    systemImage: "person.badge.key",
                    title: "打开员工工作台授权",
                    subtitle: "OAuth / 微信向导留在 Web",
                    tint: OpenBotMobileTokens.accent,
                    badge: nil,
                    action: {
                        if let open = self.onOpenWorkbench { open() }
                    })
            }
            .padding(.horizontal, OpenBotMobileTokens.pageGutter)
            .padding(.vertical, 8)
        }
    }
}
