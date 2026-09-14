# Prelight Speech Diff evaluation infrastructure

This is an isolated research prototype for the hypothesis: **Speech Diff is Git diff for speech**. Two independently recorded versions of one spoken performance should be compared at the level of underlying ideas, including ideas that are unchanged, modified, added, deleted, moved, split, or merged.

## Scope and isolation

Only this directory is in scope. It has its own `package.json`, test command, JSON schema, fixtures, and source modules. The repository’s production package, server, UI, Supabase code, deployment files, and `team1_HIB_final.html` are not dependencies of this harness. The six fixtures are intentionally tiny; the real 20-pair evaluation set is not included and must be frozen before any full algorithm is implemented.

## Dataset

`schema.json` is the machine-readable contract. Each pair has ordered, manually segmented `take_a` and `take_b` arrays. Segment IDs are stable within a take. A relationship is `{ operation, take_a_segment_ids, take_b_segment_ids }`. One-to-one operations use one ID on each side; `added` is `0:1`; `deleted` is `1:0`; `split` is `1:N`; and `merged` is `N:1`. IDs are arrays so split/merge ground truth is explicit and extensible. There is no implicit matching based on array position.

The validator checks required shape, non-empty text, duplicate pair and segment IDs, unknown segment references, the seven-operation allowlist, repeated IDs inside relationships, and operation-specific cardinality.

## Evaluation

Relationships are scored by exact canonical tuple equality: operation plus the unordered set of A IDs and unordered set of B IDs. A and B are canonicalized independently and are never interchangeable. This gives relationship precision, recall, and F1. Operation metrics filter the same exact-match accounting by operation. Duplicate predicted canonical relationships are deterministically deduplicated before all counts and error reports. Reports retain false positives, false negatives, and endpoint-matching relationships with the wrong operation label, including pair and segment IDs.

`macro_f1_supported` is the unweighted mean of operation F1 values for only those operations with at least one ground-truth relationship in the evaluated subset. The optional `macro_operation_f1` remains the all-seven-operation mean. Empty subsets return `status: "no_data"` and null aggregate metrics.

`evaluateDataset` returns per-pair metrics plus aggregate sections for pairs 1–6 and the difficult benchmark (pairs 7–20). Since the real benchmark is not created yet, the latter is empty in the supplied fixtures rather than being fabricated.

## Deliberately naive baseline

`runNaiveBaseline` accepts an embedding provider and computes cosine similarity for every Take A/Take B candidate. Each A segment independently chooses its single most similar B segment; a configurable `minSimilarity` leaves low-scoring A segments deleted, and unchosen B segments are added. Exact normalized wording is labeled `unchanged`; other accepted matches are `modified`. It deliberately has no sequence alignment, global/bipartite matching, move reasoning, or split/merge reasoning. An embedding provider is injected so the evaluation harness stays deterministic and does not hide model or network dependencies.

## Tests and eventual kill criterion

Run `npm test` from this directory. The tests cover valid fixtures, every validator failure class, exact scoring, incorrect labels, aggregate reporting, cosine similarity, and baseline threshold/add/delete behavior.

Before building Speech Diff, freeze the 20-pair benchmark and its adjudicated relationships. The eventual prototype should be killed if it cannot beat this naive baseline by a pre-registered, practically meaningful margin on the difficult pairs—especially split, merge, move, and modified relationships—or if gains do not reproduce across independently recorded takes. The exact margin and confidence procedure should be agreed when the benchmark is frozen; this infrastructure intentionally does not invent that threshold.
