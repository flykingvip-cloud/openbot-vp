package ai.openbot.app.employeeauth

import java.io.IOException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

//
// Native employee login networking (task 1.4-android).
//
// Kotlin counterpart to apps/macos/.../EmployeeAuthClient.swift. POSTs to the
// EXISTING platform-auth control-ui routes (base `/__openbot/platform-auth`)
// using the ACCOUNT'S isolated OkHttp client (its per-account CookieJar) so the
// resulting HttpOnly employee session cookie lands in that account's client
// session jar — which is exactly what `/native/bootstrap/mint` requires.
//
// Wave 1 scope (D-LOGIN): password login + forgot/reset + invited register +
// gateway selection. NO employee MFA (employee entry never hits the platform
// MFA gate). SSO stays the existing trusted-proxy entry (not re-implemented).
//
// Endpoint paths mirror src/gateway/control-ui-contract.ts +
// platform-auth/control-ui-dispatcher.ts.
//

/** Endpoint paths under the control-ui platform-auth base. */
object EmployeeAuthRoutes {
  const val BASE_PATH = "/__openbot/platform-auth"
  const val LOGIN = "$BASE_PATH/login"
  const val LOGOUT = "$BASE_PATH/logout"
  const val SESSION = "$BASE_PATH/session"
  const val PASSWORD_FORGOT = "$BASE_PATH/password/forgot"
  const val PASSWORD_RESET = "$BASE_PATH/password/reset"
  const val PASSWORD_CHANGE = "$BASE_PATH/password/change"
  const val EMPLOYEE_REGISTER = "$BASE_PATH/employee/register"
}

/** Result of an auth call. Expected auth failures are values, not exceptions. */
sealed interface EmployeeAuthResult {
  data class Success(val message: String?, val pendingResetCode: String? = null) : EmployeeAuthResult

  data class Failure(val status: Int, val code: String?, val message: String) : EmployeeAuthResult
}

/**
 * Pure parser for platform-auth JSON responses (unit-testable on the JVM).
 * Success = HTTP 2xx and `ok` is not explicitly false; otherwise a typed
 * failure carrying the server `code` + `error` message.
 */
object EmployeeAuthResponseParser {
  private val json = Json { ignoreUnknownKeys = true }

  fun parse(status: Int, body: String?): EmployeeAuthResult {
    val obj = body?.trim()?.takeIf { it.isNotEmpty() }?.let { raw ->
      runCatching { json.parseToJsonElement(raw) as? JsonObject }.getOrNull()
    }
    val httpOk = status in 200..299
    val ok = obj.boolField("ok") ?: httpOk
    if (httpOk && ok) {
      return EmployeeAuthResult.Success(
        message = obj.stringField("message"),
        pendingResetCode = pendingResetCode(obj),
      )
    }
    val code = obj.stringField("code")
    val message = obj.stringField("error") ?: defaultMessage(status)
    return EmployeeAuthResult.Failure(status = status, code = code, message = message)
  }

  /** Dev/test gateways echo the reset code at `platformAuth.pendingPasswordReset.code`. */
  private fun pendingResetCode(obj: JsonObject?): String? =
    obj.objectField("platformAuth").objectField("pendingPasswordReset").stringField("code")

  private fun JsonObject?.objectField(key: String): JsonObject? = this?.get(key) as? JsonObject

  private fun JsonObject?.stringField(key: String): String? =
    this?.get(key)
      ?.let { runCatching { it.jsonPrimitive.contentOrNull }.getOrNull() }
      ?.trim()
      ?.takeIf { it.isNotEmpty() }

  private fun JsonObject?.boolField(key: String): Boolean? =
    this?.get(key)?.let { runCatching { it.jsonPrimitive.booleanOrNull }.getOrNull() }

  private fun defaultMessage(status: Int): String =
    when (status) {
      0 -> "Network error."
      401 -> "Email or password is incorrect."
      423 -> "Too many failed attempts. Try again later."
      in 500..599 -> "The gateway is unavailable. Try again later."
      else -> "Request failed ($status)."
    }
}

/**
 * Password reset body for `/__openbot/platform-auth/password/reset`.
 * The route requires email + code + password (Mac `PlatformAuthClient.resetPassword`).
 */
internal fun employeeAuthResetBody(email: String, code: String, password: String): Map<String, String> =
  linkedMapOf(
    "email" to email.trim(),
    "code" to code.trim(),
    "password" to password,
  )

/** Body for `/__openbot/platform-auth/password/change` (Web platform-auth.ts). */
internal fun employeeAuthChangePasswordBody(
  currentPassword: String,
  newPassword: String,
): Map<String, String> =
  linkedMapOf(
    "currentPassword" to currentPassword,
    "newPassword" to newPassword,
  )

/** Stateless networking helper bound to one gateway + one account's OkHttp client. */
class EmployeeAuthClient(
  private val gatewayBaseURL: String,
  private val client: OkHttpClient,
) {
  private val json = Json { ignoreUnknownKeys = true }

  suspend fun login(email: String, password: String): EmployeeAuthResult =
    post(EmployeeAuthRoutes.LOGIN, mapOf("email" to email, "password" to password))

  suspend fun logout(): EmployeeAuthResult = post(EmployeeAuthRoutes.LOGOUT, emptyMap())

  suspend fun forgotPassword(email: String): EmployeeAuthResult =
    post(EmployeeAuthRoutes.PASSWORD_FORGOT, mapOf("email" to email))

  suspend fun resetPassword(email: String, code: String, newPassword: String): EmployeeAuthResult =
    post(EmployeeAuthRoutes.PASSWORD_RESET, employeeAuthResetBody(email, code, newPassword))

  /**
   * Change password for the signed-in employee session (Web
   * `changePlatformAuthPassword` → `/password/change`).
   */
  suspend fun changePassword(currentPassword: String, newPassword: String): EmployeeAuthResult =
    post(
      EmployeeAuthRoutes.PASSWORD_CHANGE,
      employeeAuthChangePasswordBody(currentPassword, newPassword),
    )

  /** Accept an invitation and set a password (invited employee onboarding). */
  suspend fun register(
    email: String,
    code: String,
    password: String,
    displayName: String?,
  ): EmployeeAuthResult {
    val body = linkedMapOf("email" to email, "code" to code, "password" to password)
    if (!displayName.isNullOrBlank()) body["displayName"] = displayName.trim()
    return post(EmployeeAuthRoutes.EMPLOYEE_REGISTER, body)
  }

  /** True when the account's session cookie is still valid (GET /session). */
  suspend fun hasValidSession(): Boolean =
    withContext(Dispatchers.IO) {
      val url = gatewayBaseURL.trimEnd('/') + EmployeeAuthRoutes.SESSION
      val request = Request.Builder().url(url).get().build()
      try {
        client.newCall(request).execute().use { response ->
          if (response.code != 200) return@use false
          val obj = response.body.string().let { raw ->
            runCatching { json.parseToJsonElement(raw) as? JsonObject }.getOrNull()
          }
          when {
            obj == null -> false
            obj.containsKey("ok") ->
              obj["ok"]?.let { runCatching { it.jsonPrimitive.booleanOrNull }.getOrNull() } ?: false
            else -> obj.containsKey("user") || obj.containsKey("session")
          }
        }
      } catch (_: IOException) {
        false
      }
    }

  private suspend fun post(path: String, body: Map<String, String>): EmployeeAuthResult =
    withContext(Dispatchers.IO) {
      val url = gatewayBaseURL.trimEnd('/') + path
      val payload = buildJsonObject { for ((key, value) in body) put(key, value) }.toString()
      val request =
        Request.Builder()
          .url(url)
          .post(payload.toRequestBody("application/json".toMediaType()))
          .build()
      try {
        client.newCall(request).execute().use { response ->
          EmployeeAuthResponseParser.parse(response.code, response.body.string())
        }
      } catch (error: IOException) {
        EmployeeAuthResult.Failure(status = 0, code = "NETWORK", message = error.message ?: "Network error.")
      }
    }
}
