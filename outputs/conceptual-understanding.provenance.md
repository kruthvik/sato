# Provenance — conceptual-understanding

- **Date:** 2026-09-27.
- **Contract:** `outputs/research-contract.md` read before synthesis.
- **Plan:** `outputs/.plans/conceptual-understanding.md`.
- **Review:** `outputs/evidence/04-understanding.md`.
- **Sources consulted:** ERIC records EJ1364058 (worked examples/math), EJ1186664 (self-explanation), EJ1000186 (case comparisons), EJ1007941 (manipulatives); Tetzlaff et al. 2025 expertise-reversal DOI; Renkl & Atkinson; Renkl et al. 1998; Carbonneau et al. 2013; Sinha & Kapur 2021; Kalyuga 2007; legal-reasoning expertise-reversal paper; Paas & van Merriënboer 2020; Chi et al. 1989 ERIC full text; selected OpenAlex records; web searches; source-check response IDs `mukdn6csh6x0ws`, `mukdn647ky7wi3`, `mukdn3lqx61und`, `mukdn6iuzwu2nu`.
- **Accepted:** ERIC abstracts for the four listed reviews and stable bibliographic records for primary/review papers; numeric results only retained where the verifier or accessible source summaries support them. All other unavailable Ns/CIs/delays are marked as not extracted or unverified.
- **Rejected/not used:** Irrelevant AI results; unsupported concrete-manipulative subgroup effects were removed. Unused follow-up references were removed to avoid implying synthesis/coverage.
- **Intermediate artifacts:** Plan at `outputs/.plans/conceptual-understanding.md`; search records retained in current session. No delegated researcher report.

## Verification and critique

- Four source-check calls returned relevant source records but automated support status `unclear`; those calls are discovery evidence, not claim verification.
- Verifier checked ERIC abstracts EJ1364058, EJ1186664, EJ1000186, EJ1007941, plus OpenAlex records. Confirmed: worked-example meta-analysis 43 articles/55 studies/181 effects, RVE *g*=.48, *p*=.01; Bisra self-explanation meta-analysis 64 reports/69 effects, weighted *g*=.55; Alfieri case-comparison meta-analysis 57 experiments/336 tests, *d*=.50, 95% CI [.44,.56]. Corrected “336 comparisons” to “336 tests” and added CI. Carbonneau abstract supports 55 studies/N=7,237/K–college and outcome-dependent pattern but not exact subgroup estimates; removed those estimates.
- Reviewer identified a fatal factual error in the initial draft: Chi et al. (1989) were described as high-school biology learners. Corrected to eight adult learners studying Newtonian-mechanics worked examples; this was a small think-aloud/correlational study, not a randomized prompt intervention. Checked source: https://files.eric.ed.gov/fulltext/ED296291.pdf ; ERIC record https://eric.ed.gov/?id=ED296291 . Per workflow, a second verifier pass was initiated after correcting the fatal issue.
- Tetzlaff et al. 2025 and Sinha & Kapur 2021 metadata matched OpenAlex. Full DOI/full-text access was incomplete; exact expertise-reversal estimates remain indexed-summary level, with CIs/heterogeneity unverified. Sinha & Kapur abstract supports 53 studies/166 comparisons and *g*=.36 [0.20,.51]. Crossref queries returned irrelevant records for some sources, so two-index DOI confirmation is incomplete.
- **Residual limitations:** Full texts, meta-analysis heterogeneity/publication-bias diagnostics, overlap among reviews, replication inventory, classroom composition, and study-level outcome/delay details were not comprehensively inspected. The review is a qualified evidence map, not a complete risk-of-bias audit. See the coverage audit and Open Questions.
- **After final targeted verifier pass:** Added an explicit citation pointer and bibliography entry for Paas & van Merriënboer (2020), which is cited in the cognitive-load mechanism row; this is a bibliographic linkage only, not a new evidence claim.

## Final verification pass (2026-09-27)

- Re-fetched the Chi et al. (1989) ERIC full-text PDF URL; it resolves to a 61-page PDF. The review text now correctly identifies eight adult learners studying worked examples in Newtonian mechanics and a think-aloud observational/correlational study, not high-school biology or randomized prompting.
- Re-fetched ERIC EJ1000186. Its abstract explicitly supports 57 experiments, 336 tests, *d*=0.50, 95% CI [0.44, 0.56]; the evidence table wording matches.
- Re-fetched ERIC EJ1007941. Its abstract supports 55 studies, N=7,237 (kindergarten through college), statistically significant small-to-moderate overall effects, and outcome-dependent results including larger retention than transfer effects. The table does not retain the previously unsupported subgroup estimates.
- Verified source list mappings after final checks: Paas & van Merriënboer (2020) retained and linked as [12] in the cognitive-load theory row; unused Apthorp/CRA/pretesting sources removed. All listed sources are cited in the body.
- No remaining discrepancy found in the requested Chi, Alfieri, or Carbonneau items against the accessible records checked. This is a targeted final pass, not comprehensive full-text or study-level verification; unrelated exact effect estimates and meta-analytic diagnostics retain the limitations already stated.
