# Speech CI V0 technical validation

## Result

The engine does not pass the prototype gates. The deterministic primitives are exact on this corpus, but the frozen embedding runner has held-out overall F1 0.857 and regression accuracy 0.583. The held-out semantic signal is uneven: semantic presence F1 1.000 and semantic absence F1 1.000, but numeric evidence F1 0.000, concept coverage F1 0.000, and semantic order F1 0.667.

## Corpus and protocol

- 12 manually authored communication tasks: 3 startup pitches, 2 interview responses, 2 technical explanations, 2 persuasive speeches, and 3 academic/oral responses.
- 36 independent takes, with one frozen suite per task and 72 labeled test decisions.
- Tasks 1–8 were development; tasks 9–12 were held out.
- Ground truth was assigned before execution. Thresholds were not tuned per take or per example.
- Development-only sweep selected one shared semantic threshold of 0.50, then the threshold was frozen before the held-out run.
- GPT-5.5 did not participate in runner scoring.

## Metrics

The machine-readable source is `results.json`. It includes confusion counts, precision, recall, F1, engine evidence, false-positive/false-negative examples, and all 48 transition comparisons.

| Test type | Overall accuracy | Precision | Recall | F1 |
| --- | ---: | ---: | ---: | ---: |
| duration_max | 1.000 | 1.000 | 1.000 | 1.000 |
| semantic_presence | 0.833 | 1.000 | 0.800 | 0.889 |
| semantic_absence | 0.889 | 0.857 | 1.000 | 0.923 |
| semantic_order | 0.667 | 1.000 | 0.500 | 0.667 |
| numeric_evidence | 0.500 | 1.000 | 0.143 | 0.250 |
| phrase_count_max | 1.000 | 1.000 | 1.000 | 1.000 |
| filler_count_max | 1.000 | 1.000 | 1.000 | 1.000 |
| concept_coverage | 0.333 | 0.500 | 0.167 | 0.250 |

Development overall: accuracy 0.688, precision 0.909, recall 0.606, F1 0.727.

Held-out overall: accuracy 0.833, precision 1.000, recall 0.750, F1 0.857.

## Regression diff

Across Take 1 → Take 2 and Take 2 → Take 3, `compareRuns()` was checked against manually labeled fixed, regression, still_passing, and still_failing outcomes. Regression classification accuracy was 0.583; regression precision 1.000, recall 0.591, F1 0.743. The runner missed regressions when upstream semantic assertions failed to establish the prior pass, so this is a downstream symptom of semantic recall rather than a map/diff bookkeeping error.

## Important errors

The numeric evidence test correctly requires a nearby number, but it does not reliably establish semantic relationship. It missed relevant written-out quantities such as “thirty percent” and relevant numbers whose target claim had low similarity. This directly confirms the required counterexample: nearby numbers about launch timing or customer interviews must not automatically satisfy a time-saving claim.

Concept coverage inherited the weakness of independent cosine thresholds and also treated a negated counterexample such as “does not discuss when that data expires” as positive evidence. Semantic absence had one false positive for a guarantee claim because cosine similarity alone cannot understand negation.

The main architectural reason for failure is that cosine similarity over independently embedded chunks is a relatedness signal, not entailment, negation detection, or evidence attribution. A larger model does not remove that distinction. No LLM grader was added.

## Generator

GPT-5.5 was evaluated separately on all 12 task descriptions. Initial requests were rejected because the endpoint does not accept `temperature: 0`; after removing it and tightening the exact-output prompt, all 12 responses still failed strict Speech Test IR validation due malformed IDs or missing/type-invalid configuration fields. Generator validity rate: 0/12 (0%). This is not blended into runner accuracy.

## API usage and cost

The embedding run used 49 cached API calls and 1,048 input tokens, with `text-embedding-3-large`. At the currently documented $0.13 per million input tokens, the embedding portion is approximately $0.00014. The separate generator pass made 24 GPT-5.5 requests across two attempts; its exact cost is not reported by this harness because completion token usage was not persisted.

## Verification

The isolated Speech CI test suite passes 10/10. The CLI demo was also run successfully. The repository-wide existing test suite was attempted separately; its auth integration tests could not bind `127.0.0.1` in the restricted sandbox (`EPERM`), while the non-network tests passed. No production files were changed.
