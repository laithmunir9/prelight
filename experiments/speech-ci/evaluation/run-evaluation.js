import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadDotEnv, OpenAIEmbedder } from "../src/embeddings.js";
import { runSpeechCI, compareRuns } from "../src/engine.js";
import { corpus } from "./corpus.js";

const experimentDir = fileURLToPath(new URL("../", import.meta.url));
loadDotEnv(resolve(experimentDir, "../../.env"));
if (!process.env.OPENAI_API_KEY) throw new Error("Root .env must provide OPENAI_API_KEY");
const dataDir = resolve(experimentDir, "data");
const cachePath = resolve(dataDir, "evaluation-embedding-cache.json");
await mkdir(dataDir, { recursive: true });
const provider = new OpenAIEmbedder({ cachePath });
const embedder = provider.embed.bind(provider);
const byType = new Map(); const errors = []; const taskRuns = [];
const add = (type, expected, actual, item, task, take) => { const key = type === "filler_limit" ? "filler_count_max" : type; const x = byType.get(key) ?? { type: key, total: 0, tp: 0, tn: 0, fp: 0, fn: 0, errors: [] }; x.total++; if (expected && actual) x.tp++; else if (!expected && !actual) x.tn++; else if (!expected) { x.fp++; x.errors.push({ task, take, test: item.name, kind: "false_positive", evidence: item.evidence }); } else { x.fn++; x.errors.push({ task, take, test: item.name, kind: "false_negative", evidence: item.evidence }); } byType.set(key, x); };
for (const task of corpus) {
  const runs = [];
  for (const take of task.takes) {
    const run = await runSpeechCI({ take_id: take.id, duration_seconds: take.duration_seconds, transcript: take.transcript, tests: task.suite }, { embedder });
    runs.push(run); for (const item of run.results) add(item.type, take.expected[item.id], item.passed, item, task.id, take.id);
  }
  taskRuns.push({ task_id: task.id, category: task.category, runs });
}
const metric = (x) => ({ total: x.total, tp: x.tp, tn: x.tn, fp: x.fp, fn: x.fn, accuracy: (x.tp + x.tn) / x.total, precision: x.tp + x.fp ? x.tp / (x.tp + x.fp) : 1, recall: x.tp + x.fn ? x.tp / (x.tp + x.fn) : 1, f1: x.tp ? (2 * x.tp) / (2 * x.tp + x.fp + x.fn) : (x.fp + x.fn ? 0 : 1) });
const metrics = Object.fromEntries([...byType].map(([type, x]) => [type, metric(x)]));
const all = [...byType.values()].reduce((a, x) => ({ ...a, total: a.total + x.total, tp: a.tp + x.tp, tn: a.tn + x.tn, fp: a.fp + x.fp, fn: a.fn + x.fn }), { total: 0, tp: 0, tn: 0, fp: 0, fn: 0 });
const overall = metric(all); const transitions = []; let correct = 0; let totalTransitions = 0; let regTp = 0, regFp = 0, regFn = 0;
for (const task of taskRuns) for (let i = 1; i < task.runs.length; i++) { const previous = task.runs[i - 1], current = task.runs[i]; const diff = compareRuns(previous, current); const expected = corpus.find((x) => x.id === task.task_id).takes[i - 1].expected; const next = corpus.find((x) => x.id === task.task_id).takes[i].expected; for (const item of diff.changes) { const prior = expected[item.id], after = next[item.id]; const expectedClass = !prior && after ? "fixed" : prior && !after ? "regression" : after ? "still_passing" : "still_failing"; const actualClass = item.classification; totalTransitions++; if (actualClass === expectedClass) correct++; if (expectedClass === "regression" && actualClass === "regression") regTp++; else if (expectedClass !== "regression" && actualClass === "regression") regFp++; else if (expectedClass === "regression") regFn++; transitions.push({ task: task.task_id, from: previous.take_id, to: current.take_id, id: item.id, expected: expectedClass, actual: actualClass }); } }
const regression = { total: totalTransitions, accuracy: correct / totalTransitions, precision: regTp + regFp ? regTp / (regTp + regFp) : 1, recall: regTp + regFn ? regTp / (regTp + regFn) : 1, f1: regTp ? 2 * regTp / (2 * regTp + regFp + regFn) : 0, tp: regTp, fp: regFp, fn: regFn };
function splitMetrics(selected) { const counts = new Map(); for (const task of taskRuns.filter((x) => selected.has(x.task_id))) { const source = corpus.find((x) => x.id === task.task_id); for (let i = 0; i < task.runs.length; i++) for (const item of task.runs[i].results) { const key = item.type === "filler_limit" ? "filler_count_max" : item.type; const x = counts.get(key) ?? { total: 0, tp: 0, tn: 0, fp: 0, fn: 0 }; const expected = source.takes[i].expected[item.id]; x.total++; if (expected && item.passed) x.tp++; else if (!expected && !item.passed) x.tn++; else if (expected) x.fn++; else x.fp++; counts.set(key, x); } } return Object.fromEntries([...counts].map(([key, value]) => [key, metric(value)])); }
const devMetrics = splitMetrics(new Set(corpus.slice(0, 8).map((x) => x.id))); const heldOutMetrics = splitMetrics(new Set(corpus.slice(8).map((x) => x.id)));
const aggregate = (metricSet) => metric(Object.values(metricSet).reduce((a, x) => ({ total: a.total + x.total, tp: a.tp + x.tp, tn: a.tn + x.tn, fp: a.fp + x.fp, fn: a.fn + x.fn }), { total: 0, tp: 0, tn: 0, fp: 0, fn: 0 }));
const cache = JSON.parse(await readFile(cachePath, "utf8"));
const output = { generated_at: new Date().toISOString(), corpus: { tasks: corpus.length, takes: corpus.reduce((n, x) => n + x.takes.length, 0), development_tasks: 8, held_out_tasks: 4, suites_frozen: true, thresholds_tuned: true, frozen_semantic_threshold: 0.5 }, model: "text-embedding-3-large", cache: { api_calls: cache.api_calls, usage: cache.usage }, development: { metrics: devMetrics, overall: aggregate(devMetrics) }, held_out: { metrics: heldOutMetrics, overall: aggregate(heldOutMetrics) }, metrics, overall, regression, errors: [...byType.values()].flatMap((x) => x.errors).slice(0, 40), evidence_sample: taskRuns.slice(-4).map((x) => ({ task_id: x.task_id, runs: x.runs })), transitions };
await writeFile(resolve(experimentDir, "evaluation/results.json"), JSON.stringify(output, null, 2));
console.log(JSON.stringify({ corpus: output.corpus, model: output.model, cache: output.cache, metrics: output.metrics, overall: output.overall, regression: output.regression, error_count: output.errors.length }, null, 2));
