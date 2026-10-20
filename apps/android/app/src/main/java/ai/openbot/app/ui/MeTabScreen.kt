package ai.openbot.app.ui

import android.Manifest
import android.app.Activity
import android.content.pm.PackageManager
import android.os.Build
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.ScreenShare
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Groups
import androidx.compose.material.icons.filled.Link
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.PhoneAndroid
import androidx.compose.material.icons.filled.RecordVoiceOver
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.SmartToy
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import ai.openbot.app.MainViewModel
import ai.openbot.app.employeeauth.EmployeeShell
import ai.openbot.app.ui.chat.openDeliverableUrl
import ai.openbot.app.employeeauth.EmployeeAuthResult
import ai.openbot.app.employeeauth.EmployeeAuthClient
import kotlinx.coroutines.launch
import androidx.compose.foundation.horizontalScroll
import androidx.compose.material3.Checkbox
import androidx.compose.material3.HorizontalDivider
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

private enum class MeSheet {
  None,
  AccountInfo,
  Security,
  Prefs,
  Auth,
  Gateway,
  Perms,
  Devices,
  Robots,
  RobotEdit,
  Groups,
  GroupDetail,
  CreateBot,
  CreateGroup,
  Voice,
  Screen,
}

/**
 * Four-tab SoT 「我的」: 个人设置｜本机与连接｜更多.
 *
 * Reuses Web personal-settings / devices / my-bots / collab-space flows
 * (no Android-only parallel Me system). Compose adapts UI only.
 */
@Composable
fun MeTabScreen(
  viewModel: MainViewModel,
  onVoiceActiveChange: (Boolean) -> Unit,
  modifier: Modifier = Modifier,
  onOpenEmployeeWorkbench: (() -> Unit)? = null,
) {
  var segment by rememberSaveable { mutableStateOf(MeHubSegment.Account) }
  var sheet by rememberSaveable { mutableStateOf(MeSheet.None) }
  val isConnected by viewModel.isConnected.collectAsState()
  val statusText by viewModel.statusText.collectAsState()
  val context = LocalContext.current
  val scope = rememberCoroutineScope()
  val demoMe =
    remember(context) {
      ((context as? Activity)?.intent?.getBooleanExtra(DEMO_ME_EXTRA, false) == true)
    }
  val account =
    remember(context) {
      EmployeeShell.controller(context).activeAccount()
    }
  val identityCard =
    remember(account) {
      meIdentityCardFromAccount(
        email = account?.userEmail,
        orgId = account?.activeOrgId,
      )
    }

  var bots by remember { mutableStateOf<List<MeBotRow>>(emptyList()) }
  var groups by remember { mutableStateOf<List<MeGroupRow>>(emptyList()) }
  var authRows by remember { mutableStateOf<List<MeAuthResourceRow>>(emptyList()) }
  var devices by remember { mutableStateOf<List<MePairedDeviceRow>>(emptyList()) }
  var listBusy by remember { mutableStateOf(false) }
  var listError by remember { mutableStateOf<String?>(null) }
  var notice by remember { mutableStateOf<String?>(null) }
  var selectedBot by remember { mutableStateOf<MeBotRow?>(null) }
  var selectedGroup by remember { mutableStateOf<MeGroupRow?>(null) }

  LaunchedEffect(sheet) {
    onVoiceActiveChange(sheet == MeSheet.Voice)
  }

  suspend fun refreshMoreLists() {
    if (demoMe) {
      bots = DEMO_ME_BOTS
      groups = DEMO_ME_GROUPS
      return
    }
    if (!isConnected) {
      bots = emptyList()
      groups = emptyList()
      return
    }
    listBusy = true
    listError = null
    try {
      val agentsRaw = viewModel.gatewayRequest("agents.list", "{}")
      bots = parseAgentsListAsMeBots(agentsRaw)
      val spacesRaw = viewModel.gatewayRequest("collaboration.spaces.list", "{}")
      val actorKeys =
        buildSet {
          account?.userEmail?.let { add(it) }
          account?.activeOrgId?.let { add(it) }
        }
      groups = parseCollaborationSpacesAsMeGroups(spacesRaw, actorKeys)
    } catch (err: Throwable) {
      listError = err.message?.trim().orEmpty().ifEmpty { "加载失败" }.take(160)
    } finally {
      listBusy = false
    }
  }

  suspend fun refreshAuth() {
    if (demoMe) {
      authRows = DEMO_ME_AUTH
      return
    }
    if (!isConnected) {
      authRows = emptyList()
      return
    }
    listBusy = true
    listError = null
    try {
      val personalRaw = viewModel.gatewayRequest("user-operational-identity.list", "{}")
      val personal = parseUserOperationalIdentities(personalRaw)
      val enterprise =
        try {
          parseEnterpriseSeatIdentities(
            viewModel.gatewayRequest("enterprise-operational-identity.access.list-for-seat", "{}"),
          )
        } catch (_: Throwable) {
          emptyList()
        }
      // Models: Web employee-model-access.summary (seat entitlement read model).
      val models =
        try {
          parseEmployeeModelAccessSummary(
            viewModel.gatewayRequest("employee-model-access.summary", "{}"),
          )
        } catch (err: Throwable) {
          listOf(
            MeAuthResourceRow(
              id = "model-error",
              title = "可用模型",
              subtitle = "加载失败：${err.message?.take(80) ?: "未知错误"}",
              zone = MeIdentityZone.Model,
            ),
          )
        }
      authRows = personal + enterprise + models
    } catch (err: Throwable) {
      listError = err.message?.trim().orEmpty().ifEmpty { "加载授权失败" }.take(160)
    } finally {
      listBusy = false
    }
  }

  suspend fun refreshDevices() {
    if (demoMe) {
      devices = DEMO_ME_DEVICES
      return
    }
    if (!isConnected) {
      devices = emptyList()
      return
    }
    try {
      val raw = viewModel.gatewayRequest("device.pair.list", "{}")
      devices = parseDevicePairList(raw)
    } catch (err: Throwable) {
      listError = err.message?.trim().orEmpty().ifEmpty { "加载设备失败" }.take(160)
    }
  }

  LaunchedEffect(segment, isConnected, demoMe, sheet) {
    when {
      sheet == MeSheet.Auth -> refreshAuth()
      sheet == MeSheet.Devices -> refreshDevices()
      sheet == MeSheet.Robots || sheet == MeSheet.Groups || segment == MeHubSegment.More ->
        refreshMoreLists()
      sheet == MeSheet.None && segment == MeHubSegment.Device -> refreshDevices()
    }
  }

  when (sheet) {
    MeSheet.None -> {
      Column(modifier = modifier.fillMaxSize()) {
        LazyColumn(
          modifier = Modifier.fillMaxSize(),
          contentPadding =
            PaddingValues(
              horizontal = mobilePageGutter,
              vertical = mobilePageVertical,
            ),
          verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
          item {
            MobilePageHeader(title = "我的")
          }
          item {
            MeSegmentBar(
              segment = segment,
              onSelect = {
                segment = it
                notice = null
              },
            )
          }
          val banner = notice
          if (!banner.isNullOrBlank()) {
            item {
              MobileSoftBanner(text = banner, tone = MobileBannerTone.Neutral)
            }
          }
          when (segment) {
            MeHubSegment.Account -> {
              item { MeIdentityCard(state = identityCard) }
              item { MobileSectionLabel(text = "账号与安全") }
              item {
                // HTML SoT `.group` single card with row dividers
                MobileGroupedNavCard(
                  rows =
                    listOf(
                      MobileGroupedNavItem(
                        title = "账号信息",
                        subtitle = "个人资料 · 企业与岗位",
                        icon = Icons.Default.Person,
                        onClick = { sheet = MeSheet.AccountInfo },
                      ),
                      MobileGroupedNavItem(
                        title = "安全",
                        subtitle = "登录密码",
                        icon = Icons.Default.Lock,
                        onClick = { sheet = MeSheet.Security },
                      ),
                      MobileGroupedNavItem(
                        title = "偏好",
                        subtitle = "语言 · 主题",
                        icon = Icons.Default.Settings,
                        onClick = { sheet = MeSheet.Prefs },
                      ),
                      MobileGroupedNavItem(
                        title = "授权",
                        subtitle = "身份与模型",
                        icon = Icons.Default.Link,
                        onClick = { sheet = MeSheet.Auth },
                      ),
                    ),
                )
              }
            }
            MeHubSegment.Device -> {
              if (!isConnected && !demoMe) {
                item {
                  MobileSoftBanner(
                    text = "未连接网关。点此或下方「去连接网关」进行连接。",
                    tone = MobileBannerTone.Warning,
                    modifier = Modifier.clickable { sheet = MeSheet.Gateway },
                  )
                }
              }
              item { MobileSectionLabel(text = "连接") }
              item {
                MeNavRowWithBadge(
                  title = "连接网关",
                  subtitle =
                    if (isConnected) {
                      statusText.ifBlank { "已连接" }
                    } else {
                      "云端账号登录 · 查看连接状态"
                    },
                  icon = Icons.Default.CheckCircle,
                  badge = if (isConnected) "已连接" else "未连接",
                  badgeWarn = !isConnected,
                  onClick = { sheet = MeSheet.Gateway },
                )
              }
              item {
                MobileNavRow(
                  title = "设备与权限",
                  subtitle = "麦克风、相机、通知、定位",
                  icon = Icons.Default.PhoneAndroid,
                  onClick = { sheet = MeSheet.Perms },
                )
              }
              item {
                MeNavRowWithBadge(
                  title = "我的设备",
                  subtitle = "已配对设备只读列表 · Web device.pair.list",
                  icon = Icons.Default.Settings,
                  badge = if (devices.isEmpty()) "—" else "${devices.size} 台",
                  badgeWarn = false,
                  onClick = { sheet = MeSheet.Devices },
                )
              }
              item { MobileSectionLabel(text = "本机权限预览") }
              item { MePermissionPreviewGrid() }
              item {
                MobilePrimaryButton(
                  label = if (isConnected) "查看连接状态" else "去连接网关",
                  onClick = { sheet = MeSheet.Gateway },
                )
              }
              item { MobileSectionLabel(text = "本机能力") }
              item {
                MobileGroupedNavCard(
                  rows =
                    listOf(
                      MobileGroupedNavItem(
                        title = "语音对话",
                        subtitle = "可选能力",
                        icon = Icons.Default.RecordVoiceOver,
                        onClick = { sheet = MeSheet.Voice },
                      ),
                      MobileGroupedNavItem(
                        title = "画布",
                        subtitle = "查看网关推送的内容",
                        icon = Icons.AutoMirrored.Filled.ScreenShare,
                        onClick = { sheet = MeSheet.Screen },
                      ),
                    ),
                )
              }
            }
            MeHubSegment.More -> {
              item {
                val moreRows = mutableListOf(
                  MobileGroupedNavItem(
                    title = "我的机器人",
                    subtitle = "管理身份、能力、授权与协作。",
                    icon = Icons.Default.SmartToy,
                    onClick = { sheet = MeSheet.Robots },
                  ),
                  MobileGroupedNavItem(
                    title = "我的协作小组",
                    subtitle = "群主 · 成员",
                    icon = Icons.Default.Groups,
                    onClick = { sheet = MeSheet.Groups },
                  ),
                )
                if (onOpenEmployeeWorkbench != null) {
                  moreRows.add(
                    MobileGroupedNavItem(
                      title = "员工工作台",
                      subtitle = "返回已登录的工作台（Web 同壳）",
                      icon = Icons.Default.CheckCircle,
                      onClick = { onOpenEmployeeWorkbench.invoke() },
                    ),
                  )
                }
                MobileGroupedNavCard(rows = moreRows)
              }
              if (listBusy) {
                item {
                  Row(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                  ) {
                    CircularProgressIndicator(
                      modifier = Modifier.size(16.dp),
                      strokeWidth = 2.dp,
                      color = mobileAccent,
                    )
                    Text("正在同步机器人 / 协作小组…", style = mobileCallout, color = mobileTextSecondary)
                  }
                }
              }
              listError?.let { err ->
                item {
                  MobileSoftBanner(text = "加载失败：$err", tone = MobileBannerTone.Warning)
                }
              }
            }
          }
        }
      }
    }
    MeSheet.AccountInfo -> {
      MeSubScaffold(title = "账号信息", onBack = { sheet = MeSheet.None }, modifier = modifier) {
        MeAccountInfoSheet(identity = identityCard)
      }
    }
    MeSheet.Security -> {
      MeSubScaffold(title = "账号安全", onBack = { sheet = MeSheet.None }, modifier = modifier) {
        MeSecuritySheet(
          onNotice = { notice = it },
          onChangePassword = { current, next ->
            scope.launch {
              val acct = account
              if (acct == null) {
                notice = "未登录员工账号，无法改密"
                return@launch
              }
              val client =
                EmployeeAuthClient(
                  acct.gatewayBaseURL,
                  EmployeeShell.controller(context).session.clientFor(acct.accountId),
                )
              when (val result = client.changePassword(current, next)) {
                is EmployeeAuthResult.Success -> notice = result.message ?: "密码已更新"
                is EmployeeAuthResult.Failure -> notice = "改密失败：${result.message}"
              }
            }
          },
        )
      }
    }
    MeSheet.Prefs -> {
      MeSubScaffold(title = "偏好", onBack = { sheet = MeSheet.None }, modifier = modifier) {
        MePrefsSheet()
      }
    }
    MeSheet.Auth -> {
      MeSubScaffold(title = "授权资源", onBack = { sheet = MeSheet.None }, modifier = modifier) {
        MeAuthSheet(
          rows = authRows,
          busy = listBusy,
          error = listError,
          demo = demoMe,
          onOpenWebIdentityWizard = {
            // Prefer session-bound Employee Shell「我的」embed (personal settings).
            // Custom Tabs cannot share the OkHttp session cookie jar.
            if (onOpenEmployeeWorkbench != null) {
              onOpenEmployeeWorkbench.invoke()
            } else {
              val base = account?.gatewayBaseURL?.trimEnd('/')
              if (!base.isNullOrBlank()) {
                openDeliverableUrl(
                  context,
                  "$base/embed/employee/me#operational-identity",
                )
                notice = "已打开 Web 授权页（若未登录请先在工作台登录）"
              } else {
                notice = "请先连接网关并登录，再打开 Web 身份向导"
              }
            }
          },
        )
      }
    }
    MeSheet.Gateway -> {
      MeSubScaffold(title = "连接网关", onBack = { sheet = MeSheet.None }, modifier = modifier) {
        ConnectTabScreen(viewModel = viewModel, embedded = true)
      }
    }
    MeSheet.Perms -> {
      MeSubScaffold(title = "设备与权限", onBack = { sheet = MeSheet.None }, modifier = modifier) {
        SettingsSheet(viewModel = viewModel, embedded = true)
      }
    }
    MeSheet.Devices -> {
      MeSubScaffold(title = "我的设备", onBack = { sheet = MeSheet.None }, modifier = modifier) {
        MeDevicesSheet(devices = devices, offline = !isConnected && !demoMe)
      }
    }
    MeSheet.Robots -> {
      MeSubScaffold(
        title = "我的机器人",
        onBack = { sheet = MeSheet.None },
        modifier = modifier,
        trailing = {
          Surface(
            onClick = { sheet = MeSheet.CreateBot },
            shape = CircleShape,
            color = Color.White,
            border = BorderStroke(1.dp, mobileBorder),
            modifier = Modifier.size(32.dp),
          ) {
            Box(contentAlignment = Alignment.Center, modifier = Modifier.fillMaxSize()) {
              Icon(Icons.Default.Add, contentDescription = "新建数字员工", tint = mobileAccent, modifier = Modifier.size(18.dp))
            }
          }
        },
      ) {
        MeBotsSheet(
          bots = bots,
          busy = listBusy,
          error = listError,
          onOpen = {
            selectedBot = it
            sheet = MeSheet.RobotEdit
          },
        )
      }
    }
    MeSheet.RobotEdit -> {
      val bot = selectedBot
      MeSubScaffold(
        title = bot?.name ?: "编辑机器人",
        onBack = { sheet = MeSheet.Robots },
        modifier = modifier,
      ) {
        if (bot == null) {
          MobileSoftBanner(text = "未选择机器人", tone = MobileBannerTone.Warning)
        } else {
          MeRobotWorkspaceEditor(
            bot = bot,
            demoMe = demoMe,
            isConnected = isConnected,
            gatewayRequest = { method, params -> viewModel.gatewayRequest(method, params) },
            onNotice = { notice = it },
            onOpenGroup = { groupId ->
              val match = groups.firstOrNull { it.groupId == groupId || it.groupId.removePrefix("space:") == groupId }
              if (match != null) {
                selectedGroup = match
                sheet = MeSheet.GroupDetail
              } else {
                notice = "未找到协作组 $groupId"
              }
            },
            onIdentitySaved = { name, positioning, role, persona ->
              bots =
                bots.map {
                  if (it.agentId == bot.agentId) {
                    it.copy(
                      name = name,
                      positioning = positioning,
                      roleTitle = role,
                      persona = persona,
                    )
                  } else {
                    it
                  }
                }
              selectedBot =
                selectedBot?.copy(
                  name = name,
                  positioning = positioning,
                  roleTitle = role,
                  persona = persona,
                )
              sheet = MeSheet.Robots
            },
            onRefreshLists = { refreshMoreLists() },
          )
        }
      }
    }
    MeSheet.Groups -> {
      MeSubScaffold(
        title = "我的协作小组",
        onBack = { sheet = MeSheet.None },
        modifier = modifier,
        trailing = {
          Surface(
            onClick = { sheet = MeSheet.CreateGroup },
            shape = CircleShape,
            color = Color.White,
            border = BorderStroke(1.dp, mobileBorder),
            modifier = Modifier.size(32.dp),
          ) {
            Box(contentAlignment = Alignment.Center, modifier = Modifier.fillMaxSize()) {
              Icon(Icons.Default.Add, contentDescription = "新建协作空间", tint = mobileAccent, modifier = Modifier.size(18.dp))
            }
          }
        },
      ) {
        MeGroupsSheet(
          groups = groups,
          busy = listBusy,
          error = listError,
          onOpen = {
            selectedGroup = it
            sheet = MeSheet.GroupDetail
          },
        )
      }
    }
    MeSheet.GroupDetail -> {
      val group = selectedGroup
      MeSubScaffold(
        title = group?.title ?: "协作小组",
        onBack = { sheet = MeSheet.Groups },
        modifier = modifier,
      ) {
        if (group == null) {
          MobileSoftBanner(text = "未选择协作小组", tone = MobileBannerTone.Warning)
        } else {
          MeGroupDetailSheet(
            group = group,
            canEdit = group.myRoleLabel == "群主",
            onSave = { title, purpose ->
              scope.launch {
                try {
                  if (!isConnected && !demoMe) {
                    notice = "未连接网关，无法保存设置"
                    return@launch
                  }
                  if (demoMe) {
                    notice = "DEMO：已本地更新「$title」"
                    groups =
                      groups.map {
                        if (it.groupId == group.groupId) it.copy(title = title, purpose = purpose) else it
                      }
                    sheet = MeSheet.Groups
                    return@launch
                  }
                  viewModel.gatewayRequest(
                    "collaboration.spaces.members.update",
                    buildSpaceCreateParams(
                      groupId = group.groupId,
                      title = title,
                      avatar = group.avatar,
                      purpose = purpose,
                    ),
                  )
                  notice = "已保存设置"
                  refreshMoreLists()
                  sheet = MeSheet.Groups
                } catch (err: Throwable) {
                  notice = "保存失败：${err.message?.take(120) ?: "未知错误"}"
                }
              }
            },
            onInviteHuman = { email ->
              scope.launch {
                try {
                  if (!isConnected && !demoMe) {
                    notice = "未连接网关，无法邀请"
                    return@launch
                  }
                  if (demoMe) {
                    notice = "DEMO：已模拟邀请 $email"
                    return@launch
                  }
                  viewModel.gatewayRequest(
                    "collaboration.spaces.members.update",
                    buildSpaceInviteHumanParams(
                      groupId = group.groupId,
                      title = group.title,
                      purpose = group.purpose,
                      inviteUserId = email,
                      inviteName = email.substringBefore("@"),
                    ),
                  )
                  notice = "已发送邀请：$email"
                  refreshMoreLists()
                } catch (err: Throwable) {
                  notice = "邀请失败：${err.message?.take(120) ?: "未知错误"}"
                }
              }
            },
          )
        }
      }
    }
    MeSheet.CreateBot -> {
      MeSubScaffold(title = "新建数字员工", onBack = { sheet = MeSheet.Robots }, modifier = modifier) {
        MeCreateBotSheet(
          onCreate = { name, emoji ->
            scope.launch {
              try {
                if (!isConnected && !demoMe) {
                  notice = "未连接网关，无法创建"
                  return@launch
                }
                if (demoMe) {
                  val row =
                    MeBotRow(
                      agentId = slugifyMeEntityId("agent", name),
                      name = name,
                      emoji = emoji,
                      access = MeBotAccess.Owned,
                      subtitle = "可用",
                    )
                  bots = bots + row
                  notice = "DEMO：已创建「$name」（未写网关）"
                  sheet = MeSheet.Robots
                  return@launch
                }
                // Mirror Web managed path: workspaces.create → agents.create → robots.bind-workspace.
                val slug = slugifyMeEntityId("agent", name).removePrefix("agent-")
                val wsRaw =
                  viewModel.gatewayRequest(
                    "workspaces.create",
                    buildWorkspaceCreateLocalParams(name, slug),
                  )
                val (workspaceId, runtimePath) = parseWorkspaceCreateResult(wsRaw)
                val workspace =
                  runtimePath?.takeIf { it.isNotBlank() }
                    ?: "$ME_MANAGED_WORKSPACE_ROOT/agents/${slug.ifBlank { "agent" }}"
                val agentRaw =
                  viewModel.gatewayRequest(
                    "agents.create",
                    buildAgentCreateParams(name, emoji, workspace),
                  )
                val agentId = parseAgentCreateResult(agentRaw)
                if (!agentId.isNullOrBlank() && !workspaceId.isNullOrBlank()) {
                  runCatching {
                    viewModel.gatewayRequest(
                      "robots.bind-workspace",
                      buildRobotBindWorkspaceParams(agentId, workspaceId),
                    )
                  }
                }
                notice = "已创建「$name」"
                refreshMoreLists()
                sheet = MeSheet.Robots
              } catch (err: Throwable) {
                notice =
                  "创建失败：${err.message?.take(140) ?: "未知错误"}（需网关支持 workspaces.create 本地受管路径；云端向导仍见 Web）"
              }
            }
          },
        )
      }
    }
    MeSheet.CreateGroup -> {
      MeSubScaffold(title = "新建协作空间", onBack = { sheet = MeSheet.Groups }, modifier = modifier) {
        MeCreateGroupSheet(
          onCreate = { title, avatar, purpose ->
            scope.launch {
              try {
                if (!isConnected && !demoMe) {
                  notice = "未连接网关，无法创建"
                  return@launch
                }
                val groupId = slugifyMeEntityId("space", title)
                if (demoMe) {
                  groups =
                    groups +
                      MeGroupRow(
                        groupId = groupId,
                        title = title,
                        avatar = avatar,
                        memberCount = 1,
                        myRoleLabel = "群主",
                        ownerLabel = identityCard.displayName,
                        coordinatorBotLabel = null,
                        purpose = purpose,
                      )
                  notice = "DEMO：已创建「$title」"
                  sheet = MeSheet.Groups
                  return@launch
                }
                viewModel.gatewayRequest(
                  "collaboration.spaces.members.update",
                  buildSpaceCreateParams(groupId, title, avatar, purpose),
                )
                notice = "已创建「$title」"
                refreshMoreLists()
                sheet = MeSheet.Groups
              } catch (err: Throwable) {
                notice = "创建失败：${err.message?.take(140) ?: "未知错误"}"
              }
            }
          },
        )
      }
    }
    MeSheet.Voice -> {
      MeSubScaffold(title = "语音对话", onBack = { sheet = MeSheet.None }, modifier = modifier) {
        VoiceTabScreen(viewModel = viewModel)
      }
    }
    MeSheet.Screen -> {
      MeSubScaffold(title = "画布", onBack = { sheet = MeSheet.None }, modifier = modifier) {
        Box(modifier = Modifier.fillMaxSize()) {
          CanvasScreen(viewModel = viewModel, modifier = Modifier.fillMaxSize())
        }
      }
    }
  }
}

@Composable
private fun MeSegmentBar(
  segment: MeHubSegment,
  onSelect: (MeHubSegment) -> Unit,
) {
  SoTSegmentedControl(
    options = listOf("个人设置", "本机与连接", "更多"),
    selectedIndex =
      when (segment) {
        MeHubSegment.Account -> 0
        MeHubSegment.Device -> 1
        MeHubSegment.More -> 2
      },
    onSelect = { idx ->
      onSelect(
        when (idx) {
          1 -> MeHubSegment.Device
          2 -> MeHubSegment.More
          else -> MeHubSegment.Account
        },
      )
    },
    compact = true,
  )
}

@Composable
private fun MeIdentityCard(
  state: MeIdentityCardState,
  modifier: Modifier = Modifier,
) {
  MobileWhiteCard(modifier = modifier) {
    Row(
      modifier = Modifier.fillMaxWidth(),
      horizontalArrangement = Arrangement.spacedBy(12.dp),
      verticalAlignment = Alignment.CenterVertically,
    ) {
      Surface(shape = CircleShape, color = mobileAccentSoft) {
        Box(
          modifier = Modifier.size(44.dp),
          contentAlignment = Alignment.Center,
        ) {
          Text(
            state.avatarGlyph,
            style = mobileHeadline.copy(fontWeight = FontWeight.Bold),
            color = mobileAccent,
          )
        }
      }
      Column(
        modifier = Modifier.weight(1f),
        verticalArrangement = Arrangement.spacedBy(3.dp),
      ) {
        Text(state.displayName, style = mobileHeadline, color = mobileText)
        Text(state.email, style = mobileCallout, color = mobileTextSecondary)
        Text(state.orgLine, style = mobileCaption1, color = mobileTextTertiary)
      }
    }
  }
}

@Composable
private fun MeNavRowWithBadge(
  title: String,
  subtitle: String,
  icon: ImageVector,
  badge: String,
  badgeWarn: Boolean,
  onClick: () -> Unit,
) {
  Surface(
    onClick = onClick,
    modifier = Modifier.fillMaxWidth(),
    shape = RoundedCornerShape(14.dp),
    color = Color.White,
    border = BorderStroke(1.dp, mobileBorder),
  ) {
    Row(
      modifier = Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 14.dp),
      horizontalArrangement = Arrangement.spacedBy(12.dp),
      verticalAlignment = Alignment.CenterVertically,
    ) {
      Surface(shape = RoundedCornerShape(10.dp), color = mobileAccentSoft) {
        Icon(
          imageVector = icon,
          contentDescription = null,
          tint = mobileAccent,
          modifier = Modifier.padding(8.dp).size(20.dp),
        )
      }
      Column(
        modifier = Modifier.weight(1f),
        verticalArrangement = Arrangement.spacedBy(3.dp),
      ) {
        Text(title, style = mobileHeadline, color = mobileText)
        Text(subtitle, style = mobileCallout, color = mobileTextSecondary)
      }
      Surface(
        shape = RoundedCornerShape(999.dp),
        color = if (badgeWarn) mobileWarningSoft else mobileSuccessSoft,
      ) {
        Text(
          badge,
          modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
          style = mobileCaption1,
          color = if (badgeWarn) mobileWarning else mobileSuccess,
        )
      }
    }
  }
}

@Composable
private fun MePermissionPreviewGrid() {
  val context = LocalContext.current
  fun granted(permission: String): Boolean =
    ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED
  val mic = granted(Manifest.permission.RECORD_AUDIO)
  val camera = granted(Manifest.permission.CAMERA)
  val location =
    granted(Manifest.permission.ACCESS_FINE_LOCATION) ||
      granted(Manifest.permission.ACCESS_COARSE_LOCATION)
  val notify =
    if (Build.VERSION.SDK_INT >= 33) {
      granted(Manifest.permission.POST_NOTIFICATIONS)
    } else {
      true
    }
  Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
      MePermCard("麦克风", if (mic) "已允许" else "未开启", mic, Modifier.weight(1f))
      MePermCard("相机", if (camera) "已允许" else "未开启", camera, Modifier.weight(1f))
    }
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
      MePermCard("通知", if (notify) "已允许" else "未开启", notify, Modifier.weight(1f))
      MePermCard("定位", if (location) "已允许" else "询问中", location, Modifier.weight(1f))
    }
  }
}

@Composable
private fun MePermCard(
  name: String,
  state: String,
  ok: Boolean,
  modifier: Modifier = Modifier,
) {
  Surface(
    modifier = modifier,
    shape = RoundedCornerShape(12.dp),
    color = Color.White,
    border = BorderStroke(1.dp, mobileBorder),
  ) {
    Column(
      modifier = Modifier.padding(12.dp),
      verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
      Text(name, style = mobileCallout.copy(fontWeight = FontWeight.SemiBold), color = mobileText)
      Row(
        horizontalArrangement = Arrangement.spacedBy(6.dp),
        verticalAlignment = Alignment.CenterVertically,
      ) {
        Surface(
          shape = CircleShape,
          color = if (ok) mobileSuccess else mobileWarning,
          modifier = Modifier.size(8.dp),
        ) {}
        Text(state, style = mobileCaption1, color = mobileTextSecondary)
      }
    }
  }
}

@Composable
private fun MeAccountInfoSheet(identity: MeIdentityCardState) {
  Column(
    modifier =
      Modifier
        .fillMaxSize()
        .verticalScroll(rememberScrollState())
        .padding(horizontal = mobilePageGutter, vertical = 8.dp),
    verticalArrangement = Arrangement.spacedBy(12.dp),
  ) {
    MobileSoftBanner(
      text = "账号资料对齐 Web 个人设置 → 账号信息；手机端当前为只读投影（编辑走 Web / 后续 HTTP 写接口）。",
      tone = MobileBannerTone.Neutral,
    )
    MobileSectionLabel(text = "个人资料")
    MobileWhiteCard {
      MobileInfoBlock(label = "显示名称", value = identity.displayName)
      Spacer(Modifier.height(10.dp))
      MobileInfoBlock(label = "邮箱", value = identity.email)
    }
    MobileSectionLabel(text = "企业与岗位")
    MobileWhiteCard {
      MobileInfoBlock(label = "组织", value = identity.orgLine)
    }
  }
}

@Composable
private fun MeSecuritySheet(
  onNotice: (String) -> Unit,
  onChangePassword: (current: String, next: String) -> Unit,
) {
  var current by rememberSaveable { mutableStateOf("") }
  var next by rememberSaveable { mutableStateOf("") }
  var confirm by rememberSaveable { mutableStateOf("") }
  Column(
    modifier =
      Modifier
        .fillMaxSize()
        .verticalScroll(rememberScrollState())
        .padding(horizontal = mobilePageGutter, vertical = 8.dp),
    verticalArrangement = Arrangement.spacedBy(12.dp),
  ) {
    MobileSoftBanner(
      text = "对齐 Web `changePlatformAuthPassword` → `/__openbot/platform-auth/password/change`（EmployeeAuthClient）。",
      tone = MobileBannerTone.Neutral,
    )
    MobileSectionLabel(text = "修改密码")
    OutlinedTextField(
      value = current,
      onValueChange = { current = it },
      label = { Text("当前密码") },
      modifier = Modifier.fillMaxWidth(),
      singleLine = true,
    )
    OutlinedTextField(
      value = next,
      onValueChange = { next = it },
      label = { Text("新密码") },
      modifier = Modifier.fillMaxWidth(),
      singleLine = true,
    )
    OutlinedTextField(
      value = confirm,
      onValueChange = { confirm = it },
      label = { Text("确认新密码") },
      modifier = Modifier.fillMaxWidth(),
      singleLine = true,
    )
    MobilePrimaryButton(
      label = "保存",
      onClick = {
        when {
          current.isBlank() -> onNotice("请输入当前密码")
          next.length < 8 -> onNotice("新密码至少 8 位")
          next != confirm -> onNotice("两次输入的新密码不一致")
          next == current -> onNotice("新密码不能与当前密码相同")
          else -> onChangePassword(current, next)
        }
      },
    )
  }
}

@Composable
private fun MePrefsSheet() {
  Column(
    modifier =
      Modifier
        .fillMaxSize()
        .verticalScroll(rememberScrollState())
        .padding(horizontal = mobilePageGutter, vertical = 8.dp),
    verticalArrangement = Arrangement.spacedBy(12.dp),
  ) {
    MobileSoftBanner(
      text = "对齐 Web 工作台偏好（语言 / 主题）；手机端跟随系统，完整切换仍在 Web `workbench-personal-preferences-panel`。",
      tone = MobileBannerTone.Neutral,
    )
    MobileSectionLabel(text = "界面与语言")
    MobileWhiteCard {
      MobileInfoBlock(label = "语言", value = "跟随系统 / Web 设置")
      Spacer(Modifier.height(10.dp))
      MobileInfoBlock(label = "主题", value = "跟随系统")
    }
  }
}

@Composable
private fun MeAuthSheet(
  rows: List<MeAuthResourceRow>,
  busy: Boolean,
  error: String?,
  demo: Boolean,
  onOpenWebIdentityWizard: () -> Unit,
) {
  val personal = rows.filter { it.zone == MeIdentityZone.Personal }
  val enterprise = rows.filter { it.zone == MeIdentityZone.Enterprise }
  val models = rows.filter { it.zone == MeIdentityZone.Model }
  LazyColumn(
    contentPadding = PaddingValues(horizontal = mobilePageGutter, vertical = 8.dp),
    verticalArrangement = Arrangement.spacedBy(10.dp),
  ) {
    item {
      MobileSoftBanner(
        text =
          if (demo) {
            "DEMO 授权资源三区（个人 / 企业 / 模型）。"
          } else {
            "对齐 Web 授权：`user-operational-identity.list` + 企业席位 + `employee-model-access.summary`；完整 OAuth/微信扫码向导走员工工作台「我的」。"
          },
        tone = MobileBannerTone.Neutral,
      )
    }
    if (busy) {
      item {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
          CircularProgressIndicator(modifier = Modifier.size(16.dp), strokeWidth = 2.dp, color = mobileAccent)
          Text("加载授权资源…", style = mobileCallout, color = mobileTextSecondary)
        }
      }
    }
    error?.let {
      item { MobileSoftBanner(text = it, tone = MobileBannerTone.Warning) }
    }
    item { MobileSectionLabel(text = "个人自有身份") }
    if (personal.isEmpty()) {
      item { MobileSoftBanner(text = "暂无个人身份。可打开 Web 向导绑定。", tone = MobileBannerTone.Neutral) }
    } else {
      items(personal, key = { it.id }) { MeAuthItem(it) }
    }
    item {
      TextButton(onClick = onOpenWebIdentityWizard) {
        Text("添加个人身份（打开 Web 向导）", color = mobileAccent)
      }
    }
    item { MobileSectionLabel(text = "企业身份") }
    if (enterprise.isEmpty()) {
      item { MobileSoftBanner(text = "暂无企业身份。", tone = MobileBannerTone.Neutral) }
    } else {
      items(enterprise, key = { it.id }) { MeAuthItem(it) }
    }
    item {
      TextButton(onClick = onOpenWebIdentityWizard) {
        Text("添加企业身份（打开 Web 向导）", color = mobileAccent)
      }
    }
    item { MobileSectionLabel(text = "可用模型") }
    if (models.isEmpty()) {
      item { MobileSoftBanner(text = "暂无模型条目。", tone = MobileBannerTone.Neutral) }
    } else {
      items(models, key = { it.id }) { MeAuthItem(it) }
    }
  }
}

@Composable
private fun MeAuthItem(row: MeAuthResourceRow) {
  MobileWhiteCard {
    Text(row.title, style = mobileHeadline, color = mobileText)
    Spacer(Modifier.height(4.dp))
    Text(row.subtitle, style = mobileCallout, color = mobileTextSecondary)
  }
}

@Composable
private fun MeDevicesSheet(
  devices: List<MePairedDeviceRow>,
  offline: Boolean,
) {
  LazyColumn(
    contentPadding = PaddingValues(horizontal = mobilePageGutter, vertical = 8.dp),
    verticalArrangement = Arrangement.spacedBy(10.dp),
  ) {
    item {
      MobileSoftBanner(
        text = "对齐 Web 系统设置 → 我的设备（`device.pair.list`）。",
        tone = MobileBannerTone.Neutral,
      )
    }
    if (offline) {
      item {
        MobileSoftBanner(text = "未连接网关：连接后拉取已配对设备。", tone = MobileBannerTone.Warning)
      }
    } else if (devices.isEmpty()) {
      item { MobileSoftBanner(text = "暂无已配对设备。", tone = MobileBannerTone.Neutral) }
    } else {
      items(devices, key = { it.deviceId }) { device ->
        MobileWhiteCard {
          Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalAlignment = Alignment.CenterVertically,
          ) {
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
              Text(device.displayName, style = mobileHeadline, color = mobileText)
              Text(
                buildString {
                  append(device.platform ?: "device")
                  if (device.isCurrent) append(" · 当前设备")
                },
                style = mobileCallout,
                color = mobileTextSecondary,
              )
            }
            Surface(
              shape = RoundedCornerShape(999.dp),
              color = mobileSuccessSoft,
            ) {
              Text(
                "已配对",
                modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
                style = mobileCaption1,
                color = mobileSuccess,
              )
            }
          }
        }
      }
    }
  }
}

@Composable
private fun MeBotsSheet(
  bots: List<MeBotRow>,
  busy: Boolean,
  error: String?,
  onOpen: (MeBotRow) -> Unit,
) {
  LazyColumn(
    contentPadding = PaddingValues(horizontal = mobilePageGutter, vertical = 8.dp),
    verticalArrangement = Arrangement.spacedBy(10.dp),
  ) {
    item {
      MobileSoftBanner(
        text = "对齐 Web「我的机器人」：`agents.list` + `robot.workspace.get` / `updateIdentity`（tabs 身份|能力|成长|运营授权|协作）。",
        tone = MobileBannerTone.Neutral,
      )
    }
    if (busy) {
      item {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
          CircularProgressIndicator(modifier = Modifier.size(16.dp), strokeWidth = 2.dp, color = mobileAccent)
          Text("加载中…", style = mobileCallout, color = mobileTextSecondary)
        }
      }
    }
    error?.let { item { MobileSoftBanner(text = it, tone = MobileBannerTone.Warning) } }
    if (!busy && bots.isEmpty()) {
      item { MobileSoftBanner(text = "当前还没有可展示的机器人。", tone = MobileBannerTone.Neutral) }
    }
    items(bots, key = { it.agentId }) { bot ->
      MeMgmtRow(
        emoji = bot.emoji ?: "🤖",
        title = bot.name,
        subtitle = bot.subtitle,
        badge = meBotAccessBadge(bot.access),
        badgeOwned = bot.access == MeBotAccess.Owned,
        onClick = { onOpen(bot) },
      )
    }
  }
}

@Composable
private fun MeGroupsSheet(
  groups: List<MeGroupRow>,
  busy: Boolean,
  error: String?,
  onOpen: (MeGroupRow) -> Unit,
) {
  LazyColumn(
    contentPadding = PaddingValues(horizontal = mobilePageGutter, vertical = 8.dp),
    verticalArrangement = Arrangement.spacedBy(10.dp),
  ) {
    item {
      MobileSoftBanner(
        text = "对齐 Web「我的协作小组」：`collaboration.spaces.list`。",
        tone = MobileBannerTone.Neutral,
      )
    }
    if (busy) {
      item {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
          CircularProgressIndicator(modifier = Modifier.size(16.dp), strokeWidth = 2.dp, color = mobileAccent)
          Text("加载中…", style = mobileCallout, color = mobileTextSecondary)
        }
      }
    }
    error?.let { item { MobileSoftBanner(text = it, tone = MobileBannerTone.Warning) } }
    if (!busy && groups.isEmpty()) {
      item { MobileSoftBanner(text = "当前还没有可展示的协作小组。", tone = MobileBannerTone.Neutral) }
    }
    items(groups, key = { it.groupId }) { group ->
      MeMgmtRow(
        emoji = group.avatar ?: "👥",
        title = group.title,
        subtitle = meGroupSubtitle(group),
        badge = group.myRoleLabel,
        badgeOwned = group.myRoleLabel == "群主",
        onClick = { onOpen(group) },
      )
    }
  }
}

@Composable
private fun MeMgmtRow(
  emoji: String,
  title: String,
  subtitle: String,
  badge: String,
  badgeOwned: Boolean,
  onClick: () -> Unit,
) {
  Surface(
    onClick = onClick,
    modifier = Modifier.fillMaxWidth(),
    shape = RoundedCornerShape(14.dp),
    color = Color.White,
    border = BorderStroke(1.dp, mobileBorder),
  ) {
    Row(
      modifier = Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 14.dp),
      horizontalArrangement = Arrangement.spacedBy(12.dp),
      verticalAlignment = Alignment.CenterVertically,
    ) {
      Text(emoji, style = mobileTitle2)
      Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Row(
          horizontalArrangement = Arrangement.spacedBy(8.dp),
          verticalAlignment = Alignment.CenterVertically,
        ) {
          Text(title, style = mobileHeadline, color = mobileText)
          Surface(
            shape = RoundedCornerShape(999.dp),
            color = if (badgeOwned) mobileAccentSoft else mobileSurfaceStrong,
          ) {
            Text(
              badge,
              modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp),
              style = mobileCaption1,
              color = if (badgeOwned) mobileAccent else mobileTextSecondary,
            )
          }
        }
        Text(subtitle, style = mobileCallout, color = mobileTextSecondary)
      }
    }
  }
}

@Composable
private fun MeRobotWorkspaceEditor(
  bot: MeBotRow,
  demoMe: Boolean,
  isConnected: Boolean,
  gatewayRequest: suspend (method: String, params: String) -> String,
  onNotice: (String) -> Unit,
  onOpenGroup: (String) -> Unit,
  onIdentitySaved: (name: String, positioning: String?, role: String?, persona: String?) -> Unit,
  onRefreshLists: suspend () -> Unit,
) {
  val scope = rememberCoroutineScope()
  val canEdit = bot.access == MeBotAccess.Owned
  var tab by rememberSaveable(bot.agentId) { mutableStateOf(MeBotWorkspaceTab.Identity) }
  var detail by remember(bot.agentId) { mutableStateOf<MeBotWorkspaceDetail?>(null) }
  var authRows by remember(bot.agentId) { mutableStateOf<List<MeBotAuthGrantRow>>(emptyList()) }
  var authSelected by remember(bot.agentId) { mutableStateOf<Set<String>>(emptySet()) }
  var busy by remember { mutableStateOf(false) }
  var loadError by remember { mutableStateOf<String?>(null) }

  var name by rememberSaveable(bot.agentId) { mutableStateOf(bot.name) }
  var positioning by rememberSaveable(bot.agentId) { mutableStateOf(bot.positioning.orEmpty()) }
  var role by rememberSaveable(bot.agentId) { mutableStateOf(bot.roleTitle.orEmpty()) }
  var persona by rememberSaveable(bot.agentId) { mutableStateOf(bot.persona.orEmpty()) }

  LaunchedEffect(bot.agentId, demoMe, isConnected) {
    busy = true
    loadError = null
    try {
      if (demoMe) {
        val d = demoMeBotWorkspace(bot)
        detail = d
        name = d.name
        positioning = d.positioning.orEmpty()
        role = d.role.orEmpty()
        persona = d.personaTraits.orEmpty()
        authRows = DEMO_ME_AUTH_GRANTS
        authSelected = DEMO_ME_AUTH_GRANTS.filter { it.enrolled }.map { it.identityId }.toSet()
        return@LaunchedEffect
      }
      if (!isConnected) {
        detail =
          MeBotWorkspaceDetail(
            agentId = bot.agentId,
            name = bot.name,
            positioning = bot.positioning,
            role = bot.roleTitle,
            personaTraits = bot.persona,
          )
        loadError = "未连接网关：仅展示列表缓存，能力/成长/授权需联网。"
        return@LaunchedEffect
      }
      val raw =
        gatewayRequest(
          "robot.workspace.get",
          buildJsonObject { put("agentId", bot.agentId) }.toString(),
        )
      val parsed = parseRobotWorkspaceGet(raw)
      if (parsed != null) {
        detail = parsed
        name = parsed.name
        positioning = parsed.positioning.orEmpty()
        role = parsed.role.orEmpty()
        persona = parsed.personaTraits.orEmpty()
      } else {
        detail =
          MeBotWorkspaceDetail(
            agentId = bot.agentId,
            name = bot.name,
            positioning = bot.positioning,
            role = bot.roleTitle,
            personaTraits = bot.persona,
          )
      }
      authRows =
        try {
          parseAgentAccessListForGrants(
            gatewayRequest(
              "user-operational-identity.access.list-for-agent",
              buildJsonObject { put("agentId", bot.agentId) }.toString(),
            ),
          )
        } catch (_: Throwable) {
          emptyList()
        }
      if (authRows.isEmpty()) {
        // Fall back to personal list as bindable candidates (Web also merges catalog).
        authRows =
          try {
            parseUserOperationalIdentities(
              gatewayRequest("user-operational-identity.list", "{}"),
            ).map {
              MeBotAuthGrantRow(
                identityId = it.id,
                title = it.title,
                subtitle = it.subtitle,
                kind = if (it.zone == MeIdentityZone.Enterprise) "enterprise" else "personal",
                enrolled = false,
              )
            }
          } catch (_: Throwable) {
            emptyList()
          }
      }
      authSelected = authRows.filter { it.enrolled }.map { it.identityId }.toSet()
    } catch (err: Throwable) {
      loadError = err.message?.take(140) ?: "加载工作区失败"
      detail =
        MeBotWorkspaceDetail(
          agentId = bot.agentId,
          name = bot.name,
          positioning = bot.positioning,
          role = bot.roleTitle,
          personaTraits = bot.persona,
        )
    } finally {
      busy = false
    }
  }

  Column(
    modifier =
      Modifier
        .fillMaxSize()
        .verticalScroll(rememberScrollState())
        .padding(horizontal = mobilePageGutter, vertical = 8.dp),
    verticalArrangement = Arrangement.spacedBy(12.dp),
  ) {
    // Web my-bot-workspace-panel tabs (身份|能力|成长|运营授权|协作)
    Row(
      modifier = Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
      horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
      MeBotWorkspaceTab.entries.forEach { t ->
        val selected = t == tab
        Surface(
          onClick = { tab = t },
          shape = RoundedCornerShape(999.dp),
          color = if (selected) mobileAccentSoft else mobileSurfaceStrong,
        ) {
          Text(
            meBotWorkspaceTabLabel(t),
            modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp),
            style = mobileCaption1.copy(fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Medium),
            color = if (selected) mobileAccent else mobileTextSecondary,
          )
        }
      }
    }
    if (busy) {
      Row(
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically,
      ) {
        CircularProgressIndicator(modifier = Modifier.size(16.dp), strokeWidth = 2.dp, color = mobileAccent)
        Text("加载工作区…", style = mobileCallout, color = mobileTextSecondary)
      }
    }
    loadError?.let { MobileSoftBanner(text = it, tone = MobileBannerTone.Warning) }

    when (tab) {
      MeBotWorkspaceTab.Identity -> {
        if (!canEdit) {
          MobileSoftBanner(text = "协作中的机器人：身份只读。", tone = MobileBannerTone.Neutral)
        }
        OutlinedTextField(
          value = name,
          onValueChange = { name = it },
          label = { Text("名称") },
          enabled = canEdit,
          modifier = Modifier.fillMaxWidth(),
          singleLine = true,
        )
        OutlinedTextField(
          value = positioning,
          onValueChange = { positioning = it },
          label = { Text("定位") },
          enabled = canEdit,
          modifier = Modifier.fillMaxWidth(),
          singleLine = true,
        )
        OutlinedTextField(
          value = role,
          onValueChange = { role = it },
          label = { Text("角色") },
          enabled = canEdit,
          modifier = Modifier.fillMaxWidth(),
          singleLine = true,
        )
        OutlinedTextField(
          value = persona,
          onValueChange = { persona = it },
          label = { Text("人格 / 模型（可选）") },
          enabled = canEdit,
          modifier = Modifier.fillMaxWidth(),
        )
        if (canEdit) {
          MobilePrimaryButton(
            label = "保存身份",
            onClick = {
              scope.launch {
                val n = name.trim().ifEmpty { bot.name }
                val p = positioning.trim().ifEmpty { null }
                val r = role.trim().ifEmpty { null }
                val pe = persona.trim().ifEmpty { null }
                try {
                  if (!isConnected && !demoMe) {
                    onNotice("未连接网关，无法保存身份")
                    return@launch
                  }
                  if (demoMe) {
                    onNotice("DEMO：已本地更新「$n」身份（未写网关）")
                    onIdentitySaved(n, p, r, pe)
                    return@launch
                  }
                  gatewayRequest(
                    "robot.workspace.updateIdentity",
                    buildRobotIdentityUpdateParams(
                      agentId = bot.agentId,
                      name = n,
                      positioning = p,
                      role = r,
                      personaTraits = pe,
                    ),
                  )
                  onNotice("已保存身份")
                  onRefreshLists()
                  onIdentitySaved(n, p, r, pe)
                } catch (err: Throwable) {
                  onNotice("保存失败：${err.message?.take(120) ?: "未知错误"}")
                }
              }
            },
          )
        }
      }
      MeBotWorkspaceTab.Capabilities -> {
        val caps = detail?.capabilities.orEmpty()
        val personas = detail?.personas.orEmpty()
        MobileSectionLabel(text = "已安装")
        if (caps.isEmpty()) {
          MobileSoftBanner(text = "还没有安装能力。", tone = MobileBannerTone.Neutral)
        } else {
          MobileWhiteCard {
            caps.forEachIndexed { idx, cap ->
              Row(
                modifier = Modifier.fillMaxWidth().padding(vertical = 6.dp),
                horizontalArrangement = Arrangement.spacedBy(10.dp),
                verticalAlignment = Alignment.CenterVertically,
              ) {
                Column(modifier = Modifier.weight(1f)) {
                  Text(cap.name, style = mobileHeadline, color = mobileText)
                  Text("★".repeat(cap.stars.coerceIn(0, 5)) + "☆".repeat(5 - cap.stars.coerceIn(0, 5)), style = mobileCaption1, color = mobileTextSecondary)
                }
                Surface(shape = RoundedCornerShape(999.dp), color = mobileSurfaceStrong) {
                  Text(cap.sourceLabel, modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp), style = mobileCaption1, color = mobileTextSecondary)
                }
              }
              if (idx != caps.lastIndex) HorizontalDivider(color = mobileBorder)
            }
          }
        }
        MobileSectionLabel(text = "扮演")
        if (personas.isEmpty()) {
          MobileSoftBanner(text = "暂无扮演身份。", tone = MobileBannerTone.Neutral)
        } else {
          MobileWhiteCard {
            personas.forEach { p ->
              Text(p.label, style = mobileHeadline, color = mobileText)
              p.description?.takeIf { it.isNotBlank() }?.let {
                Text(it, style = mobileCallout, color = mobileTextSecondary)
              }
            }
          }
        }
        MobilePrimaryButton(
          label = "探索能力",
          onClick = { onNotice("探索能力请用 Web 能力中心（onExploreCapabilities）") },
        )
      }
      MeBotWorkspaceTab.Growth -> {
        val g = detail?.growth ?: MeBotGrowthSummary()
        MobileWhiteCard {
          MeInfoLine("等级", "L${g.level}")
          MeInfoLine("配置成熟度", g.activationScore?.toString() ?: "—")
          MeInfoLine("实战表现", g.operationalScore?.toString() ?: "—")
          MeInfoLine("能力就绪", g.capabilityReadyLabel)
          MeInfoLine("能力缺口", if (g.gapCount > 0) "${g.gapCount} 项待补" else "无")
        }
        MobileSoftBanner(
          text = "对齐 Web 成长档案：`robot.workspace.get` → growth（my-bot-workspace-panel）。",
          tone = MobileBannerTone.Neutral,
        )
      }
      MeBotWorkspaceTab.Auth -> {
        val enterprise = authRows.filter { it.kind == "enterprise" }
        val personal = authRows.filter { it.kind != "enterprise" }
        MobileSectionLabel(text = "企业身份")
        if (enterprise.isEmpty()) {
          MobileSoftBanner(text = "企业暂未开放身份。", tone = MobileBannerTone.Neutral)
        } else {
          MobileWhiteCard {
            enterprise.forEach { row ->
              MeAuthGrantToggle(
                row = row,
                checked = authSelected.contains(row.identityId),
                enabled = canEdit && row.enabled,
                onCheckedChange = { on ->
                  authSelected = if (on) authSelected + row.identityId else authSelected - row.identityId
                },
              )
            }
          }
        }
        MobileSectionLabel(text = "个人身份")
        if (personal.isEmpty()) {
          MobileSoftBanner(text = "还没有个人身份。", tone = MobileBannerTone.Neutral)
        } else {
          MobileWhiteCard {
            personal.forEach { row ->
              MeAuthGrantToggle(
                row = row,
                checked = authSelected.contains(row.identityId),
                enabled = canEdit && row.enabled,
                onCheckedChange = { on ->
                  authSelected = if (on) authSelected + row.identityId else authSelected - row.identityId
                },
              )
            }
          }
        }
        if (canEdit) {
          MobilePrimaryButton(
            label = "确认授权",
            onClick = {
              scope.launch {
                try {
                  if (demoMe) {
                    onNotice("DEMO：已确认授权（未写网关）")
                    return@launch
                  }
                  if (!isConnected) {
                    onNotice("未连接网关，无法确认授权")
                    return@launch
                  }
                  val scope = if (bot.access == MeBotAccess.Owned) "owned" else "shared"
                  var added = 0
                  for (id in authSelected) {
                    gatewayRequest(
                      "user-operational-identity.grants.upsert",
                      buildRobotIdentityGrantUpsertParams(
                        identityId = id,
                        agentId = bot.agentId,
                        agentScope = scope,
                      ),
                    )
                    added += 1
                  }
                  onNotice("已确认授权（$added）")
                } catch (err: Throwable) {
                  onNotice("授权失败：${err.message?.take(120) ?: "未知错误"}")
                }
              }
            },
          )
        }
      }
      MeBotWorkspaceTab.Collaboration -> {
        val collabs = detail?.collaborations.orEmpty()
        if (collabs.isEmpty()) {
          MobileSoftBanner(text = "尚未参与协作小组。", tone = MobileBannerTone.Neutral)
        } else {
          collabs.forEach { c ->
            MobileNavRow(
              title = c.title,
              subtitle = "参与中",
              onClick = { onOpenGroup(c.groupId) },
            )
          }
        }
      }
    }
  }
}

@Composable
private fun MeInfoLine(label: String, value: String) {
  Row(
    modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
    horizontalArrangement = Arrangement.SpaceBetween,
  ) {
    Text(label, style = mobileCallout, color = mobileTextSecondary)
    Text(value, style = mobileCallout.copy(fontWeight = FontWeight.SemiBold), color = mobileText)
  }
}

@Composable
private fun MeAuthGrantToggle(
  row: MeBotAuthGrantRow,
  checked: Boolean,
  enabled: Boolean,
  onCheckedChange: (Boolean) -> Unit,
) {
  Row(
    modifier = Modifier.fillMaxWidth().padding(vertical = 6.dp),
    horizontalArrangement = Arrangement.spacedBy(10.dp),
    verticalAlignment = Alignment.CenterVertically,
  ) {
    androidx.compose.material3.Checkbox(
      checked = checked,
      onCheckedChange = onCheckedChange,
      enabled = enabled,
    )
    Column(modifier = Modifier.weight(1f)) {
      Text(row.title, style = mobileHeadline, color = mobileText)
      Text(row.subtitle, style = mobileCallout, color = mobileTextSecondary)
    }
  }
}


@Composable
private fun MeGroupDetailSheet(
  group: MeGroupRow,
  canEdit: Boolean,
  onSave: (title: String, purpose: String?) -> Unit,
  onInviteHuman: (email: String) -> Unit,
) {
  var title by rememberSaveable(group.groupId) { mutableStateOf(group.title) }
  var purpose by rememberSaveable(group.groupId) { mutableStateOf(group.purpose.orEmpty()) }
  var inviteEmail by rememberSaveable(group.groupId) { mutableStateOf("") }
  Column(
    modifier =
      Modifier
        .fillMaxSize()
        .verticalScroll(rememberScrollState())
        .padding(horizontal = mobilePageGutter, vertical = 8.dp),
    verticalArrangement = Arrangement.spacedBy(12.dp),
  ) {
    MobileSectionLabel(text = "基本信息")
    OutlinedTextField(
      value = title,
      onValueChange = { title = it },
      label = { Text("名称") },
      enabled = canEdit,
      modifier = Modifier.fillMaxWidth(),
      singleLine = true,
    )
    MobileWhiteCard {
      MobileInfoBlock(label = "群主", value = group.ownerLabel ?: "—")
      Spacer(Modifier.height(8.dp))
      MobileInfoBlock(label = "主负责人（协调机器人）", value = group.coordinatorBotLabel ?: "—")
      Spacer(Modifier.height(8.dp))
      MobileInfoBlock(label = "我的角色", value = group.myRoleLabel)
    }
    OutlinedTextField(
      value = purpose,
      onValueChange = { purpose = it },
      label = { Text("目标 / 说明") },
      enabled = canEdit,
      modifier = Modifier.fillMaxWidth(),
    )
    MobileSectionLabel(text = "成员名单")
    if (group.members.isEmpty()) {
      MobileSoftBanner(
        text = "暂无成员明细（`collaboration.spaces.list` members.humans/bots）。",
        tone = MobileBannerTone.Neutral,
      )
    } else {
      MobileWhiteCard {
        group.members.forEachIndexed { index, member ->
          if (index > 0) Spacer(Modifier.height(8.dp))
          val kindLabel = if (member.kind == "bot") "机器人" else "成员"
          MobileInfoBlock(label = kindLabel, value = member.name)
        }
      }
    }
    if (canEdit) {
      MobileSectionLabel(text = "邀请成员")
      OutlinedTextField(
        value = inviteEmail,
        onValueChange = { inviteEmail = it },
        label = { Text("成员邮箱 / userId") },
        modifier = Modifier.fillMaxWidth(),
        singleLine = true,
      )
      MobilePrimaryButton(
        label = "发送邀请",
        enabled = inviteEmail.trim().isNotEmpty(),
        onClick = { onInviteHuman(inviteEmail.trim()) },
      )
      MobileSoftBanner(
        text = "复用 Web `collaboration.spaces.members.update` invites.humans。",
        tone = MobileBannerTone.Neutral,
      )
      MobilePrimaryButton(
        label = "保存设置",
        onClick = {
          onSave(title.trim().ifEmpty { group.title }, purpose.trim().ifEmpty { null })
        },
      )
    } else {
      MobileSoftBanner(text = "成员角色：基本信息只读。", tone = MobileBannerTone.Neutral)
    }
  }
}

@Composable
private fun MeCreateBotSheet(onCreate: (name: String, emoji: String?) -> Unit) {
  var name by rememberSaveable { mutableStateOf("") }
  var emoji by rememberSaveable { mutableStateOf("🤖") }
  Column(
    modifier =
      Modifier
        .fillMaxSize()
        .verticalScroll(rememberScrollState())
        .padding(horizontal = mobilePageGutter, vertical = 8.dp),
    verticalArrangement = Arrangement.spacedBy(12.dp),
  ) {
    MobileSoftBanner(
      text = "对齐 Web 新建数字员工：`workspaces.create`（受管 ~/.openbot/workspace）→ `agents.create` → `robots.bind-workspace`。完整设计向导 / 云端空间仍在 Web。",
      tone = MobileBannerTone.Neutral,
    )
    OutlinedTextField(
      value = name,
      onValueChange = { name = it },
      label = { Text("名称") },
      modifier = Modifier.fillMaxWidth(),
      singleLine = true,
    )
    OutlinedTextField(
      value = emoji,
      onValueChange = { emoji = it },
      label = { Text("头像 emoji") },
      modifier = Modifier.fillMaxWidth(),
      singleLine = true,
    )
    MobilePrimaryButton(
      label = "创建",
      enabled = name.trim().isNotEmpty(),
      onClick = { onCreate(name.trim(), emoji.trim().ifEmpty { null }) },
    )
  }
}

@Composable
private fun MeCreateGroupSheet(onCreate: (title: String, avatar: String?, purpose: String?) -> Unit) {
  var title by rememberSaveable { mutableStateOf("") }
  var avatar by rememberSaveable { mutableStateOf("👥") }
  var purpose by rememberSaveable { mutableStateOf("") }
  Column(
    modifier =
      Modifier
        .fillMaxSize()
        .verticalScroll(rememberScrollState())
        .padding(horizontal = mobilePageGutter, vertical = 8.dp),
    verticalArrangement = Arrangement.spacedBy(12.dp),
  ) {
    MobileSoftBanner(
      text = "复用 Web 新建协作空间（`collaboration.spaces.members.update`）。手机为精简表单。",
      tone = MobileBannerTone.Neutral,
    )
    OutlinedTextField(
      value = title,
      onValueChange = { title = it },
      label = { Text("协作小组名称") },
      modifier = Modifier.fillMaxWidth(),
      singleLine = true,
    )
    OutlinedTextField(
      value = avatar,
      onValueChange = { avatar = it },
      label = { Text("头像") },
      modifier = Modifier.fillMaxWidth(),
      singleLine = true,
    )
    OutlinedTextField(
      value = purpose,
      onValueChange = { purpose = it },
      label = { Text("目标（可选）") },
      modifier = Modifier.fillMaxWidth(),
    )
    MobilePrimaryButton(
      label = "创建",
      enabled = title.trim().isNotEmpty(),
      onClick = {
        onCreate(title.trim(), avatar.trim().ifEmpty { null }, purpose.trim().ifEmpty { null })
      },
    )
  }
}

@Composable
private fun MeSubScaffold(
  title: String,
  onBack: () -> Unit,
  modifier: Modifier = Modifier,
  trailing: (@Composable () -> Unit)? = null,
  /** Keep top-level module context that tertiary pages sit under「我的」. */
  parentContext: String = "我的",
  content: @Composable () -> Unit,
) {
  Column(modifier = modifier.fillMaxSize()) {
    // HTML SoT `.me-sub .nav`: circular back | centered kicker+title | trailing (+)
    Row(
      modifier =
        Modifier
          .fillMaxWidth()
          .padding(horizontal = 12.dp, vertical = 6.dp),
      verticalAlignment = Alignment.CenterVertically,
    ) {
      Surface(
        onClick = onBack,
        shape = CircleShape,
        color = Color.White,
        border = BorderStroke(1.dp, mobileBorder),
        modifier = Modifier.size(32.dp),
      ) {
        Box(contentAlignment = Alignment.Center, modifier = Modifier.fillMaxSize()) {
          Icon(
            Icons.AutoMirrored.Filled.ArrowBack,
            contentDescription = "返回",
            tint = mobileText,
            modifier = Modifier.size(18.dp),
          )
        }
      }
      Column(
        modifier = Modifier.weight(1f).padding(horizontal = 8.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
      ) {
        if (parentContext.isNotBlank()) {
          Text(
            parentContext,
            style = mobileCaption1.copy(fontWeight = FontWeight.SemiBold, fontSize = 11.sp),
            color = mobileTextTertiary,
          )
        }
        Text(
          title,
          style = mobileHeadline.copy(fontWeight = FontWeight.Bold),
          color = mobileText,
          maxLines = 1,
        )
      }
      Box(modifier = Modifier.size(32.dp), contentAlignment = Alignment.Center) {
        trailing?.invoke()
      }
    }
    Box(modifier = Modifier.fillMaxSize()) {
      content()
    }
  }
}
