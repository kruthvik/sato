# Learning evidence for an adaptive engine: goals, boundaries, and testable rules

**Evidence status: bounded synthesis of available project files.** This report integrates the seven available reviews (02–08) and synthesis 15. The requested `outputs/learning-science-draft.md` and `outputs/learning-science-review.md` were absent when checked, so this is a newly compiled, source-traced report—not a line-by-line correction of an unavailable draft or an application of unseen reviewer comments. Synthesis 16 and biomedical review 17 were also absent and are not treated as sources. Reviews 01 and 09–12 and syntheses 13–14 remain missing; no conclusions are attributed to them.

## Executive summary

An adaptive engine should not optimize a single “learning” score. Acquisition, conceptual understanding, retrieval accessibility, durable retention, transfer, and preparation for an imminent test are different objectives, measured by different tests and time horizons. Practice accuracy, confidence, latency, model fit, or engagement are useful observations, not proof of durable learning. The available reviews report that retrieval practice and spacing benefit many delayed-recall tasks, while also documenting task- and outcome-specific limits [R02–R03; S15].

Instructional choices should respond to topic knowledge and the requested outcome. Worked examples often help novices with complex problems; too much guidance can become redundant for knowledgeable learners, although expertise reversal is not universal. Interleaving can help learners select among similar problem types, but its benefit depends on the outcome: some classroom studies find better delayed performance, while one physics course showed no significant subsequent midterm difference despite an advantage on surprise novel-problem tests; blocked practice can be better for other outcomes. Explanations, productive failure, feedback, and comparison are distinct treatments; activity labels do not prove transfer [R04–R06; R08; S15].

**Policy conclusion:** start with a transparent fixed policy. Add adaptation only when a rule beats that baseline under equal content, dose, feedback, and time on delayed behavioral tests. For sparse one-learner histories, maintain uncertainty, avoid early over-personalization, and call the internal memory estimate a prediction—not a direct measurement of storage or knowledge. These are engineering recommendations, not demonstrated outcomes of a validated all-purpose adaptive engine [S15].

## Evidence base and confidence

Inputs read: [`02 Retrieval`](evidence/02-retrieval.md), [`03 Spacing`](evidence/03-spacing.md), [`04 Understanding`](evidence/04-understanding.md), [`05 Practice structure`](evidence/05-practice-structure.md), [`06 Feedback and errors`](evidence/06-feedback-errors.md), [`07 Metacognition`](evidence/07-metacognition.md), [`08 Transfer`](evidence/08-transfer.md), and [`15 Evidence gaps`](synthesis/15-evidence-gaps.md). Each local review includes a source trail and labels some evidence as abstract/index-only. This synthesis inherits those access limits; it does not independently reanalyze meta-analyses, study overlap, publication bias, or risk of bias.

Confidence labels below are qualitative scope judgments, not formal GRADE scores:
- **Moderate-high/bounded:** behavioral direction supported by a synthesis or multiple studies in a specified task family; generalization remains limited.
- **Moderate:** useful evidence with heterogeneity, incomplete source diagnostics, or limited population/domain scope.
- **Low/unknown:** single or narrow studies, inaccessible evidence, sparse data, or an engineering proposal without a causal test.

### Keep the goals separate

| Goal | What the engine is trying to improve | Suitable evidence/test | Common proxy trap |
|---|---|---|---|
| Acquisition | Initial encoding or first successful performance | First independent response after instruction; scored by accuracy and reasoning | A correct answer while viewing an example is not independent learning. |
| Conceptual understanding | Explain a principle, distinguish cases, predict consequences | Explanation scored against a rubric; conceptual questions that are not copies of teaching examples | Procedural accuracy alone does not establish understanding. |
| Retrieval accessibility | Produce a learned answer when cued, without seeing it | Closed-book/cue-based retrieval; record accuracy, cue level, and latency | Recognition, familiarity, or confidence can overstate unaided access. |
| Durable retention | Retain/use learned material after a prespecified interval | No-feedback delayed test at the target retention interval | Immediate practice accuracy and fitted forgetting curves are not retention outcomes. |
| Transfer | Apply learning to unpracticed items, changed representations, or contexts | New, independently authored tasks; record what changed and whether hints were supplied | A changed surface story or test format is not automatically far transfer. |
| Rapid preparation | Perform on a near-term, specified assessment | Test-matched outcome at that stated short horizon, plus a later check if durability matters | A strategy maximizing a weeks-later outcome may not maximize a test minutes later. |

Transfer is especially easy to overstate: test format, cues, domain, context, delay, and whether the principle is supplied all matter. Report those differences rather than relying only on “near/far” labels [R08; S15].

## What the available evidence supports

### Retrieval, feedback, and study choice

Across laboratory and classroom evidence, retrieval practice often improves delayed retention over restudy, even when restudy yields better immediate performance in some paradigms. The result is not a universal gain on every outcome. Initial success, retrieval format, test match, feedback, and delay matter; classroom meta-analytic averages combine different interventions and outcomes [R02].

A critical boundary is failed retrieval. In five adult word-pair experiments with low initial success and no feedback, standard retrieval did not beat restudy, while diminishing-cue retrieval did; feedback/higher-success conditions differed. The less-than-50% threshold was a condition in those experiments, not a general learner cutoff [Fiechter & Benjamin 2017; R02; S15]. A separate Chinese grade-10 carbon-cycle RCT reported a one-week advantage on some factual/total scores but not application questions. It is evidence about those tasks and that sample, not broad conceptual transfer [Wang et al. 2023; R02; S15].

Feedback is not one variable. Corrective information is a prudent safeguard after errors, and explanations/refutations can help when the goal is conceptual repair; timing results conflict across task families. Some retrieval studies favor delayed feedback, while other testing and classroom comparisons favor immediate feedback. There is no justified universal feedback timer. A delayed correction that the learner never processes cannot repair an error [R06; S15].

Metacognitive judgments also differ from learning. Delayed judgments can improve relative accuracy in paired-associate tasks, but confidence is not calibration, and a judgment is not equivalent to an overt retrieval attempt. In controlled word-pair studies, learners sometimes stopped after one successful recall and retained less than with repeated retrieval; other choice experiments show learners may test themselves to diagnose rather than to maximize later retention [R07]. Log confidence and choice as predictors, not as mastery labels.

**Confidence:** moderate-high for delayed retrieval benefits in many tested retention paradigms; moderate for classroom average benefit; lower for conceptual/far transfer, sparse learner-specific policies, and universal feedback timing [R02, R06–R07].

### Spacing and forgetting

Distributed practice generally supports later verbal recall. The useful interstudy interval depends on the target retention interval; evidence does not justify one universal gap or the rule that longer spacing is always better [Cepeda et al. 2006, 2008; R03]. Schedule-shape comparisons do not establish a universal expanding-schedule advantage. A randomized university computer-tutorial study of 235 learners found no significant spacing effect on a permutation procedure at one- and five-week tests; across nine introductory STEM courses, classroom results varied and the pooled effect was not significant without calculus [Ebersbach & Barzagar Nazari 2020; Bego et al. 2024; R03; S15].

Adaptive scheduling evidence is much thinner than evidence for spacing itself. Narrow adaptive-schedule experiments favored adaptive over fixed schedules on one-week country-name/location tests, but broader claims are limited by task, study program, and source access. Response-derived app endpoints or prediction accuracy do not establish that the schedule caused better delayed learning [R03; S15]. The partial audit did not find a complete, fair comparison of broad algorithm families against simple policies on delayed understanding and transfer.

**Confidence:** high for a positive direction in many verbal-recall settings; moderate for classroom generality; lower for procedures and any specific individual-level spacing algorithm [R03; S15].

### Explanation, examples, and guided practice

Worked examples and guidance are most defensible for novices facing complex, unfamiliar tasks. Meta-analytic evidence summarized in R04 reports an assistance-by-prior-knowledge interaction, but source diagnostics and transfer outcomes are not fully rechecked. The interaction is task-specific, not a license to assign one global “novice/expert” label. A separate electrical-troubleshooting study reported a one-week null for testing after worked examples versus restudy in one experiment, a boundary against assuming that adding a test always helps [R04; Van Gog et al. 2015; S15].

Self-explanation can help, but prompt quality, learner knowledge, task, and outcome matter; adding generic prompts to every example is not established. Productive failure means a structured attempt followed by instruction/consolidation, not unsupported discovery. A Swiss sixth-grade algebra experiment found a one-week procedural benefit, but conceptual explanation and transfer were nonsignificant; broader meta-analytic support is conditional on implementations that include subsequent instruction [R04; Ziegler et al. 2021; Sinha & Kapur 2021; S15].

**Confidence:** moderate for examples/guidance interactions in studied tasks and structured productive-failure outcomes; low for universal thresholds, unsupported discovery, or broad transfer [R04; S15].

### Blocked, mixed, and variable practice

Interleaving can improve discrimination or method selection in some tasks, but it can lower practice accuracy and is not universally better. In one undergraduate physics course, blocked homework scores were higher, while interleaving improved surprise tests of novel problems more than a week later (d=.40 and .91). The subsequent high-stakes midterms, about three days after those tests, did not significantly differ between conditions (Stage 1 d=.20, 95% CI [−.04,.43], p=.094; Stage 2 d=.02, 95% CI [−.21,.25], p=.876). The authors treated the surprise tests as primary, noting that cramming and the criterial tests themselves could affect midterm performance; an exam benefit was not established [Samani & Pan 2021; S15].

A grade 5–6 fractions in-vivo randomized tutoring experiment sequenced three **graphical representations** (pie charts, number lines, sets), not different problem types. Its four schedules were blocked, moderate (switch after every third problem), interleaved (switch after every problem), and “increased” (block length gradually shortened from 12 problems to one). The paper’s abstract says 296 students; its Methods/Results report 269 participating/randomized and 215 analyzed, a discrepancy the paper does not resolve. Students received about five hours of tutoring across five to six days; tests were immediate and seven days later. At the delayed test, blocked and increased schedules outperformed moderate and interleaved schedules on representational knowledge. Overall post-hoc operational-knowledge contrasts were not significant; however, exploratory median-split subgroup analyses found that, for students with low prior knowledge, the increased schedule exceeded blocked practice at both posttests and exceeded moderate and interleaved practice on delayed operational knowledge. No further operational subgroup differences were significant. This is a task-specific result from one ITS study in which students encountered one representation at a time, not general evidence that blocking problem types is superior [Rau et al. 2010; R05; S15]. An abstract-only Indian adolescent L2 report found no post-test difference and no separate delayed follow-up [Doley & Kakoti 2024; S15]. These contrasts show why the target outcome and the thing being mixed must be stated.

Do not transfer motor contextual-interference estimates directly to academic practice. Likewise, blocked introduction can be useful while a skill is new; whether/when to mix is an outcome-specific policy question rather than a universal “block first, then interleave” law [R05].

**Confidence:** moderate for conditional interleaving effects in some math/inductive tasks; low for a universal sequence or cross-domain policy [R05; S15].

### Transfer and portability

Transfer must be operationalized. Retrieval meta-analysis reports positive average transfer across heterogeneous tests, including test-format changes, related cues, application, and problem solving; this does not establish automatic far transfer across domains. Case comparison has a positive average result, but a far-transfer estimate in the review is conditional on supplying a principle after comparison—not an unconditional effect of “more examples” [Pan & Rickard 2018; Alfieri et al. 2013; R08; S15].

Explicitly compare cases and name the shared relation when abstraction is the target, then test an unpracticed task without supplying the principle. Field evidence on arithmetic portability found different performance patterns for market-working children and school peers across familiar transactions and abstract school formats; it is observational and does not identify a single causal mechanism [Banerjee et al. 2025; R08; S15]. A classification study with six undergraduate experiments did not show reliable transfer gains from classification over observation, while explanation feedback often helped, another warning against inferring transfer from an activity label [Corral et al. 2024; R08; S15].

**Confidence:** moderate for selected near/format transfer; low for broad, spontaneous, cross-domain transfer [R08; S15].

### Age and population limits

The available evidence includes adult laboratory studies, school-aged samples, university courses, and some adolescent classroom reports, but the samples are narrow and uneven. Examples include adult word-pair retrieval, Swiss sixth-grade algebra, grade 5–7 mathematics, Chinese grade-10 retrieval, and abstract-only Indian adolescent L2 evidence. These do not establish that adult-derived success thresholds or schedules work for adolescents, nor that results transfer across language, disability, culture, or setting. Synthesis 15 explicitly marks population transportability as unresolved. Biomedical factors (sleep, circadian timing, stress, exercise, fatigue) are also unassessed here: review 17 was not present [S15].

## Minimal learner-state model

This is a **proposed engineering representation**, not a validated measurement of memory. Keep item/topic-level observations rather than collapsing everything into one learner ability score.

1. **Objective and horizon:** target goal (acquisition, explanation, retrieval, retention, transfer, or near-term preparation), intended use/test format, and target delay.
2. **Topic map:** concepts/prerequisites and task families, with a coarse, uncertain estimate of demonstrated knowledge by topic. Avoid treating a global ability estimate as topic mastery.
3. **Attempt history:** item/concept, date and spacing gap; prompt/cue/support; correctness or rubric score; whether the learner produced an explanation; response time; confidence if collected; feedback shown; and whether the learner corrected/retrieved again.
4. **Prediction with uncertainty:** estimate probability of success on a defined future test at a specified delay and support level. Mark the estimate uncertain—especially with sparse observations—and keep it separate from observed learning outcomes.
5. **Decision context:** available time, burden, accessibility constraints, and whether the learner chooses or overrides the next action. A choice can reflect diagnostic or speed goals, not just durable learning.

Population-level priors with conservative shrinkage toward a transparent default are a plausible way to stabilize sparse per-learner estimates, but that statistical design is an **engineering hypothesis**; the available reviews do not establish a best estimator or amount of data needed for personalization [R03, R07; S15].

## Testable next-action rules

“Evidence-backed” means the relevant intervention has behavioral support within the named scope. The proposed trigger/decision rule remains provisional unless stated otherwise.

| Action | What is observed and for whom/conditions | Testable engine rule | Status and confidence |
|---|---|---|---|
| **Explanation** | Explanatory feedback/refutation can support conceptual revision; generic elaboration is not always better. Feedback timing and amount vary by task [R04, R06]. | If the learner cannot explain a target relation or repeats a misconception, show a concise explanation of why the answer/rule works, then ask for a new explanation/application. Compare with answer-only feedback. | Evidence-backed for explanatory correction in some tasks; **engineering hypothesis** for this trigger and length. Moderate/low depending on domain. |
| **Worked example** | Correct examples can help novices with complex problems; extra support may be redundant for learners with topic knowledge. Expertise reversal is not universal [R04]. | For a new complex task, present an example; then probe an independent similar item. Fade steps only after repeated component-level evidence, not by a global level or fixed timer. | Evidence supports bounded example/guidance effects; exact adaptive fade threshold is an **engineering hypothesis**. Moderate. |
| **Guided practice** | Example–problem sequences and scaffolding can support skill acquisition; a test after an example did not beat restudy in one electrical-troubleshooting experiment [R04; Van Gog et al. 2015]. | Move from supported to less-supported practice and log support; compare against fixed guidance at equal dose. Check delayed independent performance. | Sequence is plausible; per-learner trigger is **engineering hypothesis**. Moderate/low. |
| **Retrieval** | Retrieval often improves delayed retention, but low-success uncorrected attempts can fail; retrieval format and test match matter [R02]. | Use a low-stakes, attemptable closed-book prompt. If incorrect or success is persistently very low, cue/scaffold and correct; do not mark an attempt alone as mastery. | Evidence-backed within studied memory tasks; a particular success threshold is **not established**. Moderate-high for delayed retention, lower for transfer. |
| **Feedback** | Corrective feedback is prudent after errors; content and timing studies conflict. Explanations can matter for conceptual repair; feedback-frequency findings from motor tasks should not become academic rules [R06]. | Correct errors promptly when they could propagate; where the goal is conceptual understanding, add a targeted rationale; schedule a later re-check. Experimentally compare immediate vs brief delay in the target task. | Feedback is evidence-backed; timing trigger and universal format are **engineering hypotheses**. Moderate. |
| **Spacing** | Spacing benefits many delayed recall tasks; best gap depends on intended retention horizon. Procedures and classroom course results can be null/variable [R03]. | State the target delay first. Start with a simple fixed spacing baseline; allow an adaptive policy only if it improves delayed outcomes at equal dose/time. | General spacing direction evidence-backed; exact interval and adaptive algorithm **hypotheses**. High for verbal recall direction, lower elsewhere. |
| **Mixed practice** | Interleaving can help discrimination/selection in some math/category tasks, but blocked homework can be easier than interleaved homework; one physics course found an interleaving advantage on delayed surprise problems but no significant condition difference on the subsequent high-stakes midterms (Stage 1 d=.20, p=.094; Stage 2 d=.02, p=.876). A fractions ITS study sequenced graphical representations, not problem types [R05; S15]. | Begin with enough supported practice for the basic operation, then mix only if choosing among types is a target skill; score method choice separately from execution. | Conditional evidence; “when to switch” trigger is an **engineering hypothesis**. Moderate for selected domains, low universally. |
| **Transfer** | Comparison and explicit schema prompts can support selected transfer tasks; broad/far transfer is not guaranteed [R08]. | Compare structurally related cases, ask the learner to state the invariant, then test an unpracticed, no-hint item with documented changes in context/format/delay. | Evidence-backed in selected tasks; prompt sequence and expected transfer distance are **hypotheses**. Moderate near transfer, low far transfer. |
| **Rapid preparation** | Immediate restudy performance can exceed retrieval while retrieval can improve later retention; the optimal choice depends on the actual test horizon and format [R02; R03]. | Ask for the target assessment time and format. For an imminent test, compare test-matched practice/restudy under equal remaining time; report the short-horizon result separately from later retention. | No universal rapid-prep rule established; entirely a **testable engineering policy**. Low confidence. |

## Simple baseline and evaluation

**Baseline:** a fixed, transparent sequence with common explanation/example access, a preset amount of guided practice, one closed-book retrieval with corrective feedback, and a prespecified non-personalized review interval. Fix content, total practice time, feedback access, test opportunities, and target horizon before comparing an adaptive policy. The fixed interval is a benchmark, not an asserted optimum. Where possible, include the existing curriculum as a second baseline. This comparison is a recommendation for evaluation; the available evidence does not prove an adaptive engine will outperform it [S15].

**Minimum evaluation:**
1. Record immediate performance as acquisition/practice behavior, not the primary durable-learning endpoint.
2. Use no-feedback delayed tests at prespecified intervals chosen for the application (for example, a near-term and a later retention horizon); do not silently pool different delays.
3. Score conceptual explanation, procedural accuracy, retrieval, and transfer separately. Use unpracticed items and document changed structure/context, cueing, time, and tools.
4. Compare adaptive and fixed baselines under equal dose/time; randomize policy exposure when feasible. For sparse learner data, evaluate out-of-sample over time and report uncertainty, calibration, missingness, and subgroup performance. A within-learner change or model fit alone is not causal evidence.
5. Treat engagement, confidence, response time, and predicted forgetting as secondary process measures unless a separate validation demonstrates they predict the target delayed behavior.

## Unresolved limitations

- This is not a full audit of the project corpus. Reviews 01 and 09–12 and syntheses 13–14 remain absent. Only reviews 02–08 and synthesis 15 were read.
- The input draft and critique named in the preceding revision request were absent. This report is reconstructed from available project sources; no claim is made that unseen fatal or major reviewer findings were individually fixed.
- No 16-essential-gaps synthesis or biomedical review 17 was available. Sleep, circadian timing, stress, exercise, and fatigue therefore remain unassessed in this report.
- Primary-source access is uneven and inherited from the local reviews. Some claims are based on abstracts/indexes; meta-analysis overlap, publication bias, full risk of bias, and exact subgroup diagnostics were not reanalyzed here.
- Evidence for adaptive policy selection with sparse data from a single learner is notably weaker than evidence for individual learning techniques. The state model, decision triggers, and sparse-data adaptation are proposals for testing, not established interventions.

## Sources

### Local project evidence read
- [R02 — Retrieval practice](evidence/02-retrieval.md)
- [R03 — Spacing](evidence/03-spacing.md)
- [R04 — Conceptual understanding](evidence/04-understanding.md)
- [R05 — Practice structure](evidence/05-practice-structure.md)
- [R06 — Feedback and errors](evidence/06-feedback-errors.md)
- [R07 — Metacognition and study choice](evidence/07-metacognition.md)
- [R08 — Transfer/generalization](evidence/08-transfer.md)
- [S15 — Partial evidence-gaps audit](synthesis/15-evidence-gaps.md)

### Selected primary studies and syntheses
- Roediger, H. L., & Karpicke, J. D. (2006). “Test-enhanced learning: Taking memory tests improves long-term retention.” https://doi.org/10.1111/j.1467-9280.2006.01693.x — delayed retention; R02 notes immediate-versus-delayed divergence.
- Fiechter, J. L., & Benjamin, A. S. (2017). “Diminishing-cues retrieval practice: A memory-enhancing technique that works when regular testing doesn’t.” https://doi.org/10.3758/s13423-017-1366-9 — five low-success/no-feedback adult word-pair experiments, as checked in S15.
- Cepeda, N. J., et al. (2006). “Distributed practice in verbal recall tasks: A review and quantitative synthesis.” https://doi.org/10.1037/0033-2909.132.3.354 ; Cepeda et al. (2008). “Spacing effects in learning: A temporal ridgeline of optimal retention.” https://doi.org/10.1111/j.1467-9280.2008.02209.x — verbal recall and spacing/retention-horizon relation.
- Ebersbach, M., & Barzagar Nazari, K. (2020). “No Robust Effect of Distributed Practice on the Short- and Long-Term Retention of Mathematical Procedures.” https://doi.org/10.3389/fpsyg.2020.00811 — procedural spacing boundary.
- Bego, C. R., et al. (2024). “Single-paper meta-analyses of the effects of spaced retrieval practice in nine introductory STEM courses.” https://doi.org/10.1186/s40594-024-00468-5 — course-level heterogeneity.
- Tetzlaff, L., et al. (2025). “A cornerstone of adaptivity – A meta-analysis of the expertise reversal effect.” https://doi.org/10.1016/j.learninstruc.2025.102142 — source summarized in R04; full diagnostics not independently checked here.
- Sinha, T., & Kapur, M. (2021). “When Problem Solving Followed by Instruction Works: Evidence for Productive Failure.” https://doi.org/10.3102/00346543211019105 ; Ziegler, E., Trninic, D., & Kapur, M. (2021). “Micro productive failure and the acquisition of algebraic procedural knowledge.” https://doi.org/10.1007/s11251-021-09544-7.
- Van Gog, T., et al. (2015). “Testing After Worked Example Study Does Not Enhance Delayed Problem-Solving Performance Compared to Restudy.” https://doi.org/10.1007/s10648-015-9297-3.
- Brunmair, M., & Richter, T. (2019). “Similarity matters: A meta-analysis of interleaved learning and its moderators.” https://doi.org/10.1037/bul0000209 ; Rohrer, D., et al. (2020). “A randomized controlled trial of interleaved mathematics practice.” https://doi.org/10.1037/edu0000367 ; Samani, J., & Pan, S. C. (2021). “Interleaved practice enhances memory and problem-solving ability in undergraduate physics.” https://doi.org/10.1038/s41539-021-00110-x.
- Rau, M. A., Aleven, V., & Rummel, N. (2010). “Blocked versus Interleaved Practice with Multiple Representations in an Intelligent Tutoring System for Fractions.” https://www.cs.cmu.edu/afs/cs.cmu.edu/Web/People/marau/RauAlevenRummel2010_ITS.pdf — representation-sequencing study; the abstract reports N=296, while Methods/Results report N=269 and 215 analyzed.
- Kulik, J. A., & Kulik, C.-L. C. (1988). “Timing of Feedback and Verbal Learning.” https://doi.org/10.3102/00346543058001079 ; Wisniewski, B., Zierer, K., & Hattie, J. (2020). “The Power of Feedback Revisited.” https://doi.org/10.3389/fpsyg.2019.03087.
- Karpicke, J. D. (2009). “Metacognitive control and strategy selection: Deciding to practice retrieval during learning.” https://doi.org/10.1037/a0017341 ; Rhodes, M. G., & Tauber, S. K. (2011). “The influence of delaying judgments of learning on metacognitive accuracy.” https://doi.org/10.1037/a0021705 ; Tekin, E., & Roediger, H. L. (2021). “The effect of delayed judgments of learning on retention.” https://doi.org/10.1007/s11409-021-09260-0.
- Pan, S. C., & Rickard, T. C. (2018). “Transfer of test-enhanced learning: Meta-analytic review and synthesis.” https://doi.org/10.1037/bul0000151 ; Alfieri, L., Nokes-Malach, T. J., & Schunn, C. D. (2013). “Learning Through Case Comparisons: A Meta-Analytic Review.” https://doi.org/10.1080/00461520.2013.775712.
- Banerjee, A. V., et al. (2025). “Children’s arithmetic skills do not transfer between applied and academic mathematics.” https://doi.org/10.1038/s41586-024-08502-w — observational portability evidence, not a randomized instructional trial.
- Wang, Y., Yang, H., & Kyle, K. (2023). “Effect of retrieval practice and drawing on high school students’ conceptual understanding of the carbon cycle.” https://doi.org/10.1186/s43031-023-00083-4 ; Corral, D., et al. (2024). “Acquiring complex concepts through classification versus observation.” https://doi.org/10.1186/s41235-024-00608-5.

**Source-access note:** direct links identify the cited works; this integrated report relies on access and verification qualifications in R02–R08/S15. It does not treat every DOI or abstract as independently re-fetched in this pass. Search-level or abstract-only findings retain those labels in the cited local reviews/synthesis. The targeted corrections to the fractions and physics examples were checked against the full primary texts cited above. No claims are sourced to missing reviews/syntheses 01, 09–14 or biomedical review 17.
