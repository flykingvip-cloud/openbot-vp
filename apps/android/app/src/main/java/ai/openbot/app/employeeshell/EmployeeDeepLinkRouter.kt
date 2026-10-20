package ai.openbot.app.employeeshell

import ai.openbot.app.deeplink.EmployeeDeepLinkRoute

//
// Deep-link route -> shell route request (task 1.7-android). Pure + testable.
//
// Maps a parsed employee deep link (deeplink/EmployeeDeepLinks.kt) to an
// auth-gated shell action: employee/space/knowledge navigate the embedded shell;
// chat opens native chat. Mirrors the macOS EmployeeShellController.handle(route)
// switch. The actual auth gate + deferred-until-login live in the controller.
//

/** A resolved, auth-gated destination the host acts on. */
sealed interface EmployeeShellRouteRequest {
  /** Navigate the embedded shell to a site-internal embed path. */
  data class Embed(val path: String) : EmployeeShellRouteRequest

  /** Legacy chat request. New chat deep links resolve to Embed. */
  data class Chat(val sessionKey: String?, val agentId: String?) : EmployeeShellRouteRequest
}

object EmployeeDeepLinkRouter {
  fun toRouteRequest(route: EmployeeDeepLinkRoute): EmployeeShellRouteRequest =
    when (route) {
      is EmployeeDeepLinkRoute.Employee ->
        EmployeeShellRouteRequest.Embed(EmployeeEmbedRouting.embedPath(route.surface.rawValue))
      is EmployeeDeepLinkRoute.Chat ->
        EmployeeShellRouteRequest.Embed(EmployeeEmbedRouting.embedPathForChat(route.sessionKey, route.agentId))
      is EmployeeDeepLinkRoute.Space ->
        EmployeeShellRouteRequest.Embed(EmployeeEmbedRouting.embedPathForSpace(route.spaceId))
      is EmployeeDeepLinkRoute.Knowledge ->
        EmployeeShellRouteRequest.Embed(EmployeeEmbedRouting.embedPathForKnowledge(route.objectId, route.kind))
    }
}
