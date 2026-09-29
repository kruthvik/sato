# Learning Activity Spec (LAS) 1.1

LAS is the declarative language consumed by `open_learning_activity`. It describes learning intent and grading data; the runtime owns layout, interaction, scoring, saving, and browser launch.

## Top level

```json
{
  "version": 1,
  "title": "Spanish: choosing preterite vs. imperfect",
  "topic": "Spanish",
  "objective": "Choose and produce the correct past tense in context",
  "mode": "practice",
  "passScore": 80,
  "instructions": "Complete without notes, then review the explanations.",
  "appearance": {
    "preset": "technical",
    "accent": "#176b87",
    "density": "comfortable",
    "radius": "soft",
    "layout": "split",
    "showItemTypes": false
  },
  "items": []
}
```

- `mode`: `diagnostic`, `practice`, or `simulation`.
- `passScore`: integer percentage from 1–100; default 80.
- Item IDs must be unique. Every graded item needs `skill`, `points`, and `explanation`.
- Shared optional item fields: `hint`, `required` (default true), and `tags`.

## Rich content and visual direction

The runtime safely compiles GitHub-flavored Markdown and KaTeX-compatible LaTeX before the page opens. Rich content is supported in `objective`, `instructions`, `prompt`, `hint`, `explanation`, choices, matching terms, ordering steps, and content blocks.

```markdown
Use the identity $\sin^2(x)+\cos^2(x)=1$.

$$\int 2x\cos(x^2)\,dx$$

| Signal | Use |
|---|---|
| repeated background action | imperfect |
| completed event | preterite |
```

Supported Markdown includes headings, emphasis, lists, block quotes, links, fenced code, images, and tables. Raw HTML is sanitized. Do not use Markdown as a substitute for clear structure.

### Appearance

- `preset`: `study`, `editorial`, `technical`, or `midnight`. All use the same minimal Learn design system. `study` is the dark default; `editorial` is its light reading variant.
- `accent`: optional six-digit hex color such as `#176b87`. Use one accessible accent for the whole sheet.
- `density`: `compact`, `comfortable`, or `spacious`.
- `radius`: `sharp` or `soft`.
- `layout`: `single` or responsive `split`.
- `showItemTypes`: whether labels reveal item formats such as `choice` or `integral`; default false.

The preset is a small variation within the shared browser style, not permission to invent a new theme. A literature close-reading sheet can still use `study`; a dense formula drill may benefit from `technical`. In split layout, items default to one grid cell. Add `"width": "full"` to passages, large tables, long prompts, and reflections. Optional item `tone` values are `default`, `accent`, and `quiet`.

### Content block

Content blocks interleave instruction, reference material, and section transitions with questions. They require `points: 0`, are excluded from progress and grading, and do not require `skill`.

```json
{
  "id": "reference-table",
  "type": "content",
  "prompt": "## Decision cues",
  "content": "| If the context shows... | Prefer... |\n|---|---|\n| a bounded completed event | **preterite** |\n| an ongoing background state | **imperfect** |",
  "points": 0,
  "width": "full",
  "tone": "accent"
}
```


### Comprehensive Table & Math Authoring Example

Here is a full pattern illustrating aligned markdown tables, LaTeX display environments, and content blocks:

```json
{
  "id": "matrix-transform-ref",
  "type": "content",
  "prompt": "## Linear Transformation Reference",
  "content": "Review the 2D transformation matrices below:\n\n| Transformation | Matrix Representation | Determinant | Invertible |\n| :--- | :---: | :---: | ---: |\n| Counter-clockwise rotation $\\theta$ | $\\begin{pmatrix} \\cos\\theta & -\\sin\\theta \\\\ \\sin\\theta & \\cos\\theta \\end{pmatrix}$ | $1$ | Always |\n| Horizontal shear by $k$ | $\\begin{pmatrix} 1 & k \\\\ 0 & 1 \\end{pmatrix}$ | $1$ | Always |\n| Projection onto x-axis | $\\begin{pmatrix} 1 & 0 \\\\ 0 & 0 \\end{pmatrix}$ | $0$ | Never |\n\nFor any transformation $T(\\vec{v}) = A\\vec{v}$, the area scaling factor is given by:\n\\[ \\text{Area ratio} = |\\det(A)| \\]",
  "points": 0,
  "width": "full",
  "tone": "accent"
}
```

## Item types

### Choice

```json
{
  "id": "tense-1",
  "type": "choice",
  "skill": "preterite-vs-imperfect",
  "prompt": "Cuando era niño, yo ___ al parque cada sábado.",
  "options": ["fui", "iba", "iré", "he ido"],
  "answer": "iba",
  "points": 1,
  "explanation": "A repeated background habit takes the imperfect."
}
```

### Multiple select

Use only when selecting every valid member is the target. `answers` must contain exact option strings.

```json
{
  "id": "features-1",
  "type": "multi-select",
  "skill": "classification",
  "prompt": "Select every continuous function.",
  "options": ["x²", "1/x on all real numbers", "sin(x)", "floor(x)"],
  "answers": ["x²", "sin(x)"],
  "points": 2,
  "explanation": "Polynomial and sine functions are continuous on all real numbers."
}
```

### Short text

`acceptedAnswers` are normalized for surrounding whitespace and, unless `caseSensitive` is true, letter case. Use `containsAll` instead for a concise response requiring several ideas.

```json
{
  "id": "cause-1",
  "type": "text",
  "skill": "causal-explanation",
  "prompt": "Name the process that converts nitrogen gas into usable ammonia.",
  "acceptedAnswers": ["nitrogen fixation", "fixation"],
  "caseSensitive": false,
  "points": 1,
  "explanation": "Nitrogen fixation converts atmospheric N₂ into ammonia."
}
```

For keyword-scored responses:

```json
{
  "id": "explain-1",
  "type": "text",
  "skill": "mechanism",
  "prompt": "In one sentence, explain why pressure rises when volume falls at constant temperature.",
  "containsAll": ["collision", "wall"],
  "points": 2,
  "explanation": "Less volume causes more frequent particle-wall collisions."
}
```

### Numeric

```json
{
  "id": "slope-1",
  "type": "numeric",
  "skill": "derivatives",
  "prompt": "If f(x)=x³, find f'(2).",
  "answer": 12,
  "tolerance": 0.001,
  "unit": "",
  "points": 1,
  "explanation": "f'(x)=3x², so f'(2)=12."
}
```

### Expression

Use for symbolic production. The server automatically scores canonical and explicitly listed accepted strings (ignoring case and whitespace). A different symbolic form is **pending tutor review**, never automatically wrong or credited. Do not promise general algebraic equivalence checking; evaluate the learner's steps and mathematical equivalence separately.

```json
{
  "id": "simplify-1",
  "type": "expression",
  "skill": "algebra",
  "prompt": "Simplify (x+1)²-(x-1)².",
  "variable": "x",
  "answer": "4*x",
  "acceptedAnswers": ["4x", "x*4"],
  "points": 2,
  "explanation": "Expansion leaves 4x after cancellation."
}
```

### Integral

Provide a canonical `answer` and accepted notations. The server checks only those representations; an unfamiliar form is **pending tutor review**, not an automatic failure. Ask the learner to justify by differentiation or use a separate changed-case check; client-side numerical heuristics are not trusted as mastery evidence.

```json
{
  "id": "integral-1",
  "type": "integral",
  "skill": "u-substitution",
  "prompt": "Evaluate the indefinite integral.",
  "integrand": "2*x*cos(x^2)",
  "display": "∫ 2x cos(x²) dx",
  "variable": "x",
  "answer": "sin(x^2)+C",
  "acceptedAnswers": ["sin(x²)+C", "sin(x^2)+c"],
  "points": 3,
  "explanation": "Let u=x², so du=2x dx and the integral is sin(u)+C."
}
```

### Cloze

Put numbered markers such as `[[1]]` in `prompt`. Supply one blank per marker in order.

```json
{
  "id": "cloze-1",
  "type": "cloze",
  "skill": "sentence-production",
  "prompt": "Ayer yo [[1]] al mercado y [[2]] fruta.",
  "blanks": [
    { "answers": ["fui"] },
    { "answers": ["compré", "compre"] }
  ],
  "points": 2,
  "explanation": "Both are completed actions, so the preterite is used."
}
```

### Match

```json
{
  "id": "match-1",
  "type": "match",
  "skill": "vocabulary",
  "prompt": "Match each term to its meaning.",
  "pairs": [
    { "left": "la mesa", "right": "table" },
    { "left": "la silla", "right": "chair" }
  ],
  "points": 2,
  "explanation": "Review any pair that was not retrieved correctly."
}
```

### Order

`steps` is the correct order. The runtime shuffles it and provides move controls.

```json
{
  "id": "order-1",
  "type": "order",
  "skill": "procedure",
  "prompt": "Put the substitution workflow in order.",
  "steps": ["Choose u", "Compute du", "Rewrite the integral", "Integrate", "Substitute back"],
  "points": 2,
  "explanation": "A substitution is complete only after returning to the original variable."
}
```

### Speaking & Pronunciation

Used for oral practice. Speech synthesis and the optional browser microphone can produce a transcript; a typed fallback is available. Speech recognition is **not** a pronunciation assessor: the submitted response needs a tutor or qualified speaker to review it, and it does not contribute automatic mastery evidence.

```json
{
  "id": "spanish-speech-1",
  "type": "speaking",
  "skill": "oral-production",
  "prompt": "Say in Spanish: *'Where is the nearest train station?'*",
  "expectedPhrase": "¿Dónde está la estación de tren más cercana?",
  "acceptedPhrases": [
    "¿Dónde está la estación de tren más cercana?",
    "Donde esta la estacion de tren mas cercana",
    "Donde esta la estacion de tren mas proxima"
  ],
  "audioPrompt": "¿Dónde está la estación de tren más cercana?",
  "language": "es-ES",
  "points": 2,
  "explanation": "Use 'más cercana' or 'más próxima' with the verb 'estar' for physical location."
}
```

### Accounting & Financial Sheets

Used for journal entries, T-accounts and financial statements. Provides editable rows, dynamic row controls, and live Debit/Credit totals ($\sum \text{Debits} = \sum \text{Credits}$). Balance alone does not prove the accounts or explanation are correct; the submitted sheet is pending tutor review, not automatically verified cell by cell.

```json
{
  "id": "acct-journal-1",
  "type": "sheet",
  "skill": "journal-entries",
  "prompt": "Record the journal entry for: *'Company issued common stock for $15,000 cash.'*",
  "columns": ["Date", "Account Title & Explanation", "Debit ($)", "Credit ($)"],
  "rows": 2,
  "enforceBalance": true,
  "expectedRows": [
    { "Account Title & Explanation": "Cash", "Debit ($)": "15000" },
    { "Account Title & Explanation": "Common Stock", "Credit ($)": "15000" }
  ],
  "points": 3,
  "explanation": "Debit Cash (asset increases by $15,000) and Credit Common Stock (equity increases by $15,000)."
}
```

### Reflection or extended response

This item is saved but not included in the automatic score. Retrieve and evaluate it from `get_activity_results`.

```json
{
  "id": "reflection-1",
  "type": "reflection",
  "skill": "metacognition",
  "prompt": "Which decision cue was hardest to notice, and why?",
  "placeholder": "Write 2–4 sentences…",
  "points": 0
}
```

## Composition patterns

- **Language:** cloze → matching → short production → contextual choice.
- **Quantitative:** one numeric prerequisite → two expressions/integrals → one ordering or explanation item.
- **Custom assessment form:** mix choice, multi-select, text, numeric, and one reflection; align points with the real rubric.
- **Diagnostic:** 2–4 representative items, no exhaustive drilling.
- **Simulation:** reproduce the real response modes and approximate point weights; do not add hints unless the real evaluation provides them.
