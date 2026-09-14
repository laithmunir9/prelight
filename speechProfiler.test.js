import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("./public/speechProfiler.js", import.meta.url), "utf8");
const context = { globalThis: {}, console };
vm.runInNewContext(source, context);
const profiler = context.globalThis.SpeechProfiler;

test("adaptive threshold and pause detection use the recording distribution", () => {
  const result = profiler.detectPauses([0.2, 0.22, 0.01, 0.01, 0.01, 0.01, 0.01, 0.2], 0.2);
  assert.ok(result.threshold > 0.01);
  assert.equal(result.pauses.length, 1);
  assert.equal(result.longPauseCount, 1);
});

test("pitch estimator reports voiced pitch for a clean sine wave", () => {
  const sampleRate = 16000;
  const samples = Float32Array.from({ length: sampleRate }, (_, i) => Math.sin(2 * Math.PI * 150 * i / sampleRate));
  const features = profiler.extractFeatures(samples, sampleRate);
  assert.ok(Math.abs(features.medianPitch - 150) < 8);
  assert.ok(features.voicedPercentage > 0.8);
});

test("DTW is near zero for identical traces and aligns a stretched copy", () => {
  const base = [[0], [1], [2], [3], [4]];
  const identical = profiler.dtw(base, base);
  assert.ok(identical.normalizedDistance < 1e-9);
  const stretched = [[0], [0], [1], [2], [3], [4], [4]];
  const aligned = profiler.dtw(base, stretched);
  assert.ok(aligned.normalizedDistance < 0.5);
  assert.equal(aligned.path[0][0], 0);
  assert.equal(aligned.path.at(-1)[0], 4);
});

test("feature extraction is local and returns immutable-ready take data", () => {
  const features = profiler.extractFeatures(new Float32Array(16000), 16000);
  const take = Object.freeze({ id: "take-1", features });
  assert.equal(take.id, "take-1");
  assert.equal(features.duration, 1);
  assert.ok(Array.isArray(features.energy));
});
