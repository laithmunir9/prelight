# Prelight Speech CI

Unit tests and continuous integration for spoken communication.

The MVP pipeline is:

`speech/transcript → persistent test suite → executable assertions → run results → regression diff`

Each test is frozen in Speech Test IR v0 with a stable ID, type, name, configuration, boolean result, and structured evidence. The runner splits transcripts into stable sentence/utterance chunks. Semantic assertions embed the test concept and each chunk, calculate cosine similarity, and make the configured threshold decision. Embeddings use `text-embedding-3-large` and can be persisted in `data/embedding-cache.json`.

Supported types: `duration_max`, `semantic_presence`, `semantic_absence`, `semantic_order`, `numeric_evidence`, `phrase_count_max`, `filler_limit`, and `concept_coverage` (`ALL` or `AT_LEAST_N`). The model never evaluates takes. `compareRuns(previousRun, currentRun)` algorithmically reports fixed, regression, still-passing, still-failing, new, and removed tests.

`generator.js` optionally asks `gpt-5.5` to suggest only schema-validated executable tests once. It is not used by the runner.

## Run

From this directory:

```sh
npm test
npm run demo
```

The demo uses the root `.env` API key for live embeddings. Set `SPEECH_CI_OFFLINE=1` or omit the key to run the deterministic offline demo. The offline provider exists to make the executable demo and tests repeatable without network access; production-like runs should use the OpenAI provider.

Estimated live API cost for the two-take demo is typically a few cents or less, depending on transcript length and cache misses. The exact cost is not knowable without token usage returned by the API and the current embedding price.

Limitations: V0 uses transcript text rather than audio prosody; semantic thresholds need calibration; numeric evidence detection is intentionally conservative regex-based extraction; phrase counts are case-insensitive non-overlapping literal phrase counts; the optional generator requires an API key and a compatible `gpt-5.5` endpoint. No production UI, Supabase, Speech Diff, Speech Compiler, or LLM take grading is involved.
