import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runNaiveBaseline } from "./baseline.js";
import { loadLocalEnvironment, loadOrCreateEmbeddingCache } from "./embeddings.js";
import { evaluateDataset } from "./evaluate.js";
import { aggregatePairResults, chooseWinner, createThresholdGrid, OPERATIONS } from "./sweep.js";

const experimentRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const repoRoot = dirname(dirname(experimentRoot));
const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));
const sha256 = async (path) => createHash("sha256").update(await readFile(path)).digest("hex");

const lock = await readFile(join(experimentRoot, "BENCHMARK_LOCK.md"), "utf8");
const expected = Object.fromEntries([...lock.matchAll(/`data\/(dev|heldout)\.json` \| `([a-f0-9]{64})`/g)].map(([, name, hash]) => [name, hash]));
const actual = { dev: await sha256(join(experimentRoot, "data/dev.json")), heldout: await sha256(join(experimentRoot, "data/heldout.json")) };
if (actual.dev !== expected.dev || actual.heldout !== expected.heldout) throw new Error("Frozen benchmark hash mismatch; baseline aborted");

await loadLocalEnvironment(join(repoRoot, ".env"));
const apiKey = process.env.OPENAI_API_KEY?.trim();
if (!apiKey) throw new Error("Missing OPENAI_API_KEY");
const model = "text-embedding-3-large";
const baseUrl = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").trim().replace(/\/+$/, "");
const dataset = await readJson(join(experimentRoot, "data/dev.json"));
const texts = dataset.pairs.flatMap((pair) => [...pair.take_a.segments, ...pair.take_b.segments].map((segment) => segment.text));
const cachePath = join(experimentRoot, "cache", `dev-${model}.json`);
const { vectors, cache } = await loadOrCreateEmbeddingCache({ texts, cachePath, model, apiKey, baseUrl });
const configurations = createThresholdGrid();
const sweep = [];
let winnerDetails;
for (const configuration of configurations) {
  const predictions = Object.fromEntries(await Promise.all(dataset.pairs.map(async (pair) => [pair.pair_id, await runNaiveBaseline(pair, { embedder: (text) => vectors[text], matchThreshold: configuration.match_threshold, unchangedThreshold: configuration.unchanged_threshold })])));
  const evaluation = evaluateDataset(dataset, predictions);
  const overall = aggregatePairResults(evaluation.pairs);
  const easy = aggregatePairResults(evaluation.pairs.filter((result) => Number(result.pair_id.slice(5)) <= 6));
  const difficult = aggregatePairResults(evaluation.pairs.filter((result) => Number(result.pair_id.slice(5)) >= 7));
  const candidate = { ...configuration, overall, easy, difficult_development: difficult };
  sweep.push(candidate);
}
const winner = chooseWinner(sweep);
const winnerConfig = { matchThreshold: winner.match_threshold, unchangedThreshold: winner.unchanged_threshold };
const predictions = Object.fromEntries(await Promise.all(dataset.pairs.map(async (pair) => [pair.pair_id, await runNaiveBaseline(pair, { embedder: (text) => vectors[text], ...winnerConfig })])));
const evaluation = evaluateDataset(dataset, predictions);
const predictedOperationCounts = Object.fromEntries(OPERATIONS.map((operation) => [operation, Object.values(predictions).flat().filter((relationship) => relationship.operation === operation).length]));
const inputPricePerMillionUsd = 0.13;
const estimatedEmbeddingCostUsd = cache.usage.total_tokens * inputPricePerMillionUsd / 1_000_000;
const result = {
  experiment_version: "baseline-dev-v1",
  timestamp: new Date().toISOString(),
  benchmark_hashes: actual,
  embedding: { model_id: model, cache_path: "cache/dev-text-embedding-3-large.json", api_calls_total_cache: cache.api_calls, api_calls_this_run: cache.newly_embedded_texts ? Math.ceil(cache.newly_embedded_texts / 100) : 0, usage_total_cache: cache.usage, pricing: { input_price_per_million_tokens_usd: inputPricePerMillionUsd, estimated_total_cache_cost_usd: estimatedEmbeddingCostUsd, source: "https://developers.openai.com/api/docs/models/text-embedding-3-large" } },
  threshold_grid: { match_thresholds: "0.40 through 0.90 inclusive, step 0.05", unchanged_thresholds: "each match threshold through 0.98 inclusive, step 0.02", configuration_count: configurations.length },
  selection: { primary_objective: "highest overall macro_f1_supported", tie_breakers: ["higher difficult-development relationship F1", "higher overall relationship F1", "higher unchanged threshold, then higher match threshold"], winner: { match_threshold: winner.match_threshold, unchanged_threshold: winner.unchanged_threshold } },
  sweep_results: sweep,
  overall: aggregatePairResults(evaluation.pairs),
  easy_pairs_1_to_6: aggregatePairResults(evaluation.pairs.filter((item) => Number(item.pair_id.slice(5)) <= 6)),
  difficult_development_pairs_7_to_14: aggregatePairResults(evaluation.pairs.filter((item) => Number(item.pair_id.slice(5)) >= 7)),
  operation_counts_predicted: predictedOperationCounts,
  detailed_error_report: evaluation.pairs.map(({ pair_id, errors }) => ({ pair_id, ...errors })),
};
const resultsDir = join(experimentRoot, "results");
await mkdir(resultsDir, { recursive: true });
await writeFile(join(resultsDir, "baseline-dev-v1.json"), JSON.stringify(result, null, 2));
await writeFile(join(resultsDir, "BASELINE_V1.md"), `# Baseline Run #1\n\nModel: \`${model}\`\n\nWinning thresholds: match \`${winner.match_threshold}\`; unchanged \`${winner.unchanged_threshold}\`.\n\nOverall relationship F1: \`${result.overall.relationship.f1}\`\n\nOverall supported macro F1: \`${result.overall.macro_f1_supported}\`\n\nDifficult development relationship F1: \`${result.difficult_development_pairs_7_to_14.relationship.f1}\`\n\nDifficult development supported macro F1: \`${result.difficult_development_pairs_7_to_14.macro_f1_supported}\`\n\nEmbedding usage: \`${cache.usage.total_tokens}\` input tokens across \`${cache.api_calls}\` cached API calls; estimated cost \`$${estimatedEmbeddingCostUsd}\` at \`$${inputPricePerMillionUsd}\` per million input tokens.\n\nThe complete predeclared sweep and detailed errors are recorded in \`baseline-dev-v1.json\`.\n`);
console.log(JSON.stringify({ model, winner: result.selection.winner, overall: result.overall.relationship, macro_f1_supported: result.overall.macro_f1_supported, difficult_development: result.difficult_development_pairs_7_to_14.relationship, difficult_macro_f1_supported: result.difficult_development_pairs_7_to_14.macro_f1_supported, cache }, null, 2));
