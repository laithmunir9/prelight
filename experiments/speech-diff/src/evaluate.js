import { assertValidDataset, OPERATIONS } from "./validate.js";

const key = (r) => `${r.operation}|a:${[...r.take_a_segment_ids].sort().join(",")}|b:${[...r.take_b_segment_ids].sort().join(",")}`;
const score = (tp, fp, fn) => ({ precision: tp + fp ? tp / (tp + fp) : 0, recall: tp + fn ? tp / (tp + fn) : 0, f1: tp * 2 + fp + fn ? (2 * tp) / (2 * tp + fp + fn) : 0 });
const dedupe = (relationships) => [...new Map(relationships.map((r) => [key(r), r])).values()];

export function evaluatePair(pair, predictedRelationships) {
  const truth = pair.relationships;
  const truthKeys = new Map(truth.map((r) => [key(r), r]));
  const predictions = dedupe(predictedRelationships);
  const predKeys = new Map(predictions.map((r) => [key(r), r]));
  const tp = [...predKeys.keys()].filter((k) => truthKeys.has(k)).length;
  const fp = [...predKeys.keys()].filter((k) => !truthKeys.has(k)).length;
  const fn = [...truthKeys.keys()].filter((k) => !predKeys.has(k)).length;
  const operationCounts = Object.fromEntries([...OPERATIONS].map((op) => {
    const t = truth.filter((r) => r.operation === op).map(key), p = predictions.filter((r) => r.operation === op).map(key);
    return [op, { tp: p.filter((k) => truthKeys.has(k)).length, fp: p.filter((k) => !truthKeys.has(k)).length, fn: t.filter((k) => !predKeys.has(k)).length }];
  }));
  const byOperation = Object.fromEntries([...OPERATIONS].map((op) => [op, score(operationCounts[op].tp, operationCounts[op].fp, operationCounts[op].fn)]));
  const macro = [...OPERATIONS].reduce((sum, op) => sum + byOperation[op].f1, 0) / OPERATIONS.size;
  const supported = [...OPERATIONS].filter((op) => truth.some((r) => r.operation === op));
  const macroSupported = supported.length ? supported.reduce((sum, op) => sum + byOperation[op].f1, 0) / supported.length : null;
  const incorrect = predictions.filter((p) => truth.some((t) => t.operation !== p.operation && t.take_a_segment_ids.length === p.take_a_segment_ids.length && t.take_b_segment_ids.length === p.take_b_segment_ids.length && t.take_a_segment_ids.every((id) => p.take_a_segment_ids.includes(id)) && t.take_b_segment_ids.every((id) => p.take_b_segment_ids.includes(id))));
  return { pair_id: pair.pair_id, counts: { tp, fp, fn }, operation_counts: operationCounts, relationship: score(tp, fp, fn), per_operation: byOperation, supported_operations: supported, macro_f1_supported: macroSupported, macro_operation_f1: macro,
    errors: { false_positive_relationships: predictions.filter((r) => !truthKeys.has(key(r))), false_negatives: truth.filter((r) => !predKeys.has(key(r))), incorrect_operation_labels: incorrect } };
}

export function evaluateDataset(dataset, predictionsByPair = {}) {
  assertValidDataset(dataset);
  const results = dataset.pairs.map((pair) => evaluatePair(pair, predictionsByPair[pair.pair_id] ?? []));
  const selected = (ids) => results.filter((r) => ids.has(Number(r.pair_id.replace("pair-", ""))));
  const aggregate = (items) => {
    if (!items.length) return { status: "no_data", pairs: [], relationship: null, per_operation: {}, macro_f1_supported: null, macro_operation_f1: null };
    const counts = items.reduce((s, r) => ({ tp: s.tp + r.counts.tp, fp: s.fp + r.counts.fp, fn: s.fn + r.counts.fn }), { tp: 0, fp: 0, fn: 0 });
    const perOperation = Object.fromEntries([...OPERATIONS].map((op) => {
      const c = items.reduce((s, r) => ({ tp: s.tp + r.operation_counts[op].tp, fp: s.fp + r.operation_counts[op].fp, fn: s.fn + r.operation_counts[op].fn }), { tp: 0, fp: 0, fn: 0 });
      return [op, score(c.tp, c.fp, c.fn)];
    }));
    const supported = [...OPERATIONS].filter((op) => items.some((r) => r.operation_counts[op].tp + r.operation_counts[op].fn > 0));
    const macroSupported = supported.length ? supported.reduce((n, op) => n + perOperation[op].f1, 0) / supported.length : null;
    return { status: "evaluated", pairs: items.map((r) => r.pair_id), relationship: score(counts.tp, counts.fp, counts.fn), per_operation: perOperation, supported_operations: supported, macro_f1_supported: macroSupported, macro_operation_f1: Object.values(perOperation).reduce((n, x) => n + x.f1, 0) / OPERATIONS.size };
  };
  return { pairs: results, pair_1_to_6: aggregate(selected(new Set([1,2,3,4,5,6]))), difficult_benchmark_pairs_7_to_20: aggregate(selected(new Set([...Array(14)].map((_, i) => i + 7)))) };
}
