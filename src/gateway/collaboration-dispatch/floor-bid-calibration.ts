/**
 * Floor Runtime v2.1 §6.5 Bid calibration.
 * Metrics only. suppressSelfAssessment is a recommendation for a later phase.
 * Shadow-B does not write it back into Admission or the production decision.
 */

export type FloorBidCalibrationSample = {
  agentId: string;
  intent: string;
  selfNovelty: number;
  admissionNovelty: number;
  confidence: number;
  /** Null when the beat has no visible post to classify. Excluded from ρ and ECE. */
  useful: boolean | null;
};

export type FloorBidCalibrationRow = {
  agentId: string;
  intent: string;
  samples: number;
  /** mean |selfAssessment.novelty − admissionSignals.novelty| */
  noveltyError: number | null;
  /** Spearman ρ(confidence, useful). Null when useful is unknown or variance is 0. */
  confidenceRho: number | null;
  /** Expected calibration error of confidence over 5 bins. */
  ece: number | null;
  /** noveltyError > 0.3 or ρ < 0.1. Not applied to this beat's admission. */
  suppressSelfAssessment: boolean;
};

const NOVELTY_ERROR_LIMIT = 0.3;
const RHO_FLOOR = 0.1;

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function averageRanks(values: readonly number[]): number[] {
  const indexed = values.map((value, index) => ({ value, index }));
  indexed.sort((left, right) => left.value - right.value || left.index - right.index);
  const ranks = Array.from({ length: values.length }, () => 0);
  let cursor = 0;
  while (cursor < indexed.length) {
    let end = cursor;
    while (end + 1 < indexed.length && indexed[end + 1]?.value === indexed[cursor]?.value) {
      end += 1;
    }
    const rank = (cursor + end) / 2 + 1;
    for (let index = cursor; index <= end; index += 1) {
      const row = indexed[index];
      if (row) {
        ranks[row.index] = rank;
      }
    }
    cursor = end + 1;
  }
  return ranks;
}

function pearson(left: readonly number[], right: readonly number[]): number | null {
  const count = left.length;
  if (count < 2 || right.length !== count) {
    return null;
  }
  let sumLeft = 0;
  let sumRight = 0;
  for (let index = 0; index < count; index += 1) {
    sumLeft += left[index] ?? 0;
    sumRight += right[index] ?? 0;
  }
  const meanLeft = sumLeft / count;
  const meanRight = sumRight / count;
  let product = 0;
  let squareLeft = 0;
  let squareRight = 0;
  for (let index = 0; index < count; index += 1) {
    const deltaLeft = (left[index] ?? 0) - meanLeft;
    const deltaRight = (right[index] ?? 0) - meanRight;
    product += deltaLeft * deltaRight;
    squareLeft += deltaLeft * deltaLeft;
    squareRight += deltaRight * deltaRight;
  }
  if (squareLeft === 0 || squareRight === 0) {
    return null;
  }
  return product / Math.sqrt(squareLeft * squareRight);
}

/** Spearman rank correlation. Null below 2 points or when either side has no variance. */
export function spearmanRho(left: readonly number[], right: readonly number[]): number | null {
  if (left.length !== right.length || left.length < 2) {
    return null;
  }
  const rho = pearson(averageRanks(left), averageRanks(right));
  return rho === null ? null : round4(rho);
}

/**
 * ECE over bins [0,0.2), [0.2,0.4), [0.4,0.6), [0.6,0.8), [0.8,1].
 * Confidence 1 stays in the last bin.
 */
export function expectedCalibrationError(
  samples: readonly { confidence: number; useful: boolean }[],
): number | null {
  if (samples.length === 0) {
    return null;
  }
  const edges = [0, 0.2, 0.4, 0.6, 0.8, 1];
  let error = 0;
  for (let index = 0; index < 5; index += 1) {
    const low = edges[index] ?? 0;
    const high = edges[index + 1] ?? 1;
    const bin = samples.filter((sample) =>
      index === 4
        ? sample.confidence >= low && sample.confidence <= high
        : sample.confidence >= low && sample.confidence < high,
    );
    if (bin.length === 0) {
      continue;
    }
    const confidence = bin.reduce((sum, sample) => sum + sample.confidence, 0) / bin.length;
    const accuracy = bin.reduce((sum, sample) => sum + (sample.useful ? 1 : 0), 0) / bin.length;
    error += (bin.length / samples.length) * Math.abs(accuracy - confidence);
  }
  return round4(error);
}

export function calibrateFloorBidSamples(
  samples: readonly FloorBidCalibrationSample[],
): FloorBidCalibrationRow[] {
  const groups = new Map<string, FloorBidCalibrationSample[]>();
  for (const sample of samples) {
    const agentId = sample.agentId.trim();
    const intent = sample.intent.trim();
    if (!agentId || !intent) {
      continue;
    }
    const key = `${agentId}\0${intent}`;
    const list = groups.get(key) ?? [];
    list.push(sample);
    groups.set(key, list);
  }
  const rows: FloorBidCalibrationRow[] = [];
  for (const list of groups.values()) {
    const first = list[0];
    if (!first) {
      continue;
    }
    const noveltyError = round4(
      list.reduce(
        (sum, sample) => sum + Math.abs(sample.selfNovelty - sample.admissionNovelty),
        0,
      ) / list.length,
    );
    const labeled = list.filter(
      (sample): sample is FloorBidCalibrationSample & { useful: boolean } => sample.useful !== null,
    );
    const confidenceRho = spearmanRho(
      labeled.map((sample) => sample.confidence),
      labeled.map((sample) => (sample.useful ? 1 : 0)),
    );
    const ece = expectedCalibrationError(
      labeled.map((sample) => ({ confidence: sample.confidence, useful: sample.useful })),
    );
    rows.push({
      agentId: first.agentId,
      intent: first.intent,
      samples: list.length,
      noveltyError,
      confidenceRho,
      ece,
      suppressSelfAssessment:
        noveltyError > NOVELTY_ERROR_LIMIT || (confidenceRho !== null && confidenceRho < RHO_FLOOR),
    });
  }
  rows.sort((left, right) =>
    left.agentId === right.agentId
      ? left.intent.localeCompare(right.intent)
      : left.agentId.localeCompare(right.agentId),
  );
  return rows;
}
