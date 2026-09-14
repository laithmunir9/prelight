# Speech Diff V1 — development

Model: `text-embedding-3-large`

Grid SHA-256: `c5acdd8f9e3c22171b64955479fedca9698352abfc53e18950e20c82e75572ed`

Architecture: monotonic dynamic programming over 1:1, 1:2, 1:3, 2:1, 3:1, and gap transitions, followed by exact branch-and-bound residual set packing for non-overlapping moves, splits, and merges.

Winning parameters: `{"match_min":0.4,"structural_min":0.75,"move_min":0.7,"lexical_unchanged_min":0.55,"group_penalty":0.05,"gap_penalty":0.2,"semantic_unchanged_min":0.85,"maximum_group_size":3,"residual_structural_precedence_bonus":0.001}`

| Metric | Value |
| --- | ---: |
| Overall relationship F1 | 0.6507936507936508 |
| Overall macro F1 (supported) | 0.5526925135248268 |
| Difficult relationship F1 | 0.4126984126984127 |
| Difficult macro F1 (supported) | 0.5833333333333333 |

## Per-operation F1

| Operation | F1 |
| --- | ---: |
| unchanged | 0.7906976744186046 |
| modified | 0.6842105263157895 |
| added | 0.6666666666666666 |
| deleted | 0 |
| moved | 0.1111111111111111 |
| split | 0.8888888888888888 |
| merged | 0.7272727272727273 |

## Development gate

| Check | Actual | Threshold | Result |
| --- | ---: | ---: | --- |
| overall_relationship_f1 | 0.6507936507936508 | 0.5294 | PASS |
| overall_macro_f1_supported | 0.5526925135248268 | 0.5009 | PASS |
| difficult_relationship_f1 | 0.4126984126984127 | 0.2667 | PASS |
| difficult_macro_f1_supported | 0.5833333333333333 | 0.2 | PASS |
| structural_nonzero_f1 | 3 | 2 | PASS |

Embedding population used 2 API calls and 7408 input tokens; estimated cost was $0.0009630400000000001.

Compared with Baseline V1, overall relationship F1 changed by 0.12138188608776845 and supported macro F1 changed by 0.15178748431185857.

Development gate: **PASS**. Full sweep, errors, predicted operation counts, and usage are in `speech-diff-v1-dev.json`.
