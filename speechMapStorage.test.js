import test from "node:test";
import assert from "node:assert/strict";
import { loadTutorialProgress, saveTutorialProgress } from "./src/speech-map/storage.js";

function withLocalStorage(run) {
  const values = new Map();
  const previous = globalThis.localStorage;
  globalThis.localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
  try { run(values); }
  finally { globalThis.localStorage = previous; }
}

test("tutorial progress preserves the exact guided step and edited map", () => {
  withLocalStorage(() => {
    saveTutorialProgress({
      title: "Startup pitch",
      purpose: "Startup pitch",
      step: 3,
      nodeEdited: true,
      nodes: [{ id: "hook", position: { x: 10, y: 20 }, data: { title: "Opening promise", content: "Lead with the reason to listen.", type: "point" } }],
      edges: [],
      takes: [],
    });
    const restored = loadTutorialProgress();
    assert.equal(restored.step, 3);
    assert.equal(restored.nodeEdited, true);
    assert.equal(restored.purpose, "Startup pitch");
    assert.equal(restored.nodes[0].title, "Opening promise");
  });
});
