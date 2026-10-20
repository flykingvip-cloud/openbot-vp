package ai.openbot.app.ui

import android.app.Activity
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowLeft
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import androidx.compose.ui.unit.dp
import ai.openbot.app.BuildConfig
import ai.openbot.app.MainViewModel
import kotlinx.coroutines.launch

private enum class TasksSegment {
  Cron,
  Inbox,
}

/**
 * Four-tab SoT Tasks: 定时任务 | 待我处理 +「+」, row → detail (接受/完成).
 *
 * Process/logic reused from Web (no Android-only task system):
 * - 待我处理: employee-assigned-tasks-center → task.list / task.accept / task.complete
 * - 定时任务: employee-personal-cron-center → cron.list / cron.add / cron.update / cron.run
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MobileTasksScreen(
  viewModel: MainViewModel,
  onOpenChat: (prompt: String) -> Unit,
  modifier: Modifier = Modifier,
) {
  val isConnected by viewModel.isConnected.collectAsState()
  val context = LocalContext.current
  val scope = rememberCoroutineScope()
  val demoTasks =
    BuildConfig.DEBUG &&
      ((context as? Activity)?.intent?.getBooleanExtra(DEMO_TASKS_EXTRA, false) == true)

  var segment by rememberSaveable { mutableStateOf(TasksSegment.Inbox) }
  var listState by remember { mutableStateOf<TasksSegmentListState>(TasksSegmentListState.Loading) }
  var notice by remember { mutableStateOf<String?>(null) }
  var busyId by remember { mutableStateOf<String?>(null) }
  var selectedAssigned by remember { mutableStateOf<AssignedTaskRow?>(null) }
  var selectedCron by remember { mutableStateOf<CronTaskRow?>(null) }
  var showCreate by remember { mutableStateOf(false) }
  var refreshTick by remember { mutableStateOf(0) }

  fun reload() {
    refreshTick += 1
  }

  LaunchedEffect(isConnected, demoTasks, segment, refreshTick) {
    notice = null
    if (demoTasks) {
      listState =
        when (segment) {
          TasksSegment.Inbox -> TasksSegmentListState.AssignedRows(DEMO_ASSIGNED_TASKS)
          TasksSegment.Cron -> TasksSegmentListState.CronRows(DEMO_CRON_TASKS)
        }
      return@LaunchedEffect
    }
    if (!isConnected) {
      listState = TasksSegmentListState.OfflinePreview
      return@LaunchedEffect
    }
    listState = TasksSegmentListState.Loading
    listState =
      try {
        when (segment) {
          TasksSegment.Inbox -> {
            val payload = viewModel.gatewayRequest(method = "task.list", paramsJson = "{}")
            val rows = parseAssignedTasksPayload(payload)
            val active =
              rows.filter {
                it.status == AssignedTaskStatus.Pending ||
                  it.status == AssignedTaskStatus.Accepted ||
                  it.status == AssignedTaskStatus.Running
              }
            if (active.isEmpty()) {
              TasksSegmentListState.Empty
            } else {
              TasksSegmentListState.AssignedRows(active)
            }
          }
          TasksSegment.Cron -> {
            val payload =
              viewModel.gatewayRequest(
                method = "cron.list",
                paramsJson = """{"includeDisabled":true,"limit":50,"offset":0}""",
              )
            val rows = parseCronJobsPayload(payload)
            if (rows.isEmpty()) {
              TasksSegmentListState.Empty
            } else {
              TasksSegmentListState.CronRows(rows)
            }
          }
        }
      } catch (err: Throwable) {
        val msg = err.message?.trim().orEmpty().ifEmpty { "加载失败" }
        TasksSegmentListState.Error(msg.take(160))
      }
  }

  Box(modifier = modifier.fillMaxSize()) {
    LazyColumn(
      modifier = Modifier.fillMaxSize(),
      contentPadding =
        PaddingValues(
          start = mobilePageGutter,
          end = mobilePageGutter,
          top = mobilePageVertical,
          bottom = 88.dp,
        ),
      verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
      item {
        MobilePageHeader(title = "任务")
      }

      item {
        TasksSegmentBar(
          segment = segment,
          onSelect = {
            segment = it
            selectedAssigned = null
            selectedCron = null
          },
        )
      }

      if (!isConnected) {
        item {
          MobileSoftBanner(
            text =
              if (demoTasks) {
                "未连接网关：正在预览 DEMO 任务；连接后走 Web 同款 task.* / cron.*。"
              } else {
                "未连接网关：连接后拉取定时任务与待我处理。"
              },
            tone = MobileBannerTone.Warning,
          )
        }
      }

      val banner = notice
      if (!banner.isNullOrBlank()) {
        item {
          MobileSoftBanner(text = banner, tone = MobileBannerTone.Neutral)
        }
      }

      when (val state = listState) {
        is TasksSegmentListState.Loading -> {
          item {
            Row(
              modifier = Modifier.fillMaxWidth().padding(vertical = 12.dp),
              horizontalArrangement = Arrangement.spacedBy(10.dp),
              verticalAlignment = Alignment.CenterVertically,
            ) {
              CircularProgressIndicator(
                modifier = Modifier.size(18.dp),
                strokeWidth = 2.dp,
                color = mobileAccent,
              )
              Text(
                text = if (segment == TasksSegment.Inbox) "正在加载待我处理…" else "正在加载定时任务…",
                style = mobileCallout,
                color = mobileTextSecondary,
              )
            }
          }
        }
        is TasksSegmentListState.Empty -> {
          item {
            MobileSoftBanner(
              text =
                if (segment == TasksSegment.Inbox) {
                  "暂无待处理任务。"
                } else {
                  "暂无定时任务。点右下角「+」创建（对齐 Web cron.add）。"
                },
              tone = MobileBannerTone.Neutral,
            )
          }
        }
        is TasksSegmentListState.OfflinePreview -> {
          item {
            MobileSoftBanner(
              text = "离线预览：连接网关后显示 Web 对齐清单。",
              tone = MobileBannerTone.Neutral,
            )
          }
        }
        is TasksSegmentListState.Error -> {
          item {
            MobileSoftBanner(
              text = "加载失败：${state.message}",
              tone = MobileBannerTone.Warning,
            )
          }
        }
        is TasksSegmentListState.AssignedRows -> {
          item {
            // SoT HTML `.section-label` above inbox card
            MobileSectionLabel(text = "轻量工作队列")
          }
          item {
            // SoT `.task-card` single white card with row dividers
            Surface(
              modifier = Modifier.fillMaxWidth(),
              shape = RoundedCornerShape(14.dp),
              color = Color.White,
              border = BorderStroke(1.dp, mobileBorder),
            ) {
              Column {
                state.items.forEachIndexed { index, task ->
                  AssignedTaskRowInCard(
                    task = task,
                    onClick = { selectedAssigned = task },
                    showDivider = index < state.items.lastIndex,
                  )
                }
              }
            }
          }
        }
        is TasksSegmentListState.CronRows -> {
          item {
            MobileSectionLabel(text = "定时任务")
          }
          item {
            Surface(
              modifier = Modifier.fillMaxWidth(),
              shape = RoundedCornerShape(14.dp),
              color = Color.White,
              border = BorderStroke(1.dp, mobileBorder),
            ) {
              Column {
                state.items.forEachIndexed { index, job ->
                  CronTaskRowInCard(
                    job = job,
                    onClick = { selectedCron = job },
                    showDivider = index < state.items.lastIndex,
                  )
                }
              }
            }
          }
        }
      }
    }

    FloatingActionButton(
      onClick = { showCreate = true },
      modifier =
        Modifier
          .align(Alignment.BottomEnd)
          .padding(end = mobilePageGutter, bottom = 20.dp),
      shape = CircleShape,
      containerColor = mobileAccent,
      contentColor = Color.White,
    ) {
      Icon(Icons.Default.Add, contentDescription = "新建定时任务")
    }
  }

  val assigned = selectedAssigned
  if (assigned != null) {
    AssignedTaskDetailSheet(
      task = assigned,
      busy = busyId == assigned.id,
      onDismiss = { selectedAssigned = null },
      onAccept = {
        if (demoTasks) {
          notice = "DEMO：已模拟接受"
          selectedAssigned = assigned.copy(status = AssignedTaskStatus.Accepted)
          return@AssignedTaskDetailSheet
        }
        scope.launch {
          busyId = assigned.id
          notice = null
          try {
            viewModel.gatewayRequest(
              method = "task.accept",
              paramsJson = buildTaskMutateParamsJson(assigned.organizationId, assigned.id),
            )
            notice = "已接受任务"
            selectedAssigned = null
            reload()
          } catch (err: Throwable) {
            notice = err.message?.trim().orEmpty().ifEmpty { "接受失败" }.take(160)
          } finally {
            busyId = null
          }
        }
      },
      onComplete = {
        if (demoTasks) {
          notice = "DEMO：已模拟完成"
          selectedAssigned = null
          reload()
          return@AssignedTaskDetailSheet
        }
        scope.launch {
          busyId = assigned.id
          notice = null
          try {
            viewModel.gatewayRequest(
              method = "task.complete",
              paramsJson = buildTaskMutateParamsJson(assigned.organizationId, assigned.id),
            )
            notice = "已完成任务"
            selectedAssigned = null
            reload()
          } catch (err: Throwable) {
            notice = err.message?.trim().orEmpty().ifEmpty { "完成失败" }.take(160)
          } finally {
            busyId = null
          }
        }
      },
    )
  }

  val cron = selectedCron
  if (cron != null) {
    CronTaskDetailSheet(
      job = cron,
      busy = busyId == cron.id,
      onDismiss = { selectedCron = null },
      onToggleEnabled = { enabled ->
        if (demoTasks) {
          notice = if (enabled) "DEMO：已启用" else "DEMO：已暂停"
          selectedCron = cron.copy(enabled = enabled)
          return@CronTaskDetailSheet
        }
        scope.launch {
          busyId = cron.id
          notice = null
          try {
            viewModel.gatewayRequest(
              method = "cron.update",
              paramsJson = buildCronUpdateEnabledParamsJson(cron.id, enabled),
            )
            notice = if (enabled) "已启用" else "已暂停"
            selectedCron = null
            reload()
          } catch (err: Throwable) {
            notice = err.message?.trim().orEmpty().ifEmpty { "更新失败" }.take(160)
          } finally {
            busyId = null
          }
        }
      },
      onRunNow = {
        if (demoTasks) {
          notice = "DEMO：已触发执行"
          return@CronTaskDetailSheet
        }
        scope.launch {
          busyId = cron.id
          notice = null
          try {
            viewModel.gatewayRequest(
              method = "cron.run",
              paramsJson = buildCronRunParamsJson(cron.id),
            )
            notice = "已触发执行"
          } catch (err: Throwable) {
            notice = err.message?.trim().orEmpty().ifEmpty { "执行失败" }.take(160)
          } finally {
            busyId = null
          }
        }
      },
    )
  }

  if (showCreate) {
    CronCreateSheet(
      connected = isConnected || demoTasks,
      onDismiss = { showCreate = false },
      onSubmit = { name, message, scheduleKind, everyAmount, everyUnit, cronExpr ->
        if (demoTasks) {
          notice = "DEMO：已模拟创建「$name」"
          showCreate = false
          segment = TasksSegment.Cron
          reload()
          return@CronCreateSheet
        }
        if (!isConnected) {
          notice = "未连接网关，无法创建"
          return@CronCreateSheet
        }
        scope.launch {
          busyId = "__create__"
          notice = null
          try {
            val params =
              buildCronAddParamsJson(
                name = name,
                message = message,
                scheduleKind = scheduleKind,
                everyAmount = everyAmount,
                everyUnit = everyUnit,
                cronExpr = cronExpr,
              )
            viewModel.gatewayRequest(method = "cron.add", paramsJson = params)
            notice = "已创建定时任务"
            showCreate = false
            segment = TasksSegment.Cron
            reload()
          } catch (err: Throwable) {
            notice = err.message?.trim().orEmpty().ifEmpty { "创建失败" }.take(160)
          } finally {
            busyId = null
          }
        }
      },
    )
  }

  // onOpenChat retained for tab call-site compatibility; Tasks no longer injects stub prompts.
  @Suppress("UNUSED_VARIABLE")
  val unusedOpenChat = onOpenChat
}

@Composable
private fun TasksSegmentBar(
  segment: TasksSegment,
  onSelect: (TasksSegment) -> Unit,
) {
  SoTSegmentedControl(
    options = listOf("定时任务", "待我处理"),
    selectedIndex = if (segment == TasksSegment.Cron) 0 else 1,
    onSelect = { idx ->
      onSelect(if (idx == 0) TasksSegment.Cron else TasksSegment.Inbox)
    },
  )
}

@Composable
private fun AssignedTaskRowInCard(
  task: AssignedTaskRow,
  onClick: () -> Unit,
  showDivider: Boolean,
) {
  val due = formatAssignedDue(task.dueAt)
  Column(modifier = Modifier.fillMaxWidth()) {
    Surface(
      onClick = onClick,
      color = Color.White,
      shape = RoundedCornerShape(0.dp),
    ) {
      Row(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 14.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        verticalAlignment = Alignment.CenterVertically,
      ) {
        Column(
          modifier = Modifier.weight(1f),
          verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
          Text(task.title, style = mobileHeadline, color = mobileText)
          StatusChip(status = task.status)
          if (due != null) {
            Text(due, style = mobileCaption1, color = mobileTextTertiary)
          }
        }
        Icon(
          imageVector = Icons.AutoMirrored.Filled.KeyboardArrowRight,
          contentDescription = null,
          tint = mobileTextTertiary,
        )
      }
    }
    if (showDivider) {
      HorizontalDivider(color = mobileBorder, thickness = 1.dp)
    }
  }
}

@Composable
private fun CronTaskRowInCard(
  job: CronTaskRow,
  onClick: () -> Unit,
  showDivider: Boolean,
) {
  val schedule = formatCronScheduleLabel(job)
  val next = formatCronNextRun(job.nextRunAtMs)
  Column(modifier = Modifier.fillMaxWidth()) {
    Surface(
      onClick = onClick,
      color = Color.White,
      shape = RoundedCornerShape(0.dp),
    ) {
      Row(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 14.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        verticalAlignment = Alignment.CenterVertically,
      ) {
        Column(
          modifier = Modifier.weight(1f),
          verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
          Text(job.name, style = mobileHeadline, color = mobileText)
          StatusChip(
            label = cronEnabledLabel(job.enabled),
            tone = if (job.enabled) TaskChipTone.Run else TaskChipTone.Wait,
          )
          Text(schedule, style = mobileCaption1, color = mobileTextTertiary)
          if (next != null) {
            Text(next, style = mobileCaption1, color = mobileTextTertiary)
          }
        }
        Icon(
          imageVector = Icons.AutoMirrored.Filled.KeyboardArrowRight,
          contentDescription = null,
          tint = mobileTextTertiary,
        )
      }
    }
    if (showDivider) {
      HorizontalDivider(color = mobileBorder, thickness = 1.dp)
    }
  }
}

private enum class TaskChipTone { Wait, Run, Warn }

@Composable
private fun StatusChip(status: AssignedTaskStatus) {
  val tone =
    when (status) {
      AssignedTaskStatus.Pending -> TaskChipTone.Wait
      AssignedTaskStatus.Running -> TaskChipTone.Run
      AssignedTaskStatus.Accepted -> TaskChipTone.Run
      AssignedTaskStatus.Rejected -> TaskChipTone.Warn
      else -> TaskChipTone.Wait
    }
  StatusChip(label = assignedTaskStatusLabel(status), tone = tone)
}

@Composable
private fun StatusChip(
  label: String,
  tone: TaskChipTone,
) {
  // HTML SoT: .badge.wait blue / .badge.run green / .badge.warn orange
  val (bg, fg) =
    when (tone) {
      TaskChipTone.Wait -> Color(0xFFDBEAFE) to Color(0xFF1D4ED8)
      TaskChipTone.Run -> mobileSuccessSoft to mobileSuccess
      TaskChipTone.Warn -> Color(0xFFFFEDD5) to Color(0xFFC2410C)
    }
  Surface(shape = RoundedCornerShape(999.dp), color = bg) {
    Text(
      text = label,
      modifier = Modifier.padding(horizontal = 8.dp, vertical = 2.dp),
      style = mobileCaption1.copy(fontWeight = FontWeight.SemiBold, fontSize = 11.sp),
      color = fg,
    )
  }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun AssignedTaskDetailSheet(
  task: AssignedTaskRow,
  busy: Boolean,
  onDismiss: () -> Unit,
  onAccept: () -> Unit,
  onComplete: () -> Unit,
) {
  val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
  val canAccept = assignedTaskCanAccept(task.status)
  val canComplete = assignedTaskCanComplete(task.status)
  val due = formatAssignedDue(task.dueAt)
  val source =
    when {
      task.sourceKind == "meeting" && !task.sourceId.isNullOrBlank() -> "会议 ${task.sourceId}"
      !task.sourceId.isNullOrBlank() -> task.sourceId
      else -> null
    }
  val org = task.organizationId.takeIf { it.isNotBlank() && it != "demo-org" }
  ModalBottomSheet(
    onDismissRequest = onDismiss,
    sheetState = sheetState,
    containerColor = Color.White,
    dragHandle = null,
  ) {
    Column(
      modifier =
        Modifier
          .fillMaxWidth()
          .verticalScroll(rememberScrollState())
          .padding(horizontal = 16.dp)
          .padding(top = 14.dp, bottom = 28.dp),
      verticalArrangement = Arrangement.spacedBy(0.dp),
    ) {
      // HTML SoT `.detail-nav`: back circle + 任务详情
      Row(
        modifier = Modifier.fillMaxWidth().padding(bottom = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
      ) {
        Surface(
          onClick = onDismiss,
          shape = CircleShape,
          color = Color.White,
          border = BorderStroke(1.dp, mobileBorder),
          modifier = Modifier.size(32.dp),
        ) {
          Box(contentAlignment = Alignment.Center) {
            Icon(
              Icons.AutoMirrored.Filled.KeyboardArrowLeft,
              contentDescription = "返回",
              tint = mobileText,
              modifier = Modifier.size(20.dp),
            )
          }
        }
        Text("任务详情", style = mobileHeadline.copy(fontWeight = FontWeight.SemiBold), color = mobileText)
      }
      Text(
        task.title,
        style = mobileTitle2.copy(fontWeight = FontWeight.Bold, fontSize = 20.sp),
        color = mobileText,
        modifier = Modifier.padding(top = 4.dp, bottom = 8.dp),
      )
      StatusChip(status = task.status)
      Spacer(modifier = Modifier.height(12.dp))
      if (due != null) {
        DetailMeta(label = "截止", value = due.removePrefix("截止 ").trim())
      }
      if (source != null) {
        DetailMeta(label = "来源", value = source)
      }
      if (org != null) {
        DetailMeta(label = "组织", value = org)
      }
      if (!task.notes.isNullOrBlank()) {
        Text(
          text = task.notes,
          style = mobileCallout.copy(lineHeight = 20.sp),
          color = Color(0xFF374151),
          modifier =
            Modifier
              .fillMaxWidth()
              .padding(top = 10.dp)
              .padding(top = 12.dp),
        )
      }
      Spacer(modifier = Modifier.height(18.dp))
      // HTML SoT `.detail-actions`: always show 接受 (primary) + 完成 (outline); enable via Web rules.
      Row(horizontalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.fillMaxWidth()) {
        MobilePrimaryButton(
          label = if (busy) "处理中…" else "接受",
          onClick = onAccept,
          enabled = !busy && canAccept,
          modifier = Modifier.weight(1f),
        )
        Surface(
          onClick = onComplete,
          enabled = !busy && canComplete,
          modifier = Modifier.weight(1f),
          shape = RoundedCornerShape(12.dp),
          color = Color.White,
          border = BorderStroke(1.dp, mobileBorder),
        ) {
          Box(
            modifier = Modifier.fillMaxWidth().padding(vertical = 14.dp),
            contentAlignment = Alignment.Center,
          ) {
            Text(
              if (busy) "处理中…" else "完成",
              style = mobileHeadline.copy(fontWeight = FontWeight.SemiBold),
              color = if (!busy && canComplete) mobileTextSecondary else mobileTextTertiary,
            )
          }
        }
      }
    }
  }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun CronTaskDetailSheet(
  job: CronTaskRow,
  busy: Boolean,
  onDismiss: () -> Unit,
  onToggleEnabled: (Boolean) -> Unit,
  onRunNow: () -> Unit,
) {
  val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
  ModalBottomSheet(
    onDismissRequest = onDismiss,
    sheetState = sheetState,
    containerColor = Color.White,
    dragHandle = null,
  ) {
    Column(
      modifier =
        Modifier
          .fillMaxWidth()
          .verticalScroll(rememberScrollState())
          .padding(horizontal = 16.dp)
          .padding(top = 14.dp, bottom = 28.dp),
      verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
      Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
      ) {
        Surface(
          onClick = onDismiss,
          shape = CircleShape,
          color = Color.White,
          border = BorderStroke(1.dp, mobileBorder),
          modifier = Modifier.size(32.dp),
        ) {
          Box(contentAlignment = Alignment.Center) {
            Icon(
              Icons.AutoMirrored.Filled.KeyboardArrowLeft,
              contentDescription = "返回",
              tint = mobileText,
              modifier = Modifier.size(20.dp),
            )
          }
        }
        Text("任务详情", style = mobileHeadline.copy(fontWeight = FontWeight.SemiBold), color = mobileText)
      }
      Text(job.name, style = mobileTitle2.copy(fontWeight = FontWeight.Bold), color = mobileText)
      StatusChip(
        label = cronEnabledLabel(job.enabled),
        tone = if (job.enabled) TaskChipTone.Run else TaskChipTone.Wait,
      )
      DetailMeta(label = "计划", value = formatCronScheduleLabel(job))
      formatCronNextRun(job.nextRunAtMs)?.let { DetailMeta(label = "下次", value = it.removePrefix("下次 ").trim()) }
      if (!job.description.isNullOrBlank()) {
        DetailMeta(label = "描述", value = job.description)
      }
      if (!job.payloadMessage.isNullOrBlank()) {
        DetailMeta(label = "执行内容", value = job.payloadMessage)
      }
      Row(horizontalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.fillMaxWidth()) {
        MobilePrimaryButton(
          label = if (busy) "处理中…" else if (job.enabled) "暂停" else "启用",
          onClick = { onToggleEnabled(!job.enabled) },
          enabled = !busy,
          modifier = Modifier.weight(1f),
        )
        Surface(
          onClick = onRunNow,
          enabled = !busy,
          modifier = Modifier.weight(1f),
          shape = RoundedCornerShape(12.dp),
          color = Color.White,
          border = BorderStroke(1.dp, mobileBorder),
        ) {
          Box(
            modifier = Modifier.fillMaxWidth().padding(vertical = 14.dp),
            contentAlignment = Alignment.Center,
          ) {
            Text(
              if (busy) "处理中…" else "立即执行",
              style = mobileHeadline.copy(fontWeight = FontWeight.SemiBold),
              color = mobileTextSecondary,
            )
          }
        }
      }
    }
  }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun CronCreateSheet(
  connected: Boolean,
  onDismiss: () -> Unit,
  onSubmit: (
    name: String,
    message: String,
    scheduleKind: String,
    everyAmount: Int,
    everyUnit: String,
    cronExpr: String,
  ) -> Unit,
) {
  val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
  var name by remember { mutableStateOf("") }
  var message by remember { mutableStateOf("") }
  var scheduleKind by remember { mutableStateOf("cron") }
  var cronExpr by remember { mutableStateOf("0 9 * * *") }
  var everyAmount by remember { mutableStateOf("1") }
  var error by remember { mutableStateOf<String?>(null) }

  ModalBottomSheet(
    onDismissRequest = onDismiss,
    sheetState = sheetState,
    containerColor = Color.White,
  ) {
    Column(
      modifier =
        Modifier
          .fillMaxWidth()
          .verticalScroll(rememberScrollState())
          .padding(horizontal = 20.dp)
          .padding(bottom = 28.dp),
      verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
      Text("新建定时任务", style = mobileTitle2, color = mobileText)
      Text(
        "对齐 Web personal-cron-wizard → cron.add（精简字段：名称 / 执行内容 / 计划）。完整多步向导后续切片。",
        style = mobileCallout,
        color = mobileTextSecondary,
      )
      OutlinedTextField(
        value = name,
        onValueChange = { name = it },
        modifier = Modifier.fillMaxWidth(),
        singleLine = true,
        label = { Text("任务名称") },
        placeholder = { Text("例如：每日晨会纪要汇总") },
      )
      OutlinedTextField(
        value = message,
        onValueChange = { message = it },
        modifier = Modifier.fillMaxWidth(),
        minLines = 3,
        label = { Text("执行内容（agentTurn.message）") },
        placeholder = { Text("机器人每次触发时要做的事") },
      )
      Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        TextButton(onClick = { scheduleKind = "cron" }) {
          Text(
            "Cron 表达式",
            color = if (scheduleKind == "cron") mobileAccent else mobileTextSecondary,
            fontWeight = if (scheduleKind == "cron") FontWeight.SemiBold else FontWeight.Normal,
          )
        }
        TextButton(onClick = { scheduleKind = "every" }) {
          Text(
            "每隔…",
            color = if (scheduleKind == "every") mobileAccent else mobileTextSecondary,
            fontWeight = if (scheduleKind == "every") FontWeight.SemiBold else FontWeight.Normal,
          )
        }
      }
      if (scheduleKind == "cron") {
        OutlinedTextField(
          value = cronExpr,
          onValueChange = { cronExpr = it },
          modifier = Modifier.fillMaxWidth(),
          singleLine = true,
          label = { Text("Cron 表达式") },
          placeholder = { Text("0 9 * * *") },
        )
      } else {
        OutlinedTextField(
          value = everyAmount,
          onValueChange = { everyAmount = it.filter { ch -> ch.isDigit() }.ifEmpty { "1" } },
          modifier = Modifier.fillMaxWidth(),
          singleLine = true,
          label = { Text("间隔天数") },
          placeholder = { Text("1") },
        )
      }
      if (!error.isNullOrBlank()) {
        Text(error!!, style = mobileCallout, color = mobileDanger)
      }
      MobilePrimaryButton(
        label = "创建",
        enabled = connected,
        onClick = {
          val n = name.trim()
          val m = message.trim()
          if (n.isEmpty()) {
            error = "请填写任务名称"
            return@MobilePrimaryButton
          }
          if (m.isEmpty()) {
            error = "请填写执行内容"
            return@MobilePrimaryButton
          }
          error = null
          onSubmit(
            n,
            m,
            scheduleKind,
            everyAmount.toIntOrNull()?.coerceAtLeast(1) ?: 1,
            "days",
            cronExpr.trim().ifEmpty { "0 9 * * *" },
          )
        },
      )
    }
  }
}

@Composable
private fun DetailMeta(
  label: String,
  value: String,
) {
  // HTML SoT `.detail-row`: muted lab (min ~72) + value
  Row(
    modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp),
    horizontalArrangement = Arrangement.spacedBy(10.dp),
    verticalAlignment = Alignment.Top,
  ) {
    Text(
      label,
      style = mobileCallout,
      color = mobileTextSecondary,
      modifier = Modifier.widthIn(min = 72.dp),
    )
    Text(value, style = mobileCallout, color = mobileText, modifier = Modifier.weight(1f))
  }
}
