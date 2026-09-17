import { validateSpeechGraph } from "../../speechMapCore.js";

const KEY = "prelightSpeechMap:v1";
const TUTORIAL_KEY = "prelightSpeechMapTutorial:v1";
const MAX_TAKES = 20;

function loadFromKey(key) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || "null");
    if (!parsed) return null;
    const graph = validateSpeechGraph(parsed, { allowEmpty: true });
    return {
      version: 1,
      title: String(parsed.title || "Untitled speech").slice(0, 100),
      purpose: String(parsed.purpose || "").slice(0, 400),
      nodes: graph.nodes.map((node) => {
        const stored = parsed.nodes.find((candidate) => candidate.id === node.id) || {};
        return { ...node, status: stored.status || null, evidence: stored.evidence || null };
      }),
      edges: graph.edges,
      takes: Array.isArray(parsed.takes) ? parsed.takes.slice(0, MAX_TAKES) : [],
      step: Math.min(4, Math.max(1, Number(parsed.step) || 1)),
      nodeEdited: parsed.nodeEdited === true,
    };
  } catch {
    return null;
  }
}

function saveToKey(key, { title, purpose, nodes, edges, takes, step, nodeEdited }) {
  const graph = validateSpeechGraph({
    nodes: nodes.map(({ id, position, data }) => ({ id, position, ...data })),
    edges: edges.map(({ id, source, target }) => ({ id, source, target })),
  }, { allowEmpty: true });
  const persistedNodes = graph.nodes.map((node) => {
    const current = nodes.find((candidate) => candidate.id === node.id)?.data || {};
    return { ...node, status: current.status || null, evidence: current.evidence || null };
  });
  localStorage.setItem(key, JSON.stringify({ version: 1, title, purpose, nodes: persistedNodes, edges: graph.edges, takes: takes.slice(0, MAX_TAKES), step, nodeEdited }));
}

export function loadWorkspace() { return loadFromKey(KEY); }

export function saveWorkspace(workspace) { saveToKey(KEY, workspace); }

export function loadTutorialProgress() { return loadFromKey(TUTORIAL_KEY); }

export function saveTutorialProgress(progress) { saveToKey(TUTORIAL_KEY, progress); }

export function clearWorkspace() {
  localStorage.removeItem(KEY);
}
