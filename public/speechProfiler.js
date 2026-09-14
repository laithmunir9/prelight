(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.SpeechProfiler = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  const FRAME = 0.02;
  const LONG_PAUSE = 0.75;

  function mean(values) { return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0; }
  function variance(values) { const m = mean(values); return values.length ? mean(values.map((v) => (v - m) ** 2)) : 0; }
  function median(values) { if (!values.length) return 0; const s = [...values].sort((a, b) => a - b); const mid = Math.floor(s.length / 2); return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2; }
  function adaptiveThreshold(energy) {
    const sorted = [...energy].sort((a, b) => a - b);
    const q = (p) => sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))] || 0;
    return Math.max(q(0.18) * 1.55, q(0.5) * 0.22, 0.0001);
  }
  function rangesFromState(state, threshold, frameDuration = FRAME) {
    const ranges = []; let start = null;
    state.forEach((isSilent, i) => {
      if (isSilent && start == null) start = i * frameDuration;
      if (!isSilent && start != null) { ranges.push({ start, end: i * frameDuration, duration: i * frameDuration - start }); start = null; }
    });
    if (start != null) { const end = state.length * frameDuration; ranges.push({ start, end, duration: end - start }); }
    return ranges.filter((r) => r.duration >= frameDuration * 0.5).map((r) => ({ ...r, long: r.duration >= LONG_PAUSE, threshold }));
  }
  function detectPauses(energy, frameDuration = FRAME) {
    const threshold = adaptiveThreshold(energy);
    const pauses = rangesFromState(energy.map((v) => v <= threshold), threshold, frameDuration);
    const duration = energy.length * frameDuration;
    return { threshold, pauses, duration, silenceRatio: duration ? pauses.reduce((s, p) => s + p.duration, 0) / duration : 0, longPauseCount: pauses.filter((p) => p.long).length };
  }
  function autocorrelationPitch(frame, sampleRate, minHz = 70, maxHz = 340) {
    const minLag = Math.floor(sampleRate / maxHz), maxLag = Math.min(Math.floor(sampleRate / minHz), frame.length - 1);
    const scores = []; let bestLag = -1, best = 0;
    for (let lag = minLag; lag <= maxLag; lag++) { let sum = 0, energy = 0; for (let i = 0; i < frame.length - lag; i++) { sum += frame[i] * frame[i + lag]; energy += frame[i] * frame[i]; } const score = energy ? sum / energy : 0; scores.push(score); }
    const firstPeak = scores.findIndex((score, i) => score > 0.45 && score >= (scores[i - 1] ?? -1) && score >= (scores[i + 1] ?? -1));
    if (firstPeak >= 0) { bestLag = minLag + firstPeak; best = scores[firstPeak]; }
    else { best = Math.max(...scores); bestLag = minLag + scores.indexOf(best); }
    return best > 0.35 && bestLag > 0 ? sampleRate / bestLag : 0;
  }
  function extractFeatures(samples, sampleRate, options = {}) {
    const frameSize = Math.max(128, Math.floor((options.frameMs || 20) / 1000 * sampleRate));
    const energy = [], pitch = [], voiced = [];
    for (let start = 0; start < samples.length; start += frameSize) {
      const frame = samples.slice(start, start + frameSize); if (!frame.length) continue;
      const rms = Math.sqrt(mean(frame.map((v) => v * v))); energy.push(rms);
      const p = autocorrelationPitch(frame, sampleRate); pitch.push(p); voiced.push(p > 0);
    }
    const pauses = detectPauses(energy, frameSize / sampleRate);
    const voicedPitch = pitch.filter(Boolean); const voicedCount = voiced.filter(Boolean).length;
    return { frameDuration: frameSize / sampleRate, energy, pitch, voiced, pauses: pauses.pauses, pauseThreshold: pauses.threshold, duration: samples.length / sampleRate, silenceRatio: pauses.silenceRatio, longPauseCount: pauses.longPauseCount, energyMean: mean(energy), energyVariance: variance(energy), medianPitch: median(voicedPitch), pitchVariability: Math.sqrt(variance(voicedPitch)), voicedPercentage: energy.length ? voicedCount / energy.length : 0 };
  }
  function normalizeTrace(features) { return features.energy.map((energy, i) => [energy / Math.max(features.energyMean || 1, 0.0001), features.voiced[i] ? 1 : 0, features.pitch[i] ? Math.log(features.pitch[i] / 100) : 0]); }
  function dtw(a, b, distance = (x, y) => Math.sqrt(x.reduce((s, v, i) => s + (v - y[i]) ** 2, 0))) {
    const rows = a.length, cols = b.length, cost = Array.from({ length: rows + 1 }, () => Array(cols + 1).fill(Infinity)); cost[0][0] = 0;
    for (let i = 1; i <= rows; i++) for (let j = 1; j <= cols; j++) cost[i][j] = distance(a[i - 1], b[j - 1]) + Math.min(cost[i - 1][j], cost[i][j - 1], cost[i - 1][j - 1]);
    const path = []; let i = rows, j = cols;
    while (i || j) { path.push([Math.max(0, i - 1), Math.max(0, j - 1)]); if (!i) j--; else if (!j) i--; else { const choices = [[cost[i - 1][j - 1], i - 1, j - 1], [cost[i - 1][j], i - 1, j], [cost[i][j - 1], i, j - 1]]; choices.sort((x, y) => x[0] - y[0]); [, i, j] = choices[0]; } }
    path.reverse(); const normalizedDistance = cost[rows][cols] / Math.max(1, path.length);
    const differences = path.map(([x, y]) => ({ a: x, b: y, difference: distance(a[x], b[y]) })).sort((x, y) => y.difference - x.difference);
    return { path, normalizedDistance, alignedTimeMapping: path.map(([x, y]) => ({ a: x, b: y })), regions: differences.slice(0, Math.max(1, Math.floor(path.length * 0.08))) };
  }
  function compareTakes(one, two) { return { ...dtw(normalizeTrace(one.features || one), normalizeTrace(two.features || two)), from: one.id, to: two.id }; }
  return { FRAME, LONG_PAUSE, mean, variance, median, adaptiveThreshold, detectPauses, extractFeatures, normalizeTrace, dtw, compareTakes };
});
