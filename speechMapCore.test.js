import test from "node:test";
import assert from "node:assert/strict";
import { validateCoverage, validateNodeEdit, validateSpeechGraph } from "./speechMapCore.js";

const graph = {
  nodes: [
    { id: "hook", title: "Hook", content: "Open with the customer moment.", type: "point", position: { x: 10, y: 20 } },
    { id: "proof", title: "Proof", content: "Share the adoption number.", type: "evidence", position: { x: 290, y: 20 } },
  ],
  edges: [{ id: "hook-proof", source: "hook", target: "proof" }],
};

test("speech graph validation preserves a valid nonlinear graph", () => {
  assert.deepEqual(validateSpeechGraph(graph), graph);
});

test("blank graph is accepted only for local blank-workspace persistence", () => {
  assert.throws(() => validateSpeechGraph({ nodes: [], edges: [] }), /between 1 and 30/);
  assert.deepEqual(validateSpeechGraph({ nodes: [], edges: [] }, { allowEmpty: true }), { nodes: [], edges: [] });
});

test("malformed generated graphs are rejected before insertion", () => {
  assert.throws(() => validateSpeechGraph({ nodes: [{ ...graph.nodes[0], type: "argument" }], edges: [] }), /Unsupported node type/);
  assert.throws(() => validateSpeechGraph({ nodes: graph.nodes, edges: [{ id: "bad", source: "hook", target: "missing" }] }), /existing nodes/);
  assert.throws(() => validateSpeechGraph({ nodes: [graph.nodes[0], { ...graph.nodes[0] }], edges: [] }), /unique id/);
});

test("coverage parsing requires every planned node exactly once", () => {
  const result = validateCoverage({ nodes: [
    { id: "hook", status: "covered", evidence: "Our first customer told us" },
    { id: "proof", status: "missed", evidence: null },
  ] }, graph.nodes);
  assert.equal(result.nodes[0].status, "covered");
  assert.throws(() => validateCoverage({ nodes: [{ id: "hook", status: "covered", evidence: "x" }] }, graph.nodes), /every planned node/);
  assert.throws(() => validateCoverage({ nodes: [
    { id: "hook", status: "covered", evidence: "x" },
    { id: "proof", status: "missed", evidence: "not allowed" },
  ] }, graph.nodes), /cannot include/);
});

test("isolated node edits remain concise and structurally valid", () => {
  assert.deepEqual(validateNodeEdit({ title: "Clear problem", content: "Teams lose hours reviewing feedback manually." }), {
    title: "Clear problem",
    content: "Teams lose hours reviewing feedback manually.",
  });
  assert.throws(() => validateNodeEdit({ title: "", content: "Text" }), /title and content/);
});
