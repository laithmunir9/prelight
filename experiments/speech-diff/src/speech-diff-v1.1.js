import { cosineSimilarity } from "./baseline.js";
import { buildResidualCandidates, lexicalJaccard, monotonicAlign, normalizeEmbedding, selectResidualCandidates } from "./speech-diff-v1.js";

const OPERATION_ORDER = { split: 0, merged: 1, moved: 2, unchanged: 3, modified: 4, deleted: 5, added: 6 };
const relationshipKey = (relationship) => `${relationship.operation}|${relationship.take_a_segment_ids.join(",")}|${relationship.take_b_segment_ids.join(",")}`;
const relationship = (operation, aSegments, bSegments) => ({ operation, take_a_segment_ids: aSegments.map((segment) => segment.segment_id), take_b_segment_ids: bSegments.map((segment) => segment.segment_id) });

function compareAssignment(left, right) {
  if (!right) return true;
  if (left.weight > right.weight + 1e-12) return true;
  if (Math.abs(left.weight - right.weight) > 1e-12) return false;
  return left.signature < right.signature;
}

// The candidate list may contain many edges per A segment.  This exact search is
// deliberately small-scope: manually segmented speech takes are short, and it
// provides global B-side uniqueness without adding sequence alignment.
export function maximumWeightAssignment(candidates) {
  const byA = new Map();
  for (const candidate of candidates) {
    const values = byA.get(candidate.a_position) ?? [];
    values.push(candidate);
    byA.set(candidate.a_position, values);
  }
  const aPositions = [...byA.keys()].sort((a, b) => a - b);
  let best = null;
  const visit = (index, usedB, selected, weight) => {
    if (index === aPositions.length) {
      const ordered = [...selected].sort((a, b) => a.a_position - b.a_position || a.b_position - b.b_position);
      const proposal = { weight, selected: ordered, signature: ordered.map((item) => `${item.a_position}:${item.b_position}`).join("|") };
      if (compareAssignment(proposal, best)) best = proposal;
      return;
    }
    visit(index + 1, usedB, selected, weight);
    for (const candidate of byA.get(aPositions[index]).sort((a, b) => b.semantic_similarity - a.semantic_similarity || a.b_position - b.b_position)) {
      if (usedB.has(candidate.b_position)) continue;
      const nextUsedB = new Set(usedB);
      nextUsedB.add(candidate.b_position);
      visit(index + 1, nextUsedB, [...selected, candidate], weight + candidate.semantic_similarity);
    }
  };
  visit(0, new Set(), [], 0);
  return best?.selected ?? [];
}

function betterSubsequence(left, right) {
  if (!right) return true;
  if (left.weight > right.weight + 1e-12) return true;
  if (Math.abs(left.weight - right.weight) > 1e-12) return false;
  if (left.items.length !== right.items.length) return left.items.length > right.items.length;
  const leftPositions = left.items.map((item) => item.b_position);
  const rightPositions = right.items.map((item) => item.b_position);
  for (let index = 0; index < leftPositions.length; index++) {
    if (leftPositions[index] !== rightPositions[index]) return leftPositions[index] < rightPositions[index];
  }
  return left.items.map((item) => item.a_position).join(",") < right.items.map((item) => item.a_position).join(",");
}

// Weighted LIS is the relative-order backbone.  Absolute distance is intentionally
// irrelevant: only an inversion makes a selected correspondence a move.
export function weightedIncreasingSubsequence(correspondences) {
  const ordered = [...correspondences].sort((a, b) => a.a_position - b.a_position || a.b_position - b.b_position);
  const endings = [];
  for (const item of ordered) {
    let best = { weight: item.semantic_similarity, items: [item] };
    for (let previous = 0; previous < endings.length; previous++) {
      if (endings[previous].items.at(-1).b_position >= item.b_position) continue;
      const candidate = { weight: endings[previous].weight + item.semantic_similarity, items: [...endings[previous].items, item] };
      if (betterSubsequence(candidate, best)) best = candidate;
    }
    endings.push(best);
  }
  return endings.reduce((best, candidate) => betterSubsequence(candidate, best) ? candidate : best, null)?.items ?? [];
}

function selectStructuralRelationships(pair, vectors, config) {
  // V1's dynamic programme supplies ordinary 1:1 confidence anchors while selecting
  // structural candidates.  Only its split/merge output is retained: anchor matches
  // never consume a segment for V1.1's later global 1:1 stage.
  const structuralConfig = {
    match_min: config.global_match_min,
    move_min: 0.7,
    structural_min: config.structural_min,
    lexical_unchanged_min: config.lexical_unchanged_min,
    semantic_unchanged_min: config.semantic_unchanged_min,
    group_penalty: config.group_penalty,
    gap_penalty: config.gap_penalty,
    residual_structural_precedence_bonus: 0.001,
  };
  const monotonic = monotonicAlign(pair, vectors, structuralConfig);
  const structuralCoherent = (candidate) => {
    const aSegments = candidate.take_a_segment_ids.map((id) => monotonic.features.takeA.find((segment) => segment.segment_id === id));
    const bSegments = candidate.take_b_segment_ids.map((id) => monotonic.features.takeB.find((segment) => segment.segment_id === id));
    const strongestSingleton = Math.max(...aSegments.flatMap((a) => bSegments.map((b) => cosineSimilarity(a.vector, b.vector))));
    // A group must retain almost all of the strongest singleton evidence. This
    // reuses the fixed group penalty as a granularity allowance rather than adding
    // a new fitted threshold, and avoids treating a high-confidence 1:1 as a group.
    return candidate.semantic_similarity >= strongestSingleton - config.group_penalty / 2;
  };
  const residual = selectResidualCandidates(buildResidualCandidates(monotonic.features, monotonic.unmatchedA, monotonic.unmatchedB, structuralConfig)
    .filter((candidate) => (candidate.operation === "split" || candidate.operation === "merged") && structuralCoherent(candidate)));
  return { features: monotonic.features, relationships: [...monotonic.backbone.filter((item) => (item.operation === "split" || item.operation === "merged") && structuralCoherent(item)), ...residual] };
}

function ordinaryOperation(candidate, config) {
  return candidate.semantic_similarity >= config.semantic_unchanged_min && candidate.lexical_similarity >= config.lexical_unchanged_min ? "unchanged" : "modified";
}

export function speechDiffV11(pair, vectors, config) {
  const structural = selectStructuralRelationships(pair, vectors, config);
  const consumedA = new Set(structural.relationships.flatMap((item) => item.take_a_segment_ids));
  const consumedB = new Set(structural.relationships.flatMap((item) => item.take_b_segment_ids));
  const availableA = structural.features.takeA.filter((segment) => !consumedA.has(segment.segment_id));
  const availableB = structural.features.takeB.filter((segment) => !consumedB.has(segment.segment_id));
  const candidates = [];
  for (const a of availableA) {
    const scored = availableB.map((b) => ({ a, b, semantic_similarity: cosineSimilarity(normalizeEmbedding(a.vector), normalizeEmbedding(b.vector)) }))
      .sort((left, right) => right.semantic_similarity - left.semantic_similarity || left.b.position - right.b.position);
    const [best, second] = scored;
    // A confidence margin is intentionally evaluated on Take A only, as frozen in
    // the grid.  A segment with no runner-up uses 0 as its second-best similarity.
    if (!best || best.semantic_similarity < config.global_match_min || best.semantic_similarity - (second?.semantic_similarity ?? 0) < config.match_margin_min) continue;
    for (const scoredCandidate of scored.filter((candidate) => candidate.semantic_similarity >= config.global_match_min)) candidates.push({
      ...scoredCandidate,
      a_position: a.position,
      b_position: scoredCandidate.b.position,
      lexical_similarity: lexicalJaccard(a.text, scoredCandidate.b.text),
    });
  }
  const assigned = maximumWeightAssignment(candidates);
  const backbone = weightedIncreasingSubsequence(assigned);
  const backboneKeys = new Set(backbone.map((candidate) => `${candidate.a_position}:${candidate.b_position}`));
  const oneToOne = assigned.map((candidate) => relationship(backboneKeys.has(`${candidate.a_position}:${candidate.b_position}`) ? ordinaryOperation(candidate, config) : "moved", [candidate.a], [candidate.b]));
  for (const item of oneToOne) {
    item.take_a_segment_ids.forEach((id) => consumedA.add(id));
    item.take_b_segment_ids.forEach((id) => consumedB.add(id));
  }
  const gaps = [
    ...structural.features.takeA.filter((segment) => !consumedA.has(segment.segment_id)).map((segment) => relationship("deleted", [segment], [])),
    ...structural.features.takeB.filter((segment) => !consumedB.has(segment.segment_id)).map((segment) => relationship("added", [], [segment])),
  ];
  return [...structural.relationships, ...oneToOne, ...gaps]
    .map(({ semantic_similarity, lexical_similarity, weight, priority, ...item }) => item)
    .sort((left, right) => OPERATION_ORDER[left.operation] - OPERATION_ORDER[right.operation] || relationshipKey(left).localeCompare(relationshipKey(right)));
}
