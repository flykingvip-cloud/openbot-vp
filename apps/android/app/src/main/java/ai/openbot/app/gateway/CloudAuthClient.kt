package ai.openbot.app.gateway

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.HttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit

/** Shared cloud defaults for phone onboarding (no hardcoded gateway token). */
object OpenBotCloudDefaults {
  /** Public auth/entry host — same surface as Mac/Web www login. */
  const val BASE_URL = "https://www.openbot.love"
  const val WS_HOST = "www.openbot.love"
  const val WS_PORT = 443
  const val PLATFORM_AUTH_LOGIN_PATH = "/__openbot/platform-auth/login"
  const val PLATFORM_AUTH_REGISTER_PATH = "/__openbot/platform-auth/employee/register"
  const val PLATFORM_AUTH_FORGOT_PATH = "/__openbot/platform-auth/password/forgot"
  const val PLATFORM_AUTH_RESET_PATH = "/__openbot/platform-auth/password/reset"
}

/**
 * Process-wide CookieJar so platform-auth login cookies ride on later Gateway WebSocket upgrades.
 */
object OpenBotHttp {
  val cookieJar: CookieJar = HostCookieJar()

  fun newClient(): OkHttpClient =
    OkHttpClient.Builder()
      .cookieJar(cookieJar)
      .connectTimeout(20, TimeUnit.SECONDS)
      .readTimeout(30, TimeUnit.SECONDS)
      .writeTimeout(30, TimeUnit.SECONDS)
      .build()
}

private class HostCookieJar : CookieJar {
  private val store = ConcurrentHashMap<String, MutableList<Cookie>>()

  @Synchronized
  override fun saveFromResponse(url: HttpUrl, cookies: List<Cookie>) {
    if (cookies.isEmpty()) return
    val bucket = store.getOrPut(url.host) { mutableListOf() }
    for (cookie in cookies) {
      bucket.removeAll { it.name == cookie.name }
      bucket.add(cookie)
    }
  }

  @Synchronized
  override fun loadForRequest(url: HttpUrl): List<Cookie> {
    val now = System.currentTimeMillis()
    val bucket = store[url.host] ?: return emptyList()
    bucket.removeAll { it.expiresAt < now }
    return bucket.toList()
  }

  @Synchronized
  fun clear() {
    store.clear()
  }
}

data class CloudAuthResult(
  val ok: Boolean,
  val errorMessage: String? = null,
  val noticeMessage: String? = null,
  val pendingResetCode: String? = null,
)

/** Backward-compatible alias used by existing call sites / tests. */
typealias CloudLoginResult = CloudAuthResult

object CloudAuthClient {
  suspend fun login(
    email: String,
    password: String,
    mfaCode: String? = null,
    baseUrl: String = OpenBotCloudDefaults.BASE_URL,
  ): CloudAuthResult =
    withContext(Dispatchers.IO) {
      val trimmedEmail = email.trim()
      val trimmedPassword = password
      if (trimmedEmail.isEmpty() || trimmedPassword.isEmpty()) {
        return@withContext CloudAuthResult(ok = false, errorMessage = "请输入邮箱和密码。")
      }
      val body =
        JSONObject()
          .put("email", trimmedEmail)
          .put("password", trimmedPassword)
          .apply {
            val code = mfaCode?.trim().orEmpty()
            if (code.isNotEmpty()) put("mfaCode", code)
          }
      postJson(
        path = OpenBotCloudDefaults.PLATFORM_AUTH_LOGIN_PATH,
        body = body,
        baseUrl = baseUrl,
        emptyOk = true,
      )
    }

  suspend fun register(
    email: String,
    password: String,
    displayName: String,
    inviteCode: String,
    baseUrl: String = OpenBotCloudDefaults.BASE_URL,
  ): CloudAuthResult =
    withContext(Dispatchers.IO) {
      val trimmedEmail = email.trim()
      val trimmedPassword = password
      val trimmedName = displayName.trim()
      val trimmedCode = inviteCode.trim()
      if (trimmedEmail.isEmpty() || trimmedPassword.isEmpty()) {
        return@withContext CloudAuthResult(ok = false, errorMessage = "请输入邮箱和密码。")
      }
      if (trimmedName.isEmpty()) {
        return@withContext CloudAuthResult(ok = false, errorMessage = "请输入显示名称。")
      }
      if (trimmedCode.isEmpty()) {
        return@withContext CloudAuthResult(ok = false, errorMessage = "请输入企业邀请码。")
      }
      val body =
        JSONObject()
          .put("email", trimmedEmail)
          .put("password", trimmedPassword)
          .put("displayName", trimmedName)
          .put("code", trimmedCode)
      postJson(
        path = OpenBotCloudDefaults.PLATFORM_AUTH_REGISTER_PATH,
        body = body,
        baseUrl = baseUrl,
        emptyOk = true,
      )
    }

  suspend fun forgotPassword(
    email: String,
    baseUrl: String = OpenBotCloudDefaults.BASE_URL,
  ): CloudAuthResult =
    withContext(Dispatchers.IO) {
      val trimmedEmail = email.trim()
      if (trimmedEmail.isEmpty()) {
        return@withContext CloudAuthResult(ok = false, errorMessage = "请输入邮箱。")
      }
      val result =
        postJson(
          path = OpenBotCloudDefaults.PLATFORM_AUTH_FORGOT_PATH,
          body = JSONObject().put("email", trimmedEmail),
          baseUrl = baseUrl,
          emptyOk = true,
        )
      if (!result.ok) return@withContext result
      val notice =
        if (!result.pendingResetCode.isNullOrBlank()) {
          "已生成重置码（开发环境）：${result.pendingResetCode}"
        } else {
          "重置邮件已发送，请查收验证码后完成重置。"
        }
      result.copy(noticeMessage = notice)
    }

  suspend fun resetPassword(
    email: String,
    password: String,
    code: String,
    baseUrl: String = OpenBotCloudDefaults.BASE_URL,
  ): CloudAuthResult =
    withContext(Dispatchers.IO) {
      val trimmedEmail = email.trim()
      val trimmedPassword = password
      val trimmedCode = code.trim()
      if (trimmedEmail.isEmpty() || trimmedPassword.isEmpty() || trimmedCode.isEmpty()) {
        return@withContext CloudAuthResult(ok = false, errorMessage = "请填写邮箱、验证码和新密码。")
      }
      val body =
        JSONObject()
          .put("email", trimmedEmail)
          .put("password", trimmedPassword)
          .put("code", trimmedCode)
      postJson(
        path = OpenBotCloudDefaults.PLATFORM_AUTH_RESET_PATH,
        body = body,
        baseUrl = baseUrl,
        emptyOk = true,
      )
    }

  fun clearSession() {
    (OpenBotHttp.cookieJar as? HostCookieJar)?.clear()
  }

  private fun postJson(
    path: String,
    body: JSONObject,
    baseUrl: String,
    emptyOk: Boolean,
  ): CloudAuthResult {
    val url = baseUrl.trimEnd('/') + path
    val requestBody =
      body.toString().toRequestBody("application/json; charset=utf-8".toMediaType())
    val request =
      Request.Builder()
        .url(url)
        .post(requestBody)
        .header("Accept", "application/json")
        .build()
    return try {
      OpenBotHttp.newClient().newCall(request).execute().use { response ->
        val raw = response.body.string()
        val json = runCatching { JSONObject(raw) }.getOrNull()
        if (!response.isSuccessful) {
          val message =
            json?.optString("error")?.trim()?.takeIf { it.isNotEmpty() }
              ?: "请求失败（HTTP ${response.code}）。"
          return CloudAuthResult(ok = false, errorMessage = message)
        }
        if (!emptyOk && raw.isBlank()) {
          return CloudAuthResult(ok = false, errorMessage = "云端返回为空。")
        }
        val pending =
          json?.optString("pendingResetCode")?.trim()?.takeIf { it.isNotEmpty() }
            ?: json?.optString("code")?.trim()?.takeIf { it.isNotEmpty() }
        CloudAuthResult(ok = true, pendingResetCode = pending)
      }
    } catch (err: Throwable) {
      CloudAuthResult(
        ok = false,
        errorMessage = "无法连接云端：${err.message ?: err::class.java.simpleName}",
      )
    }
  }
}
