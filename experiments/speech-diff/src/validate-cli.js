import { readFile } from "node:fs/promises";
import { assertValidDataset } from "./validate.js";
const dataset = JSON.parse(await readFile(process.argv[2]));
assertValidDataset(dataset);
console.log(`Valid speech-diff dataset: ${dataset.pairs.length} pair(s)`);
