import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const hash = (text) => createHash("sha256").update(text).digest("hex");
export function loadDotEnv(path) {
  if (!existsSync(path)) return;
  for (const line of requireLines(path)) { const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, ""); }
}
function requireLines(path) { return readFileSync(path, "utf8").split("\n"); }
export class OpenAIEmbedder {
  constructor({ apiKey = process.env.OPENAI_API_KEY, baseUrl = "https://api.openai.com/v1", cachePath }) { this.apiKey = apiKey; this.baseUrl = baseUrl; this.cachePath = cachePath; this.model = "text-embedding-3-large"; }
  async embed(texts) {
    if (!this.apiKey) throw new Error("OPENAI_API_KEY is required for live embeddings");
    const cache = this.cachePath && existsSync(this.cachePath) ? JSON.parse(await readFile(this.cachePath, "utf8")) : { model: this.model, vectors: {}, api_calls: 0, usage: { prompt_tokens: 0, total_tokens: 0 } };
    if (cache.model !== this.model) throw new Error(`Embedding cache model mismatch: ${cache.model}`);
    const unique = [...new Set(texts)]; const missing = unique.filter((text) => !cache.vectors[hash(text)]);
    for (let i = 0; i < missing.length; i += 100) {
      const input = missing.slice(i, i + 100); const response = await fetch(`${this.baseUrl}/embeddings`, { method: "POST", headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: this.model, input, encoding_format: "float" }) });
      if (!response.ok) throw new Error(`Embedding request failed: ${(await response.text()).slice(0, 300)}`);
      const payload = await response.json(); for (const item of payload.data) cache.vectors[hash(input[item.index])] = item.embedding;
      cache.api_calls += 1; cache.usage.prompt_tokens += payload.usage?.prompt_tokens ?? 0; cache.usage.total_tokens += payload.usage?.total_tokens ?? 0;
    }
    if (this.cachePath && missing.length) { await mkdir(new URL(".", `file://${this.cachePath}`).pathname, { recursive: true }); await writeFile(this.cachePath, JSON.stringify(cache, null, 2)); }
    return Object.fromEntries(unique.map((text) => [text, cache.vectors[hash(text)]]));
  }
}
export function deterministicEmbedder() {
  const aliases = [["traction", "users", "revenue", "growth", "customers", "percent", "pilot"], ["differentiation", "chatgpt", "llm", "general-purpose", "specialized"], ["problem", "teams", "waste", "hours", "manual"], ["solution", "prelight", "coach", "tests"]];
  return async (texts) => Object.fromEntries(texts.map((text) => { const lower = text.toLowerCase(); const v = aliases.map((group) => group.some((word) => lower.includes(word)) ? 1 : 0); return [text, [...v, ...Array(4).fill(0)]]; }));
}
export function cosine(a, b) { const dot = a.reduce((s, x, i) => s + x * b[i], 0); const na = Math.sqrt(a.reduce((s, x) => s + x * x, 0)); const nb = Math.sqrt(b.reduce((s, x) => s + x * x, 0)); return na && nb ? dot / (na * nb) : 0; }
