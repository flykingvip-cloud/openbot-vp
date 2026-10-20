import Foundation

// Web-aligned Tasks models. Mirrors Android `TasksWebModels` and the employee
// assigned-task center + personal cron list. No private endpoints.
//
// Assigned: `task.list` / `task.accept` / `task.complete`
// Cron: `cron.list` / `cron.add` / `cron.update` / `cron.run`

enum AssignedTaskStatus: String, Equatable, Sendable {
    case pending
    case accepted
    case running
    case completed
    case rejected
    case unknown
}

func parseAssignedTaskStatus(_ raw: String?) -> AssignedTaskStatus {
    switch raw?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() {
    case "pending": .pending
    case "accepted": .accepted
    case "running": .running
    case "completed": .completed
    case "rejected": .rejected
    default: .unknown
    }
}

func assignedTaskStatusLabel(_ status: AssignedTaskStatus) -> String {
    switch status {
    case .pending: "待接受"
    case .accepted: "已接受"
    case .running: "进行中"
    case .completed: "已完成"
    case .rejected: "已拒绝"
    case .unknown: "未知"
    }
}

func assignedTaskCanAccept(_ status: AssignedTaskStatus) -> Bool {
    status == .pending
}

func assignedTaskCanComplete(_ status: AssignedTaskStatus) -> Bool {
    status == .accepted || status == .running
}

func inboxAssignedTasks(_ rows: [AssignedTaskRow]) -> [AssignedTaskRow] {
    rows.filter { row in
        switch row.status {
        case .pending, .accepted, .running:
            true
        case .completed, .rejected, .unknown:
            false
        }
    }
}

struct AssignedTaskRow: Equatable, Identifiable, Sendable {
    var id: String
    var organizationId: String
    var title: String
    var status: AssignedTaskStatus
    var dueAt: String?
    var notes: String?
    var sourceKind: String?
    var sourceId: String?
    var updatedAt: String?
    var ownerAgentId: String?
}

struct CronTaskRow: Equatable, Identifiable, Sendable {
    var id: String
    var name: String
    var description: String?
    var enabled: Bool
    var scheduleKind: String?
    var scheduleExpr: String?
    var scheduleEveryMs: Int64?
    var scheduleAt: String?
    var nextRunAtMs: Int64?
    var lastStatus: String?
    var payloadMessage: String?
    var agentId: String?
    var sessionKey: String?
}

struct CronAddDraft: Equatable, Sendable {
    var name: String
    var message: String
    var scheduleKind: String
    var everyAmount: Int
    var everyUnit: String
    var cronExpr: String
    var description: String
}

func formatAssignedDue(_ dueAt: String?) -> String? {
    let raw = dueAt?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    if raw.isEmpty {
        return nil
    }
    let ms: Int64
    if let parsed = Int64(raw) {
        ms = parsed
    } else if let date = tasksParseISO8601(raw) {
        ms = Int64((date.timeIntervalSince1970 * 1000.0).rounded())
    } else {
        return "截止 \(raw)"
    }
    if ms <= 0 {
        return nil
    }
    return "截止 \(tasksFormatMonthDayTime(ms))"
}

func formatCronScheduleLabel(_ job: CronTaskRow) -> String {
    switch job.scheduleKind?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() {
    case "every":
        guard let ms = job.scheduleEveryMs else { return "周期任务" }
        if ms % 86_400_000 == 0 {
            return "每 \(ms / 86_400_000) 天"
        }
        if ms % 3_600_000 == 0 {
            return "每 \(ms / 3_600_000) 小时"
        }
        if ms % 60000 == 0 {
            return "每 \(ms / 60000) 分钟"
        }
        return "每 \(ms / 1000) 秒"
    case "cron":
        let expr = job.scheduleExpr?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return expr.isEmpty ? "Cron" : "🔁 \(expr)"
    case "at":
        let at = job.scheduleAt?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return at.isEmpty ? "单次" : "单次 \(at)"
    default:
        let expr = job.scheduleExpr?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return expr.isEmpty ? "定时任务" : expr
    }
}

func formatCronNextRun(_ nextRunAtMs: Int64?) -> String? {
    guard let nextRunAtMs, nextRunAtMs > 0 else { return nil }
    return "下次 \(tasksFormatMonthDayTime(nextRunAtMs))"
}

func cronEnabledLabel(_ enabled: Bool) -> String {
    enabled ? "已启用" : "已暂停"
}

func parseAssignedTasksPayload(_ payloadJSON: String) -> [AssignedTaskRow] {
    guard let tasks = tasksJSONArray(payloadJSON, key: "tasks") else { return [] }
    var rows: [AssignedTaskRow] = []
    for case let obj as [String: Any] in tasks {
        let id = tasksTrimmed(tasksString(obj["id"]))
        let title = tasksTrimmed(tasksString(obj["title"]))
        if id.isEmpty || title.isEmpty {
            continue
        }
        let source = obj["sourceRef"] as? [String: Any]
        rows.append(
            AssignedTaskRow(
                id: id,
                organizationId: tasksTrimmed(tasksString(obj["organizationId"])),
                title: title,
                status: parseAssignedTaskStatus(tasksString(obj["status"])),
                dueAt: tasksString(obj["dueAt"]),
                notes: tasksEmptyNil(tasksString(obj["notes"])),
                sourceKind: tasksEmptyNil(tasksString(source?["kind"])),
                sourceId: tasksEmptyNil(tasksString(source?["id"])),
                updatedAt: tasksString(obj["updatedAt"]),
                ownerAgentId: tasksEmptyNil(tasksString(obj["ownerAgentId"]))))
    }
    return rows
}

func parseCronJobsPayload(_ payloadJSON: String) -> [CronTaskRow] {
    guard let jobs = tasksJSONArray(payloadJSON, key: "jobs") else { return [] }
    var rows: [CronTaskRow] = []
    for case let obj as [String: Any] in jobs {
        let id = tasksTrimmed(tasksString(obj["id"]))
        let name = tasksTrimmed(tasksString(obj["name"]))
        if id.isEmpty || name.isEmpty {
            continue
        }
        let schedule = obj["schedule"] as? [String: Any]
        let payload = obj["payload"] as? [String: Any]
        let state = obj["state"] as? [String: Any]
        rows.append(
            CronTaskRow(
                id: id,
                name: name,
                description: tasksEmptyNil(tasksString(obj["description"])),
                enabled: tasksEnabledFlag(obj["enabled"]),
                scheduleKind: tasksEmptyNil(tasksString(schedule?["kind"])),
                scheduleExpr: tasksEmptyNil(tasksString(schedule?["expr"])),
                scheduleEveryMs: tasksInt64(schedule?["everyMs"]),
                scheduleAt: tasksEmptyNil(tasksString(schedule?["at"])),
                nextRunAtMs: tasksInt64(state?["nextRunAtMs"]) ?? tasksInt64(obj["nextRunAtMs"]),
                lastStatus: tasksEmptyNil(tasksString(state?["lastStatus"]))
                    ?? tasksEmptyNil(tasksString(state?["lastRunStatus"])),
                payloadMessage: tasksCronPayloadMessage(payload),
                agentId: tasksEmptyNil(tasksString(obj["agentId"])),
                sessionKey: tasksEmptyNil(tasksString(obj["sessionKey"]))))
    }
    return rows
}

func buildCronAddParamsJSON(_ draft: CronAddDraft) -> String {
    let kind = draft.scheduleKind.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    let schedule: [String: Any]
    if kind == "cron" {
        let expr = draft.cronExpr.trimmingCharacters(in: .whitespacesAndNewlines)
        schedule = [
            "kind": "cron",
            "expr": expr.isEmpty ? "0 9 * * *" : expr,
        ]
    } else {
        let mult: Int64 = switch draft.everyUnit.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() {
        case "minutes":
            60000
        case "hours":
            3_600_000
        default:
            86_400_000
        }
        let amount = Int64(max(draft.everyAmount, 1))
        schedule = [
            "kind": "every",
            "everyMs": amount * mult,
        ]
    }
    let body: [String: Any] = [
        "name": draft.name.trimmingCharacters(in: .whitespacesAndNewlines),
        "description": draft.description.trimmingCharacters(in: .whitespacesAndNewlines),
        "enabled": true,
        "deleteAfterRun": false,
        "schedule": schedule,
        "sessionTarget": "isolated",
        "wakeMode": "now",
        "payload": [
            "kind": "agentTurn",
            "message": draft.message.trimmingCharacters(in: .whitespacesAndNewlines),
        ],
        "delivery": [
            "mode": "announce",
            "channel": "last",
            "surfaces": ["workbench-agent-main"],
        ],
    ]
    return tasksJSONString(body)
}

func buildTaskMutateParamsJSON(organizationId: String, id: String) -> String {
    tasksJSONString([
        "organizationId": organizationId,
        "id": id,
    ])
}

func buildCronUpdateEnabledParamsJSON(id: String, enabled: Bool) -> String {
    tasksJSONString([
        "id": id,
        "patch": [
            "enabled": enabled,
        ],
    ])
}

func buildCronRunParamsJSON(id: String, mode: String = "force") -> String {
    tasksJSONString([
        "id": id,
        "mode": mode,
    ])
}

private func tasksCronPayloadMessage(_ payload: [String: Any]?) -> String? {
    guard let payload else { return nil }
    let kind = tasksString(payload["kind"])?.lowercased() ?? ""
    switch kind {
    case "agentturn":
        return tasksEmptyNil(tasksString(payload["message"]))
    case "systemevent":
        return tasksEmptyNil(tasksString(payload["text"]))
    default:
        return tasksEmptyNil(tasksString(payload["message"])) ?? tasksEmptyNil(tasksString(payload["text"]))
    }
}

private func tasksFormatMonthDayTime(_ epochMs: Int64) -> String {
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "zh_CN")
    formatter.timeZone = .current
    formatter.dateFormat = "MM-dd HH:mm"
    return formatter.string(from: Date(timeIntervalSince1970: Double(epochMs) / 1000.0))
}

private func tasksParseISO8601(_ raw: String) -> Date? {
    let fractional = ISO8601DateFormatter()
    fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let date = fractional.date(from: raw) {
        return date
    }
    let basic = ISO8601DateFormatter()
    basic.formatOptions = [.withInternetDateTime]
    return basic.date(from: raw)
}

private func tasksJSONObject(_ raw: String) -> [String: Any]? {
    let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty, let data = trimmed.data(using: .utf8) else { return nil }
    return try? JSONSerialization.jsonObject(with: data) as? [String: Any]
}

private func tasksJSONArray(_ raw: String, key: String) -> [Any]? {
    guard let object = tasksJSONObject(raw) else { return nil }
    return object[key] as? [Any]
}

private func tasksString(_ value: Any?) -> String? {
    guard let value, !(value is NSNull) else { return nil }
    if let text = value as? String {
        return text
    }
    if let number = value as? NSNumber {
        if CFGetTypeID(number) == CFBooleanGetTypeID() {
            return number.boolValue ? "true" : "false"
        }
        return String(number.int64Value)
    }
    return nil
}

private func tasksTrimmed(_ value: String?) -> String {
    value?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
}

private func tasksEmptyNil(_ value: String?) -> String? {
    let trimmed = tasksTrimmed(value)
    return trimmed.isEmpty ? nil : trimmed
}

private func tasksInt64(_ value: Any?) -> Int64? {
    guard let value, !(value is NSNull) else { return nil }
    if let number = value as? NSNumber {
        if CFGetTypeID(number) == CFBooleanGetTypeID() {
            return nil
        }
        return number.int64Value
    }
    if let text = value as? String {
        return Int64(text.trimmingCharacters(in: .whitespacesAndNewlines))
    }
    return nil
}

private func tasksEnabledFlag(_ value: Any?) -> Bool {
    guard let value, !(value is NSNull) else { return true }
    if let number = value as? NSNumber {
        if CFGetTypeID(number) == CFBooleanGetTypeID() {
            return number.boolValue
        }
        return true
    }
    if let text = value as? String {
        switch text.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() {
        case "true":
            return true
        case "false":
            return false
        default:
            return true
        }
    }
    return true
}

private func tasksJSONString(_ object: Any) -> String {
    guard JSONSerialization.isValidJSONObject(object),
          let data = try? JSONSerialization.data(withJSONObject: object)
    else { return "{}" }
    return String(data: data, encoding: .utf8) ?? "{}"
}
