# Speech Diff V1.1 — development

Model: `text-embedding-3-large`

Grid SHA-256 (frozen before evaluation): `1716fb052c74c8ad63476ca0d09fd94e154fb286a5242f5a8fa6d4cfffb53e87`

Architecture: select split/merge structures first, rejecting a group that is more than half the existing group penalty weaker than its best singleton evidence; globally assign remaining individual segments by maximum semantic weight with Take-A match-margin filtering; retain a weighted relative-order LIS as ordinary relations and label remaining assigned inversions as `moved`. Structural relationships consume their segments before 1:1 matching.

Winning parameters: `{"global_match_min":0.5,"match_margin_min":0.06,"structural_min":0.75,"lexical_unchanged_min":0.55,"group_penalty":0.05,"gap_penalty":0.2,"semantic_unchanged_min":0.85,"maximum_group_size":3,"margin_axis":"take_a","weighted_lis_tie_break":"higher total semantic weight, then longer subsequence, then lexicographically smaller B-position sequence"}`

| Metric | Value |
| --- | ---: |
| Overall relationship F1 | 0.765625 |
| Overall macro F1 (supported) | 0.8655116050997058 |
| Difficult relationship F1 | 0.59375 |
| Difficult macro F1 (supported) | 0.7774936061381075 |

## Per-operation F1

| Operation | F1 |
| --- | ---: |
| unchanged | 0.8 |
| modified | 0.7368421052631579 |
| added | 1 |
| deleted | 1 |
| moved | 0.5217391304347826 |
| split | 1 |
| merged | 1 |

## V1.1 success conditions

| Check | Actual | Threshold | Result |
| --- | ---: | ---: | --- |
| moved_f1 | 0.5217391304347826 | 0.4 | PASS |
| deleted_f1 | 1 | 0 | PASS |
| split_f1 | 1 | 0.7 | PASS |
| merged_f1 | 1 | 0.6 | PASS |
| difficult_relationship_f1 | 0.59375 | 0.4126984126984127 | PASS |
| difficult_macro_f1_supported | 0.7774936061381075 | 0.5833333333333333 | PASS |
| overall_relationship_f1 | 0.765625 | 0.6 | PASS |

## Comparison

| Comparison | Overall relationship F1 Δ | Overall supported macro F1 Δ | Difficult relationship F1 Δ | Difficult supported macro F1 Δ |
| --- | ---: | ---: | ---: | ---: |
| Baseline V1 | 0.23621323529411764 | 0.46460657588673754 | 0.42708333333333337 | 0.6774936061381075 |
| Speech Diff V1 | 0.11483134920634919 | 0.31281909157487897 | 0.18105158730158732 | 0.19416027280477421 |

This runner made 0 embedding API calls and used 0 input tokens ($0 estimated). The complete fixed 16-configuration sweep and detailed error report are in `speech-diff-v1.1-dev.json`.
