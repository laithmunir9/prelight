const NODE_TYPES = new Set(["point", "example", "evidence", "transition", "question", "closing"]);
const COVERAGE_STATUSES = new Set(["covered", "partial", "missed"]);

function cleanText(value, maxLength) {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, maxLength);
}

function isFinitePosition(position) {
  return position && Number.isFinite(position.x) && Number.isFinite(position.y);
}

export function validateSpeechGraph(value, { allowEmpty = false } = {}) {
  if (!value || !Array.isArray(value.nodes) || !Array.isArray(value.edges)) {
    throw new Error("Outline must contain nodes and edges arrays");
  }
  if ((!allowEmpty && !value.nodes.length) || value.nodes.length > 30) {
    throw new Error(allowEmpty ? "Outline cannot contain more than 30 nodes" : "Outline must contain between 1 and 30 nodes");
  }

  const ids = new Set();
  const nodes = value.nodes.map((node, index) => {
    const id = cleanText(node?.id || `idea-${index + 1}`, 64);
    const title = cleanText(node?.title, 80);
    const content = cleanText(node?.content, 320);
    const type = cleanText(node?.type || "point", 24).toLowerCase();
    if (!id || ids.has(id)) throw new Error("Every outline node needs a unique id");
    if (!title) throw new Error("Every outline node needs a title");
    if (!NODE_TYPES.has(type)) throw new Error(`Unsupported node type: ${type}`);
    ids.add(id);
    const fallbackColumn = index % 3;
    const fallbackRow = Math.floor(index / 3);
    const position = isFinitePosition(node?.position)
      ? { x: Math.round(node.position.x), y: Math.round(node.position.y) }
      : { x: 90 + fallbackColumn * 280, y: 80 + fallbackRow * 210 };
    return { id, title, content, type, position };
  });

  const edgeIds = new Set();
  const edges = value.edges.map((edge, index) => {
    const source = cleanText(edge?.source, 64);
    const target = cleanText(edge?.target, 64);
    const id = cleanText(edge?.id || `edge-${source}-${target}-${index + 1}`, 160);
    if (!source || !target || !ids.has(source) || !ids.has(target)) {
      throw new Error("Every edge must reference existing nodes");
    }
    if (source === target) throw new Error("A node cannot connect to itself");
    if (edgeIds.has(id)) throw new Error("Every edge needs a unique id");
    edgeIds.add(id);
    return { id, source, target };
  });

  return { nodes, edges };
}

export function validateCoverage(value, plannedNodes) {
  if (!value || !Array.isArray(value.nodes)) throw new Error("Coverage must contain a nodes array");
  const plannedIds = new Set((plannedNodes || []).map((node) => String(node.id)));
  if (!plannedIds.size) throw new Error("Coverage requires planned nodes");
  if (value.nodes.length !== plannedIds.size) throw new Error("Coverage must include every planned node exactly once");

  const seen = new Set();
  const nodes = value.nodes.map((node) => {
    const id = cleanText(node?.id, 64);
    const status = cleanText(node?.status, 16).toLowerCase();
    const evidence = node?.evidence == null ? null : cleanText(node.evidence, 280);
    if (!plannedIds.has(id) || seen.has(id)) throw new Error("Coverage contains an unknown or duplicate node id");
    if (!COVERAGE_STATUSES.has(status)) throw new Error(`Unsupported coverage status: ${status}`);
    if (status === "missed" && evidence) throw new Error("Missed nodes cannot include transcript evidence");
    seen.add(id);
    return { id, status, evidence: evidence || null };
  });
  return { nodes };
}

export function validateNodeEdit(value) {
  const title = cleanText(value?.title, 80);
  const content = cleanText(value?.content, 320);
  if (!title || !content) throw new Error("Node edit must include a title and content");
  return { title, content };
}

export const speechMapNodeTypes = [...NODE_TYPES];
