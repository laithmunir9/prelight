import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { loadDotEnv, OpenAIEmbedder, deterministicEmbedder } from "./embeddings.js";
import { runSpeechCI, compareRuns } from "./engine.js";

loadDotEnv(resolve(process.cwd(), "../../.env"));
const dataDir = fileURLToPath(new URL("../data/", import.meta.url));
const tests = JSON.parse(await readFile(resolve(dataDir, "suite.json"), "utf8"));
const take1 = { take_id: "take-1", duration_seconds: 68, transcript: "Teams waste hours on manual speech feedback. Prelight is a speech testing coach that stores the requirements of a pitch. We are building a category for speech CI. Um, our early pilots are showing strong interest. It differs from general-purpose LLMs because it reruns frozen tests across every take." , tests };
const take2 = { take_id: "take-2", duration_seconds: 54, transcript: "Teams waste hours on manual speech feedback. Prelight is a speech testing coach that stores the requirements of a pitch. We have 120 pilot users and 35 percent weekly growth. Um, it reruns frozen tests across every take." , tests };
const live = process.env.OPENAI_API_KEY && process.env.SPEECH_CI_OFFLINE !== "1";
const provider = live ? new OpenAIEmbedder({ cachePath: resolve(dataDir, "embedding-cache.json") }) : null;
const embedder = live ? provider.embed.bind(provider) : deterministicEmbedder();
const [run1, run2] = await Promise.all([runSpeechCI(take1, { embedder }), runSpeechCI(take2, { embedder })]); const diff = compareRuns(run1, run2);
console.log("PRELIGHT SPEECH CI" + (live ? "" : " (offline deterministic embeddings)"));
for (const run of [run1, run2]) { console.log(`\n${run.take_id === "take-1" ? "Take 1" : "Take 2"}`); for (const item of run.results) console.log(`${item.passed ? "✓" : "✗"} ${item.name}`); }
console.log("\nFIXED"); for (const item of diff.fixes) console.log(`+ ${item.name}`);
console.log("\nREGRESSION"); for (const item of diff.regressions) console.log(`- ${item.name}`);
console.log(`\nPass-count delta: ${diff.pass_count_delta >= 0 ? "+" : ""}${diff.pass_count_delta}`);
