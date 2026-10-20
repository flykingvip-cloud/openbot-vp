import Foundation
import Testing

struct TasksWebModelsTests {
    @Test func `parse assigned tasks extracts fields and status`() throws {
        let raw = """
        {
          "tasks": [
            {
              "id": "t1",
              "organizationId": "org-a",
              "title": "确认周报",
              "status": "pending",
              "dueAt": "2026-10-02T18:00:00.000Z",
              "notes": "请确认",
              "sourceRef": {"kind": "meeting", "id": "m1"},
              "ownerAgentId": "agent-1"
            },
            {
              "id": "t2",
              "organizationId": "org-a",
              "title": "跟进方案",
              "status": "accepted"
            },
            {
              "id": "done",
              "organizationId": "org-a",
              "title": "已结束",
              "status": "completed"
            }
          ]
        }
        """
        let rows = parseAssignedTasksPayload(raw)
        #expect(rows.count == 3)
        #expect(rows[0].id == "t1")
        #expect(rows[0].organizationId == "org-a")
        #expect(rows[0].status == .pending)
        #expect(assignedTaskStatusLabel(rows[0].status) == "待接受")
        #expect(assignedTaskCanAccept(rows[0].status))
        #expect(!assignedTaskCanComplete(rows[0].status))
        #expect(rows[0].sourceKind == "meeting")
        #expect(rows[0].sourceId == "m1")
        #expect(assignedTaskCanComplete(rows[1].status))
        #expect(!assignedTaskCanAccept(rows[1].status))
        let inbox = inboxAssignedTasks(rows)
        #expect(inbox.map(\.id) == ["t1", "t2"])
        let due = try #require(formatAssignedDue(rows[0].dueAt))
        #expect(due.hasPrefix("截止 "))
        #expect(due.range(of: #"\d{2}-\d{2} \d{2}:\d{2}"#, options: .regularExpression) != nil)
    }

    @Test func `parse assigned skips invalid and blank`() {
        #expect(parseAssignedTasksPayload("").isEmpty)
        #expect(parseAssignedTasksPayload("{not-json").isEmpty)
        let raw = """
        {"tasks":[
          {"id":"","title":"no-id","status":"pending","organizationId":"o"},
          {"id":"x","title":"","status":"pending","organizationId":"o"},
          {"id":"ok","title":"有效","status":"running","organizationId":"o"}
        ]}
        """
        let rows = parseAssignedTasksPayload(raw)
        #expect(rows.count == 1)
        #expect(rows[0].status == .running)
        #expect(formatAssignedDue("   ") == nil)
        #expect(formatAssignedDue("0") == nil)
        #expect(formatAssignedDue("not-a-date") == "截止 not-a-date")
    }

    @Test func `parse cron jobs extracts schedule and payload`() {
        let raw = """
        {
          "jobs": [
            {
              "id": "c1",
              "name": "每日晨会",
              "enabled": true,
              "description": "汇总",
              "schedule": {"kind": "cron", "expr": "0 9 * * *"},
              "payload": {"kind": "agentTurn", "message": "请汇总晨会"},
              "state": {"nextRunAtMs": 1725760800000, "lastStatus": "ok"}
            },
            {
              "id": "c2",
              "name": "每隔一天",
              "enabled": false,
              "schedule": {"kind": "every", "everyMs": 86400000},
              "payload": {"kind": "systemEvent", "text": "tick"}
            }
          ]
        }
        """
        let rows = parseCronJobsPayload(raw)
        #expect(rows.count == 2)
        #expect(rows[0].id == "c1")
        #expect(rows[0].scheduleExpr == "0 9 * * *")
        #expect(rows[0].payloadMessage == "请汇总晨会")
        #expect(rows[0].enabled)
        #expect(rows[0].nextRunAtMs == 1_725_760_800_000)
        #expect(formatCronScheduleLabel(rows[0]).contains("0 9 * * *"))
        #expect(cronEnabledLabel(rows[1].enabled) == "已暂停")
        #expect(formatCronScheduleLabel(rows[1]) == "每 1 天")
        #expect(rows[1].payloadMessage == "tick")
        let next = formatCronNextRun(rows[0].nextRunAtMs)
        #expect(next?.hasPrefix("下次 ") == true)
        #expect(formatCronNextRun(0) == nil)
        #expect(formatCronNextRun(nil) == nil)
    }

    @Test func `schedule labels cover every cron and at`() {
        #expect(formatCronScheduleLabel(Self.job(kind: "every", everyMs: nil)) == "周期任务")
        #expect(formatCronScheduleLabel(Self.job(kind: "every", everyMs: 3_600_000)) == "每 1 小时")
        #expect(formatCronScheduleLabel(Self.job(kind: "every", everyMs: 120_000)) == "每 2 分钟")
        #expect(formatCronScheduleLabel(Self.job(kind: "every", everyMs: 1500)) == "每 1 秒")
        #expect(formatCronScheduleLabel(Self.job(kind: "cron", expr: "")) == "Cron")
        #expect(formatCronScheduleLabel(Self.job(kind: "at", at: "")) == "单次")
        #expect(formatCronScheduleLabel(Self.job(kind: "at", at: "2026-10-03T09:00:00Z")) == "单次 2026-10-03T09:00:00Z")
        #expect(formatCronScheduleLabel(Self.job(kind: nil, expr: nil)) == "定时任务")
        #expect(cronEnabledLabel(true) == "已启用")
        #expect(assignedTaskStatusLabel(.rejected) == "已拒绝")
        #expect(parseAssignedTaskStatus("nope") == .unknown)
    }

    @Test func `build cron add matches web defaults`() throws {
        let raw = buildCronAddParamsJSON(
            CronAddDraft(
                name: "周报",
                message: "生成周报",
                scheduleKind: "cron",
                everyAmount: 1,
                everyUnit: "days",
                cronExpr: "0 17 * * 5",
                description: ""))
        let object = try #require(Self.object(raw))
        let schedule = try #require(object["schedule"] as? [String: Any])
        #expect(schedule["kind"] as? String == "cron")
        #expect(schedule["expr"] as? String == "0 17 * * 5")
        #expect(object["sessionTarget"] as? String == "isolated")
        #expect(object["wakeMode"] as? String == "now")
        #expect(object["enabled"] as? Bool == true)
        #expect(object["deleteAfterRun"] as? Bool == false)
        let payload = try #require(object["payload"] as? [String: Any])
        #expect(payload["kind"] as? String == "agentTurn")
        #expect(payload["message"] as? String == "生成周报")
        let delivery = try #require(object["delivery"] as? [String: Any])
        #expect(delivery["mode"] as? String == "announce")
        #expect(delivery["channel"] as? String == "last")
        let surfaces = try #require(delivery["surfaces"] as? [String])
        #expect(surfaces == ["workbench-agent-main"])
    }

    @Test func `build every and mutate params`() throws {
        let raw = buildCronAddParamsJSON(
            CronAddDraft(
                name: "间隔",
                message: "tick",
                scheduleKind: "every",
                everyAmount: 2,
                everyUnit: "hours",
                cronExpr: "",
                description: "备注"))
        let schedule = try #require(Self.object(raw)?["schedule"] as? [String: Any])
        #expect(schedule["kind"] as? String == "every")
        #expect((schedule["everyMs"] as? NSNumber)?.int64Value == 7_200_000)

        let accept = try #require(Self.object(buildTaskMutateParamsJSON(organizationId: "org-a", id: "t1")))
        #expect(accept["organizationId"] as? String == "org-a")
        #expect(accept["id"] as? String == "t1")

        let patch = try #require(Self.object(buildCronUpdateEnabledParamsJSON(id: "c1", enabled: false)))
        let body = try #require(patch["patch"] as? [String: Any])
        #expect(patch["id"] as? String == "c1")
        #expect(body["enabled"] as? Bool == false)

        let run = try #require(Self.object(buildCronRunParamsJSON(id: "c1")))
        #expect(run["id"] as? String == "c1")
        #expect(run["mode"] as? String == "force")
    }

    private static func object(_ raw: String) -> [String: Any]? {
        guard let data = raw.data(using: .utf8) else { return nil }
        return try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    }

    private static func job(
        kind: String?,
        expr: String? = nil,
        everyMs: Int64? = nil,
        at: String? = nil) -> CronTaskRow
    {
        CronTaskRow(
            id: "id",
            name: "name",
            description: nil,
            enabled: true,
            scheduleKind: kind,
            scheduleExpr: expr,
            scheduleEveryMs: everyMs,
            scheduleAt: at,
            nextRunAtMs: nil,
            lastStatus: nil,
            payloadMessage: nil,
            agentId: nil,
            sessionKey: nil)
    }
}
