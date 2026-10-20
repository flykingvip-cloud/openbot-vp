package ai.openbot.app.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class TasksWebModelsTest {
  @Test
  fun parseAssignedTasksExtractsFieldsAndStatus() {
    val json =
      """
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
            "ownerAgentId": "agent-1",
            "createdAt": "2026-10-01T00:00:00.000Z",
            "updatedAt": "2026-10-01T00:00:00.000Z",
            "ackRequired": true,
            "createdByAgentId": "agent-1"
          },
          {
            "id": "t2",
            "organizationId": "org-a",
            "title": "跟进方案",
            "status": "accepted",
            "createdAt": "2026-10-01T00:00:00.000Z",
            "updatedAt": "2026-10-01T00:00:00.000Z",
            "ackRequired": false,
            "ownerAgentId": "agent-1",
            "createdByAgentId": "agent-1"
          }
        ]
      }
      """.trimIndent()
    val rows = parseAssignedTasksPayload(json)
    assertEquals(2, rows.size)
    assertEquals("t1", rows[0].id)
    assertEquals("org-a", rows[0].organizationId)
    assertEquals(AssignedTaskStatus.Pending, rows[0].status)
    assertEquals("待接受", assignedTaskStatusLabel(rows[0].status))
    assertTrue(assignedTaskCanAccept(rows[0].status))
    assertFalse(assignedTaskCanComplete(rows[0].status))
    assertEquals("meeting", rows[0].sourceKind)
    assertEquals("m1", rows[0].sourceId)
    assertTrue(assignedTaskCanComplete(rows[1].status))
    assertFalse(assignedTaskCanAccept(rows[1].status))
  }

  @Test
  fun parseAssignedSkipsInvalidAndBlank() {
    assertTrue(parseAssignedTasksPayload("").isEmpty())
    assertTrue(parseAssignedTasksPayload("{not-json").isEmpty())
    val json =
      """
      {"tasks":[
        {"id":"","title":"no-id","status":"pending","organizationId":"o"},
        {"id":"x","title":"","status":"pending","organizationId":"o"},
        {"id":"ok","title":"有效","status":"running","organizationId":"o"}
      ]}
      """.trimIndent()
    val rows = parseAssignedTasksPayload(json)
    assertEquals(1, rows.size)
    assertEquals(AssignedTaskStatus.Running, rows[0].status)
  }

  @Test
  fun parseCronJobsExtractsScheduleAndPayload() {
    val json =
      """
      {
        "jobs": [
          {
            "id": "c1",
            "name": "每日晨会",
            "enabled": true,
            "description": "汇总",
            "createdAtMs": 1,
            "updatedAtMs": 2,
            "schedule": {"kind": "cron", "expr": "0 9 * * *"},
            "sessionTarget": "isolated",
            "wakeMode": "now",
            "payload": {"kind": "agentTurn", "message": "请汇总晨会"},
            "state": {"nextRunAtMs": 1725760800000, "lastStatus": "ok"}
          },
          {
            "id": "c2",
            "name": "每隔一天",
            "enabled": false,
            "createdAtMs": 1,
            "updatedAtMs": 2,
            "schedule": {"kind": "every", "everyMs": 86400000},
            "sessionTarget": "isolated",
            "wakeMode": "now",
            "payload": {"kind": "systemEvent", "text": "tick"}
          }
        ]
      }
      """.trimIndent()
    val rows = parseCronJobsPayload(json)
    assertEquals(2, rows.size)
    assertEquals("c1", rows[0].id)
    assertEquals("0 9 * * *", rows[0].scheduleExpr)
    assertEquals("请汇总晨会", rows[0].payloadMessage)
    assertTrue(rows[0].enabled)
    assertTrue(formatCronScheduleLabel(rows[0]).contains("0 9 * * *"))
    assertEquals("已暂停", cronEnabledLabel(rows[1].enabled))
    assertEquals("每 1 天", formatCronScheduleLabel(rows[1]))
    assertEquals("tick", rows[1].payloadMessage)
  }

  @Test
  fun buildCronAddMatchesWebDefaults() {
    val json =
      buildCronAddParamsJson(
        name = "周报",
        message = "生成周报",
        scheduleKind = "cron",
        cronExpr = "0 17 * * 5",
      )
    assertTrue(json.contains("\"kind\":\"cron\""))
    assertTrue(json.contains("0 17 * * 5"))
    assertTrue(json.contains("\"sessionTarget\":\"isolated\""))
    assertTrue(json.contains("\"wakeMode\":\"now\""))
    assertTrue(json.contains("\"kind\":\"agentTurn\""))
    assertTrue(json.contains("workbench-agent-main"))
    assertTrue(json.contains("\"mode\":\"announce\""))
  }

  @Test
  fun buildMutateAndUpdateParams() {
    val accept = buildTaskMutateParamsJson("org-a", "t1")
    assertTrue(accept.contains("\"organizationId\":\"org-a\""))
    assertTrue(accept.contains("\"id\":\"t1\""))
    val patch = buildCronUpdateEnabledParamsJson("c1", false)
    assertTrue(patch.contains("\"enabled\":false"))
    val run = buildCronRunParamsJson("c1")
    assertTrue(run.contains("\"mode\":\"force\""))
  }

  @Test
  fun demoSeedsPresent() {
    assertTrue(DEMO_ASSIGNED_TASKS.size >= 2)
    assertTrue(DEMO_CRON_TASKS.size >= 2)
  }
}
