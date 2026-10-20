export class CogniWeaveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class ValidationError extends CogniWeaveError {}

export class ScopeViolationError extends CogniWeaveError {}

export class IdempotencyConflictError extends CogniWeaveError {}

export class StorageConsistencyError extends CogniWeaveError {}

export class DistillationError extends CogniWeaveError {}

export class ReasoningError extends CogniWeaveError {}

export class EvidenceAccessError extends CogniWeaveError {}
