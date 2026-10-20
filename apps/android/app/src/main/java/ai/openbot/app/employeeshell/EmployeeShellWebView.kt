package ai.openbot.app.employeeshell

//
// Tri-Platform Employee Shell — Android container (Phase 2 skeleton).
//
// ⚠️ UNVERIFIED SKELETON — written without a local Android toolchain. Build and
// wire up on-device. Dependencies are kept to the Android SDK + OkHttp (already
// used by GatewaySession) + org.json, so it can compile before you connect it to
// navigation, the gateway URL, and the employee session.
//
// Mirrors the iOS/macOS EmployeeShellWebView: a WebView SEPARATE from CanvasScreen
// that registers the `openbotEmployeeShell` JS bridge and bootstraps an HttpOnly
// employee session via /native/bootstrap.
//
// Cookie note: Android's CookieManager is process-global (unlike WKWebView's
// per-config store), so the employee session cookie is isolated from canvas by
// COOKIE DOMAIN (different hosts), not per-instance. True per-instance isolation
// would require WebView.setDataDirectorySuffix(...) set once before any WebView.
//
// Follow-up (native employee login): `tokenProvider` must call the mint endpoint
// with an OkHttpClient whose CookieJar holds the employee platform-auth session
// cookie. `EmployeeShellBootstrap.mintToken` is the building block.
//

import android.annotation.SuppressLint
import android.os.Handler
import android.os.Looper
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import java.net.URLEncoder
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject

// MARK: - Bridge protocol (mirrors ui/src/ui/employee-shell/native-bridge.ts)

sealed interface EmployeeShellIntent {
  data class Ready(val surface: String?) : EmployeeShellIntent
  data class OpenChat(val sessionKey: String?, val agentId: String?) : EmployeeShellIntent
  data class OpenAssistant(val agentId: String?) : EmployeeShellIntent
  data class OpenSpace(val spaceId: String) : EmployeeShellIntent
  data class OpenKnowledgeObject(val objectId: String, val kind: String?) : EmployeeShellIntent
  data class OpenDeviceSettings(val section: String?) : EmployeeShellIntent
}

object EmployeeShellBridge {
  /** Must match EMPLOYEE_SHELL_HOST_HANDLER in native-host.ts. */
  const val HANDLER_NAME = "openbotEmployeeShell"

  /** Must match EMPLOYEE_SHELL_BRIDGE_VERSION in native-bridge.ts. */
  const val PROTOCOL_VERSION = 1

  /** Parse an UNTRUSTED bridge message (JSON string) into a typed intent, or null. */
  fun parse(raw: String): EmployeeShellIntent? {
    val message = try {
      JSONObject(raw)
    } catch (_: Throwable) {
      return null
    }
    if (message.optInt("version", -1) != PROTOCOL_VERSION) return null
    val type = message.optString("type").takeIf { it.isNotEmpty() } ?: return null
    val payload = message.optJSONObject("payload") ?: JSONObject()

    fun nonEmpty(key: String): String? = payload.optString(key).trim().takeIf { it.isNotEmpty() }

    return when (type) {
      "ready" -> EmployeeShellIntent.Ready(nonEmpty("surface"))
      "openChat" -> EmployeeShellIntent.OpenChat(nonEmpty("sessionKey"), nonEmpty("agentId"))
      "openAssistant" -> EmployeeShellIntent.OpenAssistant(nonEmpty("agentId"))
      "openSpace" -> nonEmpty("spaceId")?.let { EmployeeShellIntent.OpenSpace(it) }
      "openKnowledgeObject" ->
        nonEmpty("objectId")?.let { EmployeeShellIntent.OpenKnowledgeObject(it, nonEmpty("kind")) }
      "openDeviceSettings" -> EmployeeShellIntent.OpenDeviceSettings(nonEmpty("section"))
      else -> null
    }
  }
}

// MARK: - Bootstrap (mint + URL building)

/** Thrown when `/native/bootstrap/mint` returns 401: the login session is gone. */
class EmployeeShellUnauthorizedException :
  IllegalStateException("employee shell mint unauthorized (401)")

object EmployeeShellBootstrap {
  const val MINT_PATH = "/native/bootstrap/mint"
  const val BOOTSTRAP_PATH = "/native/bootstrap"
  const val DEFAULT_TARGET = "/embed/employee/overview"

  /**
   * Phone shells opt into phone-only trims (design doc §15) via this marker; the web
   * embed reads `shell=mobile` and adds the `employee-embed--mobile` root class. macOS
   * keeps full web parity by NOT setting this.
   */
  const val MOBILE_SHELL_MARKER = "shell=mobile"

  /** Append the phone marker to a target so the web embed enables phone-only trims. */
  fun withMobileShellMarker(target: String): String =
    when {
      target.contains(MOBILE_SHELL_MARKER) -> target
      target.contains("?") -> "$target&$MOBILE_SHELL_MARKER"
      else -> "$target?$MOBILE_SHELL_MARKER"
    }

  private fun enc(value: String): String = URLEncoder.encode(value, "UTF-8")

  /**
   * POST `/native/bootstrap/mint?target=…` using `client` (whose CookieJar MUST
   * carry the employee platform-auth session cookie). Returns the one-time token.
   */
  suspend fun mintToken(baseUrl: String, client: OkHttpClient, target: String): String =
    withContext(Dispatchers.IO) {
      val url = baseUrl.trimEnd('/') + MINT_PATH + "?target=" + enc(target)
      val request = Request.Builder().url(url).post("".toRequestBody(null)).build()
      client.newCall(request).execute().use { response ->
        if (response.code == 401) throw EmployeeShellUnauthorizedException()
        if (!response.isSuccessful) throw IllegalStateException("mint failed: ${response.code}")
        val body = response.body.string()
        val token = JSONObject(body).optString("token").trim()
        if (token.isEmpty()) throw IllegalStateException("mint response missing token")
        token
      }
    }

  /** Build `/native/bootstrap?token=…&target=…`. */
  fun bootstrapUrl(baseUrl: String, token: String, target: String): String =
    baseUrl.trimEnd('/') + BOOTSTRAP_PATH + "?token=" + enc(token) + "&target=" + enc(target)
}

// MARK: - JS bridge interface

private class EmployeeShellBridgeInterface(private val onIntent: (EmployeeShellIntent) -> Unit) {
  private val mainHandler = Handler(Looper.getMainLooper())

  @JavascriptInterface
  fun postMessage(payload: String?) {
    val raw = payload?.trim().orEmpty()
    if (raw.isEmpty()) return
    val intent = EmployeeShellBridge.parse(raw) ?: return
    // @JavascriptInterface runs on a background JS thread; hop to main for UI intents.
    mainHandler.post { onIntent(intent) }
  }
}

// MARK: - Config + composable container

data class EmployeeShellConfig(
  val gatewayBaseUrl: String,
  val initialTarget: String = EmployeeShellBootstrap.DEFAULT_TARGET,
  /** Returns a one-time bootstrap token for `target`; typically wraps EmployeeShellBootstrap.mintToken. */
  val tokenProvider: suspend (target: String) -> String,
)

/**
 * Imperative handle to drive the shell WebView from the host: embed navigation
 * (session already set by bootstrap) without a full re-bootstrap.
 */
class EmployeeShellWebViewHandle {
  internal var webView: WebView? = null
  internal var gatewayBaseUrl: String = ""

  /** Navigate the shell to a site-internal embed path (adds the phone marker). */
  fun navigate(embedPath: String) {
    val webView = this.webView ?: return
    val marked = EmployeeShellBootstrap.withMobileShellMarker(embedPath)
    webView.loadUrl(gatewayBaseUrl.trimEnd('/') + marked)
  }

  /** Walk embed history. False when the WebView is not yet up or has nowhere to go. */
  fun goBack(): Boolean {
    val webView = this.webView ?: return false
    if (!webView.canGoBack()) return false
    webView.goBack()
    return true
  }
}

@SuppressLint("SetJavaScriptEnabled")
@Composable
fun EmployeeShellScreen(
  config: EmployeeShellConfig,
  modifier: Modifier = Modifier,
  handle: EmployeeShellWebViewHandle = remember { EmployeeShellWebViewHandle() },
  reloadKey: Int = 0,
  onIntent: (EmployeeShellIntent) -> Unit = {},
  onBootstrapError: (Throwable) -> Unit = {},
  onLoadError: (Throwable) -> Unit = {},
  onLoaded: () -> Unit = {},
) {
  val context = LocalContext.current
  val scope = rememberCoroutineScope()
  val fileChooserSession = remember { EmployeeShellFileChooserSession() }
  val fileChooserLauncher =
    rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
      fileChooserSession.finish(result.resultCode, result.data)
    }

  // Mint a fresh token and load the bootstrap URL (302 sets the HttpOnly session).
  suspend fun bootstrap(webView: WebView) {
    try {
      // Android is a PHONE shell: mark the target so the web enables phone-only trims.
      val target = EmployeeShellBootstrap.withMobileShellMarker(config.initialTarget)
      val token = config.tokenProvider(target)
      webView.loadUrl(EmployeeShellBootstrap.bootstrapUrl(config.gatewayBaseUrl, token, target))
    } catch (t: Throwable) {
      onBootstrapError(t)
    }
  }

  DisposableEffect(Unit) {
    onDispose {
      fileChooserSession.cancel()
      val webView = handle.webView ?: return@onDispose
      webView.removeJavascriptInterface(EmployeeShellBridge.HANDLER_NAME)
      webView.stopLoading()
      webView.destroy()
      handle.webView = null
    }
  }

  // Re-bootstrap when the host bumps reloadKey (401 recovery / manual retry).
  LaunchedEffect(reloadKey) {
    if (reloadKey > 0) {
      handle.webView?.let { bootstrap(it) }
    }
  }

  AndroidView(
    modifier = modifier,
    factory = {
      WebView(context).apply {
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE

        val cookieManager = CookieManager.getInstance()
        cookieManager.setAcceptCookie(true)
        cookieManager.setAcceptThirdPartyCookies(this, true)

        webViewClient =
          object : WebViewClient() {
            override fun onReceivedHttpError(
              view: WebView,
              request: WebResourceRequest,
              errorResponse: WebResourceResponse,
            ) {
              // A 401 on the main frame means the session lapsed -> app should re-bootstrap.
              if (request.isForMainFrame && errorResponse.statusCode == 401) {
                onBootstrapError(IllegalStateException("employee shell session unauthorized (401)"))
              }
            }

            override fun onReceivedError(
              view: WebView,
              request: WebResourceRequest,
              error: WebResourceError,
            ) {
              // Main-frame transport failure (offline / DNS / TLS) -> host shows a placeholder.
              if (request.isForMainFrame) {
                onLoadError(IllegalStateException("employee shell load failed: ${error.errorCode}"))
              }
            }

            override fun onPageFinished(view: WebView, url: String) {
              // Main-frame load succeeded -> host resets its silent-retry budget.
              onLoaded()
            }
          }

        // Paperclip `<input type="file">` has no default chooser. SAF needs no
        // storage permission; see EmployeeShellFileChooser.
        webChromeClient =
          EmployeeShellChromeClient(fileChooserSession) { intent ->
            fileChooserLauncher.launch(intent)
          }

        addJavascriptInterface(
          EmployeeShellBridgeInterface(onIntent),
          EmployeeShellBridge.HANDLER_NAME,
        )
        handle.webView = this
        handle.gatewayBaseUrl = config.gatewayBaseUrl

        scope.launch { bootstrap(this@apply) }
      }
    },
  )
}
