import Foundation
import OpenBotKit
import OpenBotProtocol
import OSLog

/// Optional seat binding for Development Supervisor node_agent placement (M5).
enum MacSupervisorNodeBinder {
    private static let logger = Logger(subsystem: "ai.openbot", category: "mac-supervisor-bind")

    static var configuredTenantId: String {
        get { Self.readTrimmed(supervisorNodeBindTenantIdKey) }
        set { UserDefaults.standard.set(newValue, forKey: supervisorNodeBindTenantIdKey) }
    }

    static var configuredSeatId: String {
        get { Self.readTrimmed(supervisorNodeBindSeatIdKey) }
        set { UserDefaults.standard.set(newValue, forKey: supervisorNodeBindSeatIdKey) }
    }

    static var isConfigured: Bool {
        !Self.configuredTenantId.isEmpty && !Self.configuredSeatId.isEmpty
    }

    static var localNodeId: String {
        DeviceIdentityStore.loadOrCreate().deviceId
    }

    static func bindIfConfigured() async {
        guard Self.isConfigured else { return }
        _ = await Self.bindNow(
            tenantId: Self.configuredTenantId,
            seatId: Self.configuredSeatId)
    }

    @discardableResult
    static func bindNow(tenantId: String, seatId: String) async -> Result<Void, Error> {
        let trimmedTenant = tenantId.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedSeat = seatId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedTenant.isEmpty, !trimmedSeat.isEmpty else {
            return .failure(BindError.missingFields)
        }

        Self.configuredTenantId = trimmedTenant
        Self.configuredSeatId = trimmedSeat

        let nodeId = Self.localNodeId
        do {
            _ = try await GatewayConnection.shared.requestRaw(
                method: "supervisor.node.bind",
                params: [
                    "tenantId": AnyCodable(trimmedTenant),
                    "seatId": AnyCodable(trimmedSeat),
                    "nodeId": AnyCodable(nodeId),
                ],
                timeoutMs: 8000)
            self.logger.info(
                "supervisor node bind ok tenant=\(trimmedTenant, privacy: .public) seat=\(trimmedSeat, privacy: .public)")
            return .success(())
        } catch {
            self.logger.error(
                "supervisor node bind failed: \(error.localizedDescription, privacy: .public)")
            return .failure(error)
        }
    }

    private static func readTrimmed(_ key: String) -> String {
        UserDefaults.standard.string(forKey: key)?
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    }

    enum BindError: LocalizedError {
        case missingFields

        var errorDescription: String? {
            switch self {
            case .missingFields:
                "请填写租户 ID 与席位 ID"
            }
        }
    }
}
