import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export const TEST_TYPES = new Set(["duration_max", "semantic_presence", "semantic_absence", "semantic_order", "numeric_evidence", "phrase_count_max", "filler_limit", "concept_coverage"]);
export const schema = JSON.parse(await readFile(fileURLToPath(new URL("../schema/speech-test-ir-v0.json", import.meta.url)), "utf8"));

const fail = (path, message) => { throw new Error(`Invalid Speech Test IR at ${path}: ${message}`); };
export function validateTest(test) {
  if (!test || typeof test !== "object" || Array.isArray(test)) fail("$", "must be an object");
  const keys = Object.keys(test); const allowed = new Set(["id", "type", "name", "config"]);
  const extra = keys.find((key) => !allowed.has(key)); if (extra) fail(extra, "additional properties are not allowed");
  if (typeof test.id !== "string" || !/^[a-z0-9][a-z0-9._-]{1,63}$/.test(test.id)) fail("id", "must match the stable ID pattern");
  if (!TEST_TYPES.has(test.type)) fail("type", `unsupported type ${JSON.stringify(test.type)}`);
  if (typeof test.name !== "string" || !test.name.trim()) fail("name", "must be a non-empty string");
  if (!test.config || typeof test.config !== "object" || Array.isArray(test.config) || !Object.keys(test.config).length) fail("config", "must be a non-empty object");
  const c = test.config;
  const number = (key) => { if (typeof c[key] !== "number" || !Number.isFinite(c[key])) fail(`config.${key}`, "must be a finite number"); };
  const string = (key) => { if (typeof c[key] !== "string" || !c[key].trim()) fail(`config.${key}`, "must be a non-empty string"); };
  if (test.type === "duration_max") { number("max_seconds"); }
  if (["semantic_presence", "semantic_absence"].includes(test.type)) { string("concept"); if (c.threshold !== undefined) number("threshold"); }
  if (test.type === "semantic_order") { string("before"); string("after"); if (c.threshold !== undefined) number("threshold"); }
  if (test.type === "numeric_evidence") { string("concept"); if (c.threshold !== undefined) number("threshold"); if (c.window_chunks !== undefined) number("window_chunks"); }
  if (test.type === "phrase_count_max") { string("phrase"); number("max_count"); }
  if (test.type === "filler_limit") { if (c.fillers !== undefined && (!Array.isArray(c.fillers) || c.fillers.some((x) => typeof x !== "string"))) fail("config.fillers", "must be an array of strings"); number("max_count"); }
  if (test.type === "concept_coverage") { if (!Array.isArray(c.concepts) || c.concepts.length === 0 || c.concepts.some((x) => typeof x !== "string" || !x.trim())) fail("config.concepts", "must be a non-empty array of strings"); if (!["ALL", "AT_LEAST_N"].includes(c.mode)) fail("config.mode", "must be ALL or AT_LEAST_N"); if (c.mode === "AT_LEAST_N") number("min_count"); if (c.threshold !== undefined) number("threshold"); }
  return true;
}
export function validateSuite(tests) {
  if (!Array.isArray(tests)) fail("tests", "must be an array");
  const ids = new Set(); for (const test of tests) { validateTest(test); if (ids.has(test.id)) fail("tests", `duplicate id ${test.id}`); ids.add(test.id); }
  return true;
}
