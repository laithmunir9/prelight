import { assertValidDataset } from "./validate.js";

export const cosineSimilarity = (a, b) => { const dot = a.reduce((s, x, i) => s + x * b[i], 0), na = Math.sqrt(a.reduce((s, x) => s + x*x, 0)), nb = Math.sqrt(b.reduce((s, x) => s + x*x, 0)); return na && nb ? dot / (na * nb) : 0; };

export async function runNaiveBaseline(pair, { embedder, matchThreshold = 0, unchangedThreshold = 1 } = {}) {
  if (typeof embedder !== "function") throw new TypeError("runNaiveBaseline requires an embedder(segmentText) function");
  if (!Number.isFinite(matchThreshold) || !Number.isFinite(unchangedThreshold) || unchangedThreshold < matchThreshold) throw new RangeError("unchangedThreshold must be greater than or equal to matchThreshold");
  const a = pair.take_a.segments, b = pair.take_b.segments, vectors = await Promise.all([...a, ...b].map((s) => embedder(s.text)));
  const av = vectors.slice(0, a.length), bv = vectors.slice(a.length), chosen = new Set(), relationships = [];
  for (let i = 0; i < a.length; i++) {
    let best = -1, similarity = -1;
    for (let j = 0; j < b.length; j++) { const value = cosineSimilarity(av[i], bv[j]); if (value > similarity) { similarity = value; best = j; } }
    if (best < 0 || similarity < matchThreshold) relationships.push({ operation: "deleted", take_a_segment_ids: [a[i].segment_id], take_b_segment_ids: [] });
    else { chosen.add(best); relationships.push({ operation: similarity >= unchangedThreshold ? "unchanged" : "modified", take_a_segment_ids: [a[i].segment_id], take_b_segment_ids: [b[best].segment_id] }); }
  }
  for (let j = 0; j < b.length; j++) if (!chosen.has(j)) relationships.push({ operation: "added", take_a_segment_ids: [], take_b_segment_ids: [b[j].segment_id] });
  return relationships;
}

export function validatePredictionShape(dataset, predictions) { assertValidDataset({ ...dataset, pairs: dataset.pairs.map((p) => ({ ...p, relationships: predictions[p.pair_id] ?? [] })) }); return predictions; }
