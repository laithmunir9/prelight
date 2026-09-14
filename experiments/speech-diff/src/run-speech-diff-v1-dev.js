import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadLocalEnvironment, loadOrCreateEmbeddingCache } from "./embeddings.js";
import { evaluateDataset } from "./evaluate.js";
import { speechDiffV1 } from "./speech-diff-v1.js";
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
const compareCandidates = (a, b) =>
  b.overall.macro_f1_supported - a.overall.macro_f1_supported ||
  b.difficult_development.macro_f1_supported - a.difficult_development.macro_f1_supported ||
  b.difficult_development.relationship.f1 - a.difficult_development.relationship.f1 ||
  b.overall.relationship.f1 - a.overall.relationship.f1 ||
  b.parameters.match_min - a.parameters.match_min ||
  b.parameters.structural_min - a.parameters.structural_min ||
  b.parameters.move_min - a.parameters.move_min ||
  b.parameters.lexical_unchanged_min - a.parameters.lexical_unchanged_min ||
  b.parameters.group_penalty - a.parameters.group_penalty;
const operationCounts = (predictions) => Object.fromEntries(OPERATIONS.map((operation) => [operation, Object.values(predictions).flat().filter((relationship) => relationship.operation === operation).length]));

const lock = await readFile(join(experimentRoot, "BENCHMARK_LOCK.md"), "utf8");
const expected = Object.fromEntries([...lock.matchAll(/`data\/(dev|heldout)\.json` \| `([a-f0-9]{64})`/g)].map(([, name, hash]) => [name, hash]));
const hashes = { dev: await sha256(join(experimentRoot, "data/dev.json")), heldout: await sha256(join(experimentRoot, "data/heldout.json")) };
if (hashes.dev !== expected.dev || hashes.heldout !== expected.heldout) throw new Error("Frozen benchmark hash mismatch; V1 evaluation aborted");

const gridPath = join(experimentRoot, "config/speech-diff-v1-grid.json");
const grid = await readJson(gridPath);
const gridHash = await sha256(gridPath);
const configurations = [];
for (const match_min of grid.match_min) for (const structural_min of grid.structural_min) for (const move_min of grid.move_min) for (const lexical_unchanged_min of grid.lexical_unchanged_min) for (const group_penalty of grid.group_penalty) configurations.push({ match_min, structural_min, move_min, lexical_unchanged_min, group_penalty, gap_penalty: grid.gap_penalty, ...grid.fixed_parameters });

await loadLocalEnvironment(join(repoRoot, ".env"));
const apiKey = process.env.OPENAI_API_KEY?.trim();
if (!apiKey) throw new Error("Missing OPENAI_API_KEY");
const model = "text-embedding-3-large";
const baseUrl = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").trim().replace(/\/+$/, "");
const dataset = await readJson(join(experimentRoot, "data/dev.json"));
const texts = dataset.pairs.flatMap((pair) => [...groupTexts(pair.take_a.segments), ...groupTexts(pair.take_b.segments)]);
const { vectors, cache } = await loadOrCreateEmbeddingCache({ texts, cachePath: join(experimentRoot, "cache", `dev-${model}.json`), model, apiKey, baseUrl });

const sweepResults = [];
for (const parameters of configurations) {
  const predictions = Object.fromEntries(dataset.pairs.map((pair) => [pair.pair_id, speechDiffV1(pair, vectors, parameters)]));
  const evaluation = evaluateDataset(dataset, predictions);
  const overall = aggregatePairResults(evaluation.pairs);
  const easy = aggregatePairResults(evaluation.pairs.filter((result) => Number(result.pair_id.slice(5)) <= 6));
  const difficult = aggregatePairResults(evaluation.pairs.filter((result) => Number(result.pair_id.slice(5)) >= 7));
  sweepResults.push({ parameters, overall, easy_pairs_1_to_6: easy, difficult_development: difficult });
}
const winner = [...sweepResults].sort(compareCandidates)[0];
const predictions = Object.fromEntries(dataset.pairs.map((pair) => [pair.pair_id, speechDiffV1(pair, vectors, winner.parameters)]));
const evaluation = evaluateDataset(dataset, predictions);
const overall = aggregatePairResults(evaluation.pairs);
const easy = aggregatePairResults(evaluation.pairs.filter((result) => Number(result.pair_id.slice(5)) <= 6));
const difficult = aggregatePairResults(evaluation.pairs.filter((result) => Number(result.pair_id.slice(5)) >= 7));
const baseline = await readJson(join(experimentRoot, "results/baseline-dev-v1.json"));
const previousResultPath = join(experimentRoot, "results/speech-diff-v1-dev.json");
const previousResult = existsSync(previousResultPath) ? await readJson(previousResultPath) : null;
const priorUsage = previousResult?.embedding?.usage_for_v1 ?? previousResult?.embedding?.usage_this_run;
const priorCalls = previousResult?.embedding?.api_calls_for_v1_embedding_population ?? previousResult?.embedding?.api_calls_this_run;
const usageForV1 = cache.api_calls_this_run ? cache.usage_this_run : priorUsage ?? cache.usage_this_run;
const apiCallsForV1 = cache.api_calls_this_run || priorCalls || 0;
const inputPricePerMillionUsd = 0.13;
const cost = usageForV1.total_tokens * inputPricePerMillionUsd / 1_000_000;
const gates = {
  overall_relationship_f1: { threshold: 0.5294, actual: overall.relationship.f1, passed: overall.relationship.f1 >= 0.5294 },
  overall_macro_f1_supported: { threshold: 0.5009, actual: overall.macro_f1_supported, passed: overall.macro_f1_supported >= 0.5009 },
  difficult_relationship_f1: { threshold: 0.2667, actual: difficult.relationship.f1, passed: difficult.relationship.f1 >= 0.2667 },
  difficult_macro_f1_supported: { threshold: 0.2, actual: difficult.macro_f1_supported, passed: difficult.macro_f1_supported >= 0.2 },
  structural_nonzero_f1: { threshold: 2, actual: ["moved", "split", "merged"].filter((operation) => overall.per_operation[operation].f1 > 0).length, passed: ["moved", "split", "merged"].filter((operation) => overall.per_operation[operation].f1 > 0).length >= 2 },
};
const result = {
  experiment_version: "speech-diff-v1-dev",
  timestamp: new Date().toISOString(),
  benchmark_hashes: hashes,
  algorithm: { version: "speech-diff-v1", description: "Monotonic dynamic programming over 1:1, 1:2, 1:3, 2:1, 3:1, and gap transitions, followed by exact branch-and-bound residual set packing for moved/split/merged candidates." },
  grid: { path: "config/speech-diff-v1-grid.json", sha256: gridHash, configuration_count: configurations.length, fixed_parameters: grid.fixed_parameters },
  embedding: { model_id: model, cache_path: "cache/dev-text-embedding-3-large.json", api_calls_total_cache: cache.api_calls, api_calls_for_v1_embedding_population: apiCallsForV1, api_calls_this_runner_invocation: cache.api_calls_this_run, usage_total_cache: cache.usage, usage_for_v1: usageForV1, pricing: { input_price_per_million_tokens_usd: inputPricePerMillionUsd, estimated_v1_embedding_cost_usd: cost, source: "https://developers.openai.com/api/docs/models/text-embedding-3-large" } },
  selection: { primary_objective: "highest macro_f1_supported on all development pairs", tie_breakers: ["higher difficult-development macro_f1_supported", "higher difficult-development relationship F1", "higher overall relationship F1", "more conservative thresholds then higher group penalty"], winning_parameters: winner.parameters },
  sweep_results: sweepResults,
  overall,
  easy_pairs_1_to_6: easy,
  difficult_development_pairs_7_to_14: difficult,
  operation_counts_predicted: operationCounts(predictions),
  detailed_error_report: evaluation.pairs.map(({ pair_id, errors }) => ({ pair_id, ...errors })),
  comparison_to_baseline_v1: { overall_relationship_f1_delta: overall.relationship.f1 - baseline.overall.relationship.f1, overall_macro_f1_supported_delta: overall.macro_f1_supported - baseline.overall.macro_f1_supported, difficult_relationship_f1_delta: difficult.relationship.f1 - baseline.difficult_development_pairs_7_to_14.relationship.f1, difficult_macro_f1_supported_delta: difficult.macro_f1_supported - baseline.difficult_development_pairs_7_to_14.macro_f1_supported },
  development_gate: { checks: gates, passed: Object.values(gates).every((gate) => gate.passed) },
};
const resultsDir = join(experimentRoot, "results");
await mkdir(resultsDir, { recursive: true });
await writeFile(join(resultsDir, "speech-diff-v1-dev.json"), JSON.stringify(result, null, 2));
const opRows = Object.entries(overall.per_operation).map(([operation, metrics]) => `| ${operation} | ${metrics.f1} |`).join("\n");
const gateRows = Object.entries(gates).map(([name, gate]) => `| ${name} | ${gate.actual} | ${gate.threshold} | ${gate.passed ? "PASS" : "FAIL"} |`).join("\n");
await writeFile(join(resultsDir, "SPEECH_DIFF_V1_DEV.md"), `# Speech Diff V1 — development\n\nModel: \`${model}\`\n\nGrid SHA-256: \`${gridHash}\`\n\nArchitecture: monotonic dynamic programming over 1:1, 1:2, 1:3, 2:1, 3:1, and gap transitions, followed by exact branch-and-bound residual set packing for non-overlapping moves, splits, and merges.\n\nWinning parameters: \`${JSON.stringify(winner.parameters)}\`\n\n| Metric | Value |\n| --- | ---: |\n| Overall relationship F1 | ${overall.relationship.f1} |\n| Overall macro F1 (supported) | ${overall.macro_f1_supported} |\n| Difficult relationship F1 | ${difficult.relationship.f1} |\n| Difficult macro F1 (supported) | ${difficult.macro_f1_supported} |\n\n## Per-operation F1\n\n| Operation | F1 |\n| --- | ---: |\n${opRows}\n\n## Development gate\n\n| Check | Actual | Threshold | Result |\n| --- | ---: | ---: | --- |\n${gateRows}\n\nEmbedding population used ${apiCallsForV1} API calls and ${usageForV1.total_tokens} input tokens; estimated cost was $${cost}.\n\nCompared with Baseline V1, overall relationship F1 changed by ${result.comparison_to_baseline_v1.overall_relationship_f1_delta} and supported macro F1 changed by ${result.comparison_to_baseline_v1.overall_macro_f1_supported_delta}.\n\nDevelopment gate: **${result.development_gate.passed ? "PASS" : "FAIL"}**. Full sweep, errors, predicted operation counts, and usage are in \`speech-diff-v1-dev.json\`.\n`);
console.log(JSON.stringify({ grid_hash: gridHash, configurations: configurations.length, winner: winner.parameters, overall: overall.relationship, macro_f1_supported: overall.macro_f1_supported, difficult: difficult.relationship, difficult_macro_f1_supported: difficult.macro_f1_supported, cache, gates: result.development_gate }, null, 2));
