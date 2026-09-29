# Research basis and implementation decisions

This file records the evidence claims that materially shape the learning engine. It is intentionally narrower than a general literature review: each entry states what the study supports and how the program uses it.

## Integrated architecture from the broader synthesis

The full review in [`research/learning.md`](../research/learning.md) supports an orchestrated system rather than a single preferred technique:

**Model → Generate → Retrieve → Correct → Compare → Vary → Transfer → Space → Reassess.**

The stream-level implementation follows these constraints:

- Treat memory accessibility, structural understanding, discrimination, confidence calibration, and transfer as distinct evidence dimensions. One routing score must not become a mastery claim.
- Require multi-evidence mastery for important concepts: unaided retrieval, discrimination from a confusable alternative, unfamiliar application, and success after a meaningful delay.
- Use worked examples and completion problems for novice acquisition, then fade method labels, subgoals, and hints toward independent selection and execution.
- Interleave only when juxtaposition practices a real discrimination. Early blocked acquisition can be useful; random variety is not the objective.
- Build analogical structure with different-surface positive examples, a near-miss or confusable alternative, and a novel transfer target. Ask learners to identify the invariant relation.
- Escalate feedback minimally and classify failures before intervening. Memory failures, misconceptions, prerequisite gaps, selection errors, and execution slips need different repairs.
- Use visuals only when they externalize relationships, mechanisms, change, or spatial structure, and integrate labels with the elements they explain.
- Optimize for delayed unaided retrieval and transfer per unit time, not engagement, lesson completion, streaks, or immediate accuracy.
- Do not hard-code expanding spacing as scientifically optimal. The evidence strongly supports spacing over massing, while expanding versus uniform intervals is approximately null overall; timing should respond to observed forgetting and the target horizon.
- AI may reduce irrelevant difficulty, generate contrasts, diagnose errors, and provide graduated hints, but it should not perform the target cognitive operation the learner is meant to acquire.

Learner-visible generated material is preserved under `content/` for Obsidian. `_learning/` remains purpose-limited operational state and telemetry.

## Retrieval, feedback, and spacing

- **Retrieval versus restudy.** Roediger and Karpicke found that repeated study produced better performance after five minutes, while prior free-recall tests produced better retention after two days and one week. The engine therefore separates immediate readiness from durable mastery and replaces repeated rereading with retrieval-feedback-retry cycles. [Roediger & Karpicke, 2006, DOI 10.1111/j.1467-9280.2006.01693.x](https://pubmed.ncbi.nlm.nih.gov/16507066/)
- **Production and feedback.** Classroom experiments reported stronger later gains from short-answer than multiple-choice practice and a benefit from feedback. The learner model therefore discounts recognition relative to produced answers and records open-ended evidence separately. [McDaniel, Roediger, & McDermott, 2007, PMID 17694901](https://pubmed.ncbi.nlm.nih.gov/17694901/)
- **Successive relearning.** Relearning across later sessions provides large durability gains, while additional initial correct recalls show diminishing returns when future relearning occurs. Teach schedules delayed retrieval; fast-learn and cram stop same-session grinding once a task is functionally ready. [Rawson & Dunlosky, 2011, DOI 10.1037/a0023956](https://pubmed.ncbi.nlm.nih.gov/21707204/); [Vaughn, Dunlosky, & Rawson, 2016, DOI 10.3758/s13421-016-0606-y](https://pubmed.ncbi.nlm.nih.gov/27027887/)
- **Pretesting.** Failed prequestions improved later memory for prequestioned information compared with additional reading time. The engine uses a small Tier-1-aligned diagnostic before explanation, but does not assume broad transfer to unasked material. [Richland, Kornell, & Kao, 2009, DOI 10.1037/a0016496](https://pubmed.ncbi.nlm.nih.gov/19751074/)

## Transfer and instructional support

- **Self-explanation.** Prompting learners to explain material to themselves improved integration of new information with prior knowledge in Chi et al.'s study of an expository science text. Fast-learn and cram now require closed-source “why / why not / when does it fail?” explanations for central concepts, with evaluated feedback rather than fluency-based approval. The program does not require explanations after every trivial response. [Chi, de Leeuw, Chiu, & LaVancher, 1994, DOI 10.1207/s15516709cog1803_3](https://doi.org/10.1207/s15516709cog1803_3)
- **Learning by teaching.** In Fiorella and Mayer's experiments, preparing to teach and actually teaching improved immediate comprehension, while the delayed-test advantage was more persistent for learners who actually delivered an explanation. Each learning mode therefore uses a bounded Feynman inversion with an active `student` subagent that challenges gaps and misconceptions. Its completion token is treated as local explanation evidence, not proof of durable mastery. [Fiorella & Mayer, 2013, DOI 10.1016/j.cedpsych.2013.06.001](https://doi.org/10.1016/j.cedpsych.2013.06.001)
- **Generation before presentation.** Learner-generated responses were remembered better than responses merely read across the original generation-effect experiments. Teach already uses prediction gates; fast-learn and cram now use one brief prediction before central explanations without turning the session into an exhausting cold pretest. [Slamecka & Graf, 1978, DOI 10.1037/0278-7393.4.6.592](https://doi.org/10.1037/0278-7393.4.6.592)
- **Feedback and calibration.** Retrieval improves retention, and feedback can correct both errors and low-confidence correct responses. The engine therefore evaluates explanations immediately, records confidence as calibration rather than mastery, and repairs the reasoning before another attempt. [Butler, Karpicke, & Roediger, 2008, DOI 10.1037/0278-7393.34.4.918](https://pubmed.ncbi.nlm.nih.gov/18605878/)
- **Interleaving.** In classroom mathematics, interleaved practice improved later performance and required learners to choose a strategy from the problem. The engine interleaves confusable problem types to practice discrimination; it does not randomize unrelated topics for its own sake. [Rohrer, Dedrick, & Burgess, 2014, DOI 10.3758/s13423-014-0588-3](https://pubmed.ncbi.nlm.nih.gov/24578089/)
- **Example fading.** Fading worked steps plus self-explanation can support the transition from examples to problem solving. More recent controlled work also indicates that worked-example-first is especially useful for novices facing high element interactivity. Scaffolding therefore adapts to both prior evidence and task complexity instead of forcing every learner through every level. [Atkinson, Renkl, & Merrill, 2003, DOI 10.1037/0022-0663.95.4.774](https://doi.org/10.1037/0022-0663.95.4.774); [Chen et al., 2020, DOI 10.1111/bjep.12317](https://pubmed.ncbi.nlm.nih.gov/31465546/)

## Sleep, stress, devices, and caffeine

- **Nap versus cramming.** In young adults learning detailed factual material, a one-hour nap and an extra hour of cramming both beat a wakeful break after 30 minutes, but only the nap advantage remained significant after one week. Cram mode may protect a nap when time and sleepiness make it useful; it does not claim naps always replace study. [Cousins et al., 2019, DOI 10.1093/sleep/zsy207](https://pubmed.ncbi.nlm.nih.gov/30371902/)
- **Sleep restriction.** Experimental sleep restriction has negative average effects on sustained attention, executive function, and long-term memory. The program treats planned sleep as a performance constraint and no longer recommends an all-nighter or rigid 90-minute “cycle” arithmetic. [Lowe, Safati, & Hall, 2017, DOI 10.1016/j.neubiorev.2017.07.010](https://pubmed.ncbi.nlm.nih.gov/28757454/)
- **Stress and retrieval.** Cortisone administered before retrieval impaired long-term declarative recall in the original human study, and later experimental work found timing-dependent effects. The program recommends a low-friction transition before performance without promising that exactly 30–45 minutes produces a universal cortisol threshold. [de Quervain et al., 2000, DOI 10.1038/73873](https://pubmed.ncbi.nlm.nih.gov/10725918/); [Schwabe & Wolf, 2014, DOI 10.3758/s13415-014-0256-0](https://pubmed.ncbi.nlm.nih.gov/24492994/)
- **Caffeine and sleep.** A randomized home study found that 400 mg of caffeine disrupted sleep even six hours before bedtime. The engine warns about substantial late doses but does not extrapolate that single protocol into a universal micro-dosing prescription. [Drake et al., 2013, DOI 10.5664/jcsm.3170](https://pubmed.ncbi.nlm.nih.gov/24235903/)
- **Smartphone distraction.** Ward et al. reported lower cognitive-capacity task performance when a participant's phone was more salient. A later meta-analysis found a small overall negative effect with heterogeneity across domains and studies. The engine presents phone removal as a low-cost option, not a guaranteed cognitive boost. [Ward et al., 2017, DOI 10.1086/691462](https://doi.org/10.1086/691462); [Böttger, Poschik, & Zierer, 2023, DOI 10.3390/bs13090751](https://pubmed.ncbi.nlm.nih.gov/37754029/)

## Learner-model and scheduling guardrails

- Model scores are **routing estimates**, not calibrated probabilities of mastery. Legacy mode-specific percentage gates were removed from the session contract: readiness requires distinct independent retrieval, explanation, discrimination, changed application, verified gap repair, and (for exam modes) representative assessment evidence for each mapped skill. The 0.70 success threshold is an operational scoring heuristic, not a probability of mastery.
- Diagnostic pretests use no normal learning-transition bonus. Recognition, cued recall, free recall, self-explanation, and application contribute different evidence weights. These weights are conservative engineering heuristics and should be validated against the learner's own history.
- The scheduler uses the published 17-parameter FSRS-4 equations. It supports same-day acute checkpoints before normal day-scale scheduling, and it merges exact duplicate cards. The official definition of stability is the interval at which retrievability reaches 90%. [Open Spaced Repetition, FSRS algorithm](https://github.com/open-spaced-repetition/fsrs4anki/wiki/The-Algorithm/259410b810c39a3bd46f5a2f96e89a4110246813)

## Spacing calibrated to retention interval

- **Optimal spacing depends on the final retention horizon.** Cepeda et al.'s quantitative review of 839 assessments from 317 experiments found that the spacing interval producing the greatest retention grows with the interval before the final test. The practical implication: a schedule optimized for one week is not optimal for tomorrow, and a schedule optimized for tomorrow is not optimal for one hour. Cram adapts acute retrieval spacing to a real deadline; fast-learn does so only when a performance horizon exists. Open-ended learning uses an explicit retention horizon rather than inventing an exam deadline. [Cepeda, Pashler, Vul, Wixted, & Rohrer, 2006, DOI 10.1037/0033-295X.113.4.766](https://pubmed.ncbi.nlm.nih.gov/17014302/)

## AI learning paradox and tutoring

- **Unrestricted AI can damage unaided learning.** Bastani et al. found that high-school mathematics students with unrestricted GPT access improved performance while the tool was available but showed worse subsequent unaided learning. Tutoring-style restrictions that encouraged learning rather than answer-copying reduced the damage. The engine therefore enforces: learner attempts first → AI critiques → learner repairs → AI generates variant → learner solves unaided. [Bastani, Bastani, Sungu, Ge, Kabakcı, & Marber, "Generative AI Can Harm Learning," 2024](https://doi.org/10.2139/ssrn.4895486)
- **Carefully designed AI tutoring can produce large gains.** Kestin et al.'s randomized controlled trial in college physics found that a carefully designed AI tutor produced substantially greater learning in less time than an active-learning classroom condition. This supports using AI for compression, explanation, question generation, and adversarial testing—not answer outsourcing. [Kestin, Miller, McCarty, Callaghan, & Deslauriers, 2025](https://doi.org/10.1073/pnas.2404347122)

## Pre-retrieval stress

- **Acute stress before retrieval impairs memory.** Shields, Sazma, McCullough, and Yonelinas's meta-analysis of 113 studies (6,216 participants) found that acute stress immediately before or during retrieval generally impaired episodic memory. Post-encoding stress sometimes improved retention. The program therefore recommends a low-arousal transition in the final 15–30 minutes before performance: close only critical information gaps, conduct brief confidence-building recall, and eliminate logistical surprises. Frantic last-minute scope expansion is specifically counter-productive. [Shields, Sazma, McCullough, & Yonelinas, 2017, DOI 10.1016/j.psyneuen.2017.04.006](https://pubmed.ncbi.nlm.nih.gov/28478300/)

## Caffeine strategy

- **Caffeine reliably worsens subsequent sleep.** Gardiner et al.'s systematic review and meta-analysis concluded that caffeine reduces total sleep time and sleep efficiency and increases sleep-onset latency, with effects varying by dose and timing. Combined with the Drake et al. finding that 400 mg disrupts sleep even six hours before bedtime, the decision rule is: use caffeine to protect a high-value learning block only when the resulting alertness is worth the sleep cost. Never escalate doses across a 24–48-hour cram. [Gardiner et al., 2023, DOI 10.1016/j.smrv.2023.101764](https://pubmed.ncbi.nlm.nih.gov/36870101/)

## Sleep-retrieval bookending

- **Retrieve before sleep; retrieve cold after waking.** This is an implementation decision combining three evidence streams: (1) spaced retrieval's superiority over massed study, (2) sleep's role in consolidation, and (3) the diagnostic value of cold retrieval after a genuine forgetting interval. The final study period before sleep should contain retrieval, not merely reading. The first major session after waking should begin with cold retrieval before any review. This turns the overnight interval into both a consolidation window and a genuine diagnostic spacing gap.

## Micro-offline consolidation

- **Brief rest intervals during practice.** In action-sequence learning tasks, Bönstrup et al. found that early performance gains accumulated primarily during 10-second rest intervals between practice trials, not during active execution. Gains during these micro-pauses were up to four times larger than overnight consolidation. MEG data showed dense hippocampal sharp-wave ripples (80–120 Hz) during the pauses, and ripple density predicted individual performance gains. The practice pacer enforces work/rest alternation during skill-building blocks; it does not claim the same effect sizes generalize to all declarative learning tasks. [Bönstrup et al., 2019, DOI 10.1016/j.cub.2019.04.048](https://pubmed.ncbi.nlm.nih.gov/31104932/); [Bönstrup et al., 2021, DOI 10.1016/j.celrep.2020.108560](https://pubmed.ncbi.nlm.nih.gov/33406434/)

## Wakeful rest and early consolidation

- **Brief quiet rest after encoding.** Dewar et al. found that participants who rested quietly for 10–15 minutes after learning verbal material retained substantially more than those immediately given a cognitive task. The retention benefit persisted at 7-day delays. The mechanism involves suppressing retroactive sensory interference during early synaptic consolidation. The wakeful rest timer shields the post-encoding window; it does not prescribe the rest duration as universally optimal or claim rest replaces sleep-dependent consolidation. [Dewar, Alber, Butler, Cowan, & Della Sala, 2012, DOI 10.1177/0956797612441220](https://pubmed.ncbi.nlm.nih.gov/22941876/)

## Mnemonic spatial mapping

- **Method of Loci training effects.** Dresler et al. compared 23 world-class memory athletes with matched controls and found no structural brain differences. However, after 6 weeks of daily 30-minute Method of Loci training, naive subjects showed functional connectivity shifts toward the athletes' patterns, predicting memory gains up to 4 months later. Separate RSA work shows the method reduces hippocampal pattern similarity across stored items, which may protect against interference. The loci builder provides the spatial scaffolding for serialized and arbitrary content; it does not claim the training effects transfer automatically to schematic or procedural learning. [Dresler et al., 2017, DOI 10.1016/j.neuron.2017.02.003](https://pubmed.ncbi.nlm.nih.gov/28279356/)

## Cold-start acquisition gate

- **When the learner has no prior knowledge, pretests produce only guessing noise.** Recognition questions are answered at chance rates through intuition and elimination, free recall produces nothing, and the BKT model inflates from lucky hits. Cognitive-load theory predicts this directly: unguided problem solving is a poor starting point for novices because they lack the schemas to generate solution paths efficiently. The generation effect (Slamecka & Graf, 1978) and pretesting benefits (Richland, Kornell, & Kao, 2009) require the learner to have *enough* schema to generate a meaningful prediction or attempt — not zero. The worked-example effect is especially strong for novices facing high element interactivity (Chen et al., 2020; Atkinson, Renkl, & Merrill, 2003). The engine therefore detects cold-start conditions (chance-level diagnostic performance, no free-recall production, "I don't know" responses) and routes to acquisition-first instruction: full worked examples with labeled subgoals, recognition-format initial checks, and deferred prediction gates. Normal diagnostic probing and the fading progression resume once a minimal foundation cluster (2–3 nodes) has been established. [Sweller in Plass, Moreno, & Brünken, 2010; Chen et al., 2020, DOI 10.1111/bjep.12317](https://pubmed.ncbi.nlm.nih.gov/31465546/); [Richland, Kornell, & Kao, 2009, DOI 10.1037/a0016496](https://pubmed.ncbi.nlm.nih.gov/19751074/); [Slamecka & Graf, 1978, DOI 10.1037/0278-7393.4.6.592](https://doi.org/10.1037/0278-7393.4.6.592)

## Scope-complete evidence and mode simplification (implementation decision)

Retrieval, self-explanation, worked examples, feedback and changed-context practice address **different failure modes**; no one technique or fixed number of questions proves understanding. The cited retrieval, self-explanation, learning-by-teaching, spacing and example-fading studies above support combining these methods selectively, not imposing a universal 60% retrieval ratio, 4–8 questions per chunk, or an automatic Feynman exchange after every definition. We now reserve fixed evidence requirements for a *mapped assessable skill* (production, causal explanation, discrimination, changed application and verification of any opened gap), while allowing a single brief check after a small explanatory chunk. A three-item streak is neither a coverage measure nor evidence of retention. This is a conservative product rule, **not** a threshold estimated from those studies.

Fast-learn can target an open-ended topic without an exam; cram adds representative final-performance testing and a protected buffer to the same conceptual loop. For both, topic-wide claims require a mapped scope and an explicit report of never-tested nodes. Scores are routing signals; independent delayed and external outcomes constrain stronger mastery claims. The relative benefit of each tool and the exact budget split must be validated on learner outcomes rather than justified by a mechanistic story alone.

## Research hygiene

When adding a new learning rule, record:

1. population and task;
2. comparison condition;
3. immediate versus delayed outcome;
4. retention interval;
5. near versus far transfer;
6. replication, boundary condition, or conflicting result;
7. the narrow program behavior justified by the evidence.

Do not turn a behavioral result into an unsupported neural mechanism, copy an effect size across unlike tasks, or present a population average as a guarantee for one learner.
