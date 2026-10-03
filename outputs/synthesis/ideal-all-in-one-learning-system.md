# An evidence-grounded model for an all-in-one learning system

**Scope (2026-09-28).** This is a design synthesis of the available project reviews on retrieval (R02), spacing (R03), understanding (R04), practice structure (R05), feedback/errors (R06), metacognition (R07), transfer (R08), the evidence-gaps audit (S15), and the corrected integrated report (I). It is **not** a proven end-to-end intervention. The project corpus is incomplete: reviews 01 and 09–12 and syntheses 13–14 are absent; sleep, stress, fatigue, exercise, and other biomedical factors were not assessed here. Evidence for individual techniques is stronger than evidence for selecting a personalized sequence of them [S15; I].

## The organizing principle

An ideal system is **a goal- and horizon-aware instructional loop**, not a content library plus a universal “mastery score”:

```text
Desired use + target date + learner constraints
                    ↓
        Map knowledge and task families
                    ↓
     Diagnose with independent, low-stakes tasks
                    ↓
 Choose a bounded instructional move and record support
                    ↓
     Learner attempts → targeted feedback → retry
                    ↓
 Review at later intervals and in changed contexts
                    ↓
  No-feedback outcome tests → revise estimate and policy
                    ↺
```

The system should optimize **six separately measured outcomes**: initial acquisition, conceptual understanding, unaided retrieval, durable retention, procedural fluency, and application/transfer. Near-term assessment preparation is an additional, explicitly time-bounded goal. An item answered with hints, an immediate quiz, a confidence rating, or a fitted memory curve cannot stand in for independent performance after the target delay [I; R07–R08].

## 1. Curriculum layer: an inspectable map of what is being learned

Each unit should contain:

- A **concept and prerequisite map**: knowledge claims, relationships, representations, common misconceptions, and component procedures; prerequisites are instructional hypotheses to validate, not fixed facts about a learner.
- A **task-family map**: what constitutes recalling a fact, explaining a relationship, executing a procedure, selecting a method, or applying a principle in a new context. Keep method selection separate from method execution [R05].
- A **worked example, supported practice, independent practice, and test bank** for each meaningful objective. Hold back independently authored assessment items so learners cannot merely memorize the teaching examples.
- **Transfer dimensions** on each item: changed surface features, representation, context, cueing, task format, underlying structure, and delay. A new story with the same cues is not automatically far transfer [R08].
- A **source and confidence record** for content accuracy, rubrics, accessibility, and any evidence-based instructional claim. Human review is important for consequential content and open-ended scoring.

This creates one coherent system for explanations, practice, review, and assessment without conflating their purposes.

## 2. Learner-state layer: observations before labels

Maintain an event history by topic and task family: timestamp and gap, item and target outcome, response, explanation/rubric score, hints and examples available, correctness, latency, confidence if requested, feedback given, correction and subsequent retry. Store the learner's objective, available time, language/accessibility needs, and choice or override. An incorrect response under no support and a correct response with extensive prompting are different observations [I].

From that history, estimate a **distribution of predicted independent success** on a *specified task type, at a specified delay, under a specified cue/support condition*. Track uncertainty, especially for sparse histories; do not claim direct access to a stable “memory strength” or infer broad ability from one topic. Use conservative defaults until observations justify adaptation. Do not turn engagement, speed, or confidence into a global mastery label [R07; I]. This representation and its statistical estimator are **engineering proposals**, not validated cognitive measurements.

## 3. Instructional layer: a conditional repertoire, not one preferred technique

| Observed need and goal | Default move | Check before moving on | Evidence boundary |
|---|---|---|---|
| New, complex task with little demonstrated topic knowledge | Explain the goal and show a correct worked example; ask the learner to complete or explain a similar step, then attempt independently. Fade help as independent performance emerges. | Independent component-level attempt, not passive example completion. | Examples/guidance can help novices; amount and fading threshold are task-dependent [R04; I]. |
| Misconception or unexplained error | Give the correct answer **and** a targeted reason or contrasting case; invite the learner to explain the correction and try a new item. | Corrected reasoning on an independent item, then a delayed re-check. | Explanatory correction helps in some domains; feedback timing and format are not universal [R06]. |
| Accessible knowledge needing durable recall | Use an attemptable, low-stakes, closed-book prompt; provide cues if needed and corrective feedback after failure. | Later unaided retrieval at the target delay. | Retrieval often benefits delayed recall, but repeated low-success, uncorrected attempts can fail; transfer is less certain [R02]. |
| Knowledge likely needed weeks or months later | Schedule repeated opportunities across time, beginning with a **fixed, transparent interval policy** tied to the desired retention horizon. | No-feedback delayed retention test, not predicted forgetting alone. | Spacing has strong direction-of-effect evidence for many verbal-recall tasks; exact intervals and procedures vary [R03]. |
| Learner can execute types but struggles to decide which method applies | Mix confusable task types after sufficient supported foundations; contrast why one method fits and another does not. | Score *selection* and *execution* separately on unprompted problems. | Interleaving is condition- and outcome-dependent; it is not “always mix” [R05]. The physics study had delayed surprise-test gains but no significant later midterm difference [I]. |
| Learner can perform familiar cases but must generalize | Compare structurally related and surface-different examples; elicit the invariant principle, then remove supplied principles and cues. | Independently authored new-format/new-context task at a specified delay. | Selected comparison/schema interventions help some transfer tasks; broad or far transfer is not guaranteed [R08]. |
| Learner is deciding what to study next | Show delayed-check evidence, uncertainty, and the expected goal tradeoff; allow learner override and collect reasons. | Compare chosen strategy with later performance, not confidence alone. | Fluency and judgments can mislead; a perfect study-choice policy is not established [R07]. |
| Assessment is imminent | Make the time horizon and test format explicit; allocate limited time to test-matched practice and/or restudy, while preserving a later check if durability matters. | Report imminent-test performance separately from later retention. | No single rapid-preparation recipe follows from the available evidence [R02–R03; I]. |

A sensible default session is: **orient → diagnose → model/explain where needed → guided attempt → independent retrieval/application → corrective feedback → new attempt → schedule later review**. It is a *testable baseline*, not a scientifically established optimal sequence. Productive failure or exploratory problem solving can sometimes be useful, but it should not replace appropriate guidance for every novice or every goal [R04].

## 4. Decision layer: constrained, auditable adaptation

A decision considers the *target outcome and horizon*, the topic/task-family evidence, previous support, recent errors, available time, learner burden, and uncertainty. It then selects one next action from the repertoire above, states a reason (“missed the distinction between X and Y twice without hints”), and records the predicted outcome. The learner or teacher can override it.

Start with fixed defaults. Adapt one decision at a time only where data support it, and compare that decision against the fixed policy at equal content, time, exposure, feedback, and opportunities. Do not optimize click-through or immediate practice accuracy as if they were durable learning. Avoid confident per-person scheduling from a handful of attempts. Escalate persistent errors to a human or a different instructional explanation rather than endlessly repeating the same item [S15; I]. **No exact success threshold, spacing formula, guidance-fading trigger, or combined policy is established by these reviews.**

## 5. Assessment layer: evidence of learning, not just system activity

For every goal, predefine the test and delay:

1. **Acquisition:** first independent response shortly after instruction.
2. **Understanding:** explain, predict, and discriminate with a scored rubric and nonidentical items.
3. **Retrieval:** produce the answer without access to the source, with cue level recorded.
4. **Retention:** no-feedback performance after a prespecified delay relevant to actual use.
5. **Procedure:** independent accuracy and appropriate method selection, separately reported.
6. **Transfer:** solve independently authored, unpracticed tasks; document what changed, what cues were present, and how long after instruction they were tested.
7. **Calibration:** compare confidence or predictions against later performance, as a secondary measure rather than a substitute for it.

A system dashboard should expose these outcomes separately, with sample size, uncertainty, support level, and time horizon. “Mastered” should never silently mean “answered correctly once during practice.”

## 6. Evaluation and governance layer

**Benchmark the whole system**, not only each component's plausibility. Compare a proposed adaptive engine to (a) a transparent fixed sequence with the same content, instructional support, practice time, feedback, and target delay and (b) existing instruction where feasible. Randomize policy exposure where possible, pre-register the primary delayed outcome, test on held-out items, and report short- and long-horizon effects separately. Audit false mastery, error recovery, learner burden, calibration, accessibility, and subgroup results. A within-learner improvement or a model's predictive fit does not demonstrate the policy caused better learning [I; S15].

For product operation, minimize sensitive data, provide export/deletion and accessible alternatives, let educators inspect and correct content/rubrics, and explain recommendations. These are **normative product safeguards**, not learning-science findings established by this corpus.

## What is well supported versus still speculative

- **Relatively supported within studied tasks:** retrieval with adequate success/feedback for delayed recall; distributed practice for many verbal-memory outcomes; useful guidance/examples for many novice complex tasks; feedback that corrects errors; conditional benefits of mixed practice and case comparison [R02–R06; R08].
- **Conditional and disputed:** optimal feedback timing, amount of guidance, when to introduce interleaving, specific transfer prompts, classroom/age/domain generalization, and effects on high-stakes downstream assessments [R04–R08; S15].
- **Engineering hypotheses:** one integrated sequence, learner-state estimator, personalized intervals/thresholds, action-selection policy, and claims that adaptation outperforms a strong fixed baseline [I; S15].

**Bottom line:** Build an integrated *diagnose–teach–retrieve–correct–space–vary–test* system, but organize and evaluate it around **specific goals, delayed independent performance, and uncertainty**. The strongest scientific claim is that several component moves can help under bounded conditions—not that any all-in-one architecture or universal personalization algorithm has already been validated.

## Project source trail

- [R02 Retrieval](../evidence/02-retrieval.md) · [R03 Spacing](../evidence/03-spacing.md) · [R04 Understanding](../evidence/04-understanding.md) · [R05 Practice structure](../evidence/05-practice-structure.md) · [R06 Feedback/errors](../evidence/06-feedback-errors.md) · [R07 Metacognition](../evidence/07-metacognition.md) · [R08 Transfer](../evidence/08-transfer.md)
- [S15 Evidence gaps](15-evidence-gaps.md) · [I Corrected integrated report](../learning-science-final.md) · [Research contract](../research-contract.md). Each local review contains primary-study identifiers, conditions, contrary evidence, and access qualifications; the integrated report lists selected DOI links. No new independent primary-source verification was performed for this model.
