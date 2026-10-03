import type { Goal } from "./contracts.ts";
export const subjectProfiles: Record<Goal["subject"], { dimensions: string[]; formats: string[]; limits: string }> = {
  math: { dimensions: ["method selection", "reasoning", "execution", "units and arithmetic"], formats: ["solve", "explain", "draw"], limits: "A correct number alone does not establish reasoning. Verify objective answers independently." },
  writing: { dimensions: ["claim", "evidence", "warrant", "structure", "language"], formats: ["free_response", "explain", "perform"], limits: "Multiple defensible interpretations; assess learner-authored text against public criteria. AI drafts are supported work." },
  science: { dimensions: ["mechanism", "prediction", "evidence", "units"], formats: ["explain", "solve", "draw"], limits: "Written descriptions cannot verify experimental execution or safety. State source uncertainty." },
  humanities: { dimensions: ["source evaluation", "context", "argument", "competing explanations"], formats: ["free_response", "explain"], limits: "Do not invent a unique answer to a disputed interpretation." },
  languages: { dimensions: ["meaning", "grammar", "appropriate use", "comprehension"], formats: ["free_response", "discriminate"], limits: "Text does not establish listening or pronunciation ability." },
  computing: { dimensions: ["trace", "invariant", "implementation", "explanation"], formats: ["code", "explain"], limits: "No automatic code execution. Passing tests alone does not establish general understanding." },
  practical: { dimensions: ["process", "constraints", "quality", "reflection"], formats: ["perform", "draw"], limits: "A written report cannot verify motor performance. Request human observation for physical or high-stakes skills." },
};
