import OpenBotKit
import SwiftUI

/// Tasks tab: 定时任务 | 待我处理. Same Gateway methods as Android `MobileTasksScreen`.
/// Slim `cron.add` only (not the multi-step wizard). No task-result card / 打开全文.
struct TasksTabView: View {
    private let gateway: GatewayNodeSession

    @State private var segment: TasksSegment = .inbox
    @State private var listState: TasksListState = .loading
    @State private var notice: String?
    @State private var busyID: String?
    @State private var selectedAssigned: AssignedTaskRow?
    @State private var selectedCron: CronTaskRow?
    @State private var showCreate = false
    @State private var refreshTick = 0
    @State private var gatewayReady = false
    @State private var connectionKnown = false

    init(gateway: GatewayNodeSession) {
        self.gateway = gateway
    }

    var body: some View {
        self.screen
            .task(id: self.loadToken) {
                await self.reload()
            }
            .sheet(item: self.$selectedAssigned) { task in
                AssignedTaskDetailSheet(
                    task: task,
                    busy: self.busyID == task.id,
                    onDismiss: { self.selectedAssigned = nil },
                    onAccept: { self.accept(task) },
                    onComplete: { self.complete(task) })
            }
            .sheet(item: self.$selectedCron) { job in
                CronTaskDetailSheet(
                    job: job,
                    busy: self.busyID == job.id,
                    onDismiss: { self.selectedCron = nil },
                    onToggleEnabled: { enabled in self.setCronEnabled(job, enabled: enabled) },
                    onRunNow: { self.runCron(job) })
            }
            .sheet(isPresented: self.$showCreate) {
                CronCreateSheet(
                    connected: self.gatewayReady,
                    busy: self.busyID == Self.createBusyID,
                    onSubmit: { draft in self.create(draft) })
            }
    }

    private var loadToken: String {
        "\(self.segment.rawValue)#\(self.refreshTick)"
    }

    private var screen: some View {
        ZStack(alignment: .bottomTrailing) {
            ScrollView {
                VStack(alignment: .leading, spacing: 10) {
                    ModuleTitle(title: "任务")
                    SoTSegmentedControl(
                        options: ["定时任务", "待我处理"],
                        selectedIndex: self.segmentIndex)
                    if self.connectionKnown, !self.gatewayReady {
                        TasksBanner(
                            text: "未连接网关：连接后拉取定时任务与待我处理。",
                            tone: .warning)
                    }
                    if let notice, !notice.isEmpty {
                        TasksBanner(text: notice, tone: .neutral)
                    }
                    TasksSegmentBody(
                        segment: self.segment,
                        state: self.listState,
                        onOpenAssigned: { self.selectedAssigned = $0 },
                        onOpenCron: { self.selectedCron = $0 })
                }
                .padding(.horizontal, OpenBotMobileTokens.pageGutter)
                .padding(.top, OpenBotMobileTokens.pageVertical)
                .padding(.bottom, 88)
            }
            Button {
                self.showCreate = true
            } label: {
                Image(systemName: "plus")
                    .font(.system(size: 22, weight: .semibold))
                    .foregroundStyle(Color.white)
                    .frame(width: 56, height: 56)
                    .background(OpenBotMobileTokens.accent)
                    .clipShape(Circle())
                    .shadow(color: Color.black.opacity(0.12), radius: 8, y: 4)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("新建定时任务")
            .padding(.trailing, OpenBotMobileTokens.pageGutter)
            .padding(.bottom, 20)
        }
    }

    private var segmentIndex: Binding<Int> {
        Binding(
            get: { self.segment.rawValue },
            set: { newValue in
                let next = TasksSegment(rawValue: newValue) ?? .inbox
                guard next != self.segment else { return }
                self.notice = nil
                self.selectedAssigned = nil
                self.selectedCron = nil
                self.segment = next
            })
    }

    private static let createBusyID = "__create__"

    private func reload() async {
        let segment = self.segment
        self.listState = .loading
        do {
            let next = try await self.fetch(segment)
            if Task.isCancelled {
                return
            }
            self.gatewayReady = true
            self.connectionKnown = true
            self.listState = next
        } catch {
            if Task.isCancelled {
                return
            }
            self.connectionKnown = true
            if Self.isOffline(error) {
                self.gatewayReady = false
                self.listState = .offline
            } else {
                self.gatewayReady = true
                self.listState = .failed(Self.clipped(error, fallback: "加载失败"))
            }
        }
    }

    private func fetch(_ segment: TasksSegment) async throws -> TasksListState {
        switch segment {
        case .cron:
            let data = try await self.gateway.request(
                method: "cron.list",
                paramsJSON: #"{"includeDisabled":true,"limit":50,"offset":0}"#,
                timeoutSeconds: 15)
            let rows = parseCronJobsPayload(String(data: data, encoding: .utf8) ?? "")
            return rows.isEmpty ? .empty : .cron(rows)
        case .inbox:
            let data = try await self.gateway.request(
                method: "task.list",
                paramsJSON: "{}",
                timeoutSeconds: 15)
            let rows = inboxAssignedTasks(parseAssignedTasksPayload(String(data: data, encoding: .utf8) ?? ""))
            return rows.isEmpty ? .empty : .assigned(rows)
        }
    }

    private func accept(_ task: AssignedTaskRow) {
        self.mutate(
            TasksMutation(
                busyID: task.id,
                method: "task.accept",
                paramsJSON: buildTaskMutateParamsJSON(organizationId: task.organizationId, id: task.id),
                success: "已接受任务",
                failure: "接受失败",
                dismissAssigned: true))
    }

    private func complete(_ task: AssignedTaskRow) {
        self.mutate(
            TasksMutation(
                busyID: task.id,
                method: "task.complete",
                paramsJSON: buildTaskMutateParamsJSON(organizationId: task.organizationId, id: task.id),
                success: "已完成任务",
                failure: "完成失败",
                dismissAssigned: true))
    }

    private func setCronEnabled(_ job: CronTaskRow, enabled: Bool) {
        self.mutate(
            TasksMutation(
                busyID: job.id,
                method: "cron.update",
                paramsJSON: buildCronUpdateEnabledParamsJSON(id: job.id, enabled: enabled),
                success: enabled ? "已启用" : "已暂停",
                failure: "更新失败",
                dismissCron: true))
    }

    private func runCron(_ job: CronTaskRow) {
        self.mutate(
            TasksMutation(
                busyID: job.id,
                method: "cron.run",
                paramsJSON: buildCronRunParamsJSON(id: job.id),
                success: "已触发执行",
                failure: "执行失败",
                reloadAfter: false))
    }

    private func create(_ draft: CronAddDraft) {
        guard self.gatewayReady else {
            self.notice = "未连接网关，无法创建"
            return
        }
        self.mutate(
            TasksMutation(
                busyID: Self.createBusyID,
                method: "cron.add",
                paramsJSON: buildCronAddParamsJSON(draft),
                success: "已创建定时任务",
                failure: "创建失败",
                closeCreate: true,
                showCron: true))
    }

    private func mutate(_ action: TasksMutation) {
        guard self.busyID == nil else { return }
        self.busyID = action.busyID
        self.notice = nil
        Task {
            defer { self.busyID = nil }
            do {
                _ = try await self.gateway.request(
                    method: action.method,
                    paramsJSON: action.paramsJSON,
                    timeoutSeconds: 20)
                if action.dismissAssigned {
                    self.selectedAssigned = nil
                }
                if action.dismissCron {
                    self.selectedCron = nil
                }
                if action.closeCreate {
                    self.showCreate = false
                }
                if action.showCron {
                    self.segment = .cron
                }
                self.notice = action.success
                if action.reloadAfter {
                    self.refreshTick += 1
                }
            } catch {
                self.notice = Self.clipped(error, fallback: action.failure)
            }
        }
    }

    private static func isOffline(_ error: Error) -> Bool {
        let ns = error as NSError
        if ns.domain == "Gateway", ns.code == 11 {
            return true
        }
        return ns.localizedDescription.lowercased().contains("not connected")
    }

    private static func clipped(_ error: Error, fallback: String) -> String {
        let raw = error.localizedDescription.trimmingCharacters(in: .whitespacesAndNewlines)
        let text = raw.isEmpty ? fallback : raw
        if text.count <= 160 {
            return text
        }
        return String(text.prefix(160))
    }
}

private struct TasksMutation: Equatable, Sendable {
    var busyID: String
    var method: String
    var paramsJSON: String
    var success: String
    var failure: String
    var dismissAssigned: Bool = false
    var dismissCron: Bool = false
    var closeCreate: Bool = false
    var showCron: Bool = false
    var reloadAfter: Bool = true
}

private enum TasksSegment: Int, Equatable {
    case cron = 0
    case inbox = 1
}

private enum TasksListState: Equatable {
    case loading
    case empty
    case offline
    case failed(String)
    case assigned([AssignedTaskRow])
    case cron([CronTaskRow])
}

private struct TasksSegmentBody: View {
    var segment: TasksSegment
    var state: TasksListState
    var onOpenAssigned: (AssignedTaskRow) -> Void
    var onOpenCron: (CronTaskRow) -> Void

    var body: some View {
        switch self.state {
        case .loading:
            TasksLoadingRow(text: self.segment == .inbox ? "正在加载待我处理…" : "正在加载定时任务…")
        case .empty:
            TasksBanner(
                text: self.segment == .inbox
                    ? "暂无待处理任务。"
                    : "暂无定时任务。点右下角「+」创建（对齐 Web cron.add）。",
                tone: .neutral)
        case .offline:
            TasksBanner(text: "离线预览：连接网关后显示 Web 对齐清单。", tone: .neutral)
        case let .failed(message):
            TasksBanner(text: "加载失败：\(message)", tone: .warning)
        case let .assigned(items):
            VStack(alignment: .leading, spacing: 10) {
                TasksSectionLabel(text: "轻量工作队列")
                TasksCard {
                    ForEach(Array(items.enumerated()), id: \.element.id) { index, task in
                        AssignedTaskRowButton(
                            task: task,
                            showDivider: index < items.count - 1,
                            onOpen: { self.onOpenAssigned(task) })
                    }
                }
            }
        case let .cron(items):
            VStack(alignment: .leading, spacing: 10) {
                TasksSectionLabel(text: "定时任务")
                TasksCard {
                    ForEach(Array(items.enumerated()), id: \.element.id) { index, job in
                        CronTaskRowButton(
                            job: job,
                            showDivider: index < items.count - 1,
                            onOpen: { self.onOpenCron(job) })
                    }
                }
            }
        }
    }
}

private struct TasksLoadingRow: View {
    var text: String

    var body: some View {
        HStack(spacing: 10) {
            ProgressView()
                .controlSize(.small)
                .tint(OpenBotMobileTokens.accent)
            Text(self.text)
                .font(OpenBotMobileTokens.callout())
                .foregroundStyle(OpenBotMobileTokens.textSecondary)
            Spacer(minLength: 0)
        }
        .padding(.vertical, 12)
    }
}

private struct TasksBanner: View {
    enum Tone { case warning, neutral }
    var text: String
    var tone: Tone

    var body: some View {
        Text(self.text)
            .font(OpenBotMobileTokens.callout())
            .foregroundStyle(self.tone == .warning ? OpenBotMobileTokens.warning : OpenBotMobileTokens.textSecondary)
            .frame(maxWidth: .infinity, alignment: .leading)
            .fixedSize(horizontal: false, vertical: true)
            .padding(12)
            .background(self.tone == .warning ? OpenBotMobileTokens.warningSoft : Color.white)
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .stroke(OpenBotMobileTokens.border, lineWidth: 1))
    }
}

private struct TasksSectionLabel: View {
    var text: String

    var body: some View {
        Text(self.text)
            .font(OpenBotMobileTokens.caption1(.semibold))
            .foregroundStyle(OpenBotMobileTokens.textSecondary)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct TasksCard<Content: View>: View {
    @ViewBuilder var content: () -> Content

    var body: some View {
        VStack(spacing: 0) {
            self.content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.white)
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(OpenBotMobileTokens.border, lineWidth: 1))
    }
}

private struct AssignedTaskRowButton: View {
    var task: AssignedTaskRow
    var showDivider: Bool
    var onOpen: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            Button(action: self.onOpen) {
                HStack(alignment: .center, spacing: 10) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(self.task.title)
                            .font(OpenBotMobileTokens.headline())
                            .foregroundStyle(OpenBotMobileTokens.text)
                            .multilineTextAlignment(.leading)
                        TaskStatusChip(
                            label: assignedTaskStatusLabel(self.task.status),
                            tone: Self.tone(self.task.status))
                        if let due = formatAssignedDue(self.task.dueAt) {
                            Text(due)
                                .font(OpenBotMobileTokens.caption1())
                                .foregroundStyle(OpenBotMobileTokens.textTertiary)
                        }
                    }
                    Spacer(minLength: 8)
                    Image(systemName: "chevron.right")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(OpenBotMobileTokens.textTertiary)
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 14)
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            if self.showDivider {
                Rectangle()
                    .fill(OpenBotMobileTokens.border)
                    .frame(height: 1)
            }
        }
    }

    private static func tone(_ status: AssignedTaskStatus) -> TaskChipTone {
        switch status {
        case .pending, .completed, .unknown:
            .wait
        case .accepted, .running:
            .run
        case .rejected:
            .warn
        }
    }
}

private struct CronTaskRowButton: View {
    var job: CronTaskRow
    var showDivider: Bool
    var onOpen: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            Button(action: self.onOpen) {
                HStack(alignment: .center, spacing: 10) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(self.job.name)
                            .font(OpenBotMobileTokens.headline())
                            .foregroundStyle(OpenBotMobileTokens.text)
                            .multilineTextAlignment(.leading)
                        TaskStatusChip(
                            label: cronEnabledLabel(self.job.enabled),
                            tone: self.job.enabled ? .run : .wait)
                        Text(formatCronScheduleLabel(self.job))
                            .font(OpenBotMobileTokens.caption1())
                            .foregroundStyle(OpenBotMobileTokens.textTertiary)
                        if let next = formatCronNextRun(self.job.nextRunAtMs) {
                            Text(next)
                                .font(OpenBotMobileTokens.caption1())
                                .foregroundStyle(OpenBotMobileTokens.textTertiary)
                        }
                    }
                    Spacer(minLength: 8)
                    Image(systemName: "chevron.right")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(OpenBotMobileTokens.textTertiary)
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 14)
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            if self.showDivider {
                Rectangle()
                    .fill(OpenBotMobileTokens.border)
                    .frame(height: 1)
            }
        }
    }
}

private enum TaskChipTone {
    case wait
    case run
    case warn
}

private struct TaskStatusChip: View {
    var label: String
    var tone: TaskChipTone

    var body: some View {
        let colors = Self.colors(self.tone)
        Text(self.label)
            .font(OpenBotMobileTokens.caption2(.semibold))
            .foregroundStyle(colors.foreground)
            .padding(.horizontal, 8)
            .padding(.vertical, 2)
            .background(colors.background)
            .clipShape(Capsule())
    }

    private static func colors(_ tone: TaskChipTone) -> (background: Color, foreground: Color) {
        switch tone {
        case .wait:
            (Color(hex: 0xDBEAFE), Color(hex: 0x1D4ED8))
        case .run:
            (OpenBotMobileTokens.successSoft, OpenBotMobileTokens.success)
        case .warn:
            (Color(hex: 0xFFEDD5), Color(hex: 0xC2410C))
        }
    }
}

private struct AssignedTaskDetailSheet: View {
    var task: AssignedTaskRow
    var busy: Bool
    var onDismiss: () -> Void
    var onAccept: () -> Void
    var onComplete: () -> Void

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                TasksDetailNav(title: "任务详情", onBack: self.onDismiss)
                Text(self.task.title)
                    .font(OpenBotMobileTokens.title2(.bold))
                    .foregroundStyle(OpenBotMobileTokens.text)
                    .padding(.top, 4)
                    .padding(.bottom, 8)
                TaskStatusChip(
                    label: assignedTaskStatusLabel(self.task.status),
                    tone: AssignedTaskRowButton.exposedTone(self.task.status))
                if let due = formatAssignedDue(self.task.dueAt) {
                    TasksDetailMeta(label: "截止", value: Self.stripping("截止 ", from: due))
                        .padding(.top, 12)
                }
                if let source = self.sourceLabel {
                    TasksDetailMeta(label: "来源", value: source)
                }
                if let org = self.orgLabel {
                    TasksDetailMeta(label: "组织", value: org)
                }
                if let notes = self.task.notes, !notes.isEmpty {
                    Text(notes)
                        .font(OpenBotMobileTokens.callout())
                        .foregroundStyle(Color(hex: 0x374151))
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.top, 12)
                }
                HStack(spacing: 10) {
                    TasksPrimaryButton(
                        title: self.busy ? "处理中…" : "接受",
                        enabled: !self.busy && assignedTaskCanAccept(self.task.status),
                        action: self.onAccept)
                    TasksOutlineButton(
                        title: self.busy ? "处理中…" : "完成",
                        enabled: !self.busy && assignedTaskCanComplete(self.task.status),
                        action: self.onComplete)
                }
                .padding(.top, 18)
            }
            .padding(.horizontal, 16)
            .padding(.top, 14)
            .padding(.bottom, 28)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(Color.white)
        .presentationBackground(Color.white)
        .presentationDragIndicator(.hidden)
    }

    private var sourceLabel: String? {
        if self.task.sourceKind == "meeting", let sourceId = self.task.sourceId, !sourceId.isEmpty {
            return "会议 \(sourceId)"
        }
        if let sourceId = self.task.sourceId, !sourceId.isEmpty {
            return sourceId
        }
        return nil
    }

    private var orgLabel: String? {
        let org = self.task.organizationId
        if org.isEmpty || org == "demo-org" {
            return nil
        }
        return org
    }

    private static func stripping(_ prefix: String, from value: String) -> String {
        guard value.hasPrefix(prefix) else { return value }
        return String(value.dropFirst(prefix.count)).trimmingCharacters(in: .whitespacesAndNewlines)
    }
}

private struct CronTaskDetailSheet: View {
    var job: CronTaskRow
    var busy: Bool
    var onDismiss: () -> Void
    var onToggleEnabled: (Bool) -> Void
    var onRunNow: () -> Void

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                TasksDetailNav(title: "任务详情", onBack: self.onDismiss)
                Text(self.job.name)
                    .font(OpenBotMobileTokens.title2(.bold))
                    .foregroundStyle(OpenBotMobileTokens.text)
                TaskStatusChip(
                    label: cronEnabledLabel(self.job.enabled),
                    tone: self.job.enabled ? .run : .wait)
                TasksDetailMeta(label: "计划", value: formatCronScheduleLabel(self.job))
                if let next = formatCronNextRun(self.job.nextRunAtMs) {
                    TasksDetailMeta(label: "下次", value: Self.stripping("下次 ", from: next))
                }
                if let description = self.job.description, !description.isEmpty {
                    TasksDetailMeta(label: "描述", value: description)
                }
                if let message = self.job.payloadMessage, !message.isEmpty {
                    TasksDetailMeta(label: "执行内容", value: message)
                }
                HStack(spacing: 10) {
                    TasksPrimaryButton(
                        title: self.busy ? "处理中…" : (self.job.enabled ? "暂停" : "启用"),
                        enabled: !self.busy,
                        action: { self.onToggleEnabled(!self.job.enabled) })
                    TasksOutlineButton(
                        title: self.busy ? "处理中…" : "立即执行",
                        enabled: !self.busy,
                        action: self.onRunNow)
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 14)
            .padding(.bottom, 28)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(Color.white)
        .presentationBackground(Color.white)
        .presentationDragIndicator(.hidden)
    }

    private static func stripping(_ prefix: String, from value: String) -> String {
        guard value.hasPrefix(prefix) else { return value }
        return String(value.dropFirst(prefix.count)).trimmingCharacters(in: .whitespacesAndNewlines)
    }
}

private struct CronCreateSheet: View {
    var connected: Bool
    var busy: Bool
    var onSubmit: (CronAddDraft) -> Void

    @State private var name = ""
    @State private var message = ""
    @State private var scheduleKind = "cron"
    @State private var cronExpr = "0 9 * * *"
    @State private var everyAmount = "1"
    @State private var error: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                Text("新建定时任务")
                    .font(OpenBotMobileTokens.title2())
                    .foregroundStyle(OpenBotMobileTokens.text)
                Text("对齐 Web personal-cron-wizard → cron.add（精简字段：名称 / 执行内容 / 计划）。完整多步向导后续切片。")
                    .font(OpenBotMobileTokens.callout())
                    .foregroundStyle(OpenBotMobileTokens.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                TasksField(title: "任务名称", text: self.$name, prompt: "例如：每日晨会纪要汇总")
                TasksField(
                    title: "执行内容（agentTurn.message）",
                    text: self.$message,
                    prompt: "机器人每次触发时要做的事",
                    axis: .vertical)
                self.schedulePicker
                if self.scheduleKind == "cron" {
                    TasksField(title: "Cron 表达式", text: self.$cronExpr, prompt: "0 9 * * *")
                } else {
                    TasksField(title: "间隔天数", text: self.$everyAmount, prompt: "1")
                        .onChange(of: self.everyAmount) { _, newValue in
                            self.clampEvery(newValue)
                        }
                }
                if let error, !error.isEmpty {
                    Text(error)
                        .font(OpenBotMobileTokens.callout())
                        .foregroundStyle(OpenBotMobileTokens.danger)
                }
                TasksPrimaryButton(
                    title: self.busy ? "处理中…" : "创建",
                    enabled: self.connected && !self.busy,
                    action: self.submit)
            }
            .padding(.horizontal, 20)
            .padding(.top, 20)
            .padding(.bottom, 28)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(Color.white)
        .presentationBackground(Color.white)
    }

    private var schedulePicker: some View {
        HStack(spacing: 8) {
            self.kindButton("Cron 表达式", kind: "cron")
            self.kindButton("每隔…", kind: "every")
            Spacer(minLength: 0)
        }
    }

    private func kindButton(_ title: String, kind: String) -> some View {
        let selected = self.scheduleKind == kind
        return Button {
            self.scheduleKind = kind
        } label: {
            Text(title)
                .font(OpenBotMobileTokens.callout(selected ? .semibold : .medium))
                .foregroundStyle(selected ? OpenBotMobileTokens.accent : OpenBotMobileTokens.textSecondary)
        }
        .buttonStyle(.plain)
    }

    private func clampEvery(_ newValue: String) {
        let digits = newValue.filter(\.isNumber)
        let next = digits.isEmpty ? "1" : digits
        if next != newValue {
            self.everyAmount = next
        }
    }

    private func submit() {
        let trimmedName = self.name.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedMessage = self.message.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmedName.isEmpty {
            self.error = "请填写任务名称"
            return
        }
        if trimmedMessage.isEmpty {
            self.error = "请填写执行内容"
            return
        }
        self.error = nil
        let expr = self.cronExpr.trimmingCharacters(in: .whitespacesAndNewlines)
        self.onSubmit(
            CronAddDraft(
                name: trimmedName,
                message: trimmedMessage,
                scheduleKind: self.scheduleKind,
                everyAmount: max(Int(self.everyAmount) ?? 1, 1),
                everyUnit: "days",
                cronExpr: expr.isEmpty ? "0 9 * * *" : expr,
                description: ""))
    }
}

private struct TasksField: View {
    var title: String
    @Binding var text: String
    var prompt: String
    var axis: Axis = .horizontal

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(self.title)
                .font(OpenBotMobileTokens.caption1(.semibold))
                .foregroundStyle(OpenBotMobileTokens.textSecondary)
            TextField(
                "",
                text: self.$text,
                prompt: Text(self.prompt).foregroundStyle(OpenBotMobileTokens.textTertiary),
                axis: self.axis)
                .font(OpenBotMobileTokens.body())
                .foregroundStyle(OpenBotMobileTokens.text)
                .lineLimit(self.axis == .vertical ? 3...6 : 1...1)
                .padding(12)
                .background(Color.white)
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .stroke(OpenBotMobileTokens.border, lineWidth: 1))
        }
    }
}

private struct TasksDetailNav: View {
    var title: String
    var onBack: () -> Void

    var body: some View {
        HStack(spacing: 8) {
            Button(action: self.onBack) {
                Image(systemName: "chevron.left")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(OpenBotMobileTokens.text)
                    .frame(width: 32, height: 32)
                    .background(Color.white)
                    .clipShape(Circle())
                    .overlay(Circle().stroke(OpenBotMobileTokens.border, lineWidth: 1))
            }
            .buttonStyle(.plain)
            .accessibilityLabel("返回")
            Text(self.title)
                .font(OpenBotMobileTokens.headline())
                .foregroundStyle(OpenBotMobileTokens.text)
            Spacer(minLength: 0)
        }
        .padding(.bottom, 12)
    }
}

private struct TasksDetailMeta: View {
    var label: String
    var value: String

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Text(self.label)
                .font(OpenBotMobileTokens.callout())
                .foregroundStyle(OpenBotMobileTokens.textSecondary)
                .frame(minWidth: 72, alignment: .leading)
            Text(self.value)
                .font(OpenBotMobileTokens.callout())
                .foregroundStyle(OpenBotMobileTokens.text)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
        .padding(.vertical, 8)
    }
}

private struct TasksPrimaryButton: View {
    var title: String
    var enabled: Bool
    var action: () -> Void

    var body: some View {
        Button(action: self.action) {
            Text(self.title)
                .font(OpenBotMobileTokens.headline())
                .foregroundStyle(Color.white)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 14)
                .background(self.enabled ? OpenBotMobileTokens.accent : OpenBotMobileTokens.accent.opacity(0.4))
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        }
        .buttonStyle(.plain)
        .disabled(!self.enabled)
    }
}

private struct TasksOutlineButton: View {
    var title: String
    var enabled: Bool
    var action: () -> Void

    var body: some View {
        Button(action: self.action) {
            Text(self.title)
                .font(OpenBotMobileTokens.headline())
                .foregroundStyle(self.enabled ? OpenBotMobileTokens.textSecondary : OpenBotMobileTokens.textTertiary)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 14)
                .background(Color.white)
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .stroke(OpenBotMobileTokens.border, lineWidth: 1))
        }
        .buttonStyle(.plain)
        .disabled(!self.enabled)
    }
}

extension AssignedTaskRowButton {
    fileprivate static func exposedTone(_ status: AssignedTaskStatus) -> TaskChipTone {
        self.tone(status)
    }
}
