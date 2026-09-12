import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { validateDataset } from "../src/validate.js";
import { evaluatePair, evaluateDataset } from "../src/evaluate.js";
import { cosineSimilarity, runNaiveBaseline } from "../src/baseline.js";
import { chooseWinner, createThresholdGrid } from "../src/sweep.js";
import { selectResidualCandidates, speechDiffV1 } from "../src/speech-diff-v1.js";

const dataset = JSON.parse(await readFile(new URL("../data/fixtures.json", import.meta.url)));
const clone = (x) => structuredClone(x);

test("synthetic fixture dataset is valid", () => assert.deepEqual(validateDataset(dataset), []));

for (const [name, mutate] of [
  ["malformed examples", (d) => { d.pairs[0].take_a.segments[0].text = ""; }],
  ["duplicate pair IDs", (d) => { d.pairs[1].pair_id = d.pairs[0].pair_id; }],
  ["duplicate segment IDs", (d) => { d.pairs[0].take_a.segments[1].segment_id = "a1"; }],
  ["nonexistent references", (d) => { d.pairs[0].relationships[0].take_b_segment_ids = ["missing"]; }],
  ["invalid operation", (d) => { d.pairs[0].relationships[0].operation = "aligned"; }],
  ["malformed one-to-many", (d) => { d.pairs[3].relationships[0].take_b_segment_ids = ["b1"]; }],
  ["malformed many-to-one", (d) => { d.pairs[4].relationships[0].take_a_segment_ids = ["a1"]; }]
]) test(`rejects ${name}`, () => assert.ok(validateDataset(mutate(clone(dataset))).length));

test("relationship scoring reports exact matches and errors", () => {
  const pair = dataset.pairs[1];
  const result = evaluatePair(pair, [{ operation: "unchanged", take_a_segment_ids: ["a1"], take_b_segment_ids: ["b1"] }]);
  assert.equal(result.relationship.precision, 0);
  assert.equal(result.relationship.recall, 0);
  assert.equal(result.errors.incorrect_operation_labels.length, 1);
  assert.equal(result.errors.false_positive_relationships.length, 1);
  assert.equal(result.errors.false_negatives.length, 1);
});

test("relationship identity keeps A and B sides distinct", () => {
  const pair = { pair_id: "pair-identity", relationships: [{ operation: "modified", take_a_segment_ids: ["A1"], take_b_segment_ids: ["B2"] }] };
  const result = evaluatePair(pair, [{ operation: "modified", take_a_segment_ids: ["A2"], take_b_segment_ids: ["B1"] }]);
  assert.equal(result.counts.tp, 0);
  assert.equal(result.counts.fp, 1);
  assert.equal(result.counts.fn, 1);
});

test("duplicate canonical predictions are deduplicated before scoring and reporting", () => {
  const pair = dataset.pairs[0];
  const prediction = { operation: "unchanged", take_a_segment_ids: ["a1"], take_b_segment_ids: ["b1"] };
  const result = evaluatePair(pair, [prediction, structuredClone(prediction)]);
  assert.equal(result.counts.tp, 1);
  assert.equal(result.errors.false_positive_relationships.length, 0);
});

test("supported macro excludes operations absent from ground truth", () => {
  const pair = dataset.pairs[0];
  const result = evaluatePair(pair, pair.relationships);
  assert.deepEqual(result.supported_operations, ["unchanged"]);
  assert.equal(result.macro_f1_supported, 1);
  assert.equal(result.macro_operation_f1, 1 / 7);
});

test("dataset evaluation exposes pairs 1-6 and difficult 7-20 aggregates", () => {
  const result = evaluateDataset(dataset, {});
  assert.deepEqual(result.pair_1_to_6.pairs, ["pair-1", "pair-2", "pair-3", "pair-4", "pair-5", "pair-6"]);
  assert.deepEqual(result.difficult_benchmark_pairs_7_to_20.pairs, []);
  assert.equal(result.difficult_benchmark_pairs_7_to_20.status, "no_data");
  assert.equal(result.difficult_benchmark_pairs_7_to_20.macro_f1_supported, null);
  assert.equal(result.pair_1_to_6.relationship.f1, 0);
  assert.equal(result.pair_1_to_6.status, "evaluated");
});

test("cosine similarity is normalized", () => { assert.equal(cosineSimilarity([1, 0], [1, 0]), 1); assert.equal(cosineSimilarity([1, 0], [0, 1]), 0); });

test("naive baseline embeds, chooses independently, thresholds, and emits add/delete", async () => {
  const pair = { take_a: { segments: [{ segment_id: "a1", text: "alpha" }, { segment_id: "a2", text: "unknown" }] }, take_b: { segments: [{ segment_id: "b1", text: "alpha revised" }, { segment_id: "b2", text: "extra" }] } };
  const embeddings = { alpha: [1, 0, 0], "alpha revised": [0.9, 0.1, 0], unknown: [0, 1, 0], extra: [0, 0, 1] };
  const result = await runNaiveBaseline(pair, { embedder: (text) => embeddings[text], matchThreshold: 0.9, unchangedThreshold: 0.995 });
  assert.deepEqual(result, [
    { operation: "modified", take_a_segment_ids: ["a1"], take_b_segment_ids: ["b1"] },
    { operation: "deleted", take_a_segment_ids: ["a2"], take_b_segment_ids: [] },
    { operation: "added", take_a_segment_ids: [], take_b_segment_ids: ["b2"] }
  ]);
});

test("naive baseline keeps duplicate B choices as separate 1:1 matches and never infers structural operations", async () => {
  const pair = { take_a: { segments: [{ segment_id: "a1", text: "first" }, { segment_id: "a2", text: "second" }] }, take_b: { segments: [{ segment_id: "b1", text: "shared" }] } };
  const result = await runNaiveBaseline(pair, { embedder: () => [1, 0], matchThreshold: 0.5, unchangedThreshold: 1.01 });
  assert.deepEqual(result, [
    { operation: "modified", take_a_segment_ids: ["a1"], take_b_segment_ids: ["b1"] },
    { operation: "modified", take_a_segment_ids: ["a2"], take_b_segment_ids: ["b1"] }
  ]);
  assert.equal(result.some((r) => ["moved", "split", "merged"].includes(r.operation)), false);
});

test("naive baseline uses the second similarity threshold for unchanged labels", async () => {
  const pair = { take_a: { segments: [{ segment_id: "a1", text: "one" }] }, take_b: { segments: [{ segment_id: "b1", text: "two" }] } };
  const relationships = await runNaiveBaseline(pair, { embedder: () => [1, 0], matchThreshold: 0.5, unchangedThreshold: 0.9 });
  assert.equal(relationships[0].operation, "unchanged");
  await assert.rejects(() => runNaiveBaseline(pair, { embedder: () => [1, 0], matchThreshold: 0.8, unchangedThreshold: 0.7 }), RangeError);
});

test("threshold sweep grid is fixed and winner follows declared tie breakers", () => {
  const grid = createThresholdGrid();
  assert.equal(grid[0].match_threshold, 0.4);
  assert.equal(grid.at(-1).unchanged_threshold, 0.98);
  const candidate = (match, unchanged, macro, difficult, overall) => ({ match_threshold: match, unchanged_threshold: unchanged, overall: { macro_f1_supported: macro, relationship: { f1: overall } }, difficult_development: { relationship: { f1: difficult } } });
  assert.deepEqual(chooseWinner([candidate(0.5, 0.8, 0.4, 0.5, 0.5), candidate(0.6, 0.9, 0.4, 0.6, 0.1)]), candidate(0.6, 0.9, 0.4, 0.6, 0.1));
});

const v1Config = { match_min: 0.8, structural_min: 0.8, move_min: 0.8, lexical_unchanged_min: 0.5, semantic_unchanged_min: 0.85, group_penalty: 0.05, gap_penalty: 0.2 };
const groupTexts = (segments) => {
  const texts = [];
  for (let start = 0; start < segments.length; start++) for (const size of [1, 2, 3]) {
    const group = segments.slice(start, start + size);
    if (group.length === size) texts.push(group.map((segment) => segment.text).join(" "));
  }
  return texts;
};
const vectorsFor = (pair, overrides) => Object.fromEntries([...groupTexts(pair.take_a.segments), ...groupTexts(pair.take_b.segments)].map((text) => [text, overrides[text] ?? [0, 0]]));
const relation = (operation, a, b, weight) => ({ operation, take_a_segment_ids: a, take_b_segment_ids: b, weight, priority: 0 });

test("V1 DP recovers a 1:1 alignment", () => {
  const pair = { take_a: { segments: [{ segment_id: "a1", text: "source" }] }, take_b: { segments: [{ segment_id: "b1", text: "target" }] } };
  const vectors = vectorsFor(pair, { source: [1, 0], target: [1, 0] });
  const result = speechDiffV1(pair, vectors, v1Config);
  assert.deepEqual(result, [{ operation: "modified", take_a_segment_ids: ["a1"], take_b_segment_ids: ["b1"] }]);
  assert.deepEqual(speechDiffV1(pair, vectors, v1Config), result);
});

test("V1 DP emits additions and deletions for unrelated segments", () => {
  const pair = { take_a: { segments: [{ segment_id: "a1", text: "left" }] }, take_b: { segments: [{ segment_id: "b1", text: "right" }] } };
  const result = speechDiffV1(pair, vectorsFor(pair, { left: [1, 0], right: [0, 1] }), v1Config);
  assert.deepEqual(result, [{ operation: "deleted", take_a_segment_ids: ["a1"], take_b_segment_ids: [] }, { operation: "added", take_a_segment_ids: [], take_b_segment_ids: ["b1"] }]);
});

test("V1 DP supports a split and a merge", () => {
  const split = { take_a: { segments: [{ segment_id: "a1", text: "combined" }] }, take_b: { segments: [{ segment_id: "b1", text: "first" }, { segment_id: "b2", text: "second" }] } };
  const splitResult = speechDiffV1(split, vectorsFor(split, { combined: [1, 0], "first second": [1, 0] }), v1Config);
  assert.deepEqual(splitResult, [{ operation: "split", take_a_segment_ids: ["a1"], take_b_segment_ids: ["b1", "b2"] }]);
  const merge = { take_a: { segments: [{ segment_id: "a1", text: "first" }, { segment_id: "a2", text: "second" }] }, take_b: { segments: [{ segment_id: "b1", text: "combined" }] } };
  const mergeResult = speechDiffV1(merge, vectorsFor(merge, { "first second": [1, 0], combined: [1, 0] }), v1Config);
  assert.deepEqual(mergeResult, [{ operation: "merged", take_a_segment_ids: ["a1", "a2"], take_b_segment_ids: ["b1"] }]);
});

test("V1 recovers reordered residual material as moved without double consumption", () => {
  const pair = { take_a: { segments: [{ segment_id: "a1", text: "one" }, { segment_id: "a2", text: "two" }] }, take_b: { segments: [{ segment_id: "b1", text: "two-prime" }, { segment_id: "b2", text: "one-prime" }] } };
  const result = speechDiffV1(pair, vectorsFor(pair, { one: [1, 0], "one-prime": [1, 0], two: [0, 1], "two-prime": [0, 1] }), v1Config);
  assert.ok(result.some((item) => item.operation === "moved"));
  assert.equal(new Set(result.flatMap((item) => item.take_a_segment_ids)).size, 2);
  assert.equal(new Set(result.flatMap((item) => item.take_b_segment_ids)).size, 2);
});

test("V1 can recover a moved split from residual candidates", () => {
  const pair = { take_a: { segments: [{ segment_id: "a1", text: "anchor" }, { segment_id: "a2", text: "combined" }] }, take_b: { segments: [{ segment_id: "b1", text: "first" }, { segment_id: "b2", text: "second" }, { segment_id: "b3", text: "anchor-prime" }] } };
  const result = speechDiffV1(pair, vectorsFor(pair, { anchor: [1, 0], "anchor-prime": [1, 0], combined: [0, 1], "first second": [0, 1] }), v1Config);
  assert.ok(result.some((item) => item.operation === "split" && item.take_a_segment_ids.includes("a2")));
});

test("residual optimization selects the highest-weight non-overlapping set deterministically", () => {
  const candidates = [relation("moved", ["a1"], ["b1"], 0.8), relation("split", ["a1"], ["b1", "b2"], 0.9), relation("moved", ["a2"], ["b2"], 0.8)];
  const selected = selectResidualCandidates(candidates);
  assert.deepEqual(selected.map((item) => item.operation), ["moved", "moved"]);
  assert.deepEqual(selectResidualCandidates(candidates), selected);
});
