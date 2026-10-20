import OpenBotKit
import SwiftUI

struct EvolutionSettings: View {
    @State private var model: EvolutionPerceptionModel?

    var body: some View {
        Group {
            if let model {
                EvolutionPerceptionScreen(model: model)
            } else {
                ProgressView("读取进化投影")
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
            }
        }
        .task {
            guard self.model == nil else { return }
            self.model = EvolutionPerceptionModel(transport: MacEvolutionPerceptionTransport())
        }
    }
}

private struct MacEvolutionPerceptionTransport: EvolutionPerceptionTransport {
    func performEvolutionPerception(method: String, paramsJSON: String) async throws -> Data {
        guard EvolutionPerceptionMethod.isAllowed(method) else {
            throw EvolutionPerceptionClientError.forbiddenMethod(method)
        }
        let params = try JSONDecoder().decode([String: AnyCodable].self, from: Data(paramsJSON.utf8))
        switch method {
        case EvolutionPerceptionMethod.query:
            return try await GatewayConnection.shared.evolutionPerceptionQuery(params: params)
        case EvolutionPerceptionMethod.project:
            return try await GatewayConnection.shared.evolutionPerceptionProject(params: params)
        default:
            throw EvolutionPerceptionClientError.forbiddenMethod(method)
        }
    }
}
