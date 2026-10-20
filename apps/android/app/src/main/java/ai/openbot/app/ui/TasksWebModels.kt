package ai.openbot.app.ui

import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.concurrent.TimeUnit
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonObject

/**
 * Web-aligned Tasks models — mirrors employee-assigned-tasks-center + personal cron list.
 *
 * Assigned: `task.list` / `task.accept` / `task.complete`
 * (ui/src/ui/capability/meeting-lifecycle/endpoints.ts TaskAssignment).
 *
 * Cron: `cron.list` / `cron.add` / `cron.update` / `cron.run`
 * (ui/src/ui/controllers/cron.ts + employee-personal-cron-center).
 */
private val tasksJson = Json { ignoreUnknownKeys = true }

const val DEMO_TASKS_EXTRA = "ai.openbot.app.extra.DEMO_TASKS"

/** Web TaskAssignmentStatus. */
enum class AssignedTaskStatus {
  Pending,
  Accepted,
  Running,
  Completed,
  Rejected,
  Unknown,
}

fun parseAssignedTaskStatus(raw: String?): AssignedTaskStatus =
  when (raw?.trim()?.lowercase(Locale.ROOT)) {
    "pending" -> AssignedTaskStatus.Pending
    "accepted" -> AssignedTaskStatus.Accepted
    "running" -> AssignedTaskStatus.Running
    "completed" -> AssignedTaskStatus.Completed
    "rejected" -> AssignedTaskStatus.Rejected
    else -> AssignedTaskStatus.Unknown
  }

/** STATUS_LABEL from employee-assigned-tasks-center.ts */
fun assignedTaskStatusLabel(status: AssignedTaskStatus): String =
  when (status) {
    AssignedTaskStatus.Pending -> "待接受"
    AssignedTaskStatus.Accepted -> "已接受"
    AssignedTaskStatus.Running -> "进行中"
    AssignedTaskStatus.Completed -> "已完成"
    AssignedTaskStatus.Rejected -> "已拒绝"
    AssignedTaskStatus.Unknown -> "未知"
  }

fun assignedTaskCanAccept(status: AssignedTaskStatus): Boolean =
  status == AssignedTaskStatus.Pending

fun assignedTaskCanComplete(status: AssignedTaskStatus): Boolean =
  status == AssignedTaskStatus.Accepted || status == AssignedTaskStatus.Running

data class AssignedTaskRow(
  val id: String,
  val organizationId: String,
  val title: String,
  val status: AssignedTaskStatus,
  val dueAt: String? = null,
  val notes: String? = null,
  val sourceKind: String? = null,
  val sourceId: String? = null,
  val updatedAt: String? = null,
  val ownerAgentId: String? = null,
)

data class CronTaskRow(
  val id: String,
  val name: String,
  val description: String? = null,
  val enabled: Boolean = true,
  val scheduleKind: String? = null,
  val scheduleExpr: String? = null,
  val scheduleEveryMs: Long? = null,
  val scheduleAt: String? = null,
  val nextRunAtMs: Long? = null,
  val lastStatus: String? = null,
  val payloadMessage: String? = null,
  val agentId: String? = null,
  val sessionKey: String? = null,
)

sealed class TasksSegmentListState {
  data object Loading : TasksSegmentListState()

  data object Empty : TasksSegmentListState()

  data object OfflinePreview : TasksSegmentListState()

  data class Error(val message: String) : TasksSegmentListState()

  data class AssignedRows(val items: List<AssignedTaskRow>) : TasksSegmentListState()

  data class CronRows(val items: List<CronTaskRow>) : TasksSegmentListState()
}

fun formatAssignedDue(dueAt: String?): String? {
  val raw = dueAt?.trim().orEmpty()
  if (raw.isEmpty()) return null
  val ms = raw.toLongOrNull() ?: run {
    try {
      java.time.Instant.parse(raw).toEpochMilli()
    } catch (_: Throwable) {
      return "截止 $raw"
    }
  }
  if (ms <= 0L) return null
  val sdf =
    SimpleDateFormat("MM-dd HH:mm", Locale.CHINA).apply {
      timeZone = TimeZone.getDefault()
    }
  return "截止 ${sdf.format(Date(ms))}"
}

fun formatCronScheduleLabel(job: CronTaskRow): String {
  return when (job.scheduleKind?.trim()?.lowercase(Locale.ROOT)) {
    "every" -> {
      val ms = job.scheduleEveryMs ?: return "周期任务"
      when {
        ms % 86_400_000L == 0L -> "每 ${ms / 86_400_000L} 天"
        ms % 3_600_000L == 0L -> "每 ${ms / 3_600_000L} 小时"
        ms % 60_000L == 0L -> "每 ${ms / 60_000L} 分钟"
        else -> "每 ${TimeUnit.MILLISECONDS.toSeconds(ms)} 秒"
      }
    }
    "cron" -> {
      val expr = job.scheduleExpr?.trim().orEmpty()
      if (expr.isEmpty()) "Cron" else "🔁 $expr"
    }
    "at" -> {
      val at = job.scheduleAt?.trim().orEmpty()
      if (at.isEmpty()) "单次" else "单次 $at"
    }
    else -> job.scheduleExpr?.trim()?.takeIf { it.isNotEmpty() } ?: "定时任务"
  }
}

fun formatCronNextRun(nextRunAtMs: Long?): String? {
  if (nextRunAtMs == null || nextRunAtMs <= 0L) return null
  val sdf =
    SimpleDateFormat("MM-dd HH:mm", Locale.CHINA).apply {
      timeZone = TimeZone.getDefault()
    }
  return "下次 ${sdf.format(Date(nextRunAtMs))}"
}

fun cronEnabledLabel(enabled: Boolean): String = if (enabled) "已启用" else "已暂停"

/**
 * Parse Gateway `task.list` payload → { tasks: TaskAssignment[] }.
 */
fun parseAssignedTasksPayload(payloadJson: String): List<AssignedTaskRow> {
  val root = parseObject(payloadJson) ?: return emptyList()
  val tasks = root["tasks"] as? JsonArray ?: return emptyList()
  val out = ArrayList<AssignedTaskRow>(tasks.size)
  for (el in tasks) {
    val obj = el as? JsonObject ?: continue
    val id = obj.stringField("id")?.trim().orEmpty()
    val title = obj.stringField("title")?.trim().orEmpty()
    if (id.isEmpty() || title.isEmpty()) continue
    val organizationId = obj.stringField("organizationId")?.trim().orEmpty()
    val status = parseAssignedTaskStatus(obj.stringField("status"))
    val source = obj["sourceRef"] as? JsonObject
    out.add(
      AssignedTaskRow(
        id = id,
        organizationId = organizationId,
        title = title,
        status = status,
        dueAt = obj.stringField("dueAt"),
        notes = obj.stringField("notes"),
        sourceKind = source?.stringField("kind"),
        sourceId = source?.stringField("id"),
        updatedAt = obj.stringField("updatedAt"),
        ownerAgentId = obj.stringField("ownerAgentId"),
      ),
    )
  }
  return out
}

/**
 * Parse Gateway `cron.list` payload → { jobs: CronJob[] }.
 */
fun parseCronJobsPayload(payloadJson: String): List<CronTaskRow> {
  val root = parseObject(payloadJson) ?: return emptyList()
  val jobs = root["jobs"] as? JsonArray ?: return emptyList()
  val out = ArrayList<CronTaskRow>(jobs.size)
  for (el in jobs) {
    val obj = el as? JsonObject ?: continue
    val id = obj.stringField("id")?.trim().orEmpty()
    val name = obj.stringField("name")?.trim().orEmpty()
    if (id.isEmpty() || name.isEmpty()) continue
    val schedule = obj["schedule"] as? JsonObject
    val payload = obj["payload"] as? JsonObject
    val state = obj["state"] as? JsonObject
    val enabled =
      when (val raw = obj["enabled"]) {
        is JsonPrimitive -> raw.contentOrNull?.toBooleanStrictOrNull() ?: true
        else -> true
      }
    val payloadMessage =
      when (payload?.stringField("kind")?.lowercase(Locale.ROOT)) {
        "agentturn" -> payload.stringField("message")
        "systemevent" -> payload.stringField("text")
        else -> payload?.stringField("message") ?: payload?.stringField("text")
      }
    out.add(
      CronTaskRow(
        id = id,
        name = name,
        description = obj.stringField("description"),
        enabled = enabled,
        scheduleKind = schedule?.stringField("kind"),
        scheduleExpr = schedule?.stringField("expr"),
        scheduleEveryMs =
          when (val raw = schedule?.get("everyMs")) {
            is JsonPrimitive -> raw.longOrNull
            else -> null
          },
        scheduleAt = schedule?.stringField("at"),
        nextRunAtMs =
          when (val raw = state?.get("nextRunAtMs") ?: obj["nextRunAtMs"]) {
            is JsonPrimitive -> raw.longOrNull
            else -> null
          },
        lastStatus = state?.stringField("lastStatus") ?: state?.stringField("lastRunStatus"),
        payloadMessage = payloadMessage,
        agentId = obj.stringField("agentId"),
        sessionKey = obj.stringField("sessionKey"),
      ),
    )
  }
  return out
}

/**
 * Build `cron.add` body matching Web DEFAULT_CRON_FORM + addCronJob defaults
 * (isolated / now / agentTurn / announce+workbench-agent-main).
 */
fun buildCronAddParamsJson(
  name: String,
  message: String,
  scheduleKind: String,
  everyAmount: Int = 1,
  everyUnit: String = "days",
  cronExpr: String = "0 9 * * *",
  description: String = "",
): String {
  val schedule =
    when (scheduleKind.trim().lowercase(Locale.ROOT)) {
      "cron" ->
        buildJsonObject {
          put("kind", "cron")
          put("expr", cronExpr.trim().ifEmpty { "0 9 * * *" })
        }
      else -> {
        val mult =
          when (everyUnit.trim().lowercase(Locale.ROOT)) {
            "minutes" -> 60_000L
            "hours" -> 3_600_000L
            else -> 86_400_000L
          }
        val amount = everyAmount.coerceAtLeast(1)
        buildJsonObject {
          put("kind", "every")
          put("everyMs", amount * mult)
        }
      }
    }
  return buildJsonObject {
    put("name", name.trim())
    put("description", description.trim())
    put("enabled", true)
    put("deleteAfterRun", false)
    put("schedule", schedule)
    put("sessionTarget", "isolated")
    put("wakeMode", "now")
    putJsonObject("payload") {
      put("kind", "agentTurn")
      put("message", message.trim())
    }
    putJsonObject("delivery") {
      put("mode", "announce")
      put("channel", "last")
      put("surfaces", JsonArray(listOf(JsonPrimitive("workbench-agent-main"))))
    }
  }.toString()
}

fun buildTaskMutateParamsJson(organizationId: String, id: String): String =
  buildJsonObject {
    put("organizationId", organizationId)
    put("id", id)
  }.toString()

fun buildCronUpdateEnabledParamsJson(id: String, enabled: Boolean): String =
  buildJsonObject {
    put("id", id)
    putJsonObject("patch") {
      put("enabled", enabled)
    }
  }.toString()

fun buildCronRunParamsJson(id: String, mode: String = "force"): String =
  buildJsonObject {
    put("id", id)
    put("mode", mode)
  }.toString()

internal val DEMO_ASSIGNED_TASKS: List<AssignedTaskRow> =
  listOf(
    AssignedTaskRow(
      id = "demo-assigned-1",
      organizationId = "demo-org",
      title = "确认本周周报摘要",
      status = AssignedTaskStatus.Pending,
      dueAt = "2026-10-02T18:00:00.000Z",
      notes = "请确认本周周报摘要内容后接受，系统将同步到团队空间。",
      sourceKind = "meeting",
      sourceId = "demo-meeting-1",
    ),
    AssignedTaskRow(
      id = "demo-assigned-2",
      organizationId = "demo-org",
      title = "跟进客户方案修订",
      status = AssignedTaskStatus.Running,
      dueAt = "2026-10-03T18:00:00.000Z",
      notes = "按客户反馈修订方案并标记完成。",
      sourceKind = "meeting",
      sourceId = "demo-meeting-2",
    ),
    AssignedTaskRow(
      id = "demo-assigned-3",
      organizationId = "demo-org",
      title = "审阅会议行动项",
      status = AssignedTaskStatus.Pending,
      notes = "请审阅会议行动项并标记完成状态。",
      sourceKind = "meeting",
      sourceId = "demo-meeting-3",
    ),
  )

internal val DEMO_CRON_TASKS: List<CronTaskRow> =
  listOf(
    CronTaskRow(
      id = "demo-cron-1",
      name = "每日晨会纪要汇总",
      description = "汇总晨会要点",
      enabled = true,
      scheduleKind = "cron",
      scheduleExpr = "0 9 * * *",
      payloadMessage = "请汇总今日晨会纪要。",
    ),
    CronTaskRow(
      id = "demo-cron-2",
      name = "周报自动生成",
      description = "每周五生成周报",
      enabled = true,
      scheduleKind = "cron",
      scheduleExpr = "0 17 * * 5",
      payloadMessage = "请生成本周周报。",
    ),
  )

private fun parseObject(payloadJson: String): JsonObject? {
  val trimmed = payloadJson.trim()
  if (trimmed.isEmpty()) return null
  return try {
    tasksJson.parseToJsonElement(trimmed) as? JsonObject
  } catch (_: Throwable) {
    null
  }
}

private fun JsonObject.stringField(key: String): String? {
  val el = this[key] ?: return null
  return when (el) {
    is JsonPrimitive -> el.contentOrNull
    JsonNull -> null
    else -> null
  }
}
