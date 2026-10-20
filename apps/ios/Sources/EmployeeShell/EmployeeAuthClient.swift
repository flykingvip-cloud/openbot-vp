//
//  EmployeeAuthClient.swift
//  Native employee login networking (task 1.4-ios).
//
//  POSTs to the existing platform-auth control-ui routes (base
//  `/__openbot/platform-auth`) using the ACCOUNT'S isolated client `URLSession`
//  so the resulting HttpOnly employee session cookie lands in that account's
//  Client Session Jar (never `URLSession.shared`). That cookie is what
//  `/native/bootstrap/mint` requires (see native-bootstrap-http.ts).
//
//  Wave 1 scope (D-LOGIN): password login + forgot/reset + invited register +
//  gateway selection. NO employee MFA. SSO stays the existing trusted-proxy
//  entry (not re-implemented here). Mirrors apps/macos EmployeeAuthClient.
//

import Foundation

/// Endpoint paths under the control-ui platform-auth base. Kept in sync with
/// `src/gateway/control-ui-contract.ts` + `platform-auth/control-ui-dispatcher.ts`.
enum EmployeeAuthRoutes {
    static let basePath = "/__openbot/platform-auth"
    static let login = "\(basePath)/login"
    static let logout = "\(basePath)/logout"
    static let session = "\(basePath)/session"
    static let passwordForgot = "\(basePath)/password/forgot"
    static let passwordReset = "\(basePath)/password/reset"
    static let employeeRegister = "\(basePath)/employee/register"
    static let employeePushRegister = "\(basePath)/employee/push/register"
    static let employeePushUnregister = "\(basePath)/employee/push/unregister"
}

enum EmployeeAuthError: Error, Equatable {
    case badURL
    case network(String)
    case server(status: Int, message: String?)
    case invalidCredentials
    case decoding
}

struct EmployeeAuthResult: Equatable {
    let ok: Bool
    let message: String?
}

/// Stateless networking helper. All calls take the account's `URLSession` so the
/// session cookie is stored per-account.
struct EmployeeAuthClient {
    var gatewayBaseURL: URL
    var session: URLSession

    /// Password login. On success the employee session cookie is now in the
    /// session's (per-account) cookie jar; the caller should persist it.
    func login(email: String, password: String) async throws -> EmployeeAuthResult {
        try await self.post(
            path: EmployeeAuthRoutes.login,
            body: ["email": email, "password": password])
    }

    func logout() async throws -> EmployeeAuthResult {
        try await self.post(path: EmployeeAuthRoutes.logout, body: [:])
    }

    func forgotPassword(email: String) async throws -> EmployeeAuthResult {
        try await self.post(path: EmployeeAuthRoutes.passwordForgot, body: ["email": email])
    }

    func resetPassword(code: String, newPassword: String) async throws -> EmployeeAuthResult {
        try await self.post(
            path: EmployeeAuthRoutes.passwordReset,
            body: ["code": code, "password": newPassword])
    }

    /// Accept an invitation and set a password (invited employee onboarding).
    func register(email: String, code: String, password: String, displayName: String?) async throws
        -> EmployeeAuthResult
    {
        var body: [String: String] = ["email": email, "code": code, "password": password]
        if let displayName, !displayName.isEmpty {
            body["displayName"] = displayName
        }
        return try await self.post(path: EmployeeAuthRoutes.employeeRegister, body: body)
    }

    /// True when the account's session cookie is still valid (GET /session).
    func hasValidSession() async -> Bool {
        guard let url = self.url(for: EmployeeAuthRoutes.session) else { return false }
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        guard
            let (data, response) = try? await self.session.data(for: request),
            let http = response as? HTTPURLResponse,
            http.statusCode == 200,
            let object = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
        else {
            return false
        }
        // The session route returns an authenticated context when signed in.
        if let ok = object["ok"] as? Bool { return ok }
        return object["user"] != nil || object["session"] != nil
    }


    /// Wave 2: register employee APNs token (platform-auth session cookie required).
    func registerEmployeePush(body: [String: Any]) async throws {
        _ = try await self.postJSON(path: EmployeeAuthRoutes.employeePushRegister, body: body)
    }

    /// Wave 2: unregister employee push for this device/account.
    func unregisterEmployeePush(body: [String: Any]) async throws {
        _ = try await self.postJSON(path: EmployeeAuthRoutes.employeePushUnregister, body: body)
    }

    // MARK: - Internals

    private func url(for path: String) -> URL? {
        EmployeeShellBootstrap.makeURL(baseURL: self.gatewayBaseURL, path: path, queryItems: [])
    }

    private func post(path: String, body: [String: String]) async throws -> EmployeeAuthResult {
        guard let url = self.url(for: path) else {
            throw EmployeeAuthError.badURL
        }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await self.session.data(for: request)
        } catch {
            throw EmployeeAuthError.network(error.localizedDescription)
        }
        guard let http = response as? HTTPURLResponse else {
            throw EmployeeAuthError.server(status: -1, message: nil)
        }
        let object = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
        let message = object?["error"] as? String
        switch http.statusCode {
        case 200 ..< 300:
            let ok = (object?["ok"] as? Bool) ?? true
            return EmployeeAuthResult(ok: ok, message: message)
        case 401, 403:
            throw EmployeeAuthError.invalidCredentials
        default:
            throw EmployeeAuthError.server(status: http.statusCode, message: message)
        }
    }
    private func postJSON(path: String, body: [String: Any]) async throws -> EmployeeAuthResult {
        guard let url = self.url(for: path) else {
            throw EmployeeAuthError.badURL
        }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await self.session.data(for: request)
        } catch {
            throw EmployeeAuthError.network(error.localizedDescription)
        }
        guard let http = response as? HTTPURLResponse else {
            throw EmployeeAuthError.server(status: -1, message: nil)
        }
        let object = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
        let message = (object?["error"] as? String) ?? (object?["message"] as? String)
        switch http.statusCode {
        case 200 ..< 300:
            let ok = (object?["ok"] as? Bool) ?? true
            return EmployeeAuthResult(ok: ok, message: message)
        case 401, 403:
            throw EmployeeAuthError.invalidCredentials
        default:
            throw EmployeeAuthError.server(status: http.statusCode, message: message)
        }
    }

}
