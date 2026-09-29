---
name: exam-drill
description: "Practice from a supplied question bank, old exam, syllabus or rubric using representative changed variants and honest per-skill evidence. Use for bounded rounds, repair, and criterion checks."
---

# Exam Drill

Read and follow the unified [teach](../teach/SKILL.md) skill with `mode: "exam-drill"`.

Exam drill is **representative variant practice** from a supplied question bank, old exam, syllabus, or rubric. It is not open-ended conceptual exploration — it is bounded rounds + repair + criterion checking.

Inspect the learner's `sources/`, pasted bank and rubric first. If none exists, say the exam coverage is inferred, not verified. Agree on a target score, time and round size without assuming that two passing rounds equal mastery.

Generate **changed variants**, not verbatim repeats. Use `open_learning_activity` in `simulation` mode for multi-item rounds with feedback withheld until submission. After each round call `mastery_report({ topic, mode: "exam-drill" })`. Diagnose misses, teach contrasts with worked repairs, and retest with independent parallel forms. Save score trajectory, repaired traps, and remaining checks under `content/sessions/exam-drill-<topic>.md`.
