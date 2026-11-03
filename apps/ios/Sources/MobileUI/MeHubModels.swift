import Foundation

// Me hub read/write models. Mirrors Android `MeHubModels`.
// Gateway names match Web employee + Android (no iOS-only endpoints):
// `device.pair.list`, `agents.list`, `agents.create`, `workspaces.create`,
// `robots.bind-workspace`, `robot.workspace.get`, `robot.workspace.updateIdentity`,
// `collaboration.spaces.list`, `collaboration.spaces.members.update`,
// `user-operational-identity.list`, `user-operational-identity.access.list-for-agent`,
// `user-operational-identity.grants.upsert`.
// Identity OAuth / WeChat wizard stays on Web (calibrated ignore).

let meManagedWorkspaceRoot = "~/.openbot/workspace"

enum MeBotAccess: String, Equatable, Sendable {
    case owned
    case collab
}

enum MeBotWorkspaceTab: String, Equatable, Sendable, CaseIterable {
    case identity
    case capabilities
    case growth
    case auth
    case collaboration
}

enum MeIdentityZone: String, Equatable, Sendable {
    case personal
    case enterprise
    case model
}

enum MeHubRoute: Equatable, Sendable {
    case hub
    case accountInfo
    case security
    case prefs
    case auth
    case connect
    case permissions
    case devices
    case voice
    case canvas
    case robots
    case robot(agentId: String)
    case createBot
    case groups
    case group(groupId: String)
    case createGroup
}

struct MeBotCapabilityRow: Equatable, Sendable, Identifiable {
    var name: String
    var stars: Int
    var sourceLabel: String

    var id: String {
        self.name
    }
}

struct MeBotPersonaRow: Equatable, Sendable, Identifiable {
    var id: String
    var label: String
    var description: String?
}

struct MeBotCollabRow: Equatable, Sendable, Identifiable {
    var groupId: String
    var title: String
    var sessionKey: String?

    var id: String {
        self.groupId
    }
}

struct MeBotGrowthSummary: Equatable, Sendable {
    var level: Int = 0
    var activationScore: Int?
    var operationalScore: Int?
    var gapCount: Int = 0
    var capabilityReadyLabel: String = "—"
}

struct MeBotAuthGrantRow: Equatable, Sendable, Identifiable {
    var identityId: String
    var title: String
    var subtitle: String
    var kind: String
    var enrolled: Bool
    var enabled: Bool = true

    var id: String {
        self.identityId
    }
}

struct MeBotWorkspaceDetail: Equatable, Sendable {
    var agentId: String
    var name: String
    var positioning: String?
    var role: String?
    var personaTraits: String?
    var model: String?
    var statusLabel: String = "可用"
    var capabilities: [MeBotCapabilityRow] = []
    var personas: [MeBotPersonaRow] = []
    var growth: MeBotGrowthSummary = .init()
    var collaborations: [MeBotCollabRow] = []
}

struct MeIdentityCardState: Equatable, Sendable {
    var displayName: String
    var email: String
    var orgLine: String
    var avatarGlyph: String
}

struct MeAuthResourceRow: Equatable, Sendable, Identifiable {
    var id: String
    var title: String
    var subtitle: String
    var zone: MeIdentityZone
    var provider: String?
    var status: String?
}

struct MeBotRow: Equatable, Sendable, Identifiable {
    var agentId: String
    var name: String
    var emoji: String?
    var access: MeBotAccess
    var subtitle: String
    var positioning: String?
    var persona: String?
    var roleTitle: String?
    var isDefault: Bool = false

    var id: String {
        self.agentId
    }
}

struct MeGroupMemberRow: Equatable, Sendable, Identifiable {
    var id: String
    var name: String
    var kind: String
    var roleHint: String?
}

struct MeGroupRow: Equatable, Sendable, Identifiable {
    var groupId: String
    var title: String
    var avatar: String?
    var memberCount: Int
    var myRoleLabel: String
    var ownerLabel: String?
    var coordinatorBotLabel: String?
    var purpose: String?
    var members: [MeGroupMemberRow] = []

    var id: String {
        self.groupId
    }
}

struct MePairedDeviceRow: Equatable, Sendable, Identifiable {
    var deviceId: String
    var displayName: String
    var platform: String?
    var isCurrent: Bool = false

    var id: String {
        self.deviceId
    }
}

struct MeWorkspaceCreateResult: Equatable, Sendable {
    var workspaceId: String?
    var runtimePath: String?
}

func meBotAccessBadge(_ access: MeBotAccess) -> String {
    switch access {
    case .owned:
        "可管理"
    case .collab:
        "协作中"
    }
}

func meGroupSubtitle(_ row: MeGroupRow) -> String {
    let count = max(row.memberCount, 0)
    return "\(count) 人 · \(row.myRoleLabel)"
}

func meConnectBadge(connected: Bool) -> String {
    connected ? "已连接" : "未连接"
}

func meDevicePairBadge(_ count: Int) -> String {
    count <= 0 ? "—" : "\(count) 台"
}

func meBotWorkspaceTabLabel(_ tab: MeBotWorkspaceTab) -> String {
    switch tab {
    case .identity:
        "身份"
    case .capabilities:
        "能力"
    case .growth:
        "成长"
    case .auth:
        "运营授权"
    case .collaboration:
        "协作"
    }
}

func meHubRouteTitle(_ route: MeHubRoute, bots: [MeBotRow], groups: [MeGroupRow]) -> String {
    switch route {
    case .hub:
        "我的"
    case .accountInfo:
        "账号信息"
    case .security:
        "账号安全"
    case .prefs:
        "偏好"
    case .auth:
        "授权"
    case .connect:
        "连接网关"
    case .permissions:
        "设备与权限"
    case .devices:
        "我的设备"
    case .voice:
        "语音对话"
    case .canvas:
        "画布"
    case .robots:
        "我的机器人"
    case let .robot(agentId):
        bots.first { $0.agentId == agentId }?.name ?? "编辑机器人"
    case .createBot:
        "新建数字员工"
    case .groups:
        "我的协作小组"
    case let .group(groupId):
        groups.first { $0.groupId == groupId }?.title ?? "协作小组"
    case .createGroup:
        "新建协作空间"
    }
}

func meGatewayIsConnected(statusText: String, serverName: String?) -> Bool {
    statusText.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() == "connected"
        && !(serverName?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ?? true)
}

func meIdentityCardFromAccount(
    email: String?,
    orgId: String?,
    displayNameHint: String? = nil) -> MeIdentityCardState
{
    let trimmedEmail = email?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    let hint = displayNameHint?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    let local = trimmedEmail.split(separator: "@", maxSplits: 1).first.map(String.init) ?? ""
    let name = !hint.isEmpty ? hint : (!local.isEmpty ? local : "未登录员工账号")
    let glyph = name.first(where: { !$0.isWhitespace }).map { String($0).uppercased() } ?? "·"
    let orgBlank = orgId?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty != false
    let orgLine = if orgBlank && trimmedEmail.isEmpty {
        "连接网关并登录后同步身份"
    } else if orgBlank {
        "个人账号"
    } else {
        "组织 \(orgId?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "")"
    }
    let display = (trimmedEmail.isEmpty && hint.isEmpty) ? "未登录员工账号" : name
    return MeIdentityCardState(
        displayName: display,
        email: trimmedEmail.isEmpty ? "—" : trimmedEmail,
        orgLine: orgLine,
        avatarGlyph: glyph)
}

func meCapabilitySourceLabel(_ source: String?) -> String {
    switch source?.lowercased() {
    case "personal":
        return "个人"
    case "group":
        return "小组"
    case "enterprise":
        return "企业"
    case "marketplace":
        return "市场"
    default:
        let trimmed = source?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return trimmed.isEmpty ? "—" : trimmed
    }
}

func parseAgentsListAsMeBots(_ raw: String) -> [MeBotRow] {
    guard let root = meJSONObject(raw) else { return [] }
    let defaultId = meNonEmpty(root["defaultId"]) ?? ""
    guard let agents = root["agents"] as? [Any] else { return [] }
    return agents.compactMap { element in
        guard let obj = element as? [String: Any] else { return nil }
        guard let id = meNonEmpty(obj["id"]) else { return nil }
        let identity = obj["identity"] as? [String: Any]
        let name = meNonEmpty(obj["name"]) ?? meNonEmpty(identity?["name"]) ?? id
        let emoji = meNonEmpty(identity?["emoji"]) ?? meNonEmpty(obj["emoji"])
        let isDefault = id == defaultId || (defaultId.isEmpty && id == "main")
        let ownership = meNonEmpty(obj["ownership"]).map { $0.caseInsensitiveCompare("owned") == .orderedSame }
        let ownedHint = meJSONBool(obj["isOwner"]) ?? meJSONBool(obj["owned"]) ?? ownership ?? isDefault
        let access: MeBotAccess = (isDefault || ownedHint) ? .owned : .collab
        return MeBotRow(
            agentId: id,
            name: name,
            emoji: emoji,
            access: access,
            subtitle: isDefault ? "固定首位管家" : "可用",
            positioning: meNonEmpty(identity?["theme"]) ?? meNonEmpty(identity?["positioning"]),
            persona: meNonEmpty(identity?["persona"]) ?? meNonEmpty(identity?["personaTraits"]),
            roleTitle: meNonEmpty(identity?["role"]) ?? meNonEmpty(identity?["roleTitle"]),
            isDefault: isDefault)
    }
}

func parseCollaborationSpacesAsMeGroups(_ raw: String, actorKeys: Set<String> = []) -> [MeGroupRow] {
    guard let root = meJSONObject(raw), let spaces = root["spaces"] as? [Any] else { return [] }
    let actors = Set(actorKeys.map { $0.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() }
        .filter { !$0.isEmpty })
    return spaces.compactMap { element in
        guard let obj = element as? [String: Any] else { return nil }
        guard let rawId = meNonEmpty(obj["groupId"]) ?? meNonEmpty(obj["id"]) else { return nil }
        let title = meNonEmpty(obj["title"]) ?? meNonEmpty(obj["name"]) ?? rawId
        let operating = (obj["operatingState"] as? [String: Any])?["governance"] as? [String: Any]
        let ownerUserId = meNonEmpty(obj["ownerUserId"]) ?? meNonEmpty(operating?["ownerUserId"])
        let ownerLabel = meNonEmpty(obj["ownerUserLabel"]) ?? meNonEmpty(obj["ownerLabel"]) ?? ownerUserId
        let coordinator = meNonEmpty(obj["coordinatorBotLabel"]) ?? meNonEmpty(obj["coordinatorBotId"])
        let membersObj = obj["members"] as? [String: Any]
        let humans = membersObj?["humans"] as? [Any] ?? []
        let bots = membersObj?["bots"] as? [Any] ?? []
        var roster: [MeGroupMemberRow] = []
        for element in humans {
            guard let member = element as? [String: Any] else { continue }
            guard let id = meNonEmpty(member["userId"]) ?? meNonEmpty(member["id"]) else { continue }
            let name = meNonEmpty(member["name"]) ?? meNonEmpty(member["handle"]) ?? id
            roster.append(MeGroupMemberRow(id: id, name: name, kind: "human", roleHint: nil))
        }
        for element in bots {
            guard let member = element as? [String: Any] else { continue }
            guard let id = meNonEmpty(member["agentId"]) ?? meNonEmpty(member["id"]) else { continue }
            let name = meNonEmpty(member["name"]) ?? id
            roster.append(MeGroupMemberRow(id: id, name: name, kind: "bot", roleHint: nil))
        }
        let memberCount: Int = if !roster.isEmpty {
            roster.count
        } else if let count = meJSONInt(obj["memberCount"]) {
            count
        } else {
            (obj["memberIds"] as? [Any])?.count ?? 0
        }
        let ownerKey = ownerUserId?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() ?? ""
        let roleLabel = if actors.isEmpty {
            "成员"
        } else if !ownerKey.isEmpty, actors.contains(ownerKey) {
            "群主"
        } else {
            "成员"
        }
        let groupId = rawId.hasPrefix("space:") ? String(rawId.dropFirst("space:".count)) : rawId
        return MeGroupRow(
            groupId: groupId,
            title: title,
            avatar: meNonEmpty(obj["avatar"]),
            memberCount: memberCount,
            myRoleLabel: roleLabel,
            ownerLabel: ownerLabel,
            coordinatorBotLabel: coordinator,
            purpose: meNonEmpty(obj["purpose"]),
            members: roster)
    }
}

func parseUserOperationalIdentities(_ raw: String) -> [MeAuthResourceRow] {
    guard let root = meJSONObject(raw) else { return [] }
    let identities = root["identities"] as? [Any] ?? []
    return identities.compactMap { element in
        guard let obj = element as? [String: Any], let id = meNonEmpty(obj["identityId"]) else { return nil }
        let provider = meJSONString(obj["provider"])?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let label = meNonEmpty(obj["providerLabel"]) ?? provider
        let display = meJSONString(obj["displayName"])?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let status = meJSONString(obj["status"])?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let statusLabel: String = switch status.lowercased() {
        case "active":
            "已绑定"
        case "expired":
            "已过期"
        case "reauth_required":
            "需重新授权"
        case "revoked":
            "已撤销"
        default:
            status.isEmpty ? "—" : status
        }
        let lowered = provider.lowercased()
        let zone: MeIdentityZone = if lowered.contains("enterprise") || lowered.contains("wecom") || lowered
            .contains("dingtalk")
        {
            .enterprise
        } else {
            .personal
        }
        let title = display.isEmpty ? label : "\(label) · \(display)"
        return MeAuthResourceRow(
            id: id,
            title: title,
            subtitle: statusLabel,
            zone: zone,
            provider: provider.isEmpty ? nil : provider,
            status: status.isEmpty ? nil : status)
    }
}

func parseEnterpriseSeatIdentities(_ raw: String) -> [MeAuthResourceRow] {
    guard let root = meJSONObject(raw) else { return [] }
    let list = (root["identities"] as? [Any]) ?? (root["entries"] as? [Any]) ?? (root["items"] as? [Any]) ?? []
    return list.compactMap { element in
        guard let obj = element as? [String: Any] else { return nil }
        guard let id = meNonEmpty(obj["identityId"]) ?? meNonEmpty(obj["id"]) else { return nil }
        let title = meNonEmpty(obj["label"]) ?? meNonEmpty(obj["displayName"]) ?? meNonEmpty(obj["providerLabel"]) ?? id
        let subtitle = meNonEmpty(obj["seatTitle"]) ?? meNonEmpty(obj["status"]) ?? "企业身份"
        return MeAuthResourceRow(
            id: id,
            title: title,
            subtitle: subtitle,
            zone: .enterprise,
            provider: meNonEmpty(obj["provider"]),
            status: meNonEmpty(obj["status"]))
    }
}

func parseDevicePairList(_ raw: String, currentDeviceId: String? = nil) -> [MePairedDeviceRow] {
    guard let root = meJSONObject(raw), let paired = root["paired"] as? [Any] else { return [] }
    let current = currentDeviceId?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    return paired.compactMap { element in
        guard let obj = element as? [String: Any], let id = meNonEmpty(obj["deviceId"]) else { return nil }
        let name = meNonEmpty(obj["displayName"]) ?? String(id.prefix(8))
        return MePairedDeviceRow(
            deviceId: id,
            displayName: name,
            platform: meNonEmpty(obj["platform"]) ?? meNonEmpty(obj["deviceFamily"]),
            isCurrent: !current.isEmpty && id == current)
    }
}

func parseRobotWorkspaceGet(_ raw: String) -> MeBotWorkspaceDetail? {
    guard let root = meJSONObject(raw) else { return nil }
    let bot = (root["bot"] as? [String: Any]) ?? root
    guard let agentId = meNonEmpty(bot["agentId"]) else { return nil }
    let identity = bot["identity"] as? [String: Any]
    let name = meNonEmpty(identity?["name"]) ?? meNonEmpty(bot["name"]) ?? agentId
    let statusLabel = switch meNonEmpty(identity?["status"])?.lowercased() {
    case "online":
        "可用"
    case "degraded":
        "异常"
    case "offline":
        "离线"
    default:
        "未知"
    }
    let caps = ((bot["capabilities"] as? [Any]) ?? []).compactMap { element -> MeBotCapabilityRow? in
        guard let obj = element as? [String: Any], let capName = meNonEmpty(obj["name"]) else { return nil }
        let stars = min(max(meJSONInt(obj["stars"]) ?? 0, 0), 5)
        return MeBotCapabilityRow(
            name: capName,
            stars: stars,
            sourceLabel: meCapabilitySourceLabel(meNonEmpty(obj["source"])))
    }
    let personas = ((bot["personas"] as? [Any]) ?? []).compactMap { element -> MeBotPersonaRow? in
        guard let obj = element as? [String: Any], let id = meNonEmpty(obj["id"]) else { return nil }
        return MeBotPersonaRow(
            id: id,
            label: meNonEmpty(obj["label"]) ?? id,
            description: meNonEmpty(obj["description"]))
    }
    let growthObj = bot["growth"] as? [String: Any]
    let gaps = growthObj?["capabilityGaps"] as? [Any] ?? []
    let unmet = gaps.filter { element in
        guard let obj = element as? [String: Any] else { return false }
        return meNonEmpty(obj["status"])?.caseInsensitiveCompare("missing") == .orderedSame
    }.count
    let funnel = growthObj?["funnel"] as? [String: Any]
    let ready = meJSONBool(funnel?["hasFirstSkillInstalled"]) == true ? "已起步" : "待安装"
    let growth = MeBotGrowthSummary(
        level: meJSONInt(growthObj?["level"]) ?? 0,
        activationScore: meJSONInt(growthObj?["activationScore"]),
        operationalScore: meJSONInt(growthObj?["operationalScore"]),
        gapCount: unmet,
        capabilityReadyLabel: ready)
    let collabs = ((bot["collaborations"] as? [Any]) ?? []).compactMap { element -> MeBotCollabRow? in
        guard let obj = element as? [String: Any], let gid = meNonEmpty(obj["groupId"]) else { return nil }
        return MeBotCollabRow(
            groupId: gid,
            title: meNonEmpty(obj["title"]) ?? gid,
            sessionKey: meNonEmpty(obj["sessionKey"]))
    }
    return MeBotWorkspaceDetail(
        agentId: agentId,
        name: name,
        positioning: meNonEmpty(identity?["positioning"]),
        role: meNonEmpty(identity?["role"]),
        personaTraits: meNonEmpty(identity?["personaTraits"]),
        model: meNonEmpty(identity?["model"]),
        statusLabel: statusLabel,
        capabilities: caps,
        personas: personas,
        growth: growth,
        collaborations: collabs)
}

func parseAgentAccessListForGrants(_ raw: String) -> [MeBotAuthGrantRow] {
    guard let root = meJSONObject(raw) else { return [] }
    let list = (root["identities"] as? [Any])
        ?? (root["grants"] as? [Any])
        ?? (root["entries"] as? [Any])
        ?? (root["items"] as? [Any])
        ?? []
    return list.compactMap { element in
        guard let obj = element as? [String: Any] else { return nil }
        guard let id = meNonEmpty(obj["identityId"]) ?? meNonEmpty(obj["id"]) else { return nil }
        let title = meNonEmpty(obj["displayName"]) ?? meNonEmpty(obj["providerLabel"]) ?? meNonEmpty(obj["label"]) ?? id
        let subtitle = meNonEmpty(obj["providerLabel"]) ?? meNonEmpty(obj["status"]) ?? "—"
        let kind = if meNonEmpty(obj["kind"])?.lowercased()
            .contains("enterprise") == true || meJSONBool(obj["enterprise"]) == true
        {
            "enterprise"
        } else {
            "personal"
        }
        let enrolled = meJSONBool(obj["enrolled"])
            ?? meJSONBool(obj["granted"])
            ?? (meNonEmpty(obj["status"])?.caseInsensitiveCompare("active") == .orderedSame)
        let status = meNonEmpty(obj["status"])
        let resolvedEnabled = status == nil || status?.caseInsensitiveCompare("active") == .orderedSame
        return MeBotAuthGrantRow(
            identityId: id,
            title: title,
            subtitle: subtitle,
            kind: kind,
            enrolled: enrolled,
            enabled: resolvedEnabled)
    }
}

func parseEmployeeModelAccessSummary(_ raw: String) -> [MeAuthResourceRow] {
    guard let root = meJSONObject(raw) else { return [] }
    let summary = (root["summary"] as? [String: Any]) ?? root
    let state = meJSONString(summary["state"])?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    let reason = meJSONString(summary["reason"])?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    let seatId = meNonEmpty(summary["seatId"])
    let models = summary["modelIds"] as? [Any] ?? []
    if models.isEmpty {
        let subtitle: String = if !reason.isEmpty {
            reason
        } else if state == "missing" {
            "当前账号未绑定企业席位，暂无模型授权信息"
        } else {
            "暂无可用模型"
        }
        return [
            MeAuthResourceRow(
                id: "model-empty",
                title: "可用模型",
                subtitle: subtitle,
                zone: .model,
                provider: nil,
                status: state.isEmpty ? nil : state),
        ]
    }
    return models.enumerated().map { index, element in
        let id: String
        let title: String
        if let text = meNonEmpty(element) {
            id = text
            title = text
        } else if let obj = element as? [String: Any] {
            id = meNonEmpty(obj["id"]) ?? meNonEmpty(obj["modelId"]) ?? meNonEmpty(obj["model"]) ?? "model-\(index)"
            title = meNonEmpty(obj["label"]) ?? meNonEmpty(obj["name"]) ?? id
        } else {
            id = "model-\(index)"
            title = id
        }
        var subtitle = "席位可用"
        if let seatId {
            subtitle += " · seat \(seatId)"
        }
        if !reason.isEmpty, index == 0 {
            subtitle += " · \(reason)"
        }
        return MeAuthResourceRow(
            id: id,
            title: title,
            subtitle: subtitle,
            zone: .model,
            provider: nil,
            status: state.isEmpty ? "resolved" : state)
    }
}

func parseWorkspaceCreateResult(_ raw: String) -> MeWorkspaceCreateResult {
    guard let root = meJSONObject(raw) else {
        return MeWorkspaceCreateResult(workspaceId: nil, runtimePath: nil)
    }
    return MeWorkspaceCreateResult(
        workspaceId: meNonEmpty(root["workspaceId"]),
        runtimePath: meNonEmpty(root["runtimePath"]))
}

func parseAgentCreateResult(_ raw: String) -> String? {
    guard let root = meJSONObject(raw) else { return nil }
    return meNonEmpty(root["agentId"])
}

func buildRobotIdentityGrantUpsertParams(
    identityId: String,
    agentId: String,
    agentScope: String,
    allowedActions: [String] = ["*"]) -> String
{
    meJSONString([
        "identityId": identityId,
        "agentId": agentId,
        "agentScope": agentScope,
        "allowedActions": allowedActions,
        "grantMode": agentScope == "owned" ? "auto" : "explicit",
        "confirmExplicit": agentScope != "owned",
    ])
}

func buildRobotIdentityUpdateParams(
    agentId: String,
    name: String,
    positioning: String?,
    role: String?,
    personaTraits: String?) -> String
{
    var identity: [String: Any] = ["name": name]
    if let positioning = meTrimmed(positioning) {
        identity["positioning"] = positioning
    }
    if let role = meTrimmed(role) {
        identity["role"] = role
    }
    if let personaTraits = meTrimmed(personaTraits) {
        identity["personaTraits"] = personaTraits
    }
    return meJSONString([
        "agentId": agentId,
        "identity": identity,
    ])
}

func buildRobotWorkspaceGetParams(agentId: String) -> String {
    meJSONString(["agentId": agentId])
}

func buildSpaceCreateParams(groupId: String, title: String, avatar: String?, purpose: String?) -> String {
    var payload: [String: Any] = [
        "groupId": groupId,
        "title": title,
        "collaborationMode": "discussion_driven",
        "members": [
            "humans": [Any](),
            "bots": [Any](),
        ],
    ]
    if let avatar = meTrimmed(avatar) {
        payload["avatar"] = avatar
    }
    if let purpose = meTrimmed(purpose) {
        payload["purpose"] = purpose
    }
    return meJSONString(payload)
}

func buildSpaceInviteHumanParams(
    groupId: String,
    title: String,
    purpose: String?,
    inviteUserId: String,
    inviteName: String? = nil) -> String
{
    var human: [String: Any] = ["userId": inviteUserId.trimmingCharacters(in: .whitespacesAndNewlines)]
    if let inviteName = meTrimmed(inviteName) {
        human["name"] = inviteName
    }
    var payload: [String: Any] = [
        "groupId": groupId,
        "title": title,
        "members": [
            "humans": [Any](),
            "bots": [Any](),
        ],
        "invites": [
            "humans": [human],
            "bots": [Any](),
        ],
    ]
    if let purpose = meTrimmed(purpose) {
        payload["purpose"] = purpose
    }
    return meJSONString(payload)
}

func buildWorkspaceCreateLocalParams(name: String, agentSlug: String) -> String {
    let slug = meTrimmed(agentSlug) ?? "agent"
    let path = "\(meManagedWorkspaceRoot)/agents/\(slug)"
    return meJSONString([
        "name": "\(name) Workspace",
        "kind": "local",
        "local": ["path": path],
    ])
}

func buildAgentCreateParams(name: String, emoji: String?, workspace: String) -> String {
    var payload: [String: Any] = [
        "name": name,
        "workspace": workspace,
    ]
    if let emoji = meTrimmed(emoji) {
        payload["emoji"] = emoji
    }
    return meJSONString(payload)
}

func buildRobotBindWorkspaceParams(agentId: String, workspaceId: String) -> String {
    meJSONString([
        "agentId": agentId,
        "workspaceId": workspaceId,
    ])
}

func slugifyMeEntityId(prefix: String, title: String) -> String {
    let lowered = title.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    let replaced: String
    if let pattern = meSlugPattern {
        let range = NSRange(lowered.startIndex..., in: lowered)
        replaced = pattern.stringByReplacingMatches(in: lowered, range: range, withTemplate: "-")
    } else {
        replaced = lowered
    }
    let slug = String(replaced.trimmingCharacters(in: CharacterSet(charactersIn: "-")).prefix(32))
    let body = slug.isEmpty ? "item" : slug
    return "\(prefix)-\(body)"
}

func meAuthGrantsFromIdentities(_ rows: [MeAuthResourceRow]) -> [MeBotAuthGrantRow] {
    rows.map { row in
        MeBotAuthGrantRow(
            identityId: row.id,
            title: row.title,
            subtitle: row.subtitle,
            kind: row.zone == .enterprise ? "enterprise" : "personal",
            enrolled: false,
            enabled: true)
    }
}

private let meSlugPattern: NSRegularExpression? = try? NSRegularExpression(
    pattern: "[^a-z0-9\u{4e00}-\u{9fff}]+")

func meJSONObject(_ raw: String) -> [String: Any]? {
    let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty, let data = trimmed.data(using: .utf8) else { return nil }
    return try? JSONSerialization.jsonObject(with: data) as? [String: Any]
}

func meJSONString(_ object: Any) -> String {
    guard JSONSerialization.isValidJSONObject(object),
          let data = try? JSONSerialization.data(withJSONObject: object, options: [.withoutEscapingSlashes])
    else { return "{}" }
    return String(data: data, encoding: .utf8) ?? "{}"
}

private func meJSONString(_ value: Any?) -> String? {
    guard let value, !(value is NSNull) else { return nil }
    if let text = value as? String {
        return text
    }
    if let number = value as? NSNumber {
        if CFGetTypeID(number) == CFBooleanGetTypeID() {
            return nil
        }
        return String(number.int64Value)
    }
    return nil
}

private func meNonEmpty(_ value: Any?) -> String? {
    let trimmed = meJSONString(value)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    return trimmed.isEmpty ? nil : trimmed
}

private func meTrimmed(_ value: String?) -> String? {
    let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    return trimmed.isEmpty ? nil : trimmed
}

private func meJSONBool(_ value: Any?) -> Bool? {
    guard let value, !(value is NSNull) else { return nil }
    if let number = value as? NSNumber, CFGetTypeID(number) == CFBooleanGetTypeID() {
        return number.boolValue
    }
    if let text = value as? String {
        if text.caseInsensitiveCompare("true") == .orderedSame {
            return true
        }
        if text.caseInsensitiveCompare("false") == .orderedSame {
            return false
        }
    }
    return nil
}

private func meJSONInt(_ value: Any?) -> Int? {
    guard let value, !(value is NSNull) else { return nil }
    if let number = value as? NSNumber {
        if CFGetTypeID(number) == CFBooleanGetTypeID() {
            return nil
        }
        return number.intValue
    }
    if let text = value as? String {
        return Int(text.trimmingCharacters(in: .whitespacesAndNewlines))
    }
    return nil
}
