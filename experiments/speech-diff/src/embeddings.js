import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const hashText = (text) => createHash("sha256").update(text, "utf8").digest("hex");

export async function loadLocalEnvironment(path) {
  if (!existsSync(path)) return;
  for (const line of (await readFile(path, "utf8")).split("\n")) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
}

export async function loadOrCreateEmbeddingCache({ texts, cachePath, model, apiKey, baseUrl }) {
  const cache = existsSync(cachePath) ? JSON.parse(await readFile(cachePath, "utf8")) : { model, vectors: {}, api_calls: 0, usage: { prompt_tokens: 0, total_tokens: 0 } };
  if (cache.model !== model) throw new Error(`embedding cache model mismatch: ${cache.model}`);
  const unique = [...new Set(texts)];
  const missing = unique.filter((text) => !cache.vectors[hashText(text)]);
  for (let start = 0; start < missing.length; start += 100) {
    const input = missing.slice(start, start + 100);
    const response = await fetch(`${baseUrl}/embeddings`, { method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ model, input, encoding_format: "float" }) });
    if (!response.ok) throw new Error(`Embedding request failed: ${(await response.text()).slice(0, 400)}`);
    const payload = await response.json();
    for (const item of payload.data) cache.vectors[hashText(input[item.index])] = item.embedding;
    cache.api_calls += 1;
    cache.usage.prompt_tokens += payload.usage?.prompt_tokens ?? 0;
    cache.usage.total_tokens += payload.usage?.total_tokens ?? 0;
    await mkdir(new URL(".", `file://${cachePath}`).pathname, { recursive: true });
    await writeFile(cachePath, JSON.stringify(cache));
  }
  return { vectors: Object.fromEntries(unique.map((text) => [text, cache.vectors[hashText(text)]])), cache: { api_calls: cache.api_calls, usage: cache.usage, newly_embedded_texts: missing.length } };
}
