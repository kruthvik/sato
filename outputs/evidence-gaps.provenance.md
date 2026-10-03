# Provenance — evidence-gaps audit

**Canonical artifact:** [`outputs/synthesis/15-evidence-gaps.md`](synthesis/15-evidence-gaps.md)  
**Entry point:** [`outputs/evidence-gaps.md`](evidence-gaps.md)  
**Status:** completed as a **partial audit**; the requested 12-review/2-synthesis corpus was not present in this workspace.  
**Plan:** [`outputs/.plans/evidence-gaps.md`](.plans/evidence-gaps.md), approved 2026-09-27.

## Scope and source inventory

Read `outputs/research-contract.md` and the seven available evidence reviews:

- `outputs/evidence/02-retrieval.md`
- `outputs/evidence/03-spacing.md`
- `outputs/evidence/04-understanding.md`
- `outputs/evidence/05-practice-structure.md`
- `outputs/evidence/06-feedback-errors.md`
- `outputs/evidence/07-metacognition.md`
- `outputs/evidence/08-transfer.md`

Inventory found no reviews 01 or 09–12, and no prior syntheses 13–14. Their contents were not inferred. The canonical report labels the resulting coverage as partial and records absent files as blockers/unknowns.

## Search and source-gathering method

- Four bounded researcher lanes covered retrieval/spacing/feedback; guidance/practice structure; metacognition/transfer/adaptation; and populations/methods. Workflow `f0de7d47-22d3-4089-964d-e53925929fe3` completed; copied reports are `outputs/.drafts/evidence-gaps-research-{retrieval-spacing,instruction-guidance,metacognition-transfer,cross-cutting}.md`.
- The parent conducted additional searches for adaptive RCTs, mastery learning, sleep/stress/exercise, technique boundaries, WEIRD/population coverage, non-Western classroom retrieval, and publication-bias/heterogeneity critiques. Exact parent query strings are included in the canonical report and `outputs/.drafts/evidence-gaps-research-direct.md`; the four lane notes contain their own exact query strings.
- Primary-source checks prioritized potential design reversals: failed retrieval and correction, procedural and classroom spacing nulls, blocked/interleaved contrasts with delayed outcomes, adaptive-vs-fixed schedules, and delayed retention versus transfer.
- No PRISMA-style screening, complete database search, meta-analysis overlap matrix, formal risk-of-bias assessment, publication-bias reanalysis, or statistical reanalysis was performed.

## Direct-source checks and access tiers

Full text was fetched/read for selected sources including Fiechter & Benjamin (2017), Ebersbach & Barzagar Nazari (2020), Samani & Pan (2021), Mettler et al. (2016; author-hosted PDF), Wang et al. (2023), Aljabri (2024), Ziegler, Trninic & Kapur (2021), Bego et al. (2024), Rau et al. (2010), Corral et al. (2024; PMC), Van Gog et al. (2015), Unal et al. (2021), and Vogt et al. (2022). The final report gives direct links and source/result locators where checked.

Evidence used at lower access depth is identified in the final report: the Mettler chemistry extension is abstract/index-level; Kalyuga et al. (2001) and Doley & Kakoti (2024) are abstract-level; Butler et al. (2007) is PubMed/index-level; the Dutch van Klaveren et al. (2017) manuscript returned 403 and is search/index-only; the DLD and Ortega-Tudela claims are not assigned numeric estimates. The Doley abstract reports *p*=.17, which is quoted explicitly as abstract-only and without a separately reported post-program delay.

## Tool/source limitations and corrections

- Some PMC/Springer DOI pages were dynamically rendered or did not extract cleanly. Alternate author/publisher or PMC full-text routes were used where available; otherwise the claim remains abstract/index-only.
- The van Klaveren manuscript fetch returned HTTP 403. No exact effect estimate from that field trial is promoted as verified.
- Exact-DOI queries routed through Crossref returned unrelated fuzzy matches for several DOIs; those results were not used as identity evidence. Exact-title/DOI web search and accessible publisher/PMC/author copies were used instead.
- A verifier run (`bf36c7bd-4e37-417a-a60a-0e1e573aa8d5`) prepared the cited draft, but its sandbox did not mount the parent `outputs/evidence/` corpus and it incorrectly labeled those local reviews unavailable. The parent checked that files 02–08 exist, added direct relative links and locators, and retained review-level access caveats. The verifier also initially misattributed the productive-failure algebra paper; the parent checked the exact DOI and corrected it to Ziegler, Trninic & Kapur (2021).
- The Corral et al. publisher DOI route did not extract cleanly; the PMC article was used. The cited report does not describe this as a CogSci DOI failure.

## Review and revision trail

1. Plan approved; four research notes and direct-source ledger written.
2. Draft created at `outputs/.drafts/evidence-gaps-draft.md`.
3. Verifier produced `outputs/.drafts/evidence-gaps-cited.md`; the parent corrected the corpus-path issue, source metadata, direct source locators, evidence-tier consistency, access labels, and citation-to-source mappings.
4. First reviewer (`73400684-e67d-48fb-99f7-472d97b46ad7`) found no fatal blocker and requested a coherent status ranking, better claim-level descriptors, local source locators, and a clearer coverage caveat. Report: `outputs/.drafts/evidence-gaps-review.md`.
5. Second reviewer (`3a4b7a8a-db0a-45b9-89ba-fd14c7b15191`) found no fatal issues; it requested final precision around R03’s confidence wording, the Corral sample/delay/locator, and the ID convention. The parent applied those changes and rechecked the final cited text. Report: `outputs/.drafts/evidence-gaps-review-2.md`.
6. The canonical synthesis was copied from the final cited draft and checked byte-identical at copy time. Citation-ID checking found no missing or unused bibliography numbers; local review/plan links were checked to exist.

## Residual uncertainty

Results based on abstracts/indexes remain limited to those records; they are not upgraded to full-text verified evidence. Review-level claims inherit the limitations reported inside reviews 02–08. The study overlap, publication bias, and full population/domain coverage of the available meta-analyses were not independently rechecked. Missing reviews 01, 09–12 and syntheses 13–14 may materially change the evidence-status ordering. Restore those documents before claiming a complete project-wide audit.