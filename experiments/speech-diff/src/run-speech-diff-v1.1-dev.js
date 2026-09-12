import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadLocalEnvironment, loadOrCreateEmbeddingCache } from "./embeddings.js";
import { evaluateDataset } from "./evaluate.js";
import { speechDiffV11 } from "./speech-diff-v1.1.js";
import { aggregatePairResults, OPERATIONS } from "./sweep.js";

const experimentRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const repoRoot = dirname(dirname(experimentRoot));
const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));
const sha256 = async (path) => createHash("sha256").update(await readFile(path)).digest("hex");
const groupTexts = (segments) => {
  const texts = [];
  for (let start = 0; start < segments.length; start++) for (const size of [1, 2, 3]) {
    const group = segments.slice(start, start + size);
    if (group.length === size) texts.push(group.map((segment) => segment.text).join(" "));
  }
  return texts;
};
const pairNumber = (pairId) => Number(pairId.slice(5));
const aggregate = (evaluation, predicate) => aggregatePairResults(evaluation.pairs.filter((result) => predicate(pairNumber(result.pair_id))));
const operationCounts = (predictions) => Object.fromEntries(OPERATIONS.map((operation) => [operation, Object.values(predictions).flat().filter((relationship) => relationship.operation === operation).length]));
const conservative = (a, b) => b.global_match_min - a.global_match_min || b.match_margin_min - a.match_margin_min;
const compareCandidates = (left, right) =>
  right.difficult_development_pairs_7_to_14.macro_f1_supported - left.difficult_development_pairs_7_to_14.macro_f1_supported ||
  right.difficult_development_pairs_7_to_14.relationship.f1 - left.difficult_development_pairs_7_to_14.relationship.f1 ||
  right.overall.macro_f1_supported - left.overall.macro_f1_supported ||
  right.overall.relationship.f1 - left.overall.relationship.f1 ||
  conservative(left.parameters, right.parameters);

const datasetPath = join(experimentRoot, "data/dev.json");
const gridPath = join(experimentRoot, "config/speech-diff-v1.1-grid.json");
const dataset = await readJson(datasetPath);
const grid = await readJson(gridPath);
const hashes = { dev: await sha256(datasetPath) };
const gridHash = await sha256(gridPath);
const configurations = [];
for (const global_match_min of grid.global_match_min) for (const match_margin_min of grid.match_margin_min) configurations.push({ global_match_min, match_margin_min, ...grid.fixed_parameters });

await loadLocalEnvironment(join(repoRoot, ".env"));
const apiKey = process.env.OPENAI_API_KEY?.trim();
if (!apiKey) throw new Error("Missing OPENAI_API_KEY");
const model = "text-embedding-3-large";
const baseUrl = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").trim().replace(/\/+$/, "");
const texts = dataset.pairs.flatMap((pair) => [...groupTexts(pair.take_a.segments), ...groupTexts(pair.take_b.segments)]);
const { vectors, cache } = await loadOrCreateEmbeddingCache({ texts, cachePath: join(experimentRoot, "cache", `dev-${model}.json`), model, apiKey, baseUrl });
const sweepResults = [];
for (const parameters of configurations) {
  const predictions = Object.fromEntries(dataset.pairs.map((pair) => [pair.pair_id, speechDiffV11(pair, vectors, parameters)]));
  const evaluation = evaluateDataset(dataset, predictions);
  sweepResults.push({ parameters, overall: aggregate(evaluation, () => true), easy_pairs_1_to_6: aggregate(evaluation, (number) => number <= 6), difficult_development_pairs_7_to_14: aggregate(evaluation, (number) => number >= 7) });
}
const winner = [...sweepResults].sort(compareCandidates)[0];
const predictions = Object.fromEntries(dataset.pairs.map((pair) => [pair.pair_id, speechDiffV11(pair, vectors, winner.parameters)]));
const evaluation = evaluateDataset(dataset, predictions);
const overall = aggregate(evaluation, () => true);
const easy = aggregate(evaluation, (number) => number <= 6);
const difficult = aggregate(evaluation, (number) => number >= 7);
const baseline = await readJson(join(experimentRoot, "results/baseline-dev-v1.json"));
const v1 = await readJson(join(experimentRoot, "results/speech-diff-v1-dev.json"));
const inputPricePerMillionUsd = 0.13;
const cost = cache.usage_this_run.total_tokens * inputPricePerMillionUsd / 1_000_000;
const gates = {
  moved_f1: { threshold: 0.4, actual: overall.per_operation.moved.f1, passed: overall.per_operation.moved.f1 >= 0.4 },
  deleted_f1: { threshold: 0, actual: overall.per_operation.deleted.f1, passed: overall.per_operation.deleted.f1 > 0 },
  split_f1: { threshold: 0.7, actual: overall.per_operation.split.f1, passed: overall.per_operation.split.f1 >= 0.7 },
  merged_f1: { threshold: 0.6, actual: overall.per_operation.merged.f1, passed: overall.per_operation.merged.f1 >= 0.6 },
  difficult_relationship_f1: { threshold: v1.difficult_development_pairs_7_to_14.relationship.f1, actual: difficult.relationship.f1, passed: difficult.relationship.f1 >= v1.difficult_development_pairs_7_to_14.relationship.f1 },
  difficult_macro_f1_supported: { threshold: v1.difficult_development_pairs_7_to_14.macro_f1_supported, actual: difficult.macro_f1_supported, passed: difficult.macro_f1_supported >= v1.difficult_development_pairs_7_to_14.macro_f1_supported },
  overall_relationship_f1: { threshold: 0.6, actual: overall.relationship.f1, passed: overall.relationship.f1 >= 0.6 },
};
const comparison = (previous) => ({ overall_relationship_f1_delta: overall.relationship.f1 - previous.overall.relationship.f1, overall_macro_f1_supported_delta: overall.macro_f1_supported - previous.overall.macro_f1_supported, difficult_relationship_f1_delta: difficult.relationship.f1 - previous.difficult_development_pairs_7_to_14.relationship.f1, difficult_macro_f1_supported_delta: difficult.macro_f1_supported - previous.difficult_development_pairs_7_to_14.macro_f1_supported });
const result = {
  experiment_version: "speech-diff-v1.1-dev",
  timestamp: new Date().toISOString(),
  benchmark_hashes: hashes,
  algorithm: { version: "speech-diff-v1.1", description: "Structural split/merge selection precedes exact global one-to-one semantic assignment. A structural group must retain singleton evidence within half the existing group penalty. A weighted LIS over assigned B positions defines the relative-order backbone; assigned inversions are moved." },
  grid: { path: "config/speech-diff-v1.1-grid.json", sha256: gridHash, configuration_count: configurations.length, definition: grid },
  embedding: { model_id: model, cache_path: "cache/dev-text-embedding-3-large.json", api_calls_this_runner_invocation: cache.api_calls_this_run, usage_this_runner_invocation: cache.usage_this_run, api_calls_total_cache: cache.api_calls, usage_total_cache: cache.usage, pricing: { input_price_per_million_tokens_usd: inputPricePerMillionUsd, estimated_runner_embedding_cost_usd: cost } },
  selection: { primary_objective: "highest difficult-development macro_f1_supported", tie_breakers: ["higher difficult-development relationship F1", "higher overall macro_f1_supported", "higher overall relationship F1", "higher global_match_min then match_margin_min"], winning_parameters: winner.parameters },
  sweep_results: sweepResults,
  overall,
  easy_pairs_1_to_6: easy,
  difficult_development_pairs_7_to_14: difficult,
  operation_counts_predicted: operationCounts(predictions),
  detailed_error_report: evaluation.pairs.map(({ pair_id, errors }) => ({ pair_id, ...errors })),
  comparison_to_baseline_v1: comparison(baseline),
  comparison_to_speech_diff_v1: comparison(v1),
  success_conditions: { checks: gates, passed: Object.values(gates).every((gate) => gate.passed) },
};
const resultsDir = join(experimentRoot, "results");
await mkdir(resultsDir, { recursive: true });
await writeFile(join(resultsDir, "speech-diff-v1.1-dev.json"), JSON.stringify(result, null, 2));
const metricRows = [["Overall relationship F1", overall.relationship.f1], ["Overall macro F1 (supported)", overall.macro_f1_supported], ["Difficult relationship F1", difficult.relationship.f1], ["Difficult macro F1 (supported)", difficult.macro_f1_supported]].map(([label, value]) => `| ${label} | ${value} |`).join("\n");
const opRows = Object.entries(overall.per_operation).map(([operation, metrics]) => `| ${operation} | ${metrics.f1} |`).join("\n");
const gateRows = Object.entries(gates).map(([name, gate]) => `| ${name} | ${gate.actual} | ${gate.threshold} | ${gate.passed ? "PASS" : "FAIL"} |`).join("\n");
await writeFile(join(resultsDir, "SPEECH_DIFF_V1.1_DEV.md"), `# Speech Diff V1.1 — development\n\nModel: \`${model}\`\n\nGrid SHA-256 (frozen before evaluation): \`${gridHash}\`\n\nArchitecture: select split/merge structures first, rejecting a group that is more than half the existing group penalty weaker than its best singleton evidence; globally assign remaining individual segments by maximum semantic weight with Take-A match-margin filtering; retain a weighted relative-order LIS as ordinary relations and label remaining assigned inversions as \`moved\`. Structural relationships consume their segments before 1:1 matching.\n\nWinning parameters: \`${JSON.stringify(winner.parameters)}\`\n\n| Metric | Value |\n| --- | ---: |\n${metricRows}\n\n## Per-operation F1\n\n| Operation | F1 |\n| --- | ---: |\n${opRows}\n\n## V1.1 success conditions\n\n| Check | Actual | Threshold | Result |\n| --- | ---: | ---: | --- |\n${gateRows}\n\n## Comparison\n\n| Comparison | Overall relationship F1 Δ | Overall supported macro F1 Δ | Difficult relationship F1 Δ | Difficult supported macro F1 Δ |\n| --- | ---: | ---: | ---: | ---: |\n| Baseline V1 | ${result.comparison_to_baseline_v1.overall_relationship_f1_delta} | ${result.comparison_to_baseline_v1.overall_macro_f1_supported_delta} | ${result.comparison_to_baseline_v1.difficult_relationship_f1_delta} | ${result.comparison_to_baseline_v1.difficult_macro_f1_supported_delta} |\n| Speech Diff V1 | ${result.comparison_to_speech_diff_v1.overall_relationship_f1_delta} | ${result.comparison_to_speech_diff_v1.overall_macro_f1_supported_delta} | ${result.comparison_to_speech_diff_v1.difficult_relationship_f1_delta} | ${result.comparison_to_speech_diff_v1.difficult_macro_f1_supported_delta} |\n\nThis runner made ${cache.api_calls_this_run} embedding API calls and used ${cache.usage_this_runner_invocation?.total_tokens ?? cache.usage_this_run.total_tokens} input tokens ($${cost} estimated). The complete fixed 16-configuration sweep and detailed error report are in \`speech-diff-v1.1-dev.json\`.\n`);
console.log(JSON.stringify({ grid_hash: gridHash, configurations: configurations.length, winner: winner.parameters, overall: overall.relationship, overall_macro_f1_supported: overall.macro_f1_supported, difficult: difficult.relationship, difficult_macro_f1_supported: difficult.macro_f1_supported, cache, gates: result.success_conditions }, null, 2));
