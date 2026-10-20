package ai.openbot.app.deeplink

import java.net.URI
import java.net.URLDecoder

//
// Tri-Platform Employee Shell — Android deep link grammar (task 1.2-android).
//
// Kotlin counterpart to the Swift `DeepLinkParser` (apps/shared/OpenBotKit/.../
// DeepLinks.swift). Both parsers implement the SAME frozen grammar so the shared
// test-vector table produces byte-for-byte identical results on each platform.
//
// Contract: .kiro/specs/client-apps-pc-mobile/contracts/deeplink-grammar.md (v1).
//
// This module ONLY parses + validates untrusted deep-link input into a typed
// route. Route -> navigation (embed path / bridge intent) + session-domain
// authentication happen in the client router (task 1.7-android). Deep links are
// external, UNTRUSTED input and are validated defensively here.
//

/** Accepted deep link URL schemes (both are equivalent, case-insensitive). */
object DeepLinkSchemeSupport {
  /** Primary scheme. `openclaw://` remains accepted for compatibility. */
  const val CANONICAL_SCHEME = "openbot"

  /** Compatibility alias (equivalent to the primary scheme). */
  const val LEGACY_SCHEME = "openclaw"

  val acceptedSchemes: Set<String> = setOf(CANONICAL_SCHEME, LEGACY_SCHEME)
}

/**
 * Employee embed surfaces. Mirrors `EMPLOYEE_EMBED_SURFACES` in
 * ui/src/ui/employee-shell/embed-routes.ts.
 */
enum class EmployeeSurface(val rawValue: String) {
  Overview("overview"),
  Workspace("workspace"),
  Knowledge("knowledge"),
  Growth("growth"),
  Me("me"),
  ;

  companion object {
    /** Surface used when a target is missing or unknown (grammar §rule 2). */
    val DEFAULT = Overview

    fun fromRawValue(raw: String?): EmployeeSurface? {
      val normalized = raw?.trim()?.lowercase() ?: return null
      return entries.firstOrNull { it.rawValue == normalized }
    }
  }
}

/** Route prefix for all employee embed surfaces (mirrors the web contract). */
object EmployeeEmbedRoutes {
  const val PREFIX = "/embed/employee"

  /** Build the canonical embed path for a surface, e.g. `/embed/employee/overview`. */
  fun path(surface: EmployeeSurface): String = "$PREFIX/${surface.rawValue}"

  /** Default embed path (`/embed/employee/overview`). */
  fun defaultPath(): String = path(EmployeeSurface.DEFAULT)
}

/**
 * A validated, typed deep-link route. The navigation layer NEVER receives the
 * raw string; it only ever sees these types (grammar §rule 5).
 */
sealed interface EmployeeDeepLinkRoute {
  /** `…://employee/<surface>` -> embed navigation. */
  data class Employee(val surface: EmployeeSurface) : EmployeeDeepLinkRoute

  /** `…://chat` -> native chat bridge intent (both params optional). */
  data class Chat(val sessionKey: String?, val agentId: String?) : EmployeeDeepLinkRoute

  /** `…://space/<spaceId>` -> openSpace bridge intent (spaceId required). */
  data class Space(val spaceId: String) : EmployeeDeepLinkRoute

  /** `…://knowledge/<objectId>` -> openKnowledgeObject bridge intent (objectId required). */
  data class Knowledge(val objectId: String, val kind: String?) : EmployeeDeepLinkRoute
}

object EmployeeDeepLinkParser {
  // Length caps guard against super-long injection payloads (grammar §rule 6).
  private const val MAX_INPUT_LENGTH = 2048
  private const val MAX_PARAM_LENGTH = 512

  /**
   * Parse an UNTRUSTED deep-link URL string into a typed route, or `null` when
   * the input is not a well-formed / permitted employee deep link. Never throws.
   *
   * Path-segment form is authoritative for `surface` / `spaceId` / `objectId`
   * (grammar recommends path segments; both platforms agree). Query params carry
   * chat `sessionKey`/`agentId` and knowledge `kind`.
   */
  fun parse(raw: String?): EmployeeDeepLinkRoute? {
    val input = raw?.trim().orEmpty()
    if (input.isEmpty() || input.length > MAX_INPUT_LENGTH) return null
    // Control chars anywhere (NUL/newline/etc) are never valid (grammar §rule 4).
    if (containsControlChars(input)) return null

    val uri = try {
      URI(input)
    } catch (_: Throwable) {
      return null
    }

    // Unknown scheme -> reject (grammar §rule 1).
    val scheme = uri.scheme?.lowercase() ?: return null
    if (scheme !in DeepLinkSchemeSupport.acceptedSchemes) return null

    // Host may be exposed as authority for reg-names; strip any userinfo/port.
    val host = (uri.host ?: uri.authority)
      ?.substringAfterLast('@')
      ?.substringBefore(':')
      ?.trim()
      ?.lowercase()
      ?.takeIf { it.isNotEmpty() }
      ?: return null

    val rawPath = uri.rawPath.orEmpty()
    // Reject path traversal / dot-segments before touching segments (grammar §rule 4).
    if (rawPath.contains("..")) return null

    val firstSegment = firstPathSegment(rawPath)
    val query = parseQuery(uri.rawQuery)

    return when (host) {
      "employee" -> {
        // Path form is canonical + highest priority; when the path segment is
        // absent, fall back to the `?surface=` query form (Swift parity, see the
        // shared-vector query-form row). Unknown / missing surface -> overview;
        // the raw value is NEVER passed through (grammar §rule 2).
        val surface = EmployeeSurface.fromRawValue(firstSegment ?: query["surface"]) ?: EmployeeSurface.DEFAULT
        EmployeeDeepLinkRoute.Employee(surface)
      }

      "chat" ->
        EmployeeDeepLinkRoute.Chat(
          sessionKey = sanitizeOptional(query["sessionKey"]),
          agentId = sanitizeOptional(query["agentId"]),
        )

      "space" -> {
        val spaceId = sanitizeRequired(firstSegment) ?: return null
        EmployeeDeepLinkRoute.Space(spaceId)
      }

      "knowledge" -> {
        val objectId = sanitizeRequired(firstSegment) ?: return null
        EmployeeDeepLinkRoute.Knowledge(objectId, sanitizeOptional(query["kind"]))
      }

      // Unknown / future host -> reject (do NOT crash) so old clients ignore
      // unknown deep links gracefully (grammar §rule 1 / §rule 7).
      else -> null
    }
  }

  private fun firstPathSegment(rawPath: String): String? {
    val trimmed = rawPath.trim('/')
    if (trimmed.isEmpty()) return null
    val segment = trimmed.substringBefore('/')
    if (segment.isEmpty()) return null
    return percentDecode(segment)
  }

  private fun parseQuery(rawQuery: String?): Map<String, String> {
    if (rawQuery.isNullOrEmpty()) return emptyMap()
    val result = LinkedHashMap<String, String>()
    for (pair in rawQuery.split("&")) {
      if (pair.isEmpty()) continue
      val eq = pair.indexOf('=')
      val rawKey = if (eq >= 0) pair.substring(0, eq) else pair
      val rawValue = if (eq >= 0) pair.substring(eq + 1) else ""
      val key = percentDecode(rawKey)
      if (key.isEmpty() || result.containsKey(key)) continue
      result[key] = percentDecode(rawValue)
    }
    return result
  }

  /** Percent-decode while preserving literal `+` (aligns with Swift URLComponents). */
  private fun percentDecode(value: String): String {
    if (!value.contains('%')) return value
    return try {
      URLDecoder.decode(value.replace("+", "%2B"), "UTF-8")
    } catch (_: Throwable) {
      value
    }
  }

  /** Sanitize a REQUIRED value; blank/invalid/injection -> null (caller rejects). */
  private fun sanitizeRequired(value: String?): String? {
    val v = value?.trim() ?: return null
    if (v.isEmpty() || v.length > MAX_PARAM_LENGTH) return null
    if (containsControlChars(v)) return null
    val lower = v.lowercase()
    if (lower.startsWith("javascript:") || lower.startsWith("data:")) return null
    if (v.contains("..")) return null
    return v
  }

  /** Sanitize an OPTIONAL value; absent/invalid -> null (param is simply dropped). */
  private fun sanitizeOptional(value: String?): String? = sanitizeRequired(value)

  private fun containsControlChars(value: String): Boolean = value.any { it.isISOControl() }
}
