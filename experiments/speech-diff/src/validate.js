export const OPERATIONS = new Set(["unchanged", "modified", "added", "deleted", "moved", "split", "merged"]);

const fail = (path, message) => ({ path, message });

export function validateDataset(dataset) {
  const errors = [];
  if (!dataset || typeof dataset !== "object" || Array.isArray(dataset)) return [fail("$", "dataset must be an object")];
  if (dataset.schema_version !== "speech-diff/v1") errors.push(fail("schema_version", "must be speech-diff/v1"));
  if (!Array.isArray(dataset.pairs) || dataset.pairs.length === 0) return [...errors, fail("pairs", "must be a non-empty array")];
  const pairIds = new Set();
  for (const [index, pair] of dataset.pairs.entries()) {
    const path = `pairs[${index}]`;
    if (!pair || typeof pair !== "object") { errors.push(fail(path, "must be an object")); continue; }
    if (typeof pair.pair_id !== "string" || !pair.pair_id) errors.push(fail(`${path}.pair_id`, "must be a non-empty string"));
    else if (pairIds.has(pair.pair_id)) errors.push(fail(`${path}.pair_id`, "duplicate pair ID"));
    else pairIds.add(pair.pair_id);
    const ids = { take_a: new Set(), take_b: new Set() };
    for (const takeName of ["take_a", "take_b"]) {
      const segments = pair[takeName]?.segments;
      if (!Array.isArray(segments)) { errors.push(fail(`${path}.${takeName}.segments`, "must be an array")); continue; }
      for (const [si, segment] of segments.entries()) {
        const sp = `${path}.${takeName}.segments[${si}]`;
        if (!segment || typeof segment.segment_id !== "string" || !segment.segment_id) errors.push(fail(sp, "requires segment_id"));
        else if (ids[takeName].has(segment.segment_id)) errors.push(fail(`${sp}.segment_id`, "duplicate segment ID within take"));
        else ids[takeName].add(segment.segment_id);
        if (typeof segment.text !== "string" || !segment.text.trim()) errors.push(fail(`${sp}.text`, "must be non-empty text"));
      }
    }
    if (!Array.isArray(pair.relationships)) { errors.push(fail(`${path}.relationships`, "must be an array")); continue; }
    for (const [ri, rel] of pair.relationships.entries()) {
      const rp = `${path}.relationships[${ri}]`;
      if (!rel || !OPERATIONS.has(rel.operation)) { errors.push(fail(`${rp}.operation`, "invalid operation")); continue; }
      const a = rel.take_a_segment_ids, b = rel.take_b_segment_ids;
      if (!Array.isArray(a) || !Array.isArray(b)) { errors.push(fail(rp, "relationship IDs must be arrays")); continue; }
      if (new Set(a).size !== a.length || new Set(b).size !== b.length) errors.push(fail(rp, "relationship IDs may not repeat"));
      for (const id of a) if (!ids.take_a.has(id)) errors.push(fail(`${rp}.take_a_segment_ids`, `nonexistent segment reference: ${id}`));
      for (const id of b) if (!ids.take_b.has(id)) errors.push(fail(`${rp}.take_b_segment_ids`, `nonexistent segment reference: ${id}`));
      const shape = `${a.length}:${b.length}`;
      const validShape = (rel.operation === "added" && shape === "0:1") || (rel.operation === "deleted" && shape === "1:0") ||
        (rel.operation === "split" && a.length === 1 && b.length > 1) || (rel.operation === "merged" && a.length > 1 && b.length === 1) ||
        (["unchanged", "modified", "moved"].includes(rel.operation) && shape === "1:1");
      if (!validShape) errors.push(fail(rp, `invalid ${rel.operation} relationship shape ${shape}`));
    }
  }
  return errors;
}

export function assertValidDataset(dataset) {
  const errors = validateDataset(dataset);
  if (errors.length) throw new Error(errors.map((e) => `${e.path}: ${e.message}`).join("\n"));
  return dataset;
}
