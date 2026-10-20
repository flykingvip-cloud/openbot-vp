package ai.openbot.app.employeeshell

import ai.openbot.app.R
import ai.openbot.app.employeeauth.EmployeeLoginScreen
import ai.openbot.app.employeeauth.EmployeeShellController
import ai.openbot.app.employeeauth.EmployeeTelemetry
import android.os.SystemClock
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

//
// Employee Shell host (task 1.5-android).
//
// Composes the native login vs the embedded Employee Shell, wires the bridge
// intents (openSpace/openKnowledgeObject -> embed navigation; openChat/
// openAssistant -> native chat; openDeviceSettings -> Me > Device), and shows an
// offline placeholder with retry when bootstrap/embed load fails.
//
// Kotlin counterpart to the macOS EmployeeShellController + window; auto silent
// re-bootstrap on embed 401 is refined in 1.6-android.
//

@Composable
fun EmployeeShellHost(
  controller: EmployeeShellController,
  modifier: Modifier = Modifier,
  onOpenNativeChat: (sessionKey: String?, agentId: String?) -> Unit = { _, _ -> },
  // Me > Device entry (D-COMPANION-IA): when set, openDeviceSettings opens the
  // native companion (pairing/Screen/Voice/camera/background) instead of the web
  // "me" surface. Null keeps macOS parity (navigate the embed to "me").
  onOpenDeviceSettings: (() -> Unit)? = null,
  // Stage 2.2: a successful login leaves this host for the four-tab companion.
  onLoggedIn: () -> Unit = {},
  // Session lost (logout / mint 401). Parent returns to the login card.
  onSignedOut: () -> Unit = {},
  // Logged-in workbench overlay. System back returns to the four-tab companion
  // after in-WebView history is exhausted. Null on the logged-out login card.
  onLeaveWorkbench: (() -> Unit)? = null,
) {
  var loggedIn by remember { mutableStateOf(controller.isLoggedIn()) }

  if (!loggedIn) {
    EmployeeLoginScreen(
      controller = controller,
      onLoggedIn = {
        loggedIn = true
        // Continue a deep link that arrived while signed out (deferred deep link).
        controller.consumePendingAfterLogin()
        onLoggedIn()
      },
      modifier = modifier,
    )
    return
  }

  val config = remember(loggedIn) { controller.shellConfig() }
  if (config == null) {
    // Signed out underneath us; fall back to login.
    LaunchedEffect(Unit) { onSignedOut() }
    loggedIn = false
    return
  }

  val scope = rememberCoroutineScope()
  val handle = remember { EmployeeShellWebViewHandle() }
  BackHandler(enabled = onLeaveWorkbench != null) {
    if (!handle.goBack()) onLeaveWorkbench?.invoke()
  }
  var reloadKey by remember { mutableIntStateOf(0) }
  var silentAttempts by remember { mutableIntStateOf(0) }
  var offline by remember { mutableStateOf(false) }

  // M-TTI: measure shell mount -> first successful embed load (reported once).
  val shellStartMs = remember { SystemClock.elapsedRealtime() }
  var ttiReported by remember { mutableStateOf(false) }

  // Consume auth-gated deep-link navigation (external links + notification taps).
  val navigation by controller.navigation.collectAsState()
  LaunchedEffect(navigation) {
    when (val request = navigation) {
      null -> {}
      is EmployeeShellRouteRequest.Embed -> {
        offline = false
        handle.navigate(request.path)
        controller.clearNavigation()
      }
      is EmployeeShellRouteRequest.Chat -> {
        onOpenNativeChat(request.sessionKey, request.agentId)
        controller.clearNavigation()
      }
    }
  }

  Box(modifier = modifier.fillMaxSize()) {
    EmployeeShellScreen(
      config = config,
      handle = handle,
      reloadKey = reloadKey,
      onIntent = { intent ->
        when (val action = controller.routeIntent(intent)) {
          is EmployeeShellRouteAction.EmbedNavigation -> {
            offline = false
            handle.navigate(action.path)
          }
          is EmployeeShellRouteAction.Native ->
            when (val native = action.intent) {
              is EmployeeShellIntent.OpenChat -> onOpenNativeChat(native.sessionKey, native.agentId)
              is EmployeeShellIntent.OpenAssistant -> onOpenNativeChat(null, native.agentId)
              // Companion device settings live under "Me > Device" (D-COMPANION-IA):
              // open the native companion when wired, else the web "me" surface.
              is EmployeeShellIntent.OpenDeviceSettings ->
                if (onOpenDeviceSettings != null) onOpenDeviceSettings() else handle.navigate(EmployeeEmbedRouting.embedPath("me"))
              is EmployeeShellIntent.Ready, is EmployeeShellIntent.OpenSpace, is EmployeeShellIntent.OpenKnowledgeObject -> {}
            }
        }
      },
      onBootstrapError = { error ->
        when (val recovery = EmployeeShellReconnectPolicy.onBootstrapError(error, silentAttempts)) {
          // Mint 401 => the login session is gone: send the user back to login.
          EmployeeShellRecovery.Relogin -> {
            loggedIn = false
            onSignedOut()
          }
          // Embed-frame 401 => silently re-mint + reload after a backoff delay.
          is EmployeeShellRecovery.SilentReBootstrap -> {
            silentAttempts = recovery.attempt
            scope.launch {
              delay(recovery.delayMs)
              reloadKey += 1
            }
          }
          // Retry budget exhausted => surface the placeholder.
          EmployeeShellRecovery.ShowOffline -> offline = true
        }
      },
      onLoadError = { offline = true },
      onLoaded = {
        // A successful main-frame load clears the recovery state.
        silentAttempts = 0
        offline = false
        if (!ttiReported) {
          ttiReported = true
          EmployeeTelemetry.current.onShellInteractive(SystemClock.elapsedRealtime() - shellStartMs)
        }
      },
      modifier = Modifier.fillMaxSize(),
    )

    if (offline) {
      EmployeeShellOfflinePlaceholder(
        onRetry = {
          offline = false
          silentAttempts = 0
          reloadKey += 1
        },
        modifier = Modifier.fillMaxSize(),
      )
    }
  }
}

@Composable
private fun EmployeeShellOfflinePlaceholder(onRetry: () -> Unit, modifier: Modifier = Modifier) {
  Surface(modifier = modifier, color = MaterialTheme.colorScheme.surface) {
    Column(
      modifier = Modifier.fillMaxSize().padding(24.dp).semantics { liveRegion = LiveRegionMode.Polite },
      verticalArrangement = Arrangement.spacedBy(12.dp, Alignment.CenterVertically),
      horizontalAlignment = Alignment.CenterHorizontally,
    ) {
      Text(
        stringResource(R.string.employee_shell_offline_title),
        style = MaterialTheme.typography.titleMedium,
        modifier = Modifier.semantics { heading() },
      )
      Text(
        stringResource(R.string.employee_shell_offline_body),
        style = MaterialTheme.typography.bodyMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
      )
      Button(onClick = onRetry, modifier = Modifier.heightIn(min = 48.dp)) {
        Text(stringResource(R.string.employee_shell_retry))
      }
    }
  }
}
