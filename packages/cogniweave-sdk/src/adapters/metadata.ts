import { StorageConsistencyError } from "../errors.js";
import type {
  EntityRecord,
  EventSkeleton,
  EvidenceRecord,
  MemoryAtom,
  ProblemRecord,
  RelationRecord,
  ScenarioRecord,
  WriteJournal,
} from "../models.js";
import type { MetadataBundle, MetadataStore } from "../storage/types.js";
import type { AdapterDescriptor, BackendAdapterConfig } from "./contracts.js";

function notImplemented(backend: string, method: string): never {
  throw new StorageConsistencyError(`Metadata backend "${backend}" does not implement ${method}`);
}

export class PlaceholderMetadataStore implements MetadataStore {
  descriptor: AdapterDescriptor;

  constructor(config: BackendAdapterConfig) {
    this.descriptor = {
      kind: "metadata",
      backend: config.backend,
      environment: config.environment,
      capabilities: [],
    };
  }

  async saveIngestion(): Promise<void> {
    return notImplemented(this.descriptor.backend, "saveIngestion");
  }

  async upsertEvent(_event: EventSkeleton): Promise<EventSkeleton> {
    return notImplemented(this.descriptor.backend, "upsertEvent");
  }

  async getEvent(): Promise<EventSkeleton | undefined> {
    return notImplemented(this.descriptor.backend, "getEvent");
  }

  async findEventByKey(): Promise<EventSkeleton | undefined> {
    return notImplemented(this.descriptor.backend, "findEventByKey");
  }

  async listEvents(): Promise<EventSkeleton[]> {
    return notImplemented(this.descriptor.backend, "listEvents");
  }

  async getAtom(): Promise<MemoryAtom | undefined> {
    return notImplemented(this.descriptor.backend, "getAtom");
  }

  async listAtoms(): Promise<MemoryAtom[]> {
    return notImplemented(this.descriptor.backend, "listAtoms");
  }

  async queryAtoms(): Promise<MemoryAtom[]> {
    return notImplemented(this.descriptor.backend, "queryAtoms");
  }

  async findAtomsByDedupKey(): Promise<MemoryAtom[]> {
    return notImplemented(this.descriptor.backend, "findAtomsByDedupKey");
  }

  async saveAtom(_atom: MemoryAtom): Promise<void> {
    return notImplemented(this.descriptor.backend, "saveAtom");
  }

  async deleteAtom(): Promise<void> {
    return notImplemented(this.descriptor.backend, "deleteAtom");
  }

  async bindDedupKey(): Promise<void> {
    return notImplemented(this.descriptor.backend, "bindDedupKey");
  }

  async saveEntity(_entity: EntityRecord): Promise<void> {
    return notImplemented(this.descriptor.backend, "saveEntity");
  }

  async saveScenario(_scenario: ScenarioRecord): Promise<void> {
    return notImplemented(this.descriptor.backend, "saveScenario");
  }

  async saveProblem(_problem: ProblemRecord): Promise<void> {
    return notImplemented(this.descriptor.backend, "saveProblem");
  }

  async saveEvidence(_evidence: EvidenceRecord): Promise<void> {
    return notImplemented(this.descriptor.backend, "saveEvidence");
  }

  async saveRelation(_relation: RelationRecord): Promise<void> {
    return notImplemented(this.descriptor.backend, "saveRelation");
  }

  async getEvidence(): Promise<EvidenceRecord | undefined> {
    return notImplemented(this.descriptor.backend, "getEvidence");
  }

  async listEvidence(): Promise<EvidenceRecord[]> {
    return notImplemented(this.descriptor.backend, "listEvidence");
  }

  async queryEvidence(): Promise<EvidenceRecord[]> {
    return notImplemented(this.descriptor.backend, "queryEvidence");
  }

  async getEntity(): Promise<EntityRecord | undefined> {
    return notImplemented(this.descriptor.backend, "getEntity");
  }

  async listEntities(): Promise<EntityRecord[]> {
    return notImplemented(this.descriptor.backend, "listEntities");
  }

  async getScenario(): Promise<ScenarioRecord | undefined> {
    return notImplemented(this.descriptor.backend, "getScenario");
  }

  async listScenarios(): Promise<ScenarioRecord[]> {
    return notImplemented(this.descriptor.backend, "listScenarios");
  }

  async getProblem(): Promise<ProblemRecord | undefined> {
    return notImplemented(this.descriptor.backend, "getProblem");
  }

  async listProblems(): Promise<ProblemRecord[]> {
    return notImplemented(this.descriptor.backend, "listProblems");
  }

  async getRelation(): Promise<RelationRecord | undefined> {
    return notImplemented(this.descriptor.backend, "getRelation");
  }

  async listRelations(): Promise<RelationRecord[]> {
    return notImplemented(this.descriptor.backend, "listRelations");
  }

  async putJournal(_journal: WriteJournal): Promise<void> {
    return notImplemented(this.descriptor.backend, "putJournal");
  }

  async getJournal(): Promise<WriteJournal | undefined> {
    return notImplemented(this.descriptor.backend, "getJournal");
  }

  async listJournals(): Promise<WriteJournal[]> {
    return notImplemented(this.descriptor.backend, "listJournals");
  }

  async updateJournal(): Promise<WriteJournal | undefined> {
    return notImplemented(this.descriptor.backend, "updateJournal");
  }

  async getBundleForJournal(): Promise<MetadataBundle> {
    return notImplemented(this.descriptor.backend, "getBundleForJournal");
  }
}
