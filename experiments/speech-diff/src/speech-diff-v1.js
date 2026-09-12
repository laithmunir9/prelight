import { cosineSimilarity } from "./baseline.js";

const OPERATION_ORDER = { split: 0, merged: 1, moved: 2, unchanged: 3, modified: 4, deleted: 5, added: 6 };

export const normalizeEmbedding = (vector) => {
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  return magnitude ? vector.map((value) => value / magnitude) : vector;
};

export const tokenize = (text) => [...String(text).toLowerCase().matchAll(/[a-z0-9]+/g)].map(([token]) => token);
export function lexicalJaccard(leftText, rightText) {
  const left = new Set(tokenize(leftText));
  const right = new Set(tokenize(rightText));
  const union = new Set([...left, ...right]);
  if (!union.size) return 1;
  return [...left].filter((token) => right.has(token)).length / union.size;
}

const groupText = (segments) => segments.map((segment) => segment.text).join(" ");
const groupKey = (segments) => groupText(segments);
const candidateKey = (candidate) => `${candidate.operation}|${candidate.take_a_segment_ids.join(",")}|${candidate.take_b_segment_ids.join(",")}`;
const operationPriority = (operation) => ({ split: 4, merged: 3, moved: 2, unchanged: 1, modified: 1, deleted: 0, added: 0 }[operation]);

function createFeatures(pair, vectors) {
  const side = (segments) => segments.map((segment, position) => ({ ...segment, position, vector: normalizeEmbedding(vectors[segment.text]) }));
  return { takeA: side(pair.take_a.segments), takeB: side(pair.take_b.segments), vectors };
}

function similarity(features, aSegments, bSegments) {
  const aText = groupKey(aSegments);
  const bText = groupKey(bSegments);
  const rawAVector = features.vectors[aText];
  const rawBVector = features.vectors[bText];
  if (!rawAVector || !rawBVector) throw new Error("Missing cached embedding for candidate group");
  const aVector = normalizeEmbedding(rawAVector);
  const bVector = normalizeEmbedding(rawBVector);
  return cosineSimilarity(aVector, bVector);
}

function relationship(operation, aSegments, bSegments, semantic, lexical = null) {
  return { operation, take_a_segment_ids: aSegments.map((segment) => segment.segment_id), take_b_segment_ids: bSegments.map((segment) => segment.segment_id), semantic_similarity: semantic, lexical_similarity: lexical };
}

function ordinaryOperation(semantic, lexical, config) {
  return semantic >= config.semantic_unchanged_min && lexical >= config.lexical_unchanged_min ? "unchanged" : "modified";
}

function betterPath(current, proposal) {
  if (!current) return true;
  if (proposal.score > current.score + 1e-12) return true;
  if (Math.abs(proposal.score - current.score) > 1e-12) return false;
  if (proposal.priority !== current.priority) return proposal.priority > current.priority;
  return proposal.signature < current.signature;
}

export function monotonicAlign(pair, vectors, config) {
  const features = createFeatures(pair, vectors);
  const { takeA, takeB } = features;
  const table = Array.from({ length: takeA.length + 1 }, () => Array(takeB.length + 1).fill(null));
  table[0][0] = { score: 0, priority: 0, signature: "", relationships: [] };
  const propose = (nextI, nextJ, state, relation, score) => {
    const proposal = { score: state.score + score, priority: state.priority + operationPriority(relation.operation), signature: `${state.signature}|${candidateKey(relation)}`, relationships: [...state.relationships, relation] };
    if (betterPath(table[nextI][nextJ], proposal)) table[nextI][nextJ] = proposal;
  };
  for (let i = 0; i <= takeA.length; i++) for (let j = 0; j <= takeB.length; j++) {
    const state = table[i][j];
    if (!state) continue;
    if (i < takeA.length) propose(i + 1, j, state, relationship("deleted", [takeA[i]], [], 0), -config.gap_penalty);
    if (j < takeB.length) propose(i, j + 1, state, relationship("added", [], [takeB[j]], 0), -config.gap_penalty);
    if (i < takeA.length && j < takeB.length) {
      const aSegments = [takeA[i]], bSegments = [takeB[j]];
      const semantic = similarity(features, aSegments, bSegments);
      if (semantic >= config.match_min) {
        const lexical = lexicalJaccard(aSegments[0].text, bSegments[0].text);
        propose(i + 1, j + 1, state, relationship(ordinaryOperation(semantic, lexical, config), aSegments, bSegments, semantic, lexical), semantic);
      }
    }
    for (const size of [2, 3]) {
      if (i < takeA.length && j + size <= takeB.length) {
        const aSegments = [takeA[i]], bSegments = takeB.slice(j, j + size);
        const semantic = similarity(features, aSegments, bSegments);
        if (semantic >= config.structural_min) propose(i + 1, j + size, state, relationship("split", aSegments, bSegments, semantic), semantic - config.group_penalty * (size - 1));
      }
      if (i + size <= takeA.length && j < takeB.length) {
        const aSegments = takeA.slice(i, i + size), bSegments = [takeB[j]];
        const semantic = similarity(features, aSegments, bSegments);
        if (semantic >= config.structural_min) propose(i + size, j + 1, state, relationship("merged", aSegments, bSegments, semantic), semantic - config.group_penalty * (size - 1));
      }
    }
  }
  const relationships = table[takeA.length][takeB.length].relationships;
  const backbone = relationships.filter((item) => item.operation !== "deleted" && item.operation !== "added");
  const consumedA = new Set(backbone.flatMap((item) => item.take_a_segment_ids));
  const consumedB = new Set(backbone.flatMap((item) => item.take_b_segment_ids));
  return { features, relationships, backbone, unmatchedA: takeA.filter((segment) => !consumedA.has(segment.segment_id)), unmatchedB: takeB.filter((segment) => !consumedB.has(segment.segment_id)) };
}

function contiguousGroups(segments, allowedIds) {
  const groups = [];
  for (let start = 0; start < segments.length; start++) for (const size of [1, 2, 3]) {
    const group = segments.slice(start, start + size);
    if (group.length === size && group.every((segment) => allowedIds.has(segment.segment_id))) groups.push(group);
  }
  return groups;
}

export function buildResidualCandidates(features, unmatchedA, unmatchedB, config) {
  const aGroups = contiguousGroups(features.takeA, new Set(unmatchedA.map((segment) => segment.segment_id)));
  const bGroups = contiguousGroups(features.takeB, new Set(unmatchedB.map((segment) => segment.segment_id)));
  const candidates = new Map();
  for (const aSegments of aGroups) for (const bSegments of bGroups) {
    if (aSegments.length > 1 && bSegments.length > 1) continue;
    const semantic = similarity(features, aSegments, bSegments);
    let operation;
    if (aSegments.length === 1 && bSegments.length === 1) {
      if (semantic < config.move_min) continue;
      operation = "moved";
    } else {
      if (semantic < config.structural_min) continue;
      operation = aSegments.length === 1 ? "split" : "merged";
    }
    const size = Math.max(aSegments.length, bSegments.length);
    const structuralBonus = operation === "split" ? config.residual_structural_precedence_bonus * 2 : operation === "merged" ? config.residual_structural_precedence_bonus : 0;
    const weight = semantic - config.group_penalty * (size - 1) + structuralBonus;
    const candidate = { ...relationship(operation, aSegments, bSegments, semantic), weight, priority: operationPriority(operation) };
    const key = candidateKey(candidate);
    if (!candidates.has(key) || candidates.get(key).weight < candidate.weight) candidates.set(key, candidate);
  }
  return [...candidates.values()].sort((a, b) => b.weight - a.weight || b.priority - a.priority || candidateKey(a).localeCompare(candidateKey(b)));
}

export function selectResidualCandidates(candidates) {
  let best = { weight: 0, precedence: [0, 0, 0], selected: [], signature: "" };
  const better = (proposal, current) => proposal.weight > current.weight + 1e-12 ||
    (Math.abs(proposal.weight - current.weight) <= 1e-12 && (proposal.precedence[0] > current.precedence[0] || proposal.precedence[0] === current.precedence[0] && (proposal.precedence[1] > current.precedence[1] || proposal.precedence[1] === current.precedence[1] && (proposal.precedence[2] > current.precedence[2] || proposal.precedence[2] === current.precedence[2] && proposal.signature < current.signature))));
  const visit = (index, usedA, usedB, weight, precedence, selected) => {
    if (index === candidates.length) {
      const proposal = { weight, precedence, selected, signature: selected.map(candidateKey).sort().join("|") };
      if (better(proposal, best)) best = proposal;
      return;
    }
    visit(index + 1, usedA, usedB, weight, precedence, selected);
    const candidate = candidates[index];
    if (candidate.take_a_segment_ids.some((id) => usedA.has(id)) || candidate.take_b_segment_ids.some((id) => usedB.has(id))) return;
    const nextA = new Set([...usedA, ...candidate.take_a_segment_ids]);
    const nextB = new Set([...usedB, ...candidate.take_b_segment_ids]);
    const nextPrecedence = [...precedence];
    if (candidate.operation === "split") nextPrecedence[0] += 1;
    if (candidate.operation === "merged") nextPrecedence[1] += 1;
    if (candidate.operation === "moved") nextPrecedence[2] += 1;
    visit(index + 1, nextA, nextB, weight + candidate.weight, nextPrecedence, [...selected, candidate]);
  };
  visit(0, new Set(), new Set(), 0, [0, 0, 0], []);
  return best.selected;
}

export function speechDiffV1(pair, vectors, config) {
  const monotonic = monotonicAlign(pair, vectors, config);
  const candidates = buildResidualCandidates(monotonic.features, monotonic.unmatchedA, monotonic.unmatchedB, config);
  const residual = selectResidualCandidates(candidates);
  const consumedA = new Set([...monotonic.backbone, ...residual].flatMap((item) => item.take_a_segment_ids));
  const consumedB = new Set([...monotonic.backbone, ...residual].flatMap((item) => item.take_b_segment_ids));
  const gaps = [
    ...monotonic.features.takeA.filter((segment) => !consumedA.has(segment.segment_id)).map((segment) => relationship("deleted", [segment], [], 0)),
    ...monotonic.features.takeB.filter((segment) => !consumedB.has(segment.segment_id)).map((segment) => relationship("added", [], [segment], 0)),
  ];
  return [...monotonic.backbone, ...residual, ...gaps]
    .map(({ semantic_similarity, lexical_similarity, weight, priority, ...item }) => item)
    .sort((a, b) => OPERATION_ORDER[a.operation] - OPERATION_ORDER[b.operation] || candidateKey(a).localeCompare(candidateKey(b)));
}
