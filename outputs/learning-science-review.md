# Review: `outputs/learning-science-final.md`

## Summary Assessment

**Recommendation: Major revision.** The report is unusually careful about separating immediate performance from delayed retention, understanding, and transfer; it also labels its adaptive state model and most action triggers as hypotheses. I found no evidence that the report invents sources or claims that missing syntheses 16 or biomedical review 17 exist.

However, source-content checks found one material treatment/outcome mischaracterization in the fractions interleaving study and a material omitted null result in the cited physics-course study. The executive summary also makes a comparative “strongest and most replicated” claim that the partial audit did not establish. These issues affect the evidence used to motivate mixed-practice policy and the report's evidence ranking.

**Verification: PASS WITH NOTES.** I read the artifact, reviews 02–08 and synthesis 15, and checked selected primary-source content. Full-text sources verified below do support several central claims. A few sources were inaccessible in this pass; those checks are marked as inherited from the local audit or blocked, not treated as confirmed at primary-source level. Synthesis 16 and biomedical review 17 were not used or assumed to exist.

## Strengths

- **Outcome discipline:** The report distinguishes acquisition, conceptual understanding, retrieval accessibility, delayed retention, transfer, and rapid preparation; it repeatedly warns against treating practice accuracy, confidence, latency, model fit, or engagement as durable learning.
- **Caveats retained:** It preserves the partial-corpus limitation and the source-access caveats in synthesis 15. It does not attribute content to the missing reviews/syntheses.
- **Counterevidence in several areas:** It includes retrieval failure at low success, procedural/classroom spacing nulls, blocked-favored findings, the worked-example testing null, and transfer limits.
- **Rules mostly calibrated:** The learner-state representation, sparse-data shrinkage, per-learner triggers, simple baseline, and rapid-preparation policy are explicitly presented as proposals or engineering hypotheses rather than validated algorithms.
- **Selected primary-source checks support key summaries:** The carbon-cycle study, procedural-spacing null, adaptive-spacing study, physics criterial tests, and Grade 7 mathematics trial are accurately bounded in important respects.

## Critical Issues

None confirmed at the level of fabricated citations, wholesale source inversion, or claims that missing project documents exist. The major issues below should be fixed before treating the mixed-practice evidence summary as reliable.

## Major Issues

### M1 — Fractions experiment is compressed in a way that changes the treatment and hides a prior-knowledge result

**Location:** “Blocked, mixed, and variable practice,” report line 67; “Mixed practice” rule, line 109.

The report says: “A grade 5–6 fractions tutoring RCT found blocked/reduced-block practice better on representational knowledge, with no significant operational-knowledge difference.” The cited primary study, Rau, Aleven & Rummel (2010), tested the sequencing of **graphical representations of fractions** (pie charts, number lines, and sets), not a general interleaved problem-type schedule. It had four conditions: blocked, moderate, interleaved, and “increased” practice (block lengths gradually reduced). Among 269 assigned grade 5–6 students, 215 entered the final analyses; tests were immediate and seven days after the tutoring period.

The full primary paper reports that delayed **representational** knowledge favored blocked and increased conditions over moderate/interleaved conditions. It found no overall operational-knowledge condition differences, but also reports prior-knowledge-by-condition interactions: for the low-prior-knowledge subgroup, the increased schedule outperformed blocked practice on operational knowledge at immediate and delayed posttests, and outperformed other schedules on delayed operational knowledge. Thus the report's shorthand both obscures the specific representation-sequencing treatment and makes “no significant operational-knowledge difference” sound unconditional. Using this as broad counterevidence to mixing problem types risks a treatment mismatch.

**Required correction:** identify the intervention as sequencing graphical representations; name the four conditions or clearly distinguish the gradually reduced-block condition; report the overall operational result together with the low-prior-knowledge subgroup result. Then limit the inference to this fractions/representation task, not mixed problem types generally.

### M2 — The physics-course result omits a material downstream null

**Location:** “Blocked, mixed, and variable practice,” report line 67; “Mixed practice” rule, line 109.

The report accurately says interleaving improved surprise novel-problem criterial tests in the Samani & Pan physics-course study (reported *d*=.40 and .91 in the source review). The full paper also reports that scores on the high-stakes midterm exams three days after those criterial tests did **not** significantly differ between blocked and interleaved conditions: Stage 1 *d*=.20, *p*=.094; Stage 2 *d*=.02, *p*=.876. The authors discuss limitations to the diagnosticity of those midterms, so these nulls do not erase the criterial-test finding. But omitting them leaves a one-sided account of the intervention's transfer to consequential course assessment.

**Required correction:** retain the surprise-test result but add the later midterm null and the authors' caveat about exam diagnosticity. Do not imply that the delayed criterial-test advantage established an exam-performance advantage.

### M3 — “Strongest and most replicated” is an unsupported comparative ranking

**Location:** Executive summary, report line 7.

“The strongest and most replicated behavioral evidence in the available corpus supports retrieval practice and spacing” is broader than the audit establishes. Synthesis 15 explicitly says its status ordering is **not** a cross-method effect-size or confidence leaderboard, and the audit did not independently assess overlap among meta-analyses, publication bias, or replication counts. The following qualification (“for many delayed recall tasks”) helps, but does not substantiate “strongest and most replicated.”

**Required correction:** replace with a non-ranking formulation such as “The most consistently supported findings in the available reviews are benefits of retrieval practice and spacing for many delayed-recall tasks,” while retaining the task, comparator, and access limitations.

## Minor Issues

1. **Primary-source path for the fractions and L2 counterexamples is indirect.** The final Sources section lists local R05/S15 but not direct citations for Rau et al. (2010) or Doley & Kakoti (2024). Synthesis 15 does contain the Rau PDF link and ERIC abstract link, so this is a traceability weakness rather than an invented citation. Add those direct entries and preserve the abstract-only label for Doley.
2. **Worked-example testing boundary is reported from one experiment.** The report says “one-week null … in one experiment.” Van Gog et al. (2015) is a four-experiment paper with a small synthesis of delayed comparisons; the selected statement is not contradicted, but mentioning that broader study program would avoid making the null look like a single isolated experiment. Keep the electrical-troubleshooting and delayed-problem-solving limits.
3. **Confidence labels are qualitative and inherited.** The report states this clearly. “High for verbal recall direction” should remain explicitly qualitative and limited to the reviewed corpus; it should not be interpreted as a formal risk-of-bias or independent meta-analysis judgment.
4. **The first next-action rule may read more prescriptively than its status label.** “Begin with enough supported practice … then mix” is properly labeled an engineering hypothesis in the final column. Keep that qualifier adjacent to the recommendation if the table is excerpted elsewhere.

## Reproducibility and Verification

- Read the complete Markdown artifact; it contains two tables and no figures, data, code, or supplemental links requiring separate reproduction.
- Read local reviews `outputs/evidence/02-retrieval.md` through `08-transfer.md` and `outputs/synthesis/15-evidence-gaps.md`. Directory inventory found no synthesis 16 or biomedical review 17; neither is assumed.
- **Primary source content checked:**
  - Wang et al. (2023), full publisher text: `https://doi.org/10.1186/s43031-023-00083-4`. The source separates immediate/one-week outcomes and factual from application items; the report's limited summary matches.
  - Ebersbach & Barzagar Nazari (2020), full article: `https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2020.00811/full`. Confirms N=235, 0/1/11-day ISIs, 1/5-week tests, and no spacing effect for the tested permutation procedure.
  - Mettler et al. (2016), PMC full text: `https://pmc.ncbi.nlm.nih.gov/articles/PMC6028005/`. Confirms narrow geography task, adaptive vs fixed schedules, and immediate/one-week outcomes.
  - Samani & Pan (2021), full Nature text: `https://doi.org/10.1038/s41539-021-00110-x`. Confirms blocked homework advantage, interleaved surprise criterial-test advantage, and the subsequent midterm nulls noted above.
  - Rau et al. (2010), extracted primary PDF: `https://www.cs.cmu.edu/afs/cs.cmu.edu/Web/People/marau/RauAlevenRummel2010_ITS.pdf`. Full source details support Major Issue M1.
  - Corral et al. (2024), PMC full text: `https://pmc.ncbi.nlm.nih.gov/articles/PMC11649615/`. Abstract confirms classification did not outperform observation and explanation feedback generally helped over tests from immediate to one week.
  - Rohrer et al. (2020), ERIC abstract: `https://eric.ed.gov/?id=ED595322`. Confirms 54 grade-7 classes, 61% vs 38% on the one-month unannounced test, *d*=.83.
  - Van Gog et al. (2015), full Springer text: `https://doi.org/10.1007/s10648-015-9297-3`. Confirms four experiments and the narrow electrical-troubleshooting task family.
- **Blocked/inherited checks:** direct Fiechter & Benjamin PDF retrieval was unavailable in this pass; Tetzlaff's DOI page was dynamically rendered; the Doley & Kakoti ERIC fetch failed. Their claims are only accepted at the lower access depth recorded in S15/R04, not independently promoted to full-text verified.
- Source links exist, but the main checks above relied on article text/results rather than URL reachability alone. The review did not independently reanalyze study-level data, meta-analytic overlap, publication bias, or formal risk of bias.

## Inline Annotations

- **Executive summary, line 7:** soften “strongest and most replicated”; S15 expressly disclaims a cross-method leaderboard.
- **Practice-structure paragraph, line 67:** revise the Rau et al. treatment label and report its low-prior-knowledge operational subgroup; add the Samani & Pan midterm null.
- **Mixed-practice rule, line 109:** ensure the “begin then mix” sequence remains visibly an engineering hypothesis, not a validated universal curriculum.
- **Sources:** add direct Rau and Doley source entries to reduce reliance on an indirect link through S15.

## Recommendation

**Major revision before use as the evidence basis for a mixed-practice policy.** Correct the Rau treatment/outcome summary, add the later physics-exam null with its caveat, and remove the unsupported comparative superlative. The broader report's outcome distinctions and explicit labeling of engine rules as hypotheses are strengths to preserve.

## Sources

### Artifact and local evidence corpus
- `outputs/learning-science-final.md`
- [R02 Retrieval](evidence/02-retrieval.md)
- [R03 Spacing](evidence/03-spacing.md)
- [R04 Conceptual understanding](evidence/04-understanding.md)
- [R05 Practice structure](evidence/05-practice-structure.md)
- [R06 Feedback/errors](evidence/06-feedback-errors.md)
- [R07 Metacognition](evidence/07-metacognition.md)
- [R08 Transfer](evidence/08-transfer.md)
- [Synthesis 15 — evidence gaps](synthesis/15-evidence-gaps.md)

### Primary sources inspected
- Rau, M. A., Aleven, V., & Rummel, N. (2010). “Blocked versus Interleaved Practice with Multiple Representations in an Intelligent Tutoring System for Fractions.” https://www.cs.cmu.edu/afs/cs.cmu.edu/Web/People/marau/RauAlevenRummel2010_ITS.pdf
- Samani, J., & Pan, S. C. (2021). “Interleaved practice enhances memory and problem-solving ability in undergraduate physics.” https://doi.org/10.1038/s41539-021-00110-x
- Ebersbach, M., & Barzagar Nazari, K. (2020). “No Robust Effect of Distributed Practice on the Short- and Long-Term Retention of Mathematical Procedures.” https://doi.org/10.3389/fpsyg.2020.00811
- Mettler, E., Massey, C. M., & Kellman, P. J. (2016). “A Comparison of Adaptive and Fixed Schedules of Practice.” https://pmc.ncbi.nlm.nih.gov/articles/PMC6028005/
- Wang, Y., Yang, H., & Kyle, K. (2023). “Effect of retrieval practice and drawing on high school students’ conceptual understanding of the carbon cycle.” https://doi.org/10.1186/s43031-023-00083-4
- Corral, D., et al. (2024). “Acquiring complex concepts through classification versus observation.” https://pmc.ncbi.nlm.nih.gov/articles/PMC11649615/
- Van Gog, T., et al. (2015). “Testing After Worked Example Study Does Not Enhance Delayed Problem-Solving Performance Compared to Restudy.” https://doi.org/10.1007/s10648-015-9297-3
- Rohrer, D., et al. (2020). “A Randomized Controlled Trial of Interleaved Mathematics Practice.” ERIC record: https://eric.ed.gov/?id=ED595322
