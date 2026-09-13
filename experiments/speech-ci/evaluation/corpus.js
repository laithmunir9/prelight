// Frozen, manually authored evaluation corpus. Do not tune against task ids 9-12.
const t = (id, category, suite, takes) => ({ id, category, suite, takes });
const test = (id, type, name, config) => ({ id, type, name, config: ["semantic_presence", "semantic_absence", "semantic_order", "numeric_evidence", "concept_coverage"].includes(type) ? { ...config, threshold: 0.50 } : config });
export const corpus = [
  t("task-01", "startup pitch", [test("problem", "semantic_presence", "Problem", { concept: "small teams lose time to manual customer research", threshold: .78 }), test("evidence", "numeric_evidence", "Evidence that the product saves time", { concept: "the product saves teams time", threshold: .78, window_chunks: 1 })], [
    { id: "t1-1", duration_seconds: 55, transcript: "Small teams spend whole afternoons sorting customer notes by hand. Our workspace turns those conversations into a searchable brief. In a pilot, teams reclaimed 6 hours each week.", expected: { problem: true, evidence: true } },
    { id: "t1-2", duration_seconds: 55, transcript: "Our workspace turns conversations into a searchable brief. We launched three months ago and have talked to 12 customers. The tool is simple to adopt.", expected: { problem: false, evidence: false } },
    { id: "t1-3", duration_seconds: 55, transcript: "Customer research is no longer an afternoon of filing notes. The workspace gives teams their time back, with a typical six-hour weekly saving.", expected: { problem: true, evidence: true } }
  ]),
  t("task-02", "startup pitch", [test("no_hype", "semantic_absence", "No unsupported hype", { concept: "the product guarantees perfect results", threshold: .82 }), test("story_order", "semantic_order", "Problem before solution", { before: "customer research is slow and manual", after: "the product automates customer research", threshold: .76 })], [
    { id: "t2-1", duration_seconds: 58, transcript: "Research teams still copy notes between five tools. Our assistant gathers the evidence into one brief. It does not promise perfect results; people review the work.", expected: { no_hype: true, story_order: true } },
    { id: "t2-2", duration_seconds: 58, transcript: "Our assistant gathers evidence into one brief and guarantees perfect results. Teams still copy notes between five tools.", expected: { no_hype: false, story_order: false } },
    { id: "t2-3", duration_seconds: 58, transcript: "Teams still copy notes between tools, so research is slow. The assistant gathers evidence into one brief and leaves the final call to people.", expected: { no_hype: true, story_order: true } }
  ]),
  t("task-03", "interview response", [test("ownership", "semantic_presence", "Ownership example", { concept: "I took responsibility and improved a difficult project", threshold: .78 }), test("fillers", "filler_limit", "Few fillers", { fillers: ["um", "uh", "like"], max_count: 1 })], [
    { id: "t3-1", duration_seconds: 80, transcript: "When the launch slipped, I owned the missed dependency. I rebuilt the checklist, paired with the engineer, and we shipped the following week.", expected: { ownership: true, fillers: true } },
    { id: "t3-2", duration_seconds: 80, transcript: "Um, I, like, helped with a difficult launch. Uh, the team fixed it and I was involved.", expected: { ownership: false, fillers: false } },
    { id: "t3-3", duration_seconds: 80, transcript: "The dependency was mine to resolve, so I rewrote the rollout plan and coached a teammate through the fix.", expected: { ownership: true, fillers: true } }
  ]),
  t("task-04", "technical explanation", [test("mechanism", "semantic_presence", "Mechanism explained", { concept: "a cache avoids repeated database work", threshold: .78 }), test("coverage", "concept_coverage", "All mechanisms covered", { concepts: ["cache avoids repeated database work", "expiration keeps cached data fresh"], mode: "ALL", threshold: .78 })], [
    { id: "t4-1", duration_seconds: 95, transcript: "The cache keeps a prior query result, so identical requests skip the database. After five minutes the entry expires and the next request refreshes it.", expected: { mechanism: true, coverage: true } },
    { id: "t4-2", duration_seconds: 95, transcript: "A cache makes requests faster by storing responses. It can serve old data, but this example does not discuss when that data expires.", expected: { mechanism: true, coverage: false } },
    { id: "t4-3", duration_seconds: 95, transcript: "Repeated reads are answered from memory rather than hitting storage again. A time-to-live then forces a fresh read.", expected: { mechanism: true, coverage: true } }
  ]),
  t("task-05", "persuasive speech", [test("impact_evidence", "numeric_evidence", "Evidence for impact", { concept: "the proposal reduces energy use", threshold: .78, window_chunks: 1 }), test("no_repetition", "phrase_count_max", "Avoid repeated phrase", { phrase: "we need", max_count: 1 })], [
    { id: "t5-1", duration_seconds: 70, transcript: "Retrofitting the lights cuts energy use by 28 percent in the first year. We need to fund the change this quarter.", expected: { impact_evidence: true, no_repetition: true } },
    { id: "t5-2", duration_seconds: 70, transcript: "The proposal saves energy. We need action now, and we need the council to approve it today. The number 28 is the agenda item, not an energy estimate.", expected: { impact_evidence: false, no_repetition: false } },
    { id: "t5-3", duration_seconds: 70, transcript: "Changing the lamps would lower the building's power demand by roughly thirty percent. Please authorize the retrofit this quarter.", expected: { impact_evidence: true, no_repetition: true } }
  ]),
  t("task-06", "academic/oral response", [test("sequence", "semantic_order", "Cause before consequence", { before: "industrialization increased urban migration", after: "cities faced overcrowding", threshold: .76 }), test("time", "duration_max", "Within two minutes", { max_seconds: 120 })], [
    { id: "t6-1", duration_seconds: 110, transcript: "Industrial factories drew workers into cities. That migration outpaced housing, and overcrowding followed.", expected: { sequence: true, time: true } },
    { id: "t6-2", duration_seconds: 110, transcript: "Overcrowding appeared in cities before I explain that factories later attracted rural workers.", expected: { sequence: false, time: true } },
    { id: "t6-3", duration_seconds: 135, transcript: "As factories expanded, rural workers moved toward industrial centers, creating dense neighborhoods with too few homes.", expected: { sequence: true, time: false } }
  ]),
  t("task-07", "interview response", [test("blame", "semantic_absence", "No blame shifting", { concept: "I blamed teammates for my mistake", threshold: .82 }), test("coverage", "concept_coverage", "Answer has action and result", { concepts: ["I changed my approach", "the outcome improved"], mode: "ALL", threshold: .76 })], [
    { id: "t7-1", duration_seconds: 75, transcript: "I misread the requirement. Rather than point at the brief, I changed my review process, and the next delivery passed acceptance.", expected: { blame: true, coverage: true } },
    { id: "t7-2", duration_seconds: 75, transcript: "The mistake happened because my teammates gave me the wrong information. I kept my process and the result was unchanged.", expected: { blame: false, coverage: false } },
    { id: "t7-3", duration_seconds: 75, transcript: "I owned the miss, added a preflight check, and our subsequent release cleared review without rework.", expected: { blame: true, coverage: true } }
  ]),
  t("task-08", "startup pitch", [test("traction", "numeric_evidence", "Traction with customers", { concept: "customers are actively using the product", threshold: .78, window_chunks: 1 }), test("order", "semantic_order", "Problem before product", { before: "teams cannot see why conversations fail", after: "Prelight tests each new spoken take", threshold: .76 })], [
    { id: "t8-1", duration_seconds: 59, transcript: "Teams cannot see why conversations fail until after the meeting. Prelight tests each new spoken take. Forty-two coaches now run those tests every week.", expected: { traction: true, order: true } },
    { id: "t8-2", duration_seconds: 59, transcript: "Prelight tests each spoken take, and the number 42 is our internal test suite version. Teams still cannot see why conversations fail.", expected: { traction: false, order: false } },
    { id: "t8-3", duration_seconds: 59, transcript: "Before the meeting, teams lack a reliable way to spot a weak explanation. The product reruns the same checks, and forty-two coaches use it weekly.", expected: { traction: true, order: true } }
  ]),
  t("task-09", "technical explanation", [test("isolation", "semantic_presence", "Isolation explained", { concept: "a container isolates an application from the host", threshold: .78 }), test("security_evidence", "numeric_evidence", "Evidence for isolation", { concept: "the container reduces attack surface", threshold: .78, window_chunks: 1 })], [
    { id: "t9-1", duration_seconds: 100, transcript: "A container packages the process with its dependencies while keeping it separate from the host. Dropping two unnecessary privileges reduces its attack surface.", expected: { isolation: true, security_evidence: true } },
    { id: "t9-2", duration_seconds: 100, transcript: "A container packages dependencies separately from the host. The host has 64 gigabytes of memory, but this does not describe a security reduction.", expected: { isolation: true, security_evidence: false } },
    { id: "t9-3", duration_seconds: 100, transcript: "The application runs in a compartment with its own filesystem view, limiting what it can reach on the machine. This narrows the exposed surface.", expected: { isolation: true, security_evidence: false } }
  ]),
  t("task-10", "persuasive speech", [test("counterexample", "semantic_absence", "Do not claim the policy solves every problem", { concept: "the policy solves every problem", threshold: .82 }), test("fillers", "filler_limit", "No verbal clutter", { fillers: ["um", "uh", "basically"], max_count: 1 })], [
    { id: "t10-1", duration_seconds: 65, transcript: "This policy addresses one source of waste, not every problem. It gives teams a practical first step. Basically, that is why I support it.", expected: { counterexample: true, fillers: true } },
    { id: "t10-2", duration_seconds: 65, transcript: "Um, the policy solves every problem, uh, and basically guarantees a perfect outcome.", expected: { counterexample: false, fillers: false } },
    { id: "t10-3", duration_seconds: 65, transcript: "No single rule can fix the whole system, but this one removes a measurable bottleneck. I support adopting it.", expected: { counterexample: true, fillers: true } }
  ]),
  t("task-11", "academic/oral response", [test("thesis", "concept_coverage", "Thesis and limitation", { concepts: ["the evidence supports the thesis", "the evidence has a limitation"], mode: "ALL", threshold: .76 }), test("time", "duration_max", "Within ninety seconds", { max_seconds: 90 })], [
    { id: "t11-1", duration_seconds: 85, transcript: "The survey supports the thesis that access improved outcomes. Its limitation is that the sample came from one district.", expected: { thesis: true, time: true } },
    { id: "t11-2", duration_seconds: 85, transcript: "The sample came from one district, so the evidence has a limitation. I have not established whether it supports the larger thesis.", expected: { thesis: false, time: true } },
    { id: "t11-3", duration_seconds: 95, transcript: "Results align with the claim, although the single-district sample limits generalization. That caveat matters when interpreting the evidence.", expected: { thesis: true, time: false } }
  ]),
  t("task-12", "startup pitch", [test("sequence", "semantic_order", "Pain before differentiation", { before: "general-purpose assistants miss speech-specific requirements", after: "Prelight stores and reruns speech tests", threshold: .76 }), test("phrase", "phrase_count_max", "Say the product name once", { phrase: "Prelight", max_count: 1 })], [
    { id: "t12-1", duration_seconds: 57, transcript: "General-purpose assistants miss speech-specific requirements. Prelight stores the tests and reruns them on every take.", expected: { sequence: true, phrase: true } },
    { id: "t12-2", duration_seconds: 57, transcript: "Prelight stores the tests. Prelight reruns them after every take, but general-purpose assistants miss speech-specific requirements.", expected: { sequence: false, phrase: false } },
    { id: "t12-3", duration_seconds: 57, transcript: "Speech-specific requirements are often missed by general assistants; our test runner stores them and checks each revision.", expected: { sequence: true, phrase: true } }
  ])
];
