export const OPERATIONS = ["unchanged", "modified", "added", "deleted", "moved", "split", "merged"];

const rounded = (value) => Number(value.toFixed(2));
export function createThresholdGrid() {
  const configurations = [];
  for (let match = 0.4; match <= 0.900001; match += 0.05) {
    for (let unchanged = match; unchanged <= 0.980001; unchanged += 0.02) configurations.push({ match_threshold: rounded(match), unchanged_threshold: rounded(unchanged) });
  }
  return configurations;
}

export function chooseWinner(candidates) {
  return [...candidates].sort((a, b) =>
    b.overall.macro_f1_supported - a.overall.macro_f1_supported ||
    b.difficult_development.relationship.f1 - a.difficult_development.relationship.f1 ||
    b.overall.relationship.f1 - a.overall.relationship.f1 ||
    b.unchanged_threshold - a.unchanged_threshold ||
    b.match_threshold - a.match_threshold
  )[0];
}

const score = (tp, fp, fn) => ({ precision: tp + fp ? tp / (tp + fp) : 0, recall: tp + fn ? tp / (tp + fn) : 0, f1: tp * 2 + fp + fn ? (2 * tp) / (2 * tp + fp + fn) : 0 });

export function aggregatePairResults(results) {
  const counts = results.reduce((total, result) => ({ tp: total.tp + result.counts.tp, fp: total.fp + result.counts.fp, fn: total.fn + result.counts.fn }), { tp: 0, fp: 0, fn: 0 });
  const perOperation = Object.fromEntries(OPERATIONS.map((operation) => {
    const countsForOperation = results.reduce((total, result) => ({
      tp: total.tp + result.operation_counts[operation].tp,
      fp: total.fp + result.operation_counts[operation].fp,
      fn: total.fn + result.operation_counts[operation].fn,
    }), { tp: 0, fp: 0, fn: 0 });
    return [operation, score(countsForOperation.tp, countsForOperation.fp, countsForOperation.fn)];
  }));
  const supportedOperations = OPERATIONS.filter((operation) => results.some((result) => result.operation_counts[operation].tp + result.operation_counts[operation].fn > 0));
  return {
    pair_ids: results.map((result) => result.pair_id),
    relationship: score(counts.tp, counts.fp, counts.fn),
    per_operation: perOperation,
    supported_operations: supportedOperations,
    macro_f1_supported: supportedOperations.reduce((sum, operation) => sum + perOperation[operation].f1, 0) / supportedOperations.length,
    macro_operation_f1: OPERATIONS.reduce((sum, operation) => sum + perOperation[operation].f1, 0) / OPERATIONS.length,
  };
}
