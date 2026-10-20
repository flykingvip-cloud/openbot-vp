package ai.openbot.app.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ExpandLess
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
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
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import ai.openbot.app.MainViewModel
import ai.openbot.app.gateway.CloudAuthClient
import ai.openbot.app.gateway.OpenBotCloudDefaults
import kotlinx.coroutines.launch

@Composable
fun ConnectTabScreen(
  viewModel: MainViewModel,
  /** When true (e.g. under 我的), hide the page hero to avoid duplicate titles. */
  embedded: Boolean = false,
) {
  val statusText by viewModel.statusText.collectAsState()
  val isConnected by viewModel.isConnected.collectAsState()
  val remoteAddress by viewModel.remoteAddress.collectAsState()
  val manualHost by viewModel.manualHost.collectAsState()
  val manualPort by viewModel.manualPort.collectAsState()
  val manualTls by viewModel.manualTls.collectAsState()
  val gatewayToken by viewModel.gatewayToken.collectAsState()
  val pendingTrust by viewModel.pendingGatewayTrust.collectAsState()
  val scope = rememberCoroutineScope()

  var advancedOpen by rememberSaveable { mutableStateOf(false) }
  var cloudEmail by rememberSaveable { mutableStateOf("") }
  var cloudPassword by rememberSaveable { mutableStateOf("") }
  var cloudBusy by rememberSaveable { mutableStateOf(false) }
  var manualHostInput by rememberSaveable {
    mutableStateOf(manualHost.ifBlank { OpenBotCloudDefaults.WS_HOST })
  }
  var manualPortInput by rememberSaveable {
    mutableStateOf(
      if (manualPort in 1..65535) manualPort.toString() else OpenBotCloudDefaults.WS_PORT.toString(),
    )
  }
  var manualTlsInput by rememberSaveable { mutableStateOf(if (manualHost.isBlank()) true else manualTls) }
  var passwordInput by rememberSaveable { mutableStateOf("") }
  var validationText by rememberSaveable { mutableStateOf<String?>(null) }

  if (pendingTrust != null) {
    val prompt = pendingTrust!!
    AlertDialog(
      onDismissRequest = { viewModel.declineGatewayTrustPrompt() },
      title = { Text("信任此网关？") },
      text = {
        Text(
          "首次 TLS 连接。\n\n请核对以下 SHA-256 指纹后再信任：\n${prompt.fingerprintSha256}",
          style = mobileCallout,
        )
      },
      confirmButton = {
        TextButton(onClick = { viewModel.acceptGatewayTrustPrompt() }) {
          Text("信任并继续")
        }
      },
      dismissButton = {
        TextButton(onClick = { viewModel.declineGatewayTrustPrompt() }) {
          Text("取消")
        }
      },
    )
  }

  val cloudEndpoint =
    remember {
      "https://${OpenBotCloudDefaults.WS_HOST}:${OpenBotCloudDefaults.WS_PORT}"
    }
  val manualResolvedEndpoint =
    remember(manualHostInput, manualPortInput, manualTlsInput) {
      composeGatewayManualUrl(manualHostInput, manualPortInput, manualTlsInput)?.let {
        parseGatewayEndpoint(it)?.displayUrl
      }
    }
  val activeEndpoint =
    remember(isConnected, remoteAddress, cloudEndpoint) {
      when {
        isConnected && !remoteAddress.isNullOrBlank() -> remoteAddress!!
        else -> cloudEndpoint
      }
    }

  fun applyCloudEndpoint() {
    viewModel.setManualEnabled(true)
    viewModel.setManualHost(OpenBotCloudDefaults.WS_HOST)
    viewModel.setManualPort(OpenBotCloudDefaults.WS_PORT)
    viewModel.setManualTls(true)
    viewModel.setGatewayToken("")
    viewModel.setGatewayPassword("")
    manualHostInput = OpenBotCloudDefaults.WS_HOST
    manualPortInput = OpenBotCloudDefaults.WS_PORT.toString()
    manualTlsInput = true
    passwordInput = ""
  }

  val primaryLabel =
    when {
      isConnected -> "断开连接"
      cloudBusy -> "登录中…"
      statusText.contains("operator offline", ignoreCase = true) -> "重新连接"
      else -> "登录并连接"
    }

  Column(
    modifier = Modifier.verticalScroll(rememberScrollState()).padding(horizontal = 20.dp, vertical = 16.dp),
    verticalArrangement = Arrangement.spacedBy(12.dp),
  ) {
    if (!embedded) {
      MobilePageHeader(
        title = "连接网关",
        subtitle = "使用云端账号密码登录，无需配对电脑。",
      )
    }
    // Embedded under 我的: no intro hero/banner (HTML SoT deleted 「连接状态」 card).

    MobileWhiteCard {
      MobileInfoBlock(label = "当前地址", value = activeEndpoint, monospace = true)
      MobileQuietDivider()
      MobileInfoBlock(label = "连接状态", value = statusText.ifBlank { if (isConnected) "已连接" else "未连接" })
    }

    if (!isConnected) {
      OutlinedTextField(
        value = cloudEmail,
        onValueChange = {
          cloudEmail = it
          validationText = null
        },
        label = { Text("邮箱", style = mobileCaption1, color = mobileTextSecondary) },
        modifier = Modifier.fillMaxWidth(),
        singleLine = true,
        enabled = !cloudBusy,
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
        textStyle = mobileBody.copy(color = mobileText),
        shape = RoundedCornerShape(14.dp),
        colors = outlinedColors(),
      )
      OutlinedTextField(
        value = cloudPassword,
        onValueChange = {
          cloudPassword = it
          validationText = null
        },
        label = { Text("密码", style = mobileCaption1, color = mobileTextSecondary) },
        modifier = Modifier.fillMaxWidth(),
        singleLine = true,
        enabled = !cloudBusy,
        visualTransformation = PasswordVisualTransformation(),
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
        textStyle = mobileBody.copy(color = mobileText),
        shape = RoundedCornerShape(14.dp),
        colors = outlinedColors(),
      )
    }

    Button(
      onClick = {
        if (isConnected) {
          viewModel.disconnect()
          CloudAuthClient.clearSession()
          validationText = null
          return@Button
        }
        if (statusText.contains("operator offline", ignoreCase = true)) {
          validationText = null
          viewModel.refreshGatewayConnection()
          return@Button
        }
        if (cloudBusy) return@Button
        cloudBusy = true
        validationText = null
        scope.launch {
          val result = CloudAuthClient.login(email = cloudEmail, password = cloudPassword)
          cloudBusy = false
          if (!result.ok) {
            validationText = result.errorMessage ?: "登录失败，请检查邮箱和密码。"
            return@launch
          }
          applyCloudEndpoint()
          viewModel.connectManual()
        }
      },
      enabled = !cloudBusy,
      modifier = Modifier.fillMaxWidth().height(52.dp),
      shape = RoundedCornerShape(14.dp),
      colors =
        ButtonDefaults.buttonColors(
          containerColor = if (isConnected) mobileDanger else mobileAccent,
          contentColor = Color.White,
          disabledContainerColor = mobileAccent.copy(alpha = 0.45f),
          disabledContentColor = Color.White,
        ),
    ) {
      Text(primaryLabel, style = mobileHeadline.copy(fontWeight = FontWeight.Bold))
    }

    Surface(
      modifier = Modifier.fillMaxWidth(),
      shape = RoundedCornerShape(14.dp),
      color = mobileSurface,
      border = BorderStroke(1.dp, mobileBorder),
      onClick = { advancedOpen = !advancedOpen },
    ) {
      Row(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween,
      ) {
        Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
          Text("高级选项", style = mobileHeadline, color = mobileText)
          Text("开发者手动地址、TLS、令牌", style = mobileCaption1, color = mobileTextSecondary)
        }
        Icon(
          imageVector = if (advancedOpen) Icons.Default.ExpandLess else Icons.Default.ExpandMore,
          contentDescription = if (advancedOpen) "收起高级选项" else "展开高级选项",
          tint = mobileTextSecondary,
        )
      }
    }

    AnimatedVisibility(visible = advancedOpen) {
      Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(14.dp),
        color = Color.White,
        border = BorderStroke(1.dp, mobileBorder),
      ) {
        Column(
          modifier = Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 14.dp),
          verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
          Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            QuickFillChip(
              label = "云端",
              onClick = {
                manualHostInput = OpenBotCloudDefaults.WS_HOST
                manualPortInput = OpenBotCloudDefaults.WS_PORT.toString()
                manualTlsInput = true
                validationText = null
              },
            )
            QuickFillChip(
              label = "模拟器",
              onClick = {
                manualHostInput = "10.0.2.2"
                manualPortInput = "18789"
                manualTlsInput = false
                validationText = null
              },
            )
          }

          Text("主机", style = mobileCaption1.copy(fontWeight = FontWeight.SemiBold), color = mobileTextSecondary)
          OutlinedTextField(
            value = manualHostInput,
            onValueChange = {
              manualHostInput = it
              validationText = null
            },
            placeholder = { Text(OpenBotCloudDefaults.WS_HOST, style = mobileBody, color = mobileTextTertiary) },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
            textStyle = mobileBody.copy(color = mobileText),
            shape = RoundedCornerShape(14.dp),
            colors = outlinedColors(),
          )

          Text("端口", style = mobileCaption1.copy(fontWeight = FontWeight.SemiBold), color = mobileTextSecondary)
          OutlinedTextField(
            value = manualPortInput,
            onValueChange = {
              manualPortInput = it
              validationText = null
            },
            placeholder = { Text("443", style = mobileBody, color = mobileTextTertiary) },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
            textStyle = mobileBody.copy(fontFamily = FontFamily.Monospace, color = mobileText),
            shape = RoundedCornerShape(14.dp),
            colors = outlinedColors(),
          )

          Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween,
          ) {
            Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
              Text("使用 TLS", style = mobileHeadline, color = mobileText)
              Text("启用安全 WebSocket（wss）", style = mobileCallout, color = mobileTextSecondary)
            }
            Switch(
              checked = manualTlsInput,
              onCheckedChange = {
                manualTlsInput = it
                validationText = null
              },
              colors =
                SwitchDefaults.colors(
                  checkedTrackColor = mobileAccent,
                  uncheckedTrackColor = mobileBorderStrong,
                  checkedThumbColor = Color.White,
                  uncheckedThumbColor = Color.White,
                ),
            )
          }

          Text("令牌（可选）", style = mobileCaption1.copy(fontWeight = FontWeight.SemiBold), color = mobileTextSecondary)
          OutlinedTextField(
            value = gatewayToken,
            onValueChange = { viewModel.setGatewayToken(it) },
            placeholder = { Text("令牌", style = mobileBody, color = mobileTextTertiary) },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Ascii),
            textStyle = mobileBody.copy(color = mobileText),
            shape = RoundedCornerShape(14.dp),
            colors = outlinedColors(),
          )

          Text("密码（可选）", style = mobileCaption1.copy(fontWeight = FontWeight.SemiBold), color = mobileTextSecondary)
          OutlinedTextField(
            value = passwordInput,
            onValueChange = { passwordInput = it },
            placeholder = { Text("密码", style = mobileBody, color = mobileTextTertiary) },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Ascii),
            textStyle = mobileBody.copy(color = mobileText),
            shape = RoundedCornerShape(14.dp),
            colors = outlinedColors(),
          )

          if (!manualResolvedEndpoint.isNullOrBlank()) {
            EndpointPreview(endpoint = manualResolvedEndpoint)
          }

          Button(
            onClick = {
              val config =
                resolveGatewayConnectConfig(
                  manualHost = manualHostInput,
                  manualPort = manualPortInput,
                  manualTls = manualTlsInput,
                  fallbackToken = gatewayToken,
                  fallbackPassword = passwordInput,
                )
              if (config == null) {
                validationText = "请填写有效的主机与端口。"
                return@Button
              }
              validationText = null
              viewModel.setManualEnabled(true)
              viewModel.setManualHost(config.host)
              viewModel.setManualPort(config.port)
              viewModel.setManualTls(config.tls)
              if (config.token.isNotBlank()) {
                viewModel.setGatewayToken(config.token)
              }
              viewModel.setGatewayPassword(config.password)
              viewModel.connectManual()
            },
            modifier = Modifier.fillMaxWidth().height(48.dp),
            shape = RoundedCornerShape(12.dp),
            colors =
              ButtonDefaults.buttonColors(
                containerColor = mobileSurface,
                contentColor = mobileText,
              ),
            border = BorderStroke(1.dp, mobileBorderStrong),
          ) {
            Text("使用高级地址连接", style = mobileCallout.copy(fontWeight = FontWeight.SemiBold))
          }

          HorizontalDivider(color = mobileBorder)

          TextButton(onClick = { viewModel.setOnboardingCompleted(false) }) {
            Text("重新运行引导", style = mobileCallout.copy(fontWeight = FontWeight.SemiBold), color = mobileAccent)
          }
        }
      }
    }

    if (!validationText.isNullOrBlank()) {
      Text(validationText!!, style = mobileCaption1, color = mobileWarning)
    }
  }
}

@Composable
private fun QuickFillChip(label: String, onClick: () -> Unit) {
  Button(
    onClick = onClick,
    shape = RoundedCornerShape(999.dp),
    contentPadding = PaddingValues(horizontal = 12.dp, vertical = 6.dp),
    colors =
      ButtonDefaults.buttonColors(
        containerColor = mobileAccentSoft,
        contentColor = mobileAccent,
      ),
    elevation = null,
  ) {
    Text(label, style = mobileCaption1.copy(fontWeight = FontWeight.SemiBold))
  }
}

@Composable
private fun EndpointPreview(endpoint: String) {
  Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
    HorizontalDivider(color = mobileBorder)
    Text("解析后的地址", style = mobileCaption1.copy(fontWeight = FontWeight.SemiBold), color = mobileTextSecondary)
    Text(endpoint, style = mobileCallout.copy(fontFamily = FontFamily.Monospace), color = mobileText)
    HorizontalDivider(color = mobileBorder)
  }
}

@Composable
private fun outlinedColors() =
  OutlinedTextFieldDefaults.colors(
    focusedContainerColor = mobileSurface,
    unfocusedContainerColor = mobileSurface,
    focusedBorderColor = mobileAccent,
    unfocusedBorderColor = mobileBorder,
    focusedTextColor = mobileText,
    unfocusedTextColor = mobileText,
    cursorColor = mobileAccent,
  )
