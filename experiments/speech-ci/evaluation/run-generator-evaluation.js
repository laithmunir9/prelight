import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadDotEnv } from "../src/embeddings.js";
import { suggestTests } from "../src/generator.js";
import { corpus } from "./corpus.js";
const experimentDir = fileURLToPath(new URL("../", import.meta.url)); loadDotEnv(resolve(experimentDir, "../../.env"));
const results = [];
for (const task of corpus) {
  const goal = task.suite.map((x) => x.name).join("; ");
  try { const tests = await suggestTests({ context: task.category, goal }); const ids = new Set(); const redundant = tests.length !== new Set(tests.map((x) => x.id)).size; results.push({ task_id: task.id, valid: true, count: tests.length, redundant, tests }); }
  catch (error) { results.push({ task_id: task.id, valid: false, error: error.message }); }
}
const valid = results.filter((x) => x.valid).length; const output = { model: "gpt-5.5", tasks: results.length, valid_tasks: valid, validity_rate: valid / results.length, results, note: "Validity is schema/executability validation. Requirement coverage and redundancy were inspected separately from runner metrics." };
await mkdir(resolve(experimentDir, "evaluation"), { recursive: true }); await writeFile(resolve(experimentDir, "evaluation/generator-results.json"), JSON.stringify(output, null, 2)); console.log(JSON.stringify({ model: output.model, tasks: output.tasks, valid_tasks: output.valid_tasks, validity_rate: output.validity_rate, results: results.map(({ task_id, valid, count, redundant, error }) => ({ task_id, valid, count, redundant, error })) }, null, 2));
