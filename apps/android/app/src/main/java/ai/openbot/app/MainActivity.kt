package ai.openbot.app

import android.content.Intent
import android.os.Bundle
import android.os.Process
import android.os.SystemClock
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.viewModels
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.core.view.WindowCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import ai.openbot.app.employeeauth.EmployeeShell
import ai.openbot.app.employeeauth.EmployeeTelemetry
import ai.openbot.app.employeeshell.EmployeeNotificationRouter
import ai.openbot.app.employeeshell.EmployeeShellHost
import ai.openbot.app.employeeshell.EmployeeShellRouteRequest
import ai.openbot.app.ui.OpenBotTheme
import ai.openbot.app.ui.RootScreen
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
  private val viewModel: MainViewModel by viewModels()
  private lateinit var permissionRequester: PermissionRequester
  private var showCompanion by mutableStateOf(false)
  private var companionCoversShell by mutableStateOf(false)
  private var employeeLoggedIn by mutableStateOf(false)

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    WindowCompat.setDecorFitsSystemWindows(window, false)
    permissionRequester = PermissionRequester(this)
    viewModel.camera.attachLifecycleOwner(this)
    viewModel.camera.attachPermissionRequester(permissionRequester)
    viewModel.sms.attachPermissionRequester(permissionRequester)
    employeeLoggedIn = EmployeeShell.controller(this).isLoggedIn()
    restoreChrome(savedInstanceState)

    lifecycleScope.launch {
      repeatOnLifecycle(Lifecycle.State.STARTED) {
        viewModel.preventSleep.collect { enabled ->
          if (enabled) {
            window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
          } else {
            window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
          }
        }
      }
    }

    setContent {
      OpenBotTheme {
        Surface(modifier = Modifier.fillMaxSize()) {
          val controller = EmployeeShell.controller(this@MainActivity)
          val navigation by controller.navigation.collectAsState()
          LaunchedEffect(navigation, showCompanion, employeeLoggedIn) {
            if (!showCompanion || !employeeLoggedIn) return@LaunchedEffect
            when (val request = navigation) {
              null -> Unit
              is EmployeeShellRouteRequest.Chat -> {
                if (!request.sessionKey.isNullOrBlank()) viewModel.loadChat(request.sessionKey)
                controller.clearNavigation()
              }
              is EmployeeShellRouteRequest.Embed -> {
                // Deep link / notification targets the logged-in workbench embed.
                companionCoversShell = false
                showCompanion = false
              }
            }
          }

          if (showCompanion) {
            if (companionCoversShell) {
              BackHandler {
                showCompanion = false
                companionCoversShell = false
              }
            }
            RootScreen(
              viewModel = viewModel,
              employeeSessionActive = employeeLoggedIn,
              onOpenEmployeeWorkbench =
                if (ColdStartRoot.workbenchFromMe(employeeLoggedIn) == ColdStartRoot.Destination.EmployeeShell) {
                  {
                    companionCoversShell = false
                    showCompanion = false
                  }
                } else {
                  null
                },
            )
          } else {
            EmployeeShellHost(
              controller = controller,
              modifier = Modifier.fillMaxSize(),
              onLoggedIn = { showCompanionHome() },
              onSignedOut = {
                employeeLoggedIn = false
                companionCoversShell = false
                showCompanion = false
              },
              onLeaveWorkbench =
                if (employeeLoggedIn) {
                  { showCompanionHome() }
                } else {
                  null
                },
              onOpenNativeChat = { sessionKey, _ ->
                if (!sessionKey.isNullOrBlank()) viewModel.loadChat(sessionKey)
                showCompanionOverShell()
              },
              onOpenDeviceSettings = { showCompanionOverShell() },
            )
          }
        }
      }
    }

    // Cold start still starts the node foreground service, but only after the first
    // frame. Logged-in chrome is the four-tab companion; the service is the shared
    // node runtime (connection, vault, voice) and is not gated on employee login.
    window.decorView.post {
      NodeForegroundService.start(this)
      // M-COLD: process start -> first frame drawn (R-Matrix, task 1.11).
      EmployeeTelemetry.current.onColdStart(SystemClock.elapsedRealtime() - Process.getStartElapsedRealtime())
    }

    // Route an employee deep link from a cold launch (scheme link / notification tap).
    handleEmployeeDeepLink(intent)
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    if (intentRequestsCompanion(intent)) {
      val plan =
        ColdStartRoot.resolve(
          loggedIn = EmployeeShell.controller(this).isLoggedIn(),
          explicitCompanion = true,
        )
      employeeLoggedIn = EmployeeShell.controller(this).isLoggedIn()
      showCompanion = plan.destination == ColdStartRoot.Destination.Companion
      companionCoversShell = plan.companionCoversShell
    }
    handleEmployeeDeepLink(intent)
  }

  override fun onSaveInstanceState(outState: Bundle) {
    super.onSaveInstanceState(outState)
    outState.putBoolean(ColdStartRoot.EXTRA_SHOW_COMPANION, showCompanion)
    outState.putBoolean(ColdStartRoot.STATE_COMPANION_COVERS_SHELL, companionCoversShell)
  }

  private fun restoreChrome(savedInstanceState: Bundle?) {
    val plan =
      ColdStartRoot.restore(
        loggedIn = employeeLoggedIn,
        hasSavedState = savedInstanceState != null,
        savedCompanion = savedInstanceState?.getBoolean(ColdStartRoot.EXTRA_SHOW_COMPANION) == true,
        savedCoversShell = savedInstanceState?.getBoolean(ColdStartRoot.STATE_COMPANION_COVERS_SHELL) == true,
        explicitCompanion = intentRequestsCompanion(intent),
      )
    showCompanion = plan.destination == ColdStartRoot.Destination.Companion
    companionCoversShell = plan.companionCoversShell
  }

  /** Post-login home: four tabs, back does not uncover the shell. */
  private fun showCompanionHome() {
    val plan = ColdStartRoot.afterLogin()
    employeeLoggedIn = true
    showCompanion = plan.destination == ColdStartRoot.Destination.Companion
    companionCoversShell = plan.companionCoversShell
  }

  /** Native chat / device settings pushed over the logged-in workbench. */
  private fun showCompanionOverShell() {
    showCompanion = true
    companionCoversShell = true
  }

  /**
     * Forward an employee deep link (VIEW scheme data or a notification extra) to
     * the shared controller, which auth-gates + account-scopes it (task 1.7).
     */
  private fun handleEmployeeDeepLink(intent: Intent?) {
    if (intent == null) return
    val link =
      EmployeeNotificationRouter.deepLinkFromExtra(intent.getStringExtra(EmployeeNotificationRouter.DEEP_LINK_EXTRA))
        ?: intent.dataString
        ?: return
    EmployeeShell.controller(this).handleDeepLink(link)
  }

  private fun intentRequestsCompanion(intent: Intent?): Boolean =
    intent?.getBooleanExtra(ColdStartRoot.EXTRA_SHOW_COMPANION, false) == true

  override fun onStart() {
    super.onStart()
    viewModel.setForeground(true)
  }

  override fun onStop() {
    viewModel.setForeground(false)
    super.onStop()
  }
}
