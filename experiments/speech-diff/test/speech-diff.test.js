import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { validateDataset } from "../src/validate.js";
import { evaluatePair, evaluateDataset } from "../src/evaluate.js";
import { cosineSimilarity, runNaiveBaseline } from "../src/baseline.js";

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
  const embeddings = { alpha: [1, 0, 0], "alpha revised": [0.99, 0.01, 0], unknown: [0, 1, 0], extra: [0, 0, 1] };
  const result = await runNaiveBaseline(pair, { embedder: (text) => embeddings[text], minSimilarity: 0.9 });
  assert.deepEqual(result, [
    { operation: "modified", take_a_segment_ids: ["a1"], take_b_segment_ids: ["b1"] },
    { operation: "deleted", take_a_segment_ids: ["a2"], take_b_segment_ids: [] },
    { operation: "added", take_a_segment_ids: [], take_b_segment_ids: ["b2"] }
  ]);
});

test("naive baseline keeps duplicate B choices as separate 1:1 matches and never infers structural operations", async () => {
  const pair = { take_a: { segments: [{ segment_id: "a1", text: "first" }, { segment_id: "a2", text: "second" }] }, take_b: { segments: [{ segment_id: "b1", text: "shared" }] } };
  const result = await runNaiveBaseline(pair, { embedder: () => [1, 0], minSimilarity: 0.5 });
  assert.deepEqual(result, [
    { operation: "modified", take_a_segment_ids: ["a1"], take_b_segment_ids: ["b1"] },
    { operation: "modified", take_a_segment_ids: ["a2"], take_b_segment_ids: ["b1"] }
  ]);
  assert.equal(result.some((r) => ["moved", "split", "merged"].includes(r.operation)), false);
});
